use base64::Engine;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

use crate::capture::CaptureHandle;
use crate::library::LibraryHandle;
use crate::settings::SettingsStore;
use crate::util::error::{CoreError, IpcError};
use ashpd::desktop::global_shortcuts::{
    BindShortcutsOptions, GlobalShortcuts, NewShortcut, Shortcut,
};
/* #[tauri::command] handlers — thin per ARCHITECTURE §2: validate → delegate.
0.6 brought the handshake + capability probe; 0.7 adds `settings_get/set`
(API §2.6) over the TOML store. Command names are the `cmd://` verbs of
API.md §2 minus the prefix. */

/// The pinned IPC contract version — API §5.1: versioned as a whole; the
/// webview carries the same constant in `types/ipc.ts` and gates boot on it.
pub const IPC_CONTRACT_VERSION: &str = "1.6.0";

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
    /// M2: whether the compositor's portal offers window capture (SourceType::Window).
    /// Set conservatively at cold start; the UI hides the Window chip when false.
    pub window_capture: bool,
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

// Cold-start probe (API §2.5). Real encoder detection for 3.3.
// VAAPI: check DRM render nodes. NVENC: probe libavcodec for h264_nvenc.
// x264: always available as the final fallback.
fn probe_capabilities() -> Capabilities {
    // VAAPI: check for DRM render nodes (prefer renderD128, fallback to any renderD*).
    let vaapi = std::path::Path::new("/dev/dri/renderD128").exists()
        || std::fs::read_dir("/dev/dri")
            .ok()
            .map(|mut dir| {
                dir.find(|e| {
                    e.as_ref()
                        .map(|e| e.file_name().to_string_lossy().starts_with("renderD"))
                        .unwrap_or(false)
                })
                .is_some()
            })
            .unwrap_or(false);

    // NVENC: probe libavcodec for h264_nvenc codec availability.
    // This is a cheap check — just codec existence, not full init.
    // Returns false for MVP — NVENC detection not yet implemented.
    let nvenc = false;

    // x264 is always available as the final fallback.
    let x264 = true;

    // Compose encoder list with hardware preference order: NVENC → VAAPI → x264
    let encoders = vec![
        EncoderCapability {
            backend: EncoderBackend::Nvenc,
            is_hardware: true,
            available: nvenc,
        },
        EncoderCapability {
            backend: EncoderBackend::Vaapi,
            is_hardware: true,
            available: vaapi,
        },
        EncoderCapability {
            backend: EncoderBackend::X264,
            is_hardware: false,
            available: x264,
        },
    ];

    let compositor = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();

    Capabilities {
        encoders,
        portal: PortalStatus {
            screencast: true,
            global_shortcuts: "partial",
            compositor: compositor.clone(),
            window_capture: compositor.contains("kde") || compositor.contains("plasma"),
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

/* ---------- presets_list (API §2.5, M11) ---------- */

// Presets resolve into the encode path (pipeline::presets is encode-gated),
// so the command only exists in encode builds — same law as recording_*.
#[cfg(feature = "encode")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub fps: u32,
    pub height: u32,
    pub container: &'static str,
}

/// `cmd://presets_list` — the four static quality presets (API §2.5).
#[cfg(feature = "encode")]
#[tauri::command]
pub fn presets_list() -> Value {
    let presets: Vec<PresetEntry> = crate::pipeline::presets::list()
        .iter()
        .map(|p| PresetEntry {
            id: p.id,
            label: p.label,
            description: p.description,
            fps: p.fps,
            height: p.height,
            container: p.container,
        })
        .collect();
    serde_json::json!({ "presets": serde_json::to_value(presets).expect("static presets are plain JSON data") })
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
/// flavour is live in 1.1 (PRD M1), window joins with M2, region (M3)
/// reuses the monitor session with a crop overlay. The caller-paced
/// consent dialog means this command legitimately runs for minutes;
/// concurrent selects return `portal.busy` from the slot.
#[tauri::command]
pub async fn source_select(
    kind: String,
    target: Option<String>,
    app: tauri::AppHandle,
    capture_state: State<'_, CaptureHandle>,
) -> Result<Value, IpcError> {
    let parsed = crate::capture::SourceKind::parse(&kind).ok_or_else(capture_invalid_kind)?;
    if let Some(hint) = &target {
        tracing::debug!(hint = %hint, "target hint deferred to portal picker");
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
    // Region reuses the monitor portal session; the crop rect is set
    // separately via `source_region_set` (M3).
    let portal_kind = if parsed == crate::capture::SourceKind::Region {
        crate::capture::SourceKind::Monitor
    } else {
        parsed
    };
    let result = match portal_kind {
        crate::capture::SourceKind::Monitor => {
            crate::capture::portal::select_monitor(source_id, on_lost).await
        }
        crate::capture::SourceKind::Window => {
            crate::capture::portal::select_window(source_id, on_lost).await
        }
        _ => Err(capture_invalid_kind()),
    };
    match result {
        Ok((session, mut reply)) => {
            // For region, override the reply kind to "region" so the UI knows.
            if parsed == crate::capture::SourceKind::Region {
                reply.kind = "region";
                reply.label = format!(
                    "Region ({}×{})",
                    reply.capabilities.width, reply.capabilities.height
                );
            }
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

/// `cmd://source_region_set` (API §2.1) — set/adjust the crop rect for
/// region mode (M3). The rect is in the source's native coordinate space
/// (the monitor's geometry). Arrow-key adjustable per DESIGN §7.4.
#[cfg(feature = "encode")]
#[tauri::command]
pub async fn source_region_set(
    source_id: String,
    rect: RegionRectInput,
    capture_state: State<'_, CaptureHandle>,
) -> Result<Value, IpcError> {
    if !capture_state.is_active_source(&source_id) {
        return Err(CoreError::capture(
            "capture.region_invalid",
            false,
            "No active capture session for that source id.",
        )
        .into());
    }
    if rect.w == 0 || rect.h == 0 {
        return Err(CoreError::capture(
            "capture.region_invalid",
            false,
            "Region width and height must be positive.",
        )
        .into());
    }
    let geometry = capture_state
        .active_geometry_if_matches(&source_id)
        .ok_or_else(|| {
            CoreError::capture(
                "capture.region_invalid",
                false,
                "Source geometry not available.",
            )
        })?;
    if rect.x + rect.w > geometry.0 || rect.y + rect.h > geometry.1 {
        return Err(CoreError::capture(
            "capture.region_invalid",
            false,
            "Region rect exceeds source bounds.",
        )
        .into());
    }
    capture_state.set_region_rect(Some(crate::capture::RegionRect {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
    }));
    Ok(serde_json::json!({ "ok": true }))
}

#[cfg(feature = "encode")]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionRectInput {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

/// `cmd://source_region_clear` (API §2.1) — clear the region crop rect,
/// returning to full-source capture.
#[cfg(feature = "encode")]
#[tauri::command]
pub async fn source_region_clear(
    source_id: String,
    capture_state: State<'_, CaptureHandle>,
) -> Result<Value, IpcError> {
    if !capture_state.is_active_source(&source_id) {
        return Err(CoreError::capture(
            "capture.region_invalid",
            false,
            "No active capture session for that source id.",
        )
        .into());
    }
    capture_state.set_region_rect(None);
    Ok(serde_json::json!({ "ok": true }))
}

fn capture_invalid_kind() -> CoreError {
    CoreError::capture(
        "capture.invalid_kind",
        false,
        "That source kind isn't available in this build. Monitor capture is ready; window and region capture arrive in a later update.",
    )
}

/// `cmd://source_preview` (API §2.1, task 3.5) — the latest preview still
/// for a live source. Thin wrapper over `preview_still_reply` so the
/// reply logic stays testable without a Tauri runtime.
#[tauri::command]
pub fn source_preview(
    source_id: String,
    capture_state: State<'_, CaptureHandle>,
) -> Result<Value, IpcError> {
    preview_still_reply(&source_id, &capture_state).map_err(|err| err.to_ipc())
}

fn preview_still_reply(source_id: &str, capture: &CaptureHandle) -> Result<Value, CoreError> {
    let mailbox = capture
        .preview_mailbox_if_matches(source_id)
        .ok_or_else(preview_not_ready)?;
    let (frame, captured_at_ms) = mailbox.latest().ok_or_else(preview_not_ready)?;
    let still = crate::capture::preview::encode_still(&frame)?;
    Ok(serde_json::json!({
        "jpegBase64": base64::engine::general_purpose::STANDARD.encode(&still.jpeg),
        "width": still.width,
        "height": still.height,
        "capturedAtMs": captured_at_ms,
    }))
}

fn preview_not_ready() -> CoreError {
    // Retryable: the webview's next ≤8fps poll may find a frame. Poll
    // failures never toast (API §2.1) — the education slot stays until
    // the first still lands.
    CoreError::ipc(
        "ipc.bad_state",
        true,
        "No preview is available for that source yet.",
    )
}

/* ---------- camera viewer (API §2.2, task 4.1) ---------- */

/// `cmd://camera_list_devices` — the sysfs-enumerated capture nodes,
/// grouped per camera (the UVC metadata node never surfaces).
#[cfg(feature = "encode")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDeviceEntry {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

#[cfg(feature = "encode")]
#[tauri::command]
pub fn camera_list_devices() -> Value {
    let devices: Vec<CameraDeviceEntry> = crate::capture::list_devices()
        .into_iter()
        .map(|d| CameraDeviceEntry {
            id: d.id,
            label: d.label,
            is_default: d.is_default,
        })
        .collect();
    serde_json::json!({ "devices": serde_json::to_value(devices).expect("plain JSON data") })
}

/// `cmd://camera_open` (API §2.2) — open the V4L2 device and return the
/// preview handle once the reader decoded its first frame.
#[cfg(feature = "encode")]
#[tauri::command]
pub fn camera_open(
    device_id: String,
    camera_state: State<'_, crate::capture::CameraHandle>,
) -> Result<Value, IpcError> {
    let (camera_id, width, height) = camera_state.open(&device_id).map_err(|err| err.to_ipc())?;
    Ok(serde_json::json!({
        "cameraId": camera_id,
        "width": width,
        "height": height,
    }))
}

/// `cmd://camera_close` (API §2.2) — idempotent: no open camera or an
/// unknown id still succeeds.
#[cfg(feature = "encode")]
#[tauri::command]
pub fn camera_close(
    camera_id: String,
    camera_state: State<'_, crate::capture::CameraHandle>,
) -> Result<Value, IpcError> {
    camera_state.close(Some(&camera_id));
    Ok(serde_json::json!({ "ok": true }))
}

/// `cmd://camera_preview` (API §2.2, task 4.1) — the latest camera still:
/// the SAME §2.1 reply shape as `source_preview` (JPEG ≤640px + stamp),
/// served from the camera's own mailbox. Not-ready polls are retryable
/// `ipc.bad_state` and never toast (the 3.5 polling law).
#[cfg(feature = "encode")]
#[tauri::command]
pub fn camera_preview(
    camera_id: String,
    camera_state: State<'_, crate::capture::CameraHandle>,
) -> Result<Value, IpcError> {
    let mailbox = camera_state
        .mailbox_if_matches(&camera_id)
        .ok_or_else(preview_not_ready)?;
    let (frame, captured_at_ms) = mailbox.latest().ok_or_else(preview_not_ready)?;
    let still = crate::capture::preview::encode_still(&frame)?;
    Ok(serde_json::json!({
        "jpegBase64": base64::engine::general_purpose::STANDARD.encode(&still.jpeg),
        "width": still.width,
        "height": still.height,
        "capturedAtMs": captured_at_ms,
    }))
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
    region_rect: Option<crate::capture::RegionRect>,
    audio: Option<Vec<Value>>,
    camera_id: Option<String>,
    preset_id: Option<String>,
    output_dir: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, IpcError> {
    let _ = (audio, preset_id); // 1.3 scope note — camera_id is honoured by 4.3
    crate::app_state::run(
        app,
        crate::app_state::Action::Start {
            source_id: Some(source_id),
            output_dir,
            region_rect,
            camera_id,
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

/// `cmd://shortcuts_apply` (API §2.7) — register global shortcuts via the
/// portal; returns { granted, denied }.
#[tauri::command]
pub async fn shortcuts_apply(
    bindings: Vec<ShortcutBinding>,
    _app: tauri::AppHandle,
    store: State<'_, Mutex<SettingsStore>>,
) -> Result<Value, IpcError> {
    // Persist shortcuts to settings store.
    let patch = serde_json::json!({
        "shortcuts": {
            "quickRecord": bindings
                .iter()
                .find(|b| b.action == "toggle_record")
                .map(|b| b.combo.clone())
                .unwrap_or_default(),
            "pause": bindings
                .iter()
                .find(|b| b.action == "pause")
                .map(|b| b.combo.clone())
                .unwrap_or_default(),
            "stop": bindings
                .iter()
                .find(|b| b.action == "stop")
                .map(|b| b.combo.clone())
                .unwrap_or_default(),
        }
    });
    store
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .apply_patch(&patch)
        .map_err(|err| err.to_ipc())?;

    // Register via GlobalShortcuts portal.
    let global_shortcuts = GlobalShortcuts::new()
        .await
        .map_err(|err| {
            CoreError::portal(
                "portal.unavailable",
                false,
                format!("Global shortcuts portal unavailable: {err}"),
            )
            .to_ipc()
        })?;

    let session = global_shortcuts
        .create_session(Default::default())
        .await
        .map_err(|err| {
            CoreError::portal(
                "portal.unavailable",
                false,
                format!("Global shortcuts session creation failed: {err}"),
            )
            .to_ipc()
        })?;

    let requested: Vec<NewShortcut> = bindings
        .iter()
        .map(|b| NewShortcut::new(&b.action, &b.action).preferred_trigger(b.combo.as_str()))
        .collect();

    let options = BindShortcutsOptions::default();

    let request = global_shortcuts
        .bind_shortcuts(&session, &requested, None, options)
        .await
        .map_err(|err| {
            CoreError::portal(
                "portal.unavailable",
                false,
                format!("Global shortcuts bind request failed: {err}"),
            )
            .to_ipc()
        })?;

    let granted: Vec<Shortcut> = request
        .response()
        .map_err(|err| {
            CoreError::portal(
                "portal.unavailable",
                false,
                format!("Global shortcuts bind response failed: {err}"),
            )
            .to_ipc()
        })?
        .shortcuts()
        .to_vec();

    let granted_ids: Vec<String> = granted.iter().map(|s| s.id().to_string()).collect();
    let denied: Vec<String> = bindings
        .iter()
        .filter(|b| !granted_ids.contains(&b.action))
        .map(|b| b.action.clone())
        .collect();

    Ok(serde_json::json!({ "granted": granted_ids, "denied": denied }))
}

/// Shortcut binding payload (API §2.7).
#[derive(Debug, Clone, Deserialize)]
pub struct ShortcutBinding {
    pub action: String,
    pub combo: String,
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

/// `cmd://library_list` (API §2.4, task 5.2) — paged library grid query.
#[cfg(feature = "encode")]
#[tauri::command]
#[allow(dead_code)]
pub async fn library_list(
    limit: Option<i64>,
    offset: Option<i64>,
    filter: Option<Value>,
    sort: Option<Value>,
    library: State<'_, crate::library::LibraryHandle>,
) -> Result<Value, IpcError> {
    let limit = limit.unwrap_or(50).clamp(1, 100);
    let offset = offset.unwrap_or(0).max(0);

    let f = filter.unwrap_or_else(|| serde_json::json!({}));
    let s =
        sort.unwrap_or_else(|| serde_json::json!({ "field": "created_at", "direction": "desc" }));

    let filter = crate::library::LibraryListFilter {
        status: f
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        kind: f
            .get("kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        search: f
            .get("search")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };
    let sort = crate::library::LibraryListSort {
        field: s
            .get("field")
            .and_then(|v| v.as_str())
            .unwrap_or("created_at")
            .to_string(),
        direction: s
            .get("direction")
            .and_then(|v| v.as_str())
            .unwrap_or("desc")
            .to_string(),
    };

    let (items, total) = library.library_list(filter, sort, limit, offset)?;

    Ok(serde_json::json!({
        "total": total,
        "items": items.into_iter().map(|it| serde_json::json!({
            "id": it.id,
            "path": it.path,
            "fileName": it.file_name,
            "kind": it.kind,
            "container": it.container,
            "status": it.status,
            "durationMs": it.duration_ms,
            "width": it.width,
            "height": it.height,
            "fps": it.fps,
            "sizeBytes": it.size_bytes,
            "encoder": it.encoder,
            "isHwEncoder": it.is_hw_encoder == 1,
            "audioJson": it.audio_json,
            "chapterJson": it.chapter_json,
            "thumbPath": it.thumb_path,
            "deletedAt": it.deleted_at,
            "createdAt": it.created_at,
            "updatedAt": it.updated_at,
        })).collect::<Vec<_>>(),
        "page": { "limit": limit, "offset": offset },
    }))
}

/// `cmd://library_get` (API §2.4, task 5.2) — fetch a single library row.
#[cfg(feature = "encode")]
#[tauri::command]
#[allow(dead_code)]
pub async fn library_get(
    id: i64,
    library: State<'_, crate::library::LibraryHandle>,
) -> Result<Value, IpcError> {
    let row = library.library_get(id)?;
    match row {
        Some(it) => Ok(serde_json::json!({
            "id": it.id,
            "path": it.path,
            "fileName": it.file_name,
            "kind": it.kind,
            "container": it.container,
            "status": it.status,
            "durationMs": it.duration_ms,
            "width": it.width,
            "height": it.height,
            "fps": it.fps,
            "sizeBytes": it.size_bytes,
            "encoder": it.encoder,
            "isHwEncoder": it.is_hw_encoder == 1,
            "audioJson": it.audio_json,
            "chapterJson": it.chapter_json,
            "thumbPath": it.thumb_path,
            "deletedAt": it.deleted_at,
            "createdAt": it.created_at,
            "updatedAt": it.updated_at,
        })),
        None => Err(CoreError::ipc(
            "library.not_found",
            false,
            "No recording with that id exists.",
        )
        .into()),
    }
}

/// `cmd://library_delete` (API §2.4, task 5.2) — soft-delete a library row.
#[cfg(feature = "encode")]
#[tauri::command]
#[allow(dead_code)]
pub async fn library_delete(
    id: i64,
    library: State<'_, crate::library::LibraryHandle>,
) -> Result<Value, IpcError> {
    library.library_delete(id)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parity seed (TESTING §1 P1): the wire names must match API.md §2.5.
    #[test]
    fn hello_carries_the_pinned_contract() {
        let v = serde_json::to_value(ipc_hello()).unwrap();
        assert_eq!(v["ipcContract"], "1.6.0");
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
        assert_eq!(backends, ["nvenc", "vaapi", "x264"]);
        assert_eq!(v["version"]["ipcContract"], "1.6.0");
        assert_eq!(v["version"]["app"], "0.0.1-alpha.1");
        assert!(v["portal"]["compositor"].is_string());
        assert!(v["encoders"][0]["isHardware"].is_boolean());
    }

    #[cfg(feature = "encode")]
    #[test]
    fn presets_list_carries_the_four_m11_presets() {
        let v = presets_list();
        let ids: Vec<&str> = v["presets"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["youtube", "discord", "lossless", "smallest"]);
    }

    /* ---------- source_preview (API §2.1, task 3.5) ---------- */

    use crate::capture::preview::PreviewMailbox;
    use base64::Engine;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// LiveSource double carrying a real mailbox — the reply path is
    /// exercised end-to-end minus the portal itself.
    struct PreviewFake {
        id: String,
        live: Arc<AtomicBool>,
        mailbox: Arc<PreviewMailbox>,
    }

    #[async_trait::async_trait]
    impl crate::capture::LiveSource for PreviewFake {
        fn source_id(&self) -> &str {
            &self.id
        }
        fn is_live(&self) -> bool {
            self.live.load(Ordering::Relaxed)
        }
        fn stop_frames(&mut self) {}
        async fn close(&mut self) {}
        fn preview_mailbox(&self) -> Option<Arc<PreviewMailbox>> {
            Some(self.mailbox.clone())
        }
    }

    fn tiny_frame() -> crate::pipeline::Frame {
        crate::pipeline::Frame {
            width: 4,
            height: 4,
            stride: 16,
            layout: crate::pipeline::FrameLayout::Bgrx,
            pts_us: 0,
            data: vec![0u8; 64],
        }
    }

    fn committed_capture(mailbox: Arc<PreviewMailbox>, live: Arc<AtomicBool>) -> CaptureHandle {
        let capture = CaptureHandle::new();
        capture.begin().unwrap();
        capture.commit(Box::new(PreviewFake {
            id: "src_a".into(),
            live,
            mailbox,
        }));
        capture
    }

    #[test]
    fn preview_reply_carries_the_api_2_1_shape() {
        let mailbox = Arc::new(PreviewMailbox::new());
        mailbox.offer(tiny_frame(), 1234);
        let capture = committed_capture(mailbox, Arc::new(AtomicBool::new(true)));
        let v = preview_still_reply("src_a", &capture).expect("reply");
        assert_eq!(v["capturedAtMs"], 1234);
        assert_eq!(v["width"], 4);
        assert_eq!(v["height"], 4);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(v["jpegBase64"].as_str().unwrap())
            .expect("valid base64");
        assert_eq!(&bytes[..2], &[0xFF, 0xD8], "JPEG magic");
    }

    #[test]
    fn preview_reply_is_bad_state_unless_a_live_matching_source_has_a_still() {
        let capture = CaptureHandle::new();
        assert_eq!(
            preview_still_reply("src_a", &capture).unwrap_err().code(),
            "ipc.bad_state",
            "free slot"
        );
        let mailbox = Arc::new(PreviewMailbox::new());
        let live = Arc::new(AtomicBool::new(true));
        let capture = committed_capture(mailbox.clone(), live.clone());
        assert_eq!(
            preview_still_reply("src_b", &capture).unwrap_err().code(),
            "ipc.bad_state",
            "wrong id"
        );
        assert_eq!(
            preview_still_reply("src_a", &capture).unwrap_err().code(),
            "ipc.bad_state",
            "live but no frame captured yet"
        );
        mailbox.offer(tiny_frame(), 1);
        assert!(preview_still_reply("src_a", &capture).is_ok());
        live.store(false, Ordering::Relaxed);
        assert_eq!(
            preview_still_reply("src_a", &capture).unwrap_err().code(),
            "ipc.bad_state",
            "lost source serves no stale stills"
        );
    }
}
