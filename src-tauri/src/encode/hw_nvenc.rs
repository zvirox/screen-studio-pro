use super::{EncodedPacket, Encoder, EncoderInfo};
use crate::util::error::CoreError;

/* NVENC hardware encoder (PLAN 3.3) — NVIDIA GPUs.

This is a stub implementation for the MVP. The NVENC encoder requires
CUDA context and proper hardware frame management which needs more
ffmpeg_next API integration. For now, it returns "unavailable" so
the encoder selection chain falls back to x264.

Full NVENC implementation will be completed in a follow-up task.
*/

pub struct NvencEncoder;

impl NvencEncoder {
    /// Creates a new NVENC encoder instance. Currently returns unavailable
    /// as the full NVENC hardware frame management is not yet implemented.
    pub fn from_open(_dims: (u32, u32), _opts: &[(String, String)]) -> Result<Self, CoreError> {
        Err(CoreError::encoder(
            "encoder.unavailable",
            false,
            "NVENC hardware encoder not yet implemented. Falling back to x264.",
        ))
    }
}

impl Encoder for NvencEncoder {
    fn info(&self) -> EncoderInfo {
        EncoderInfo {
            backend: "nvenc",
            is_hardware: true,
        }
    }

    fn encode(&mut self, _frame: &crate::pipeline::Frame) -> Result<Vec<super::EncodedPacket>, CoreError> {
        unreachable!("NvencEncoder::from_open always returns an error")
    }

    fn finish(&mut self) -> Result<Vec<super::EncodedPacket>, CoreError> {
        unreachable!("NvencEncoder::from_open always returns an error")
    }
}