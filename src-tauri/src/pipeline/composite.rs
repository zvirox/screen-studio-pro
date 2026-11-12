use crate::pipeline::{Frame, FrameLayout};
use crate::util::error::CoreError;

/// Apply a region crop to a frame. Returns a new frame with the cropped
/// data, or the original frame if no region is set.
pub fn apply_region_crop(
    frame: Frame,
    region: Option<crate::capture::RegionRect>,
) -> Result<Frame, CoreError> {
    let Some(region) = region else {
        return Ok(frame);
    };

    // Validate the region against the frame dimensions.
    if region.x + region.w > frame.width || region.y + region.h > frame.height {
        return Err(CoreError::capture(
            "capture.region_invalid",
            false,
            "Region rect exceeds frame bounds.",
        ));
    }

    let bpp = frame.layout.bpp();
    let src_stride = frame.stride as usize;
    let dst_stride = region.w as usize * bpp;

    // Allocate new data for the cropped frame.
    let mut dst_data = vec![0u8; dst_stride * region.h as usize];

    // Copy each row from the source to the destination.
    for row in 0..region.h as usize {
        let src_y = (region.y as usize + row) * src_stride + region.x as usize * bpp;
        let dst_y = row * dst_stride;
        let src_row = &frame.data[src_y..src_y + dst_stride];
        dst_data[dst_y..dst_y + dst_stride].copy_from_slice(src_row);
    }

    Ok(Frame {
        width: region.w,
        height: region.h,
        stride: dst_stride as u32,
        layout: frame.layout,
        pts_us: frame.pts_us,
        data: dst_data,
    })
}

/// Composite a camera still onto a source frame at position (x, y).
///
/// The camera frame (BGRA or BGRx) is downscaled nearest-neighbor to
/// `pip_w` × `pip_h` (16:9 box), masked by `shape`, and alpha-blended
/// onto `source` using the camera pixel's alpha channel. Pixels outside
/// the shape mask leave the source untouched.
///
/// Position (x, y) is computed by the caller using the corner+margin
/// model (`pip.position` wire shape, API §2.6): e.g. bottom-right means
/// `x = source.width - pip_w - margin`, `y = source.height - pip_h -
/// margin`, each clamped to ≥ 0.
///
/// Camera frames arrive at ≤8 fps (mailbox gate); callers reuse the
/// last composited still across video frames.
pub fn overlay_camera(
    source: &mut Frame,
    camera: &Frame,
    x: u32,
    y: u32,
    pip_w: u32,
    pip_h: u32,
    shape: PipShape,
) -> Result<(), CoreError> {
    let cam_bpp = camera.layout.bpp();
    let src_bpp = source.layout.bpp();

    // Clamp overlay to source bounds — a partial overlay at an edge is
    // still drawn (the corner-snap guides keep it inside, but defensive).
    let start_x = x.min(source.width);
    let start_y = y.min(source.height);
    let end_x = (x + pip_w).min(source.width);
    let end_y = (y + pip_h).min(source.height);

    if start_x >= end_x || start_y >= end_y {
        return Ok(()); // completely off-screen
    }

    let cam_stride = camera.stride as usize;
    let cam_data = &camera.data;
    let src_stride = source.stride as usize;
    let src_data = &mut source.data;

    for oy in start_y..end_y {
        let pip_y = oy - y;
        // Nearest-neighbor row map into the camera frame.
        let cam_y = (pip_y * camera.height) / pip_h;
        if cam_y >= camera.height {
            continue;
        }

        for ox in start_x..end_x {
            let pip_x = ox - x;
            let cam_x = (pip_x * camera.width) / pip_w;
            if cam_x >= camera.width {
                continue;
            }

            // Shape mask: pixels outside the shape leave the source alone.
            if !shape_mask_contains(pip_x, pip_y, pip_w, pip_h, shape) {
                continue;
            }

            // Read camera pixel.
            let cam_offset = cam_y as usize * cam_stride + cam_x as usize * cam_bpp;
            let cam_b = cam_data[cam_offset];
            let cam_g = cam_data[cam_offset + 1];
            let cam_r = cam_data[cam_offset + 2];
            let cam_a = if cam_bpp == 4 {
                match camera.layout {
                    FrameLayout::Bgra => cam_data[cam_offset + 3],
                    FrameLayout::Bgrx => 255,
                }
            } else {
                255
            };

            // Read source pixel.
            let src_offset = oy as usize * src_stride + ox as usize * src_bpp;
            let src_b = src_data[src_offset];
            let src_g = src_data[src_offset + 1];
            let src_r = src_data[src_offset + 2];

            // Alpha blend: result = src * (255 - a) / 255 + cam * a / 255.
            let inv_a = 255u32 - cam_a as u32;
            src_data[src_offset] =
                ((src_b as u32 * inv_a + cam_b as u32 * cam_a as u32) / 255) as u8;
            src_data[src_offset + 1] =
                ((src_g as u32 * inv_a + cam_g as u32 * cam_a as u32) / 255) as u8;
            src_data[src_offset + 2] =
                ((src_r as u32 * inv_a + cam_r as u32 * cam_a as u32) / 255) as u8;
        }
    }

    Ok(())
}

/// Shape mask for the PiP frame (§6.6: `r.full` circle / `r.lg` rounded).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipShape {
    /// Circle inscribed in the pip box (the PRD M5 signature).
    Circle,
    /// Rounded rectangle with `r.lg` (20px) corner radius.
    Rounded,
}

/// Whether pixel (px, py) lies inside the shape mask of a pip_w × pip_h box.
fn shape_mask_contains(px: u32, py: u32, pip_w: u32, pip_h: u32, shape: PipShape) -> bool {
    match shape {
        PipShape::Circle => {
            let cx = pip_w as i64 / 2;
            let cy = pip_h as i64 / 2;
            let r = (pip_w.min(pip_h) as i64) / 2;
            let dx = px as i64 - cx;
            let dy = py as i64 - cy;
            dx * dx + dy * dy <= r * r
        }
        PipShape::Rounded => {
            let r = 20u32; // r.lg per DESIGN §4.2
            if px < r && py < r {
                // top-left corner: outside the quarter-circle → masked out.
                let dx = r as i64 - px as i64;
                let dy = r as i64 - py as i64;
                dx * dx + dy * dy <= r as i64 * r as i64
            } else if px >= pip_w - r && py < r {
                let dx = px as i64 - (pip_w - r) as i64;
                let dy = r as i64 - py as i64;
                dx * dx + dy * dy <= r as i64 * r as i64
            } else if px < r && py >= pip_h - r {
                let dx = r as i64 - px as i64;
                let dy = py as i64 - (pip_h - r) as i64;
                dx * dx + dy * dy <= r as i64 * r as i64
            } else if px >= pip_w - r && py >= pip_h - r {
                let dx = px as i64 - (pip_w - r) as i64;
                let dy = py as i64 - (pip_h - r) as i64;
                dx * dx + dy * dy <= r as i64 * r as i64
            } else {
                true // inside the main rect body
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::RegionRect;

    fn make_frame(w: u32, h: u32, fill: u8) -> Frame {
        let stride = w * 4;
        Frame {
            width: w,
            height: h,
            stride,
            layout: FrameLayout::Bgrx,
            pts_us: 0,
            data: vec![fill; (stride * h) as usize],
        }
    }

    fn make_bgra_frame(w: u32, h: u32, b: u8, g: u8, r: u8, a: u8) -> Frame {
        let stride = w * 4;
        let data: Vec<u8> = (0..(stride * h) as usize)
            .map(|i| match i % 4 {
                0 => b,
                1 => g,
                2 => r,
                _ => a,
            })
            .collect();
        Frame {
            width: w,
            height: h,
            stride,
            layout: FrameLayout::Bgra,
            pts_us: 0,
            data,
        }
    }

    #[test]
    fn no_region_returns_original() {
        let frame = make_frame(1920, 1080, 0x7f);
        let result = apply_region_crop(frame.clone(), None).unwrap();
        assert_eq!(result.width, 1920);
        assert_eq!(result.height, 1080);
        assert_eq!(result.data, frame.data);
    }

    #[test]
    fn crop_to_region() {
        let frame = make_frame(1920, 1080, 0x7f);
        let region = RegionRect {
            x: 100,
            y: 50,
            w: 640,
            h: 480,
        };
        let result = apply_region_crop(frame, Some(region)).unwrap();
        assert_eq!(result.width, 640);
        assert_eq!(result.height, 480);
        assert_eq!(result.stride, 640 * 4);
        assert_eq!(result.data.len(), 640 * 480 * 4);
        assert!(result.data.iter().all(|&b| b == 0x7f));
    }

    #[test]
    fn crop_rejects_out_of_bounds() {
        let frame = make_frame(1920, 1080, 0x7f);
        let region = RegionRect {
            x: 1500,
            y: 50,
            w: 640,
            h: 480,
        }; // x+w > 1920
        let result = apply_region_crop(frame, Some(region));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "capture.region_invalid");
    }

    #[test]
    fn overlay_camera_blends_onto_source() {
        let mut source = make_frame(640, 360, 0x00); // black source
        let camera = make_bgra_frame(640, 480, 0x00, 0x00, 0xff, 0xff); // red, opaque

        // Overlay a 120×67 pip at top-left (10, 10).
        overlay_camera(&mut source, &camera, 10, 10, 120, 67, PipShape::Circle).unwrap();

        // Source pixel outside the pip stays black.
        let offset = 20 * source.stride as usize + 5 * 4;
        assert_eq!(source.data[offset], 0x00);
        assert_eq!(source.data[offset + 1], 0x00);
        assert_eq!(source.data[offset + 2], 0x00);

        // Source pixel inside the pip circle becomes red (center of pip box
        // maps to source (10+60, 10+33) = (70, 43)).
        let offset = 43 * source.stride as usize + 70 * 4;
        assert_eq!(source.data[offset], 0x00);
        assert_eq!(source.data[offset + 1], 0x00);
        assert_eq!(source.data[offset + 2], 0xff);
    }

    #[test]
    fn overlay_camera_respects_shape_mask() {
        let mut source = make_frame(200, 200, 0x00);
        let camera = make_bgra_frame(200, 200, 0x00, 0x00, 0xff, 0xff); // red, opaque

        // Circle: a corner pixel of the pip box should stay black.
        overlay_camera(&mut source, &camera, 0, 0, 100, 56, PipShape::Circle).unwrap();
        let corner_offset = 5 * source.stride as usize + 5 * 4;
        assert_eq!(source.data[corner_offset + 2], 0x00); // outside circle

        // Rounded: same corner pixel should also stay black (r=20 mask).
        let mut source2 = make_frame(200, 200, 0x00);
        overlay_camera(&mut source2, &camera, 0, 0, 100, 56, PipShape::Rounded).unwrap();
        assert_eq!(source2.data[corner_offset + 2], 0x00);
    }

    #[test]
    fn overlay_camera_alpha_blends() {
        let mut source = make_frame(100, 100, 0x00); // black
        let camera = make_bgra_frame(100, 100, 0x00, 0x00, 0xff, 0x80); // red, 50% alpha

        overlay_camera(&mut source, &camera, 0, 0, 100, 56, PipShape::Circle).unwrap();

        // Center pixel: 50% red over black = ~128 red.
        let center_offset = 50 * source.stride as usize + 50 * 4;
        let red = source.data[center_offset + 2];
        assert!(red > 100 && red < 160, "expected ~128, got {red}");
    }

    #[test]
    fn overlay_camera_clamps_to_source_bounds() {
        let mut source = make_frame(100, 100, 0x00);
        let camera = make_bgra_frame(640, 480, 0xff, 0xff, 0xff, 0xff); // white, opaque

        // Overlay far beyond the source's bottom-right edge.
        overlay_camera(&mut source, &camera, 200, 200, 100, 56, PipShape::Circle).unwrap();

        // Source unchanged — nothing drawn.
        assert!(source.data.iter().all(|&b| b == 0x00));
    }
}
