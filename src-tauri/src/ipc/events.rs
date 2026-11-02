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

/* ---------- the Tauri-backed sink + the session emitters (task 1.4) ---------- */

/// The Tauri-backed sink: the pipeline's domain events → the API §3
/// wire payloads on the webview bus.
///
/// Layering (ARCHITECTURE §2 tree law): the pipeline knows only
/// [`SessionEvent`](crate::pipeline::stats::SessionEvent); this module
/// owns the wire mapping and the emission.
#[cfg(feature = "encode")]
pub struct TauriEventSink {
    app: tauri::AppHandle,
}

#[cfg(feature = "encode")]
impl TauriEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

#[cfg(feature = "encode")]
impl crate::pipeline::stats::EventSink for TauriEventSink {
    fn emit(&self, event: crate::pipeline::stats::SessionEvent) {
        use crate::pipeline::stats::SessionEvent;
        match event {
            SessionEvent::Tick {
                recording_id,
                elapsed_ms,
            } => {
                // §3: the phase is always `recording` until
                // `recording_pause`/`recording_resume` land.
                let _ = emit(
                    &self.app,
                    topic::RECORDING_TICK,
                    RecordingTick {
                        recording_id,
                        elapsed_ms,
                        state: RecordingPhase::Recording,
                    },
                );
            }
            SessionEvent::Stats(snapshot) => {
                let _ = emit(
                    &self.app,
                    topic::RECORDING_STATS,
                    RecordingStats {
                        fps: snapshot.fps,
                        dropped_frames: snapshot.dropped_frames,
                        bitrate_kbps: snapshot.bitrate_kbps,
                        encode_time_ms: snapshot.encode_time_ms,
                    },
                );
            }
            SessionEvent::Error(err) => {
                let _ = emit(&self.app, topic::RECORDING_ERROR, err);
            }
        }
    }
}

/// `recording/started` — once per session, right after the session went
/// live (ARCHITECTURE §3.2 step 3).
#[cfg(feature = "encode")]
pub fn recording_started(app: &tauri::AppHandle, info: &crate::pipeline::session::StartInfo) {
    let _ = emit(
        app,
        topic::RECORDING_STARTED,
        RecordingStarted {
            recording_id: info.recording_id.clone(),
            encoder: info.encoder.backend.to_string(),
            started_at: info.started_at.clone(),
        },
    );
}

/// `recording/finished` — once per session, after the trailer was
/// written (ARCHITECTURE §3.2 step 6).
#[cfg(feature = "encode")]
pub fn recording_finished(
    app: &tauri::AppHandle,
    recording_id: &str,
    outcome: &crate::pipeline::session::StopOutcome,
) {
    let _ = emit(
        app,
        topic::RECORDING_FINISHED,
        RecordingFinished {
            recording_id: recording_id.to_string(),
            recording: library_recording(outcome),
        },
    );
}

/// The `recording/finished` library-row projection (DATABASE §2.1).
///
/// Until the DB upsert (task 1.6) there is NO row: `id` is 0 and the
/// JSON columns stay null. The shape is complete so consumers can be
/// written against the final contract (API §5.2: the Rust truth is a
/// superset of what the webview must tolerate).
#[cfg(feature = "encode")]
pub fn library_recording(outcome: &crate::pipeline::session::StopOutcome) -> LibraryRecording {
    LibraryRecording {
        // No row yet — the DB upsert lands with task 1.6 (which also emits
        // `library/updated`).
        id: 0,
        path: outcome.path.display().to_string(),
        file_name: outcome
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        // DATABASE §2.1 `kind` CHECK: recording | screenshot | stream-marker.
        kind: "recording".to_string(),
        container: outcome
            .path
            .extension()
            .map(|ext| ext.to_string_lossy().into_owned())
            .unwrap_or_else(|| "mkv".to_string()),
        status: "ready".to_string(),
        duration_ms: outcome.duration_ms,
        width: Some(outcome.width),
        height: Some(outcome.height),
        fps: Some(outcome.fps),
        size_bytes: outcome.size_bytes,
        encoder: outcome.encoder.backend.to_string(),
        is_hw_encoder: outcome.encoder.is_hardware,
        // The JSON value columns: no audio (M4), no chapters (flow 7.2),
        // no thumbnail (5.1) yet.
        audio_json: None,
        chapter_json: None,
        thumb_path: None,
        deleted_at: None,
        created_at: outcome.started_at.clone(),
        updated_at: outcome.finished_at.clone(),
    }
}

#[cfg(all(test, feature = "encode"))]
mod tests {
    use super::*;
    use crate::pipeline::session::StopOutcome;

    fn outcome() -> StopOutcome {
        StopOutcome {
            path: std::path::PathBuf::from("/home/u/Videos/SSP/first-rec.mkv"),
            duration_ms: 1_540,
            size_bytes: 402_117,
            width: 1920,
            height: 1080,
            fps: 60,
            encoder: crate::encode::EncoderInfo {
                backend: "x264",
                is_hardware: false,
            },
            started_at: "2026-11-02T10:00:00Z".to_string(),
            finished_at: "2026-11-02T10:00:02Z".to_string(),
        }
    }

    #[test]
    fn the_finished_projection_carries_the_row_shape_until_the_db_upsert() {
        let row = library_recording(&outcome());
        assert_eq!(row.id, 0, "no library row until task 1.6");
        assert_eq!(row.path, "/home/u/Videos/SSP/first-rec.mkv");
        assert_eq!(row.file_name, "first-rec.mkv");
        assert_eq!(row.kind, "recording");
        assert_eq!(row.container, "mkv");
        assert_eq!(row.status, "ready");
        assert_eq!(row.duration_ms, 1_540);
        assert_eq!(row.width, Some(1920));
        assert_eq!(row.height, Some(1080));
        assert_eq!(row.fps, Some(60));
        assert_eq!(row.size_bytes, 402_117);
        assert_eq!(row.encoder, "x264");
        assert!(!row.is_hw_encoder);
        assert!(row.audio_json.is_none());
        assert!(row.chapter_json.is_none());
        assert!(row.thumb_path.is_none());
        assert!(row.deleted_at.is_none());
        assert_eq!(row.created_at, "2026-11-02T10:00:00Z");
        assert_eq!(row.updated_at, "2026-11-02T10:00:02Z");
    }

    /// API §3 wire shapes — the Rust twin of `types/ipc.ts` (TESTING §1 P1:
    /// the mirror is the project's #1 silent breakage risk).
    #[test]
    fn the_finished_payload_matches_the_api_wire_shape() {
        let value = serde_json::to_value(RecordingFinished {
            recording_id: "rec_01hv4".to_string(),
            recording: library_recording(&outcome()),
        })
        .expect("serialize");
        assert_eq!(value["recordingId"], "rec_01hv4");
        assert_eq!(value["recording"]["fileName"], "first-rec.mkv");
        assert_eq!(value["recording"]["durationMs"], 1_540);
        assert_eq!(value["recording"]["isHwEncoder"], false);
        assert_eq!(value["recording"]["thumbPath"], serde_json::Value::Null);
        assert_eq!(value["recording"]["id"], 0);
    }

    #[test]
    fn the_tick_payload_matches_the_api_wire_shape() {
        let value = serde_json::to_value(RecordingTick {
            recording_id: "rec_01hv4".to_string(),
            elapsed_ms: 2_000,
            state: RecordingPhase::Recording,
        })
        .expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "recordingId": "rec_01hv4",
                "elapsedMs": 2000,
                "state": "recording",
            })
        );
    }

    #[test]
    fn the_stats_payload_matches_the_api_wire_shape() {
        let value = serde_json::to_value(RecordingStats {
            fps: 59.8,
            dropped_frames: 0,
            bitrate_kbps: 12_100,
            encode_time_ms: 5.2,
        })
        .expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "fps": 59.8,
                "droppedFrames": 0,
                "bitrateKbps": 12100,
                "encodeTimeMs": 5.2,
            })
        );
    }
}
