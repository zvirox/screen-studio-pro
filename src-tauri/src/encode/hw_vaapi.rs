//! VAAPI H.264 encoder (PLAN 3.3 / pulled forward to 7.4) — Intel/AMD GPUs.
//!
//! ffmpeg-next has no safe hwdevice/hwframe wrappers, so the device create,
//! surface pool and upload live in the shared raw-FFI helper in `encode/mod.rs`.
//! This file owns the VAAPI-specific facts: the DRM render node probe and
//! the chip reported to the UI (DESIGN §6.1).

use super::hw::{Context, HwEncoder};
use super::{EncodedPacket, Encoder, EncoderInfo};
use crate::util::error::CoreError;
use ffmpeg_next as ff;

/// An opened VAAPI H.264 encoder, owned by one recording worker.
pub struct VaapiEncoder(HwEncoder);

impl VaapiEncoder {
    /// Find a usable DRM render node. Existence in /dev is not enough:
    /// the device context must INITIALIZE (PLAN 3.3), and this FFmpeg build
    /// must actually carry the `h264_vaapi` encoder.
    pub fn probe() -> Option<String> {
        super::ensure_init();
        ff::encoder::find_by_name("h264_vaapi")?;
        let mut nodes: Vec<String> = std::fs::read_dir("/dev/dri")
            .ok()?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("renderD"))
            })
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        nodes.sort(); // renderD128 before renderD129 — stable across boots
        nodes.into_iter().find(|node| {
            Context::create(
                super::HwKind::Vaapi,
                Some(node),
                (2, 2),
                ff::format::Pixel::NV12,
            )
            .is_ok()
        })
    }

    /// Wrap an ALREADY-OPENED `h264_vaapi` context plus its hw frames ctx.
    /// The muxer opens the codec with `pix_fmt=vaapi` and attaches the frames
    /// context BEFORE `avcodec_open2`; this constructor only takes ownership.
    pub fn from_open(
        video: ff::encoder::Video,
        hw: Context,
        dims: (u32, u32),
    ) -> Result<Self, CoreError> {
        let _ = dims; // the opened encoder's dims are the authority
        Ok(Self(HwEncoder::new(
            video,
            hw,
            EncoderInfo {
                backend: "vaapi",
                is_hardware: true,
            },
        )))
    }
}

impl Encoder for VaapiEncoder {
    fn info(&self) -> EncoderInfo {
        self.0.info()
    }

    fn encode(&mut self, frame: &crate::pipeline::Frame) -> Result<Vec<EncodedPacket>, CoreError> {
        self.0.encode(frame)
    }

    fn finish(&mut self) -> Result<Vec<EncodedPacket>, CoreError> {
        self.0.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vaapi_probe_is_honest_when_no_device_is_present() {
        match VaapiEncoder::probe() {
            Some(path) => {
                assert!(path.starts_with("/dev/dri/renderD"), "{path}");
                // A positive probe must be usable for a real frame context.
                let ctx = Context::create(
                    super::super::HwKind::Vaapi,
                    Some(&path),
                    (320, 240),
                    ff::format::Pixel::NV12,
                )
                .expect("probed node must create a frames context");
                assert_eq!(ctx.sw_format, ff::format::Pixel::NV12);
            }
            None => {
                // Honest skip: no VAAPI device, no claim. The test PASSES
                // (a machine without Intel/AMD hardware is not a defect).
                eprintln!("skip: no usable VAAPI render node on this host");
            }
        }
    }
}
