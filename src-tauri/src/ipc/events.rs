// Payload types are contract mirror until task 1.4's emitters construct them.
#![allow(dead_code)]

use serde::Serialize;

use crate::util::error::IpcError;

/* Typed event payloads — the streaming half of the API.md §3 surface.
Topics are the `evt://` targets (the `evt://` prefix is documentation
addressing; Tauri event names are the bare `domain/verb` string).
Cadence/coalescing law is ARCHITECTURE §6: throttling happens IN Rust
at the emit site per topic — payloads here are the wire shapes only.
Task 1.4 adds the throttled emitters that produce them. */

/// The ten API.md §3 topics, as constants so producers can't typo a topic.
pub mod topic {
    pub const RECORDING_STARTED: &str = "recording/started";
    pub const RECORDING_TICK: &str = "recording/tick";
    pub const RECORDING_METERS: &str = "recording/meters";
    pub const RECORDING_STATS: &str = "recording/stats";
    pub const RECORDING_FLAGGED: &str = "recording/flagged";
    pub const RECORDING_ERROR: &str = "recording/error";
    pub const RECORDING_FINISHED: &str = "recording/finished";
    pub const LIBRARY_UPDATED: &str = "library/updated";
    pub const SOURCE_LOST: &str = "source/lost";
    pub const DEVICE_CHANGED: &str = "device/changed";
}

/// Emit one typed payload on a topic. Throttle wrappers join in task 1.4 —
/// until then nothing should call this on a hot path.
pub fn emit<T: Serialize + Clone>(
    app: &tauri::AppHandle,
    topic: &str,
    payload: T,
) -> Result<(), tauri::Error> {
    use tauri::Emitter;
    app.emit(topic, payload)
}

/* ---------- payload types ---------- */

/// Recording phase carried by `recording/tick` (1 Hz, §3 rate law).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingPhase {
    Recording,
    Paused,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStarted {
    pub recording_id: String,
    pub encoder: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingTick {
    pub recording_id: String,
    pub elapsed_ms: u64,
    pub state: RecordingPhase,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Meter {
    pub rms: f32,
    pub peak: f32,
}

/// `recording/meters` — ≤30 Hz, coalesced in Rust (§3 / ARCHITECTURE §6).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMeters {
    pub mic: Meter,
    pub desktop: Meter,
}

/// `recording/stats` — 0.5 Hz.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStats {
    pub fps: f64,
    pub dropped_frames: u64,
    pub bitrate_kbps: u64,
    pub encode_time_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub offset_ms: u64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFlagged {
    pub recording_id: String,
    pub chapter: Chapter,
}

/// `recording/error` — the payload IS the API.md §1 standard error shape.
pub type RecordingError = IpcError;

/// The `recording/finished` library-row projection — mirrors DATABASE §2.1
/// `recordings` (the value-object JSON columns stay strings over the wire;
/// the frontend decodes where it consumes them).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRecording {
    pub id: i64,
    pub path: String,
    pub file_name: String,
    pub kind: String,
    pub container: String,
    pub status: String,
    pub duration_ms: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub size_bytes: u64,
    pub encoder: String,
    pub is_hw_encoder: bool,
    pub audio_json: Option<String>,
    pub chapter_json: Option<String>,
    pub thumb_path: Option<String>,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFinished {
    pub recording_id: String,
    pub recording: LibraryRecording,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUpdated {
    pub id: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLost {
    pub source_id: String,
    pub reason: String,
}

/// PipeWire/V4L2 hotplug notice — debounced ≤1 Hz (§3 rate law).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceChanged {
    pub audio: bool,
    pub camera: bool,
}
