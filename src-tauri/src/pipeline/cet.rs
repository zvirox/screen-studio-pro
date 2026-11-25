//! Capture Event Track (CET) sidecar export (PLAN 8.3).
//!
//! The sidecar is derived metadata next to the finalized media file. Only
//! facts the app actually observed are written: header fields come from the
//! take's own `StopOutcome`, and marker events come from its chapter list.
//! Click, window-switch, silence, and voice-activity events are deliberately
//! absent until real producers exist — a fabricated timeline is worse than
//! a smaller honest one.

use crate::pipeline::session::StopOutcome;
use crate::util::error::CoreError;
use serde::Serialize;
use std::path::{Path, PathBuf};

const CET_VERSION: &str = "cet/1.0";
const DEFAULT_AUDIO_SAMPLE_RATE: u32 = 48_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct CetHeader {
    version: &'static str,
    recording_fps: f64,
    duration_ms: u64,
    audio_sample_rate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CetEvent {
    Header {
        #[serde(flatten)]
        header: CetHeader,
    },
    Marker {
        timestamp_ms: u64,
        label: String,
    },
}

/// Derive the sidecar path from the media path — no separate DB column.
#[must_use]
pub fn sidecar_path(media: &Path) -> PathBuf {
    media.with_extension("cet.jsonl")
}

fn audio_sample_rate(outcome: &StopOutcome) -> u32 {
    let Some(json) = outcome.audio_json.as_deref() else {
        return DEFAULT_AUDIO_SAMPLE_RATE;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return DEFAULT_AUDIO_SAMPLE_RATE;
    };
    value
        .get("sampleRate")
        .or_else(|| value.get("sample_rate"))
        .and_then(serde_json::Value::as_u64)
        .and_then(|rate| u32::try_from(rate).ok())
        .unwrap_or(DEFAULT_AUDIO_SAMPLE_RATE)
}

fn marker_events(outcome: &StopOutcome) -> Vec<CetEvent> {
    let Some(json) = outcome.chapter_json.as_deref() else {
        return Vec::new();
    };
    let Ok(chapters) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
        return Vec::new();
    };
    chapters
        .into_iter()
        .filter_map(|chapter| {
            let timestamp_ms = chapter.get("offset_ms")?.as_u64()?;
            let label = chapter.get("label")?.as_str()?.to_owned();
            Some(CetEvent::Marker {
                timestamp_ms,
                label,
            })
        })
        .collect()
}

/// Write the sidecar atomically. Failure is reported to the caller, which
/// logs it without discarding an otherwise valid take.
pub fn write_sidecar(outcome: &StopOutcome) -> Result<PathBuf, CoreError> {
    let target = sidecar_path(&outcome.path);
    let mut lines = String::new();
    let header = CetHeader {
        version: CET_VERSION,
        recording_fps: f64::from(outcome.fps),
        duration_ms: outcome.duration_ms,
        audio_sample_rate: audio_sample_rate(outcome),
    };
    for event in std::iter::once(CetEvent::Header { header }).chain(marker_events(outcome)) {
        let line = serde_json::to_string(&event).map_err(|err| {
            CoreError::disk(
                "disk.write_failed",
                false,
                "The telemetry sidecar could not be encoded.",
            )
            .with_details(serde_json::json!({ "cause": err.to_string() }))
        })?;
        lines.push_str(&line);
        lines.push('\n');
    }

    let temp = target.with_extension("cet.jsonl.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|err| {
        CoreError::disk(
            "disk.write_failed",
            true,
            "The telemetry sidecar could not be created.",
        )
        .with_details(serde_json::json!({ "cause": err.to_string() }))
    })?;
    use std::io::Write;
    file.write_all(lines.as_bytes()).map_err(|err| {
        CoreError::disk(
            "disk.write_failed",
            true,
            "The telemetry sidecar could not be written.",
        )
        .with_details(serde_json::json!({ "cause": err.to_string() }))
    })?;
    file.sync_all().map_err(|err| {
        CoreError::disk(
            "disk.write_failed",
            true,
            "The telemetry sidecar could not be flushed.",
        )
        .with_details(serde_json::json!({ "cause": err.to_string() }))
    })?;
    std::fs::rename(&temp, &target).map_err(|err| {
        CoreError::disk(
            "disk.write_failed",
            true,
            "The telemetry sidecar could not be finalized.",
        )
        .with_details(serde_json::json!({ "cause": err.to_string() }))
    })?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::EncoderInfo;
    use std::path::PathBuf;

    fn outcome(chapters: Option<&str>) -> StopOutcome {
        StopOutcome {
            path: PathBuf::from("/tmp/take.mkv"),
            duration_ms: 12_345,
            size_bytes: 1_024,
            width: 1920,
            height: 1080,
            fps: 60,
            encoder: EncoderInfo {
                backend: "x264",
                is_hardware: false,
            },
            started_at: "2026-11-25T00:00:00Z".into(),
            finished_at: "2026-11-25T00:00:12Z".into(),
            audio_json: Some(r#"{"sampleRate":48000}"#.into()),
            chapter_json: chapters.map(ToOwned::to_owned),
        }
    }

    #[test]
    fn sidecar_path_is_derived_from_the_media_path() {
        assert_eq!(
            sidecar_path(Path::new("/tmp/take.mkv")),
            PathBuf::from("/tmp/take.cet.jsonl")
        );
    }

    #[test]
    fn sidecar_contains_only_observed_facts() {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut take = outcome(Some(r#"[{"offset_ms":1500,"label":"intro"}]"#));
        take.path = dir.path().join("take.mkv");
        let path = write_sidecar(&take).expect("sidecar");
        let text = std::fs::read_to_string(&path).expect("sidecar text");
        let lines: Vec<serde_json::Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).expect("jsonl line"))
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["type"], "header");
        assert_eq!(lines[0]["version"], "cet/1.0");
        assert_eq!(lines[0]["duration_ms"], 12_345);
        assert_eq!(lines[0]["audio_sample_rate"], 48_000);
        assert_eq!(lines[1]["type"], "marker");
        assert_eq!(lines[1]["timestamp_ms"], 1500);
        assert_eq!(lines[1]["label"], "intro");
        assert!(!text.contains("click"));
        assert!(!text.contains("silence"));
    }
}
