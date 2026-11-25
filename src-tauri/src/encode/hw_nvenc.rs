//! NVENC H.264 encoder (PLAN 3.3 / pulled forward to 7.4) — NVIDIA GPUs.
//!
//! The implementation mirrors the VAAPI path through the shared raw-FFI
//! helper (CUDA device + CUDA surfaces + upload). It COMPILES and is
//! probed, but this host has no NVIDIA GPU: NVENC performance is NOT
//! qualified here and the gate register keeps that item open (PLAN 7.4).

use super::hw::{Context, HwEncoder};
use super::{EncodedPacket, Encoder, EncoderInfo};
use crate::util::error::CoreError;
use ffmpeg_next as ff;

/// An opened NVENC H.264 encoder, owned by one recording worker.
pub struct NvencEncoder(HwEncoder);

impl NvencEncoder {
    /// A real probe: the encoder must exist AND a CUDA device context must
    /// initialize. FFmpeg compiled with `--enable-nvenc` is not evidence
    /// of usable hardware (the exact trap PLAN 7.4's gate calls out).
    pub fn probe() -> bool {
        super::ensure_init();
        if ff::encoder::find_by_name("h264_nvenc").is_none() {
            return false;
        }
        Context::create(super::HwKind::Cuda, None, (2, 2), ff::format::Pixel::NV12).is_ok()
    }

    /// Wrap an ALREADY-OPENED `h264_nvenc` context plus its CUDA frames ctx.
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
                backend: "nvenc",
                is_hardware: true,
            },
        )))
    }
}

impl Encoder for NvencEncoder {
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
    fn nvenc_probe_is_honest_without_nvidia_hardware() {
        // On this host the probe MUST be false: FFmpeg has h264_nvenc but
        // no CUDA device. A machine WITH a GPU may legitimately return true.
        let available = NvencEncoder::probe();
        if available {
            eprintln!("NVENC device present on this host — qualification still pending");
        }
        assert_eq!(available, super::super::nvenc_available());
    }
}
