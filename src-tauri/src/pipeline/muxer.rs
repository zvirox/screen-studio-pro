use crate::encode::{EncodedPacket, EncoderSelection, PACKET_TIME_BASE, hw};
use crate::util::error::CoreError;
use ffmpeg_next as ff;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};

/* Phase 9.2 (PLAN 9.2): the child's wire codec lives in the helper binary's
source; including it here makes parent and child share ONE definition —
they cannot drift. The binary's `main` is dead code in this library build. */
#[path = "../bin/ssp-mux.rs"]
pub mod ssp_mux;

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

fn unavailable(what: &str) -> CoreError {
    CoreError::encoder(
        "encoder.unavailable",
        true,
        format!(
            "The {what} encoder is missing. Check that the ffmpeg system libraries are installed."
        ),
    )
}

/* ---------- Phase 9.2: parent-side encoder opens ----------

`MuxerBuilder::add_*` used to own the opened encoder AND the stream. The
subprocess path needs the opposite ownership: the PARENT opens the encoders
(so it can encode frames), the CHILD creates the streams. These helpers are
the shared spine — both paths call them, so GLOBAL_HEADER is applied in
exactly one place and MKV/MP4 keep SPS/PPS up-front in CodecPrivate. */

/// Does this output container opt into AVFMT_GLOBALHEADER? The MVP output
/// set is closed (mkv/webm/mp4) and all three muxers set the flag — the
/// same value `MuxerBuilder::create` used to read from its output context
/// before `add_stream`. Conservative "yes" for unknown names keeps
/// extradata with the encoder instead of silently dropping it.
pub fn wants_global_header(_container: &str) -> bool {
    // The supported output set is closed (PRD MVP: mkv/mp4/webm). All three
    // muxers set AVFMT_GLOBALHEADER, which is what `MuxerBuilder::create`
    // observed from its output context before the refactor. An unknown name
    // keeps the conservative "yes" so extradata is never silently dropped.
    true
}

/// Open the video encoder WITHOUT owning an output muxer. The caller feeds
/// the returned context to `SwX264::from_open` and sends its codecpar (via
/// `codecpar_to_spec`) to `ssp-mux`.
pub fn open_video_encoder(
    spec: &VideoSpec,
    global_header: bool,
) -> Result<ff::encoder::Video, CoreError> {
    let codec = ff::encoder::find(spec.codec).ok_or_else(|| unavailable("x264 video"))?;
    open_video_inner(spec, codec, &spec.options, global_header, None)
}

/// Open the encoder CHOSEN by the selection chain, with its hardware
/// frames context attached before `avcodec_open2` (libavcodec requires the
/// frames ctx at open time — attaching after would fail the take). The
/// returned `Context` is owned by the caller and moved into the backend.
pub fn open_selected_video_encoder(
    spec: &VideoSpec,
    selection: &EncoderSelection,
    global_header: bool,
) -> Result<(ff::encoder::Video, Option<hw::Context>), CoreError> {
    let codec =
        ff::encoder::find_by_name(selection.codec).ok_or_else(|| unavailable(selection.codec))?;
    let frames = match selection.hw {
        Some(kind) => Some(hw::Context::create(
            kind,
            selection.device_path.as_deref(),
            (spec.width, spec.height),
            ff::format::Pixel::NV12,
        )?),
        None => None,
    };
    let video = open_video_inner(
        spec,
        codec,
        &selection.options,
        global_header,
        frames.as_ref(),
    )?;
    Ok((video, frames))
}

/// The single open path shared by the software and hardware callers, so
/// GLOBAL_HEADER, time base, frame rate and option handling cannot drift.
fn open_video_inner(
    spec: &VideoSpec,
    codec: ff::Codec,
    options: &[(String, String)],
    global_header: bool,
    frames: Option<&hw::Context>,
) -> Result<ff::encoder::Video, CoreError> {
    crate::encode::ensure_init();
    let mut view = ff::codec::context::Context::new_with_codec(codec)
        .encoder()
        .video()
        .map_err(|err| init_failed(Path::new("<encoder>"), "video encoder context", err))?;
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
    for (key, value) in options {
        dict.set(key.as_str(), value.as_str());
    }
    if let Some(frames) = frames {
        frames.attach(unsafe { view.as_mut_ptr() })?;
    }
    view.open_with(dict)
        .map_err(|err| init_failed(Path::new("<encoder>"), "video encoder open", err))
}

/// Open the AAC encoder WITHOUT owning an output muxer. Audio stamps in
/// the SAMPLE clock; the child rescales µs packet stamps to the stream's
/// container time base just like the old in-process `Muxer::write`.
pub fn open_audio_encoder(
    spec: &AudioSpec,
    global_header: bool,
) -> Result<ff::encoder::Audio, CoreError> {
    crate::encode::ensure_init();
    let codec = ff::encoder::find(spec.codec).ok_or_else(|| unavailable("AAC audio"))?;
    let mut view = ff::codec::context::Context::new_with_codec(codec)
        .encoder()
        .audio()
        .map_err(|err| init_failed(Path::new("<encoder>"), "audio encoder context", err))?;
    if global_header {
        view.set_flags(ff::codec::Flags::GLOBAL_HEADER);
    }
    view.set_format(spec.sample_fmt);
    view.set_rate(spec.sample_rate as i32);
    view.set_channel_layout(spec.channel_layout);
    view.set_bit_rate(spec.bit_rate);
    view.set_time_base(ff::Rational::new(1, spec.sample_rate as i32));
    view.open_with(ff::Dictionary::new())
        .map_err(|err| init_failed(Path::new("<encoder>"), "audio encoder open", err))
}

/// Read an opened encoder's `extradata` (the GLOBAL_HEADER SPS/PPS record)
/// through raw FFI — ffmpeg-next 9 has no safe accessor. The bytes ride in
/// the Init frame so the child's stream parameters match this encoder.
pub fn encoder_extradata(encoder: &impl AsRef<ff::codec::Context>) -> Vec<u8> {
    unsafe {
        let ctx = encoder.as_ref().as_ptr();
        if (*ctx).extradata.is_null() || (*ctx).extradata_size <= 0 {
            return Vec::new();
        }
        let len = (*ctx).extradata_size as usize;
        std::slice::from_raw_parts((*ctx).extradata, len).to_vec()
    }
}

/// First-run folder bootstrap, shared by the in-process builder and the
/// subprocess client (PRD G3: no take dies ENOENT on a fresh profile).
fn ensure_output_dir(path: &Path) -> Result<(), CoreError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|err| {
            tracing::error!(error = %err, path = %parent.display(), "save folder create failed");
            CoreError::disk(
                "disk.path_unwritable",
                false,
                "The recording folder could not be created. Pick another folder in Files settings.",
            )
        })?;
    }
    Ok(())
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
        ensure_output_dir(path)?;
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
        let codec = ff::encoder::find(spec.codec).ok_or_else(|| unavailable("x264 video"))?;
        let mut stream = self
            .ctx
            .add_stream(Some(codec))
            .map_err(|err| init_failed(path, "stream allocation", err))?;
        // Open through the SAME helper the subprocess parent uses — the
        // in-process path and the subprocess path cannot drift on flags.
        let opened = open_video_encoder(spec, self.global_header)?;
        stream.set_parameters(&opened);
        self.streams += 1;
        Ok((self, opened))
    }

    /// Adds + opens the audio stream (2.1). The opened encoder hands to
    /// `sw_aac::from_open`. Stream index = 1 in the two-stream take.
    pub fn add_audio(mut self, spec: &AudioSpec) -> Result<(Self, ff::encoder::Audio), CoreError> {
        let path = &self.path;
        let codec = ff::encoder::find(spec.codec).ok_or_else(|| unavailable("AAC audio"))?;
        let mut stream = self
            .ctx
            .add_stream(Some(codec))
            .map_err(|err| init_failed(path, "audio stream allocation", err))?;
        let opened = open_audio_encoder(spec, self.global_header)?;
        stream.set_parameters(&opened);
        self.streams += 1;
        Ok((self, opened))
    }

    /// Override the codecpar pixel format of an already-added stream.
    ///
    /// Hardware encoders describe their codecpar as `vaapi`/`cuda` (the
    /// format they CONSUME), but a container stream must advertise the
    /// decoded format (`yuv420p`) or ffprobe/players see a bogus pixel
    /// format. The override happens BEFORE `write_header` (Phase 7.4).
    pub fn set_stream_pix_fmt(&mut self, index: usize, pix_fmt: ff::format::Pixel) {
        if let Some(mut stream) = self.ctx.stream_mut(index) {
            unsafe {
                let pixel: ff::ffi::AVPixelFormat = pix_fmt.into();
                (*(*stream.as_mut_ptr()).codecpar).format = pixel as i32;
            }
        }
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

/* ---------- Phase 9.2: subprocess muxer client ----------

The parent owns the encoders and this thin handle; the child (`ssp-mux`)
owns libavformat and the output file. Encoded packets cross the process
boundary on an anonymous pipe (ChildStdin) — never Tauri IPC. Dropping the
write end is the parent-death signal: the kernel closes the fd, the child
sees EOF, and writes the trailer. `Drop` and `finalize` both do exactly that. */

/// Locate the helper: explicit path (packaged resource) → `SSP_MUX_BIN`
/// (dev/test override) → a `ssp-mux` in an ancestor of `current_exe`
/// (`cargo test` runs lib tests from `target/debug/build/…/out/`).
/// ARCHITECTURE §5.3 documents the env var; no new UI setting is added.
fn helper_path(explicit: Option<&Path>) -> Result<PathBuf, CoreError> {
    if let Some(path) = explicit {
        return Ok(path.to_owned());
    }
    if let Some(path) = std::env::var_os("SSP_MUX_BIN") {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe().map_err(|err| {
        tracing::error!(error = %err, "current_exe failed while locating ssp-mux");
        CoreError::encoder(
            "encoder.init_failed",
            false,
            "The muxer helper could not be located.",
        )
    })?;
    // Cargo runs lib unit tests from `target/debug/build/<pkg>/<hash>/out/`,
    // so walk up a bounded number of ancestors until `target/debug/ssp-mux`
    // (or the packaged app dir) is found.
    let mut dir = exe.parent();
    for _ in 0..8 {
        let Some(parent) = dir else { break };
        let candidate = parent.join("ssp-mux");
        if candidate.is_file() {
            return Ok(candidate);
        }
        dir = parent.parent();
    }
    tracing::error!(?exe, "ssp-mux helper binary not found");
    Err(CoreError::encoder(
        "encoder.init_failed",
        false,
        "The muxer helper is missing. Reinstall the app so ssp-mux is bundled.",
    ))
}

/// A one-take connection to `ssp-mux`. Same surface as the old `Muxer`
/// (`write`/`flush`/`finalize`/`path`) so the session worker is unchanged
/// apart from construction.
pub struct SubprocessMuxer {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    path: PathBuf,
    waited: bool,
}

impl SubprocessMuxer {
    /// Spawn the child, send the Init frame (with both streams' codecpar
    /// copied from the OPENED encoders), and wait for the header ack so
    /// bad output paths still surface in `recording_start`.
    pub fn spawn(
        path: &Path,
        video_encoder: &ff::encoder::Video,
        audio_encoder: Option<&ff::encoder::Audio>,
        helper: Option<&Path>,
    ) -> Result<Self, CoreError> {
        Self::spawn_with_stream_pix_fmt(path, video_encoder, audio_encoder, helper, None)
    }

    /// Same as `spawn`, but rewrites the video stream's container pixel
    /// format to `stream_pix_fmt`. Hardware codecpar reports the surface
    /// format (`vaapi`/`cuda`); the child muxer needs `yuv420p` to write a
    /// valid H.264 stream description (MKV CodecPrivate / hybrid MP4).
    pub fn spawn_with_stream_pix_fmt(
        path: &Path,
        video_encoder: &ff::encoder::Video,
        audio_encoder: Option<&ff::encoder::Audio>,
        helper: Option<&Path>,
        stream_pix_fmt: Option<ff::format::Pixel>,
    ) -> Result<Self, CoreError> {
        crate::encode::ensure_init();
        ensure_output_dir(path)?;
        let helper = helper_path(helper)?;
        let mut command = Command::new(&helper);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        // FD HYGIENE (Phase 9.2): libavdevice opens /dev/video* with raw
        // `open()` (no O_CLOEXEC), so a plain `Command::spawn` leaks the
        // camera fd into the child. A live take then blocks the camera's
        // close→reopen in another test (and in a real session, a camera
        // restart) because the kernel still sees that fd. Close everything
        // above stdio in the forked child — the pipe fds are already dup2'd
        // onto 0/1/2 before pre_exec runs. `close` is async-signal-safe.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe extern "C" {
                fn close(fd: i32) -> i32;
            }
            unsafe {
                command.pre_exec(|| {
                    for fd in 3..1024 {
                        let _ = close(fd);
                    }
                    Ok(())
                });
            }
        }
        let mut child = command.spawn().map_err(|err| {
            tracing::error!(error = %err, path = %helper.display(), "ssp-mux spawn failed");
            CoreError::encoder(
                "encoder.init_failed",
                false,
                "The muxer helper could not start. Check the installation.",
            )
        })?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        // Stream order is fixed: video 0, audio 1 (API take shape).
        let mut video_spec =
            ssp_mux::codecpar_to_spec(video_encoder, &encoder_extradata(video_encoder));
        if let Some(pix_fmt) = stream_pix_fmt {
            // ARCHITECTURE §2: codecpar format is the container's decoded
            // format, not the encoder's surface format (Phase 7.4).
            let pixel: ff::ffi::AVPixelFormat = pix_fmt.into();
            video_spec.format = pixel as i32;
        }
        let mut specs = vec![video_spec];
        if let Some(encoder) = audio_encoder {
            specs.push(ssp_mux::codecpar_to_spec(
                encoder,
                &encoder_extradata(encoder),
            ));
        }
        let init = ssp_mux::wire::Init {
            path: path.to_string_lossy().into_owned(),
            streams: specs,
        };
        let sent = ssp_mux::wire::write_frame(&mut stdin, &ssp_mux::wire::WireMsg::Init(init))
            .and_then(|_| stdin.flush());
        if let Err(err) = sent {
            let _ = child.kill();
            let _ = child.wait();
            tracing::error!(error = %err, "ssp-mux Init write failed");
            return Err(CoreError::disk(
                "disk.write_failed",
                false,
                "The muxer helper stopped before the take began.",
            ));
        }
        // One ack byte AFTER the child wrote the container header — this is
        // the start-side guarantee the in-process builder gave us.
        let mut ack = [0u8; 1];
        let mut stdout = child.stdout.take().expect("piped stdout");
        let acked = stdout.read_exact(&mut ack).map(|_| ack[0] == 1);
        drop(stdout);
        match acked {
            Ok(true) => {}
            Ok(false) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                tracing::error!(path = %path.display(), "ssp-mux header ack failed");
                return Err(CoreError::disk(
                    "disk.path_unwritable",
                    false,
                    "The recording file could not be created. Pick another folder in Files settings.",
                ));
            }
        }
        Ok(Self {
            child: Some(child),
            stdin: Some(stdin),
            path: path.to_owned(),
            waited: false,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Serialize encoded packets onto the pipe. Bounded: each frame has a
    /// length prefix and a hard 8 MiB cap (wire::MAX_FRAME_LEN).
    pub fn write(&mut self, packets: &[EncodedPacket]) -> Result<(), CoreError> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Err(CoreError::disk(
                "disk.write_failed",
                true,
                "Writing the recording ran into a disk problem. The file so far has been kept.",
            ));
        };
        for packet in packets {
            // Test-only observer: the perf harness measures A/V drift from
            // the SAME EncodedPacket stamps that are about to cross the
            // pipe, not from a re-derived container timestamp (PLAN 7.4).
            #[cfg(all(test, feature = "encode"))]
            crate::pipeline::stats::packet_probe::record(&self.path, packet);
            let msg = ssp_mux::wire::WireMsg::Packet(ssp_mux::wire::Packet {
                stream: packet.stream,
                pts_us: packet.pts_us,
                dts_us: packet.dts_us,
                key: packet.key,
                data: ssp_mux::wire::b64(&packet.data),
            });
            if let Err(err) = ssp_mux::wire::write_frame(stdin, &msg) {
                tracing::error!(error = %err, path = %self.path.display(), "ssp-mux packet write failed");
                return Err(CoreError::disk(
                    "disk.write_failed",
                    true,
                    "Writing the recording ran into a disk problem. The file so far has been kept.",
                ));
            }
        }
        Ok(())
    }

    /// Project a DB chapter marker into the child's native chapter tags.
    /// The DB (`recordings.chapter_json`) is authoritative; this is only a
    /// finalize-time projection (PRD §9 Open Question 2). Non-blocking on the
    /// capture producer: writes one bounded frame onto the pipe.
    pub fn add_chapter(&mut self, offset_ms: u64, label: &str) -> Result<(), CoreError> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Ok(());
        };
        let msg = ssp_mux::wire::WireMsg::Chapter(ssp_mux::wire::Chapter {
            offset_ms,
            label: label.to_owned(),
        });
        ssp_mux::wire::write_frame(stdin, &msg).map_err(|err| {
            tracing::error!(error = %err, "ssp-mux chapter frame failed");
            CoreError::disk(
                "disk.write_failed",
                true,
                "The chapter marker could not be written. The recording continues.",
            )
        })?;
        Ok(())
    }

    /// Ask the child to close the current segment and open `next_path` with
    /// identical stream specs. Frames stay in FIFO pipe order — none is
    /// dropped — and the child writes native chapter tags into every segment.
    pub fn split(&mut self, next_path: &Path) -> Result<(), CoreError> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Ok(());
        };
        let msg = ssp_mux::wire::WireMsg::Split(ssp_mux::wire::Split {
            next_path: next_path.to_string_lossy().into_owned(),
        });
        ssp_mux::wire::write_frame(stdin, &msg).map_err(|err| {
            tracing::error!(error = %err, path = %next_path.display(), "ssp-mux split frame failed");
            CoreError::disk(
                "disk.write_failed",
                true,
                "The recording could not be split. The current file continues.",
            )
        })?;
        // The child owns the new path now; keep `path` honest for callers.
        self.path = next_path.to_owned();
        Ok(())
    }

    /// Push the child's AVIO buffer to the OS (1 Hz crash-tolerance window).
    pub fn flush(&mut self) -> Result<(), CoreError> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Ok(());
        };
        ssp_mux::wire::write_frame(stdin, &ssp_mux::wire::WireMsg::Flush)
            .map_err(|err| {
                tracing::error!(error = %err, "ssp-mux flush frame failed");
                CoreError::disk(
                    "disk.write_failed",
                    true,
                    "Writing the recording ran into a disk problem. The file so far has been kept.",
                )
            })
            .map(drop)
    }

    /// Close the write end (EOF) and wait for the child's trailer. Exposed
    /// for the parent-death simulation test — dropping stdin is precisely
    /// what the kernel does to the child's fd when the parent dies.
    pub fn wait_for_exit(&mut self) -> Result<(), CoreError> {
        self.close_stdin();
        if self.waited {
            return Ok(());
        }
        self.waited = true;
        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(_)) => break,
                Ok(None) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Ok(None) => {
                    tracing::warn!("ssp-mux did not finalize in 5 s; killing it");
                    let _ = child.kill();
                    break;
                }
                Err(err) => {
                    tracing::error!(error = %err, "ssp-mux wait failed");
                    break;
                }
            }
        }
        let _ = child.wait();
        Err(CoreError::disk(
            "disk.write_failed",
            false,
            "The recording could not be finalized; its frames are still on disk.",
        ))
    }

    /// Normal stop: EOF → the child writes cues/seekhead → reap it.
    pub fn finalize(mut self) -> Result<(), CoreError> {
        self.wait_for_exit()
    }

    fn close_stdin(&mut self) {
        self.stdin.take();
    }
}

impl Drop for SubprocessMuxer {
    fn drop(&mut self) {
        // Fault / zero-frame paths: EOF is still the right signal — the
        // child finalizes whatever it received, no panic, no orphan.
        let _ = self.wait_for_exit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FD hygiene for test-side ffprobe calls: a forked probe must NOT inherit
    /// the camera's raw V4L2 fd (the same law `SubprocessMuxer::spawn` applies
    /// to `ssp-mux`). Without it, a probe spawned while the real-camera smoke
    /// test holds `/dev/video0` makes its close→reopen fail with EBUSY under
    /// parallel `cargo test` — a test-harness artifact, not product behavior.
    fn probe_command() -> std::process::Command {
        let mut command = std::process::Command::new("ffprobe");
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe extern "C" {
                fn close(fd: i32) -> i32;
            }
            unsafe {
                command.pre_exec(|| {
                    for fd in 3..1024 {
                        let _ = close(fd);
                    }
                    Ok(())
                });
            }
        }
        command
    }

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

        let report = probe_command()
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

    /* ---------- Phase 9.2 verification gates ---------- */

    /// Build a real encoded take on the PARENT side of the wire: open the
    /// encoder with the shared helper, encode synthetic frames, serialize
    /// Init + access units + tail. No `finalize` frame — EOF is the signal.
    fn wire_take(path: &Path) -> (Vec<u8>, Vec<u8>) {
        use crate::encode::{
            Encoder,
            sw_x264::{self, SwX264},
        };
        use crate::pipeline::{Frame, FrameLayout};

        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 128,
            height: 96,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: sw_x264::options(),
        };
        let opened = open_video_encoder(&spec, true).expect("parent encoder opens");
        let extradata = encoder_extradata(&opened);
        assert!(
            !extradata.is_empty(),
            "GLOBAL_HEADER SPS/PPS survived avcodec_open2"
        );
        let init = ssp_mux::wire::Init {
            path: path.to_string_lossy().into_owned(),
            streams: vec![ssp_mux::codecpar_to_spec(&opened, &extradata)],
        };
        let mut encoder = SwX264::from_open(opened);
        let mut input = Vec::new();
        ssp_mux::wire::write_frame(&mut input, &ssp_mux::wire::WireMsg::Init(init)).unwrap();
        let write_packets = |input: &mut Vec<u8>, packets: Vec<crate::encode::EncodedPacket>| {
            for packet in packets {
                ssp_mux::wire::write_frame(
                    input,
                    &ssp_mux::wire::WireMsg::Packet(ssp_mux::wire::Packet {
                        stream: packet.stream,
                        pts_us: packet.pts_us,
                        dts_us: packet.dts_us,
                        key: packet.key,
                        data: ssp_mux::wire::b64(&packet.data),
                    }),
                )
                .unwrap();
            }
        };
        for n in 0..90u64 {
            let mut data = vec![0u8; 128 * 4 * 96];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let frame = Frame {
                width: 128,
                height: 96,
                stride: 128 * 4,
                layout: FrameLayout::Bgrx,
                pts_us: n * 16_667,
                data,
            };
            write_packets(&mut input, encoder.encode(&frame).expect("encode"));
        }
        write_packets(&mut input, encoder.finish().expect("encoder tail"));
        (input, extradata)
    }

    fn probe_chapters(path: &Path) -> Option<serde_json::Value> {
        let output = probe_command()
            .args(["-v", "error", "-show_chapters", "-of", "json"])
            .arg(path)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        serde_json::from_slice(&output.stdout).ok()
    }

    fn probe_duration(path: &Path) -> Option<serde_json::Value> {
        let report = probe_command()
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
        if !report.status.success() {
            return None;
        }
        serde_json::from_slice(&report.stdout).ok()
    }

    /// The child body writes the trailer on EOF even with NO explicit
    /// finalize message — the kernel pipe close is the only signal.
    #[test]
    fn child_body_finalizes_on_eof() {
        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("child-eof.mkv");
        let (input, _) = wire_take(&path);
        let mut cursor = std::io::Cursor::new(input);
        let mut ack = Vec::new();
        ssp_mux::run(&mut cursor, &mut ack).expect("child body drains input to EOF");
        assert_eq!(ack, vec![1], "the header is acked before packets are read");
        let report = probe_duration(&path).expect("ffprobe reads the EOF-finalized file");
        assert_eq!(report["streams"][0]["codec_name"], "h264");
        assert_eq!(report["streams"][0]["width"], 128);
        let duration: f64 = report["format"]["duration"]
            .as_str()
            .and_then(|d| d.parse().ok())
            .expect("probeable duration");
        assert!((1.2..=2.0).contains(&duration), "duration {duration}");
    }

    /// Phase 9.3 gate: a Chapter frame is projected by the child into a
    /// NATIVE container chapter tag — `ffprobe -show_chapters` is the proof.
    /// The DB JSON stays authoritative; this is only the finalize-time tag.
    #[test]
    fn chapter_frames_produce_native_chapter_tags() {
        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("chapters.mkv");
        let (mut input, _) = wire_take(&path);
        ssp_mux::wire::write_frame(
            &mut input,
            &ssp_mux::wire::WireMsg::Chapter(ssp_mux::wire::Chapter {
                offset_ms: 200,
                label: "intro".into(),
            }),
        )
        .unwrap();
        ssp_mux::wire::write_frame(
            &mut input,
            &ssp_mux::wire::WireMsg::Chapter(ssp_mux::wire::Chapter {
                offset_ms: 900,
                label: "demo".into(),
            }),
        )
        .unwrap();
        let mut cursor = std::io::Cursor::new(input);
        let mut ack = Vec::new();
        ssp_mux::run(&mut cursor, &mut ack).expect("child body drains to EOF");

        let report = probe_chapters(&path).expect("ffprobe reads native chapters");
        let chapters = report["chapters"].as_array().expect("chapters array");
        assert_eq!(chapters.len(), 2, "two chapter tags written natively");
        assert_eq!(chapters[0]["tags"]["title"], "intro");
        assert_eq!(chapters[1]["tags"]["title"], "demo");
        // Millisecond time base: the start_time is the exact offset in seconds.
        let start: f64 = chapters[0]["start_time"].as_str().unwrap().parse().unwrap();
        assert!(
            (start - 0.2).abs() < 0.02,
            "chapter start 200 ms, got {start}"
        );
    }

    /// Phase 9.3 split gate: two gapless segment files probe independently,
    /// each carrying the full chapter projection, and the parent's path
    /// switches to the new file for subsequent packets.
    #[test]
    fn split_writes_two_gapless_probeable_segments() {
        use crate::encode::{
            Encoder,
            sw_x264::{self, SwX264},
        };
        use crate::pipeline::{Frame, FrameLayout};

        let tmp = tempfile::tempdir().expect("tmp dir");
        let first = tmp.path().join("split-1.mkv");
        let second = tmp.path().join("split-2.mkv");
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 128,
            height: 96,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: sw_x264::options(),
        };
        let opened = open_video_encoder(&spec, true).expect("encoder");
        let mut mux = SubprocessMuxer::spawn(&first, &opened, None, None).expect("spawn + ack");
        mux.add_chapter(0, "intro").expect("chapter");
        let mut encoder = SwX264::from_open(opened);
        let frame = |n: u64| Frame {
            width: 128,
            height: 96,
            stride: 128 * 4,
            layout: FrameLayout::Bgrx,
            pts_us: n * 16_667,
            data: (0..128 * 4 * 96).map(|i| (n as usize ^ i) as u8).collect(),
        };
        for n in 0..60 {
            let packets = encoder.encode(&frame(n)).expect("encode");
            mux.write(&packets).expect("first segment write");
        }
        mux.split(&second).expect("split to second path");
        assert_eq!(mux.path(), second.as_path(), "parent follows the new path");
        mux.add_chapter(500, "after-split")
            .expect("chapter in second segment");
        for n in 60..120 {
            let packets = encoder.encode(&frame(n)).expect("encode");
            mux.write(&packets).expect("second segment write");
        }
        mux.write(&encoder.finish().expect("tail"))
            .expect("tail write");
        mux.finalize().expect("EOF → trailer");

        let first_report = probe_duration(&first).expect("first segment probes");
        let second_report = probe_duration(&second).expect("second segment probes");
        assert_eq!(first_report["streams"][0]["codec_name"], "h264");
        assert_eq!(second_report["streams"][0]["codec_name"], "h264");
        let first_chapters = probe_chapters(&first).expect("first chapters");
        let second_chapters = probe_chapters(&second).expect("second chapters");
        assert_eq!(first_chapters["chapters"].as_array().unwrap().len(), 1);
        // The split segment re-projects ALL chapters collected so far.
        assert_eq!(second_chapters["chapters"].as_array().unwrap().len(), 2);
    }

    /// Spawn the REAL helper, write packets through `SubprocessMuxer`,
    /// finalize, and ffprobe. This is the production path, not a simulation.
    #[test]
    fn subprocess_muxer_finalizes_on_eof_and_probeable() {
        use crate::encode::{
            Encoder,
            sw_x264::{self, SwX264},
        };
        use crate::pipeline::{Frame, FrameLayout};

        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("subproc.mkv");
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 128,
            height: 96,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: sw_x264::options(),
        };
        let opened = open_video_encoder(&spec, true).expect("encoder");
        let mut mux = SubprocessMuxer::spawn(&path, &opened, None, None)
            .expect("helper spawned + header acked");
        let mut encoder = SwX264::from_open(opened);
        for n in 0..90u64 {
            let mut data = vec![0u8; 128 * 4 * 96];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let frame = Frame {
                width: 128,
                height: 96,
                stride: 128 * 4,
                layout: FrameLayout::Bgrx,
                pts_us: n * 16_667,
                data,
            };
            let packets = encoder.encode(&frame).expect("encode");
            mux.write(&packets).expect("wire write");
        }
        let tail = encoder.finish().expect("tail");
        mux.write(&tail).expect("tail write");
        mux.finalize().expect("EOF → trailer");
        let report = probe_duration(&path).expect("ffprobe reads the take");
        assert_eq!(report["streams"][0]["codec_name"], "h264");
        assert_eq!(report["streams"][0]["width"], 128);
    }

    /// Phase 9.1: an MP4 take is fragmented (`moof`/`mdat`) from the first
    /// keyframe, so a killed parent leaves a playable file rather than a
    /// header-only mp4 that needs the post-take remux.
    #[test]
    fn hybrid_mp4_is_fragmented_and_probeable_on_eof() {
        use crate::encode::{
            Encoder,
            sw_x264::{self, SwX264},
        };
        use crate::pipeline::{Frame, FrameLayout};

        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("hybrid.mp4");
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 128,
            height: 96,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: sw_x264::options(),
        };
        let opened = open_video_encoder(&spec, true).expect("encoder");
        let mut mux = SubprocessMuxer::spawn(&path, &opened, None, None)
            .expect("helper spawned + header acked");
        let mut encoder = SwX264::from_open(opened);
        for n in 0..90u64 {
            let mut data = vec![0u8; 128 * 4 * 96];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let packets = encoder
                .encode(&Frame {
                    width: 128,
                    height: 96,
                    stride: 128 * 4,
                    layout: FrameLayout::Bgrx,
                    pts_us: n * 16_667,
                    data,
                })
                .expect("encode");
            mux.write(&packets).expect("wire write");
        }
        mux.write(&encoder.finish().expect("tail"))
            .expect("tail write");
        mux.wait_for_exit().expect("EOF → trailer");
        drop(mux);

        let bytes = std::fs::read(&path).expect("mp4 written");
        assert!(
            bytes.windows(4).any(|window| window == b"moof"),
            "fragmented mp4 must contain moof boxes"
        );
        let report = probe_duration(&path).expect("ffprobe reads the hybrid mp4");
        assert_eq!(report["streams"][0]["codec_name"], "h264");
    }

    /// Parent-death simulation: only the ChildStdin write end is dropped —
    /// exactly the fd the kernel closes when the parent is SIGKILLed. No
    /// finalize request is sent; the child must still write a probeable file.
    /// NOTE: this is NOT the full Phase 9 SIGKILL gate (no real killed
    /// parent process here); that gate stays open until proven live.
    #[test]
    fn dropping_child_stdin_finalizes_the_take() {
        use crate::encode::{
            Encoder,
            sw_x264::{self, SwX264},
        };
        use crate::pipeline::{Frame, FrameLayout};

        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("parent-death.mkv");
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 128,
            height: 96,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: sw_x264::options(),
        };
        let opened = open_video_encoder(&spec, true).expect("encoder");
        let mut mux = SubprocessMuxer::spawn(&path, &opened, None, None)
            .expect("helper spawned + header acked");
        let mut encoder = SwX264::from_open(opened);
        for n in 0..90u64 {
            let mut data = vec![0u8; 128 * 4 * 96];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let frame = Frame {
                width: 128,
                height: 96,
                stride: 128 * 4,
                layout: FrameLayout::Bgrx,
                pts_us: n * 16_667,
                data,
            };
            let packets = encoder.encode(&frame).expect("encode");
            mux.write(&packets).expect("wire write");
        }
        // Simulated parent death: close stdin, no explicit finalize frame.
        mux.wait_for_exit().expect("child finalizes on EOF alone");
        drop(mux);
        let report = probe_duration(&path).expect("EOF-finalized file is probeable");
        assert_eq!(report["streams"][0]["codec_name"], "h264");
    }

    /// Test-only parent mode. Re-execing this test binary lets the outer
    /// test kill a REAL parent process with SIGKILL; `ssp-mux` must then see
    /// stdin EOF and finalize the file without any explicit close message.
    #[test]
    fn sigkill_parent_mode() {
        use crate::encode::{
            Encoder,
            sw_x264::{self, SwX264},
        };
        use crate::pipeline::{Frame, FrameLayout};

        if std::env::var_os("SSP_MUX_PARENT_MODE").is_none() {
            return;
        }
        let path = std::path::PathBuf::from(
            std::env::var("SSP_MUX_OUTPUT").expect("parent mode needs output path"),
        );
        let ready = std::path::PathBuf::from(
            std::env::var("SSP_MUX_READY").expect("parent mode needs ready sentinel"),
        );
        let helper = std::env::var_os("SSP_MUX_BIN").map(std::path::PathBuf::from);
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 128,
            height: 96,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (60, 1),
            options: sw_x264::options(),
        };
        let opened = open_video_encoder(&spec, true).expect("encoder in parent mode");
        let mut mux = SubprocessMuxer::spawn(&path, &opened, None, helper.as_deref())
            .expect("helper spawned in parent mode");
        let mut encoder = SwX264::from_open(opened);
        for n in 0..180_u64 {
            let mut data = vec![0u8; 128 * 4 * 96];
            for (i, byte) in data.iter_mut().enumerate() {
                *byte = (n as usize ^ i) as u8;
            }
            let packets = encoder
                .encode(&Frame {
                    width: 128,
                    height: 96,
                    stride: 128 * 4,
                    layout: FrameLayout::Bgrx,
                    pts_us: n * 16_667,
                    data,
                })
                .expect("encode in parent mode");
            mux.write(&packets).expect("wire write in parent mode");
        }
        mux.write(&encoder.finish().expect("tail in parent mode"))
            .expect("tail write in parent mode");
        mux.flush().expect("flush in parent mode");
        std::fs::write(&ready, b"ready").expect("ready sentinel");
        // Never drop `mux` and never send finalize: the outer test kills
        // this process, and the kernel closes the pipe write end.
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }

    /// Full Phase 9 gate: kill the REAL parent with SIGKILL, then require
    /// the orphaned `ssp-mux` child to finalize a probeable file. This is
    /// stronger than the ChildStdin-drop simulation above.
    #[test]
    #[cfg(unix)]
    fn sigkill_parent_leaves_probeable_file() {
        use std::os::unix::process::ExitStatusExt;
        use std::process::{Command, Stdio};

        let tmp = tempfile::tempdir().expect("tmp dir");
        let path = tmp.path().join("sigkill.mkv");
        let ready = tmp.path().join("ready");
        let exe = std::env::current_exe().expect("test binary path");
        let helper = helper_path(None).expect("ssp-mux helper located");
        let mut command = Command::new(exe);
        command
            .args([
                "--exact",
                "pipeline::muxer::tests::sigkill_parent_mode",
                "--nocapture",
            ])
            .env("SSP_MUX_PARENT_MODE", "1")
            .env("SSP_MUX_OUTPUT", &path)
            .env("SSP_MUX_READY", &ready)
            .env("SSP_MUX_BIN", &helper)
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        // This helper is forked from the test harness, which may hold the
        // real camera fd in a parallel test. Close inherited fds here too,
        // or the camera's close→reopen smoke test gets a false EBUSY.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe extern "C" {
                fn close(fd: i32) -> i32;
            }
            unsafe {
                command.pre_exec(|| {
                    for fd in 3..1024 {
                        let _ = close(fd);
                    }
                    Ok(())
                });
            }
        }
        let mut parent = command.spawn().expect("spawn parent-mode test process");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        while !ready.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(ready.exists(), "parent-mode process never became ready");

        let killed = Command::new("kill")
            .arg("-9")
            .arg(parent.id().to_string())
            .status()
            .expect("kill command");
        assert!(killed.success(), "SIGKILL command failed");
        let status = parent.wait().expect("reap killed parent");
        assert_eq!(status.signal(), Some(9), "parent was not SIGKILLed");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut last_len = 0;
        while std::time::Instant::now() < deadline {
            if let Ok(meta) = std::fs::metadata(&path) {
                let len = meta.len();
                if len > 0 && len == last_len && probe_duration(&path).is_some() {
                    break;
                }
                last_len = len;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let report = probe_duration(&path).expect("SIGKILL-finalized file is probeable");
        assert_eq!(report["streams"][0]["codec_name"], "h264");
        let duration: f64 = report["format"]["duration"]
            .as_str()
            .and_then(|d| d.parse().ok())
            .expect("probeable duration");
        assert!(duration >= 2.5, "SIGKILL lost the whole take: {duration}");
    }
}
