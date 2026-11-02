use super::FrameBus;
use crate::encode::Encoder;
use crate::encode::sw_x264::{self, SwX264};
use crate::pipeline::muxer::{Muxer, VideoSpec};
use crate::util::error::CoreError;
use ffmpeg_next as ff;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

/// Data the ipc layer turns into the API §2.3 `recording_start` reply.
#[derive(Debug, Clone)]
pub struct StartInfo {
    pub recording_id: String,
    pub encoder: crate::encode::EncoderInfo,
    pub started_at: String,
}

/// What `recording_stop` reports (DB row upsert joins in 1.6 — no id yet).
#[derive(Debug, Clone)]
pub struct StopOutcome {
    pub path: PathBuf,
    pub duration_ms: u64,
    pub size_bytes: u64,
}

/// Managed state: at most one active recording (the bad_state rule of
/// API §2.3). Mirrors CaptureHandle's plain-slot discipline: a poisoned
/// lock resumes plain data (§6.4).
pub struct RecordingHandle {
    active: Mutex<Option<ActiveRecording>>,
}

struct ActiveRecording {
    recording_id: String,
    /// Stop latch — set by `stop`, observed by the worker's idle poll.
    stop: Arc<AtomicBool>,
    /// None = already joined by a previous stop (defensive; stop takes
    /// the whole ActiveRecording out so this never happens per contract).
    worker: Option<std::thread::JoinHandle<Result<StopOutcome, CoreError>>>,
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
    pub fn start(
        &self,
        bus: Arc<FrameBus>,
        dims: (u32, u32),
        dir: &Path,
    ) -> Result<StartInfo, CoreError> {
        let mut slot = self.locked();
        if slot.is_some() {
            return Err(bad_state(
                "A recording is already running. Stop it before starting another.",
            ));
        }
        let recording_id = new_recording_id();

        // yuv420p is 2×2-subsampled — even-dim clamp here too so the
        // muxer's header and the encoder's output always agree.
        let dims = (dims.0 & !1, dims.1 & !1);
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: dims.0,
            height: dims.1,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: FRAME_RATE,
            options: sw_x264::options(),
        };
        let path = next_output_path(dir);
        let (mux, opened) = Muxer::open_video(&path, spec)?;
        let encoder = SwX264::from_open(opened);
        // Reply facts must be captured before the encoder moves into the
        // worker thread (the encoder info is static, the id/clock are not).
        let info = StartInfo {
            recording_id: recording_id.clone(),
            encoder: encoder.info(),
            started_at: crate::util::time::rfc3339_now(),
        };

        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker = std::thread::Builder::new()
            .name("recording-encoder".into())
            .spawn(move || run_session(mux, encoder, bus, worker_stop))
            .map_err(|err| {
                // mux/encoder drop here unwinds the header-less file; the
                // take never started, so one typed error surfaces (spawn
                // failure is an app-level failure, not a user mistake).
                tracing::error!(error = %err, "recording worker spawn failed");
                CoreError::encoder(
                    "encoder.init_failed",
                    false,
                    "The recording worker could not start.",
                )
            })?;

        *slot = Some(ActiveRecording {
            recording_id: recording_id.clone(),
            stop,
            worker: Some(worker),
        });
        Ok(info)
    }

    /// Stops (and joins) the active recording. Outer `Err` = contract
    /// `ipc.bad_state` (nothing active / id mismatch); inner `Result` is
    /// the take's own fate (mux disk faults, mid-take codec faults).
    pub fn stop(&self, recording_id: &str) -> Result<Result<StopOutcome, CoreError>, CoreError> {
        let mut slot = self.locked();
        let active = match slot.take() {
            Some(rec) if rec.recording_id == recording_id => rec,
            // Not ours / none — put it back: the caller may have hit a
            // racing id typo, the session itself is unaffected.
            other => {
                *slot = other;
                return Err(bad_state("No recording is running with that id."));
            }
        };
        let ActiveRecording {
            stop, mut worker, ..
        } = active;
        stop.store(true, Ordering::Release);
        // The contract guarantees stop owns the only join; the take is
        // defensive against future call paths. JoinError = worker panic
        // (a bug) → encoder family, payload logged, raw strings never
        // reach the UI (§7.9).
        let join = worker.take().expect("stop owns the only join").join();
        match join {
            Ok(result) => Ok(result),
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

/// The session body: drain → encode → mux until the stop latch, whose
/// budget bounds the take at Stop time (see the loop body).
fn run_session(
    mut mux: Muxer,
    mut encoder: SwX264,
    bus: Arc<FrameBus>,
    stop: Arc<AtomicBool>,
) -> Result<StopOutcome, CoreError> {
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

    loop {
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
                let take_last = match &mut drain_budget {
                    Some(budget) => {
                        *budget -= 1;
                        *budget == 0
                    }
                    None => false,
                };
                let base = *first_pts.get_or_insert(frame.pts_us);
                // Wall-clock monotonic µs; sanitize against a reordered
                // producer clock instead of trusting it.
                let rel = frame.pts_us.saturating_sub(base);
                frame.pts_us = rel;
                let packets = encoder.encode(&frame)?;
                mux.write(&packets)?;
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
    Ok(StopOutcome {
        path,
        duration_ms: last_rel_pts / 1000,
        size_bytes,
    })
}

/// `$VideoDir/first-rec.mkv`, then `-2`, `-3`, … — sequential never-
/// overwrite naming until the settings-driven pattern expansion lands.
fn next_output_path(dir: &Path) -> PathBuf {
    let first = dir.join(format!("{BASE_FILE_STEM}.mkv"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n: u32| dir.join(format!("{BASE_FILE_STEM}-{n}.mkv")))
        .find(|candidate| !candidate.exists())
        .expect("u32::MAX suffixes are finite; every slot-1 recording leaves an unused N")
}

fn bad_state(message: &'static str) -> CoreError {
    CoreError::ipc("ipc.bad_state", false, message)
}

#[cfg(all(test, feature = "encode"))]
mod tests {
    use super::*;

    /* Synthetic-frame harness: no portal, no PipeWire — the tests play
    the producer half of the bus so the verify (§PLAN 1.3, ffprobe shows
    a valid h264 stream with the right duration) runs in `cargo test`. */

    const W: u32 = 320;
    const H: u32 = 240;

    /// Small BGRx frame; pixel content varies per frame so x264 has real
    /// work (a constant frame would make bitrate/duration checks silly).
    fn synthetic_frame(n: u64, pts_us: u64) -> crate::pipeline::Frame {
        let stride = W as usize * 4;
        let mut data = vec![0u8; stride * H as usize];
        for (i, byte) in data.iter_mut().enumerate() {
            *byte = (n as usize ^ i) as u8;
        }
        crate::pipeline::Frame {
            width: W,
            height: H,
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
                "stream=codec_name,width,height:format=duration",
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
            .start(bus.clone(), (W, H), dir.path())
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
            .start(bus.clone(), (W, H), dir.path())
            .expect("first start");
        produce(&bus, 5, 0);

        // Second start while active → ipc.bad_state (API §2.3).
        let err = handle.start(bus.clone(), (W, H), dir.path()).unwrap_err();
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
    fn second_take_gets_first_rec_2_not_an_overwrite() {
        let handle = RecordingHandle::new();
        let dir = tempfile::tempdir().expect("tmp dir");

        let bus = Arc::new(FrameBus::new(4));
        let first = handle
            .start(bus.clone(), (W, H), dir.path())
            .expect("first");
        produce(&bus, 5, 0);
        wait_drained(&bus);
        let first_outcome = handle
            .stop(&first.recording_id)
            .expect("stop")
            .expect("take");

        let bus = Arc::new(FrameBus::new(4));
        let second = handle
            .start(bus.clone(), (W, H), dir.path())
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
            .start(bus.clone(), (W, H), dir.path())
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
}
