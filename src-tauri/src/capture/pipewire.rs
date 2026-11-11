use crate::capture::preview::{self, PreviewMailbox};
use crate::pipeline::{Frame, FrameBus, FrameLayout, Push};
use crate::util::error::CoreError;
use pipewire as pw;
use pw::spa;
use std::os::fd::OwnedFd;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/* PipeWire stream consumption — ARCHITECTURE §2: the frame bus lives HERE
and below; frames never cross the IPC (API §6 standing flag). Task 1.1
scope: attach to the portal's remote, negotiate a raw video format, and
count frames with a 1 Hz fps debug log (PLAN 1.1 verify). Task 1.2 add
the SpSC frame bus; task 1.3 makes THIS module its producer — the process
callback copies pixels into a pipeline::Frame and tries the bus once
(never blocks, §6: the PipeWire data thread cannot wait on the encoder). */

/// Fps reporting window for the debug log (one line per second, not per
/// frame — tracing cadence law, ARCHITECTURE §6).
const FPS_WINDOW: Duration = Duration::from_secs(1);

/// How often the run loop wakes to check the stop flag. Short enough that
/// release feels immediate; long enough to never busy the loop.
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// At most once per stream lifetime: the reason the stream died.
type OnLost = Box<dyn FnOnce(&str) + Send>;

/// The lost-notification slot, shared by the PipeWire callbacks and the
/// thread's own early-return paths — whoever sees the failure first wins.
type LostSlot = Arc<std::sync::Mutex<Option<OnLost>>>;

fn report_lost(slot: &LostSlot, reason: &str) {
    // Publish loss before notifying readers (ARCHITECTURE §4.1). Release
    // the lock so the callback can inspect liveness without deadlocking.
    let callback = slot.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(callback) = callback {
        callback(reason);
    }
}

/// Capture-time stamp: wall-clock µs. The recording session anchors on
/// the FIRST frame (`session.rs` run_session), so only deltas matter.
fn frame_pts_us() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

/// The negotiated raw format (param_changed → process handoff on the
/// same data thread — no cross-thread sync needed).
struct Negotiated {
    width: u32,
    height: u32,
    layout: FrameLayout,
}

/// Offered formats only (the pod offers BGRx first, BGRA second).
fn layout_from_spa(format: spa::param::video::VideoFormat) -> Option<FrameLayout> {
    match format {
        spa::param::video::VideoFormat::BGRx => Some(FrameLayout::Bgrx),
        spa::param::video::VideoFormat::BGRA => Some(FrameLayout::Bgra),
        other => {
            tracing::warn!(
                format = other.as_raw(),
                "unexpected negotiated video format"
            );
            None
        }
    }
}

/// Per-stream accounting — lives entirely on the PipeWire data thread; the
/// callbacks get `&mut self` there.
struct FrameCounting {
    total_frames: Arc<AtomicU64>,
    window_start: Option<Instant>,
    window_frames: u64,
    /// Frames after the stream left `Streaming` are teardown noise.
    exited: bool,
    on_lost: LostSlot,
    /// Encode-tier bus (task 1.3): Some = frames are produced into it.
    frame_bus: Option<Arc<FrameBus>>,
    /// Preview-stills tier (task 3.5): latest-wins mailbox fed at ≤8fps,
    /// gated BEFORE the pixel copy (§6: preview drops before encode).
    preview: Option<Arc<PreviewMailbox>>,
    /// Set from the Format param_changed before the first process call.
    negotiated: Option<Negotiated>,
    /// First-occurrence diagnostics (§6: cadence law — these fire ONCE,
    /// not per frame; they exist because every branch below them is a
    /// silent `return` whose outcome is invisible at info level).
    first_drop_reason: Option<&'static str>,
}

/// The EnumFormat we offer at connect — authored from measured caps
/// (pw-dump of KWin's screencast node, session 1919×1079 and 1920×1080
/// runs): BGRx/BGRA only, size defaulted to the portal's reported
/// geometry (always the node's fixed size), framerate range CONTAINING
/// 0/1 (pinned 60 failed: [60..60] ∩ {0/1} = empty).
///
/// NO VideoModifier property. Modifier `0` is DRM_FORMAT_MOD_INVALID
/// ("dmabuf, implicit modifier"), not "system memory" — and KWin's
/// screencast (screencaststream.cpp `onStreamParamChanged`) allocates
/// DMABUF buffers whenever a modifier key survives into the fixated
/// format. The earlier `{0}` pin therefore yielded unmapped DMABUF
/// every frame (`data.data()` == None) while the counter kept
/// reporting 60 fps — the task-1.5 zero-frame take. Without the key
/// KWin resets its dmabuf params and allocates MemFd buffers, which
/// `MAP_BUFFERS` maps for us. (Leaving the modifier out of a
/// *pre-fixation* offer is a different pod than withholding it from a
/// fixate response; pw auto-fixation copies our offer, so the offer
/// itself must be modifier-free.)
///
/// Extracted so the pod's shape stays under test — see the `tests` mod.
fn format_offer_pod(size: (u32, u32)) -> pw::spa::pod::Object {
    pw::spa::pod::object!(
        pw::spa::utils::SpaTypes::ObjectParamFormat,
        pw::spa::param::ParamType::EnumFormat,
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::MediaType,
            Id,
            pw::spa::param::format::MediaType::Video
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::MediaSubtype,
            Id,
            pw::spa::param::format::MediaSubtype::Raw
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            pw::spa::param::video::VideoFormat::BGRx,
            pw::spa::param::video::VideoFormat::BGRx,
            pw::spa::param::video::VideoFormat::BGRA
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            pw::spa::utils::Rectangle {
                width: size.0.max(1),
                height: size.1.max(1)
            },
            pw::spa::utils::Rectangle {
                width: 1,
                height: 1
            },
            pw::spa::utils::Rectangle {
                width: 4096,
                height: 4096
            }
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            // 0/1 = "variable"; must include 0 or KWin's fixed {0/1}
            // never intersects (the task-1.2 frame bus paces output).
            pw::spa::utils::Fraction { num: 0, denom: 1 },
            pw::spa::utils::Fraction { num: 0, denom: 1 },
            pw::spa::utils::Fraction {
                num: 1000,
                denom: 1
            }
        ),
    )
}

impl FrameCounting {
    fn count(&mut self, frame_bytes: u32) {
        if self.exited || frame_bytes == 0 {
            return;
        }
        self.window_frames += 1;
        self.total_frames.fetch_add(1, Ordering::Relaxed);

        let now = Instant::now();
        match self.window_start {
            None => self.window_start = Some(now),
            Some(start) if now.duration_since(start) >= FPS_WINDOW => {
                let elapsed = now.duration_since(start).as_secs_f64();
                tracing::debug!(
                    fps = (self.window_frames as f64 / elapsed) as u64,
                    "capture frames flowing"
                );
                self.window_start = Some(now);
                self.window_frames = 0;
            }
            Some(_) => {}
        }
    }

    // &mut: the state_changed callback is the only loss reporter, and the
    // exited flag must persist — frames queued before teardown count 0.
    fn lost(&mut self, reason: &str) {
        self.exited = true;
        report_lost(&self.on_lost, reason);
    }

    /// Reports a per-frame drop ONCE (1.5 visual-pass lesson: the silent
    /// `return`s below masked a zero-frame take behind a healthy 60 fps
    /// counter — every one of them must leave one line of evidence).
    fn note_drop(&mut self, reason: &'static str) {
        if self.first_drop_reason.is_none() {
            self.first_drop_reason = Some(reason);
            tracing::debug!("capture frame dropped in producer once: {reason}");
        }
    }
}

/// Live consumption guard for one portal stream: `stop()` ends the data
/// thread and joins it. Dropping the guard stops too.
pub struct StreamGuard {
    stop: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
    lost_slot: LostSlot,
    thread: Option<JoinHandle<()>>,
}

impl StreamGuard {
    pub fn is_live(&self) -> bool {
        self.lost_slot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_some()
    }

    /// Frames received so far — the manual-gate hook (PLAN 1.1 verify:
    /// ≥ 1 fps). Task 1.2's frame bus becomes the real consumer, which is
    /// why the reader may look dead until then.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn frames(&self) -> u64 {
        self.frames.load(Ordering::Relaxed)
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Attach a capture stream to the portal's PipeWire remote. Returns
/// immediately; consumption runs on a dedicated thread. `on_lost` fires at
/// most once if the stream errors or disconnects underneath us (e.g.
/// compositor restart) — the `source/lost` event rides on it.
/// `frame_bus`: the encode-tier bus to feed (task 1.3); `None` keeps the
/// count-only behaviour (manual gate path). `preview`: the stills mailbox
/// (task 3.5) — fed at ≤8fps regardless of the encode bus.
pub fn start(
    node_id: u32,
    size: (u32, u32),
    remote_fd: OwnedFd,
    frame_bus: Option<Arc<FrameBus>>,
    preview: Option<Arc<PreviewMailbox>>,
    on_lost: OnLost,
) -> Result<StreamGuard, CoreError> {
    let stop = Arc::new(AtomicBool::new(false));
    let frames = Arc::new(AtomicU64::new(0));
    let lost_slot: LostSlot = Arc::new(std::sync::Mutex::new(Some(on_lost)));
    let thread = std::thread::Builder::new()
        .name("pipewire-frames".into())
        .spawn({
            let stop = stop.clone();
            let frames = frames.clone();
            let lost_slot = lost_slot.clone();
            move || {
                run_loop(
                    node_id, size, remote_fd, frame_bus, preview, stop, frames, lost_slot,
                )
            }
        })
        .map_err(|_| {
            CoreError::pipewire(
                "pipewire.stream_lost",
                true,
                "The capture stream could not start.",
            )
        })?;
    Ok(StreamGuard {
        stop,
        frames,
        lost_slot,
        thread: Some(thread),
    })
}

/// One PipeWire main loop on OUR thread, dispatching until the stop flag
/// rises. Loop-owned objects drop in declaration order on the way out
/// (listener before stream before core/context) — clean teardown order.
/// All early-return paths report through `on_lost`, never panic (§4.2).
#[allow(clippy::too_many_arguments)] // thread entry point; grouping would refactor working teardown order
fn run_loop(
    node_id: u32,
    size: (u32, u32),
    remote_fd: OwnedFd,
    frame_bus: Option<Arc<FrameBus>>,
    preview: Option<Arc<PreviewMailbox>>,
    stop: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
    lost_slot: LostSlot,
) {
    pw::init();
    let lost = |reason: &str| report_lost(&lost_slot, reason);
    let counting = FrameCounting {
        total_frames: frames,
        window_start: None,
        window_frames: 0,
        exited: false,
        on_lost: lost_slot.clone(),
        frame_bus,
        preview,
        negotiated: None,
        first_drop_reason: None,
    };

    let Ok(mainloop) = pw::main_loop::MainLoopRc::new(None) else {
        return lost("pipewire mainloop init failed");
    };
    let Ok(context) = pw::context::ContextRc::new(&mainloop, None) else {
        return lost("pipewire context init failed");
    };
    let Ok(core) = context.connect_fd(remote_fd, None) else {
        return lost("pipewire remote connect failed");
    };
    let Ok(stream) = pw::stream::StreamBox::new(
        &core,
        "screen-studio-capture",
        pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    ) else {
        return lost("pipewire stream creation failed");
    };

    // Format pod — authored from measured caps (pw-dump of KWin's
    // screencast node, session 1919×1079 and 1920×1080 runs); the
    // builder lives in `format_offer_pod` so its shape stays testable,
    // and deliberately carries NO VideoModifier key (the doc comment
    // there explains why — it forced DMABUF buffers on KWin).
    let format = format_offer_pod(size);
    // The pod object must be serialized to bytes before the stream can
    // carry it (upstream streams.rs pattern) — Object ≠ Pod in libspa.
    let values = match pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(format),
    ) {
        Ok((bytes, _)) => bytes.into_inner(),
        Err(err) => {
            tracing::error!(%err, "capture format serialization failed");
            return lost("capture pod serialization failed");
        }
    };
    let Some(pod) = pw::spa::pod::Pod::from_bytes(&values) else {
        // The serializer above produced these bytes; None here is a libspa
        // contract break, surfaced as a lost stream rather than a panic.
        return lost("serialized capture pod is invalid");
    };
    let mut params = [pod];

    let Ok(listener) = stream
        .add_local_listener_with_user_data(counting)
        .state_changed(|_stream, counting, old, new| match new {
            pw::stream::StreamState::Streaming => {
                tracing::debug!(from = ?old, "capture stream is live");
            }
            pw::stream::StreamState::Error(err) => {
                tracing::error!(error = %err, "capture stream error");
                counting.lost(&err);
            }
            pw::stream::StreamState::Unconnected => {
                tracing::debug!(from = ?old, "capture stream unconnected");
                counting.lost("stream unconnected");
            }
            pw::stream::StreamState::Connecting | pw::stream::StreamState::Paused => {}
        })
        .param_changed(|_stream, counting, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let Ok((media_type, media_subtype)) = spa::param::format_utils::parse_format(param)
            else {
                return;
            };
            if media_type != spa::param::format::MediaType::Video
                || media_subtype != spa::param::format::MediaSubtype::Raw
            {
                tracing::warn!(?media_type, ?media_subtype, "unexpected format family");
                return;
            }
            let mut info = spa::param::video::VideoInfoRaw::default();
            if info.parse(param).is_ok() {
                let (width, height) = (info.size().width, info.size().height);
                let Some(layout) = layout_from_spa(info.format()) else {
                    // The stream renegotiated into a format we did not
                    // offer — frames stay count-only (never pushed).
                    counting.negotiated = None;
                    return;
                };
                counting.negotiated = Some(Negotiated {
                    width,
                    height,
                    layout,
                });
                tracing::debug!(
                    width,
                    height,
                    format = info.format().as_raw(),
                    layout = ?layout,
                    "capture format negotiated"
                );
            }
        })
        .process(|stream, counting| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(data) = buffer.datas_mut().first_mut() else {
                counting.note_drop("buffer has no data planes");
                return;
            };
            counting.count(data.chunk().size());

            // Producer half of the 1.2 bus (task 1.3): one try, never
            // wait — a full ring drops the NEWEST frame and counts it
            // (§6 encode-tier precedence law, pipeline/mod.rs header).
            let Some(neg) = counting.negotiated.as_ref() else {
                counting.note_drop("no format negotiated");
                return;
            };
            let (neg_width, neg_height, neg_layout) = (neg.width, neg.height, neg.layout);
            let _ = neg; // release the shared borrow
            // The portal pads rows (§ pipeline::Frame stride law); trust
            // the negotiated stride only if it covers width × bpp.
            let row_bytes = neg_width as usize * neg_layout.bpp();
            let stride = data.chunk().stride().max(row_bytes as i32) as usize;
            let need = match stride.checked_mul(neg_height as usize) {
                Some(need) => need,
                None => {
                    counting.note_drop("degenerate negotiated size (stride overflow)");
                    return;
                }
            };
            let Some(pixels) = data.data() else {
                counting.note_drop("buffer memory not host-accessible (dmabuf/unmapped)");
                return;
            };
            if pixels.len() < need {
                // A short mapping is a compositor/driver contract break;
                // this frame is dropped rather than read out of bounds.
                tracing::warn!(
                    have = pixels.len(),
                    need,
                    "capture buffer shorter than frame"
                );
                counting.note_drop("buffer shorter than frame");
                return;
            }
            // Preview tier (3.5): check the ≤8fps gate BEFORE any pixel
            // copy — idle capture stays count-only between stills, and
            // preview work never competes with the encode tier (§6).
            let bus = counting.frame_bus.clone();
            let mailbox = counting.preview.clone();
            let now_ms = preview::wall_ms();
            let preview_due = mailbox.as_ref().is_some_and(|mb| mb.is_due(now_ms));
            if bus.is_none() && !preview_due {
                return;
            }
            let frame = Frame {
                width: neg_width,
                height: neg_height,
                stride: stride as u32,
                layout: neg_layout,
                pts_us: frame_pts_us(),
                data: pixels[..need].to_vec(),
            };
            if preview_due && let Some(mb) = mailbox {
                // Latest-wins: the old still drops here, never queued.
                mb.offer(frame.clone(), now_ms);
            }
            let Some(bus) = bus else {
                return;
            };
            match bus.try_push(frame) {
                Push::Pushed => {
                    // First successful hand-off: proves the producer→bus
                    // half of the chain once (the worker logs its own 1 Hz).
                    if counting.first_drop_reason != Some("first frame pushed") {
                        counting.first_drop_reason = Some("first frame pushed");
                        tracing::debug!(
                            width = neg_width,
                            height = neg_height,
                            stride,
                            "first capture frame pushed onto the encode bus"
                        );
                    }
                }
                // Counted only — the session's 1 Hz progress log reports
                // `dropped` (§6 cadence law; a per-frame line here would
                // fire up to 60×/s during an encoder stall).
                Push::Full(_) => {
                    counting.note_drop("encode bus full (worker not draining)");
                    bus.mark_dropped();
                }
            }
        })
        .register()
    else {
        return lost("listener registration failed");
    };

    // Direction::Input: we consume (capture) the monitor's frames. AUTOCONNECT
    // + MAP_BUFFERS is the standard capture wiring (upstream streams.rs).
    if let Err(err) = stream.connect(
        spa::utils::Direction::Input,
        Some(node_id),
        pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
        &mut params,
    ) {
        tracing::error!(%err, "capture stream connect failed");
        return lost("stream connect failed");
    }

    // Blocks until stop — the mainloop dispatches on our thread only.
    while !stop.load(Ordering::Relaxed) {
        mainloop
            .loop_()
            .iterate(pw::loop_::Timeout::Finite(STOP_POLL_INTERVAL));
    }

    // Declaration order above: mainloop, context, core, stream, listener —
    // reverse drop unwinds listener → stream → core → context → mainloop,
    // so callbacks are unregistered before the objects they watch.
    drop(listener);
    drop(stream);
    drop(core);
    drop(context);
    drop(mainloop);
}

#[cfg(test)]
mod tests {
    use super::*;
    use pw::spa::param::format::FormatProperties;

    #[test]
    fn loss_is_visible_before_the_callback_and_notified_once() {
        let slot: LostSlot = Arc::new(std::sync::Mutex::new(None));
        let calls = Arc::new(AtomicU64::new(0));
        let observed = slot.clone();
        let counted = calls.clone();
        *slot.lock().unwrap() = Some(Box::new(move |_| {
            assert!(observed.lock().unwrap().is_none());
            counted.fetch_add(1, Ordering::Relaxed);
        }));
        report_lost(&slot, "stream failed");
        report_lost(&slot, "disconnected");
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }

    /// The SHM contract (task 1.5, zero-frame take fix): KWin's
    /// screencast negotiation allocates DMABUF buffers whenever the
    /// fixated format carries a VideoModifier key — modifier `0` IS
    /// DRM_FORMAT_MOD_INVALID ("dmabuf, implicit modifier"), never
    /// "system memory". Without the key KWin falls back to MemFd
    /// buffers, which MAP_BUFFERS maps so `data.data()` yields pixels.
    #[test]
    fn format_offer_carries_no_modifier_property() {
        let pod = format_offer_pod((1920, 1080));
        let keys: Vec<u32> = pod.properties.iter().map(|p| p.key).collect();
        // Meaningfulness guard: the offer really carries the format
        // choice (an empty-object false positive fails here).
        assert!(keys.contains(&FormatProperties::VideoFormat.as_raw()));
        assert!(
            !keys.contains(&FormatProperties::VideoModifier.as_raw()),
            "capture format offer must not carry a VideoModifier key"
        );
    }
}
