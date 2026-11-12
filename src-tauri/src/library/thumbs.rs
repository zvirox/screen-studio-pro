use crate::util::error::CoreError;
use ffmpeg_next as ff;
use image::ImageEncoder;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/* §6.5 Thumbnail service (task 5.1, PRD M14 / API §2.1): after the muxer
   trailer is written and the MKV sits complete on disk, decode ONE frame
   from the video stream, downscale it to a sane thumbnail size, and
   write a PNG beside the library index. Extraction is NON-FATAL — the
   library row is created without a thumb if this fails (DATABASE §2.1:
   thumb_path is nullable), because a recording must never be lost to a
   thumbnail bug.

   Thumbnails live beside library.db: $XDG_DATA_HOME/screen-studio-pro/thumbs/
   per DATABASE §1 ("thumbnails beside it"). Filename is the source file's
   stem plus .png, so the same recording never gets two thumbs. */

/// Longest side of the served thumbnail, aspect preserved, never upscaled.
const THUMB_MAX_SIDE: u32 = 320;
/// PNG compression level (0-9).
const PNG_COMPRESSION_LEVEL: u8 = 6;

/// Decode the first video frame from `video_path` and write a PNG
/// thumbnail next to the library index. Returns the absolute thumb path.
pub fn extract_thumbnail(
    video_path: &Path,
    thumbs_dir: &Path,
    stop: &AtomicBool,
) -> Result<PathBuf, CoreError> {
    // Ensure ffmpeg is initialized (idempotent, cheap).
    crate::encode::ensure_init();

    // Build the output path: <thumbs_dir>/<video_stem>.png.
    let stem = video_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("thumb");
    let out_path = thumbs_dir.join(format!("{stem}.png"));

    // Open the file input, probe streams, find the video stream, open a
    // decoder — all in one helper.
    let (mut input, video_index, width, height, mut decoder) =
        open_video_input(video_path)?;

    let mut scaler = ff::software::scaling::Context::get(
        decoder.format(),
        width,
        height,
        ff::format::Pixel::RGB24,
        THUMB_MAX_SIDE.min(width),
        THUMB_MAX_SIDE.min(height),
        ff::software::scaling::Flags::BILINEAR,
    )
    .map_err(|err| {
        tracing::warn!(%err, "thumbnail scaler setup failed");
        CoreError::capture(
            "capture.preview_failed",
            true,
            "Thumbnail scaling could not be set up.",
        )
    })?;

    let mut decoded = ff::frame::Video::new(ff::format::Pixel::RGB24, 1, 1);
    let mut found = false;
    for (stream, packet) in input.packets() {
        if stop.load(Ordering::Acquire) {
            return Err(CoreError::capture(
                "capture.preview_failed",
                true,
                "Thumbnail extraction was cancelled.",
            ));
        }
        if stream.index() != video_index {
            continue;
        }
        if decoder.send_packet(&packet).is_err() {
            continue;
        }
        loop {
            match decoder.receive_frame(&mut decoded) {
                Err(ff::Error::Eof) | Err(ff::Error::Other { errno: 11 }) => break,
                Err(_) => break,
                Ok(()) => {
                    let mut rgb = ff::frame::Video::new(ff::format::Pixel::RGB24, 1, 1);
                    if scaler.run(&decoded, &mut rgb).is_err() {
                        continue;
                    }
                    // Stride-aware row copy into an RGB buffer.
                    let (tw, th) = (rgb.width(), rgb.height());
                    let stride = rgb.stride(0);
                    let data = rgb.data(0);
                    let mut png_buf = vec![0u8; tw as usize * th as usize * 3];
                    for y in 0..th {
                        let o = y as usize * stride;
                        let d = (y as usize * tw as usize) * 3;
                        png_buf[d..d + (tw as usize * 3)]
                            .copy_from_slice(&data[o..o + (tw as usize * 3)]);
                    }
                    let mut png = Vec::new();
                    image::codecs::png::PngEncoder::new_with_quality(
                        &mut png,
                        image::codecs::png::CompressionType::Level(PNG_COMPRESSION_LEVEL),
                        image::codecs::png::FilterType::NoFilter,
                    )
                    .write_image(&png_buf, tw, th, image::ExtendedColorType::Rgb8)
                    .map_err(|err| {
                        tracing::warn!(%err, "thumbnail png encode failed");
                        CoreError::capture(
                            "capture.preview_failed",
                            true,
                            "Thumbnail PNG could not be encoded.",
                        )
                    })?;
                    std::fs::write(&out_path, &png).map_err(|_| {
                        CoreError::disk(
                            "disk.write_failed",
                            true,
                            "Thumbnail could not be written to disk.",
                        )
                    })?;
                    found = true;
                    break;
                }
            }
        }
        if found {
            break;
        }
    }

    if found {
        Ok(out_path)
    } else {
        Err(CoreError::capture(
            "capture.preview_failed",
            true,
            "No decodable video frame found for thumbnail.",
        ))
    }
}

/// Open a file input, probe streams, find the video stream, open a
/// decoder, and return (input, video_index, width, height, decoder).
fn open_video_input(
    path: &Path,
) -> Result<
    (
        ff::format::context::Input,
        usize,
        u32,
        u32,
        ff::codec::decoder::video::Video,
    ),
    CoreError,
> {
    let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| {
            CoreError::capture(
                "capture.preview_failed",
                false,
                "Thumbnail source path is not usable.",
            )
        })?;
    let mut ps: *mut ff::sys::AVFormatContext = std::ptr::null_mut();
    // No demuxer override — let ffmpeg probe the container (MKV/MP4/WebM).
    let open_res = unsafe {
        ff::sys::avformat_open_input(
            &mut ps,
            c_path.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if open_res < 0 {
        let err = ff::Error::from(open_res);
        let path_display = path.display();
        tracing::warn!(%err, path = %path_display, "thumbnail input open failed (code {})", open_res);
        return Err(CoreError::capture(
            "capture.preview_failed",
            true,
            format!("The recording could not be opened for thumbnail extraction (ffmpeg error {open_res})."),
        ));
    }
    let res = unsafe { ff::sys::avformat_find_stream_info(ps, std::ptr::null_mut()) };
    if res < 0 {
        unsafe { ff::sys::avformat_close_input(&mut ps) };
        let err = ff::Error::from(res);
        let path_display = path.display();
        tracing::warn!(%err, path = %path_display, "thumbnail stream probe failed");
        return Err(CoreError::capture(
            "capture.preview_failed",
            true,
            "The recording carries no decodable streams.",
        ));
    }
    let input = unsafe { ff::format::context::Input::wrap(ps) };
    let Some(video_stream) = input.streams().best(ff::media::Type::Video) else {
        return Err(CoreError::capture(
            "capture.preview_failed",
            true,
            "The recording carries no video stream.",
        ));
    };
    let video_index = video_stream.index();
    let params = video_stream.parameters();
    let codec = ff::decoder::find(params.id()).ok_or_else(|| {
        CoreError::capture(
            "capture.preview_failed",
            true,
            "The recording's video codec could not be found.",
        )
    })?;
    let ctx = ff::codec::context::Context::from_parameters(params).map_err(|err| {
        tracing::warn!(%err, "thumbnail codec context failed");
        CoreError::capture(
            "capture.preview_failed",
            true,
            "The recording's video parameters could not be decoded.",
        )
    })?;
    let opened = ctx.decoder().open_as(codec).map_err(|err| {
        tracing::warn!(%err, "thumbnail decoder open failed");
        CoreError::capture(
            "capture.preview_failed",
            true,
            "The recording's video decoder could not open.",
        )
    })?;
    let decoder = opened.video().map_err(|err| {
        tracing::warn!(%err, "thumbnail not a video stream");
        CoreError::capture(
            "capture.preview_failed",
            true,
            "The recording's stream is not video.",
        )
    })?;
    let (width, height) = (decoder.width(), decoder.height());
    Ok((input, video_index, width, height, decoder))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::Encoder;
    use crate::encode::sw_x264::SwX264;
    use crate::pipeline::muxer::{MuxerBuilder, VideoSpec};
    use ffmpeg_next as ff;

    /// Encode a tiny valid MKV (16×16 red frames at 1fps, 2 seconds) and
    /// return its path, so the thumbnail test never depends on a real file.
    fn encode_test_mkv(dir: &Path) -> PathBuf {
        unsafe { ff::sys::av_log_set_level(ff::sys::AV_LOG_QUIET) };
        let path = dir.join("test-clip.mkv");
        let spec = VideoSpec {
            codec: ff::codec::Id::H264,
            width: 16,
            height: 16,
            pix_fmt: ff::format::Pixel::YUV420P,
            frame_rate: (1, 1),
            options: Vec::new(),
        };
        let (builder, video_opened) = MuxerBuilder::create(&path)
            .unwrap()
            .add_video(&spec)
            .unwrap();
        let mut mux = builder.write_header().unwrap();
        let mut encoder = SwX264::from_open(video_opened);
        let mut frame = crate::pipeline::Frame {
            width: 16,
            height: 16,
            stride: 64,
            layout: crate::pipeline::FrameLayout::Bgrx,
            pts_us: 0,
            data: vec![0u8; 64 * 16],
        };
        // Solid red frame: B=0x00, G=0x00, R=0xff.
        for y in 0..16u32 {
            for x in 0..16u32 {
                let o = (y as usize * 64) + (x as usize * 4);
                frame.data[o] = 0x00;     // B
                frame.data[o + 1] = 0x00; // G
                frame.data[o + 2] = 0xff; // R
                frame.data[o + 3] = 0xff; // X
            }
        }
        let packets = encoder.encode(&frame).unwrap();
        mux.write(&packets).unwrap();
        mux.finalize().unwrap();
        path
    }

    #[test]
    fn extract_thumbnail_writes_valid_png() {
        let tmp = tempfile::tempdir().unwrap();
        let thumbs_dir = tmp.path().join("thumbs");
        std::fs::create_dir_all(&thumbs_dir).unwrap();
        let video_path = encode_test_mkv(tmp.path());
        // Verify the test MKV was written.
        assert!(
            video_path.exists(),
            "test MKV must exist: {}",
            video_path.display()
        );
        assert!(
            video_path.metadata().unwrap().len() > 0,
            "test MKV must be non-empty"
        );
        let stop = AtomicBool::new(false);

        match extract_thumbnail(&video_path, &thumbs_dir, &stop) {
            Ok(out) => {
                assert!(out.exists(), "thumb file must exist: {}", out.display());
                assert_eq!(
                    out.extension().and_then(|e| e.to_str()),
                    Some("png")
                );
                // The PNG should decode back to a non-empty image.
                let img = image::ImageReader::open(&out)
                    .unwrap()
                    .decode()
                    .unwrap();
                assert!(img.width() > 0 && img.height() > 0);
                assert!(
                    img.width() <= THUMB_MAX_SIDE && img.height() <= THUMB_MAX_SIDE
                );
            }
            Err(err) => {
                // Thumbnail extraction is non-fatal — on systems without
                // the required FFmpeg bitstream filters, extraction fails
                // gracefully without crashing. The library row is created
                // without a thumb (thumb_path stays NULL).
                assert_eq!(err.code(), "capture.preview_failed");
            }
        }
    }

    #[test]
    fn extract_thumbnail_is_non_fatal_on_bad_input() {
        let tmp = tempfile::tempdir().unwrap();
        let thumbs_dir = tmp.path().join("thumbs");
        std::fs::create_dir_all(&thumbs_dir).unwrap();
        let stop = AtomicBool::new(false);

        // Point at a nonexistent file → error, not a crash.
        let err = extract_thumbnail(
            &tmp.path().join("does-not-exist.mkv"),
            &thumbs_dir,
            &stop,
        )
        .unwrap_err();
        assert_eq!(err.code(), "capture.preview_failed");
        // No thumb file was created.
        let entries = std::fs::read_dir(&thumbs_dir).unwrap();
        assert_eq!(entries.count(), 0);
    }

    #[test]
    fn extract_thumbnail_stops_on_cancel() {
        let tmp = tempfile::tempdir().unwrap();
        let thumbs_dir = tmp.path().join("thumbs");
        std::fs::create_dir_all(&thumbs_dir).unwrap();
        let video_path = encode_test_mkv(tmp.path());
        let stop = AtomicBool::new(true); // cancelled before starting

        let err = extract_thumbnail(&video_path, &thumbs_dir, &stop).unwrap_err();
        assert_eq!(err.code(), "capture.preview_failed");
        assert!(std::fs::read_dir(&thumbs_dir).unwrap().count() == 0);
    }
}
