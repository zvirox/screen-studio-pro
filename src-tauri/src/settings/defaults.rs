use super::{Audio, Capture, Files, Settings, Shortcuts};
use crate::util::paths;

/* First-run defaults — PRD G3 (record-ready with zero ceremony) + M8 sane
defaults (1080p60) + M9 output model (MKV record-safe, remux → MP4) +
API §2.6/§2.7 examples (naming pattern, quick-record combo). */

pub fn default_settings() -> Settings {
    Settings {
        capture: Capture {
            frame_rate: 60,
            encoder: "auto".into(),
            // "youtube" == 1080p60 ~12Mbps, i.e. M8's sane defaults (API §2.5).
            quality_preset: "youtube".into(),
        },
        audio: Audio {
            mic_device_id: None, // system default; M4 lists real devices
            desktop_audio: true,
            echo_cancel: false,
        },
        files: Files {
            dir: paths::videos_dir().to_string_lossy().into_owned(),
            naming_pattern: "screen-%Y-%m-%d-%H%M".into(),
            // Record to MKV, remux to MP4 on stop (M9 crash-safety model).
            container: "mp4".into(),
        },
        shortcuts: Shortcuts {
            quick_record: "Super+Shift+R".into(), // API §2.7 example
            pause: "Super+Shift+P".into(),
            stop: "Super+Shift+S".into(),
        },
    }
}

/* serde container-level `#[serde(default)]` (hand-edited TOML missing keys)
must fall back to THESE defaults, not zero-values — one source of truth. */
impl Default for Settings {
    fn default() -> Self {
        default_settings()
    }
}
impl Default for Capture {
    fn default() -> Self {
        default_settings().capture
    }
}
impl Default for Audio {
    fn default() -> Self {
        default_settings().audio
    }
}
impl Default for Files {
    fn default() -> Self {
        default_settings().files
    }
}
impl Default for Shortcuts {
    fn default() -> Self {
        default_settings().shortcuts
    }
}
