//! Phase 13.3 — dual 16:9 + 9:16 output. From one canvas, derive the two
//! output geometries: the horizontal (16:9) take is the canvas, and the
//! vertical (9:16) take is a centre crop scaled to 9:16 at the canvas height.
//! Pure geometry (even-aligned, never zero); the second encoder + muxer that
//! consume these are the Phase 13.3 plumbing.

use crate::pipeline::Frame;

/// An output geometry (even-aligned dimensions).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Output {
    pub width: u32,
    pub height: u32,
}

/// The 16:9 (horizontal) output = the canvas, even-aligned.
pub fn horizontal(canvas: (u32, u32)) -> Output {
    Output {
        width: canvas.0 & !1,
        height: canvas.1 & !1,
    }
}

/// The 9:16 (vertical) output: full canvas height, width = height × 9/16,
/// even-aligned (a centre crop of the canvas, scaled by the encoder).
pub fn vertical(canvas: (u32, u32)) -> Output {
    let height = canvas.1 & !1;
    let width = ((height as u64 * 9) / 16) as u32 & !1;
    Output {
        width: width.max(2),
        height,
    }
}

/// Centre-crop a horizontal frame to 9:16 at full height (the vertical
/// encoder's input). Pure CPU crop; the GPU scale to the output res is the
/// encoder's swscale (Lanczos). The source `dmabuf` is dropped (the crop is
/// a new CPU frame).
pub fn crop_vertical(frame: &Frame) -> Frame {
    let target_w = (((frame.height as u64 * 9) / 16) as u32 & !1)
        .max(2)
        .min(frame.width);
    let x = (frame.width - target_w) / 2;
    let bpp = frame.layout.bpp();
    let row_bytes = target_w as usize * bpp;
    let src_stride = frame.stride as usize;
    let mut data = Vec::with_capacity(row_bytes * frame.height as usize);
    for row in 0..frame.height as usize {
        let start = x as usize * bpp + row * src_stride;
        data.extend_from_slice(&frame.data[start..start + row_bytes]);
    }
    Frame {
        width: target_w,
        height: frame.height,
        stride: row_bytes as u32,
        layout: frame.layout,
        pts_us: frame.pts_us,
        data,
        dmabuf: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::FrameLayout;

    #[test]
    fn crop_vertical_is_nine_by_sixteen_at_full_height() {
        let src = frame(1920, 1080);
        let v = crop_vertical(&src);
        assert_eq!(v.width, 606);
        assert_eq!(v.height, 1080);
        assert_eq!(v.stride, 606 * 4);
        assert_eq!(v.data.len(), (606 * 4 * 1080) as usize);
    }

    fn frame(w: u32, h: u32) -> Frame {
        let stride = w * 4;
        Frame {
            width: w,
            height: h,
            stride,
            layout: FrameLayout::Bgrx,
            pts_us: 0,
            data: vec![0u8; (stride * h) as usize],
            dmabuf: None,
        }
    }

    #[test]
    fn horizontal_is_the_even_canvas() {
        assert_eq!(
            horizontal((1920, 1080)),
            Output {
                width: 1920,
                height: 1080
            }
        );
        assert_eq!(
            horizontal((1919, 1079)),
            Output {
                width: 1918,
                height: 1078
            }
        );
    }

    #[test]
    fn vertical_is_nine_by_sixteen_at_canvas_height() {
        // 1080 height -> 607.5 -> 606 (even) width.
        assert_eq!(
            vertical((1920, 1080)),
            Output {
                width: 606,
                height: 1080
            }
        );
        // 720 height -> 405 -> 404 (even).
        assert_eq!(
            vertical((1280, 720)),
            Output {
                width: 404,
                height: 720
            }
        );
    }

    #[test]
    fn vertical_never_zero() {
        let o = vertical((16, 16));
        assert!(o.width >= 2 && o.height >= 2);
    }
}
