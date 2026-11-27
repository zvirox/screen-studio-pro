//! Phase 13.1 — decoupled canvas vs output scaler. The canvas (capture +
//! composite) renders at the source resolution; a distinct output stage
//! scales it to the encode resolution. The algorithm matters: a high-quality
//! Lanczos for downscale (the common 1440p→1080p case) keeps detail, while
//! upscale / same-size uses Bicubic. Pure decision; the encoder maps it to
//! the swscale `Flags`.

/// The output scaling algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScalerAlgo {
    Lanczos,
    Bicubic,
    Bilinear,
}

/// Choose the scaler for a source→destination size. Downscale (the quality-
/// critical case) uses Lanczos; otherwise Bicubic.
pub fn choose(src: (u32, u32), dst: (u32, u32)) -> ScalerAlgo {
    let downscale = dst.0 < src.0 || dst.1 < src.1;
    if downscale {
        ScalerAlgo::Lanczos
    } else {
        ScalerAlgo::Bicubic
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscale_uses_lanczos() {
        assert_eq!(choose((2560, 1440), (1920, 1080)), ScalerAlgo::Lanczos);
        assert_eq!(choose((1920, 1080), (1280, 720)), ScalerAlgo::Lanczos);
    }

    #[test]
    fn same_or_upscale_uses_bicubic() {
        assert_eq!(choose((1920, 1080), (1920, 1080)), ScalerAlgo::Bicubic);
        assert_eq!(choose((1280, 720), (1920, 1080)), ScalerAlgo::Bicubic);
    }
}
