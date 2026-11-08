use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

use crate::capture::CaptureHandle;
use crate::library::LibraryHandle;
use crate::settings::SettingsStore;
use crate::util::error::{CoreError, IpcError};
/* #[tauri::command] handlers — thin per ARCHITECTURE §2: validate → delegate.
0.6 brought the handshake + capability probe; 0.7 adds `settings_get/set`
(API §2.6) over the TOML store. Command names are the `cmd://` verbs of
API.md §2 minus the prefix. */

/// The pinned IPC contract version — API §5.1: versioned as a whole; the
/// webview carries the same constant in `types/ipc.ts` and gates boot on it.
pub const IPC_CONTRACT_VERSION: &str = "1.2.0";

/// `cmd://ipc_hello` — minimal handshake returning the contract version.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub ipc_contract: &'static str,
}

#[tauri::command]
pub fn ipc_hello() -> Hello {
    Hello {
        ipc_contract: IPC_CONTRACT_VERSION,
    }
}

/// API §4.1: automatic hiding is guarded against stale HUD creation.
#[tauri::command]
pub async fn window_hide(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    recording_id: Option<String>,
) -> Result<Value, IpcError> {
    if window.label() != "main" {
        return Err(CoreError::ipc(
            "ipc.bad_state",
            false,
            "Only the main window can hide itself.",
        )
        .into());
    }
    let host = crate::tray::host_available().await;
    crate::app_state::run(
        app,
        crate::app_state::Action::Hide { recording_id, host },
        false,
    )
    .await
    .map_err(Into::into)
}

/* ---------- system_capabilities (API §2.5) ---------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EncoderBackend {
    Vaapi,
    Nvenc,
    X264,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCapability {
    pub backend: EncoderBackend,
    pub is_hardware: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalStatus {
    pub screencast: bool,
    pub global_shortcuts: &'static str,
    pub compositor: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub app: &'static str,
    pub ipc_contract: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub encoders: Vec<EncoderCapability>,
    pub portal: PortalStatus,
    pub version: VersionInfo,
}

// Cold-start probe (API §2.5). Honest cheap checks only in 0.6: the live
// encoder probe lands with the Encoder trait (M8), the portal/GlobalShortcuts
// matrix with their modules (M1/M12). Statics below are flagged accordingly.
fn probe_capabilities() -> Capabilities {
    // VAAPI needs a DRM render node on Wayland/Linux.
    let vaapi = std::path::Path::new("/dev/dri/renderD128").exists();
    let compositor = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();

    Capabilities {
        encoders: vec![
            EncoderCapability {
                backend: EncoderBackend::Vaapi,
                is_hardware: true,
                available: vaapi,
            },
            // NVENC detection requires an encoder-capable probe — M8, not statable yet.
            EncoderCapability {
                backend: EncoderBackend::Nvenc,
                is_hardware: true,
                available: false,
            },
            EncoderCapability {
                backend: EncoderBackend::X264,
                is_hardware: false,
                available: true,
            },
        ],
        portal: PortalStatus {
            // Wayland-first platform baseline; M1 replaces this with a live ashpd probe.
            screencast: true,
            // M12 probes the GlobalShortcuts portal; "partial" is the conservative default.
            global_shortcuts: "partial",
            compositor,
        },
        version: VersionInfo {
            app: env!("CARGO_PKG_VERSION"),
            ipc_contract: IPC_CONTRACT_VERSION,
        },
    }
}

/// `cmd://system_capabilities` — drives the encoder chip (§6.1) and the
/// frontend's boot gate (API §5.1).
#[tauri::command]
pub fn system_capabilities() -> Capabilities {
    probe_capabilities()
}

/// `cmd://settings_get` — returns one TOML section as JSON (API §2.6).
#[tauri::command]
pub fn settings_get(
    section: String,
    store: State<'_, Mutex<SettingsStore>>,
) -> Result<Value, IpcError> {
    // Lock poisoning means a thread panicked holding the store — recover the
    // inner value; the cache is plain data and still consistent.
    let store = store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let settings = store.get();
    match section.as_str() {
        "capture" => {
            Ok(serde_json::to_value(&settings.capture).expect("Settings is plain JSON data"))
        }
        "audio" => Ok(serde_json::to_value(&settings.audio).expect("Settings is plain JSON data")),
        "files" => Ok(serde_json::to_value(&settings.files).expect("Settings is plain JSON data")),
        "shortcuts" => {
            Ok(serde_json::to_value(&settings.shortcuts).expect("Settings is plain JSON data"))
        }
        _ => Err(CoreError::settings(
            "settings.schema_mismatch",
            false,
            "Unknown settings section.",
        )
        .into()),
    }
}

/// `cmd://settings_set` — section-scoped partial merge (API §2.6); returns
/// the full merged settings.
#[tauri::command]
pub fn settings_set(
    patch: Value,
    store: State<'_, Mutex<SettingsStore>>,
) -> Result<Value, IpcError> {
    let mut store = store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    store.apply_patch(&patch).map_err(|err| err.to_ipc())
}

/// `cmd://prefs_get` — one key, or all with an empty key (API §2.6).
#[tauri::command]
pub fn prefs_get(key: String, library: State<'_, LibraryHandle>) -> Result<Value, IpcError> {
    library.prefs_get(&key).map_err(|err| err.to_ipc())
}

/// `cmd://prefs_set` — validated upsert into `ui_prefs` (API §2.6);
/// rate law (≤60 Hz batching) is the frontend's duty.
#[tauri::command]
pub fn prefs_set(
    key: String,
    value: Value,
    library: State<'_, LibraryHandle>,
) -> Result<Value, IpcError> {
    library.prefs_set(&key, &value).map_err(|err| err.to_ipc())
}

/// `cmd://source_select` (API §2.1) — begin a portal session; monitor
/// flavour is live in 1.1 (PRD M1), window/region join with M2/M3. The
/// caller-paced consent dialog means this command legitimately runs for
/// minutes; concurrent selects return `portal.busy` from the slot.
#[tauri::command]
pub async fn source_select(
    kind: String,
    target: Option<String>,
    app: tauri::AppHandle,
    capture_state: State<'_, CaptureHandle>,
) -> Result<Value, IpcError> {
    let parsed = crate::capture::SourceKind::parse(&kind).ok_or_else(capture_invalid_kind)?;
    // M2/M3: window/region reuse this command with their own portal flavours.
    if parsed != crate::capture::SourceKind::Monitor {
        return Err(capture_invalid_kind().into());
    }
    if let Some(hint) = &target {
        // The portal picker owns output choice until the restore-token flow
        // (M2+); a monitor hint is recorded, not honoured, in 1.1.
        tracing::debug!(hint = %hint, "monitor target hint deferred to portal picker");
    }

    let source_id = crate::capture::new_source_id();
    let lost_id = source_id.clone();
    let app_for_lost = app.clone();
    let on_lost = move |reason: &str| {
        tracing::error!(source = %lost_id, reason, "capture source lost");
        crate::app_state::dispatch(&app_for_lost, crate::app_state::Action::Refresh);
        let _ = super::events::emit(
            &app_for_lost,
            super::events::topic::SOURCE_LOST,
            super::events::SourceLost {
                source_id: lost_id.clone(),
                reason: reason.to_string(),
            },
        );
    };

    capture_state.begin().map_err(|err| err.to_ipc())?;
    match crate::capture::portal::select_monitor(source_id, on_lost).await {
        Ok((session, reply)) => {
            let reply = serde_json::to_value(&reply).expect("§2.1 reply is plain JSON");
            capture_state.commit(Box::new(session));
            crate::app_state::dispatch(&app, crate::app_state::Action::Refresh);
            Ok(reply)
        }
        Err(err) => {
            capture_state.abort();
            Err(err.to_ipc())
        }
    }
}

/// `cmd://source_release` (API §2.1) — end the portal session / free the
/// PipeWire stream. Idempotent on an unknown/absent id; `portal.busy` only
/// for a still-starting or different active session (the recording-active
/// check joins with task 1.4's session guard).
#[tauri::command]
pub async fn source_release(source_id: String, app: tauri::AppHandle) -> Result<Value, IpcError> {
    crate::app_state::run(app, crate::app_state::Action::Release(source_id), false)
        .await
        .map_err(Into::into)
}

fn capture_invalid_kind() -> CoreError {
    CoreError::capture(
        "capture.invalid_kind",
        false,
        "That source kind isn't available in this build. Monitor capture is ready; window and region capture arrive in a later update.",
    )
}

/* ---------- audio devices (API §2.2, task 2.1) ---------- */

/// `cmd://audio_list_devices` — cpal mics + PipeWire sink outputs with
/// defaults marked. Flag ⚠ (API §2.2): devices are system state — the
/// reply is a snapshot; callers re-list after plugging/unplugging.
/// Enumeration failures are typed `pipewire.audio_enum_failed` (§1).
#[tauri::command]
pub fn audio_list_devices() -> Result<Value, IpcError> {
    let mics = crate::capture::audio::list_mics().map_err(|err| err.to_ipc())?;
    let desktop = crate::capture::audio::list_desktop_outputs().map_err(|err| err.to_ipc())?;
    Ok(serde_json::json!({ "mics": mics, "desktop": desktop }))
}

/// `cmd://audio_set_channel` (API §2.2) — enable/mute a channel, pick a
/// device, set level (0–100); persisted through the settings store (⚠:
/// settings_set path, not a DB row). A concrete `deviceId` is validated
/// against the LIVE system before persisting: a miss is
/// `pipewire.audio_device_gone`, an enumeration failure is
/// `pipewire.audio_enum_failed`. JSON `null` = clear back to the system
/// default (nothing to validate — the store treats it the same way).
#[tauri::command]
pub fn audio_set_channel(
    channel: String,
    enabled: Option<bool>,
    muted: Option<bool>,
    device_id: Option<Value>,
    level: Option<u8>,
    store: State<'_, Mutex<SettingsStore>>,
) -> Result<Value, IpcError> {
    if let Some(id) = device_id.as_ref().and_then(Value::as_str) {
        let exists = match channel.as_str() {
            "mic" => crate::capture::audio::mic_exists(id).map_err(|err| err.to_ipc())?,
            "desktop" => crate::capture::audio::sink_exists(id).map_err(|err| err.to_ipc())?,
            // Unknown channels fail in the store with settings.invalid_value.
            _ => true,
        };
        if !exists {
            return Err(CoreError::pipewire(
                "pipewire.audio_device_gone",
                false,
                "That audio device is not available. Pick another in Settings.",
            )
            .into());
        }
    }
    let mut guard = store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard
        .apply_audio_channel(&channel, enabled, muted, device_id, level)
        .map_err(|err| err.to_ipc())?;
    Ok(serde_json::json!({ "ok": true }))
}

/* ---------- recording session (API §2.3, task 1.3) ---------- */

/// `cmd://recording_start` (API §2.3) — wire source→bus→encode→mux for
/// the active monitor source. Thin by tree law: state checks here, the
/// whole pipeline dance lives in pipeline/session.rs. Task 1.3 scope
/// (API §2.3 note): video-only monitor recording; the other body fields
/// are contract-shaped but not honored until their PLAN tasks land.
#[cfg(feature = "encode")]
// The parameter list IS the API §2.3 body (6 wire fields) plus the two
// Tauri managed states — the contract fixes the shape, so the lint is
// acknowledged here rather than reshaping the command.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn recording_start(
    source_id: String,
    region_rect: Option<Value>,
    audio: Option<Vec<Value>>,
    camera_id: Option<String>,
    preset_id: Option<String>,
    output_dir: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, IpcError> {
    let _ = (region_rect, audio, camera_id, preset_id); // 1.3 scope note
    crate::app_state::run(
        app,
        crate::app_state::Action::Start {
            source_id: Some(source_id),
            output_dir,
        },
        false,
    )
    .await
    .map_err(Into::into)
}

/// `cmd://recording_pause` / `cmd://recording_resume` (API §2.3) — state
/// transitions on the live take; the reply carries the new phase verbatim
/// and the tick stream flips to `paused` at the next 1 Hz beat (API §3).
/// Contract errors: `ipc.bad_state` (not recording / not paused) — the
/// session-level matrix (session.rs) owns the law; these stay thin
/// (validate → delegate, ARCHITECTURE §2).
#[cfg(feature = "encode")]
#[tauri::command]
pub async fn recording_pause(
    recording_id: String,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, IpcError> {
    crate::app_state::run(
        app,
        crate::app_state::Action::Pause(recording_id),
        window.label() == "hud",
    )
    .await
    .map_err(Into::into)
}

#[cfg(feature = "encode")]
#[tauri::command]
pub async fn recording_resume(
    recording_id: String,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, IpcError> {
    crate::app_state::run(
        app,
        crate::app_state::Action::Resume(recording_id),
        window.label() == "hud",
    )
    .await
    .map_err(Into::into)
}

/// `cmd://recording_flag` (API §2.3 / flow 7.2) — append a chapter marker
/// at the take's current recording-relative time. The label defaults to
/// `flag-N` (N = 1-based marker count on this take). Emits `recording/flagged`
/// at the same instant the marker lands so the HUD can react immediately.
#[cfg(feature = "encode")]
#[tauri::command]
pub async fn recording_flag(
    recording_id: String,
    label: Option<String>,
    recordings: tauri::State<'_, crate::pipeline::session::RecordingHandle>,
    app: tauri::AppHandle,
) -> Result<Value, IpcError> {
    let chapter = recordings
        .flag(&recording_id, label.clone())
        .map_err(|err| err.to_ipc())?;
    let label = chapter.label.clone();
    // ARCHITECTURE §3.2: fire the event the instant the marker lands
    // (API §3: `recording/flagged`, on user action).
    super::events::emit(
        &app,
        super::events::topic::RECORDING_FLAGGED,
        super::events::RecordingFlagged {
            recording_id: recording_id.clone(),
            chapter: super::events::Chapter {
                offset_ms: chapter.offset_ms,
                label: chapter.label,
            },
        },
    )
    .map_err(|err| {
        tracing::error!(error = %err, "flag event could not be emitted");
        CoreError::ipc(
            "ipc.bad_state",
            false,
            "The recording flag could not be recorded.",
        )
    })?;
    Ok(serde_json::json!({
        "chapter": {
            "offsetMs": chapter.offset_ms,
            "label": label,
        }
    }))
}

/// `cmd://recording_stop` (API §2.3) — flush + trailer + join; the reply's
/// `recording` object carries only the fields that exist before the
/// library row (1.6). Contract errors: `ipc.bad_state`, `disk.*`.
#[cfg(feature = "encode")]
#[tauri::command]
pub async fn recording_stop(
    recording_id: String,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, IpcError> {
    crate::app_state::run(
        app,
        crate::app_state::Action::Stop(Some(recording_id)),
        window.label() == "hud",
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parity seed (TESTING §1 P1): the wire names must match API.md §2.5.
    #[test]
    fn hello_carries_the_pinned_contract() {
        let v = serde_json::to_value(ipc_hello()).unwrap();
        assert_eq!(v["ipcContract"], "1.2.0");
    }

    #[test]
    fn capabilities_list_all_three_backends_with_version() {
        let v = serde_json::to_value(probe_capabilities()).unwrap();
        let backends: Vec<&str> = v["encoders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["backend"].as_str().unwrap())
            .collect();
        assert_eq!(backends, ["vaapi", "nvenc", "x264"]);
        assert_eq!(v["version"]["ipcContract"], "1.2.0");
        assert_eq!(v["version"]["app"], "0.0.1-alpha.1");
        assert!(v["portal"]["compositor"].is_string());
        assert!(v["encoders"][0]["isHardware"].is_boolean());
    }
}
