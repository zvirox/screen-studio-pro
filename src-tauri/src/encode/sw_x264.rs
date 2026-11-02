use super::{EncodedPacket, Encoder, EncoderInfo};
use crate::pipeline::{Frame, FrameLayout};
use crate::util::error::CoreError;
use ffmpeg_next as ff;
use std::ffi::c_int;

/* Software x264 encoder (PLAN 1.3) — the recording core until the VAAPI/
NVENC backends of PLAN 3.3 implement the same `Encoder` seam.

Frame path per ARCHITECTURE §2: raw BGRx/BGRA capture frame → swscale to
yuv420p → x264 packets, all on the recording session's worker thread
(no ffmpeg codec calls from the PipeWire thread — the swscale work must
not contend with the capture mainloop).

KWin geometry law (docs/portal-support.md): the portal can report 1919×1079
scaled nodes. yuv420p is 2×2-subsampled, so odd dimensions poison the
output — captured dims are clamped DOWN to even and swscale resamples the
full frame into them (no crop: shifting content would move everything by
half a pixel grid; a 1-px scale is invisible at these rates). */

/// x264 speed/quality baseline (preset `medium` per PLAN 1.3; the M11
/// preset system maps onto this dictionary when it lands).
///
/// `g` = 60: a keyframe at most every 60 frames (≈1 s at 60 fps). Two
/// reasons, both contractual: the matroska muxer closes a cluster on a
/// keyframe, so this bounds the crash loss to ~1 s (PLAN 1.3's
/// crash-tolerance law — with x264's default 250-frame GOP a killed
/// process leaves a header-only file), and it keeps seeking responsive
/// in the library (M14).
const X264_OPTS: &[(&str, &str)] = &[("preset", "medium"), ("g", "60")];

/// The option dictionary the muxer passes to `avcodec_open2` when opening
/// this backend (see pipeline/muxer.rs).
pub fn options() -> Vec<(String, String)> {
    X264_OPTS
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect()
}

/// AVERROR(EAGAIN) classifies the "queue empty" boundary of
/// `receive_packet`. libc is no direct dependency, so the Linux ABI value
/// is pinned here (EAGAIN == 11 on every Linux target; the app is
/// Linux-only per PRD).
const LINUX_EAGAIN: c_int = 11;

pub struct SwX264 {
    video: ff::encoder::Video,
    scaler: Option<Scaler>,
    /// Negotiated from the FIRST frame — every later frame must match (a
    /// portal session is one fixed resolution, API §2.1; a mid-take
    /// change means the stream renegotiated under us).
    src: Option<(u32, u32, ff::format::Pixel)>,
    out_w: u32,
    out_h: u32,
    info: EncoderInfo,
}

/// Send wrapper for the swscale context. SAFETY: the raw `SwsContext` is
/// exclusively owned and never shared — the whole `SwX264` lives on the
/// recording worker thread only (spawn transfers, nothing concurrent).
struct Scaler(ff::software::scaling::Context);
unsafe impl Send for Scaler {}

impl SwX264 {
    /// Wraps an ALREADY-OPENED libavcodec context (the muxer opens it so
    /// the container's GLOBAL_HEADER hint applies before `avcodec_open2` —
    /// pipeline/muxer.rs owns that dance and the codec selection).
    pub fn from_open(video: ff::encoder::Video) -> Self {
        // The OPENED context is the take's resolution authority (the
        // muxer already wrote a header with these dims); the scaler and
        // the first-frame check below must agree with it by construction.
        let out_w = video.width();
        let out_h = video.height();
        Self {
            video,
            scaler: None,
            src: None,
            out_w,
            out_h,
            info: EncoderInfo {
                backend: "x264",
                is_hardware: false,
            },
        }
    }

    /// Pull everything the codec has queued after one successful
    /// `send_frame`/`send_eof`. Mapping: `Eof` ends the post-EOF drain,
    /// `Other(EAGAIN)` ends the normal input/more-buffer dance; any other
    /// receive error is a codec fault and fails the take mid-flight.
    fn drain(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
        let mut packets = Vec::new();
        let mut packet = ff::Packet::empty();
        loop {
            match self.video.receive_packet(&mut packet) {
                Ok(()) => {
                    // The encoder's time base is PACKET_TIME_BASE (µs), so
                    // pts/dts counters go straight into the packet fields.
                    packets.push(EncodedPacket {
                        stream: 0,
                        pts_us: packet.pts().unwrap_or(0),
                        dts_us: packet.dts(),
                        key: packet.is_key(),
                        data: packet
                            .data()
                            .expect("a received packet always carries data")
                            .to_vec(),
                    });
                }
                Err(err) => {
                    let queue_boundary = match &err {
                        ff::Error::Eof => true,
                        ff::Error::Other { errno } => *errno == LINUX_EAGAIN,
                        _ => false,
                    };
                    if !queue_boundary {
                        tracing::error!(error = %err, "x264 receive failed");
                        return Err(encode_failed("drain"));
                    }
                    break;
                }
            }
        }
        Ok(packets)
    }
}

impl Encoder for SwX264 {
    fn info(&self) -> EncoderInfo {
        self.info
    }

    fn encode(&mut self, frame: &Frame) -> Result<Vec<EncodedPacket>, CoreError> {
        // spa BGRx/BGRA share memory byte order B,G,R,x with AV_PIX_FMT_BGRA
        // (little-endian) — swscale ignores the alpha byte on conversion.
        let src_pix = match frame.layout {
            FrameLayout::Bgrx | FrameLayout::Bgra => ff::format::Pixel::BGRA,
        };
        if self.src.is_none() {
            // First frame validates the take: its clamped dims must equal
            // the opened encoder's (the muxer header already declared
            // them). A disagreement means the negotiated capture stream
            // is not what the session was opened for — same family as a
            // mid-take renegotiation, fail fast and clean.
            let (out_w, out_h) = ((frame.width & !1).max(2), (frame.height & !1).max(2));
            if (out_w, out_h) != (self.out_w, self.out_h) {
                tracing::error!(
                    opened = ?(self.out_w, self.out_h),
                    arrived = ?(frame.width, frame.height),
                    "first capture frame does not match the opened encoder"
                );
                return Err(CoreError::pipewire(
                    "pipewire.stream_lost",
                    true,
                    "The capture stream does not match the recording that was started.",
                ));
            }
            self.scaler = Some(Scaler(
                ff::software::scaling::Context::get(
                    src_pix,
                    frame.width,
                    frame.height,
                    ff::format::Pixel::YUV420P,
                    self.out_w,
                    self.out_h,
                    ff::software::scaling::Flags::BILINEAR,
                )
                .map_err(|err| {
                    tracing::error!(error = %err, "swscale init failed");
                    CoreError::encoder(
                        "encoder.init_failed",
                        false,
                        "The recording's video converter could not start. Check ffmpeg system libraries.",
                    )
                })?,
            ));
            self.src = Some((frame.width, frame.height, src_pix));
        } else if self.src != Some((frame.width, frame.height, src_pix)) {
            // The M1 portal session is one fixed resolution; a mismatch
            // means the stream renegotiated underneath us — the take ends
            // (recording surfaces `pipewire.stream_lost`).
            tracing::error!(
                negotiated = ?self.src.as_ref().map(|s| (s.0, s.1)),
                arrived = ?(frame.width, frame.height),
                "capture resolution changed mid-recording"
            );
            return Err(CoreError::pipewire(
                "pipewire.stream_lost",
                true,
                "The capture stream changed resolution while recording.",
            ));
        }
        let (src_w, src_h, _) = self.src.expect("negotiated above");

        // Copy the capture rows into an input AVFrame. Row strides may
        // differ everywhere: the portal pads rows (pipeline::Frame keeps
        // `stride`), AVFrame pads too (frame.stride(0)) — copy row-major.
        let mut input = ff::frame::Video::new(src_pix, frame.width, frame.height);
        let input_stride = input.stride(0);
        for (row, chunk) in frame
            .data
            .chunks_exact(frame.stride as usize)
            .take(src_h as usize)
            .enumerate()
        {
            let src = &chunk[..src_w as usize * 4];
            let dest = input.data_mut(0);
            let dest_start = input_stride * row;
            dest[dest_start..dest_start + src.len()].copy_from_slice(src);
        }
        input.set_pts(Some(frame.pts_us as i64));

        let mut output = ff::frame::Video::new(ff::format::Pixel::YUV420P, self.out_w, self.out_h);
        self.scaler
            .as_mut()
            .expect("scaler negotiated above")
            .0
            .run(&input, &mut output)
            .map_err(|err| {
                tracing::error!(error = %err, "swscale run failed");
                encode_failed("scale")
            })?;
        // swscale does NOT carry pts over — an unwritten output frame pts
        // made x264 warn "non-strictly-monotonic PTS" and broke container
        // duration. Stamp every scaled frame before it hits the codec.
        output.set_pts(input.pts());

        self.video.send_frame(&output).map_err(|err| {
            tracing::error!(error = %err, "x264 send_frame failed");
            encode_failed("send")
        })?;
        self.drain()
    }

    fn finish(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
        self.video.send_eof().map_err(|err| {
            tracing::error!(error = %err, "x264 send_eof failed");
            encode_failed("flush")
        })?;
        self.drain()
    }
}

/// No canonical "mid-encode failure" code existed in API §1 — task 1.3
/// adds `encoder.encode_failed` (add-only rule, API.md updated together).
fn encode_failed(op: &str) -> CoreError {
    CoreError::encoder(
        "encoder.encode_failed",
        false,
        "The video encoder failed while writing the recording.",
    )
    // Raw op → tracing only; the UI copy above stays human (DESIGN §7.9).
    .with_details(serde_json::json!({ "operation": op }))
}
