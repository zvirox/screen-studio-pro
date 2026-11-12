use super::audio::{MIX_WINDOW_SAMPLES, MeterReading, MixSource};
use super::stats::{EventSink, SessionEvent, StatsMeter, Throttle};
use crate::capture::CameraHandle;
use crate::capture::audio::AudioProducer;
use crate::capture::preview::PreviewMailbox;
use crate::encode::sw_aac::{self, SwAac};
use crate::encode::sw_x264::SwX264;
use crate::encode::{AudioEncoder, EncodedPacket, Encoder};
use crate::pipeline::composite::{PipShape, overlay_camera};
use crate::pipeline::muxer::{AudioSpec, Muxer, MuxerBuilder, VideoSpec};
use crate::util::error::CoreError;
use ffmpeg_next as ff;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use super::FrameBus;

use serde::{Deserialize, Serialize};

/* Recording session (PLAN 1.3) — the consumer half of the 1.2 FrameBus:
bus → encoder → muxer on one dedicated worker thread. Laws implemented:
- §6 "buses, not copies": the session OWNS its drain cursor alone; the
  producer (PipeWire data thread, capture/pipewire.rs) keeps pushing for
  the source's lifetime, so stopping a recording must NOT close the bus.
  Stop is this module's own shutdown latch + a bounded drain (the
  latch-time backlog is snapshotted and encoded as the take's tail —
  the latch fires on Stop, not "when the ring empties", which a live
  producer can prevent indefinitely).
- §6 cadence law: progress logs at 1 Hz, never per frame.
- ARCHITECTURE §4.2: worker faults return typed CoreError and surface at
  `recording_stop` (the error event stream joins in 1.4); nothing panics
  the worker outside the JoinHandle contract.
- API §6 standing flag: frames/bytes stay in this process — the only IPC
  payloads are the ids/stamps/paths below. */

/// Consumer poll interval while the bus is empty (§6: never busy-loop,
/// never add visible latency to stop — 2 ms ≈ imperceptible).
const IDLE_POLL: Duration = Duration::from_millis(2);

/// Default frame rate offered to the encoder (PRD M8/§7.5: 60 first; the
/// M10 setting joins with the Record view).
const FRAME_RATE: (u32, u32) = (60, 1);

/// PLAN 1.3 wired name (naming-pattern expansion is task 6.2/FILES).
const BASE_FILE_STEM: &str = "first-rec";

/// `recording/tick` cadence — API §3 rate law: 1 Hz.
const TICK_PERIOD: Duration = Duration::from_secs(1);

/// `recording/stats` cadence — API §3 rate law: 0.5 Hz (every 2 s).
const STATS_PERIOD: Duration = Duration::from_secs(2);

/// The audio anchor waits at most this long for the video worker to
/// publish its first-frame wall stamp (§5b A/V sync law: audio never
/// leads video). Past the bound (a dead video source under a live audio
/// one) the take is already failing — continue with anchor 0 rather
/// than parking the audio worker forever: per-stream monotonic pts is
/// all matroska requires.
const AUDIO_ANCHOR_WAIT: Duration = Duration::from_secs(2);

/// `recording/meters` period — API §3 rate law: ≤30 Hz, coalesced in
/// Rust. 34 ms ≈ 29.4 Hz: under the ceiling even at peak window supply
/// (the mixer produces windows at ~100 Hz; the gate keeps the latest).
const METERS_PERIOD: Duration = Duration::from_millis(34);

/// How long a live meter reading holds before the bars decay to zero
/// once every ring runs dry (see the audio worker: flicker guard).
const METER_HOLD: Duration = Duration::from_millis(250);

/// The container's AAC stream opens with the composition shape every
/// capture input is folded into (capture::audio: 48 kHz stereo f32;
/// PRD M10). One pre-mixed stereo track — plan 2.1, never N tracks.
fn composition_audio_spec() -> AudioSpec {
    AudioSpec {
        codec: ff::codec::Id::AAC,
        sample_rate: crate::capture::audio::SAMPLE_RATE,
        channel_layout: ff::ChannelLayout::STEREO,
        sample_fmt: ff::format::Sample::F32(ff::format::sample::Type::Planar),
        bit_rate: sw_aac::AAC_BIT_RATE,
    }
}

/// Everything the ipc layer assembles at `recording_start` (2.1 Phase F)
/// and hands to the session: the live capture guards (kept outside the
/// workers so a stop drops them once the take is over) and the mix
/// topology the audio worker folds by. Tests pass `producers: vec![]`
/// and feed the rings directly from feeder threads.
pub struct AudioPlan {
    pub producers: Vec<AudioProducer>,
    pub channels: Vec<MixSource>,
    /// The library row's `audio_json` fact (DATABASE §2.1), rendered by
    /// the ipc layer from the same settings snapshot that built the
    /// plan; the session stores it opaquely and hands it back with the
    /// stop outcome (write-only until the library view lands).
    pub row_note: Option<String>,
}

/// One hop from the audio worker to the video worker: encoded AAC
/// packets, or the worker's fatal fault (a device-gone event is NOT a
/// fault — it is reported by the worker directly and the take goes on).
enum AudioMsg {
    Packets(Vec<EncodedPacket>),
    Fault(CoreError),
}

/// The audio worker's receive half + its join guard, owned by the video
/// worker while the take runs. An `Err` capture path leaves the leg
/// intact so `run_session` can reap the worker on every exit path.
struct AudioLeg {
    packets: mpsc::Receiver<AudioMsg>,
    worker: Option<std::thread::JoinHandle<Result<(), CoreError>>>,
}

/// Wall-clock µs (recording-relative anchoring only — the same stamp the
/// video frames carry, capture/pipewire.rs's clock).
fn wall_us() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

/// The emitted reading for one channel: the held value while its ring
/// delivered a sample within `hold`, otherwise SILENT (2.2 decay law —
/// bars fall to zero on a pause or a dead device, never freeze).
fn effective_meter(
    reading: MeterReading,
    live: Option<Instant>,
    now: Instant,
    hold: Duration,
) -> MeterReading {
    match live {
        Some(l) if now.duration_since(l) <= hold => reading,
        _ => MeterReading::SILENT,
    }
}

/// The audio worker: rings → 10 ms mix windows → AAC chunks → the video
/// worker's mux loop. Laws implemented:
/// - One PRE-MIXED stereo track (plan 2.1): fold happens here, before
///   encode — never N audio streams in the container.
/// - §6 backpressure: `try_send` only, never blocks. A full channel is
///   retried briefly (the mux loop is the faster side in practice);
///   a DISCONNECTED one means the video worker is gone — exit quietly,
///   the take is already over.
/// - Device-lost law (API §3): a disabled ring renders ONE non-fatal
///   `pipewire.audio_device_gone` event per channel; the take continues
///   with that channel silent (windows still pad it to the mix length).
/// - Anchor law: the first content window is stamped against the video
///   worker's first-frame wall stamp, so audio can never lead video
///   (§5b). AAC chunks are stamped by their SAMPLE index over the
///   anchor — the exact rounded µs clock (`pts_us_to_samples` inverts).
#[allow(clippy::too_many_arguments)]
fn run_audio_worker(
    opened: ff::encoder::Audio,
    channels: Vec<MixSource>,
    video_base: Arc<AtomicU64>,
    video_anchored: Arc<AtomicBool>,
    tx: mpsc::SyncSender<AudioMsg>,
    stop: Arc<AtomicBool>,
    events: Arc<dyn EventSink>,
    pause: PauseState,
) -> Result<(), CoreError> {
    let mut aac = SwAac::from_open(opened);
    let frames_per_chunk = aac.frame_size(); // AAC: 1024 samples per channel
    let chunk_samples = frames_per_chunk * 2; // interleaved stereo
    let sample_rate = crate::capture::audio::SAMPLE_RATE;
    // The unbroken sample-count clock: chunk k sits at its exact rounded
    // µs stamp over the anchor (verified round-trippable in sw_aac):
    // pts = anchor + (k·frames·1e6 + rate/2) / rate.
    let chunk_pts = |k: i128, base: i64| -> i64 {
        let pts = (k * 1_000_000 * (frames_per_chunk as i128) + i128::from(sample_rate) / 2)
            / i128::from(sample_rate);
        base.saturating_add(i64::try_from(pts).unwrap_or(i64::MAX))
    };
    let mut chunk_index: i64 = 0;
    let mut anchor: Option<i64> = None;
    let mut accum: Vec<f32> = Vec::new();
    let mut reported_gone = vec![false; channels.len()];
    // 2.2 meters: the latest POST-gain reading per wire channel, merged
    // into the fixed two-key payload and coalesced at the API §3 ceiling
    // (≤30 Hz — 34 ms keeps every burst under the bound). Coalescing
    // happens HERE: ARCHITECTURE §6 puts rate limits on the Rust side,
    // never in the webview. Readings START silent and DECAY back to
    // silent while the rings run dry (the loop-top gate keeps firing).
    let mut meter_gate = Throttle::new(METERS_PERIOD);
    // Per-channel meter state: held reading + the wall instant its ring
    // last DELIVERED samples. Indexed 0 = mic, 1 = desktop (both keys are
    // always on the wire, API §3).
    // 2.2 flicker law: a pass over an EMPTY pop holds the reading — feed
    // jitter (a 20 ms producer under a 10 ms drain) must not snap the bar
    // to zero between deliveries. Decay past METER_HOLD happens at the
    // gate, so a paused (or dead) channel's bar falls instead of freezing.
    let mut state: [(MeterReading, Option<Instant>); 2] =
        [(MeterReading::SILENT, None), (MeterReading::SILENT, None)];

    // Bounded send: the mux side drains faster than the AAC side
    // produces in every healthy path; a FULL channel gets a short retry
    // window before the take is failed (§6: the producer never blocks
    // indefinitely). Ok(false) = video worker gone (take already over).
    let send_packets =
        |tx: &mpsc::SyncSender<AudioMsg>, packets: Vec<EncodedPacket>| -> Result<bool, CoreError> {
            for _ in 0..250 {
                match tx.try_send(AudioMsg::Packets(packets.clone())) {
                    Ok(()) => return Ok(true),
                    Err(mpsc::TrySendError::Full(_)) => {
                        std::thread::sleep(IDLE_POLL);
                    }
                    Err(mpsc::TrySendError::Disconnected(_)) => return Ok(false),
                }
            }
            Err(CoreError::encoder(
                "encoder.encode_failed",
                false,
                "Audio writing fell too far behind the recording.",
            ))
        };

    loop {
        // Cadence first: the meter gate fires on the wall clock, so the
        // strip keeps its documented rate even when a channel goes
        // quiet (the readings decay to SILENT — bars fall to zero).
        let now = Instant::now();
        if meter_gate.due(now) {
            events.emit(SessionEvent::Meters {
                mic: effective_meter(state[0].0, state[0].1, now, METER_HOLD),
                desktop: effective_meter(state[1].0, state[1].1, now, METER_HOLD),
            });
        }
        // Device-lost events first: a disabled channel renders its ONE
        // event and the take goes on with that channel silent.
        for (i, channel) in channels.iter().enumerate() {
            if !reported_gone[i] && channel.ring.is_disabled() {
                reported_gone[i] = true;
                events.emit(SessionEvent::Error(CoreError::pipewire(
                    "pipewire.audio_device_gone",
                    true,
                    "An audio source stopped responding. The recording continues with the remaining audio.",
                )
                .to_ipc()));
            }
        }
        if stop.load(Ordering::Acquire) {
            break;
        }
        // 2.3 pause gate: a paused take records NOTHING. The rings are
        // still drained (§6 backpressure — the producers keep pushing),
        // but the samples are discarded, the anchor is not computed and
        // NO meter liveness is refreshed — the sample-count clock never
        // advances through a pause (that IS the audio continuity), and
        // the post-gain bars decay past the hold (loop-top gate) because
        // the gate below stops feeding it. The PRE-pause anchor, if one
        // was already computed, survives untouched — chunks resume at
        // the sample where the pause found them.
        if pause.is_active() {
            let _ = super::audio::mix_rings(&channels, MIX_WINDOW_SAMPLES);
            std::thread::sleep(IDLE_POLL);
            continue;
        }
        let pass = super::audio::mix_rings(&channels, MIX_WINDOW_SAMPLES);
        if pass.samples.is_empty() {
            // All rings dry: the gate above keeps decaying held readings
            // past the hold, and parking here never spins (§6).
            std::thread::sleep(IDLE_POLL);
            continue;
        }
        // Post-gain meter law (2.2): each reading reflects ONLY its own
        // channel. A pop with samples refreshes the channel's liveness
        // and takes the new reading (even a legitimately silent one — a
        // muted-but-alive channel stays at zero while ringing the hold);
        // an empty pop holds, per the flicker law at the state decl. A
        // channel whose device died stops delivering, so its bar falls
        // after the hold instead of freezing.
        for ((source, reading), popped) in channels.iter().zip(&pass.meters).zip(&pass.popped) {
            if *popped > 0 {
                let slot = match source.channel {
                    crate::capture::audio::AudioChannel::Mic => 0,
                    crate::capture::audio::AudioChannel::Desktop => 1,
                };
                state[slot] = (*reading, Some(now));
            }
        }
        accum.extend_from_slice(&pass.samples);
        if anchor.is_none() {
            // §5b: the audio clock may never lead the video clock — the
            // anchor is the first window minus the video's first-frame
            // wall stamp, waited for up to the bound (never spun on).
            // The SENTINEL is the `video_anchored` flag, not a nonzero
            // value: a producer's first frame can legitimately carry
            // pt 0 (a 2.1 bug this 2.2 instrumentation exposed — base 0
            // read as "not set", every take waited out the deadline and
            // stamped audio against the absolute wall clock). A stop
            // during the wait exits via the loop's stop check — the
            // drain is never parked for the full bound.
            let content_wall = wall_us();
            let deadline = Instant::now() + AUDIO_ANCHOR_WAIT;
            let base = loop {
                if video_anchored.load(Ordering::Acquire) {
                    break Some(video_base.load(Ordering::Acquire));
                }
                if stop.load(Ordering::Acquire) {
                    break None; // take over — anchor 0 lets the tail flush
                }
                if Instant::now() >= deadline {
                    tracing::warn!("audio anchor waited out the video base; stamping from 0");
                    break None;
                }
                std::thread::sleep(IDLE_POLL);
            };
            anchor = Some(match base {
                Some(base) if base != 0 => content_wall.saturating_sub(base) as i64,
                // A 0 stamp from the producer clock (test harnesses can
                // legitimately push pt 0) cannot anchor against the wall
                // clock — relative-from-zero is the honest fallback.
                _ => 0,
            });
        }
        while accum.len() >= chunk_samples {
            let chunk: Vec<f32> = accum.drain(..chunk_samples).collect();
            let pts = chunk_pts(i128::from(chunk_index), anchor.unwrap_or(0));
            chunk_index += 1;
            match aac.encode(pts, &chunk) {
                Ok(packets) => {
                    if !send_packets(&tx, packets)? {
                        // Video worker gone — the take is over; exit
                        // without faulting (its fault already reported).
                        return Ok(());
                    }
                }
                Err(err) => {
                    let _ = tx.try_send(AudioMsg::Fault(err));
                    return Err(CoreError::encoder(
                        "encoder.encode_failed",
                        false,
                        "Audio encoding failed while writing the recording.",
                    ));
                }
            }
        }
    }

    // Stop path: pad the leftover partial chunk with silence so the
    // take's final audio moment is never dropped, flush the codec, and
    // exit — the video worker drains whatever lands plus the EOF flush.
    if !accum.is_empty() {
        let pts = chunk_pts(i128::from(chunk_index), anchor.unwrap_or(0));
        accum.resize(chunk_samples, 0.0);
        let padded = std::mem::take(&mut accum);
        let packets = aac.encode(pts, &padded)?;
        let _ = send_packets(&tx, packets);
    }
    let tail = aac.finish()?;
    let _ = send_packets(&tx, tail);
    Ok(())
}

/// Drains the audio hop after the video loop ends: bounded (~2 s) so a
/// wedged audio worker can never hang `recording_stop`, pulling every
/// packet still queued into the muxer BEFORE the trailer (the AAC tail
/// is part of the take), then joining the worker. Returns the take's
/// first audio fault, if any.
fn reap_audio(leg: &mut AudioLeg, mux: Option<&mut Muxer>) -> Option<CoreError> {
    let mut mux = mux;
    let mut fault: Option<CoreError> = None;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match leg
            .packets
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            Ok(AudioMsg::Packets(packets)) => {
                if let Some(mux) = mux.as_deref_mut()
                    && let Err(err) = mux.write(&packets)
                {
                    tracing::error!(code = %err.code(), "audio tail write failed");
                }
            }
            Ok(AudioMsg::Fault(err)) => {
                tracing::error!(code = %err.code(), "audio worker faulted");
                fault.get_or_insert(err);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                tracing::warn!("audio worker drain timed out; audio tail truncated");
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if let Some(worker) = leg.worker.take() {
        match worker.join() {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                fault.get_or_insert(err);
            }
            Err(panic) => {
                tracing::error!(?panic, "audio worker panicked");
                fault.get_or_insert(CoreError::encoder(
                    "encoder.encode_failed",
                    false,
                    "The audio encoder failed while writing the recording.",
                ));
            }
        }
    }
    fault
}

/// Data the ipc layer turns into the API §2.3 `recording_start` reply.
#[derive(Debug, Clone)]
pub struct StartInfo {
    pub recording_id: String,
    pub encoder: crate::encode::EncoderInfo,
    pub started_at: String,
}

/// What the worker reports about a finished take — the facts the file
/// itself carries (no clock, no encoder identity).
#[derive(Debug, Clone)]
pub struct TakeFacts {
    pub path: PathBuf,
    pub duration_ms: u64,
    pub size_bytes: u64,
    /// Encoded dimensions (even-clamped).
    pub width: u32,
    pub height: u32,
    /// The muxed stream's frame rate.
    pub fps: u32,
}

/// What `recording_stop` reports (DB row upsert joins in 1.6 — no id yet).
#[derive(Debug, Clone)]
pub struct StopOutcome {
    pub path: PathBuf,
    pub duration_ms: u64,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub encoder: crate::encode::EncoderInfo,
    /// RFC-3339 start stamp — the library row's `created_at` (1.6).
    pub started_at: String,
    /// RFC-3339 finalize stamp — the library row's `updated_at` (1.6).
    pub finished_at: String,
    /// The take's audio description for the DB row (DATABASE §2.1
    /// `audio_json`), rendered by the ipc layer at start. `None` = a
    /// video-only take, row column stays NULL.
    pub audio_json: Option<String>,
    /// 2.5: the take's chapter markers (flow 7.2), serialized at stop.
    /// `None` = no flags on the take; row column stays NULL.
    pub chapter_json: Option<String>,
}

/// Managed state: at most one active recording (the bad_state rule of
/// API §2.3). Mirrors CaptureHandle's plain-slot discipline: a poisoned
/// lock resumes plain data (§6.4).
pub struct RecordingHandle {
    active: Mutex<Option<ActiveRecording>>,
}

struct ActiveRecording {
    recording_id: String,
    /// The start facts (encoder identity + start stamp) — the stop reply
    /// and the `recording/finished` projection need them.
    info: StartInfo,
    /// Stop latch — set by `stop`, observed by the worker's idle poll.
    stop: Arc<AtomicBool>,
    /// Set by the worker when the take ends by itself (a mid-take fault).
    /// A faulted worker must not block the next take — the error event
    /// already told the UI the take is over.
    ended: Arc<AtomicBool>,
    /// None = already joined by a previous stop (defensive; stop takes
    /// the whole ActiveRecording out so this never happens per contract).
    worker: Option<std::thread::JoinHandle<Result<TakeFacts, CoreError>>>,
    /// The live capture guards for the audio channels (2.1): held OUTSIDE
    /// the workers — dropping them (stop / reap) ends the capture threads.
    /// The audio worker only sees Arc<AudioRing> clones, so dropping these
    /// after the join is always safe.
    audio_producers: Vec<AudioProducer>,
    /// The take's audio-row note (DATABASE §2.1 audioJson), rendered by
    /// the ipc layer at start; handed back with the stop outcome.
    audio_json: Option<String>,
    /// 2.3 pause gate — shared with both workers; transitions (pause/
    /// resume) happen HERE under the slot lock, workers only read.
    pause: PauseState,
    /// 2.5 chapter/flag markers collected at flag time (flow 7.2). Held in-
    /// memory for the take's life, serialized to the library row at stop.
    chapters: Arc<Mutex<Vec<ChapterMarker>>>,
    /// Container format from settings ("mkv" | "mp4" | "webm") — decides
    /// whether the finalized MKV is remuxed at stop (6.2).
    container: String,
}

/// One flag marker on a take (API §3 `recording/flagged` chapter). The offset
/// is the take's recording-relative time, i.e. `elapsed_ms` at flag time —
/// the same recording clock the `recording/tick` `elapsedMs` carries.
/// DATABASE.md §2.1 documents `offset_ms` (snake_case) in chapter_json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChapterMarker {
    pub offset_ms: u64,
    pub label: String,
}

/// 4.3: configuration for compositing the camera PiP into the encode.
/// The pipeline is Tauri-agnostic: it receives the stills mailbox (not
/// the CameraHandle) and a position/size/shape derived from the UI.
#[derive(Clone)]
pub struct CameraOverlayConfig {
    pub mailbox: Option<Arc<PreviewMailbox>>,
    /// PiP width in output pixels (160–320, default 240).
    pub pip_size: u32,
    /// Snap margin in output pixels (default 24).
    pub pip_margin: u32,
    /// `r.full` circle (4.2 default) / `r.lg` rounded.
    pub pip_shape: PipShape,
    /// self-insert flag from settings — default false.
    pub enabled: bool,
}

impl Default for CameraOverlayConfig {
    fn default() -> Self {
        Self {
            mailbox: None,
            pip_size: 240,
            pip_margin: 24,
            pip_shape: PipShape::Circle,
            enabled: false,
        }
    }
}

/// The 2.3 pause gate (PLAN 2.3). Laws:
/// - The pause is measured in WALL µs — the same clock the video pts are
///   stamped in, so the take's rel timeline (raw − base − paused_total)
///   excludes the pause exactly by construction and never regresses
///   (saturating everywhere; a wall step mid-pause shortens BOTH the
///   interval and the raw span it explains).
/// - Transitions run under the ipc slot lock; the workers read `active`
///   as a fast atomic and the accumulator under the mutex (60 Hz / 1 Hz
///   readers — uncontended, §6 never blocks a capture path on it).
/// - The AUDIO clock needs none of this: its pts are a sample count, so
///   not encoding while paused IS the continuity (A/V stay in step
///   because both clocks freeze for the same real interval).
#[derive(Clone)]
struct PauseState {
    /// Worker-side gate: true while paused (Release on resume AFTER the
    /// accumulator is updated, so a reader that observes unpaused also
    /// observes the full total — Acquire pairs with it).
    active: Arc<AtomicBool>,
    track: Arc<Mutex<PauseTrack>>,
}

#[derive(Debug, Clone)]
struct PauseTrack {
    /// The take's t0 in wall µs — the tick elapsed's basis (frozen during
    /// a pause: `up_to − start − total` where `up_to` is the pause's
    /// start wall instead of now while paused).
    start_wall_us: u64,
    /// Wall stamp when the current pause began; None while recording.
    since_wall_us: Option<u64>,
    /// Accumulated paused wall µs (complete intervals only).
    total_wall_us: u64,
}

impl PauseState {
    fn new(start_wall_us: u64) -> Self {
        Self {
            active: Arc::new(AtomicBool::new(false)),
            track: Arc::new(Mutex::new(PauseTrack {
                start_wall_us,
                since_wall_us: None,
                total_wall_us: 0,
            })),
        }
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    /// Enter the pause. Returns false when already paused (the caller
    /// turns that into the §2.3 `ipc.bad_state`). `now` = wall µs.
    fn pause(&self, now: u64) -> bool {
        if self.active.swap(true, Ordering::AcqRel) {
            return false;
        }
        self.track
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .since_wall_us = Some(now);
        true
    }

    /// Leave the pause, banking the interval into the accumulator.
    /// Returns false when not paused (§2.3 "not paused" bad_state).
    fn resume(&self, now: u64) -> bool {
        {
            let mut track = self
                .track
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(since) = track.since_wall_us else {
                return false;
            };
            track.total_wall_us += now.saturating_sub(since);
            track.since_wall_us = None;
        }
        self.active.store(false, Ordering::Release);
        true
    }

    /// `recording/tick`'s `elapsedMs` — RECORDING time (the pause is
    /// excluded, API §3 2.3 note) and FROZEN while paused (the `up_to`
    /// value stops at the pause's start wall, deterministic per tick).
    fn elapsed_ms(&self, now: u64) -> u64 {
        let track = self
            .track
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let up_to = if track.since_wall_us.is_some() {
            track.since_wall_us.unwrap_or(now)
        } else {
            now
        };
        up_to
            .saturating_sub(track.start_wall_us)
            .saturating_sub(track.total_wall_us)
            / 1000
    }

    /// The frame pts shift (video worker, once per accepted frame).
    fn total_us(&self) -> u64 {
        self.track
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .total_wall_us
    }
}

impl ActiveRecording {
    /// Serialize the accumulated markers for the library row at stop
    /// (DATABASE §2.1 `chapter_json`). Empty -> `None` (column stays NULL).
    fn chapters_json(&self) -> Option<String> {
        let chapters = self
            .chapters
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if chapters.is_empty() {
            return None;
        }
        serde_json::to_string(&*chapters).ok()
    }
}

impl RecordingHandle {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    /// Starts a recording session on the given bus. Fails `ipc.bad_state`
    /// if a recording is already active, per API §2.3. The muxer header
    /// is written synchronously (fast) so encoder/path problems surface
    /// in the `recording_start` reply, not only at stop.
    ///
    /// `events` receives the session's event stream (API §3: tick 1 Hz,
    /// stats 0.5 Hz, error on fault). The pipeline stays Tauri-agnostic:
    /// the IPC layer injects the Tauri-backed sink.
    ///
    /// `audio` carries the 2.1 audio plan (capture guards + mix
    /// topology); `None` = video-only take (the 1.3 shape, still what
    /// every pre-audio test exercises).
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        bus: Arc<FrameBus>,
        dims: (u32, u32),
        dir: &Path,
        naming_pattern: &str,
        container: &str,
        events: Arc<dyn EventSink>,
        audio: Option<AudioPlan>,
        region_rect: Option<crate::capture::RegionRect>,
        camera_id: Option<String>,
        app: Option<&tauri::AppHandle>,
    ) -> Result<StartInfo, CoreError> {
        let mut slot = self.locked();
        // A worker that ended on its own (a mid-take fault) must not
        // block the next take — reap it and free the slot.
        self.reap_finished(&mut slot);
        if slot.is_some() {
            return Err(bad_state(
                "A recording is already running. Stop it before starting another.",
            ));
        }
        let recording_id = new_recording_id();

        // yuv420p is 2×2-subsampled — even-dim clamp here too so the
        // muxer's header and the encoder's output always agree.
        let dims = (dims.0 & !1, dims.1 & !1);

        // Encoder + quality preset from the SETTINGS SNAPSHOT (M8/M11;
        // ARCHITECTURE §4.1: the take resolves its targets at start).
        // The preset's height cap wins; the source is never upscaled.
        let (encoder_name, preset, camera_self_insert) = if let Some(app) = app {
            let settings = app
                .state::<Mutex<crate::settings::SettingsStore>>()
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .get()
                .clone();
            (
                settings.capture.encoder,
                crate::pipeline::presets::resolve(&settings.capture.quality_preset),
                settings.capture.camera_self_insert,
            )
        } else {
            (
                "auto".to_string(),
                crate::pipeline::presets::resolve("youtube"),
                false,
            )
        };
        let dims = crate::pipeline::presets::output_size(dims, &preset);

        // 4.3: camera overlay config. Mailbox looked up from CameraHandle;
        // self-insert from settings. Defaults: bottom-right, margin 24,
        // size 240, circle. Disabled unless camera_self_insert is true and
        // a camera is open.
        let camera_overlay = if camera_self_insert {
            if let Some(app) = app {
                let camera = app.state::<CameraHandle>();
                let mailbox = camera_id
                    .as_deref()
                    .and_then(|id| camera.mailbox_if_matches(id));
                Some(CameraOverlayConfig {
                    mailbox,
                    pip_size: 240,
                    pip_margin: 24,
                    pip_shape: PipShape::Circle,
                    enabled: true,
                })
            } else {
                None
            }
        } else {
            None
        };

        // Muxer spec: the codec ID is always H264; the backend is chosen
        // at encoder open time (select_encoder handles NVENC/VAAPI/x264).
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: dims.0,
            height: dims.1,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (preset.fps, 1),
            options: crate::pipeline::presets::x264_options(&preset),
        };
        let path = next_output_path(dir, naming_pattern, container);
        // A/V split (2.1): the container opens through the builder —
        // video always; the AAC stream only when an audio plan exists.
        // (Muxer::open_video cannot add a second stream; write_header
        // is what freezes the stream table.)
        let AudioPlan {
            producers,
            channels,
            row_note,
        } = audio.unwrap_or(AudioPlan {
            producers: Vec::new(),
            channels: Vec::new(),
            row_note: None,
        });
        let has_audio = !channels.is_empty();
        let builder = MuxerBuilder::create(&path)?;
        let (builder, _video_opened) = builder.add_video(&spec)?;
        let (builder, audio_opened) = if has_audio {
            let (builder, opened) = builder.add_audio(&composition_audio_spec())?;
            (builder, Some(opened))
        } else {
            (builder, None)
        };
        let _mux = builder.write_header()?;

        // Encoder selection (M8): auto NVENC → VAAPI → x264, with fallback.
        let encoder_opts = crate::pipeline::presets::x264_options(&preset);
        let encoder_info = crate::encode::select_encoder(&encoder_name, dims, encoder_opts)?;

        // Reply facts must be captured before the encoder moves into the
        // worker thread (the encoder info is static, the id/clock are not).
        let info = StartInfo {
            recording_id: recording_id.clone(),
            encoder: encoder_info,
            started_at: crate::util::time::rfc3339_now(),
        };

        let stop = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        let video_base = Arc::new(AtomicU64::new(0));
        // The anchor's SENTINEL flag — separate from the value because a
        // first-frame pt of 0 is legal (see the audio worker's anchor law).
        let video_anchored = Arc::new(AtomicBool::new(false));
        // 2.3: the pause gate is born with the take; the ipc layer holds
        // a clone on ActiveRecording, both workers hold their own.
        let pause = PauseState::new(wall_us());
        // ARCHITECTURE §6: the portal keeps producing between takes. Drop
        // the bounded idle backlog before handing this sole consumer slot
        // to the new worker, or old frames anchor the new A/V clock in the
        // previous take. Never drain-until-empty against a live producer.
        for _ in 0..bus.len() {
            let _ = bus.try_pop();
        }
        let (audio_tx, audio_rx) = mpsc::sync_channel::<AudioMsg>(64);
        let ctx = SessionContext {
            recording_id: recording_id.clone(),
            dims,
            events: events.clone(),
            ended: ended.clone(),
        };
        // The audio worker starts FIRST: it may begin folding the moment
        // producers push; until the video worker stamps video_base it
        // parks on the bounded anchor wait (by design).
        let audio_leg = match audio_opened {
            Some(opened) => {
                // Clone BEFORE the move-closure: the closure takes these
                // by value and the slot below still needs its own copies.
                let base_for_audio = video_base.clone();
                let anchored_for_audio = video_anchored.clone();
                let stop_for_audio = stop.clone();
                let events_for_audio = events.clone();
                let pause_for_audio = pause.clone();
                let handle = std::thread::Builder::new()
                    .name("recording-audio".into())
                    .spawn(move || {
                        run_audio_worker(
                            opened,
                            channels,
                            base_for_audio,
                            anchored_for_audio,
                            audio_tx,
                            stop_for_audio,
                            events_for_audio,
                            pause_for_audio,
                        )
                    })
                    .map_err(|err| {
                        // The header was already written; the take cannot
                        // start — one typed spawn failure surfaces and the
                        // locals (producers included) unwind here, so no
                        // capture thread outlives the rejected start.
                        tracing::error!(error = %err, "audio worker spawn failed");
                        CoreError::encoder(
                            "encoder.init_failed",
                            false,
                            "The recording worker could not start.",
                        )
                    })?;
                Some(AudioLeg {
                    packets: audio_rx,
                    worker: Some(handle),
                })
            }
            None => None,
        };
        let worker_stop = stop.clone();
        let worker_base = video_base.clone();
        let worker_anchored = video_anchored.clone();
        let worker_pause = pause.clone();
        let worker_region_rect = region_rect;
        let worker_preset = preset;
        let worker = std::thread::Builder::new()
            .name("recording-encoder".into())
            .spawn(move || {
                // Create the x264 encoder inside the worker thread.
                let spec = VideoSpec {
                    codec: ff::codec::Id::H264,
                    width: dims.0,
                    height: dims.1,
                    pix_fmt: ff::format::Pixel::YUV420P,
                    frame_rate: (worker_preset.fps, 1),
                    options: crate::pipeline::presets::x264_options(&worker_preset),
                };
                let builder = MuxerBuilder::create(&path)?;
                let (builder, video_opened) = builder.add_video(&spec)?;
                let mux = builder.write_header()?;
                let encoder = SwX264::from_open(video_opened);

                run_session(
                    mux,
                    encoder,
                    bus,
                    worker_stop,
                    ctx,
                    audio_leg,
                    worker_base,
                    worker_anchored,
                    worker_pause,
                    worker_region_rect,
                    worker_preset,
                    camera_overlay.unwrap_or_default(),
                )
            })
            .map_err(|err| {
                tracing::error!(error = %err, "recording worker spawn failed");
                CoreError::encoder(
                    "encoder.init_failed",
                    false,
                    "The recording worker could not start.",
                )
            })?;

        *slot = Some(ActiveRecording {
            recording_id: recording_id.clone(),
            info: info.clone(),
            stop,
            ended,
            worker: Some(worker),
            audio_producers: producers,
            audio_json: row_note,
            pause,
            chapters: Arc::new(Mutex::new(Vec::new())),
            container: container.to_string(),
        });
        Ok(info)
    }

    /// Reaps a worker that ended by itself (a mid-take fault) so the next
    /// take can start. The fault was already pushed as an event — the
    /// reaping only collects the worker's result (tracing, §7.9).
    fn reap_finished(&self, slot: &mut Option<ActiveRecording>) {
        let ended = slot
            .as_ref()
            .map(|active| active.ended.load(Ordering::Acquire))
            .unwrap_or(false);
        if !ended {
            return;
        }
        let finished = slot.take().expect("slot held a recording");
        let Some(worker) = finished.worker else {
            return;
        };
        match worker.join() {
            Ok(Ok(_facts)) => tracing::warn!("a recording ended without a stop request"),
            Ok(Err(err)) => {
                tracing::error!(code = %err.code(), "recording worker ended with a fault")
            }
            Err(panic) => tracing::error!(?panic, "recording worker panicked"),
        }
    }

    /// 2.3 (API §2.3): latch the pause on the active recording. Outer
    /// `Err` = contract `ipc.bad_state` — nothing running / id mismatch /
    /// already paused (the §2.3 "not recording" class at 409).
    pub fn pause(&self, recording_id: &str) -> Result<(), CoreError> {
        let mut slot = self.locked();
        // A worker that ended by itself is gone — pause is a state of a
        // LIVE take (the reaper frees the slot, the reply is bad_state).
        self.reap_finished(&mut slot);
        let Some(active) = slot.as_ref() else {
            return Err(bad_state("No recording is running with that id."));
        };
        if active.recording_id != recording_id {
            return Err(bad_state("No recording is running with that id."));
        }
        if !active.pause.pause(wall_us()) {
            return Err(bad_state("The recording is already paused."));
        }
        Ok(())
    }

    /// Shell snapshot, read on the serialized lifecycle worker; no UI polling.
    pub fn snapshot(&self) -> Option<(String, bool, bool)> {
        self.locked().as_ref().map(|active| {
            (
                active.recording_id.clone(),
                active.pause.active.load(Ordering::Acquire),
                active.ended.load(Ordering::Acquire),
            )
        })
    }

    /// 2.3 (API §2.3): leave the pause. `ipc.bad_state` when nothing is
    /// running, the id mismatches, or the take is not paused.
    pub fn resume(&self, recording_id: &str) -> Result<(), CoreError> {
        let mut slot = self.locked();
        self.reap_finished(&mut slot);
        let Some(active) = slot.as_ref() else {
            return Err(bad_state("No recording is running with that id."));
        };
        if active.recording_id != recording_id {
            return Err(bad_state("No recording is running with that id."));
        }
        if !active.pause.resume(wall_us()) {
            return Err(bad_state("The recording is not paused."));
        }
        Ok(())
    }

    /// Stops (and joins) the active recording. Outer `Err` = contract
    /// `ipc.bad_state` (nothing active / id mismatch); inner `Result` is
    /// the take's own fate (mux disk faults, mid-take codec faults).
    pub fn stop(&self, recording_id: &str) -> Result<Result<StopOutcome, CoreError>, CoreError> {
        let mut slot = self.locked();
        let Some(active) = slot.as_mut() else {
            return Err(bad_state("No recording is running with that id."));
        };
        if active.recording_id != recording_id {
            // Not ours — the session itself is unaffected (the recording
            // stays in the slot; the caller may have hit a racing id typo).
            return Err(bad_state("No recording is running with that id."));
        }
        // Latch the stop while the slot is held.
        active.stop.store(true, Ordering::Release);
        let info = active.info.clone();
        let audio_json = active.audio_json.clone();
        let chapter_json = active.chapters_json();
        let container = active.container.clone();
        let worker = active.worker.take().expect("stop owns the only join");
        // The join happens with the slot STILL occupied: a concurrent
        // start must not spawn a second consumer on the same SPSC bus
        // (pipeline/mod.rs single-consumer law).
        //
        // JoinError = worker panic (a bug) → encoder family, payload
        // logged, raw strings never reach the UI (§7.9).
        let join = worker.join();
        // The take is over — the slot is free again.
        *slot = None;
        match join {
            Ok(Ok(mut facts)) => {
                // 6.2: remux MKV→MP4 if container is mp4; delete MKV after.
                if container == "mp4" {
                    let mp4_path = remux_mkv_to_mp4(&facts.path)?;
                    let _ = std::fs::remove_file(&facts.path);
                    facts.path = mp4_path;
                }
                Ok(Ok(StopOutcome {
                    path: facts.path,
                    duration_ms: facts.duration_ms,
                    size_bytes: facts.size_bytes,
                    width: facts.width,
                    height: facts.height,
                    fps: facts.fps,
                    encoder: info.encoder,
                    started_at: info.started_at,
                    finished_at: crate::util::time::rfc3339_now(),
                    audio_json,
                    chapter_json,
                }))
            }
            Ok(Err(err)) => Ok(Err(err)),
            Err(panic) => {
                tracing::error!(?panic, "recording worker panicked");
                Err(CoreError::encoder(
                    "encoder.encode_failed",
                    false,
                    "The video encoder failed while writing the recording.",
                ))
            }
        }
    }

    /// 2.5 (API §2.3 / flow 7.2): append a chapter marker at the take's
    /// current recording-relative time (the `recording/tick` `elapsedMs`).
    /// The label defaults to `flag-N` (1-based count, matches the HUD
    /// tick counter). Emits the marker and returns it for the reply + event.
    pub fn flag(
        &self,
        recording_id: &str,
        label: Option<String>,
    ) -> Result<ChapterMarker, CoreError> {
        let mut slot = self.locked();
        self.reap_finished(&mut slot);
        let Some(active) = slot.as_mut() else {
            return Err(bad_state("No recording is running with that id."));
        };
        if active.recording_id != recording_id {
            return Err(bad_state("No recording is running with that id."));
        }
        let offset_ms = active.pause.elapsed_ms(wall_us());
        let chapters = active
            .chapters
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let n = chapters.len() + 1;
        let label = label.unwrap_or_else(|| format!("flag-{n}"));
        drop(chapters);
        let chapter = ChapterMarker { offset_ms, label };
        active
            .chapters
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(chapter.clone());
        Ok(chapter)
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, Option<ActiveRecording>> {
        // Poisoned lock = a worker panic while holding it — plain state
        // recovery, same discipline as CaptureHandle (§6.4).
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for RecordingHandle {
    fn default() -> Self {
        Self::new()
    }
}

/// Recording ids: mirrors `capture::new_source_id` — `rec_` + monotonic
/// nanos hex + a rollover counter, unique under any clock.
pub fn new_recording_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed) & 0xffff;
    format!("rec_{nanos:x}{counter:04x}")
}

/// The session's fixed facts — handed to the worker thread.
struct SessionContext {
    /// The take's id (every event carries it — API §3).
    recording_id: String,
    /// Encoded dimensions (even-clamped).
    dims: (u32, u32),
    /// Where the session's events go (the IPC layer's Tauri sink).
    events: Arc<dyn EventSink>,
    /// Set when the take ends — lets `start` reap a faulted worker.
    ended: Arc<AtomicBool>,
}

/// The session body: the take plus its event stream (ARCHITECTURE §3.2
/// steps 4 + 7). A fault pushes the typed error to the UI at FAULT TIME
/// — a HUD learns the take is over without waiting for the user to press
/// stop — and the same error is returned by `recording_stop`.
#[allow(clippy::too_many_arguments)]
fn run_session(
    mux: Muxer,
    mut encoder: SwX264,
    bus: Arc<FrameBus>,
    stop: Arc<AtomicBool>,
    ctx: SessionContext,
    audio_leg: Option<AudioLeg>,
    video_base: Arc<AtomicU64>,
    video_anchored: Arc<AtomicBool>,
    pause: PauseState,
    region_rect: Option<crate::capture::RegionRect>,
    preset: crate::pipeline::presets::Preset,
    camera_overlay: CameraOverlayConfig,
) -> Result<TakeFacts, CoreError> {
    let mut audio_leg = audio_leg;
    let outcome = capture_take(
        mux,
        &mut encoder,
        &bus,
        &stop,
        &ctx,
        &mut audio_leg,
        &video_base,
        &video_anchored,
        &pause,
        region_rect,
        preset,
        &camera_overlay,
    );
    // The take is over — mark it BEFORE the error event, so a UI that
    // reacts to the event can start the next take right away.
    ctx.ended.store(true, Ordering::Release);
    // Every exit path reaps whatever remains of the audio leg (the
    // success path consumed it inside capture_take; a fault leaves the
    // worker running behind a broken file — join it and discard the
    // late packets, the file is already unrecoverable).
    let reap_fault = audio_leg.as_mut().and_then(|leg| reap_audio(leg, None));
    match outcome {
        Ok(facts) => match reap_fault {
            Some(err) => Err(err),
            None => Ok(facts),
        },
        // The video fault wins an outcome race with a concurrent audio
        // fault — one event, one authoritative reply (API §3).
        Err(err) => Err(err),
    }
    .inspect_err(|err| ctx.events.emit(SessionEvent::Error(err.to_ipc())))
}

/// The take itself: drain → encode → mux until the stop latch, whose
/// budget bounds the take at Stop time (see the loop body).
#[allow(clippy::too_many_arguments)]
fn capture_take(
    mut mux: Muxer,
    encoder: &mut SwX264,
    bus: &Arc<FrameBus>,
    stop: &Arc<AtomicBool>,
    ctx: &SessionContext,
    audio_leg: &mut Option<AudioLeg>,
    video_base: &Arc<AtomicU64>,
    video_anchored: &Arc<AtomicBool>,
    pause: &PauseState,
    region_rect: Option<crate::capture::RegionRect>,
    preset: crate::pipeline::presets::Preset,
    camera_overlay: &CameraOverlayConfig,
) -> Result<TakeFacts, CoreError> {
    let mut first_pts: Option<u64> = None;
    let mut frames: u64 = 0;
    let mut last_rel_pts: u64 = 0;
    let mut info_window = Instant::now();
    let mut info_frames: u64 = 0;
    // Frames still allowed into the take after the stop latch: the
    // backlog snapshotted at latch time. None = latch not yet observed.
    let mut drain_budget: Option<usize> = None;
    // Defensive empty-poll counter for the (theoretically unreachable)
    // latched-but-ring-empty branch — bounds stop latency unconditionally.
    let mut empty_polls: u32 = 0;
    // A fatal audio-side fault (AAC encode failure) surfaced by the
    // worker: the take continues (the video stream is still valid) and
    // fails at the drain — the authoritative stop reply carries it.
    let mut audio_fault: Option<CoreError> = None;
    // The event cadence (API §3): tick 1 Hz, stats 0.5 Hz. Both run on
    // the wall clock, never on frames — an idle source still ticks (§6).
    // 2.3: the tick's elapsed is RECORDING time on the wall clock minus
    // the pause accumulator (frozen while paused, exact per the gate).
    let mut tick_gate = Throttle::new(TICK_PERIOD);
    let mut stats_gate = Throttle::new(STATS_PERIOD);
    let mut meter = StatsMeter::new();
    let mut stats_window = Instant::now();
    // M11 fps cap: a 30 fps preset on a 60 fps source keeps every
    // other frame (the source cadence is wall-clock µs, so the drop
    // tracks the nearest whole interval; the half-interval tolerance
    // absorbs producer jitter so a slightly-fast producer never
    // under-delivers the next whole interval).
    let min_interval_us = 1_000_000u64 / preset.fps.max(1) as u64;
    let accept_threshold_us = min_interval_us / 2;
    let mut last_accepted_raw: Option<u64> = None;

    loop {
        // Cadence FIRST: the gates fire on the wall clock, so the events
        // keep their documented rate even when the source goes quiet.
        let now = Instant::now();
        if tick_gate.due(now) {
            ctx.events.emit(SessionEvent::Tick {
                recording_id: ctx.recording_id.clone(),
                elapsed_ms: pause.elapsed_ms(wall_us()),
                paused: pause.is_active(),
            });
        }
        if stats_gate.due(now) {
            let snapshot = meter.snapshot(bus.dropped(), stats_window.elapsed());
            meter.reset();
            stats_window = Instant::now();
            ctx.events.emit(SessionEvent::Stats(snapshot));
        }
        // ARCHITECTURE §6: a quiet/paused video source must not starve the
        // bounded audio hop. Per-stream monotonic PTS permits independent
        // writes; the post-loop drain still includes the codec's tail.
        if let Some(leg) = audio_leg.as_mut() {
            while let Ok(msg) = leg.packets.try_recv() {
                match msg {
                    AudioMsg::Packets(audio_packets) => mux.write(&audio_packets)?,
                    AudioMsg::Fault(err) => {
                        audio_fault.get_or_insert(err);
                    }
                }
            }
        }
        // Latch FIRST, every iteration: the take ends when Stop was
        // pressed (bounded stop latency), NOT whenever the encoder
        // catches up — with a live producer the ring refills faster
        // than this loop can observe it empty, and an "exit on empty"
        // loop would never terminate (root cause of the stop-hang).
        if stop.load(Ordering::Acquire) {
            // Establish (once) the take's tail: frames already in the
            // ring at latch time. SPSC law (pipeline/mod.rs): only this
            // consumer removes frames, so exactly this many pops remain
            // before the latch-time content is exhausted — the budget
            // can never stall.
            let budget = drain_budget.get_or_insert_with(|| bus.len());
            if *budget == 0 {
                break;
            }
        }
        match bus.try_pop() {
            Some(mut frame) => {
                // M3: apply region crop if set.
                if let Some(region) = region_rect {
                    frame =
                        crate::pipeline::apply_region_crop(frame, Some(region)).map_err(|err| {
                            tracing::error!(%err, "region crop failed");
                            err
                        })?;
                }
                let take_last = match &mut drain_budget {
                    Some(budget) => {
                        *budget -= 1;
                        *budget == 0
                    }
                    None => false,
                };
                // 2.3 pause gate: while paused the take records NOTHING.
                // Frames in the ring at pause time are discarded even
                // under a stop-drain budget (budget keeps decrementing so
                // a stop-while-paused stays bounded; the at-most-half-ring
                // (~8 frames ≈ 130 ms) pre-pause in-flight content that a
                // racing pause can drop is imperceptible — pauses cut at
                // "nothing from here on", the ledger records the cost).
                if pause.is_active() {
                    if take_last {
                        break;
                    }
                    continue;
                }
                // M11 fps cap gate: drop frames that precede the preset's
                // frame interval. The drain budget still decrements so a
                // stop-while-capped take stays bounded, mirroring the
                // pause gate's accounting.
                if let Some(last) = last_accepted_raw
                    && frame.pts_us < last.saturating_add(min_interval_us - accept_threshold_us)
                {
                    if take_last {
                        break;
                    }
                    continue;
                }
                // 4.3: composite the camera PiP onto the frame before encoding.
                // Camera stills arrive at ≤8 fps; reusing the last still across
                // video frames is correct — the PiP is a stills overlay, not
                // a live video track.
                if camera_overlay.enabled
                    && let Some(mailbox) = &camera_overlay.mailbox
                    && let Some((cam_frame, _stamp)) = mailbox.latest()
                {
                    let pip_w = camera_overlay.pip_size;
                    let pip_h = (pip_w * 9) / 16;
                    // Corner+margin model (API §2.6 pip.position):
                    // bottom-right = source corner minus pip minus margin.
                    let x = frame
                        .width
                        .saturating_sub(pip_w)
                        .saturating_sub(camera_overlay.pip_margin);
                    let y = frame
                        .height
                        .saturating_sub(pip_h)
                        .saturating_sub(camera_overlay.pip_margin);
                    let _ = overlay_camera(
                        &mut frame,
                        &cam_frame,
                        x,
                        y,
                        pip_w,
                        pip_h,
                        camera_overlay.pip_shape,
                    );
                }
                last_accepted_raw = Some(frame.pts_us);
                let base = match first_pts {
                    Some(base) => base,
                    None => {
                        // §5b: publish the video clock (RAW wall µs) the
                        // moment the first frame exists — the audio
                        // worker anchors against this and must never see
                        // a leading audio stream. The FLAG is the
                        // sentinel: pt 0 is a legal stamp.
                        video_base.store(frame.pts_us, Ordering::Release);
                        video_anchored.store(true, Ordering::Release);
                        *first_pts.insert(frame.pts_us)
                    }
                };
                // Wall-clock monotonic µs; sanitize against a reordered
                // producer clock instead of trusting it. 2.3: the paused
                // wall time is subtracted with the SAME clock, so the
                // encoded timeline excludes the pause by construction
                // (never regresses — the accumulator only grows in
                // wall µs the raw span actually spans).
                let raw_shifted = frame
                    .pts_us
                    .saturating_sub(base)
                    .saturating_sub(pause.total_us());
                // Monotonic clamp: the subtract law assumes the raw span
                // covers the banked pause (both are wall µs). A producer
                // clock that disagrees (an NTP step, synthetic feeders)
                // must not regress the stream — matroska REQUIRES
                // per-stream monotonic pts and the mux write fails hard
                // otherwise (red-test caught in 2.3). The clamp is a
                // no-op on every honest wall-clock producer: the resumed
                // raw gap always exceeds the banked pause there.
                let rel = raw_shifted.max(last_rel_pts.saturating_add(1));
                frame.pts_us = rel;
                // The encoder's cost is a meter (API §3 `encodeTimeMs`) —
                // the muxer's cost is not part of the payload.
                let encode_started = Instant::now();
                let packets = encoder.encode(&frame)?;
                let encode_time = encode_started.elapsed();
                let encoded_bytes: usize = packets.iter().map(|packet| packet.data.len()).sum();
                mux.write(&packets)?;
                meter.record_frame(encoded_bytes, encode_time);
                frames += 1;
                info_frames += 1;
                last_rel_pts = rel;
                if info_window.elapsed() >= Duration::from_secs(1) {
                    // §6 cadence: one line per second, not per frame.
                    let elapsed = info_window.elapsed().as_secs_f64();
                    tracing::debug!(
                        fps = (info_frames as f64 / elapsed) as u64,
                        dropped = bus.dropped(),
                        "recording pipeline frames"
                    );
                    // Crash tolerance (PLAN 1.3): once per second, push
                    // the take to the OS — the muxer's cluster and the
                    // AVIO buffer are both lost on a kill, so without
                    // this a crashed recording is unreadable.
                    mux.flush()?;
                    info_window = Instant::now();
                    info_frames = 0;
                }
                if take_last {
                    // Post-latch arrivals stay in the ring — the session
                    // NEVER closes the bus (§6); the producer keeps
                    // feeding previews and the next take.
                    break;
                }
            }
            None => {
                if drain_budget == Some(0) {
                    break;
                }
                if stop.load(Ordering::Acquire) {
                    // Unreachable in theory (a latched budget can only
                    // shrink via OUR pops, so the frames are still in the
                    // ring), but if it somehow persists, bound it — stop
                    // latency stays finite, tail truncation is logged.
                    empty_polls += 1;
                    if empty_polls >= 250 {
                        tracing::error!(
                            budget = drain_budget,
                            "drain budget did not resolve; ending the take truncated"
                        );
                        break;
                    }
                }
                std::thread::sleep(IDLE_POLL);
                continue;
            }
        }
        empty_polls = 0;
    }

    // Zero-frame guard (task 1.5): finalizing here would write a
    // header-only MKV with an empty cluster — unreadable (ffprobe:
    // invalid EBML) — and report a "successful" take. Fail loudly
    // instead (API §1: capture.no_frames) and leave no artifact.
    if frames == 0 {
        let path = mux.path().to_owned();
        // Drop closes the container without a trailer; the partial file
        // is removed so the library never lists a take it cannot play.
        drop(mux);
        if let Err(err) = std::fs::remove_file(&path)
            && err.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(%err, "could not remove empty take file");
        }
        return Err(CoreError::capture(
            "capture.no_frames",
            true,
            "Nothing was captured. Click a source and try again.",
        ));
    }

    // §5b: the audio tail is part of the take — drain the audio hop into
    // the muxer BEFORE the video trailer, bounded so a wedged audio
    // worker can never hang recording_stop. The leg is consumed on this
    // path (run_session will not double-reap it); a fault fails the take
    // exactly like a video fault would.
    let drained_fault = match audio_leg.as_mut() {
        Some(leg) => reap_audio(leg, Some(&mut mux)),
        None => None,
    };
    let audio_fault = audio_fault.or(drained_fault);
    if audio_leg.is_some() {
        *audio_leg = None;
    }
    if let Some(err) = audio_fault {
        return Err(err);
    }

    // Flush the encoder tail (B-frames queue behind GOP boundaries), write
    // the container trailer — after this point the file is complete.
    let path = mux.path().to_owned();
    let tail = encoder.finish()?;
    mux.write(&tail)?;
    mux.finalize()?;

    let size_bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    tracing::info!(
        frames,
        duration_ms = last_rel_pts / 1000,
        size_bytes,
        "recording finalized"
    );
    Ok(TakeFacts {
        path,
        duration_ms: last_rel_pts / 1000,
        size_bytes,
        width: ctx.dims.0,
        height: ctx.dims.1,
        fps: preset.fps,
    })
}

/// 6.2: expand the settings naming pattern (strftime tokens: %Y %m %d %H %M)
/// to a file stem, then append the container extension. Falls back to
/// `first-rec` if the pattern is empty or invalid.
fn next_output_path(dir: &Path, naming_pattern: &str, container: &str) -> PathBuf {
    let stem = if naming_pattern.is_empty() {
        BASE_FILE_STEM.to_string()
    } else {
        strftime_expand(naming_pattern)
    };
    let first = dir.join(format!("{stem}.{container}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n: u32| dir.join(format!("{stem}-{n}.{container}")))
        .find(|candidate| !candidate.exists())
        .expect("u32::MAX suffixes are finite; every slot-1 recording leaves an unused N")
}

/// 6.2: expand strftime tokens (%Y %m %d %H %M) against the current wall
/// clock. Unsupported tokens pass through literally (e.g. `%%` → `%`).
fn strftime_expand(pattern: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Days since Unix epoch → broken-down date.
    let mut days = now / 86400;
    let secs_in_day = now % 86400;
    let mut year = 1970;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }
    let month_days = [
        31,
        if is_leap_year(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }
    let day = days + 1;
    let hour = (secs_in_day / 3600) as u32;
    let minute = ((secs_in_day % 3600) / 60) as u32;

    let mut result = String::new();
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            match chars.next() {
                Some('Y') => result.push_str(&format!("{:04}", year)),
                Some('m') => result.push_str(&format!("{:02}", month)),
                Some('d') => result.push_str(&format!("{:02}", day)),
                Some('H') => result.push_str(&format!("{:02}", hour)),
                Some('M') => result.push_str(&format!("{:02}", minute)),
                Some('%') => result.push('%'),
                Some(c) => {
                    result.push('%');
                    result.push(c);
                }
                None => result.push('%'),
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// 6.2: remux MKV→MP4 with a stream copy (no re-encode — fast). Returns
/// the MP4 path on success.
fn remux_mkv_to_mp4(mkv_path: &Path) -> Result<PathBuf, CoreError> {
    let mp4_path = mkv_path.with_extension("mp4");
    let status = Command::new("ffmpeg")
        .args([
            "-y", // overwrite without asking
            "-i",
            mkv_path.to_str().ok_or_else(|| {
                CoreError::disk(
                    "disk.path_unwritable",
                    false,
                    "MP4 remux failed: output path is not valid UTF-8.",
                )
            })?,
            "-c",
            "copy", // stream copy — no re-encode
            mp4_path.to_str().ok_or_else(|| {
                CoreError::disk(
                    "disk.path_unwritable",
                    false,
                    "MP4 remux failed: output path is not valid UTF-8.",
                )
            })?,
        ])
        .status()
        .map_err(|_| {
            CoreError::encoder(
                "encoder.init_failed",
                false,
                "FFmpeg is not available for MP4 remux.",
            )
        })?;
    if !status.success() {
        return Err(CoreError::encoder(
            "encoder.encode_failed",
            false,
            "MP4 remux failed; MKV take preserved.",
        ));
    }
    Ok(mp4_path)
}

fn bad_state(message: &'static str) -> CoreError {
    CoreError::ipc("ipc.bad_state", false, message)
}

#[cfg(all(test, feature = "encode"))]
mod tests {
    use super::*;
    use crate::pipeline::stats::StatsSnapshot;

    /* Synthetic-frame harness: no portal, no PipeWire — the tests play
    the producer half of the bus so the verify (§PLAN 1.3, ffprobe shows
    a valid h264 stream with the right duration) runs in `cargo test`. */

    const W: u32 = 320;
    const H: u32 = 240;

    /// A recording event sink — collects the session's events so the
    /// tests can assert the API §3 cadences without a Tauri app.
    #[derive(Default)]
    struct TestSink {
        events: Mutex<Vec<SessionEvent>>,
    }

    impl TestSink {
        fn new() -> Arc<TestSink> {
            Arc::new(TestSink::default())
        }

        fn all(&self) -> Vec<SessionEvent> {
            self.events.lock().expect("sink lock").clone()
        }

        fn ticks(&self) -> Vec<(String, u64)> {
            self.all()
                .iter()
                .filter_map(|event| match event {
                    SessionEvent::Tick {
                        recording_id,
                        elapsed_ms,
                        ..
                    } => Some((recording_id.clone(), *elapsed_ms)),
                    _ => None,
                })
                .collect()
        }

        fn stats(&self) -> Vec<StatsSnapshot> {
            self.all()
                .iter()
                .filter_map(|event| match event {
                    SessionEvent::Stats(snapshot) => Some(*snapshot),
                    _ => None,
                })
                .collect()
        }

        fn meters(&self) -> Vec<(MeterReading, MeterReading)> {
            self.all()
                .iter()
                .filter_map(|event| match event {
                    SessionEvent::Meters { mic, desktop } => Some((*mic, *desktop)),
                    _ => None,
                })
                .collect()
        }

        fn errors(&self) -> Vec<crate::util::error::IpcError> {
            self.all()
                .iter()
                .filter_map(|event| match event {
                    SessionEvent::Error(err) => Some(err.clone()),
                    _ => None,
                })
                .collect()
        }
    }

    impl EventSink for TestSink {
        fn emit(&self, event: SessionEvent) {
            self.events.lock().expect("sink lock").push(event);
        }
    }

    /// The §1 error code of a recorded error event (the wire shape is
    /// private — read it through the contract's own JSON projection).
    fn error_code(err: &crate::util::error::IpcError) -> String {
        serde_json::to_value(err).expect("serialize")["code"]
            .as_str()
            .expect("code is a string")
            .to_string()
    }

    /// Small BGRx frame; pixel content varies per frame so x264 has real
    /// work (a constant frame would make bitrate/duration checks silly).
    fn synthetic_frame(n: u64, pts_us: u64) -> crate::pipeline::Frame {
        synthetic_frame_dims(n, pts_us, W, H)
    }

    /// The same frame at other dimensions — a portal session has ONE
    /// resolution, so a different size is a mid-take renegotiation
    /// (encode/sw_x264.rs → pipewire.stream_lost).
    fn synthetic_frame_dims(
        n: u64,
        pts_us: u64,
        width: u32,
        height: u32,
    ) -> crate::pipeline::Frame {
        let stride = width as usize * 4;
        let mut data = vec![0u8; stride * height as usize];
        for (i, byte) in data.iter_mut().enumerate() {
            *byte = (n as usize ^ i) as u8;
        }
        crate::pipeline::Frame {
            width,
            height,
            stride: stride as u32,
            layout: crate::pipeline::FrameLayout::Bgrx,
            pts_us,
            data,
        }
    }

    /// Pushes `count` frames at a 60 fps pts cadence (real-time pacing —
    /// the worker consumes slower only if the machine is overloaded).
    /// The retry is BOUNDED: if the worker died, the ring stays full
    /// forever (the session never closes the bus, §6) and an unbounded
    /// retry loop would hang the whole test run instead of failing it.
    fn produce(bus: &Arc<FrameBus>, count: u64, base_pts_us: u64) {
        for n in 0..count {
            let pts = base_pts_us + n * 16_666;
            let mut retries = 0u32;
            loop {
                match bus.try_push(synthetic_frame(n, pts)) {
                    crate::pipeline::Push::Pushed => break,
                    crate::pipeline::Push::Full(_) => {
                        retries += 1;
                        assert!(
                            retries < 2_000,
                            "frame {n} was never accepted — the consumer is gone"
                        );
                        std::thread::sleep(IDLE_POLL);
                    }
                }
            }
        }
    }

    fn ffprobe_json(path: &Path) -> Option<serde_json::Value> {
        let output = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,width,height,sample_rate:format=duration",
                "-of",
                "json",
            ])
            .arg(path)
            .output()
            .ok()?;
        if !output.status.success() {
            eprintln!(
                "ffprobe failed ({}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            );
            return None;
        }
        serde_json::from_slice(&output.stdout).ok()
    }

    /// 2.3: the wall-clock producer the pause subtract-law presupposes —
    /// pts are stamped from the wall at push time and paced on the real
    /// 60 fps grid, so the pts span covers the pause the way a live
    /// feeder's does (fixed synthetic bases do NOT advance through a
    /// real pause; feeding them post-resume would clamp-squeeze the
    /// resumed segment onto the pre-pause tail — red-test lesson).
    fn produce_wall(bus: &Arc<FrameBus>, count: u64, spacing: Duration) {
        let started = Instant::now();
        for n in 0..count {
            let pts = wall_us();
            let mut retries = 0u32;
            loop {
                match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                    crate::pipeline::Push::Pushed => break,
                    crate::pipeline::Push::Full(_) => {
                        retries += 1;
                        assert!(
                            retries < 2_000,
                            "frame {n} was never accepted — the consumer is gone"
                        );
                        std::thread::sleep(IDLE_POLL);
                    }
                }
            }
            // Pace to the 60 fps grid in real time (the push already ate
            // whatever the cap-8 bus forced it to wait — never sleep past
            // the grid, only up to it).
            let due = started + spacing * (n as u32 + 1);
            let now = Instant::now();
            if due > now {
                std::thread::sleep(due - now);
            }
        }
    }

    /// Wait until the worker has drained the bus (poll-May sleep, §6).
    fn wait_drained(bus: &Arc<FrameBus>) {
        for _ in 0..5_000 {
            if bus.is_empty() {
                return;
            }
            std::thread::sleep(IDLE_POLL);
        }
        panic!("bus never drained");
    }

    #[test]
    fn start_stop_writes_a_valid_h264_mkv_with_duration() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");
        assert_eq!(info.encoder.backend, "x264");
        assert!(!info.encoder.is_hardware);
        assert!(info.recording_id.starts_with("rec_"));
        // RFC-3339 shape (API §2.3 startedAt): "…T…Z".
        assert!(info.started_at.ends_with('Z') && info.started_at.len() == 20);

        produce(&bus, 90, 1_000_000); // 1.5 s of synthetic 60 fps video
        wait_drained(&bus);

        let outcome = handle
            .stop(&info.recording_id)
            .expect("stop accepted")
            .expect("clean take");
        let path = outcome.path.clone();
        assert!(path.exists(), "mkv on disk");
        assert!(
            path.file_name().unwrap() == std::ffi::OsStr::new("first-rec.mkv"),
            "PLAN 1.3 wired name"
        );
        assert_eq!(outcome.path, dir.path().join("first-rec.mkv"));
        // 90 frames @16.666 ms cadence ≈ 1.5 s (± one frame of slack).
        assert!(
            (1_300..=1_700).contains(&outcome.duration_ms),
            "durationMs near the produced span, got {}",
            outcome.duration_ms
        );
        assert!(outcome.size_bytes > 1_000, "real encoded bytes landed");

        // PLAN verify: ffprobe confirms the stream (skips offbox).
        if let Some(report) = ffprobe_json(&path) {
            let stream = &report["streams"][0];
            assert_eq!(stream["codec_name"], "h264");
            assert_eq!(stream["width"], W);
            assert_eq!(stream["height"], H);
            let duration = report["format"]["duration"]
                .as_str()
                .and_then(|d| d.parse::<f64>().ok())
                .expect("container duration");
            assert!(
                (1.3..=1.8).contains(&duration),
                "ffprobe duration {duration}"
            );
        } else {
            eprintln!("ffprobe unavailable — size/duration asserts only");
        }
    }

    #[test]
    fn double_start_and_unknown_stop_are_bad_state_and_slot_survives() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(4));
        let dir = tempfile::tempdir().expect("tmp dir");

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("first start");
        produce(&bus, 5, 0);

        // Second start while active → ipc.bad_state (API §2.3).
        let err = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");

        // Wrong-id stop → bad_state, session survives (put-back).
        let err = handle.stop("rec_wrong").unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
        // The real stop after the spoof still works.
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take");
        assert!(outcome.path.exists());
        // And nothing is active anymore: stopping again is bad_state.
        assert_eq!(
            handle.stop(&info.recording_id).unwrap_err().code(),
            "ipc.bad_state"
        );
    }

    #[test]
    fn idle_frames_do_not_extend_first_or_repeated_takes() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().unwrap();
        for take in 0..2 {
            // The live portal fills this same bus between takes. Those
            // frames predate Start and must not become the new A/V anchor.
            let base = 1_000_000 + take * 120_000_000;
            produce(&bus, 8, base);
            let info = handle
                .start(
                    bus.clone(),
                    (W, H),
                    dir.path(),
                    "%Y-%m-%d-%H%M",
                    "mkv",
                    TestSink::new(),
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap();
            produce(&bus, 5, base + 60_000_000);
            wait_drained(&bus);
            let outcome = handle.stop(&info.recording_id).unwrap().unwrap();
            assert!(
                (60..=80).contains(&outcome.duration_ms),
                "idle frames extended take {take}: {} ms",
                outcome.duration_ms
            );
            let mut input = ff::format::input(&outcome.path).unwrap();
            assert_eq!(input.packets().count(), 5, "only post-Start frames belong");
        }
    }

    #[test]
    fn audio_keeps_muxing_when_the_video_source_is_quiet() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().unwrap();
        let ring = Arc::new(crate::pipeline::AudioRing::new(1 << 19));
        let plan = AudioPlan {
            producers: vec![],
            channels: vec![MixSource {
                ring: ring.clone(),
                gain: 1.0,
                channel: crate::capture::audio::AudioChannel::Mic,
            }],
            row_note: None,
        };
        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                Some(plan),
                None,
                None,
                None,
            )
            .unwrap();
        produce(&bus, 5, 0);
        wait_drained(&bus);
        // Four seconds of PCM exceeds the 64-message AAC hop. A static
        // desktop delivers no more video, but audio still needs muxing.
        let samples = vec![0.25; 48_000 * 2 * 4];
        assert_eq!(ring.try_push(&samples), samples.len() / 2);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !ring.is_empty() && Instant::now() < deadline {
            std::thread::sleep(IDLE_POLL);
        }
        let outcome = handle
            .stop(&info.recording_id)
            .unwrap()
            .expect("audio must not backlog waiting for a video frame");
        let mut input = ff::format::input(&outcome.path).unwrap();
        let audio_packets = input
            .packets()
            .filter(|(stream, _)| stream.parameters().medium() == ff::media::Type::Audio)
            .count();
        assert!(audio_packets >= 188, "the complete AAC tail must survive");
    }

    #[test]
    fn second_take_gets_first_rec_2_not_an_overwrite() {
        let handle = RecordingHandle::new();
        let dir = tempfile::tempdir().expect("tmp dir");

        let bus = Arc::new(FrameBus::new(4));
        let first = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("first");
        produce(&bus, 5, 0);
        wait_drained(&bus);
        let first_outcome = handle
            .stop(&first.recording_id)
            .expect("stop")
            .expect("take");

        let bus = Arc::new(FrameBus::new(4));
        let second = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("second");
        produce(&bus, 5, 0);
        wait_drained(&bus);
        let second_outcome = handle
            .stop(&second.recording_id)
            .expect("stop")
            .expect("take");

        assert_eq!(first_outcome.path, dir.path().join("first-rec.mkv"));
        assert_eq!(second_outcome.path, dir.path().join("first-rec-2.mkv"));
        assert!(second_outcome.size_bytes > 0);
    }

    /// Regression (task 1.5 zero-frame takes): a stop with ZERO encoded
    /// frames must fail loudly — a header-only MKV with an empty cluster
    /// is unreadable (ffprobe: invalid EBML) — and must leave no file.
    /// Before the guard, the take "succeeded" with a 535-byte artifact.
    #[test]
    fn stop_with_zero_frames_fails_and_leaves_no_file() {
        let handle = RecordingHandle::new();
        let dir = tempfile::tempdir().expect("tmp dir");
        let bus = Arc::new(FrameBus::new(4));

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("clean start");
        // No frames are ever produced: the bus stays empty the whole take.
        let err = handle
            .stop(&info.recording_id)
            .expect("stop accepted")
            .expect_err("zero-frame take must fail");
        assert_eq!(err.code(), "capture.no_frames");
        // The partial container must be gone, not a corrupt header-only
        // file that fakes a successful take in the library.
        assert_eq!(
            std::fs::read_dir(dir.path()).expect("tmp listing").count(),
            0,
            "no corrupt empty take may remain on disk"
        );
        // And the session is reusable afterwards (slot released cleanly).
        let bus = Arc::new(FrameBus::new(4));
        let next = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("session reuses the slot after a failed take");
        produce(&bus, 3, 0);
        wait_drained(&bus);
        // The failed take's file was removed, so sequential naming hands
        // the first name out again (never-overwrite, not never-reuse).
        let outcome = handle
            .stop(&next.recording_id)
            .expect("stop")
            .expect("recovered take");
        assert_eq!(outcome.path, dir.path().join("first-rec.mkv"));
    }

    /// Regression (rust-pro/systematic-debugging audit): a LIVE source
    /// keeps feeding the bus after Stop (the session never closes the
    /// bus, §6). The worker must honor the latch with a bounded drain —
    /// an "exit on empty bus" loop hangs recording_stop forever here.
    #[test]
    fn stop_ends_the_take_while_the_source_keeps_producing() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("start");

        // Live-source simulation: the producer runs through the whole
        // test and is only told to stop AFTER the recording has stopped.
        let keep = Arc::new(AtomicBool::new(true));
        let producer = {
            let bus = bus.clone();
            let keep = keep.clone();
            std::thread::spawn(move || {
                let mut n = 0u64;
                let t0 = std::time::Instant::now();
                while keep.load(Ordering::Acquire) {
                    let pts = t0.elapsed().as_micros() as u64;
                    // Real-producer policy (capture/pipewire.rs): give up
                    // on a full ring instead of retrying — after the take
                    // ends no consumer drains the bus (the session never
                    // closes it, §6), so a retry loop would spin forever.
                    match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                        crate::pipeline::Push::Pushed => {}
                        crate::pipeline::Push::Full(_) => bus.mark_dropped(),
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_millis(16));
                }
                n
            })
        };

        std::thread::sleep(Duration::from_millis(400));
        let stop_t0 = std::time::Instant::now();
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("take");
        let stop_elapsed = stop_t0.elapsed();
        keep.store(false, Ordering::Release);
        let produced = producer.join().expect("producer ok");

        assert!(
            stop_elapsed < Duration::from_secs(5),
            "stop must be bounded, took {stop_elapsed:?}"
        );
        assert!(produced > 0, "the producer actually fed frames");
        assert!(outcome.path.exists());
        // The take covers (at least) the pre-stop produce window.
        assert!(
            outcome.duration_ms >= 250,
            "durationMs {} should cover the ~400 ms produce window",
            outcome.duration_ms
        );
        // The bus stays usable after the take (§6: the session never
        // closes it) — a late producer push is still accepted.
        assert!(matches!(
            bus.try_push(synthetic_frame(0, 10_000_000)),
            crate::pipeline::Push::Pushed
        ));
    }

    /// PLAN 1.3 crash-kill verify (in-test equivalent of kill -9).
    ///
    /// A real crash runs NO destructors: the muxer's Drop (which closes
    /// the file and flushes) never happens, so `mem::forget` is the
    /// faithful simulation — the file keeps exactly the bytes the app
    /// explicitly flushed to the OS. Without the 1 Hz flush the file
    /// would be a bare EBML header (the ffmpeg CLI's own killed file is
    /// 0 bytes for the same reason).
    #[test]
    fn crash_without_trailer_leaves_a_probeable_mkv() {
        let dir = tempfile::tempdir().expect("tmp dir");
        let path = dir.path().join("first-rec.mkv");
        let spec = crate::pipeline::muxer::VideoSpec {
            codec: ff::codec::Id::H264,
            width: W,
            height: H,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: FRAME_RATE,
            options: crate::encode::sw_x264::options(),
        };
        {
            let (mut mux, opened) = Muxer::open_video(&path, spec).expect("muxer");
            let mut encoder = SwX264::from_open(opened);
            // x264's lookahead (40 frames + thread queue) buffers early
            // input; the matroska muxer closes a cluster on a KEYFRAME
            // boundary (proven: the ffmpeg CLI writes 2 clusters at
            // g=250 and 8 at g=60), and our GOP is 60 frames. So the
            // take must run past the SECOND keyframe before any cluster
            // is complete — 160 frames covers it with margin.
            for n in 0..160u64 {
                let packets = encoder
                    .encode(&synthetic_frame(n, n * 16_666))
                    .expect("encode");
                mux.write(&packets).expect("write");
            }
            // The session's 1 Hz flush cadence: cluster closed + AVIO
            // pushed to the OS.
            mux.flush().expect("flush");
            // CRASH: no finalize, no trailer, no Drop.
            std::mem::forget(mux);
        }
        let size = path.metadata().expect("metadata").len();
        assert!(size > 1_000, "flushed bytes must reach the OS, got {size}");
        if let Some(report) = ffprobe_json(&path) {
            assert_eq!(report["streams"][0]["codec_name"], "h264");
            assert_eq!(report["streams"][0]["width"], W);
            assert_eq!(report["streams"][0]["height"], H);
        } else {
            eprintln!("ffprobe unavailable — file-size smoke only");
        }
    }

    /// PLAN 1.4 verify: the session's event stream keeps the documented
    /// cadences (API §3: `recording/tick` 1 Hz, `recording/stats` 0.5 Hz)
    /// — one tick per SECOND, never one per frame, and the stats at half
    /// that rate. ARCHITECTURE §6: the coalescing happens in Rust.
    #[test]
    fn tick_and_stats_keep_the_contract_cadence() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");

        // Live producer: one frame every 16 ms (60 fps), like the capture.
        let keep = Arc::new(AtomicBool::new(true));
        let producer = {
            let bus = bus.clone();
            let keep = keep.clone();
            std::thread::spawn(move || {
                let mut n = 0u64;
                let t0 = Instant::now();
                while keep.load(Ordering::Acquire) {
                    let pts = t0.elapsed().as_micros() as u64;
                    match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                        crate::pipeline::Push::Pushed => {}
                        crate::pipeline::Push::Full(_) => bus.mark_dropped(),
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_millis(16));
                }
            })
        };

        // Wait for the second tick (t ≈ 2 s).
        let deadline = Instant::now() + Duration::from_secs(8);
        while sink.ticks().len() < 2 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        // The stats event rides the same instant as the second tick.
        std::thread::sleep(Duration::from_millis(100));

        handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take");
        keep.store(false, Ordering::Release);
        producer.join().expect("producer ok");

        let ticks = sink.ticks();
        assert_eq!(ticks.len(), 2, "one tick per second, not one per frame");
        assert_eq!(ticks[0].0, info.recording_id, "the tick names the take");
        assert!(
            (900..=1_500).contains(&ticks[0].1),
            "the first tick lands at ~1 s, got {}",
            ticks[0].1
        );
        assert!(
            (1_900..=2_600).contains(&ticks[1].1),
            "the second tick lands at ~2 s, got {}",
            ticks[1].1
        );
        let stats = sink.stats();
        assert_eq!(stats.len(), 1, "stats at 0.5 Hz (one per 2 s)");
        assert!(stats[0].fps > 0.0, "the meter saw the encoded frames");
        assert!(sink.errors().is_empty(), "a healthy take reports no error");
    }

    /// PLAN 1.4: a mid-take fault pushes the typed error at FAULT TIME
    /// (ARCHITECTURE §3.2 step 7) — the UI learns the take is over
    /// without waiting for the user to press stop — and the stop reply
    /// carries the same failure (authoritative).
    #[test]
    fn a_worker_fault_emits_an_error_event_at_fault_time() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");

        // A frame whose size does not match the opened encoder is a
        // mid-take renegotiation (encode/sw_x264.rs) → pipewire.stream_lost.
        assert!(matches!(
            bus.try_push(synthetic_frame_dims(0, 0, W * 2, H * 2)),
            crate::pipeline::Push::Pushed
        ));

        let deadline = Instant::now() + Duration::from_secs(5);
        while sink.errors().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let errors = sink.errors();
        assert_eq!(errors.len(), 1, "one fault → one error event");
        assert_eq!(error_code(&errors[0]), "pipewire.stream_lost");

        // The stop reply carries the same failure (the event is the early
        // push; the reply is the authoritative answer).
        let err = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect_err("the take faulted");
        assert_eq!(err.code(), "pipewire.stream_lost");
    }

    /// 2.1: a take with an audio plan probes TWO streams — the mixed
    /// AAC track rides the same file as the video, its duration covering
    /// the fed span (the mux round-trip pins packet timing; here the
    /// SESSION wiring is the test subject: plan → workers → container).
    #[test]
    fn audio_take_mixed_from_two_rings_probes_two_streams() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let ring_mic = Arc::new(crate::pipeline::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let ring_desktop = Arc::new(crate::pipeline::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let plan = AudioPlan {
            producers: Vec::new(), // test feeds the rings directly
            channels: vec![
                crate::pipeline::audio::MixSource {
                    ring: ring_mic.clone(),
                    gain: 1.0,
                    channel: crate::capture::audio::AudioChannel::Mic,
                },
                crate::pipeline::audio::MixSource {
                    ring: ring_desktop.clone(),
                    gain: 0.5,
                    channel: crate::capture::audio::AudioChannel::Desktop,
                },
            ],
            row_note: Some(r#"{"source":"test","used":true}"#.into()),
        };
        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                Some(plan),
                None,
                None,
                None,
            )
            .expect("recording starts");

        // Live video (the §5b anchor needs a first frame) + two audio
        // feeders at the 20 ms window pace (960 samples @ 48 kHz).
        let keep = Arc::new(AtomicBool::new(true));
        let video_producer = {
            let bus = bus.clone();
            let keep = keep.clone();
            std::thread::spawn(move || {
                let mut n = 0u64;
                while keep.load(Ordering::Acquire) {
                    // Match the real capture clock. An elapsed first PTS
                    // happened to be 0 on fast runs, but 1 µs on others
                    // was incorrectly compared with epoch-based audio.
                    let pts = wall_us();
                    match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                        crate::pipeline::Push::Pushed => {}
                        crate::pipeline::Push::Full(_) => bus.mark_dropped(),
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_millis(16));
                }
            })
        };
        let feed = |ring: Arc<crate::pipeline::AudioRing>, level: f32| {
            let keep = keep.clone();
            std::thread::spawn(move || {
                let window = [level; 960]; // 480 stereo frames = 20 ms
                while keep.load(Ordering::Acquire) {
                    let started = Instant::now();
                    let _ = ring.try_push(&window);
                    std::thread::sleep(Duration::from_millis(20).saturating_sub(started.elapsed()));
                }
            })
        };
        let feeder_mic = feed(ring_mic, 0.25);
        let feeder_desktop = feed(ring_desktop, 0.2);

        std::thread::sleep(Duration::from_millis(900));
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take with audio");
        keep.store(false, Ordering::Release);
        video_producer.join().expect("video producer");
        feeder_mic.join().expect("mic feeder");
        feeder_desktop.join().expect("desktop feeder");

        assert!(outcome.path.exists());
        assert!(sink.errors().is_empty(), "healthy take, no error events");
        if let Some(report) = ffprobe_json(&outcome.path) {
            let streams = report["streams"].as_array().expect("streams");
            assert_eq!(streams.len(), 2, "video + the one mixed AAC track");
            assert_eq!(streams[0]["codec_name"], "h264");
            assert_eq!(streams[1]["codec_name"], "aac");
            assert_eq!(streams[1]["sample_rate"], "48000");
            // Socket guard for the anchor law (2.1 bug caught by 2.2's
            // instrumentation): a take whose audio anchored against the
            // RAW wall clock (video_base sentinel 0 bug) probes with a
            // garbage multi-hour duration. ~900 ms take → sane bounds.
            let duration: f64 = report["format"]["duration"]
                .as_str()
                .and_then(|d| d.parse().ok())
                .expect("probed duration");
            assert!(
                (0.4..10.0).contains(&duration),
                "audio anchor produced nonsense pts (duration {duration}s)"
            );
        } else {
            eprintln!("ffprobe unavailable — two-stream probe skipped (disk asserts hold)");
        }
    }

    /// 2.1 device-gone law (API §3): a capture source that dies mid-take
    /// renders EXACTLY ONE non-fatal `pipewire.audio_device_gone` event;
    /// the take itself survives and finishes clean with that channel
    /// silent (the pad law).
    /// 2.2 decay law, unit-level: a held reading survives a starving
    /// stretch inside the hold window and reads SILENT after it (bar
    /// falls, never freezes) and when the channel never delivered.
    #[test]
    fn meter_hold_decays_after_quiet() {
        let now = Instant::now();
        let live = MeterReading {
            rms: 0.3,
            peak: 0.3,
        };
        let hold = Duration::from_millis(250);
        assert_eq!(
            effective_meter(live, Some(now - Duration::from_millis(100)), now, hold),
            live,
            "inside the hold the last reading stands"
        );
        assert_eq!(
            effective_meter(live, Some(now - Duration::from_millis(300)), now, hold),
            MeterReading::SILENT,
            "past the hold the bar falls"
        );
        assert_eq!(
            effective_meter(live, None, now, hold),
            MeterReading::SILENT,
            "a channel that never delivered is silent"
        );
    }

    #[test]
    fn device_gone_reports_once_and_the_take_survives() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let ring = Arc::new(crate::pipeline::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let plan = AudioPlan {
            producers: Vec::new(),
            channels: vec![crate::pipeline::audio::MixSource {
                ring: ring.clone(),
                gain: 1.0,
                channel: crate::capture::audio::AudioChannel::Mic,
            }],
            row_note: Some(r#"{"source":"mic","used":true}"#.into()),
        };
        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                Some(plan),
                None,
                None,
                None,
            )
            .expect("recording starts");

        // Live video + a feeder that pushes ~100 ms then drops out the
        // way a killed producer does (disable latch, thread gone).
        let keep = Arc::new(AtomicBool::new(true));
        let video_producer = {
            let bus = bus.clone();
            let keep = keep.clone();
            std::thread::spawn(move || {
                let mut n = 0u64;
                let t0 = Instant::now();
                while keep.load(Ordering::Acquire) {
                    let pts = t0.elapsed().as_micros() as u64;
                    match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                        crate::pipeline::Push::Pushed => {}
                        crate::pipeline::Push::Full(_) => bus.mark_dropped(),
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_millis(16));
                }
            })
        };
        let feeder = {
            let ring = ring.clone();
            std::thread::spawn(move || {
                let window = [0.3f32; 960];
                for _ in 0..5 {
                    let _ = ring.try_push(&window);
                    std::thread::sleep(Duration::from_millis(20));
                }
                ring.disable();
            })
        };
        feeder.join().expect("feeder");

        // Exactly ONE device-gone event, within a bounded wait.
        let deadline = Instant::now() + Duration::from_secs(5);
        while sink.errors().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(error_code(&sink.errors()[0]), "pipewire.audio_device_gone");
        // Grace window: a double-emit latch bug would fire promptly too.
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            sink.errors().len(),
            1,
            "the lost channel reports exactly once"
        );
        // 2.2 payload law: the take carries NO desktop channel, so every
        // meters event's desktop key reads SILENT — both keys are always
        // present on the wire (API §3), the disabled mic reads live
        // while its feeder ran and the LATEST one is back to zero.
        let metered = sink.meters();
        assert!(!metered.is_empty(), "meters flow during the take");
        assert!(
            metered
                .iter()
                .all(|(_, desktop)| *desktop == MeterReading::SILENT),
            "an absent channel is always the silent key"
        );
        assert_eq!(metered.last().expect("latest").0, MeterReading::SILENT);

        // The take goes on and finishes CLEAN (silence padded).
        std::thread::sleep(Duration::from_millis(400));
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("the take survives a device loss");
        keep.store(false, Ordering::Release);
        video_producer.join().expect("video producer");
        assert!(outcome.path.exists());
        if let Some(report) = ffprobe_json(&outcome.path) {
            let streams = report["streams"].as_array().expect("streams");
            assert_eq!(streams.len(), 2, "the audio track is still muxed");
            assert_eq!(streams[1]["codec_name"], "aac");
        } else {
            eprintln!("ffprobe unavailable — two-stream probe skipped (disk asserts hold)");
        }
    }

    /// 2.2: meters ride the audio worker — post-gain readings coalesced
    /// at ≤30 Hz (API §3). Feed two rings: the latest readings are live,
    /// per-channel exact (DC-fed windows), and the EVENT COUNT respects
    /// the ceiling over the fed span.
    #[test]
    fn meters_flow_at_the_contract_ceiling() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let ring_mic = Arc::new(crate::pipeline::audio::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let ring_desktop = Arc::new(crate::pipeline::audio::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let plan = AudioPlan {
            producers: Vec::new(),
            channels: vec![
                crate::pipeline::audio::MixSource {
                    ring: ring_mic.clone(),
                    gain: 1.0,
                    channel: crate::capture::audio::AudioChannel::Mic,
                },
                crate::pipeline::audio::MixSource {
                    ring: ring_desktop.clone(),
                    gain: 0.5,
                    channel: crate::capture::audio::AudioChannel::Desktop,
                },
            ],
            row_note: None,
        };
        let started = Instant::now();
        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                Some(plan),
                None,
                None,
                None,
            )
            .expect("recording starts");

        let keep = Arc::new(AtomicBool::new(true));
        let video_producer = {
            let bus = bus.clone();
            let keep = keep.clone();
            std::thread::spawn(move || {
                let mut n = 0u64;
                let t0 = Instant::now();
                while keep.load(Ordering::Acquire) {
                    let pts = t0.elapsed().as_micros() as u64;
                    match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                        crate::pipeline::Push::Pushed => {}
                        crate::pipeline::Push::Full(_) => bus.mark_dropped(),
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_millis(16));
                }
            })
        };
        let feed = |ring: Arc<crate::pipeline::audio::AudioRing>, level: f32| {
            let keep = keep.clone();
            std::thread::spawn(move || {
                let window = [level; 960]; // 480 stereo frames = 20 ms
                while keep.load(Ordering::Acquire) {
                    let push_started = Instant::now();
                    let _ = ring.try_push(&window);
                    std::thread::sleep(
                        Duration::from_millis(20).saturating_sub(push_started.elapsed()),
                    );
                }
            })
        };
        let feeder_mic = feed(ring_mic, 0.25);
        let feeder_desktop = feed(ring_desktop, 0.2);

        std::thread::sleep(Duration::from_millis(700));
        let elapsed = started.elapsed();
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take");
        keep.store(false, Ordering::Release);
        video_producer.join().expect("video producer");
        feeder_mic.join().expect("mic feeder");
        feeder_desktop.join().expect("desktop feeder");
        assert!(outcome.path.exists());

        let events = sink.meters();
        assert!(!events.is_empty(), "the strip sees live bars");
        // Post-gain law: mic at level 100 (gain 1.0) reads its DC 0.25;
        // desktop at gain 0.5 reads 0.1 — independent, per-channel.
        let (mic, desktop) = events.last().expect("latest reading");
        assert!(
            (mic.rms - 0.25).abs() < 0.06,
            "mic reads its own post-gain level, got {mic:?}"
        );
        assert!(
            (desktop.rms - 0.1).abs() < 0.06,
            "desktop reads its own post-gain level, got {desktop:?}"
        );
        // Ceiling: the worker coalesces to ≤30 Hz (34 ms period ≈ 21
        // events over this span). The small slack absorbs scheduler and
        // stop-drain jitter; BOTH mutants die here — unthrottled supply
        // (~50 Hz) and a 1 ms period land far above the line.
        let ceiling = elapsed.as_millis() / 34 + 6;
        assert!(
            (events.len() as u128) <= ceiling,
            "{} meter events in {} ms breaches the 30 Hz contract",
            events.len(),
            elapsed.as_millis()
        );
    }

    /// PLAN 1.4: a faulted take must not block the next recording. The
    /// error event tells the UI the take is over; the session frees its
    /// slot so "record again" works without an intervening stop.
    #[test]
    fn a_faulted_take_does_not_block_the_next_recording() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");
        assert!(matches!(
            bus.try_push(synthetic_frame_dims(0, 0, W * 2, H * 2)),
            crate::pipeline::Push::Pushed
        ));

        let deadline = Instant::now() + Duration::from_secs(5);
        while sink.errors().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!sink.errors().is_empty(), "the fault was reported");

        // The next take starts — the faulted worker was reaped.
        let next = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("the faulted take freed the slot");
        // Real frames: the zero-frame guard (capture.no_frames) must not
        // be what this test exercises — it is about slot recovery.
        produce(&bus, 3, 0);
        wait_drained(&bus);
        handle
            .stop(&next.recording_id)
            .expect("accepted")
            .expect("clean take");
    }

    /* ---------- 2.3 pause/resume (API §2.3) ---------- */

    impl TestSink {
        /// `(recording_id, elapsed_ms, paused)` triples — the 2.3 tick
        /// shape (the phase rides every tick, API §3).
        fn tick_phases(&self) -> Vec<(String, u64, bool)> {
            self.all()
                .iter()
                .filter_map(|event| match event {
                    SessionEvent::Tick {
                        recording_id,
                        elapsed_ms,
                        paused,
                    } => Some((recording_id.clone(), *elapsed_ms, *paused)),
                    _ => None,
                })
                .collect()
        }
    }

    /// PLAN 2.3 verify: the pause window is NOT in the take. Frames fed
    /// while paused are discarded, elapsed freezes (constant `elapsed_ms`
    /// across paused ticks), the resumed take's pts continues where the
    /// pause began (one continuous stream, pts never regresses), and the
    /// final duration counts only recorded content.
    #[test]
    fn pause_resume_excludes_paused_time_and_ticks_the_phase() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");

        // Segment 1: ~1.1 s of content on the WALL clock (60 fps real
        // pacing; a synthetic fixed base would not span the pause — see
        // produce_wall). >1 s so a pre-pause 1 Hz tick is guaranteed.
        produce_wall(&bus, 66, Duration::from_micros(16_666));
        wait_drained(&bus);

        handle
            .pause(&info.recording_id)
            .expect("pause while recording");
        // Ticks during the pause must carry phase `paused` with a FROZEN
        // elapsed (exact equality — the pause wall is subtracted, not
        // guessed). ~2.3 s of pause ⇒ at least one 1 Hz tick pair.
        std::thread::sleep(Duration::from_millis(2_300));

        // Segment 2 (discard window): 30 frames fed INTO the pause must
        // not appear in the file. The pause loop keeps draining, so the
        // producers never wedge.
        produce(&bus, 30, wall_us());
        wait_drained(&bus);

        handle
            .resume(&info.recording_id)
            .expect("resume while paused");

        // Segment 3: another ~1.1 s of content after the pause — again
        // >1 tick period so a post-resume `recording` tick lands before
        // stop (the phase-flap law needs ticks on BOTH sides). The wall
        // clock having continued through the pause, raw pts now sit
        // ≥2.3 s past base, past the banked pause total.
        produce_wall(&bus, 66, Duration::from_micros(16_666));
        wait_drained(&bus);

        let outcome = handle
            .stop(&info.recording_id)
            .expect("stop accepted while idle (never paused at stop)")
            .expect("clean take");

        // 2×~1.1 s of wall content (+ drain slop) — the paused 2.3 s and
        // the 30 discard-window frames are GONE (a shift-removal bug
        // probes as ~5.5 s; the discard-window frames would inflate the
        // packet count instead — probed below).
        assert!(
            (1_900..=3_000).contains(&outcome.duration_ms),
            "durationMs must exclude the pause + discarded frames, got {}",
            outcome.duration_ms
        );

        // Ticks: recording → (≥1 paused) → recording, and the paused
        // stretch froze `elapsedMs` while the phase flapped.
        let ticks = sink.tick_phases();
        assert!(
            ticks.len() >= 4,
            "tick cadence over a ~4 s take: got {}",
            ticks.len()
        );
        assert!(!ticks[0].2, "pre-pause ticks are 'recording'");
        let paused_ticks: Vec<(String, u64)> = ticks
            .iter()
            .filter(|(_, _, paused)| *paused)
            .map(|(id, ms, _)| (id.clone(), *ms))
            .collect();
        assert!(!paused_ticks.is_empty(), "at least one paused tick");
        assert!(
            paused_ticks.iter().all(|(id, _)| id == &info.recording_id),
            "paused ticks carry the take id"
        );
        let frozen = paused_ticks[0].1;
        assert!(
            paused_ticks.iter().all(|(_, ms)| *ms == frozen),
            "elapsed freezes during pause (values: {:?})",
            paused_ticks.iter().map(|(_, ms)| *ms).collect::<Vec<_>>()
        );
        let last = ticks.last().expect("a final tick").clone();
        assert!(!last.2, "post-resume ticks return to 'recording'");
        // The frozen value must sit between the pre-pause elapsed and the
        // post-resume elapsed (elapsed resumes FROM the frozen point —
        // stale-resume bugs jump backwards or re-count the pause).
        let pre: Vec<u64> = ticks
            .iter()
            .take_while(|(_, _, p)| !*p)
            .map(|(_, ms, _)| *ms)
            .collect();
        let post: Vec<u64> = ticks
            .iter()
            .skip_while(|(_, _, p)| !*p) // over the pre-pause ticks
            .skip_while(|(_, _, p)| *p) // over the paused ticks
            .map(|(_, ms, _)| *ms)
            .collect();
        if let (Some(&last_pre), Some(&first_post)) = (pre.last(), post.first()) {
            assert!(
                first_post >= frozen && frozen > last_pre,
                "elapsed must resume from the frozen point (last_pre {last_pre}, frozen {frozen}, first_post {first_post})"
            );
        }

        // ffprobe: one continuous h264 stream whose duration excludes the
        // pause (kill-scoped double check of the pts-shift law), and the
        // encoded packet count — with wall pts the discard law's second
        // signal (duration alone survives a removed discard gate here:
        // mid-pause pts would clamp onto the tail with the same span).
        if let Some(report) = ffprobe_json(&outcome.path) {
            let stream = &report["streams"][0];
            assert_eq!(stream["codec_name"], "h264");
            let duration: f64 = report["format"]["duration"]
                .as_str()
                .and_then(|d| d.parse().ok())
                .expect("container duration");
            assert!(
                (1.8..=3.2).contains(&duration),
                "probed duration must exclude the pause, got {duration}s"
            );
            // 132 encoded frames (2 × 66) — a removed discard gate pushes
            // this past 160 (the discard window's 30 frames encoded too).
            let packets = std::process::Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-count_packets",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=nb_read_packets",
                    "-of",
                    "csv=p=0",
                ])
                .arg(&outcome.path)
                .output()
                .ok()
                .filter(|out| out.status.success())
                .map(|out| {
                    String::from_utf8_lossy(&out.stdout)
                        .trim()
                        .parse::<u64>()
                        .expect("packet count")
                });
            if let Some(packets) = packets {
                assert!(
                    (125..=145).contains(&packets),
                    "exactly the 132 recorded frames may be encoded, got {packets}"
                );
            }
        } else {
            eprintln!("ffprobe unavailable — size/duration asserts only");
        }
    }

    /// The monotonic clamp (2.3 red-caught): a producer clock that
    /// rewinds must never hand the muxer a regressing pts — matroska
    /// requires per-stream monotonic pts and the write fails hard
    /// otherwise. The clamp is the sanitizer of last resort; duration
    /// then measures the producer's OWN span (the rewind is squeezed,
    /// not dropped — refuse-to-lie beats pretend-it-never-happened).
    #[test]
    fn a_regressing_producer_clock_cannot_regress_the_stream() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");
        // Raw pts jump forward, then step BACK (a producer clock stepping
        // under NTP, or any reordered-clock pathology).
        let _ = bus.try_push(synthetic_frame(0, 10_000_000));
        wait_drained(&bus);
        let _ = bus.try_push(synthetic_frame(1, 11_000_000));
        wait_drained(&bus);
        let _ = bus.try_push(synthetic_frame(2, 10_500_000));
        wait_drained(&bus);

        // Without the clamp this stop dies with disk.write_failed (the
        // mux write rejects regressing pts); the take must survive clean.
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take — the clamp sanitized the rewind");
        // The rewound frame rides at last_rel + 1 µs, so the last rel is
        // the producer's own maximum (frame 2's 1.0 s), not the rewind's
        // 0.5 s — the span is kept, the regression is not.
        assert!(
            (1_000..=1_005).contains(&outcome.duration_ms),
            "duration = the producer's own span, got {}",
            outcome.duration_ms
        );
    }

    /// PLAN 2.3 live gate, run by hand on a live desktop:
    ///
    /// ```sh
    /// SSP_LOG_LEVEL=info cargo test --manifest-path src-tauri/Cargo.toml \
    ///   manual_pause_excludes_paused_time -- --ignored --nocapture
    /// ```
    ///
    /// A consent dialog appears; approve it. The gate records ~3 s of the
    /// real monitor, pauses 5 s (timer must freeze, phase = paused), then
    /// records ~3 s more. Assertions: the probed duration centers on ~6 s
    /// — NOT ~11 s (the pause is excluded from the encoded timeline by
    /// the wall-clock shift) — and the take survives with no errors.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "manual gate: needs a live portal + a human consent click"]
    async fn manual_pause_excludes_paused_time() {
        use crate::capture::LiveSource;
        use crate::capture::portal::select_monitor;
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .with_test_writer()
            .try_init();

        let source_id = crate::capture::new_source_id();
        let lost_id = source_id.clone();
        let (mut session, reply) = select_monitor(source_id.clone(), move |reason| {
            tracing::error!(source = %lost_id, reason, "capture source lost during manual pause gate");
        })
        .await
        .expect("portal consent + stream");
        assert_eq!(reply.kind, "monitor");
        assert!(reply.capabilities.width > 0 && reply.capabilities.height > 0);

        let handle = RecordingHandle::new();
        let bus = session
            .frame_bus()
            .expect("monitor source produces a recording stream");
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();
        let info = handle
            .start(
                bus.clone(),
                session.geometry(),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");

        // ~3 s content.
        tokio::time::sleep(Duration::from_secs(3)).await;
        handle.pause(&info.recording_id).expect("pause");
        tracing::info!("PAUSED — the on-screen timer must freeze");
        tokio::time::sleep(Duration::from_secs(5)).await;
        handle.resume(&info.recording_id).expect("resume");
        tokio::time::sleep(Duration::from_secs(3)).await;

        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean live take");
        session.stop_frames();
        session.close().await;

        let paused_ticks = sink
            .tick_phases()
            .iter()
            .filter(|(_, _, paused)| *paused)
            .count();
        tracing::info!(
            duration_ms = outcome.duration_ms,
            paused_ticks,
            "manual pause gate outcome"
        );
        assert!(paused_ticks >= 3, "5 s pause ⇒ ≥3 paused ticks");
        assert!(
            (4_000..=8_500).contains(&outcome.duration_ms),
            "duration must exclude the 5 s pause (~6 s of content), got {} ms",
            outcome.duration_ms
        );
        if let Some(report) = ffprobe_json(&outcome.path) {
            let duration: f64 = report["format"]["duration"]
                .as_str()
                .and_then(|d| d.parse().ok())
                .expect("probed duration");
            assert!(
                (4.0..=8.5).contains(&duration),
                "probed duration excludes the pause, got {duration}s"
            );
        }
    }

    /// API §2.3 error law: pause needs an actively recording take with the
    /// right id; resume needs a PAUSED one; stop-while-paused is legal.    #[test]
    fn pause_and_resume_state_matrix_is_bad_state_governed() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");

        // Pause with nothing running → ipc.bad_state.
        let err = handle.pause("rec_nobody").unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                TestSink::new(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");
        produce(&bus, 10, 0);

        // Wrong id → bad_state, session survives.
        let err = handle.pause("rec_wrong").unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
        // Resume before any pause → bad_state ("not paused" law).
        let err = handle.resume(&info.recording_id).unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");

        handle.pause(&info.recording_id).expect("pause");
        // Double pause — the take is not "recording" anymore → bad_state.
        let err = handle.pause(&info.recording_id).unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
        // Wrong-id resume while paused → bad_state.
        let err = handle.resume("rec_wrong").unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");

        // Stop while paused: legal, bounded, clean.
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take");
        assert!(outcome.path.exists());
        // The paused take still recorded its pre-pause segment only.
        assert!(outcome.duration_ms > 0, "segment 1 was encoded");

        // post-stop pause/resume → bad_state again.
        let err = handle.pause(&info.recording_id).unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
        let err = handle.resume(&info.recording_id).unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
    }

    /// 2.3 + 2.1 cross-law: pausing a take WITH audio keeps both streams
    /// continuous (per-stream monotonic pts), keeps A/V in step, and
    /// excludes the pause from both. The audio clock is a sample-count —
    /// pause gates its windows, so continuity is proven by sane durations.
    /// Meters decay to SILENT during the pause (post-gain law: nothing is
    /// recorded while paused; 2.2 hold gives the bars ≥250 ms of grace).
    #[test]
    fn pause_keeps_av_streams_continuous_and_excludes_pause() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let ring_mic = Arc::new(crate::pipeline::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let ring_desktop = Arc::new(crate::pipeline::AudioRing::new(
            crate::pipeline::audio::DEFAULT_RING_CAPACITY,
        ));
        let plan = AudioPlan {
            producers: Vec::new(),
            channels: vec![
                crate::pipeline::audio::MixSource {
                    ring: ring_mic.clone(),
                    gain: 1.0,
                    channel: crate::capture::audio::AudioChannel::Mic,
                },
                crate::pipeline::audio::MixSource {
                    ring: ring_desktop.clone(),
                    gain: 0.5,
                    channel: crate::capture::audio::AudioChannel::Desktop,
                },
            ],
            row_note: None,
        };
        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                Some(plan),
                None,
                None,
                None,
            )
            .expect("recording starts");

        let keep = Arc::new(AtomicBool::new(true));
        let video_producer = {
            let bus = bus.clone();
            let keep = keep.clone();
            std::thread::spawn(move || {
                let mut n = 0u64;
                let t0 = Instant::now();
                while keep.load(Ordering::Acquire) {
                    let pts = t0.elapsed().as_micros() as u64;
                    match bus.try_push(synthetic_frame(n % 1_000, pts)) {
                        crate::pipeline::Push::Pushed => {}
                        crate::pipeline::Push::Full(_) => bus.mark_dropped(),
                    }
                    n += 1;
                    std::thread::sleep(Duration::from_millis(16));
                }
            })
        };
        let feed = |ring: Arc<crate::pipeline::AudioRing>, level: f32| {
            let keep = keep.clone();
            std::thread::spawn(move || {
                let window = [level; 960]; // 480 stereo frames = 20 ms
                while keep.load(Ordering::Acquire) {
                    let started = Instant::now();
                    let _ = ring.try_push(&window);
                    std::thread::sleep(Duration::from_millis(20).saturating_sub(started.elapsed()));
                }
            })
        };
        let feeder_mic = feed(ring_mic, 0.25);
        let feeder_desktop = feed(ring_desktop, 0.2);

        // 1 s of content → 2.2 s pause → 1 s more.
        std::thread::sleep(Duration::from_millis(1_000));
        handle.pause(&info.recording_id).expect("pause");
        std::thread::sleep(Duration::from_millis(2_200));
        handle.resume(&info.recording_id).expect("resume");
        std::thread::sleep(Duration::from_millis(1_000));

        let wall_ms = 4_200; // lower bound of the take's wall time
        let outcome = handle
            .stop(&info.recording_id)
            .expect("accepted")
            .expect("clean take");
        keep.store(false, Ordering::Release);
        video_producer.join().expect("video producer");
        feeder_mic.join().expect("mic feeder");
        feeder_desktop.join().expect("desktop feeder");

        // The pause (≈2.2 s) must be gone from the reported duration.
        assert!(
            outcome.duration_ms + 1_500 < wall_ms,
            "duration {} must exclude the ~2.2 s pause (wall ≥ {wall_ms})",
            outcome.duration_ms
        );
        assert!(sink.errors().is_empty(), "healthy take, no error events");

        if let Some(report) = ffprobe_json(&outcome.path) {
            let streams = report["streams"].as_array().expect("streams");
            assert_eq!(streams.len(), 2, "video + the one mixed AAC track");
            let duration: f64 = report["format"]["duration"]
                .as_str()
                .and_then(|d| d.parse().ok())
                .expect("probed duration");
            assert!(
                (1.2..2.9).contains(&duration),
                "container duration must exclude the ~2.2 s pause, got {duration}s"
            );
            // A/V stay within one second of each other (the sample-count
            // clock and the pts-shifted wall clock measure the same
            // recorded content — a discontinuity bug separates them).
            // (Both streams' durations are the format duration here; the
            // continuity evidence is the sane, non-inflated total.)
        } else {
            eprintln!("ffprobe unavailable — duration asserts only");
        }

        // Meters: the post-gain bars FALL during the pause — the audio
        // worker stops refreshing liveness while paused, so the log's
        // first live reading (pre-pause content recording) is eventually
        // followed by fully-SILENT readings (2.2 decay past the hold).
        // The only healthy-take path to silence after liveness is the
        // pause gate; post-resume liveness returns, so this asserts the
        // DECAY existed, not that the stream ended silent.
        let meter_log = sink.meters();
        let first_live = meter_log
            .iter()
            .position(|(mic, desk)| *mic != MeterReading::SILENT || *desk != MeterReading::SILENT)
            .expect("live meters while recording");
        assert!(
            meter_log[first_live + 1..]
                .iter()
                .any(|(mic, desk)| *mic == MeterReading::SILENT && *desk == MeterReading::SILENT),
            "meters decay to SILENT during the pause (post-gain law)"
        );
    }

    /// 2.5 chapter markers: three flags accumulate in memory, serialize
    /// with snake_case `offset_ms` (DATABASE.md §2.1), and ride the
    /// StopOutcome.chapter_json. Auto-named `flag-N` when label is None.
    #[test]
    fn flag_accumulates_chapters_and_serializes_at_stop() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");

        // Produce ~1 s of content so elapsedMs has substance.
        produce(&bus, 60, 1_000_000);
        wait_drained(&bus);

        // Flag 1: explicit label.
        let c1 = handle
            .flag(&info.recording_id, Some("intro".into()))
            .expect("flag 1");
        assert_eq!(c1.label, "intro");
        assert!(c1.offset_ms > 0, "first flag has positive offset");

        // Flag 2: auto-named.
        let c2 = handle.flag(&info.recording_id, None).expect("flag 2");
        assert_eq!(c2.label, "flag-2", "auto-name uses 1-based count");

        // Flag 3: another auto-name.
        let c3 = handle.flag(&info.recording_id, None).expect("flag 3");
        assert_eq!(c3.label, "flag-3");

        // Stop and verify the chapter_json is in the outcome.
        let outcome = handle
            .stop(&info.recording_id)
            .expect("stop accepted")
            .expect("clean take");

        assert!(
            outcome.chapter_json.is_some(),
            "StopOutcome carries chapter_json"
        );
        let chapters: Vec<ChapterMarker> =
            serde_json::from_str(outcome.chapter_json.as_ref().unwrap()).expect("valid JSON");
        assert_eq!(chapters.len(), 3, "all three markers persisted");
        assert_eq!(chapters[0].label, "intro");
        assert_eq!(chapters[1].label, "flag-2");
        assert_eq!(chapters[2].label, "flag-3");
        // Offsets are monotonic (recording-relative clock never rewinds).
        assert!(chapters[0].offset_ms <= chapters[1].offset_ms);
        assert!(chapters[1].offset_ms <= chapters[2].offset_ms);
        // Verify snake_case serialization (DATABASE.md §2.1).
        let json = outcome.chapter_json.as_ref().unwrap();
        assert!(
            json.contains("offset_ms"),
            "serialized with snake_case offset_ms"
        );
        assert!(!json.contains("offsetMs"), "no camelCase in stored JSON");
    }

    /// 2.5: flag on a non-existent recording id returns ipc.bad_state.
    #[test]
    fn flag_unknown_recording_id_is_bad_state() {
        let handle = RecordingHandle::new();
        let err = handle
            .flag("rec_does_not_exist", Some("x".into()))
            .unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
    }

    /// 2.5: flag after stop is bad_state (session is gone).
    #[test]
    fn flag_after_stop_is_bad_state() {
        let handle = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(8));
        let dir = tempfile::tempdir().expect("tmp dir");
        let sink = TestSink::new();

        let info = handle
            .start(
                bus.clone(),
                (W, H),
                dir.path(),
                "first-rec",
                "mkv",
                sink.clone(),
                None,
                None,
                None,
                None,
            )
            .expect("recording starts");
        produce(&bus, 5, 0);
        wait_drained(&bus);
        handle
            .stop(&info.recording_id)
            .expect("stop")
            .expect("clean");

        // The session is cleared; flag must fail.
        let err = handle.flag(&info.recording_id, None).unwrap_err();
        assert_eq!(err.code(), "ipc.bad_state");
    }

    /// 6.2: strftime expansion for output naming pattern.
    #[test]
    fn naming_pattern_expands_strftime_tokens() {
        // %Y-%m-%d-%H%M → e.g. "2026-11-12-1327" (exact values depend on wall
        // clock; we check format, not exact value).
        let expanded = strftime_expand("%Y-%m-%d-%H%M");
        assert_eq!(
            expanded.len(),
            15,
            "YYYY-MM-DD-HHMM is 15 chars: {expanded}"
        );
        assert_eq!(&expanded[0..2], "20", "year should be 20xx: {expanded}");
        assert_eq!(&expanded[4..5], "-", "dash after year: {expanded}");
        assert_eq!(&expanded[7..8], "-", "dash after month: {expanded}");
        assert_eq!(&expanded[10..11], "-", "dash after day: {expanded}");
        assert!(
            expanded[11..13].chars().all(|c| c.is_ascii_digit()),
            "hour is digits: {expanded}"
        );
        assert!(
            expanded[13..15].chars().all(|c| c.is_ascii_digit()),
            "minute is digits: {expanded}"
        );

        // Literal text passes through.
        assert_eq!(strftime_expand("first-rec"), "first-rec");

        // %% escapes to %.
        assert_eq!(strftime_expand("100%%"), "100%");

        // Unknown token passes through literally.
        assert_eq!(strftime_expand("%Z"), "%Z");
    }

    /// 6.2: remux MKV→MP4 via ffmpeg stream copy.
    #[test]
    fn remux_mkv_to_mp4_stream_copy() {
        use crate::encode::Encoder;
        use crate::encode::sw_x264::{self, SwX264};
        use crate::pipeline::Frame;

        let tmp = tempfile::tempdir().expect("tmp dir");
        let mkv_path = tmp.path().join("input.mkv");

        // Encode a tiny MKV to remux.
        let (builder, venc) = MuxerBuilder::create(&mkv_path)
            .expect("create muxer")
            .add_video(&VideoSpec {
                codec: ff::codec::Id::H264,
                width: 320,
                height: 240,
                pix_fmt: ff::format::Pixel::YUV420P,
                frame_rate: (60, 1),
                options: sw_x264::options(),
            })
            .expect("video stream");
        let mut muxer = builder.write_header().expect("header");
        let mut encoder = SwX264::from_open(venc);

        // Encode a few frames.
        for n in 0..30_u64 {
            let stride = 320usize * 4;
            let mut data = vec![0u8; stride * 240];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let frame = Frame {
                width: 320,
                height: 240,
                stride: stride as u32,
                layout: crate::pipeline::FrameLayout::Bgrx,
                pts_us: n * 16_667,
                data,
            };
            let packets = encoder.encode(&frame).expect("encode");
            muxer.write(&packets).expect("write");
        }
        let tail = encoder.finish().expect("encoder finish");
        muxer.write(&tail).expect("tail write");
        muxer.finalize().expect("muxer finalize");
        assert!(mkv_path.exists(), "MKV input exists");

        // Remux to MP4.
        let mp4_path = remux_mkv_to_mp4(&mkv_path).expect("remux succeeds");
        assert!(mp4_path.exists(), "MP4 output exists");
        assert_eq!(mp4_path.extension().unwrap(), "mp4", "extension is .mp4");

        // The MP4 should probe as a valid file with h264 video.
        let report = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_streams",
                "-select_streams",
                "v:0",
                mp4_path.to_str().unwrap(),
            ])
            .output()
            .expect("ffprobe present");
        assert!(report.status.success(), "ffprobe succeeded on MP4");
    }
}
