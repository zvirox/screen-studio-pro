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
pub const IPC_CONTRACT_VERSION: &str = "1.1.0";

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
pub async fn source_release(
    source_id: String,
    capture_state: State<'_, CaptureHandle>,
) -> Result<Value, IpcError> {
    if let Some(mut session) = capture_state.take(&source_id).map_err(|err| err.to_ipc())? {
        session.stop_frames();
        session.close().await;
    }
    Ok(serde_json::json!({ "ok": true }))
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

/// The canonical `ipc.bad_state` producer — 409-class conflicts of the
/// recording/session state machine (codes are add-only, API §1).
#[cfg(feature = "encode")]
fn bad_state(message: &'static str) -> CoreError {
    CoreError::ipc("ipc.bad_state", false, message)
}

/// The take's audio plan from the SETTINGS SNAPSHOT (2.1): every enabled
/// channel becomes one capture producer + one mix source, gains snapped
/// at `recording_start` (the config-snapshot law — a mid-take settings
/// change cannot reshape a running take; live retune is a deferred PLAN
/// task). `None` = video-only take. A capture start failure is fatal
/// for the start (typed, before any media flows).
///
/// Zero-gain law: a MUTED channel still captures (and drains) but mixes
/// at gain 0 — dropping the capture would lose the device handshake and
/// turn unmute into a mid-take reconnection problem; §6 counts every
/// dropped sample as data loss.
#[cfg(feature = "encode")]
fn build_audio_plan(
    audio: &crate::settings::Audio,
) -> Result<Option<crate::pipeline::session::AudioPlan>, CoreError> {
    use crate::capture::audio::{AudioChannel, ChannelConfig, OnLost, start_desktop, start_mic};
    use crate::pipeline::audio::{AudioRing, DEFAULT_RING_CAPACITY, MixSource};

    // Device-lost law (API §3): the ring's disable IS the lost signal —
    // the audio worker's is_disabled() poll renders the ONE non-fatal
    // event. This callback only logs; the user-facing copy lives in the
    // worker's typed event. OnLost is FnOnce → a fresh closure per start.
    let on_lost = || -> OnLost {
        Box::new(|reason: &str| {
            tracing::error!(reason, "audio capture source lost");
        })
    };

    let mut producers = Vec::new();
    let mut channels = Vec::new();

    if audio.mic_enabled {
        let config = ChannelConfig {
            channel: AudioChannel::Mic,
            enabled: true,
            muted: audio.mic_muted,
            device_id: audio.mic_device_id.clone(),
            level: audio.mic_level,
        };
        let ring = std::sync::Arc::new(AudioRing::new(DEFAULT_RING_CAPACITY));
        producers.push(start_mic(&config, ring.clone(), on_lost())?);
        channels.push(MixSource {
            ring,
            gain: if audio.mic_muted {
                0.0
            } else {
                crate::capture::audio::channel_gain(audio.mic_level)
            },
            channel: AudioChannel::Mic,
        });
    }
    if audio.desktop_audio {
        let config = ChannelConfig {
            channel: AudioChannel::Desktop,
            enabled: true,
            muted: audio.desktop_muted,
            device_id: audio.desktop_device_id.clone(),
            level: audio.desktop_level,
        };
        let ring = std::sync::Arc::new(AudioRing::new(DEFAULT_RING_CAPACITY));
        producers.push(start_desktop(&config, ring.clone(), on_lost())?);
        channels.push(MixSource {
            ring,
            gain: if audio.desktop_muted {
                0.0
            } else {
                crate::capture::audio::channel_gain(audio.desktop_level)
            },
            channel: AudioChannel::Desktop,
        });
    }

    if channels.is_empty() {
        return Ok(None);
    }
    // DATABASE §2.1 audio_json — the row's audio fact, rendered from the
    // SAME snapshot that built the plan (used = actually recorded).
    let row_note = serde_json::json!([
        { "source": "mic", "device": audio.mic_device_id, "used": audio.mic_enabled },
        { "source": "desktop", "device": audio.desktop_device_id, "used": audio.desktop_audio },
    ])
    .to_string();
    Ok(Some(crate::pipeline::session::AudioPlan {
        producers,
        channels,
        row_note: Some(row_note),
    }))
}

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
    capture_state: State<'_, CaptureHandle>,
    recordings: State<'_, crate::pipeline::session::RecordingHandle>,
    store: State<'_, Mutex<SettingsStore>>,
) -> Result<Value, IpcError> {
    let _ = (region_rect, audio, camera_id, preset_id); // 1.3 scope note
    let Some(source) = capture_state
        .active_info()
        .filter(|active| active.source_id == source_id)
    else {
        return Err(bad_state(
            "Select a capture source before recording (or the source id changed).",
        )
        .into());
    };
    let Some(bus) = source.frame_bus else {
        return Err(bad_state("The active source does not produce a recording stream.").into());
    };

    // outputDir from the caller, else the default Videos dir (PRD M9).
    let dir = match output_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => crate::util::paths::videos_dir(),
    };

    // The session's event stream (API §3): the pipeline stays
    // Tauri-agnostic — the IPC layer injects the Tauri-backed sink.
    let events = std::sync::Arc::new(super::events::TauriEventSink::new(app.clone()));
    // 2.1: the audio plan comes from the SETTINGS SNAPSHOT (the request
    // body's `audio` field stays contract-shaped-but-not-honored — API
    // §2.3 note). A capture start failure is fatal for the take: typed,
    // before any media flows.
    let audio_plan = {
        let guard = store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        build_audio_plan(&guard.get().audio).map_err(|err| err.to_ipc())?
    };
    let info = recordings
        .start(bus, source.geometry, &dir, events, audio_plan)
        .map_err(|err| err.to_ipc())?;
    // ARCHITECTURE §3.2 step 3: the session is live → announce it.
    super::events::recording_started(&app, &info);
    Ok(serde_json::json!({
        "recordingId": info.recording_id,
        "status": "recording",
        "encoder": { "backend": info.encoder.backend, "isHardware": info.encoder.is_hardware },
        "startedAt": info.started_at,
    }))
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
    recordings: State<'_, crate::pipeline::session::RecordingHandle>,
) -> Result<Value, IpcError> {
    recordings
        .pause(&recording_id)
        .map_err(|err| err.to_ipc())?;
    Ok(serde_json::json!({ "status": "paused" }))
}

#[cfg(feature = "encode")]
#[tauri::command]
pub async fn recording_resume(
    recording_id: String,
    recordings: State<'_, crate::pipeline::session::RecordingHandle>,
) -> Result<Value, IpcError> {
    recordings
        .resume(&recording_id)
        .map_err(|err| err.to_ipc())?;
    Ok(serde_json::json!({ "status": "recording" }))
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
    library: tauri::State<'_, crate::library::LibraryHandle>,
    recordings: State<'_, crate::pipeline::session::RecordingHandle>,
) -> Result<Value, IpcError> {
    let outcome = recordings
        .stop(&recording_id)
        .map_err(|err| err.to_ipc())? // outer: ipc.bad_state
        .map_err(|err| err.to_ipc())?; // inner: the take's own fate
    // Task 1.6: the take is on disk → the pipeline flow writes the
    // library row (DATABASE §6 writer role) and the reply carries the
    // real row id. The files stay on disk even if the index write
    // fails — the error propagates as a typed disk failure (§1) and the
    // finished event is NOT emitted (no payload can claim a row that
    // does not exist).
    let id = library
        .record_finalize(&crate::library::FinalizedRecording::from(&outcome))
        .map_err(|err| err.to_ipc())?;
    // ARCHITECTURE §3.2 step 6: announce the finished take, then the
    // library change (API §3: `library/updated` on row change).
    super::events::recording_finished(&app, &recording_id, &outcome, id);
    super::events::library_updated(&app, id);
    Ok(serde_json::json!({
        "recording": {
            "id": id,
            "path": outcome.path.display().to_string(),
            "container": "mkv",
            "durationMs": outcome.duration_ms,
            "sizeBytes": outcome.size_bytes,
            "status": "ready",
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parity seed (TESTING §1 P1): the wire names must match API.md §2.5.
    #[test]
    fn hello_carries_the_pinned_contract() {
        let v = serde_json::to_value(ipc_hello()).unwrap();
        assert_eq!(v["ipcContract"], "1.1.0");
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
        assert_eq!(v["version"]["ipcContract"], "1.1.0");
        assert_eq!(v["version"]["app"], "0.1.0");
        assert!(v["portal"]["compositor"].is_string());
        assert!(v["encoders"][0]["isHardware"].is_boolean());
    }
}
