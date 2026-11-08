use super::{Encoder, EncoderInfo};
use crate::util::error::CoreError;

/* VAAPI hardware encoder (PLAN 3.3) — Intel/AMD GPUs on Linux.

This is a stub implementation for the MVP. The VAAPI encoder requires
proper DRM device context creation and hardware frame management
which needs more ffmpeg_next API integration. For now, it returns
"unavailable" so the encoder selection chain falls back to x264.

Full VAAPI implementation will be completed in a follow-up task.
*/

#[allow(dead_code)]
pub struct VaapiEncoder;

#[allow(dead_code)]
impl VaapiEncoder {
    /// Creates a new VAAPI encoder instance. Currently returns unavailable
    /// as the full VAAPI hardware frame management is not yet implemented.
    pub fn from_open(
        _device_path: &str,
        _dims: (u32, u32),
        _opts: &[(String, String)],
    ) -> Result<Self, CoreError> {
        Err(CoreError::encoder(
            "encoder.unavailable",
            false,
            "VAAPI hardware encoder not yet implemented. Falling back to x264.",
        ))
    }
}

impl Encoder for VaapiEncoder {
    fn info(&self) -> EncoderInfo {
        EncoderInfo {
            backend: "vaapi",
            is_hardware: true,
        }
    }

    fn encode(
        &mut self,
        _frame: &crate::pipeline::Frame,
    ) -> Result<Vec<super::EncodedPacket>, CoreError> {
        unreachable!("VaapiEncoder::from_open always returns an error")
    }

    fn finish(&mut self) -> Result<Vec<super::EncodedPacket>, CoreError> {
        unreachable!("VaapiEncoder::from_open always returns an error")
    }
}
