use crate::pipeline::Frame;
use crate::util::error::CoreError;
use image::ImageEncoder;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/* Preview stills — ARCHITECTURE §6: the webview receives encoded stills
at 1–8fps, never video frames. This module is the drop-oldest tier of the
§6 backpressure law (pipeline/mod.rs header): a latest-wins mailbox fed
by the PipeWire callback at ≤8fps, plus the on-demand JPEG encode that
serves `cmd://source_preview` (API §2.1). The encode-tier bus is never
touched here — preview work cannot compete with recording. */

/// API §2.1/§4: the documented stills cadence ceiling.
pub const MAX_FPS: u32 = 8;
/// API §2.1: longest side of the served still (aspect preserved).
pub const MAX_SIDE: u32 = 640;
const FEED_INTERVAL_MS: u64 = 1000 / MAX_FPS as u64;
/// JPEG quality for preview stills — small payloads over pixel fidelity.
const JPEG_QUALITY: u8 = 75;

/// Wall-clock milliseconds — the `capturedAtMs` stamp the webview uses
/// to discard stale replies (API §2.1).
pub fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Latest-wins frame mailbox. One producer (the PipeWire data thread,
/// gated to ≤8fps) and any number of command-side readers. A Mutex is
/// fine here — the mutex-less law protects the ENCODE handoff only;
/// this tier is drop-oldest by design (§6 precedence).
pub struct PreviewMailbox {
    slot: Mutex<Option<(Frame, u64)>>,
    /// Producer-only gate stamp; MAX = never fed.
    last_feed_ms: AtomicU64,
}

impl Default for PreviewMailbox {
    fn default() -> Self {
        Self::new()
    }
}

impl PreviewMailbox {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(None),
            last_feed_ms: AtomicU64::new(u64::MAX),
        }
    }

    /// Producer side: true when a frame may be copied into the mailbox
    /// (never fed, or ≥125ms since the last accepted offer). Checked
    /// BEFORE the pixel copy so the 60fps callback stays cheap.
    pub fn is_due(&self, now_ms: u64) -> bool {
        let last = self.last_feed_ms.load(Ordering::Relaxed);
        last == u64::MAX || now_ms.saturating_sub(last) >= FEED_INTERVAL_MS
    }

    /// Producer side: store the newest frame, dropping whatever was
    /// there (drop-oldest tier). `captured_at_ms` doubles as gate stamp.
    pub fn offer(&self, frame: Frame, captured_at_ms: u64) {
        *self.slot.lock().unwrap_or_else(|p| p.into_inner()) = Some((frame, captured_at_ms));
        self.last_feed_ms.store(captured_at_ms, Ordering::Relaxed);
    }

    /// Reader side: clone of the newest frame + its capture stamp, or
    /// None before the first offer.
    pub fn latest(&self) -> Option<(Frame, u64)> {
        self.slot.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

/// One encoded preview still (API §2.1 reply minus the base64 wrapper).
#[derive(Debug)]
pub struct PreviewStill {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Downscale a raw capture frame to ≤640px longest side (never upscale)
/// and JPEG-encode it. Runs on the command side, never on the PipeWire
/// data thread. BGRx/BGRA → RGB with stride-aware nearest sampling.
pub fn encode_still(frame: &Frame) -> Result<PreviewStill, CoreError> {
    let failed = || {
        CoreError::capture(
            "capture.preview_failed",
            true,
            "The preview still could not be generated. Try again in a moment.",
        )
    };
    let (w, h) = (frame.width, frame.height);
    if w == 0 || h == 0 {
        return Err(failed());
    }
    let need = (frame.stride as usize)
        .checked_mul(h as usize)
        .ok_or_else(failed)?;
    if frame.data.len() < need {
        return Err(failed());
    }
    let scale = (MAX_SIDE as f64 / w.max(h) as f64).min(1.0);
    let tw = ((w as f64 * scale).round() as u32).max(1);
    let th = ((h as f64 * scale).round() as u32).max(1);
    let mut rgb = vec![0u8; tw as usize * th as usize * 3];
    for y in 0..th {
        let sy = (y as u64 * h as u64 / th as u64) as usize;
        for x in 0..tw {
            let sx = (x as u64 * w as u64 / tw as u64) as usize;
            let o = sy * frame.stride as usize + sx * 4;
            let d = (y * tw + x) as usize * 3;
            rgb[d] = frame.data[o + 2];
            rgb[d + 1] = frame.data[o + 1];
            rgb[d + 2] = frame.data[o];
        }
    }
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .write_image(&rgb, tw, th, image::ExtendedColorType::Rgb8)
        .map_err(|err| {
            tracing::warn!(%err, "preview still encode failed");
            failed()
        })?;
    Ok(PreviewStill {
        jpeg,
        width: tw,
        height: th,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::FrameLayout;

    /// Solid-colour BGRx frame with optional row padding.
    fn solid(width: u32, height: u32, pad: u32, bgr: [u8; 3]) -> Frame {
        let stride = width * 4 + pad;
        let mut data = vec![0u8; stride as usize * height as usize];
        for y in 0..height as usize {
            for x in 0..width as usize {
                let o = y * stride as usize + x * 4;
                data[o] = bgr[0];
                data[o + 1] = bgr[1];
                data[o + 2] = bgr[2];
            }
        }
        Frame {
            width,
            height,
            stride,
            layout: FrameLayout::Bgrx,
            pts_us: 0,
            data,
        }
    }

    #[test]
    fn mailbox_is_empty_before_the_first_offer() {
        let mb = PreviewMailbox::new();
        assert!(mb.latest().is_none());
    }

    #[test]
    fn mailbox_is_latest_wins() {
        let mb = PreviewMailbox::new();
        mb.offer(solid(4, 4, 0, [0, 0, 0]), 100);
        mb.offer(solid(4, 4, 0, [255, 255, 255]), 200);
        let (frame, stamp) = mb.latest().expect("a still is stored");
        assert_eq!(stamp, 200, "the newest offer replaced the oldest");
        assert_eq!(frame.data[0], 255);
        // Reading does not consume — the next poll sees the same still.
        assert_eq!(mb.latest().expect("still there").1, 200);
    }

    #[test]
    fn feed_gate_caps_offers_at_8fps() {
        let mb = PreviewMailbox::new();
        assert!(mb.is_due(0), "never-fed mailbox accepts immediately");
        mb.offer(solid(4, 4, 0, [0, 0, 0]), 1000);
        assert!(!mb.is_due(1124), "124ms after the feed is too soon");
        assert!(mb.is_due(1125), "125ms = the 8fps interval is due");
        mb.offer(solid(4, 4, 0, [0, 0, 0]), 1125);
        assert!(!mb.is_due(1249));
        assert!(mb.is_due(1250));
    }

    #[test]
    fn still_caps_the_longest_side_at_640_preserving_aspect() {
        let still = encode_still(&solid(1920, 1080, 0, [0, 0, 0])).expect("encodes");
        assert_eq!((still.width, still.height), (640, 360));
        let decoded = image::load_from_memory(&still.jpeg).expect("valid JPEG");
        assert_eq!((decoded.width(), decoded.height()), (640, 360));
    }

    #[test]
    fn still_rounds_odd_aspect_dimensions() {
        // The measured KWin odd geometry (docs/portal-support.md).
        let still = encode_still(&solid(1919, 1079, 0, [0, 0, 0])).expect("encodes");
        assert_eq!(still.width, 640);
        assert_eq!(still.height, 360); // 1079/1919 × 640 = 359.8 → 360
    }

    #[test]
    fn still_never_upscales_small_sources() {
        let still = encode_still(&solid(320, 240, 0, [0, 0, 0])).expect("encodes");
        assert_eq!((still.width, still.height), (320, 240));
    }

    #[test]
    fn still_respects_padded_stride_and_bgr_order() {
        // Pure red in BGRx = [B=0, G=0, R=255]; 7 bytes of row padding
        // must not shift the sampling (Frame stride law).
        let frame = solid(64, 48, 7, [0, 0, 255]);
        let still = encode_still(&frame).expect("encodes");
        let decoded = image::load_from_memory(&still.jpeg)
            .expect("valid JPEG")
            .to_rgb8();
        let px = decoded.get_pixel(32, 24).0;
        assert!(
            px[0] > 240 && px[1] < 15 && px[2] < 15,
            "expected red, got {px:?}"
        );
    }

    #[test]
    fn still_rejects_short_pixel_data() {
        let mut frame = solid(64, 48, 0, [0, 0, 0]);
        frame.data.truncate(100);
        let err = encode_still(&frame).expect_err("short data must fail typed");
        assert_eq!(err.code(), "capture.preview_failed");
        assert!(err.retryable());
    }
}
