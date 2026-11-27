//! Phase 14.1 — dynamic module ABI host side. Loads a `libsspmod_*.so` that
//! exports `ssp_module_api` (a `#[repr(C)]` vtable, see `ssp-module.h`) and
//! calls `process` per frame. The ABI is a stable C boundary; a bad module
//! fails typed and the host drops the frame (never crashes). Behind `encode`.
#![allow(dead_code)] // foundation; the capture-source routing is the live-gated step
use std::path::Path;

use crate::util::error::CoreError;

pub const SSP_MODULE_ABI_VERSION: u32 = 1;

/// `#[repr(C)]` mirror of `SspModuleFrame` (ssp-module.h). Field order and
/// types must match the header exactly.
#[repr(C)]
pub struct ModuleFrame {
    pub drm_fd: i32,
    pub fourcc: u32,
    pub modifier: u64,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub pts_us: u64,
    pub data: *const u8,
    pub data_len: usize,
}

/// `#[repr(C)]` mirror of `SspModuleApi` (the exported vtable).
#[repr(C)]
#[derive(Clone, Copy)]
struct ModuleApi {
    abi_version: u32,
    init: Option<unsafe extern "C" fn() -> i32>,
    process: Option<unsafe extern "C" fn(*mut ModuleFrame) -> i32>,
    deinit: Option<unsafe extern "C" fn()>,
    param_count: u32,
    params: *const ModuleParam,
}

/// `#[repr(C)]` mirror of `SspModuleParam` (14.1 dynamic property).
#[repr(C)]
pub(crate) struct ModuleParam {
    name: *const std::os::raw::c_char,
    type_: u32,
    min: f32,
    max: f32,
    def: f32,
}

/// A module parameter mapped to a host control (14.1 properties engine).
#[derive(Debug, Clone, PartialEq)]
pub struct ParamSpec {
    pub name: String,
    pub kind: ParamKind,
    pub min: f32,
    pub max: f32,
    pub default: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamKind {
    Float,
    Int,
    Bool,
}

impl ParamSpec {
    /// Map a C descriptor to a host spec (pure; the UI renders from this).
    pub(crate) fn from_c(p: &ModuleParam) -> Self {
        let name = unsafe { std::ffi::CStr::from_ptr(p.name) }
            .to_string_lossy()
            .into_owned();
        let kind = match p.type_ {
            1 => ParamKind::Int,
            2 => ParamKind::Bool,
            _ => ParamKind::Float,
        };
        Self {
            name,
            kind,
            min: p.min,
            max: p.max,
            default: p.def,
        }
    }
}

/// A loaded module: the library handle + its resolved vtable.
pub struct ModuleHandle {
    // The library must outlive the vtable; declared first so it drops last.
    _lib: libloading::Library,
    api: ModuleApi,
}

impl ModuleHandle {
    /// dlopen a module and resolve its `ssp_module_api` vtable.
    pub fn load(path: &Path) -> Result<Self, CoreError> {
        let lib = unsafe { libloading::Library::new(path) }.map_err(|err| {
            CoreError::capture(
                "module.load_failed",
                false,
                format!("module load failed: {err}"),
            )
        })?;
        let sym = unsafe { lib.get::<*const ModuleApi>(b"ssp_module_api\0") }.map_err(|err| {
            CoreError::capture(
                "module.load_failed",
                false,
                format!("module missing ssp_module_api: {err}"),
            )
        })?;
        let ptr: *const ModuleApi = *sym;
        let api = unsafe { *ptr };
        if api.abi_version != SSP_MODULE_ABI_VERSION {
            return Err(CoreError::capture(
                "module.load_failed",
                false,
                format!(
                    "module ABI {} != host {}",
                    api.abi_version, SSP_MODULE_ABI_VERSION
                ),
            ));
        }
        if api.process.is_none() {
            return Err(CoreError::capture(
                "module.load_failed",
                false,
                "module has no process fn".to_string(),
            ));
        }
        if let Some(init) = api.init {
            let rc = unsafe { init() };
            if rc != 0 {
                return Err(CoreError::capture(
                    "module.load_failed",
                    false,
                    format!("module init failed: {rc}"),
                ));
            }
        }
        Ok(Self { _lib: lib, api })
    }

    /// The module's dynamic-property descriptors (14.1), for the UI engine.
    pub fn params(&self) -> Vec<ParamSpec> {
        let n = self.api.param_count as usize;
        if n == 0 || self.api.params.is_null() {
            return Vec::new();
        }
        (0..n)
            .map(|i| ParamSpec::from_c(unsafe { &*self.api.params.add(i) }))
            .collect()
    }

    /// Process one frame in place (the module may transform it). Typed error
    /// on failure; the caller drops the frame.
    pub fn process(&self, frame: &mut ModuleFrame) -> Result<(), CoreError> {
        let f = self.api.process.ok_or_else(|| {
            CoreError::capture(
                "module.load_failed",
                false,
                "module has no process fn".to_string(),
            )
        })?;
        let rc = unsafe { f(frame as *mut ModuleFrame) };
        if rc == 0 {
            Ok(())
        } else {
            Err(CoreError::capture(
                "module.load_failed",
                false,
                format!("module process failed: {rc}"),
            ))
        }
    }
}

impl Drop for ModuleHandle {
    fn drop(&mut self) {
        if let Some(deinit) = self.api.deinit {
            unsafe { deinit() };
        }
    }
}

/// Load every `*.so` in a module directory (the `[modules]` registry `dir`).
/// Failures are logged and skipped — one bad module never blocks the rest.
pub fn load_dir(dir: &Path) -> Vec<ModuleHandle> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("so") {
            continue;
        }
        match ModuleHandle::load(&path) {
            Ok(m) => out.push(m),
            Err(err) => tracing::warn!(path = %path.display(), error = %err, "module load skipped"),
        }
    }
    out
}

/// Load every enabled registry directory (settings `[modules]`).
pub fn load_enabled(entries: &[crate::settings::ModuleEntry]) -> Vec<ModuleHandle> {
    let mut out = Vec::new();
    for entry in entries.iter().filter(|e| e.enabled) {
        out.extend(load_dir(Path::new(&entry.dir)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_library_is_an_error() {
        let r = ModuleHandle::load(Path::new("/nonexistent/libsspmod_x.so"));
        assert!(r.is_err(), "missing lib must error");
    }

    #[test]
    fn empty_dir_loads_nothing() {
        let dir = tempfile::tempdir().expect("tmp");
        assert!(load_dir(dir.path()).is_empty());
    }

    #[test]
    fn disabled_entries_are_skipped() {
        let entries = vec![crate::settings::ModuleEntry {
            dir: "/nonexistent".into(),
            enabled: false,
        }];
        assert!(load_enabled(&entries).is_empty());
    }

    #[test]
    fn param_from_c_maps_kind_and_range() {
        let name = std::ffi::CString::new("threshold").expect("cstr");
        let p = ModuleParam {
            name: name.as_ptr(),
            type_: 1,
            min: 0.0,
            max: 1.0,
            def: 0.5,
        };
        let spec = ParamSpec::from_c(&p);
        assert_eq!(spec.name, "threshold");
        assert_eq!(spec.kind, ParamKind::Int);
        assert_eq!(spec.default, 0.5);
    }
}
