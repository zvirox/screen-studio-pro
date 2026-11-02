//! The video Encoder seam — ARCHITECTURE §2 tree: every encoder backend
//! lives in `encode/` behind this trait. MVP ships the software x264
//! (`sw_x264`); the VAAPI/NVENC backends of PLAN 3.3 implement the same
//! seam so the session code never branches on the backend by name.

use crate::pipeline::Frame;
use crate::util::error::CoreError;

/* Feature gate: this whole module needs system ffmpeg dev libs
(ffmpeg-devel — SETUP §3.1). `encode` is default-on since task 1.3 so
`cargo test` covers the recording core; `--no-default-features` still
builds capture/settings/library paths for header-less sandboxes. */

pub mod sw_x264;

/// Static facts about a backend — the `encoder` object of API §2.3
/// `recording_start` (`backend`, `isHardware`) and the §6.1 chip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncoderInfo {
    /// API §2.5 wire string form of the backend (§2.5 `EncoderBackend`).
    pub backend: &'static str,
    pub is_hardware: bool,
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
