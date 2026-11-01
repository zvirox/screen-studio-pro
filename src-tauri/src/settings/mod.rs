mod defaults;

pub use defaults::default_settings;

use crate::util::error::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/* Settings store — PRD §7.5 groups (Capture/Audio/Files/Shortcuts; About is
static UI), ARCHITECTURE §4.1 owner law ("Tauri store, mirrored TOML on
disk": Rust caches, every write persists), API §2.6 command semantics
(get by section, set as section-scoped partial merge) and §1 error codes
(schema errors vs value errors below). TOML mirrors the wire field names
(camelCase) so hand-editing matches the contract — one naming mind. */

/// The section ids of API §2.6 — external shape, also the TOML table names.
pub const SECTIONS: [&str; 4] = ["capture", "audio", "files", "shortcuts"];

/* ---------- schema (deny_unknown_fields = schema_mismatch on the wire) ---------- */

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Settings {
    pub capture: Capture,
    pub audio: Audio,
    pub files: Files,
    pub shortcuts: Shortcuts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Capture {
    /// M10: framerate is a 30/60 choice, not a free number.
    pub frame_rate: u16,
    /// M8: "auto" = the encoder chain decides (NVENC→VAAPI→x264).
    pub encoder: String,
    /// M11 preset ids (API §2.5 presets_list).
    pub quality_preset: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Audio {
    /// None = PipeWire default source (M4 resolves the device).
    pub mic_device_id: Option<String>,
    pub desktop_audio: bool,
    /// Echo-cancel toggle (PRD §7.5 Audio group).
    pub echo_cancel: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Files {
    pub dir: String,
    /// strftime-style pattern, e.g. the API §2.6 example
    /// "screen-%Y-%m-%d-%H%M" (expanded by the muxer, task 1.3).
    pub naming_pattern: String,
    /// DATABASE §2.1 container CHECK: mkv | mp4 | webm.
    pub container: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Shortcuts {
    /// Portal combos; quick_record default is the API §2.7 example.
    pub quick_record: String,
    pub pause: String,
    pub stop: String,
}

/* ---------- validation ("Zod-equivalent", ARCHITECTURE tree §2) ---------- */

/// Semantic value law — well-typed but out of contract → settings.invalid_value.
pub fn validate(settings: &Settings) -> Result<(), CoreError> {
    let invalid = |msg: &str| CoreError::settings("settings.invalid_value", true, msg);
    let c = &settings.capture;
    if ![30, 60].contains(&c.frame_rate) {
        return Err(invalid("Frame rate must be 30 or 60."));
    }
    if !matches!(c.encoder.as_str(), "auto" | "vaapi" | "nvenc" | "x264") {
        return Err(invalid("Unknown encoder. Pick auto, vaapi, nvenc or x264."));
    }
    if !matches!(
        c.quality_preset.as_str(),
        "youtube" | "discord" | "lossless" | "smallest"
    ) {
        return Err(invalid("Unknown quality preset."));
    }
    if settings
        .audio
        .mic_device_id
        .as_ref()
        .is_some_and(|device| device.is_empty())
    {
        return Err(invalid(
            "Microphone device can't be empty; clear it to use the system default.",
        ));
    }
    let f = &settings.files;
    if !Path::new(&f.dir).is_absolute() {
        return Err(invalid("The save directory must be an absolute path."));
    }
    if f.naming_pattern.is_empty() || f.naming_pattern.contains('/') {
        return Err(invalid(
            "The file naming pattern can't be empty or contain slashes.",
        ));
    }
    if !matches!(f.container.as_str(), "mkv" | "mp4" | "webm") {
        return Err(invalid("Container must be mkv, mp4 or webm."));
    }
    for combo in [
        &settings.shortcuts.quick_record,
        &settings.shortcuts.pause,
        &settings.shortcuts.stop,
    ] {
        if combo.trim().is_empty() {
            return Err(invalid("Shortcuts can't be empty."));
        }
    }
    Ok(())
}

/* ---------- store ---------- */

/// Rust-side cache with the TOML mirror on disk (ARCHITECTURE §4.1).
/// File mode 0600: no secrets inside, but recording metadata is private
/// (same posture as DATABASE §7 for the library DB).
#[derive(Debug)]
pub struct SettingsStore {
    path: PathBuf,
    cache: Settings,
}

impl SettingsStore {
    /// Load from `dir/settings.toml`; first run writes the defaults file so
    /// there's something to hand-edit (PRD G3: defaults alone must already
    /// be record-ready with zero ceremony).
    pub fn load_or_create(dir: &Path) -> Result<Self, CoreError> {
        let path = dir.join("settings.toml");
        if !path.exists() {
            let store = Self {
                path,
                cache: default_settings(),
            };
            store.persist()?;
            return Ok(store);
        }
        let raw = std::fs::read_to_string(&path).map_err(disk_unwritable)?;
        let cache: Settings = toml::from_str(&raw).map_err(|_| {
            CoreError::settings(
                "settings.schema_mismatch",
                false,
                "The settings file doesn't match the app's schema. Fix or delete settings.toml to restore defaults.",
            )
        })?;
        validate(&cache)?;
        Ok(Self { path, cache })
    }

    pub fn get(&self) -> &Settings {
        &self.cache
    }

    /// Boot fallback when the TOML can't be read or parsed (lib.rs setup):
    /// defaults in memory, nothing persisted — the Settings UI (M10) offers
    /// the recovery path. Never panics the boot.
    pub fn from_defaults(dir: &Path) -> Self {
        Self {
            path: dir.join("settings.toml"),
            cache: default_settings(),
        }
    }

    /// API §2.6 `settings_set`: merge `{ section: { …fields } }` into the
    /// cached sections, re-validate, persist. Returns full merged settings.
    pub fn apply_patch(&mut self, patch: &Value) -> Result<Value, CoreError> {
        let object = patch.as_object().ok_or_else(|| {
            CoreError::settings(
                "settings.schema_mismatch",
                false,
                "Settings changes must be sent as an object of sections.",
            )
        })?;
        for section in object.keys() {
            if !SECTIONS.contains(&section.as_str()) {
                return Err(CoreError::settings(
                    "settings.schema_mismatch",
                    false,
                    "Unknown settings section.",
                ));
            }
        }

        // Overlay each patch's fields onto that section, then one typed
        // deserialize re-derives the exact schema (deny_unknown_fields).
        // Plain-data invariant: Settings only holds JSON-native types.
        let mut candidate: Value =
            serde_json::to_value(&self.cache).expect("Settings is plain JSON data");
        for (section, fields) in object {
            let Some(fields_obj) = fields.as_object() else {
                return Err(CoreError::settings(
                    "settings.schema_mismatch",
                    false,
                    "Each settings section must be an object.",
                ));
            };
            let section_value = candidate
                .get_mut(section)
                .expect("section exists after the SECTIONS check");
            let Some(section_obj) = section_value.as_object_mut() else {
                return Err(CoreError::settings(
                    "settings.schema_mismatch",
                    false,
                    "Each settings section must be an object.",
                ));
            };
            for (field, value) in fields_obj {
                section_obj.insert(field.clone(), value.clone());
            }
        }

        let updated: Settings = serde_json::from_value(candidate).map_err(schema_mismatch)?;
        validate(&updated)?;
        self.cache = updated;
        self.persist()?;
        Ok(serde_json::to_value(&self.cache).expect("Settings is plain JSON data"))
    }

    fn persist(&self) -> Result<(), CoreError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(disk_unwritable)?;
        }
        let raw = toml::to_string_pretty(&self.cache).map_err(|_| {
            CoreError::disk("disk.write_failed", true, "Settings could not be written.")
        })?;
        std::fs::write(&self.path, raw).map_err(disk_unwritable)?;
        set_owner_only(&self.path);
        Ok(())
    }
}

/// Wrong JSON shape in a patch (API §1: schema problems, not value problems).
fn schema_mismatch(_: serde_json::Error) -> CoreError {
    CoreError::settings(
        "settings.schema_mismatch",
        false,
        "That settings change doesn't match the expected shape.",
    )
}

fn disk_unwritable(_: std::io::Error) -> CoreError {
    CoreError::disk(
        "disk.path_unwritable",
        false,
        "ScreenStudio Pro can't write its settings file. Check the folder's permissions.",
    )
}

#[cfg(unix)]
fn set_owner_only(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store(dir: &Path) -> SettingsStore {
        SettingsStore::load_or_create(dir).expect("store")
    }

    #[test]
    fn first_run_writes_defaults_then_loads_identically() {
        let tmp = tempfile::tempdir().unwrap();
        let first = store(tmp.path());
        assert_eq!(first.get(), &default_settings());
        // "Restart": a fresh store over the same dir reads the same values.
        let second = store(tmp.path());
        assert_eq!(second.get(), &default_settings());
    }

    #[test]
    fn hand_edited_toml_is_picked_up_on_load() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("settings.toml"),
            "[capture]\nframeRate = 30\nencoder = \"x264\"\nqualityPreset = \"lossless\"\n[files]\ndir = \"/tmp/rec\"\nnamingPattern = \"demo-%H%M\"\ncontainer = \"mkv\"\n",
        )
        .unwrap();
        let loaded = store(tmp.path());
        assert_eq!(loaded.get().capture.frame_rate, 30);
        assert_eq!(loaded.get().files.container, "mkv");
        assert!(loaded.get().audio.desktop_audio); // unlisted keys keep defaults
    }

    #[test]
    fn partial_merge_touches_only_patched_fields_and_merges_sections() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(tmp.path());
        let merged = s
            .apply_patch(&json!({
                "capture": { "frameRate": 30 },
                "files": { "container": "mkv" }
            }))
            .unwrap();
        assert_eq!(merged["capture"]["frameRate"], 30);
        assert_eq!(merged["capture"]["qualityPreset"], "youtube"); // untouched
        assert_eq!(merged["files"]["container"], "mkv");
        assert_eq!(merged["files"]["dir"], default_settings().files.dir);
        // Persisted for the next boot:
        let reloaded = store(tmp.path());
        assert_eq!(reloaded.get().capture.frame_rate, 30);
        assert_eq!(reloaded.get().files.container, "mkv");
    }

    #[test]
    fn invalid_value_gets_the_typed_code() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(tmp.path());
        let err = s
            .apply_patch(&json!({ "capture": { "frameRate": 90 } }))
            .unwrap_err();
        assert_eq!(err.code(), "settings.invalid_value");
        assert!(err.retryable());
    }

    #[test]
    fn unknown_section_and_unknown_field_are_schema_mismatch() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(tmp.path());
        assert_eq!(
            s.apply_patch(&json!({ "scenes": {} })).unwrap_err().code(),
            "settings.schema_mismatch" // V2 seam rejection
        );
        assert_eq!(
            s.apply_patch(&json!({ "capture": { "bitrate": 9000 } }))
                .unwrap_err()
                .code(),
            "settings.schema_mismatch"
        );
    }

    #[test]
    fn corrupt_toml_is_schema_mismatch_with_recovery_copy() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("settings.toml"), "capture = [not valid").unwrap();
        let err = SettingsStore::load_or_create(tmp.path()).unwrap_err();
        assert_eq!(err.code(), "settings.schema_mismatch");
        // from_defaults is the boot fallback for exactly this case:
        assert_eq!(
            SettingsStore::from_defaults(tmp.path()).get(),
            &default_settings()
        );
    }

    #[test]
    fn created_file_is_owner_only_0600() {
        // Assumes a non-root test runner (dev machine + CI are non-root);
        // root ignores permission bits, which would make this assert moot.
        let tmp = tempfile::tempdir().unwrap();
        store(tmp.path());
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(tmp.path().join("settings.toml"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
