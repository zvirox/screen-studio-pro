//! The video Encoder seam — ARCHITECTURE §2 tree: every encoder backend
//! lives in `encode/` behind this trait. The software x264 backend and the
//! VAAPI/NVENC backends implement the SAME seam, so the session never
//! branches on a backend by name; it only reads the selection's facts.

use crate::pipeline::Frame;
use crate::util::error::CoreError;
use ffmpeg_next as ff;

/* Feature gate: this whole module needs system ffmpeg dev libs
(ffmpeg-devel — SETUP §3.1). `encode` is default-on since task 1.3 so
`cargo test` covers the recording core; `--no-default-features` still
builds capture/settings/library paths for header-less sandboxes. */

pub mod hw_nvenc;
pub mod hw_vaapi;
pub mod sw_x264;

/// Static facts about a backend — the `encoder` object of API §2.3
/// (`backend`, `isHardware`) and the §6.1 chip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncoderInfo {
    /// API §2.5 wire string form of the backend (§2.5 `EncoderBackend`).
    pub backend: &'static str,
    pub is_hardware: bool,
}

/// The hardware API a selected backend needs. Kept public because the
/// session builds the matching backend from it; the raw context itself is
/// private to [`hw`] (ARCHITECTURE §4.2: FFI stays inside the core).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HwKind {
    Vaapi,
    Cuda,
}

/// Everything the session needs BEFORE `avcodec_open2` (codec by name,
/// consume pix_fmt, hw frames context) and after it (which encoder struct
/// to wrap the opened context in).
///
/// `stream_pix_fmt` is deliberately different from `pix_fmt` on hardware
/// paths: libavcodec's hardware encoder consumes `vaapi`/`cuda` frames,
/// but a container stream must describe H.264 as `yuv420p` or ffprobe and
/// players see a bogus pixel format (Phase 7.4).
#[derive(Debug, Clone, PartialEq)]
pub struct EncoderSelection {
    pub info: EncoderInfo,
    /// FFmpeg encoder name (`libx264` / `h264_vaapi` / `h264_nvenc`).
    pub codec: &'static str,
    /// Pixel format the encoder consumes.
    pub pix_fmt: ff::format::Pixel,
    /// Pixel format written into the muxer's codecpar.
    pub stream_pix_fmt: ff::format::Pixel,
    pub hw: Option<HwKind>,
    /// DRM render node selected for VAAPI; `None` for CUDA/x264.
    pub device_path: Option<String>,
    /// Backend-specific options already translated from the preset.
    pub options: Vec<(String, String)>,
}

/// One encoded access unit, ready for the muxer. `pts_us`/`dts_us` are in
/// the packet time base (`PACKET_TIME_BASE` = 1/1_000_000 µs); the muxer
/// rescales to the container stream's time base at write time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedPacket {
    /// Muxer stream index — 0 = video (backends before 2.1), 1 = audio
    /// (2.1's AAC path). u8: the take carries at most two streams in MVP.
    pub stream: u8,
    pub pts_us: i64,
    /// `None` = no explicit dts (no B-frames) — the muxer mirrors pts.
    pub dts_us: Option<i64>,
    /// AV_PKT_FLAG_KEY equivalent: players derive seek points from these.
    pub key: bool,
    pub data: Vec<u8>,
}

/// Time base all encoded packets are stamped in: microseconds.
pub const PACKET_TIME_BASE: ffmpeg_next::Rational = ffmpeg_next::Rational(1, 1_000_000);

/// One video encoder, scoped to a single recording. Construction
/// (codec selection, open) happens with the muxer so GLOBAL_HEADER hints
/// land correctly; see `pipeline::muxer::open`.
///
/// Implementations must not panic on per-frame errors (§4.2): a single bad
/// frame is dropped, a fatal teardown error returns `CoreError` and the
/// session maps it to the contract's `encoder.*`/`disk.*` codes.
#[cfg_attr(test, allow(dead_code))]
pub trait Encoder: Send {
    #[allow(dead_code)]
    fn info(&self) -> EncoderInfo;
    /// Scale + encode one raw frame; returns the packets it drained.
    /// `frame.pts_us` must already be recording-relative (µs since start).
    fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedPacket>, CoreError>;
    /// EOF/drain at stop: flushes buffered B-frames and trailing packets.
    fn finish(&mut self) -> Result<Vec<EncodedPacket>, CoreError>;
}

/* A/V split (2.1): video keeps the full [`Encoder`] seam (scale + encode),
audio gets this narrower one — audio frames need gain/mix BEFORE the
encoder (pipeline side), not scaling inside the backend. Same laws: one
backend per struct, packets in the µs time base, no panics on per-chunk
errors (§4.2).
Pre-wiring: the audio leg is consumed by the session worker in this
task's Phase E — until then dead outside tests (as `Encoder` was in 1.2). */
#[cfg_attr(not(test), allow(dead_code))]
pub trait AudioEncoder: Send {
    /// Backend identity for the `recording/started` event chip (Phase F).
    #[allow(dead_code)]
    fn info(&self) -> EncoderInfo;
    /// Encode one chunk: `interleaved` holds `frame_size * 2` f32
    /// samples (stereo, 48 kHz, gain already applied). `pts_us` is the
    /// chunk's recording-relative stamp in the µs time base.
    fn encode(&mut self, pts_us: i64, interleaved: &[f32])
    -> Result<Vec<EncodedPacket>, CoreError>;
    /// EOF/flush at stop: drains the codec's buffered tail chunks.
    fn finish(&mut self) -> Result<Vec<EncodedPacket>, CoreError>;
}

pub mod sw_aac;

/* ---------- Encoder selection (PLAN 3.3 / 7.4) ----------

Auto chain: NVENC → VAAPI → x264. A EXPLICIT backend (settings or
`SSP_FORCE_ENCODER`) is a REQUEST, not a demand from the auto chain: an
unavailable explicit backend returns `encoder.unavailable` with the
attempted chain in `details` rather than silently recording on a different
backend (the UI chip must never lie about what encoded the take). Only
`auto` applies the fallback chain. */

/// Check if NVENC is usable: the encoder must exist in this FFmpeg build
/// AND a CUDA device context must initialize. FFmpeg being compiled with
/// `--enable-nvenc` is NOT evidence of hardware (Phase 7.4 gate register).
pub fn nvenc_available() -> bool {
    // A device cannot appear mid-take; cache the probe so every start does
    // not create/destroy a CUDA context (which also perturbs other capture
    // hardware under parallel tests).
    static PROBE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *PROBE.get_or_init(hw_nvenc::NvencEncoder::probe)
}

/// Check if VAAPI is usable: the encoder must exist AND a DRM render node
/// must initialize an AVHWDeviceContext. A render node that merely exists
/// in /dev is not proof the driver can encode (PLAN 3.3).
pub fn vaapi_available() -> Option<String> {
    static PROBE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    PROBE.get_or_init(hw_vaapi::VaapiEncoder::probe).clone()
}

/// Probe results used by both selection and the unit tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Availability {
    Ready,
    Unavailable,
}

impl Availability {
    fn of(backend: &str) -> Self {
        let ready = match backend {
            "nvenc" => nvenc_available(),
            "vaapi" => vaapi_available().is_some(),
            "x264" => ff::encoder::find(ff::codec::Id::H264).is_some(),
            _ => false,
        };
        if ready {
            Self::Ready
        } else {
            Self::Unavailable
        }
    }
}

/// Select an encoder and derive its open-time facts. `opts` are the
/// preset's x264 options; hardware backends translate the quality/GOP
/// intent into their own dictionaries (`hw_options`).
pub fn select_encoder(
    settings_encoder: &str,
    _dims: (u32, u32),
    opts: Vec<(String, String)>,
) -> Result<EncoderSelection, CoreError> {
    // SSP_FORCE_ENCODER wins over the settings snapshot (highest priority,
    // for testing/CI). ARCHITECTURE §5.3 documents the env var.
    let forced = std::env::var("SSP_FORCE_ENCODER").ok();
    let requested = forced
        .clone()
        .unwrap_or_else(|| settings_encoder.to_string());
    let auto = requested == "auto";
    let chain: &[&str] = if auto {
        &["nvenc", "vaapi", "x264"]
    } else {
        // A single unknown backend is rejected below, not replaced by x264.
        &[requested.as_str()]
    };

    let mut tried = Vec::new();
    for &backend in chain {
        if !matches!(backend, "nvenc" | "vaapi" | "x264") {
            return Err(CoreError::encoder(
                "encoder.unavailable",
                false,
                "The requested video encoder is not supported.",
            )
            .with_details(serde_json::json!({
                "backend": backend,
                "forced": forced.as_deref(),
            })));
        }
        if Availability::of(backend) == Availability::Unavailable {
            tracing::warn!(%backend, forced = forced.is_some(), "encoder unavailable");
            tried.push(serde_json::json!({"backend": backend, "status": "unavailable"}));
            continue;
        }
        let selection = selection_for(backend, _dims, &opts)?;
        if !auto {
            tracing::info!(%backend, forced = forced.is_some(), "encoder selected");
        }
        return Ok(selection);
    }

    // No backend in the chain was usable. A forced unavailable backend is
    // the common case — say so explicitly in details (API §1, add-only).
    let message = if forced.is_some() && !auto {
        "The forced video encoder is unavailable on this machine."
    } else {
        "No video encoder available. Check graphics drivers and ffmpeg installation."
    };
    Err(
        CoreError::encoder("encoder.unavailable", false, message).with_details(serde_json::json!({
            "encoderChain": tried,
            "forced": forced.as_deref(),
        })),
    )
}

/// Build the open-time facts of one ALREADY-probed backend. The device
/// creation here is a fresh context (probe contexts are short-lived): the
/// encoder owns its own device/frames refs for the whole take.
fn selection_for(
    backend: &str,
    _dims: (u32, u32),
    opts: &[(String, String)],
) -> Result<EncoderSelection, CoreError> {
    let sw = ff::format::Pixel::YUV420P;
    match backend {
        "x264" => Ok(EncoderSelection {
            info: EncoderInfo {
                backend: "x264",
                is_hardware: false,
            },
            codec: "libx264",
            pix_fmt: sw,
            stream_pix_fmt: sw,
            hw: None,
            device_path: None,
            options: opts.to_vec(),
        }),
        "vaapi" => {
            let device_path = vaapi_available().ok_or_else(unavailable)?;
            Ok(EncoderSelection {
                info: EncoderInfo {
                    backend: "vaapi",
                    is_hardware: true,
                },
                codec: "h264_vaapi",
                // NV12 is the VAAPI surface sw_format: the iHD driver's
                // H.264 encode entry point is NV12-native.
                pix_fmt: ff::format::Pixel::VAAPI,
                stream_pix_fmt: sw,
                hw: Some(HwKind::Vaapi),
                device_path: Some(device_path),
                options: hw_options(opts, HwKind::Vaapi),
            })
        }
        "nvenc" => {
            if !nvenc_available() {
                return Err(unavailable());
            }
            Ok(EncoderSelection {
                info: EncoderInfo {
                    backend: "nvenc",
                    is_hardware: true,
                },
                codec: "h264_nvenc",
                pix_fmt: ff::format::Pixel::CUDA,
                stream_pix_fmt: sw,
                hw: Some(HwKind::Cuda),
                device_path: None,
                options: hw_options(opts, HwKind::Cuda),
            })
        }
        other => {
            tracing::error!(backend = %other, "unknown encoder requested");
            Err(CoreError::encoder(
                "encoder.unavailable",
                false,
                "The requested video encoder is not supported.",
            )
            .with_details(serde_json::json!({"backend": other})))
        }
    }
}

/// Translate the preset's x264 quality/GOP intent to a hardware dictionary.
/// `crf`/`qp` map to the hardware QP (same subjective scale for MVP); the
/// bitrate knobs are x264 rate-control concepts and stay on x264. Keep the
/// GOP at one second so the container's crash-loss bound is backend-neutral.
fn hw_options(opts: &[(String, String)], kind: HwKind) -> Vec<(String, String)> {
    let get = |key: &str| opts.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    let qp = get("qp")
        .or_else(|| get("crf"))
        .unwrap_or_else(|| "23".to_string());
    let g = get("g").unwrap_or_else(|| "60".to_string());
    match kind {
        // VAAPI: `qp` selects CQP implicitly on iHD; `g` is the generic
        // AVCodecContext GOP option (one keyframe per second).
        HwKind::Vaapi => vec![("qp".to_string(), qp), ("g".to_string(), g)],
        // NVENC: QP only takes effect in constant-QP RC mode. Not
        // qualified on this host (no NVIDIA device) — compile + probe only.
        HwKind::Cuda => vec![
            ("rc".to_string(), "constqp".to_string()),
            ("qp".to_string(), qp),
            ("g".to_string(), g),
        ],
    }
}

fn unavailable() -> CoreError {
    CoreError::encoder(
        "encoder.unavailable",
        false,
        "The video encoder is unavailable. Check graphics drivers and ffmpeg installation.",
    )
}

/* ---------- raw hardware frame plumbing ----------

ffmpeg-next 9 has no safe AVHWDeviceContext / AVHWFramesContext wrappers,
so these few operations go through the already-declared ffmpeg-sys-next
FFI (same crate, no new dependency). SAFETY invariant for every pointer
below: the context is created here, owned by one encoder on the recording
worker thread, and unref'd exactly once in Drop. */

pub(crate) mod hw {
    use super::*;
    use crate::pipeline::{Frame, FrameLayout};
    use std::ffi::{CString, c_int};

    const LINUX_EAGAIN: c_int = 11;

    /// Owns one AVHWDeviceContext + AVHWFramesContext pair for a take.
    /// SAFETY: never cloned, never shared; moved to the recording worker.
    pub(crate) struct Context {
        device: *mut ff::ffi::AVBufferRef,
        frames: *mut ff::ffi::AVBufferRef,
        pub(crate) sw_format: ff::format::Pixel,
    }

    unsafe impl Send for Context {}

    impl Context {
        pub(crate) fn create(
            kind: HwKind,
            device_path: Option<&str>,
            dims: (u32, u32),
            sw_format: ff::format::Pixel,
        ) -> Result<Self, CoreError> {
            super::ensure_init();
            let mut device: *mut ff::ffi::AVBufferRef = std::ptr::null_mut();
            let c_path = device_path.map(|p| CString::new(p).expect("device path has no NUL"));
            let (ty, path_ptr) = match kind {
                HwKind::Vaapi => (
                    ff::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI,
                    c_path.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
                ),
                HwKind::Cuda => (
                    ff::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_CUDA,
                    std::ptr::null(),
                ),
            };
            let rc = unsafe {
                ff::ffi::av_hwdevice_ctx_create(&mut device, ty, path_ptr, std::ptr::null_mut(), 0)
            };
            if rc < 0 || device.is_null() {
                tracing::error!(errno = rc, ?device_path, "hw device context create failed");
                return Err(hw_failed("device"));
            }

            let mut frames = unsafe { ff::ffi::av_hwframe_ctx_alloc(device) };
            if frames.is_null() {
                unsafe { ff::ffi::av_buffer_unref(&mut device) };
                return Err(hw_failed("frame context allocation"));
            }
            let sw = unsafe { &mut *((*frames).data as *mut ff::ffi::AVHWFramesContext) };
            sw.format = match kind {
                HwKind::Vaapi => ff::ffi::AVPixelFormat::AV_PIX_FMT_VAAPI,
                HwKind::Cuda => ff::ffi::AVPixelFormat::AV_PIX_FMT_CUDA,
            };
            sw.sw_format = sw_format.into();
            sw.width = dims.0 as c_int;
            sw.height = dims.1 as c_int;
            sw.initial_pool_size = 4;
            let rc = unsafe { ff::ffi::av_hwframe_ctx_init(frames) };
            if rc < 0 {
                tracing::error!(errno = rc, "hw frame context init failed");
                unsafe {
                    ff::ffi::av_buffer_unref(&mut frames);
                    ff::ffi::av_buffer_unref(&mut device);
                }
                return Err(hw_failed("frame context"));
            }
            Ok(Self {
                device,
                frames,
                sw_format,
            })
        }

        /// Attach a NEW reference to the opened AVCodecContext. libavcodec
        /// unrefs its own copy on close; `Context::drop` unrefs ours.
        pub(crate) fn attach(&self, ctx: *mut ff::ffi::AVCodecContext) -> Result<(), CoreError> {
            unsafe {
                (*ctx).hw_frames_ctx = ff::ffi::av_buffer_ref(self.frames);
                if (*ctx).hw_frames_ctx.is_null() {
                    return Err(hw_failed("attach"));
                }
            }
            Ok(())
        }

        /// Upload a system-memory frame to one hardware surface and stamp
        /// it with the recording-relative pts. `avcodec_send_frame` takes
        /// its own reference, so our frame can be freed right after.
        pub(crate) fn upload(
            &self,
            pts_us: i64,
            system: &ff::frame::Video,
        ) -> Result<ff::frame::Video, CoreError> {
            let mut raw = unsafe { ff::ffi::av_frame_alloc() };
            if raw.is_null() {
                return Err(encode_failed("hw frame alloc"));
            }
            unsafe {
                (*raw).format = self.hw_format() as i32;
                (*raw).width = system.width() as c_int;
                (*raw).height = system.height() as c_int;
            }
            let rc = unsafe { ff::ffi::av_hwframe_get_buffer(self.frames, raw, 0) };
            if rc < 0 {
                unsafe { ff::ffi::av_frame_free(&mut raw) };
                return Err(encode_failed("hw frame buffer"));
            }
            // Stamp AFTER get_buffer: FFmpeg may reset frame metadata while
            // attaching the surface pool; a NOPTS frame makes matroska write
            // wall-clock cluster timestamps (recorded pause test, 7.4).
            unsafe { (*raw).pts = pts_us };
            let rc = unsafe { ff::ffi::av_hwframe_transfer_data(raw, system.as_ptr(), 0) };
            if rc < 0 {
                unsafe { ff::ffi::av_frame_free(&mut raw) };
                return Err(encode_failed("hw upload"));
            }
            // Wrap WITHOUT ownership: Video::wrap(ptr) has _own=false, so
            // dropping the wrapper never frees the AVFrame we own here.
            Ok(unsafe { ff::frame::Video::wrap(raw) })
        }

        fn hw_format(&self) -> ff::ffi::AVPixelFormat {
            // The frames context pins the surface format; no inference from
            // the sw_format (NV12 surfaces can back VAAPI or CUDA).
            unsafe {
                let ctx = &*((*self.frames).data as *const ff::ffi::AVHWFramesContext);
                ctx.format
            }
        }
    }

    impl Drop for Context {
        fn drop(&mut self) {
            unsafe {
                ff::ffi::av_buffer_unref(&mut self.frames);
                ff::ffi::av_buffer_unref(&mut self.device);
            }
        }
    }

    /// The shared encode body for VAAPI and NVENC: both upload system-memory
    /// frames to a hardware surface, send them to an opened hw encoder, and
    /// drain packets. The only difference is the `EncoderInfo` chip.
    pub(crate) struct HwEncoder {
        video: ff::encoder::Video,
        hw: Context,
        scaler: Option<Scaler>,
        src: Option<(u32, u32, ff::format::Pixel)>,
        out_w: u32,
        out_h: u32,
        info: EncoderInfo,
    }

    struct Scaler(ff::software::scaling::Context);
    unsafe impl Send for Scaler {}
    unsafe impl Send for HwEncoder {}

    impl HwEncoder {
        pub(crate) fn new(video: ff::encoder::Video, hw: Context, info: EncoderInfo) -> Self {
            let out_w = video.width();
            let out_h = video.height();
            Self {
                video,
                hw,
                scaler: None,
                src: None,
                out_w,
                out_h,
                info,
            }
        }

        pub(crate) fn info(&self) -> EncoderInfo {
            self.info
        }

        pub(crate) fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedPacket>, CoreError> {
            // spa BGRx/BGRA share byte order B,G,R,x with AV_PIX_FMT_BGRA
            // on little-endian Linux (the only target, PRD).
            let src_pix = match frame.layout {
                FrameLayout::Bgrx | FrameLayout::Bgra => ff::format::Pixel::BGRA,
            };
            let (out_w, out_h) = ((frame.width & !1).max(2), (frame.height & !1).max(2));
            if self.src.is_none() {
                if (out_w, out_h) != (self.out_w, self.out_h) {
                    tracing::error!(opened = ?(self.out_w, self.out_h), arrived = ?(frame.width, frame.height),
                        "first capture frame does not match the opened hw encoder");
                    return Err(crate::util::error::CoreError::pipewire(
                        "pipewire.stream_lost",
                        true,
                        "The capture stream does not match the recording that was started.",
                    ));
                }
                let scaler = ff::software::scaling::Context::get(
                    src_pix,
                    frame.width,
                    frame.height,
                    self.hw.sw_format,
                    self.out_w,
                    self.out_h,
                    ff::software::scaling::Flags::BILINEAR,
                )
                .map_err(|err| {
                    tracing::error!(error = %err, "hw swscale init failed");
                    encode_failed("scale init")
                })?;
                self.scaler = Some(Scaler(scaler));
                self.src = Some((frame.width, frame.height, src_pix));
            } else if self.src != Some((frame.width, frame.height, src_pix)) {
                return Err(crate::util::error::CoreError::pipewire(
                    "pipewire.stream_lost",
                    true,
                    "The capture stream changed resolution while recording.",
                ));
            }
            let (src_w, src_h, _) = self.src.expect("negotiated above");

            let mut input = ff::frame::Video::new(src_pix, frame.width, frame.height);
            let stride = input.stride(0);
            for (row, chunk) in frame
                .data
                .chunks_exact(frame.stride as usize)
                .take(src_h as usize)
                .enumerate()
            {
                let src = &chunk[..src_w as usize * 4];
                let dest = input.data_mut(0);
                let start = stride * row;
                dest[start..start + src.len()].copy_from_slice(src);
            }
            input.set_pts(Some(frame.pts_us as i64));
            let mut system = ff::frame::Video::new(self.hw.sw_format, self.out_w, self.out_h);
            self.scaler
                .as_mut()
                .expect("scaler negotiated above")
                .0
                .run(&input, &mut system)
                .map_err(|err| {
                    tracing::error!(error = %err, "hw swscale run failed");
                    encode_failed("scale")
                })?;
            // swscale does not propagate pts; the hardware surface needs
            // the recording-relative stamp explicitly.
            system.set_pts(input.pts());

            let hw_frame = self.hw.upload(frame.pts_us as i64, &system)?;
            self.video.send_frame(&hw_frame).map_err(|err| {
                tracing::error!(error = %err, "hw send_frame failed");
                encode_failed("send")
            })?;
            // `hw_frame` owns the raw AVFrame: ffmpeg-next's Drop calls
            // av_frame_free, which drops OUR reference after avcodec has
            // taken its own. An explicit free here is a double-free.
            drop(hw_frame);
            self.drain()
        }

        pub(crate) fn finish(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
            self.video.send_eof().map_err(|err| {
                tracing::error!(error = %err, "hw send_eof failed");
                encode_failed("flush")
            })?;
            self.drain()
        }

        fn drain(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
            let mut packets = Vec::new();
            let mut packet = ff::Packet::empty();
            loop {
                match self.video.receive_packet(&mut packet) {
                    Ok(()) => packets.push(EncodedPacket {
                        stream: 0,
                        pts_us: packet.pts().unwrap_or(0),
                        dts_us: packet.dts(),
                        key: packet.is_key(),
                        data: packet
                            .data()
                            .expect("a received packet always carries data")
                            .to_vec(),
                    }),
                    Err(err) => {
                        let boundary = matches!(&err, ff::Error::Eof)
                            || matches!(&err, ff::Error::Other { errno } if *errno == LINUX_EAGAIN);
                        if !boundary {
                            tracing::error!(error = %err, "hw receive failed");
                            return Err(encode_failed("drain"));
                        }
                        break;
                    }
                }
            }
            Ok(packets)
        }
    }

    fn hw_failed(op: &str) -> CoreError {
        CoreError::encoder(
            "encoder.init_failed",
            false,
            "The hardware video encoder could not start. Check the graphics driver.",
        )
        .with_details(serde_json::json!({"operation": op}))
    }

    fn encode_failed(op: &str) -> CoreError {
        CoreError::encoder(
            "encoder.encode_failed",
            false,
            "The video encoder failed while writing the recording.",
        )
        .with_details(serde_json::json!({"operation": op}))
    }
}

/// Register libavformat/libavcodec once per process before any mux work.
/// Called lazily by whoever enters the encode path first.
pub fn ensure_init() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        // `ffmpeg::init` sets network/avformat bootstrap; it logs on its
        // own — a failure here poisons `Once`, and the next muxer attempt
        // surfaces it as `encoder.init_failed` (no panic, §4.2).
        ffmpeg_next::init().expect("libav* bootstrap failed");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_unknown_backend_is_an_error_not_a_silent_x264_fallback() {
        let err = select_encoder("no-such-backend", (320, 240), Vec::new())
            .expect_err("unknown backend must not fall back");
        assert_eq!(err.code(), "encoder.unavailable");
        assert_eq!(
            err.details().and_then(|d| d.get("backend")),
            Some(&serde_json::Value::String("no-such-backend".into()))
        );
    }

    #[test]
    fn auto_chain_reports_a_hardware_backend_when_one_is_usable() {
        let selection = select_encoder("auto", (320, 240), Vec::new()).expect("a backend exists");
        let any_hw = vaapi_available().is_some() || nvenc_available();
        assert_eq!(selection.info.is_hardware, any_hw);
        if any_hw {
            assert!(
                matches!(selection.hw, Some(HwKind::Vaapi) | Some(HwKind::Cuda)),
                "a hardware selection must carry a frames context"
            );
            assert_eq!(selection.stream_pix_fmt, ff::format::Pixel::YUV420P);
        }
    }

    #[test]
    fn unavailable_hardware_backend_does_not_silently_become_x264() {
        // On this host NVENC is compiled but has no CUDA device — exactly
        // the case where a forced backend must fail typed (PLAN 7.4).
        if nvenc_available() {
            eprintln!("skip: NVIDIA device present, forced NVENC is legitimate here");
            return;
        }
        let err = selection_for("nvenc", (320, 240), &[]).expect_err("no CUDA device");
        assert_eq!(err.code(), "encoder.unavailable");
    }
}
