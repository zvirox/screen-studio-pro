use crate::util::error::CoreError;
use pipewire as pw;
use pw::spa;
use std::os::fd::OwnedFd;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/* PipeWire stream consumption — ARCHITECTURE §2: the frame bus lives HERE
and below; frames never cross the IPC (API §6 standing flag). Task 1.1
scope: attach to the portal's remote, negotiate a raw video format, and
count frames with a 1 Hz fps debug log (PLAN 1.1 verify). Task 1.2
replaces the "count then drop" consumer with the SpSC frame bus. */

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
    let mut slot = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(callback) = slot.take() {
        callback(reason);
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
}

/// Live consumption guard for one portal stream: `stop()` ends the data
/// thread and joins it. Dropping the guard stops too.
pub struct StreamGuard {
    stop: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
    thread: Option<JoinHandle<()>>,
}

impl StreamGuard {
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
pub fn start(
    node_id: u32,
    size: (u32, u32),
    remote_fd: OwnedFd,
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
            move || run_loop(node_id, size, remote_fd, stop, frames, lost_slot)
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
        thread: Some(thread),
    })
}

/// One PipeWire main loop on OUR thread, dispatching until the stop flag
/// rises. Loop-owned objects drop in declaration order on the way out
/// (listener before stream before core/context) — clean teardown order.
/// All early-return paths report through `on_lost`, never panic (§4.2).
fn run_loop(
    node_id: u32,
    size: (u32, u32),
    remote_fd: OwnedFd,
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
    // screencast node, session 1919×1079 and 1920×1080 runs):
    //   format: Choice Enum {BGRA default, BGRx} — NO RGB/RGBA/I420 offer;
    //   size:   FIXED per session (varies by KWin scale rounding);
    //   framerate: FIXED 0/1 ("variable") with maxFramerate ~60.020;
    //   modifier: Choice incl. 0 (system memory) + DMABUF tokens.
    // We therefore offer: BGRx/BGRA only, size defaulted to the portal's
    // reported geometry (always the node's fixed size), framerate range
    // CONTAINING 0/1 (pinned 60 failed: [60..60] ∩ {0/1} = empty), and
    // modifier {0} to pin system memory — DMABUF re-fixation is what kills
    // the stream ~4s in when left to the daemon (verified run 3).
    let format = pw::spa::pod::object!(
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
        // No macro arm for a Long choice (libspa's Choice macros only
        // cover named SPA types); the modifier property is constructed
        // directly instead.
        pw::spa::pod::Property {
            key: pw::spa::param::format::FormatProperties::VideoModifier.as_raw(),
            flags: pw::spa::pod::PropertyFlags::empty(),
            value: pw::spa::pod::Value::Choice(pw::spa::pod::ChoiceValue::Long(
                pw::spa::utils::Choice(
                    pw::spa::utils::ChoiceFlags::empty(),
                    pw::spa::utils::ChoiceEnum::Enum {
                        default: 0,
                        alternatives: vec![0],
                    },
                ),
            )),
        },
    );
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
        .param_changed(|_stream, _counting, id, param| {
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
                tracing::debug!(
                    width = info.size().width,
                    height = info.size().height,
                    format = info.format().as_raw(),
                    "capture format negotiated"
                );
            }
        })
        .process(|stream, counting| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(data) = buffer.datas_mut().first() else {
                return;
            };
            counting.count(data.chunk().size());
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
