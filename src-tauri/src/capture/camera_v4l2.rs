use crate::capture::preview::{PreviewMailbox, wall_ms};
use crate::pipeline::{Frame, FrameLayout};
use crate::util::error::CoreError;
use ffmpeg_next as ff;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

/* V4L2 camera viewer (PLAN 4.1 / PRD M5) — the webcam half of the
capture tree. Frames are read through libavdevice's `video4linux2`
demuxer on a dedicated reader thread, decoded, scaled to BGRA and fed
into the SAME stills tier as source previews (capture/preview.rs): a
drop-oldest PreviewMailbox gated to ≤8fps, served to the webview as
JPEG by `cmd://camera_preview`. The encode bus is never touched —
§6 backpressure precedence, same law as the PipeWire preview tier.

Enumeration is pure sysfs (no ioctls, no new deps): /dev/video* nodes
grouped by their parent device, keeping the LOWEST index per group —
the UVC layout puts the capture node at the lower index and the
metadata node (present since kernel 4.16, no V4L2 capture ioctls —
verified: `ffprobe -f video4linux2` fails it with VIDIOC_G_INPUT) at
the higher one.

Deadlock law (the 4.1 verify gate): the reader checks the stop flag
between packets only — a close therefore waits ≤ one frame period
(~33ms) — and `close` BOUNDS that wait, detaching a wedged reader
instead of parking the UI thread. Unplug surfaces as a demux read
error, which libavformat latches and ends the packet iteration, so
the reader exits on its own and a later `open` replaces the dead
session (self-healing slot). */

const SYS_ROOT: &str = "/sys/class/video4linux";
const DEV_ROOT: &str = "/dev";
/// The forced libavformat input format for V4L2 devices.
const V4L2_DEMUXER: &[u8] = b"video4linux2\0";
/// `camera_open` waits at most this long for the reader's first frame
/// (the demuxer's stream-probe already reads frames, so a healthy
/// device answers well inside this).
const OPEN_TIMEOUT: Duration = Duration::from_secs(3);
/// `camera_close` waits at most this long for the reader to notice the
/// stop flag; beyond it the reader is detached (it exits on its next
/// packet or demux error — bounded work, never a parked UI thread).
const CLOSE_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq)]
pub struct CameraDeviceInfo {
    /// `v4l2_/dev/videoN` — the API §2.2 wire format.
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

/// The live-camera stills + stop wiring shared by the command layer
/// and the reader thread.
struct CameraSession {
    camera_id: String,
    mailbox: Arc<PreviewMailbox>,
    stop: Arc<AtomicBool>,
    /// None after a bounded close gave up waiting (detached reader).
    reader: Option<std::thread::JoinHandle<()>>,
}

/// The single open camera — app state, independent of the portal
/// `CaptureHandle` slot (a camera never contends with `portal.busy`).
pub struct CameraHandle {
    slot: Mutex<Option<CameraSession>>,
}

impl Default for CameraHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl CameraHandle {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }

    /// Opens the device and returns `(cameraId, width, height)` once the
    /// reader produced its first decoded frame. Errors typed:
    /// `capture.camera_unavailable` (no such device / demux failure /
    /// a camera already open), per API §2.2.
    pub fn open(&self, device_id: &str) -> Result<(String, u32, u32), CoreError> {
        let mut slot = self.slot.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(session) = slot.as_ref() {
            // A live reader holds the slot; a finished reader is a dead
            // session from an unplugged device and is dropped below.
            if session
                .reader
                .as_ref()
                .is_some_and(|reader| !reader.is_finished())
            {
                return Err(camera_error(
                    "A camera is already open. Close it before opening another.",
                    false,
                ));
            }
            // A finished reader means the device went away (unplug law):
            // the dead session drops here, making re-open self-healing.
            *slot = None;
        }
        let device_path = parse_device_id(device_id)?;

        let mailbox = Arc::new(PreviewMailbox::new());
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel();
        let reader = {
            let device_path = device_path.clone();
            let mailbox = mailbox.clone();
            let stop = stop.clone();
            std::thread::Builder::new()
                .name("camera-reader".into())
                .spawn(move || {
                    reader_loop(device_path, mailbox, stop, ready_tx);
                })
                .map_err(|err| {
                    tracing::error!(%err, "camera reader spawn failed");
                    camera_error("The camera reader could not start.", true)
                })?
        };

        match ready_rx.recv_timeout(OPEN_TIMEOUT) {
            Ok(Ok((width, height))) => {
                let camera_id = new_camera_id();
                *slot = Some(CameraSession {
                    camera_id: camera_id.clone(),
                    mailbox,
                    stop,
                    reader: Some(reader),
                });
                Ok((camera_id, width, height))
            }
            Ok(Err(err)) => {
                drop(reader); // detach: the failing thread already exits
                Err(err)
            }
            Err(_) => {
                // Wedged open: stop the thread, don't store the session.
                stop.store(true, Ordering::Release);
                tracing::error!(
                    %device_path,
                    "camera open timed out; the reader is stopped and detached"
                );
                Err(camera_error(
                    "The camera did not start in time. Try again.",
                    true,
                ))
            }
        }
    }

    /// Closes the camera. Idempotent per API §2.2: no open camera, or an
    /// id that doesn't match, still succeeds (the slot stays untouched).
    pub fn close(&self, camera_id: Option<&str>) {
        let session = {
            let mut slot = self.slot.lock().unwrap_or_else(|p| p.into_inner());
            match slot.take() {
                Some(s) if camera_id.is_none_or(|want| want == s.camera_id) => s,
                other => {
                    // Id mismatch (or None + empty): put it back — the
                    // contract's idempotence means "not an error", not
                    // "close something else's camera".
                    *slot = other;
                    return;
                }
            }
        };
        session.stop.store(true, Ordering::Release);
        // Bounded wait: the reader checks the stop flag between packets,
        // so a healthy device exits within one frame period.
        let deadline = std::time::Instant::now() + CLOSE_TIMEOUT;
        if let Some(reader) = session.reader {
            while !reader.is_finished() {
                if std::time::Instant::now() >= deadline {
                    tracing::warn!(
                        camera_id = %session.camera_id,
                        "camera reader did not stop in time; detaching"
                    );
                    return; // JoinHandle drops → detached, exits on its own
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            drop(reader);
        }
    }

    /// The stills mailbox of the matching open camera.
    pub fn mailbox_if_matches(&self, camera_id: &str) -> Option<Arc<PreviewMailbox>> {
        self.slot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .filter(|s| s.camera_id == camera_id)
            .map(|s| s.mailbox.clone())
    }
}

/// Camera ids mirror the source-id law: `cam_` + monotonic nanos hex +
/// rollover counter — unique under any clock, sortable by creation.
pub fn new_camera_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed) & 0xffff;
    format!("cam_{nanos:x}{counter:04x}")
}

/// `v4l2_/dev/videoN` → `/dev/videoN`, validated before any device I/O:
/// the path must live under /dev (no escaping the device tree) and must
/// exist right now.
fn parse_device_id(device_id: &str) -> Result<String, CoreError> {
    let Some(path) = device_id.strip_prefix("v4l2_") else {
        return Err(camera_error(
            "That device id is not a camera id. Pick a camera from the list.",
            false,
        ));
    };
    if !path.starts_with(DEV_ROOT) {
        return Err(camera_error(
            "That camera path is not a system device.",
            false,
        ));
    }
    if !Path::new(path).exists() {
        return Err(camera_error(
            "That camera is not connected right now. Replug it and try again.",
            true,
        ));
    }
    Ok(path.to_string())
}

fn camera_error(message: impl Into<String>, retryable: bool) -> CoreError {
    CoreError::capture("capture.camera_unavailable", retryable, message)
}

/* ---------- enumeration (pure sysfs) ---------- */

/// Scans `sys_root` for video nodes, keeps one per parent device (the
/// lowest `videoN` index — the UVC capture node), labels from sysfs.
/// `dev_root` is where the wire ids point (`/dev`). Injectable roots
/// keep the grouping law unit-testable without touching real sysfs.
pub fn list_devices_in(sys_root: &Path, dev_root: &Path) -> Vec<CameraDeviceInfo> {
    let mut groups: HashMap<PathBuf, (u32, String)> = HashMap::new();
    let Ok(entries) = std::fs::read_dir(sys_root) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(index) = name
            .strip_prefix("video")
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        let node = entry.path();
        let label = std::fs::read_to_string(node.join("name"))
            .map(|l| l.trim().to_string())
            .unwrap_or_else(|_| "Camera".to_string());
        // The parent device: both UVC nodes of one camera resolve to the
        // same `device` symlink; a node without one groups by itself.
        let parent = node.join("device");
        let key = std::fs::canonicalize(&parent).unwrap_or_else(|_| node.clone());
        let slot = groups.entry(key).or_insert((index, label.clone()));
        if index < slot.0 {
            *slot = (index, label);
        }
    }
    let mut devices: Vec<CameraDeviceInfo> = groups
        .into_values()
        .map(|(index, label)| {
            // Path join, not a suffix: the wire id is `v4l2_/dev/videoN`.
            let node = dev_root.join(format!("video{index}"));
            CameraDeviceInfo {
                id: format!("v4l2_{}", node.display()),
                label,
                is_default: false,
            }
        })
        .collect();
    devices.sort_by(|a, b| a.id.cmp(&b.id));
    if let Some(first) = devices.first_mut() {
        first.is_default = true;
    }
    devices
}

/// The real system listing (API §2.2 `camera_list_devices`).
pub fn list_devices() -> Vec<CameraDeviceInfo> {
    list_devices_in(Path::new(SYS_ROOT), Path::new(DEV_ROOT))
}

/* ---------- the reader thread (libavdevice → stills mailbox) ---------- */

fn reader_loop(
    device_path: String,
    mailbox: Arc<PreviewMailbox>,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<(u32, u32), CoreError>>,
) {
    // Open + stream setup happen once, before the loop; a failure here
    // is the handshake error, nothing is latched yet.
    let session = match unsafe { open_device(&device_path) } {
        Ok(session) => session,
        Err(err) => {
            let _ = ready.send(Err(err));
            return;
        }
    };
    let DeviceSession {
        mut input,
        video_index,
        mut decoder,
        width,
        height,
    } = session;
    // Ready resolves on the FIRST DECODED frame, not on open: the
    // `camera_open` reply must imply a servable still (mailbox populated),
    // so the webview's first `camera_preview` poll can never race the
    // decoder. A device that never produces a frame times `open` out at
    // OPEN_TIMEOUT instead.
    let mut ready = Some(ready);

    // The scaler is built on the FIRST decoded frame (its pixel format
    // is ground truth) and rebuilt only if the device changes it.
    let mut scaler: Option<(ff::software::scaling::Context, u32, u32, ff::format::Pixel)> = None;
    let mut output = ff::frame::Video::new(ff::format::Pixel::BGRA, width, height);

    let mut packets = input.packets();
    while !stop.load(Ordering::Acquire) {
        // Terminal demux errors (unplug) end the iteration as None —
        // libavformat latches them, so this loop always terminates.
        let Some((stream, packet)) = packets.next() else {
            tracing::info!(%device_path, "camera demux ended (stop or unplug)");
            break;
        };
        if stream.index() != video_index {
            continue;
        }
        if let Err(err) = decoder.send_packet(&packet) {
            tracing::debug!(%err, "camera packet rejected; continuing");
            continue;
        }
        loop {
            let mut frame = unsafe { ff::Frame::empty() };
            match decoder.receive_frame(&mut frame) {
                Err(ff::Error::Eof) | Err(ff::Error::Other { errno: 11 }) => break, // drained / EAGAIN
                Err(err) => {
                    tracing::debug!(%err, "camera decode error; continuing");
                    break;
                }
                Ok(()) => {
                    let decoded = ff::frame::Video::from(std::mem::replace(&mut frame, unsafe {
                        ff::Frame::empty()
                    }));
                    // §6 gate BEFORE the pixel copy: between stills the
                    // loop is demux+decode only.
                    let now = wall_ms();
                    if !mailbox.is_due(now) {
                        continue;
                    }
                    let (w, h, fmt) = (decoded.width(), decoded.height(), decoded.format());
                    if w == 0 || h == 0 {
                        continue;
                    }
                    let ctx = match &mut scaler {
                        Some((ctx, sw, sh, sf)) if *sw == w && *sh == h && *sf == fmt => ctx,
                        slot => {
                            let ctx = ff::software::scaling::Context::get(
                                fmt,
                                w,
                                h,
                                ff::format::Pixel::BGRA,
                                w,
                                h,
                                ff::software::scaling::Flags::BILINEAR,
                            );
                            match ctx {
                                Ok(ctx) => {
                                    *slot = Some((ctx, w, h, fmt));
                                    &mut slot.as_mut().expect("just stored").0
                                }
                                Err(err) => {
                                    tracing::debug!(%err, "camera scaler setup failed");
                                    continue;
                                }
                            }
                        }
                    };
                    if let Err(err) = ctx.run(&decoded, &mut output) {
                        tracing::debug!(%err, "camera frame scale failed");
                        continue;
                    }
                    mailbox.offer(
                        Frame {
                            width: w,
                            height: h,
                            stride: output.stride(0) as u32,
                            layout: FrameLayout::Bgrx,
                            pts_us: 0,
                            data: output.data(0).to_vec(),
                        },
                        now,
                    );
                    if let Some(ready) = ready.take() {
                        let _ = ready.send(Ok((w, h)));
                    }
                }
            }
        }
    }
    // Input drops here — closing the fd. A detached reader stops at its
    // next packet or demux error; the mailbox is Arc'd and outlives it.
}

/// One opened V4L2 demux session + its video decoder.
struct DeviceSession {
    input: ff::format::context::Input,
    video_index: usize,
    decoder: ff::codec::decoder::video::Video,
    width: u32,
    height: u32,
}

/// Opens the device through libavformat with the v4l2 demuxer FORCED
/// (`/dev/videoN` cannot be probed like a file — ffmpeg-next's public
/// `format::input` always passes a null format to avformat_open_input,
/// so this drops to the sys FFI the crate already re-exports).
unsafe fn open_device(device_path: &str) -> Result<DeviceSession, CoreError> {
    // SAFETY (whole body): the calls below follow the libavformat
    // contract — an owned, freshly-allocated `AVFormatContext`, a
    // NUL-terminated path, and a static demuxer format; every early
    // exit closes the input before returning.
    unsafe {
        crate::encode::ensure_init();
        let fmt = ff::sys::av_find_input_format(V4L2_DEMUXER.as_ptr().cast());
        let c_path = std::ffi::CString::new(device_path)
            .map_err(|_| camera_error("That camera path is not a usable device name.", false))?;
        let mut ps: *mut ff::sys::AVFormatContext = std::ptr::null_mut();
        // §6 bandwidth law: negotiate MJPEG off the device instead of its
        // raw YUYV stream (~110 Mbps on this sensor, vs ~20 for MJPEG —
        // decoded identically by swscale before the still tier). The
        // demuxer consumes the entry; unknown leftovers are re-owned and
        // dropped by the wrapper below.
        let mut dict = ff::Dictionary::new();
        dict.set("pixel_format", "mjpeg");
        let mut opts = dict.disown();
        let open_res = ff::sys::avformat_open_input(&mut ps, c_path.as_ptr(), fmt, &mut opts);
        drop(ff::Dictionary::own(opts));
        if open_res < 0 {
            let err = ff::Error::from(open_res);
            tracing::warn!(%err, %device_path, "v4l2 open failed");
            return Err(camera_error(
                "That camera could not be opened. It may be in use by another app.",
                true,
            ));
        }
        let find_res = ff::sys::avformat_find_stream_info(ps, std::ptr::null_mut());
        if find_res < 0 {
            ff::sys::avformat_close_input(&mut ps);
            let err = ff::Error::from(find_res);
            tracing::warn!(%err, %device_path, "v4l2 stream probe failed");
            return Err(camera_error("That device is not a video camera.", true));
        }
        // SAFETY: `ps` is a freshly-opened AVFormatContext owned by us.
        let input = ff::format::context::Input::wrap(ps);
        let Some(stream) = input.streams().best(ff::media::Type::Video) else {
            // The UVC metadata node shape: opens but carries no video.
            tracing::info!(%device_path, "v4l2 device carries no video stream");
            return Err(camera_error("That device is not a video camera.", true));
        };
        let video_index = stream.index();
        let ctx =
            ff::codec::context::Context::from_parameters(stream.parameters()).map_err(|err| {
                tracing::warn!(%err, "camera: from_parameters failed");
                camera_error("That camera's video format could not be decoded.", true)
            })?;
        // FFmpeg 9's avcodec_open2 no longer resolves the codec from
        // `codec_id` when passed NULL — find it explicitly.
        let codec = ff::decoder::find(stream.parameters().id()).ok_or_else(|| {
            camera_error("That camera's video format could not be decoded.", true)
        })?;
        let opened = ctx.decoder().open_as(codec).map_err(|err| {
            tracing::warn!(%err, "camera: decoder.open failed");
            camera_error("That camera's video format could not be decoded.", true)
        })?;
        let decoder = opened.video().map_err(|err| {
            tracing::warn!(%err, "camera: not a video stream after open");
            camera_error("That camera's video format could not be decoded.", true)
        })?;
        // The decoder context carries the negotiated dims right after
        // avcodec_parameters_to_context.
        let (width, height) = (decoder.width(), decoder.height());
        if width == 0 || height == 0 {
            return Err(camera_error("That camera reported no usable size.", true));
        }
        Ok(DeviceSession {
            input,
            video_index,
            decoder,
            width,
            height,
        })
    }
}

/* ---------- hotplug watcher (API §3 device/changed, camera half) ---------- */

/// Polls the sysfs capture-node set once per second (the §3 ≤1 Hz
/// debounce) and emits `device/changed` `{ audio: false, camera: true }`
/// when the set changes. A daemon thread — it outlives no session and
/// holds no session state, only the AppHandle clone.
pub fn spawn_hotplug_watcher(app: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("camera-hotplug".into())
        .spawn(move || {
            let mut last = device_key_set();
            loop {
                std::thread::sleep(Duration::from_secs(1));
                let snapshot = device_key_set();
                if snapshot != last {
                    last = snapshot;
                    let payload = crate::ipc::events::DeviceChanged {
                        audio: false,
                        camera: true,
                    };
                    if let Err(err) = crate::ipc::events::emit(
                        &app,
                        crate::ipc::events::topic::DEVICE_CHANGED,
                        payload,
                    ) {
                        tracing::warn!(%err, "device/changed emit failed");
                    }
                }
            }
        })
        .ok();
}

fn device_key_set() -> Vec<String> {
    list_devices().into_iter().map(|d| d.id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Fake sysfs: `videoN/name` files + a shared `device` symlink
    /// target — the grouping law without real kernel state.
    struct FakeSys {
        root: PathBuf,
        dev: PathBuf,
    }

    impl FakeSys {
        fn new() -> Self {
            let base = tempfile::tempdir().expect("tmp");
            let root = base.path().join("sys");
            let dev = base.path().join("dev");
            fs::create_dir_all(&root).unwrap();
            fs::create_dir_all(&dev).unwrap();
            std::mem::forget(base); // outlives the test body
            Self { root, dev }
        }

        fn node(&self, name: &str, label: &str, parent: Option<&str>) {
            let dir = self.root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("name"), format!("{label}\n")).unwrap();
            if let Some(parent) = parent {
                let target = self.root.join(parent);
                fs::create_dir_all(&target).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(&target, dir.join("device")).unwrap();
            }
        }
    }

    #[test]
    fn enumeration_keeps_the_lowest_node_per_parent() {
        let sys = FakeSys::new();
        sys.node("video0", "HP Wide Vision HD Camera", Some("usb-cam"));
        sys.node("video1", "HP Wide Vision HD Camera", Some("usb-cam"));
        sys.node("video2", "Second Camera", Some("other-cam"));

        let devices = list_devices_in(&sys.root, &sys.dev);
        assert_eq!(
            devices.len(),
            2,
            "metadata node video1 must be grouped away"
        );
        assert_eq!(
            devices[0].id,
            format!("v4l2_{}/video0", sys.dev.display()),
            "lowest index wins and the id carries the /dev path"
        );
        assert_eq!(devices[0].label, "HP Wide Vision HD Camera");
        assert!(devices[0].is_default, "the first sorted device is default");
        assert!(!devices[1].is_default);
    }

    #[test]
    fn enumeration_labels_and_sorts_parentless_nodes() {
        let sys = FakeSys::new();
        sys.node("video7", "Standalone Cam", None);
        let devices = list_devices_in(&sys.root, &sys.dev);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].label, "Standalone Cam");
        assert!(devices[0].is_default);
    }

    #[test]
    fn enumeration_survives_a_missing_sys_root() {
        let missing = Path::new("/proc/self/nonexistent-v4l-root");
        assert!(list_devices_in(missing, Path::new(DEV_ROOT)).is_empty());
    }

    #[test]
    fn device_id_must_be_v4l2_prefixed_under_dev() {
        assert!(parse_device_id("v4l2_/dev/video0").is_ok());
        assert!(parse_device_id("portal_something").is_err());
        assert!(parse_device_id("v4l2_/etc/passwd").is_err(), "outside /dev");
        assert!(parse_device_id("v4l2_/dev/video99").is_err(), "absent node");
    }

    #[test]
    fn open_rejects_the_second_camera_before_touching_any_device() {
        // Occupied slot with a STILL-RUNNING reader: `open` must refuse
        // with the busy error before any device validation (and thus
        // before spawning anything — the deadlock law).
        let running = std::thread::spawn(|| std::thread::sleep(Duration::from_secs(1)));
        let occupied = CameraHandle {
            slot: Mutex::new(Some(CameraSession {
                camera_id: new_camera_id(),
                mailbox: Arc::new(PreviewMailbox::new()),
                stop: Arc::new(AtomicBool::new(false)),
                reader: Some(running),
            })),
        };
        // A nonexistent device id proves the busy guard fired first.
        let err = occupied
            .open("v4l2_/dev/nonexistent-video42")
            .expect_err("a busy slot must refuse before device work");
        assert_eq!(err.code(), "capture.camera_unavailable");
        assert!(err.user_message().contains("already open"));
    }

    #[test]
    fn open_self_heals_after_a_finished_reader() {
        // The unplug law: a dead session (reader finished) is dropped by
        // the next open, which then proceeds to normal validation.
        let finished = std::thread::spawn(|| ());
        finished.join().expect("test thread");
        let healed = CameraHandle {
            slot: Mutex::new(Some(CameraSession {
                camera_id: new_camera_id(),
                mailbox: Arc::new(PreviewMailbox::new()),
                stop: Arc::new(AtomicBool::new(false)),
                reader: Some(std::thread::spawn(|| ())),
            })),
        };
        // Wait for the reader to actually finish, then open — the error
        // must be the DEVICE error, not the busy error.
        loop {
            let slot = healed.slot.lock().unwrap();
            let done = slot
                .as_ref()
                .and_then(|s| s.reader.as_ref())
                .is_some_and(|r| r.is_finished());
            if done {
                break;
            }
        }
        let err = healed
            .open("v4l2_/dev/nonexistent-video42")
            .expect_err("device absent");
        assert!(err.user_message().contains("not connected"));
    }

    #[test]
    fn close_is_idempotent_and_id_scoped() {
        let handle = CameraHandle::new();
        handle.close(None); // empty slot — still ok
        handle.close(Some("cam_whatever")); // unknown id — still ok
        assert!(handle.mailbox_if_matches("cam_whatever").is_none());
    }

    #[test]
    fn mailbox_is_only_served_to_the_matching_id() {
        let handle = CameraHandle::new();
        assert!(handle.mailbox_if_matches("cam_x").is_none());
    }

    /// Real-hardware smoke (skip-if-absent): exercises the full open →
    /// still → close → reopen path against an actual V4L2 device. On
    /// camera-less machines (CI) it reports and returns — no hang, no
    /// failure. This is the 4.1 deadlock gate, automated.
    #[test]
    fn real_camera_opens_serves_a_still_and_reopens() {
        let _ = tracing_subscriber::fmt::try_init();
        let Some(device) = list_devices().into_iter().next() else {
            eprintln!("no V4L2 camera present; smoke skipped");
            return;
        };
        let handle = CameraHandle::new();
        let (id, w, h) = handle.open(&device.id).expect("real camera opens");
        assert!(w > 0 && h > 0, "the open reply carries real dims");
        // `open` resolves on the reader's FIRST decoded frame, so a
        // still must already be in the mailbox and JPEG-encodable.
        let mailbox = handle
            .mailbox_if_matches(&id)
            .expect("open camera serves stills");
        let (frame, stamp) = mailbox.latest().expect("first frame was decoded");
        assert!(stamp > 0);
        let still = crate::capture::preview::encode_still(&frame).expect("still encodes");
        assert!(still.width > 0 && !still.jpeg.is_empty());

        handle.close(Some(&id)); // bounded join — no deadlock
        let (id2, _, _) = handle.open(&device.id).expect("reopen without deadlock");
        handle.close(Some(&id2));
        handle.close(Some(&id2)); // idempotence on a real device too
    }
}
