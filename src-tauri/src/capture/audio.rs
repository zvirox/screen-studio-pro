//! Audio capture — PLAN 2.1 (PRD M4): mic via cpal, desktop audio via a
//! direct PipeWire capture stream on the default sink monitor, mixed into
//! one AAC stream in the recording.
//!
//! Contracts implemented here:
//! - ARCHITECTURE §2: producers live in `capture/`; the encode-side mix +
//!   drain glue lives in `pipeline/` (audio handoff mirrors the video
//!   FrameBus).
//! - API §6 standing flag: audio samples are media bytes — they never
//!   cross the IPC; only device lists and channel configs do.
//! - §6 thread law: capture callbacks are real-time — they convert and
//!   push once, never block, never allocate beyond the staged copy.
//!   Backpressure drops NEWEST and counts (the video-bus policy).

/* The wiring note: the composition is live end-to-end as of 2.1 (F:
`audio_list_devices` / `audio_set_channel` handlers, recording_start's
plan builder). What stays pre-wired are the 2.2 seams —
`AudioChannel::parse`/`as_str` (the `recording/meters` payload keys),
`ChannelConfig::validate`, `mark_default`, and `AudioProducer::ring`
— Rust sees those as dead until the meters/events task lands. */
#![allow(dead_code)]

use crate::pipeline::AudioRing;
use crate::util::error::CoreError;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use pipewire as pw;
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Composition rate for the mixed stream (PRD M10 ties 48 kHz to the
/// audio group; every capture input is converted into this clock).
pub const SAMPLE_RATE: u32 = 48_000;

/// The take's audio composition is stereo (mirrors OBS's default channel
/// map; mono sources are folded up, >2-channel captures fold down).
pub const CHANNELS: usize = 2;

/// The two mixing channels — API §2.2 `channel` strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioChannel {
    Mic,
    Desktop,
}

impl AudioChannel {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "mic" => Some(Self::Mic),
            "desktop" => Some(Self::Desktop),
            _ => None,
        }
    }

    /// API §3 `recording/meters` payload key (task 2.2) and event text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::Desktop => "desktop",
        }
    }
}

/// One mixing channel's recording-time shape — built from the persisted
/// settings (`Settings::audio`) plus any per-take override from the
/// `recording_start` body. `level` is 0–100 (API §2.2); anything else is
/// a contract violation caught by [`ChannelConfig::validate`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelConfig {
    pub channel: AudioChannel,
    pub enabled: bool,
    pub muted: bool,
    /// `None` = the system default device for this channel.
    pub device_id: Option<String>,
    pub level: u8,
}

impl ChannelConfig {
    /// Typed validation (API §1 `settings.invalid_value`): the level
    /// range is the only thing wire data can get wrong here.
    pub fn validate(&self) -> Result<(), crate::util::error::CoreError> {
        if self.level > 100 {
            return Err(crate::util::error::CoreError::settings(
                "settings.invalid_value",
                false,
                "Audio level must be between 0 and 100.",
            ));
        }
        Ok(())
    }
}

/// API §2.2 device descriptor wire shape (`audio_list_devices` rows).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

/// One channel's contribution to the mix: gain applied, samples in
/// interleaved stereo at [`SAMPLE_RATE`].
pub type Contribution<'a> = (f32, &'a [f32]);

/// level (0–100) → linear gain (0.0–1.0). Linear, not perceptual: the
/// laws allow a single mapping and the M10 UI documents "100 = full".
pub fn channel_gain(level: u8) -> f32 {
    f32::from(level.min(100)) / 100.0
}

/// The mix law: sum every contribution sample-wise, clip at 0 dBFS.
/// `len` is the COMMON interleaved length; a shorter contribution is
/// padded with silence (a channel that underruns this cycle contributes
/// zeros for the window it missed — its ring catches up later).
pub fn mix_chunks(contribs: &[Contribution<'_>], len: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; len];
    for (gain, samples) in contribs {
        if *gain == 0.0 || samples.is_empty() {
            continue;
        }
        for (i, slot) in out.iter_mut().enumerate().take(len) {
            let sample = samples.get(i).copied().unwrap_or(0.0);
            *slot += sample * gain;
            *slot = slot.clamp(-1.0, 1.0);
        }
    }
    out
}

/// Fold a capture callback's native channel count into interleaved
/// stereo for the ring: mono duplicates to L/R, stereo passes through,
/// wider layouts take the first two channels (no downmix math at the
/// real-time call site).
pub fn fold_to_stereo(interleaved: &[f32], src_channels: usize) -> Vec<f32> {
    if interleaved.is_empty() || src_channels == 0 {
        return Vec::new();
    }
    match src_channels {
        1 => {
            let mut out = Vec::with_capacity(interleaved.len() * 2);
            for &s in interleaved {
                out.push(s);
                out.push(s);
            }
            out
        }
        2 => interleaved.to_vec(),
        n => {
            let mut out = Vec::with_capacity(interleaved.len() / n * 2);
            for frame in interleaved.chunks(n) {
                out.push(frame[0]);
                out.push(frame[1]);
            }
            out
        }
    }
}

/// Linear resample of interleaved-stereo samples to [`SAMPLE_RATE`]
/// (mic devices commonly run 44.1 kHz; PipeWire desktop audio is
/// negotiated at 48 k and skips this). Phase increments float and
/// interpolate between the two nearest source frames; the tail frame
/// repeats when the source ends mid-window.
pub fn resample_linear(interleaved_stereo: &[f32], src_rate: u32) -> Vec<f32> {
    if src_rate == SAMPLE_RATE || interleaved_stereo.is_empty() {
        return interleaved_stereo.to_vec();
    }
    let src_frames = interleaved_stereo.len() / CHANNELS;
    if src_frames == 0 {
        return Vec::new();
    }
    // Long division in f64: the target frame count for this window.
    let dst_frames =
        ((src_frames as u64 * u64::from(SAMPLE_RATE)) / u64::from(src_rate)).max(1) as usize;
    let step = f64::from(src_rate) / f64::from(SAMPLE_RATE);
    let mut out = Vec::with_capacity(dst_frames * CHANNELS);
    for i in 0..dst_frames {
        let pos = i as f64 * step;
        let i0 = pos.floor() as usize;
        let i1 = (i0 + 1).min(src_frames - 1);
        let frac = (pos - i0 as f64) as f32;
        for ch in 0..CHANNELS {
            let a = interleaved_stereo[i0 * CHANNELS + ch];
            let b = interleaved_stereo[i1 * CHANNELS + ch];
            out.push(a + (b - a) * frac);
        }
    }
    out
}

/// Device-id sanitizer: API §2.2 examples (`mic_blue-snowball`,
/// `sink_0`) — lowercase, non-alphanumerics → `-`, prefixed by kind.
pub fn device_id(kind: &str, label: &str, ordinal: usize) -> String {
    let slug: String = label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .to_lowercase()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    // The ordinal keeps ids unique when two devices share a label.
    format!("{kind}_{slug}-{ordinal}")
}

/// Marks exactly the device whose id matches `default_id` (or nothing
/// when the platform gave us no default — the UI renders "no default"
/// honestly rather than inventing one).
pub fn mark_default(
    mut devs: Vec<AudioDeviceInfo>,
    default_id: Option<&str>,
) -> Vec<AudioDeviceInfo> {
    for dev in &mut devs {
        dev.is_default = default_id.is_some_and(|id| id == dev.id);
    }
    devs
}

/* ---------- device enumeration + producers (2.1) ---------- */
/* Capture callbacks are REAL-TIME threads — they convert and push once,
never block, never allocate beyond the staged copy (§6). The device-lost
law (API §3): a capture source that disappears mid-take does NOT kill the
take — its ring is disabled (silence) and the session emits the non-fatal
`pipewire.audio_device_gone` event. Start-time failures are fatal for the
take (recording_start rejects, typed, before any media flows). */

pub type OnLost = Box<dyn FnOnce(&str) + Send>;
pub type LostSlot = Arc<std::sync::Mutex<Option<OnLost>>>;

/// Fires the lost callback at most once (video capture's discipline,
/// capture/pipewire.rs — duplicated, not imported: the modules stay
/// independent seam-wise).
fn report_lost(slot: &LostSlot, reason: &str) {
    let mut slot = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(callback) = slot.take() {
        callback(reason);
    }
}

fn audio_enum_failed(cause: &'static str) -> CoreError {
    tracing::error!(cause, "audio enumeration failed");
    CoreError::pipewire(
        "pipewire.audio_enum_failed",
        true,
        "Audio devices could not be listed. Check that PipeWire is running.",
    )
}

/// Mic enumeration via the default cpal host (ALSA — through the
/// PipeWire ALSA bridge on a Wayland desktop; names are ALSA-shaped: a
/// known deviation, recorded in the PLAN ledger).
pub fn list_mics() -> Result<Vec<AudioDeviceInfo>, CoreError> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let mut devs: Vec<AudioDeviceInfo> = Vec::new();
    let Ok(iter) = host.input_devices() else {
        return Err(audio_enum_failed(
            "the cpal host could not list input devices",
        ));
    };
    for (ordinal, device) in iter.enumerate() {
        let Ok(desc) = device.description() else {
            // Undescribable device = unaddressable wire row; skip rather
            // than render something the seam cannot reopen.
            continue;
        };
        let name = desc.name().to_owned();
        let id = device_id("mic", &name, ordinal);
        if devs.iter().any(|d| d.id == id) {
            // Duplicate label collision (the same card exposed twice) —
            // keep the first stable id only.
            continue;
        }
        // Device: PartialEq — the default check is structural, never
        // name-des peeled (two "Blue Snowball"s stay distinguishable).
        let is_default = default_device.as_ref() == Some(&device);
        devs.push(AudioDeviceInfo {
            id,
            label: name,
            is_default,
        });
    }
    Ok(devs)
}

/// One PipeWire sink node, as seen on the local graph.
#[derive(Clone)]
struct SinkNode {
    node_id: u32,
    description: String,
}

/// Round-trips the LOCAL PipeWire graph registry and collects every
/// `media.class == "Audio/Sink"` node, in node-id order. Bounded: a 3 s
/// wall-clock deadline (a wedged graph must never hang a device list or
/// a recording start) — partial results are honest results.
fn pw_sink_nodes() -> Result<Vec<SinkNode>, CoreError> {
    pw::init();
    let Ok(mainloop) = pw::main_loop::MainLoopRc::new(None) else {
        return Err(audio_enum_failed("the PipeWire main loop could not start"));
    };
    let Ok(context) = pw::context::ContextRc::new(&mainloop, None) else {
        return Err(audio_enum_failed("the PipeWire context could not start"));
    };
    let Ok(core) = context.connect_rc(None) else {
        return Err(audio_enum_failed("the PipeWire graph is unreachable"));
    };
    let Ok(registry) = core.get_registry_rc() else {
        return Err(audio_enum_failed("the PipeWire registry is unavailable"));
    };

    let sinks: Arc<std::sync::Mutex<Vec<SinkNode>>> = Arc::default();
    let done = Arc::new(AtomicBool::new(false));

    let sinks_for_listener = sinks.clone();
    let registry_listener = registry
        .add_listener_local()
        .global(move |global| {
            if global.type_ != pw::types::ObjectType::Node {
                return;
            }
            let Some(props) = global.props.as_ref() else {
                return;
            };
            if props.get("media.class") != Some("Audio/Sink") {
                return;
            }
            let description = props
                .get("node.description")
                .or_else(|| props.get("node.name"))
                .unwrap_or("")
                .to_owned();
            sinks_for_listener
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(SinkNode {
                    node_id: global.id,
                    description,
                });
        })
        .register();
    // (register() is infallible — it hands back the Listener guard.)

    // Round-trip: `sync` pins the registry dump behind a core `done`
    // event carrying the same seq — when it fires for PW_ID_CORE the
    // enumeration is complete for this pass (roundtrip.rs pattern).
    let Ok(pending) = core.sync(0) else {
        return Err(audio_enum_failed("the PipeWire registry sync failed"));
    };
    let done_for_done_cb = done.clone();
    let mainloop_for_done_cb = mainloop.clone();
    let core_listener = core
        .add_listener_local()
        .done(move |id, seq| {
            if id == pw::core::PW_ID_CORE && seq == pending {
                done_for_done_cb.store(true, Ordering::Release);
                mainloop_for_done_cb.quit();
            }
        })
        .register();
    // (core-side register() is also infallible.)

    // Dispatch on OUR thread until the roundtrip completes or the
    // deadline cuts a wedged graph off.
    let deadline = Instant::now() + Duration::from_secs(3);
    while !done.load(Ordering::Acquire) {
        if Instant::now() >= deadline {
            tracing::warn!("pipewire sink enumeration timed out (partial list)");
            break;
        }
        mainloop
            .loop_()
            .iterate(pw::loop_::Timeout::Finite(Duration::from_millis(100)));
    }
    // Declaration order above: mainloop, context, core, registry,
    // listeners — reverse drop unwinds listeners before their objects.
    drop(core_listener);
    drop(registry_listener);
    drop(registry);
    drop(core);
    drop(context);
    drop(mainloop);

    let mut nodes = sinks.lock().unwrap_or_else(|p| p.into_inner()).clone();
    nodes.sort_by_key(|node| node.node_id);
    nodes.dedup_by(|a, b| a.node_id == b.node_id);
    Ok(nodes)
}

/// The API §2.2 `desktop` rows: wire ids are slugged from the human
/// description (uniform mic/sink shape), ordered by node id for
/// stability across calls. No row is flagged default — PipeWire's
/// "default sink" lives in the metadata, not node props, and an absent
/// deviceId in settings ALREADY means "follow the default sink" (M4).
/// Honest omission, not a lie.
pub fn list_desktop_outputs() -> Result<Vec<AudioDeviceInfo>, CoreError> {
    let nodes = pw_sink_nodes()?;
    Ok(nodes
        .into_iter()
        .enumerate()
        .map(|(ordinal, node)| AudioDeviceInfo {
            id: device_id("sink", &node.description, ordinal),
            label: node.description,
            is_default: false,
        })
        .collect())
}

/// API §2.2 `audio_set_channel` device-existence checks (the ipc layer
/// validates BEFORE persisting; the store cannot enumerate). A live
/// enumeration failure is `pipewire.audio_enum_failed`; a miss is
/// `Ok(false)` (the handler turns it into `pipewire.audio_device_gone`).
pub fn mic_exists(wire_id: &str) -> Result<bool, CoreError> {
    Ok(list_mics()?.iter().any(|dev| dev.id == wire_id))
}

pub fn sink_exists(wire_id: &str) -> Result<bool, CoreError> {
    Ok(list_desktop_outputs()?.iter().any(|dev| dev.id == wire_id))
}

/// Resolves a persisted wire id back to its PipeWire node number at
/// capture start (the wire id is stable text; the node id is only
/// meaningful on the live graph).
fn resolve_sink_node(wire_id: &str) -> Result<u32, CoreError> {
    let nodes = pw_sink_nodes()?;
    nodes
        .iter()
        .enumerate()
        .find(|(ordinal, node)| device_id("sink", &node.description, *ordinal) == wire_id)
        .map(|(_, node)| node.node_id)
        .ok_or_else(|| {
            CoreError::pipewire(
                "pipewire.audio_device_gone",
                true,
                "The chosen output device is gone. Pick another in Audio settings.",
            )
        })
}

/* ---------- producers ---------- */

/// Concrete negotiated facts a producer resolves on its data thread:
/// the mix path needs them when a graph renegotiates away from the
/// fixed 48 kHz stereo offer (cpal mics routinely do).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NegotiatedAudio {
    pub sample_rate: u32,
    pub channels: usize,
}

/// Live audio capture guard for one channel: `stop()` ends the data
/// thread and joins it; dropping the guard stops too (video's
/// StreamGuard discipline). The ring OUTLIVES the producer — the mixer
/// drains the post-stop tail, hence the shared Arc, not ownership.
pub struct AudioProducer {
    stop: Arc<AtomicBool>,
    ring: Arc<AudioRing>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl AudioProducer {
    /// The mixed hop this producer feeds; the same Arc handed to the
    /// session mixer at recording_start.
    pub fn ring(&self) -> Arc<AudioRing> {
        self.ring.clone()
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for AudioProducer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Real-time conversion from a capture callback's native shape into the
/// composition clock (48 kHz interleaved stereo): fold + linear
/// resample + one ring try. A free function so both producers'
/// real-time bodies stay three lines long (§6).
fn convert_and_push(ring: &AudioRing, interleaved: &[f32], channels: usize, src_rate: u32) {
    let folded = fold_to_stereo(interleaved, channels);
    let converted = resample_linear(&folded, src_rate);
    let _ = ring.try_push(&converted);
}

/// Finds a cpal input device by the SAME wire id scheme `list_mics`
/// hands out (scan order = the shared ordinal contract).
fn find_mic_device(host: &cpal::Host, wire_id: &str) -> Option<cpal::Device> {
    let iter = host.input_devices().ok()?;
    for (ordinal, device) in iter.enumerate() {
        let Ok(desc) = device.description() else {
            continue;
        };
        if device_id("mic", desc.name(), ordinal) == wire_id {
            return Some(device);
        }
    }
    None
}

/// Spawns the MIC producer (cpal): an f32 input stream on the chosen
/// device (or the system default) pushing fold+resample windows onto
/// the ring. Blocks on a bounded start handshake so `recording_start`
/// fails fast and typed instead of recording dead air forever.
pub fn start_mic(
    config: &ChannelConfig,
    ring: Arc<AudioRing>,
    on_lost: OnLost,
) -> Result<AudioProducer, CoreError> {
    let stop = Arc::new(AtomicBool::new(false));
    let lost_slot: LostSlot = Arc::new(std::sync::Mutex::new(Some(on_lost)));
    let host = cpal::default_host();

    // Device scan on the CALLER'S thread: "device gone" is caught typed
    // BEFORE any recording state exists to clean up.
    let device = match &config.device_id {
        Some(id) => find_mic_device(&host, id).ok_or_else(|| {
            CoreError::pipewire(
                "pipewire.audio_device_gone",
                true,
                "The chosen microphone is gone. Pick another in Audio settings.",
            )
        })?,
        None => host.default_input_device().ok_or_else(|| {
            CoreError::pipewire(
                "pipewire.audio_device_gone",
                true,
                "No microphone is connected. Plug one in or disable the mic channel.",
            )
        })?,
    };

    // Config choice: f32-only (the fold path is f32 end to end); 48 kHz
    // when the device spans it, else the device's own max (resample_
    // linear normalizes on the real-time path).
    let chosen = device
        .supported_input_configs()
        .ok()
        .and_then(|mut configs| configs.find(|c| c.sample_format() == cpal::SampleFormat::F32))
        .ok_or_else(|| {
            CoreError::pipewire(
                "pipewire.audio_device_gone",
                true,
                "The microphone does not offer a supported capture format.",
            )
        })?;
    let rate = if chosen.min_sample_rate() <= 48_000 && chosen.max_sample_rate() >= 48_000 {
        48_000
    } else {
        chosen.max_sample_rate()
    };
    let stream_config = cpal::StreamConfig {
        channels: chosen.channels(),
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    };

    let (started_tx, started_rx) = std::sync::mpsc::channel::<Result<(), CoreError>>();
    let stop_for_thread = stop.clone();
    let lost_for_thread = lost_slot.clone();
    let ring_for_data = ring.clone();
    let ring_for_err = ring.clone();
    let channels = stream_config.channels as usize;
    let src_rate = stream_config.sample_rate;

    let thread = std::thread::Builder::new()
        .name("cpal-mic".into())
        .spawn(move || {
            // Real-time path: convert + ONE try, never block (§6).
            let data_cb = move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                convert_and_push(&ring_for_data, data, channels, src_rate);
            };
            let err_cb = move |err: cpal::Error| {
                tracing::error!(error = %err, "mic capture stream error");
                ring_for_err.disable();
                report_lost(&lost_for_thread, "mic stream error");
            };
            let stream =
                device.build_input_stream::<f32, _, _>(stream_config, data_cb, err_cb, None);
            match stream {
                Ok(stream) if stream.play().is_ok() => {
                    let _ = started_tx.send(Ok(()));
                }
                Ok(_) => {
                    let _ = started_tx.send(Err(CoreError::pipewire(
                        "pipewire.audio_device_gone",
                        true,
                        "The microphone could not be started.",
                    )));
                    return;
                }
                Err(_) => {
                    let _ = started_tx.send(Err(CoreError::pipewire(
                        "pipewire.audio_device_gone",
                        true,
                        "The microphone could not be opened. Check other recording apps.",
                    )));
                    return;
                }
            }
            // Park until stop: the stream lives on THIS thread (RAII
            // drop at thread exit ends capture).
            while !stop_for_thread.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(100));
            }
        })
        .map_err(|_| {
            CoreError::pipewire(
                "pipewire.stream_lost",
                true,
                "The microphone capture thread could not start.",
            )
        })?;

    // Bounded handshake: mic-open failures land BEFORE the take starts.
    match started_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(AudioProducer {
            stop,
            ring,
            thread: Some(thread),
        }),
        Ok(Err(err)) => {
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err(err)
        }
        Err(_timeout) => {
            // A mic that neither starts nor fails in 5 s would hang
            // recording_start forever — treat the timeout as a typed
            // start failure and tear the worker down.
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err(CoreError::pipewire(
                "pipewire.audio_device_gone",
                true,
                "The microphone did not respond. Try another input device.",
            ))
        }
    }
}

/// Spawns the DESKTOP producer (PipeWire): a local-graph capture stream
/// on the default sink monitor (`stream.capture.sink = true`) — no
/// portal, no consent dialog. Mirrors capture/pipewire.rs's run-loop
/// discipline (same object lifetimes, same lost reporting).
pub fn start_desktop(
    config: &ChannelConfig,
    ring: Arc<AudioRing>,
    on_lost: OnLost,
) -> Result<AudioProducer, CoreError> {
    // Pinned sink → live node id on OUR graph now (wire ids are stable
    // text; node ids are graph-session local).
    let node_id: Option<u32> = match &config.device_id {
        Some(id) => Some(resolve_sink_node(id)?),
        None => None,
    };

    let stop = Arc::new(AtomicBool::new(false));
    let lost_slot: LostSlot = Arc::new(std::sync::Mutex::new(Some(on_lost)));
    let stop_for_thread = stop.clone();
    let lost_for_thread = lost_slot.clone();
    let ring_for_producer = ring.clone();

    let thread = std::thread::Builder::new()
        .name("pipewire-desktop-audio".into())
        .spawn(move || {
            audio_pw_run_loop(node_id, ring_for_producer, stop_for_thread, lost_for_thread)
        })
        .map_err(|_| {
            CoreError::pipewire(
                "pipewire.stream_lost",
                true,
                "The desktop audio capture thread could not start.",
            )
        })?;

    Ok(AudioProducer {
        stop,
        ring,
        thread: Some(thread),
    })
}

/// Data-thread state for the desktop stream: the ring to feed, the
/// negotiated format (param_changed → process, same thread — no sync
/// needed, the video pattern), and the lost slot for stream errors.
struct DesktopUserData {
    ring: Arc<AudioRing>,
    negotiated: Option<NegotiatedAudio>,
    lost: LostSlot,
}

/// One PipeWire main loop on OUR thread pumping monitor audio into the
/// ring — same shape as capture/pipewire.rs's run_loop (loop-owned
/// objects drop in declaration order on the way out; every early return
/// reports through on_lost, never panics, §4.2).
fn audio_pw_run_loop(
    node_id: Option<u32>,
    ring: Arc<AudioRing>,
    stop: Arc<AtomicBool>,
    lost_slot: LostSlot,
) {
    use pw::spa;
    const STOP_POLL: Duration = Duration::from_millis(100);
    let lost = |reason: &str| report_lost(&lost_slot, reason);

    pw::init();
    let Ok(mainloop) = pw::main_loop::MainLoopRc::new(None) else {
        return lost("pipewire mainloop init failed");
    };
    let Ok(context) = pw::context::ContextRc::new(&mainloop, None) else {
        return lost("pipewire context init failed");
    };
    let Ok(core) = context.connect_rc(None) else {
        return lost("pipewire remote connect failed");
    };
    let mut props = pw::properties::properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Music",
        // Default sink MONITOR (PRD M4): the sounds the user actually
        // hears, captured from our own graph connection — no portal,
        // no consent dialog (those guard SCREENS, not sink monitors).
        *pw::keys::STREAM_CAPTURE_SINK => "true",
    };
    if let Some(node) = node_id {
        // Pinned sink (API §2.2 devices): `target.object` takes the
        // node id as text — the graph routes THAT node's monitor ports.
        // (Raw literal: pw's TARGET_OBJECT const sits behind the
        // `v0_3_44` feature we do not enable.)
        props.insert("target.object", node.to_string());
    }
    let Ok(stream) = pw::stream::StreamBox::new(&core, "screen-studio-desktop-audio", props) else {
        return lost("pipewire stream creation failed");
    };

    // Fixed offer: F32LE @ 48 kHz stereo forces the graph to resample
    // for us when the device runs another clock — the composition law's
    // 48 kHz guarantee lands HERE for desktop audio (the mic path still
    // carries resample_linear for cpal's native rates).
    let mut audio_info = spa::param::audio::AudioInfoRaw::new();
    audio_info.set_format(spa::param::audio::AudioFormat::F32LE);
    audio_info.set_rate(SAMPLE_RATE);
    audio_info.set_channels(CHANNELS as u32);
    let format = pw::spa::pod::Object {
        type_: pw::spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: pw::spa::param::ParamType::EnumFormat.as_raw(),
        properties: audio_info.into(),
    };
    let values = match pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(format),
    ) {
        Ok((bytes, _)) => bytes.into_inner(),
        Err(err) => {
            tracing::error!(%err, "audio format serialization failed");
            return lost("audio pod serialization failed");
        }
    };
    let Some(pod) = pw::spa::pod::Pod::from_bytes(&values) else {
        return lost("serialized audio pod is invalid");
    };
    let mut params = [pod];

    let user_data = DesktopUserData {
        ring,
        negotiated: None,
        lost: lost_slot.clone(),
    };
    let Ok(listener) = stream
        .add_local_listener_with_user_data(user_data)
        .state_changed(|_stream, ud, _old, new| match new {
            pw::stream::StreamState::Streaming => {
                tracing::debug!(negotiated = ?ud.negotiated, "desktop audio stream is live");
            }
            pw::stream::StreamState::Error(err) => {
                tracing::error!(error = %err, "desktop audio stream error");
                // Mid-take loss: silence + the session's non-fatal event
                // (API §3) — never a killed take.
                ud.ring.disable();
                report_lost(&ud.lost, "desktop audio stream error");
            }
            _ => {}
        })
        .param_changed(|_stream, ud, id, param| {
            let Some(param) = param else {
                return; // format cleared;
            };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let Ok((media_type, media_subtype)) = spa::param::format_utils::parse_format(param)
            else {
                return;
            };
            if media_type != spa::param::format::MediaType::Audio
                || media_subtype != spa::param::format::MediaSubtype::Raw
            {
                tracing::warn!(
                    ?media_type,
                    ?media_subtype,
                    "unexpected audio format family"
                );
                return;
            }
            let mut info = spa::param::audio::AudioInfoRaw::default();
            if info.parse(param).is_ok() {
                ud.negotiated = Some(NegotiatedAudio {
                    sample_rate: info.rate(),
                    channels: info.channels() as usize,
                });
            }
        })
        .process(|stream, ud| {
            let (rate, channels) = match ud.negotiated {
                Some(neg) => (neg.sample_rate, neg.channels),
                // No format yet — treat as the offered shape; the first
                // param_changed corrects it before real audio flows.
                None => (SAMPLE_RATE, CHANNELS),
            };
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return; // out of buffers — skip this quantum
            };
            let Some(data) = buffer.datas_mut().first_mut() else {
                return;
            };
            let size = data.chunk().size() as usize;
            let Some(bytes) = data.data() else {
                return; // dmabuf/unmapped — stay silent rather than OOB
            };
            // The offer pins FLT (packed interleaved f32); the chunk
            // size counts BYTES. A partial tail sample is dropped.
            let sample_count = size / 4;
            if bytes.len() < sample_count * 4 {
                tracing::warn!(
                    have = bytes.len(),
                    need = sample_count * 4,
                    "short desktop audio buffer"
                );
                return;
            }
            // One staged copy (bytes → f32). from_le_bytes keeps the
            // conversion defined on every platform; no transmute.
            // (`as_chunks` keeps the 4-byte lanes type-checked.)
            let samples: Vec<f32> = bytes[..sample_count * 4]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect();
            convert_and_push(&ud.ring, &samples, channels, rate);
        })
        .register()
    else {
        return lost("listener registration failed");
    };

    if let Err(err) = stream.connect(
        spa::utils::Direction::Input,
        None,
        pw::stream::StreamFlags::AUTOCONNECT
            | pw::stream::StreamFlags::MAP_BUFFERS
            | pw::stream::StreamFlags::RT_PROCESS,
        &mut params,
    ) {
        tracing::error!(%err, "desktop audio stream connect failed");
        return lost("stream connect failed");
    }

    // Blocks until stop — the mainloop dispatches on OUR thread only.
    while !stop.load(Ordering::Relaxed) {
        mainloop
            .loop_()
            .iterate(pw::loop_::Timeout::Finite(STOP_POLL));
    }

    // Declaration order above: mainloop, context, core, stream,
    // listener — reverse drop unwinds listener → stream → core →
    // context → mainloop (callbacks unregistered before their objects).
    drop(listener);
    drop(stream);
    drop(core);
    drop(context);
    drop(mainloop);
}
