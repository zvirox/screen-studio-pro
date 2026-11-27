//! `ssp-mux` — the Phase 9.2 muxer subprocess (PLAN 9.2 / ARCHITECTURE §3/§6).
//!
//! ONE helper owns the libavformat muxer for ONE take. The parent process
//! keeps the encoders and sends encoded packets to this child over an
//! anonymous pipe (stdin). The child finalizes (writes the container
//! trailer) when stdin reaches EOF — which the kernel guarantees on parent
//! death, so a killed parent leaves a finalized file instead of a bare
//! header. NO media bytes cross the Tauri IPC: this pipe is a private
//! process-local fd pair (API §6 standing flag).
//!
//! ## Wire format (self-contained, bounded)
//!
//! A stream of length-prefixed frames:
//!
//! ```text
//! [u32 little-endian payload length][payload bytes]
//! ```
//!
//! The payload is UTF-8 JSON (`WireMsg`). The first frame MUST be
//! `Init` (output path + one `StreamSpec` per stream, with codecpar
//! fields copied from the parent's OPENED encoders — including GLOBAL_HEADER
//! extradata, so MKV/MP4 keep the current SPS/PPS-in-CodecPrivate behavior).
//! Subsequent frames are `Packet` (base64 access-unit bytes + µs stamps),
//! `Chapter` (offset + label), `Split` (next output path) or `Flush` (push
//! FFmpeg's AVIO buffer to the OS, 1 Hz session cadence). Chapters are a
//! FINALIZE-TIME PROJECTION of the parent's `chapter_json`: the child never
//! invents markers. On `Split` the child finalizes the current output and
//! opens the next path with identical stream specs — no frame is dropped because
//! the frame stays in FIFO order on this pipe. EOF = "no more packets": write
//! the trailer and exit 0.
//!
//! Bounds: `MAX_FRAME_LEN` (8 MiB) caps every allocation, so a corrupt or
//! malicious parent cannot make the child OOM. A truncated prefix/body is
//! an error, not an infinite read. `base64::STANDARD` is already a direct
//! dependency of this crate; no new crates enter the tree.
//!
//! This file is also included by `pipeline/muxer.rs` via `#[path]` so the
//! parent and child share ONE definition of the wire codec — the two sides
//! cannot drift. The `main` below is dead code in that library build.

use ffmpeg_next as ff;
use std::io::{self, Read, Write};
use std::path::Path;

pub mod wire {
    use base64::Engine;
    use serde::{Deserialize, Serialize};
    use std::io::{self, Read, Write};

    /// Hard ceiling on a single frame's JSON payload (8 MiB). Bigger frames
    /// are rejected before allocation — the pipe is bounded by construction.
    pub const MAX_FRAME_LEN: u32 = 8 * 1024 * 1024;

    /// One control/data frame on the parent → child pipe.
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub enum WireMsg {
        /// First frame only: output path + stream descriptions.
        Init(Init),
        /// One encoded access unit, already stamped in PACKET_TIME_BASE.
        Packet(Packet),
        /// A chapter marker projected from the parent's authoritative
        /// `recordings.chapter_json` (Phase 9.3). Buffered in the child and
        /// written natively into every segment at finalize/split time.
        Chapter(Chapter),
        /// Start a new segment path with the SAME stream specs. The current
        /// output's trailer is written first; packets after this frame go to
        /// the new output. Segments are gapless: no packet is dropped.
        Split(Split),
        /// Push the muxer's AVIO buffer to the OS (1 Hz session cadence).
        Flush,
    }

    /// One chapter tag (the child's projection of a DB marker).
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Chapter {
        pub offset_ms: u64,
        pub label: String,
    }

    /// The next segment's output path (absolute, parent-chosen).
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Split {
        pub next_path: String,
    }

    /// Stream layout the child must create. Every field is copied from the
    /// parent's opened encoder codecpar (see `codecpar_to_spec`), NOT guessed
    /// from settings — that is how GLOBAL_HEADER extradata survives the hop.
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct StreamSpec {
        pub codec_type: i32,
        pub codec_id: i32,
        pub codec_tag: u32,
        pub format: i32,
        pub width: i32,
        pub height: i32,
        pub bit_rate: i64,
        pub sample_rate: i32,
        pub channels: i32,
        pub channel_mask: u64,
        pub profile: i32,
        pub level: i32,
        /// Base64 of the encoder's `extradata` (SPS/PPS for h264 when the
        /// container opted into GLOBAL_HEADER). Empty = no extradata.
        pub extradata: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Init {
        pub path: String,
        pub streams: Vec<StreamSpec>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Packet {
        /// Stream index (0 = video, 1 = audio in the two-stream take).
        pub stream: u8,
        pub pts_us: i64,
        pub dts_us: Option<i64>,
        pub key: bool,
        /// Base64 of the encoded access-unit bytes.
        pub data: String,
    }

    pub fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    pub fn unb64(text: &str) -> Result<Vec<u8>, io::Error> {
        base64::engine::general_purpose::STANDARD
            .decode(text)
            .map_err(io::Error::other)
    }

    /// Write one length-prefixed JSON frame. The length is checked BEFORE
    /// writing so a too-large payload never goes out as a corrupt prefix.
    pub fn write_frame<W: Write>(out: &mut W, msg: &WireMsg) -> io::Result<()> {
        let json = serde_json::to_vec(msg).map_err(io::Error::other)?;
        let len = u32::try_from(json.len())
            .ok()
            .filter(|len| *len > 0 && *len <= MAX_FRAME_LEN)
            .ok_or_else(|| io::Error::other("ssp-mux frame exceeds MAX_FRAME_LEN"))?;
        out.write_all(&len.to_le_bytes())?;
        out.write_all(&json)?;
        Ok(())
    }

    /// Read one frame. `Ok(None)` is EOF — the child's finalize signal.
    /// A partial/short body is an error (never a silent EOF: that would
    /// finalize a take with lost tail packets).
    pub fn read_frame<R: Read>(input: &mut R) -> io::Result<Option<WireMsg>> {
        let mut prefix = [0u8; 4];
        match input.read_exact(&mut prefix) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(err) => return Err(err),
        }
        let len = u32::from_le_bytes(prefix) as usize;
        if len == 0 || len as u32 > MAX_FRAME_LEN {
            return Err(io::Error::other("ssp-mux frame length out of bounds"));
        }
        let mut payload = vec![0u8; len];
        input.read_exact(&mut payload)?;
        let msg = serde_json::from_slice(&payload).map_err(io::Error::other)?;
        Ok(Some(msg))
    }
}

/// Stream description from an OPENED encoder's codecpar. Called on the
/// parent side (muxer.rs) right after `avcodec_open2`, so GLOBAL_HEADER
/// extradata is present and the child's stream parameters match exactly.
pub fn codecpar_to_spec(
    encoder: &impl AsRef<ff::codec::Context>,
    extradata: &[u8],
) -> wire::StreamSpec {
    let params = ff::codec::Parameters::from(encoder);
    unsafe {
        let p = params.as_ptr();
        wire::StreamSpec {
            codec_type: (*p).codec_type as i32,
            codec_id: (*p).codec_id as i32,
            codec_tag: (*p).codec_tag,
            format: (*p).format,
            width: (*p).width,
            height: (*p).height,
            bit_rate: (*p).bit_rate,
            sample_rate: (*p).sample_rate,
            channels: (*p).ch_layout.nb_channels,
            channel_mask: (*p).ch_layout.u.mask,
            profile: (*p).profile,
            level: (*p).level,
            extradata: wire::b64(extradata),
        }
    }
}

/// 13.2: build a video-only stream spec from stored primitives (codec id,
/// extradata, dims, pixel format) — the parent has no live encoder after the
/// take. Used by the instant-replay save to mux a highlight clip.
pub fn video_spec_from_raw(
    codec_id: i32,
    extradata: &[u8],
    width: i32,
    height: i32,
    pix_fmt: i32,
) -> wire::StreamSpec {
    wire::StreamSpec {
        codec_type: ff::ffi::AVMediaType::AVMEDIA_TYPE_VIDEO as i32,
        codec_id,
        codec_tag: 0,
        format: pix_fmt,
        width,
        height,
        bit_rate: 0,
        sample_rate: 0,
        channels: 0,
        channel_mask: 0,
        profile: 0,
        level: 0,
        extradata: wire::b64(extradata),
    }
}

/// ffmpeg-sys-next 9 binds AVCodecID/AVMediaType as `#[repr(i32)]` Rust
/// enums, so the wire's i32 cannot be an `as` cast. Both sides produced the
/// value from the same enum, so transmute_copy is sound here (size checked).
unsafe fn enum_from_i32<T: Copy>(value: i32) -> T {
    debug_assert_eq!(std::mem::size_of::<T>(), std::mem::size_of::<i32>());
    unsafe { std::mem::transmute_copy(&value) }
}

/// Rebuild `AVCodecParameters` in the child from the wire description.
/// `avcodec_parameters_copy` (StreamMut::set_parameters) deep-copies
/// extradata, so the `av_malloc`'d buffer here is owned+freed by FFmpeg.
fn spec_to_parameters(spec: &wire::StreamSpec) -> Result<ff::codec::Parameters, io::Error> {
    let mut params = ff::codec::Parameters::new();
    let bytes = wire::unb64(&spec.extradata)?;
    unsafe {
        let p = params.as_mut_ptr();
        (*p).codec_type = enum_from_i32(spec.codec_type);
        (*p).codec_id = enum_from_i32(spec.codec_id);
        (*p).codec_tag = spec.codec_tag;
        (*p).format = spec.format;
        (*p).width = spec.width;
        (*p).height = spec.height;
        (*p).bit_rate = spec.bit_rate;
        (*p).sample_rate = spec.sample_rate;
        (*p).ch_layout.order = ff::ffi::AVChannelOrder::AV_CHANNEL_ORDER_NATIVE;
        (*p).ch_layout.nb_channels = spec.channels;
        (*p).ch_layout.u.mask = spec.channel_mask;
        (*p).profile = spec.profile;
        (*p).level = spec.level;
        if !bytes.is_empty() {
            // AV_INPUT_BUFFER_PADDING_SIZE trailing zero bytes are required
            // by libavcodec's bitstream readers; av_mallocz supplies them.
            let padded = bytes.len() + ff::ffi::AV_INPUT_BUFFER_PADDING_SIZE as usize;
            let ptr = ff::ffi::av_mallocz(padded) as *mut u8;
            if ptr.is_null() {
                return Err(io::Error::other("ssp-mux: av_mallocz for extradata failed"));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            (*p).extradata = ptr;
            (*p).extradata_size = bytes.len() as i32;
        }
    }
    Ok(params)
}

/// Write one packet into the child's muxer, rescaling from the wire's µs
/// base onto the stream's container time base — the same law as the old
/// in-process `Muxer::write` (including KEY flag restoration and in-order
/// `av_write_frame`; the parent pre-sorts each batch by pts for N streams).
fn write_packet(
    ctx: &mut ff::format::context::Output,
    tbs: &[ff::Rational],
    packet: &wire::Packet,
) -> Result<(), io::Error> {
    let stream_idx = packet.stream as usize;
    let stream_tb = *tbs.get(stream_idx).ok_or_else(|| {
        io::Error::other(format!("ssp-mux: packet names unknown stream {stream_idx}"))
    })?;
    let data = wire::unb64(&packet.data)?;
    let mut wire = ff::Packet::copy(&data);
    wire.set_stream(stream_idx);
    wire.set_pts(Some(packet.pts_us));
    wire.set_dts(packet.dts_us.or(Some(packet.pts_us)));
    if packet.key {
        wire.set_flags(ff::codec::packet::Flags::KEY);
    }
    wire.rescale_ts(ff::Rational(1, 1_000_000), stream_tb);
    // The parent emits each pass's packets globally sorted by pts, so
    // in-order av_write_frame stays per-stream monotonic across N tracks
    // (Phase 11.1). av_interleaved_write_frame reordered equal-dts
    // cross-stream packets and tripped libavformat's per-stream check.
    wire.write(ctx)
        .map_err(|err| io::Error::other(format!("ssp-mux: packet write failed: {err}")))?;
    Ok(())
}

/// Push FFmpeg's AVIO buffer to the OS (the session's 1 Hz crash-tolerance
/// cadence). SAFETY: `pb` belongs to the output context we own; avio_flush
/// takes no ownership and cannot invalidate it.
fn flush_io(ctx: &mut ff::format::context::Output) {
    unsafe {
        let pb = (*ctx.as_mut_ptr()).pb;
        if !pb.is_null() {
            ff::ffi::avio_flush(pb);
        }
    }
}

/// Container-specific header options. Hybrid MP4 means fragmented output:
/// each `moof`/`mdat` pair is immediately playable, so a killed take keeps
/// everything flushed up to the 1 Hz AVIO boundary (Phase 9.1). Matroska
/// gets the existing 1 s cluster cap instead.
fn container_options(path: &Path) -> Vec<(&'static str, &'static str)> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => vec![
            (
                "movflags",
                "frag_keyframe+empty_moov+default_base_moof+frag_custom",
            ),
            ("frag_duration", "1000000"),
            ("use_editlist", "0"),
        ],
        _ => vec![("cluster_time_limit", "1000")],
    }
}

/// One live output segment owned by the child. A `Split` swaps this struct
/// for a fresh one with identical stream specs, so the parent never has to
/// renegotiate codecs and no frame is lost at the boundary.
struct Segment {
    ctx: ff::format::context::Output,
    tbs: Vec<ff::Rational>,
}

/// Open one segment: create the file, rebuild every stream from the wire
/// codecpar (GLOBAL_HEADER extradata included), write the container header.
fn open_segment(init: &wire::Init) -> Result<Segment, io::Error> {
    let path = Path::new(&init.path);
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)?;
    }
    let mut ctx = ff::format::output(path)
        .map_err(|err| io::Error::other(format!("ssp-mux: output open failed: {err}")))?;
    for spec in &init.streams {
        let codec_id: ff::ffi::AVCodecID = unsafe { enum_from_i32(spec.codec_id) };
        let codec = ff::encoder::find(ff::codec::Id::from(codec_id)).ok_or_else(|| {
            io::Error::other("ssp-mux: stream codec is unavailable in this FFmpeg build")
        })?;
        let mut stream = ctx
            .add_stream(Some(codec))
            .map_err(|err| io::Error::other(format!("ssp-mux: stream allocation failed: {err}")))?;
        stream.set_parameters(spec_to_parameters(spec)?);
    }
    let mut opts = ff::Dictionary::new();
    for (key, value) in container_options(path) {
        opts.set(key, value);
    }
    ctx.write_header_with(opts)
        .map_err(|err| io::Error::other(format!("ssp-mux: header write failed: {err}")))?;
    let tbs = (0..init.streams.len())
        .map(|i| {
            ctx.stream(i)
                .map(|stream| stream.time_base())
                .unwrap_or(ff::Rational(1, 1_000_000))
        })
        .collect();
    Ok(Segment { ctx, tbs })
}

/// Project the accumulated chapters (the parent's DB JSON is authoritative)
/// into the current segment's native chapter tags. `add_chapter` updates an
/// existing id in place (ffmpeg-next 9's `Output::add_chapter`), so calling
/// this again after a new Chapter or a Split keeps each tag's `end` at the
/// next marker's start — gapless chapters, no duplicate ids. Millisecond
/// time base matches `Chapter::offset_ms` exactly (no rounding drift).
fn write_chapters(
    ctx: &mut ff::format::context::Output,
    chapters: &[wire::Chapter],
) -> Result<(), io::Error> {
    for (i, chapter) in chapters.iter().enumerate() {
        let end = chapters.get(i + 1).map_or_else(
            || chapter.offset_ms.saturating_add(1000),
            |next| next.offset_ms,
        );
        ctx.add_chapter(
            i as i64 + 1,
            ff::Rational(1, 1_000),
            chapter.offset_ms as i64,
            end as i64,
            &chapter.label,
        )
        .map_err(|err| io::Error::other(format!("ssp-mux: chapter {i} add failed: {err}")))?;
    }
    Ok(())
}

/// Child body. Reads the whole pipe, then finalizes on EOF. `ack` receives
/// one byte once the header is on disk (start-side path/codec errors must
/// surface in `recording_start`, not at stop). Passing a sink that is not
/// stdout keeps unit tests quiet.
pub fn run<R: Read, W: Write>(input: &mut R, ack: &mut W) -> Result<(), io::Error> {
    let init = match wire::read_frame(input)? {
        Some(wire::WireMsg::Init(init)) => init,
        Some(_) => return Err(io::Error::other("ssp-mux: first frame must be Init")),
        None => return Err(io::Error::other("ssp-mux: empty input (no Init)")),
    };
    ff::init().expect("libav* bootstrap failed");
    let mut segment = open_segment(&init)?;
    ack.write_all(&[1])?;
    ack.flush()?;
    // Phase 9.3: chapters are buffered projections, never a second source of
    // truth. They are re-written natively after every Chapter and Split frame.
    let mut chapters: Vec<wire::Chapter> = Vec::new();

    loop {
        match wire::read_frame(input)? {
            Some(wire::WireMsg::Packet(packet)) => {
                write_packet(&mut segment.ctx, &segment.tbs, &packet)?
            }
            Some(wire::WireMsg::Chapter(chapter)) => {
                chapters.push(chapter);
                write_chapters(&mut segment.ctx, &chapters)?;
            }
            Some(wire::WireMsg::Split(split)) => {
                // ARCHITECTURE §6: finalize the closed segment first (trailer
                // carries its chapter tags), then open the next one with the
                // SAME stream specs. FIFO pipe order ⇒ no dropped frame.
                segment.ctx.write_trailer().map_err(|err| {
                    io::Error::other(format!("ssp-mux: segment trailer write failed: {err}"))
                })?;
                let mut next_init = init.clone();
                next_init.path = split.next_path;
                segment = open_segment(&next_init)?;
                write_chapters(&mut segment.ctx, &chapters)?;
            }
            Some(wire::WireMsg::Flush) => flush_io(&mut segment.ctx),
            Some(wire::WireMsg::Init(_)) => {
                return Err(io::Error::other("ssp-mux: duplicate Init frame"));
            }
            None => break, // parent EOF (or SIGKILL) → finalize
        }
    }
    // write_trailer emits the cues/seekhead; on stdin EOF it ALWAYS runs,
    // even though the parent is gone. That is the whole point of 9.2.
    segment
        .ctx
        .write_trailer()
        .map_err(|err| io::Error::other(format!("ssp-mux: trailer write failed: {err}")))?;
    Ok(())
}

/// The binary entry point. Stdin is the only channel from the parent.
#[allow(dead_code)]
fn main() {
    let mut input = io::stdin().lock();
    let mut ack = io::stdout().lock();
    if let Err(err) = run(&mut input, &mut ack) {
        eprintln!("ssp-mux: {err}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn sample_init(path: &Path) -> wire::Init {
        let codec_id: ff::ffi::AVCodecID = ff::codec::Id::H264.into();
        let pixel: ff::ffi::AVPixelFormat = ff::format::Pixel::YUV420P.into();
        let medium: ff::ffi::AVMediaType = ff::media::Type::Video.into();
        wire::Init {
            path: path.to_string_lossy().into_owned(),
            streams: vec![wire::StreamSpec {
                codec_type: medium as i32,
                codec_id: codec_id as i32,
                codec_tag: 0,
                format: pixel as i32,
                width: 128,
                height: 96,
                bit_rate: 0,
                sample_rate: 0,
                channels: 0,
                channel_mask: 0,
                profile: 0,
                level: 0,
                extradata: String::new(),
            }],
        }
    }

    #[test]
    fn length_prefixed_frames_round_trip() {
        let init = sample_init(Path::new("/tmp/never-written.mkv"));
        let packet = wire::Packet {
            stream: 0,
            pts_us: 16_667,
            dts_us: None,
            key: true,
            data: wire::b64(&[0, 0, 1, 0x65, 0x88, 0x84]),
        };
        let chapter = wire::Chapter {
            offset_ms: 1_500,
            label: "intro".into(),
        };
        let split = wire::Split {
            next_path: "/tmp/never-written-2.mkv".into(),
        };
        let mut buf = Vec::new();
        wire::write_frame(&mut buf, &wire::WireMsg::Init(init.clone())).unwrap();
        wire::write_frame(&mut buf, &wire::WireMsg::Packet(packet.clone())).unwrap();
        wire::write_frame(&mut buf, &wire::WireMsg::Chapter(chapter.clone())).unwrap();
        wire::write_frame(&mut buf, &wire::WireMsg::Split(split.clone())).unwrap();
        wire::write_frame(&mut buf, &wire::WireMsg::Flush).unwrap();

        let mut cursor = Cursor::new(buf);
        assert_eq!(
            wire::read_frame(&mut cursor).unwrap(),
            Some(wire::WireMsg::Init(init))
        );
        assert_eq!(
            wire::read_frame(&mut cursor).unwrap(),
            Some(wire::WireMsg::Packet(packet))
        );
        assert_eq!(
            wire::read_frame(&mut cursor).unwrap(),
            Some(wire::WireMsg::Chapter(chapter))
        );
        assert_eq!(
            wire::read_frame(&mut cursor).unwrap(),
            Some(wire::WireMsg::Split(split))
        );
        assert_eq!(
            wire::read_frame(&mut cursor).unwrap(),
            Some(wire::WireMsg::Flush)
        );
        assert_eq!(
            wire::read_frame(&mut cursor).unwrap(),
            None,
            "EOF is finalization"
        );
    }

    #[test]
    fn truncated_frames_are_errors_not_silent_finalization() {
        let mut buf = Vec::new();
        wire::write_frame(&mut buf, &wire::WireMsg::Flush).unwrap();
        // Full prefix, truncated body: must not be mistaken for EOF.
        let cut = buf.len() - 1;
        assert!(wire::read_frame(&mut Cursor::new(&buf[..cut])).is_err());
        // Out-of-bounds length prefix: rejected before allocating.
        let mut bogus = Vec::new();
        bogus.extend_from_slice(&(wire::MAX_FRAME_LEN + 1).to_le_bytes());
        assert!(wire::read_frame(&mut Cursor::new(bogus)).is_err());
    }
}
