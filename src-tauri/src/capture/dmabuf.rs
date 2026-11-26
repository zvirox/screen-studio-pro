//! DMA-BUF ingestion (PLAN 10.1) — bring a PipeWire DMA-BUF onto the GPU
//! with **no host readback**, plus a CPU-map fallback for drivers that
//! forbid host mapping.
//!
//! Scope of 10.1 is the *ingestion primitive*: negotiate a DMA-BUF format,
//! own the buffer's fds, and import them as an EGLImage. Feeding that image
//! straight into the encoder (`PASS_TEXTURE`, no upload) is Phase 10.2; until
//! then the encode bus is fed from the CPU map exactly as the MemFd path does,
//! so behaviour is unchanged and non-regressing. The whole module is behind
//! the `encode` feature (EGL/memmap are optional deps).
//!
//! Every fallible step returns a typed [`CoreError`] or `None` — nothing here
//! panics, and a failed import degrades to the CPU map, never to a lost frame.

use crate::pipeline::{Frame, FrameLayout};
use crate::util::error::CoreError;
use drm_fourcc::DrmFourcc;
use std::os::fd::RawFd;
use std::sync::OnceLock;

/* EGL extension constants (core EGL 1.0–1.5 only is covered by khronos-egl;
the DMA-BUF import path is EXT). Values are the Khronos-registered enums. */
const EGL_PLATFORM_SURFACELESS_MESA: khronos_egl::Attrib = 0x31DD;
const EGL_LINUX_DMA_BUF_EXT: khronos_egl::Attrib = 0x3270;
const EGL_LINUX_DRM_FOURCC_EXT: khronos_egl::Attrib = 0x3271;
const EGL_DMA_BUF_PLANE0_FD_EXT: khronos_egl::Attrib = 0x3272;
const EGL_DMA_BUF_PLANE0_OFFSET_EXT: khronos_egl::Attrib = 0x3273;
const EGL_DMA_BUF_PLANE0_PITCH_EXT: khronos_egl::Attrib = 0x3274;
const EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT: khronos_egl::Attrib = 0x3275;
const EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT: khronos_egl::Attrib = 0x3276;
const EGL_WIDTH: khronos_egl::Attrib = 0x3057;
const EGL_HEIGHT: khronos_egl::Attrib = 0x3056;

/// The DRM fourcc for a negotiated packed layout (BGRx → XBGR8888,
/// BGRA → ABGR8888 — the 32-bpp formats the portal offers).
fn fourcc_for(layout: FrameLayout) -> u32 {
    match layout {
        FrameLayout::Bgrx => DrmFourcc::Xbgr8888 as u32,
        FrameLayout::Bgra => DrmFourcc::Abgr8888 as u32,
    }
}

/// Opt-in switch. Default OFF so the working MemFd negotiation is untouched;
/// Phase 10.2 flips the default once `PASS_TEXTURE` lands. `SSP_DMA_BUF=1`
/// turns on DMA-BUF negotiation + import for this run.
pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("SSP_DMA_BUF").is_ok_and(|v| v == "1"))
}

/// One plane of a DMA-BUF-backed frame. `fd` is BORROWED from the PipeWire
/// buffer and is only valid while the frame lives (one `process` callback) —
/// the frame never outlives it, so ownership/close stays with PipeWire.
pub struct DmaBufPlane {
    fd: RawFd,
    fourcc: u32,
    modifier: u64,
    stride: u32,
    offset: u32,
    height: u32,
    mapped: Option<memmap2::Mmap>,
}

impl DmaBufPlane {
    fn byte_len(&self) -> usize {
        self.stride as usize * self.height as usize
    }

    /// CPU fallback: read-only map of the plane. Fails (typed) on a driver
    /// that forbids host mapping — the caller then drops the frame.
    fn map(&mut self) -> Result<&[u8], CoreError> {
        if self.mapped.is_none() {
            let mmap = unsafe {
                memmap2::MmapOptions::new()
                    .offset(self.offset as u64)
                    .len(self.byte_len())
                    .map(self.fd)
            }
            .map_err(|err| {
                CoreError::capture(
                    "capture.dmabuf_map_failed",
                    false,
                    "The capture buffer could not be read.",
                )
                .with_details(serde_json::json!({ "cause": err.to_string() }))
            })?;
            self.mapped = Some(mmap);
        }
        Ok(self.mapped.as_deref().expect("mapped just above"))
    }
}

/// A GPU image imported from a DMA-BUF, kept alive for Phase 10.2 to consume.
/// Destroying it releases the EGL image; the display/instance drop after.
struct GpuImage {
    instance: khronos_egl::DynamicInstance<khronos_egl::EGL1_5>,
    display: khronos_egl::Display,
    image: Option<khronos_egl::Image>,
}

impl Drop for GpuImage {
    fn drop(&mut self) {
        if let Some(image) = self.image.take() {
            let _ = self.instance.destroy_image(self.display, image);
        }
    }
}

/// A DMA-BUF-backed capture frame: the planes we own plus the GPU handle.
pub struct DmaBufFrame {
    pub width: u32,
    pub height: u32,
    pub layout: FrameLayout,
    planes: Vec<DmaBufPlane>,
    gpu: Option<GpuImage>,
    dmabuf: Option<std::sync::Arc<crate::pipeline::DmaBufRef>>,
}

impl DmaBufFrame {
    /// Import plane 0 as an EGLImage (zero host readback). Best-effort: a
    /// failure leaves `gpu = None` and the CPU map still works.
    fn import_gpu(&mut self) {
        let plane = &self.planes[0];
        let attribs: Vec<khronos_egl::Attrib> = vec![
            EGL_WIDTH,
            self.width as usize,
            EGL_HEIGHT,
            self.height as usize,
            EGL_LINUX_DRM_FOURCC_EXT,
            plane.fourcc as usize,
            EGL_DMA_BUF_PLANE0_FD_EXT,
            plane.fd as usize,
            EGL_DMA_BUF_PLANE0_OFFSET_EXT,
            plane.offset as usize,
            EGL_DMA_BUF_PLANE0_PITCH_EXT,
            plane.stride as usize,
            EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT,
            (plane.modifier & 0xFFFF_FFFF) as usize,
            EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT,
            (plane.modifier >> 32) as usize,
            khronos_egl::ATTRIB_NONE,
        ];

        let imported =
            (|| -> Result<GpuImage, CoreError> {
                let instance = unsafe {
                khronos_egl::DynamicInstance::<khronos_egl::EGL1_5>::load_required_from_filename(
                    "libEGL.so.1",
                )
            }
            .map_err(|err| {
                CoreError::capture("capture.egl_load_failed", false, "GPU capture is unavailable.")
                    .with_details(serde_json::json!({ "cause": err.to_string() }))
            })?;
                let display = unsafe {
                    instance.get_platform_display(
                        EGL_PLATFORM_SURFACELESS_MESA as u32,
                        std::ptr::null_mut(),
                        &[khronos_egl::ATTRIB_NONE],
                    )
                }
                .map_err(|err| {
                    CoreError::capture(
                        "capture.egl_display_failed",
                        false,
                        "GPU capture is unavailable.",
                    )
                    .with_details(serde_json::json!({ "cause": err.to_string() }))
                })?;
                instance.initialize(display).map_err(|err| {
                    CoreError::capture(
                        "capture.egl_init_failed",
                        false,
                        "GPU capture is unavailable.",
                    )
                    .with_details(serde_json::json!({ "cause": err.to_string() }))
                })?;
                let image = instance
                    .create_image(
                        display,
                        unsafe { khronos_egl::Context::from_ptr(std::ptr::null_mut()) },
                        EGL_LINUX_DMA_BUF_EXT as u32,
                        unsafe { khronos_egl::ClientBuffer::from_ptr(std::ptr::null_mut()) },
                        &attribs,
                    )
                    .map_err(|err| {
                        CoreError::capture(
                            "capture.egl_import_failed",
                            false,
                            "GPU capture is unavailable.",
                        )
                        .with_details(serde_json::json!({ "cause": err.to_string() }))
                    })?;
                Ok(GpuImage {
                    instance,
                    display,
                    image: Some(image),
                })
            })();

        match imported {
            Ok(gpu) => self.gpu = Some(gpu),
            Err(err) => {
                tracing::debug!(error = %err, "DMA-BUF EGL import failed; using CPU map");
            }
        }
    }

    /// CPU-map plane 0 and copy it into a pipeline [`Frame`] (the encode-bus
    /// fallback used until Phase 10.2 consumes the GPU image directly). The
    /// frame keeps the DMA row pitch so the encoder skips padding correctly.
    fn into_frame(mut self, pts_us: u64) -> Option<Frame> {
        let stride = self.planes.first()?.stride as usize;
        let need = stride.checked_mul(self.height as usize)?;
        let plane = self.planes.first_mut()?;
        let mapped = plane.map().ok()?;
        if mapped.len() < need {
            return None;
        }
        Some(Frame {
            width: self.width,
            height: self.height,
            stride: stride as u32,
            layout: self.layout,
            pts_us,
            data: mapped[..need].to_vec(),
            dmabuf: self.dmabuf.take(),
        })
    }
}

/// Build a DMA-BUF frame from a PipeWire buffer's plane-0 fd, import it to the
/// GPU (best-effort) and return the CPU-mapped [`Frame`] for the encode bus.
/// `None` on any failure so the caller falls back to the MemFd path.
pub fn try_build_frame(
    fd: std::os::fd::RawFd,
    stride: u32,
    width: u32,
    height: u32,
    layout: FrameLayout,
    pts_us: u64,
) -> Option<Frame> {
    // Own a dup of the fd so the DMA-BUF stays valid across the capture→worker
    // hand-off (the encoder imports it zero-copy in 10.2). The plane maps via
    // the same fd; the `Arc` keeps it alive until the worker drops the frame.
    let owned = unsafe { std::os::fd::BorrowedFd::borrow_raw(fd) }
        .try_clone_to_owned()
        .ok()?;
    let dmabuf = std::sync::Arc::new(crate::pipeline::DmaBufRef {
        fourcc: fourcc_for(layout),
        modifier: 0,
        stride,
        width,
        height,
        fd: owned,
    });
    let plane = DmaBufPlane {
        fd,
        fourcc: fourcc_for(layout),
        modifier: 0, // implicit modifier (the portal's DMA-BUF default)
        stride,
        offset: 0,
        height,
        mapped: None,
    };
    let mut frame = DmaBufFrame {
        width,
        height,
        layout,
        planes: vec![plane],
        gpu: None,
        dmabuf: Some(dmabuf),
    };
    frame.import_gpu();
    frame.into_frame(pts_us)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::fd::AsRawFd;

    #[test]
    fn fourcc_matches_the_negotiated_layout() {
        assert_eq!(fourcc_for(FrameLayout::Bgrx), DrmFourcc::Xbgr8888 as u32);
        assert_eq!(fourcc_for(FrameLayout::Bgra), DrmFourcc::Abgr8888 as u32);
    }

    #[test]
    fn try_build_frame_is_none_for_a_non_mapping_fd() {
        // A read-only pipe fd cannot be mmap'd as a frame; the helper must
        // degrade to None (caller falls back), never panic.
        let (read, _write) = std::io::pipe().expect("pipe");
        let fd = read.as_raw_fd();
        assert!(try_build_frame(fd, 64, 2, 2, FrameLayout::Bgrx, 0).is_none());
    }

    #[test]
    fn try_build_frame_maps_a_real_file_into_a_frame() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("frame.bin");
        // stride(64) * height(2) bytes back the mapping; the frame copies
        // the packed `width * bpp * height` = 16 bytes out of it.
        let bytes = (0..128u8).collect::<Vec<_>>();
        std::fs::write(&path, &bytes).expect("write");
        let file = std::fs::File::open(&path).expect("open");
        let frame = try_build_frame(file.as_raw_fd(), 64, 2, 2, FrameLayout::Bgrx, 7)
            .expect("a mappable file yields a frame");
        assert_eq!(&frame.data, &bytes);
        assert_eq!(frame.pts_us, 7);
        assert_eq!(frame.stride, 64);
    }
}
