use crate::pipeline::Frame;
use crate::util::error::CoreError;

#[cfg(test)]
use crate::pipeline::FrameLayout;

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
        // All pixels should be the fill value.
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
}
