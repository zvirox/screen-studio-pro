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

pub struct Muxer {
    ctx: ff::format::context::Output,
    stream_tb: ff::Rational,
    path: PathBuf,
}

impl Muxer {
    /// Opens the file, builds + opens the encoder, writes the header.
    /// The returned `ff::encoder::Video` (the OPENED video encoder —
    /// mod re-export of `codec::encoder::video::Encoder`) is handed to
    /// the backend (`sw_x264::from_open`); from this call the file sits
    /// on disk.
    pub fn open_video(
        path: &std::path::Path,
        spec: VideoSpec,
    ) -> Result<(Self, ff::encoder::Video), CoreError> {
        crate::encode::ensure_init();

        // PRD G3: first run has no save folder yet — the app bootstraps
        // its own (`~/Videos/SSP`), an ENOENT here would mislabel every
        // take "not writable" (1.5 visual pass). A real permission
        // failure still lands in `path_failed` below.
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
        let mut ctx = ff::format::output(path).map_err(|err| path_failed(path, err))?;

        let codec = ff::encoder::find(spec.codec).ok_or_else(|| {
            CoreError::encoder(
                "encoder.unavailable",
                true,
                "The x264 video encoder is missing. Check that the ffmpeg system libraries are installed.",
            )
        })?;
        // THE muxer borrows ctx mutably for StreamMut — every ctx read
        // (GLOBAL_HEADER hint) must happen before add_stream.
        let global_header = ctx
            .format()
            .flags()
            .contains(ff::format::Flags::GLOBAL_HEADER);
        let mut stream = ctx
            .add_stream(Some(codec))
            .map_err(|err| init_failed(path, "stream allocation", err))?;

        let mut view = ff::codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()
            .map_err(|err| init_failed(path, "encoder context", err))?;
        // Matroska wants SPS/PPS up-front in CodecPrivate → when the
        // container opted into GLOBAL_HEADER, apply it before opening.
        if global_header {
            view.set_flags(ff::codec::Flags::GLOBAL_HEADER);
        }
        view.set_width(spec.width);
        view.set_height(spec.height);
        view.set_format(spec.pix_fmt);
        view.set_time_base(PACKET_TIME_BASE);
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

        // Matroska buffers packets into CLUSTERS and writes a cluster
        // only when its time/size limit is reached. The muxer's default
        // 5 s cluster time limit means a crash in the first seconds of a
        // take loses EVERYTHING (the file is a bare EBML header — not
        // probeable). PLAN 1.3's crash-tolerance law wants a probeable
        // file, so clusters are capped at 1 s: a crash costs at most ~1 s
        // of the tail, the rest of the take stays readable.
        let mut muxer_opts = ff::Dictionary::new();
        muxer_opts.set("cluster_time_limit", "1000");
        ctx.write_header_with(muxer_opts)
            .map_err(|err| init_failed(path, "header write", err))?;
        let stream_tb = ctx.stream(0).expect("the stream added above").time_base();

        Ok((
            Self {
                ctx,
                stream_tb,
                path: path.to_owned(),
            },
            opened,
        ))
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// Writes encoded packets for stream 0; stamps rescale from the µs
    /// packet time base onto the container stream's clock. Raw cause →
    /// tracing; the take survives to surface the error at stop.
    pub fn write(&mut self, packets: &[EncodedPacket]) -> Result<(), CoreError> {
        for packet in packets {
            let mut wire = ff::Packet::copy(&packet.data);
            wire.set_stream(0);
            wire.set_pts(Some(packet.pts_us));
            // Mirror pts when a backend does not reorder (no B-frames);
            // leaving dts unset breaks some muxers' interleaving checks.
            wire.set_dts(packet.dts_us.or(Some(packet.pts_us)));
            // Packet::copy clears flags; keyframes get their marker back
            // (players derive seek points from these in the container).
            if packet.key {
                wire.set_flags(ff::codec::packet::Flags::KEY);
            }
            wire.rescale_ts(PACKET_TIME_BASE, self.stream_tb);
            // Pass-through write (`av_write_frame`), NOT interleaved: the
            // interleave queue holds packets until write_trailer, so a
            // drop/crash before finalize would lose them (PLAN 1.3 crash
            // tolerance). One video stream → interleaving is a no-op.
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
}
