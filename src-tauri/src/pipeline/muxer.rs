use crate::encode::{EncodedPacket, PACKET_TIME_BASE};
use crate::util::error::CoreError;
use ffmpeg_next as ff;
use std::path::PathBuf;

/* MKV container writer (PLAN 1.3 — "muxer.rs"). One Muxer owns one output
file and one video stream; the encoder context is opened HERE because
avcodec must see the container's GLOBAL_HEADER flag before `avcodec_open2`
bakes extradata into the stream header (upstream transcode-x264.rs order:
add_stream → open encoder → set_parameters → write_header).

Crash tolerance (PLAN 1.3 verify): the matroska muxer flushes clusters
incrementally, so a killed process leaves header + contiguous cluster
run — ffprobe still reads the take; only cues/seekhead from the (missing)
trailer are gone. Every packet goes straight through `av_write_frame`
(pass-through, no interleave queue) — nothing accumulates in the muxer. */

/// What the muxer needs to open a video stream: codec id, output dims
/// (already even, the encode/ law), the pixel format the encoder will
/// CONSUME (sw path: yuv420p), frame rate, and per-backend raw opts.
pub struct VideoSpec {
    pub codec: ff::codec::Id,
    pub width: u32,
    pub height: u32,
    pub pix_fmt: ff::format::Pixel,
    pub frame_rate: (u32, u32),
    pub options: Vec<(String, String)>,
}

/// What the muxer needs to open the audio stream (2.1): codec, the
/// composition clock, stereo layout, the sample format the encoder will
/// CONSUME (AAC: FLTP), and the target bitrate.
pub struct AudioSpec {
    pub codec: ff::codec::Id,
    pub sample_rate: u32,
    pub channel_layout: ff::ChannelLayout,
    pub sample_fmt: ff::format::Sample,
    pub bit_rate: usize,
}

pub struct Muxer {
    ctx: ff::format::context::Output,
    /// Per-stream container time bases — `write` rescales each packet by
    /// the time base of the stream its `EncodedPacket::stream` names.
    tbs: Vec<ff::Rational>,
    path: PathBuf,
}

impl Muxer {
    /// Video-only take (the 1.3 shape, still used when audio is disabled):
    /// opens the file, builds + opens the encoder, writes the header.
    /// The returned `ff::encoder::Video` (the OPENED video encoder —
    /// mod re-export of `codec::encoder::video::Encoder`) is handed to
    /// the backend (`sw_x264::from_open`); from this call the file sits
    /// on disk.
    pub fn open_video(
        path: &std::path::Path,
        spec: VideoSpec,
    ) -> Result<(Self, ff::encoder::Video), CoreError> {
        let (builder, opened) = MuxerBuilder::create(path)?.add_video(&spec)?;
        Ok((builder.write_header()?, opened))
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// Writes encoded packets for the streams the muxer knows; each
    /// packet's rescale uses its OWN stream's time base. Raw cause →
    /// tracing; the take survives to surface the error at stop.
    pub fn write(&mut self, packets: &[EncodedPacket]) -> Result<(), CoreError> {
        for packet in packets {
            let stream_idx = packet.stream as usize;
            let stream_tb = *self.tbs.get(stream_idx).unwrap_or(&self.tbs[0]);
            let mut wire = ff::Packet::copy(&packet.data);
            wire.set_stream(stream_idx);
            wire.set_pts(Some(packet.pts_us));
            // Mirror pts when a backend does not reorder (no B-frames);
            // leaving dts unset breaks some muxers' interleaving checks.
            wire.set_dts(packet.dts_us.or(Some(packet.pts_us)));
            // Packet::copy clears flags; keyframes get their marker back
            // (players derive seek points from these in the container).
            if packet.key {
                wire.set_flags(ff::codec::packet::Flags::KEY);
            }
            wire.rescale_ts(PACKET_TIME_BASE, stream_tb);
            // Pass-through write (`av_write_frame`), NOT interleaved: the
            // interleave queue holds packets until write_trailer, so a
            // drop/crash before finalize would lose them (PLAN 1.3 crash
            // tolerance). With two streams: matroska only needs PER-STREAM
            // monotonic pts (video/audio each pace their own clock, see
            // pipeline/audio.rs) — no interleaving queue is required, and
            // skipping it keeps the crash-loss window at ~1 s for BOTH.
            //
            // Return-value law (FFmpeg ≥5 / libavformat 63): `av_write_frame`
            // returns 0 on SUCCESS; ffmpeg-next maps 0 → Ok(false) and the
            // legacy 1 → Ok(true). BOTH mean "written" — only Err is a
            // failure. (Reading the bool as "was it buffered?" inverted the
            // meaning and killed every take on its first packet.)
            wire.write(&mut self.ctx).map_err(|err| {
                tracing::error!(error = %err, path = %self.path.display(), "packet write failed");
                CoreError::disk(
                    "disk.write_failed",
                    true,
                    "Writing the recording ran into a disk problem. The file so far has been kept.",
                )
            })?;
        }
        Ok(())
    }

    /// Pushes the take toward the disk: flushes FFmpeg's AVIO buffer to
    /// the operating system.
    ///
    /// Crash tolerance (PLAN 1.3: a killed process must leave a PROBEABLE
    /// file). FFmpeg's AVIO layer buffers ~32 KB before writing through;
    /// a SIGKILL skips both the muxer's Drop and the buffer flush, so
    /// without this the killed file is a bare header (the ffmpeg CLI's
    /// own killed file is 0 bytes for exactly this reason).
    ///
    /// The recording session calls this on its 1 Hz window, so a crash
    /// costs at most ~1 s of the take's tail.
    ///
    /// SAFETY: `self.ctx` is the live `AVFormatContext` this Muxer owns
    /// and `pb` is the `AVIOContext` the format context owns. `avio_flush`
    /// is FFmpeg's documented way to push that buffer to the OS; it
    /// takes no ownership and cannot invalidate either pointer.
    pub fn flush(&mut self) -> Result<(), CoreError> {
        unsafe {
            // `avformat_flush` is the INPUT-side API (it calls
            // ff_read_frame_flush and SEGFAULTS on an output context);
            // the output path is avio_flush(s->pb).
            let ctx_ptr = self.ctx.as_mut_ptr();
            let pb = (*ctx_ptr).pb;
            if !pb.is_null() {
                ff::ffi::avio_flush(pb);
            }
        }
        Ok(())
    }

    /// Writes the trailer (cues/seekhead) and closes the file.
    pub fn finalize(mut self) -> Result<(), CoreError> {
        let path = self.path.clone();
        self.ctx.write_trailer().map_err(|err| {
            tracing::error!(error = %err, path = %path.display(), "trailer write failed");
            CoreError::disk(
                "disk.write_failed",
                false,
                "The recording could not be finalized; its frames are still on disk.",
            )
        })
    }
}

/// Start-side mux failures: an unusable output path is
/// `disk.path_unwritable` (contract: surfaced by recording_start).
fn path_failed(path: &std::path::Path, err: ff::Error) -> CoreError {
    tracing::error!(error = %err, path = %path.display(), "output open failed");
    CoreError::disk(
        "disk.path_unwritable",
        false,
        "The recording folder is not writable. Pick another folder in Files settings.",
    )
}

/// Start-side codec/stream failures are `encoder.init_failed` (contract:
/// surfaced by recording_start; raw cause → tracing only, DESIGN §7.9).
fn init_failed(path: &std::path::Path, what: &str, err: ff::Error) -> CoreError {
    tracing::error!(error = %err, path = %path.display(), "{what} failed");
    CoreError::encoder(
        "encoder.init_failed",
        false,
        "The video encoder could not start with the current settings.",
    )
}

/* ---------- multi-stream builder (2.1) ---------- */

/// Accumulates streams BEFORE the container header is written (a stream
/// cannot join after `write_header`). Each `add_*` returns the OPENED
/// encoder context for its backend — same contract as the old
/// `open_video`, now split so 2.1 can add the audio leg:
///
/// `create(path)?.add_video(..)?.add_audio(..)?.write_header()?`
pub struct MuxerBuilder {
    ctx: ff::format::context::Output,
    global_header: bool,
    path: PathBuf,
    /// Streams added so far — also the next stream's index.
    streams: usize,
}

impl MuxerBuilder {
    /// PRD G3: first run has no save folder yet — the app bootstraps
    /// its own (`~/Videos/SSP`), an ENOENT here would mislabel every
    /// take "not writable" (1.5 visual pass). A real permission failure
    /// still lands in `path_failed`.
    pub fn create(path: &std::path::Path) -> Result<Self, CoreError> {
        crate::encode::ensure_init();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                tracing::error!(error = %err, path = %parent.display(), "save folder create failed");
                CoreError::disk(
                    "disk.path_unwritable",
                    false,
                    "The recording folder could not be created. Pick another folder in Files settings.",
                )
            })?;
        }
        // Container inferred from the `.mkv` extension (matroska muxer).
        let ctx = ff::format::output(path).map_err(|err| path_failed(path, err))?;
        // THE muxer borrows ctx mutably for StreamMut — every ctx read
        // (GLOBAL_HEADER hint) must happen before add_stream.
        let global_header = ctx
            .format()
            .flags()
            .contains(ff::format::Flags::GLOBAL_HEADER);
        Ok(Self {
            ctx,
            global_header,
            path: path.to_owned(),
            streams: 0,
        })
    }

    /// Adds + opens the video stream (stream index `self.streams`, which
    /// IS 0 in the MVP wire shape — video is always the first stream).
    pub fn add_video(mut self, spec: &VideoSpec) -> Result<(Self, ff::encoder::Video), CoreError> {
        let path = &self.path;
        let codec = ff::encoder::find(spec.codec).ok_or_else(|| {
            CoreError::encoder(
                "encoder.unavailable",
                true,
                "The x264 video encoder is missing. Check that the ffmpeg system libraries are installed.",
            )
        })?;
        let mut stream = self
            .ctx
            .add_stream(Some(codec))
            .map_err(|err| init_failed(path, "stream allocation", err))?;

        let mut view = ff::codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()
            .map_err(|err| init_failed(path, "encoder context", err))?;
        // Matroska wants SPS/PPS up-front in CodecPrivate → when the
        // container opted into GLOBAL_HEADER, apply it before opening.
        if self.global_header {
            view.set_flags(ff::codec::Flags::GLOBAL_HEADER);
        }
        view.set_width(spec.width);
        view.set_height(spec.height);
        view.set_format(spec.pix_fmt);
        view.set_time_base(crate::encode::PACKET_TIME_BASE);
        view.set_frame_rate(Some(ff::Rational::new(
            spec.frame_rate.0 as i32,
            spec.frame_rate.1 as i32,
        )));
        let mut dict = ff::Dictionary::new();
        for (key, value) in &spec.options {
            dict.set(key.as_str(), value.as_str());
        }
        let opened = view
            .open_with(dict)
            .map_err(|err| init_failed(path, "encoder open", err))?;
        stream.set_parameters(&opened);
        self.streams += 1;
        Ok((self, opened))
    }

    /// Adds + opens the audio stream (2.1). The opened encoder hands to
    /// `sw_aac::from_open`. Stream index = 1 in the two-stream take.
    pub fn add_audio(mut self, spec: &AudioSpec) -> Result<(Self, ff::encoder::Audio), CoreError> {
        let path = &self.path;
        let codec = ff::encoder::find(spec.codec).ok_or_else(|| {
            CoreError::encoder(
                "encoder.unavailable",
                true,
                "The AAC audio encoder is missing. Check that the ffmpeg system libraries are installed.",
            )
        })?;
        let mut stream = self
            .ctx
            .add_stream(Some(codec))
            .map_err(|err| init_failed(path, "audio stream allocation", err))?;

        let mut view = ff::codec::context::Context::new_with_codec(codec)
            .encoder()
            .audio()
            .map_err(|err| init_failed(path, "audio encoder context", err))?;
        if self.global_header {
            view.set_flags(ff::codec::Flags::GLOBAL_HEADER);
        }
        view.set_format(spec.sample_fmt);
        view.set_rate(spec.sample_rate as i32);
        view.set_channel_layout(spec.channel_layout);
        view.set_bit_rate(spec.bit_rate);
        // Audio encoders stamp in the SAMPLE clock (1/sample_rate) —
        // sw_aac converts its chunk stamps to that base; the muxer
        // rescales the µs packet stamps onto this stream's clock.
        view.set_time_base(ff::Rational::new(1, spec.sample_rate as i32));
        let opened = view
            .open_with(ff::Dictionary::new())
            .map_err(|err| init_failed(path, "audio encoder open", err))?;
        stream.set_parameters(&opened);
        self.streams += 1;
        Ok((self, opened))
    }

    /// Writes the container header and freezes the stream set. Matroska
    /// buffers packets into CLUSTERS and writes a cluster only when its
    /// time/size limit is reached. The muxer's default 5 s cluster time
    /// limit means a crash in the first seconds of a take loses
    /// EVERYTHING (the file is a bare EBML header — not probeable).
    /// PLAN 1.3's crash-tolerance law wants a probeable file, so
    /// clusters are capped at 1 s: a crash costs at most ~1 s of the
    /// tail, the rest of the take stays readable.
    pub fn write_header(mut self) -> Result<Muxer, CoreError> {
        let path = self.path.clone();
        let mut muxer_opts = ff::Dictionary::new();
        muxer_opts.set("cluster_time_limit", "1000");
        self.ctx
            .write_header_with(muxer_opts)
            .map_err(|err| init_failed(&path, "header write", err))?;
        let tbs = (0..self.streams)
            .map(|i| {
                self.ctx
                    .stream(i)
                    .map(|stream| stream.time_base())
                    .unwrap_or_else(|| ff::Rational::new(1, 1_000_000))
            })
            .collect();
        Ok(Muxer {
            ctx: self.ctx,
            tbs,
            path,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// First run on a fresh machine: the default save folder
    /// (`~/Videos/SSP`) does not exist yet. PRD G3 promises 60 s to the
    /// first recording — the app bootstraps its own folder instead of
    /// erroring every take with `disk.path_unwritable` (found in the 1.5
    /// visual pass: every take died ENOENT, the UI told the user to pick
    /// another folder the app was supposed to create).
    #[test]
    fn open_video_creates_a_missing_output_folder() {
        crate::encode::ensure_init();
        let tmp = tempfile::tempdir().expect("tmp dir");
        let dir = tmp.path().join("SSP-missing");
        let path = dir.join("first-rec.mkv");
        assert!(!dir.exists(), "precondition: folder absent");

        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 320,
            height: 240,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: Vec::new(),
        };
        let (muxer, _opened) =
            Muxer::open_video(&path, spec).expect("missing folder is auto-created");
        assert!(dir.is_dir(), "the save folder now exists");
        muxer.finalize().expect("trailer still writes");
        assert!(path.exists(), "the take lands on disk");
    }

    /// 2.1's mux-level contract: a video + audio take probes as TWO
    /// streams (h264 + aac), the audio packets land on their own stream
    /// with correct stamps (≈ chunk-duration of audio), and the file
    /// finalizes. Real codecs both legs — this is the C.4 gate before
    /// the session wiring (which re-runs the check end-to-end).
    #[test]
    fn two_stream_take_probes_video_and_audio() {
        use crate::encode::sw_aac::{self, SwAac};
        use crate::encode::sw_x264::{self, SwX264};
        use crate::encode::{AudioEncoder, Encoder};
        use crate::pipeline::Frame;
        use std::process::Command;

        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("av.mkv");

        let (builder, venc) = MuxerBuilder::create(&path)
            .expect("create")
            .add_video(&VideoSpec {
                codec: ff::codec::Id::H264,
                width: 128,
                height: 96,
                pix_fmt: ff::format::Pixel::YUV420P,
                frame_rate: (60, 1),
                options: sw_x264::options(),
            })
            .expect("video stream");
        let (builder, aenc) = builder
            .add_audio(&AudioSpec {
                codec: ff::codec::Id::AAC,
                sample_rate: 48_000,
                channel_layout: ff::ChannelLayout::STEREO,
                sample_fmt: ff::format::Sample::F32(ff::format::sample::Type::Planar),
                bit_rate: sw_aac::AAC_BIT_RATE,
            })
            .expect("audio stream");
        let mut muxer = builder.write_header().expect("header");
        let mut video = SwX264::from_open(venc);
        let mut audio = SwAac::from_open(aenc);

        // ~0.5 s of video: 30 synthetic BGRx frames @60 fps cadence.
        for n in 0..30_u64 {
            let stride = 128usize * 4;
            let mut data = vec![0u8; stride * 96];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let frame = Frame {
                width: 128,
                height: 96,
                stride: stride as u32,
                layout: crate::pipeline::FrameLayout::Bgrx,
                pts_us: n * 16_667,
                data,
            };
            let packets = video.encode(&frame).expect("video encode");
            muxer.write(&packets).expect("video write");
        }
        // ~0.5 s of audio: 23 chunks × 1024 samples @48 kHz (23 × 21.33 ms
        // ≈ 490 ms), a quiet sine so the AAC encoder has real content.
        let mut audio_packets = 0usize;
        for chunk in 0..23_i64 {
            let pts_us = chunk * 1_000_000 * 1024 / 48_000;
            let interleaved: Vec<f32> = (0..1024)
                .flat_map(|i| {
                    let v = (i as f32 / 48_000.0 * 440.0 * std::f32::consts::TAU).sin() * 0.2;
                    [v, v]
                })
                .collect();
            let packets = audio.encode(pts_us, &interleaved).expect("audio encode");
            // AAC buffers one frame before its first emission — the
            // CONTRACT is cumulative drain: across N chunks ≥ N-1
            // packets, and finish() flushes the tail (asserted below).
            audio_packets += packets.len();
            muxer.write(&packets).expect("audio write");
        }
        let tail = video.finish().expect("video tail");
        muxer.write(&tail).expect("video tail write");
        let atail = audio
            .finish()
            .expect("audio tail flushes AAC's buffered frame");
        audio_packets += atail.len();
        muxer.write(&atail).expect("audio tail write");
        assert!(
            audio_packets >= 22,
            "cumulative drain: 23 chunks → ≥22 packets, got {audio_packets}"
        );
        muxer.finalize().expect("trailer");

        let report = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_streams",
                "-select_streams",
                "a:0",
                "-show_packets",
            ])
            .arg(&path)
            .output()
            .expect("ffprobe present (session-test harness contract)");
        assert!(report.status.success(), "ffprobe failed: {report:?}");
        let json: serde_json::Value = serde_json::from_slice(&report.stdout).unwrap();
        let streams = json["streams"].as_array().expect("streams array");
        assert_eq!(streams.len(), 1, "one audio stream");
        assert_eq!(streams[0]["codec_name"], "aac", "audio codec is AAC");
        // Audio timing contract: the LAST audio packet lands ≈ where the
        // 23 chunks put it (≈490 ms; matroska stores stream durations in
        // its own units, so the packet clock is the precise check).
        let packets = json["packets"].as_array().expect("packets array");
        assert!(!packets.is_empty(), "audio packets present");
        let last_pts = packets
            .last()
            .and_then(|p| p["pts_time"].as_str().and_then(|t| t.parse::<f64>().ok()))
            .expect("pts_time on the last packet");
        assert!(
            (0.4..0.65).contains(&last_pts),
            "audio timeline ≈0.49 s, got {last_pts}"
        );
    }
}
