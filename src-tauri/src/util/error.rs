// Variant constructors are adopted as feature modules land (0.7 settings,
// 1.x capture/encode/disk); until each is wired, clippy sees unused items.
#![allow(dead_code)]

use serde::Serialize;
use serde_json::Value;
use std::fmt;

/* CoreError — ARCHITECTURE §4.2 layer 1: every core module returns this typed
error. At the IPC boundary it serializes to the API.md §1 shape
{kind, code, retryable, userMessage, details}. Codes are stable strings,
only ever added, never renamed (API §1); userMessage is the exact human
copy users see (DESIGN §7.9) — raw causes live in tracing, never the UI. */

/// One error body per `CoreError` variant — the fields every API.md §1
/// response carries regardless of kind.
#[derive(Debug, Clone, PartialEq)]
pub struct ErrorBody {
    code: &'static str,
    retryable: bool,
    user_message: String,
    details: Option<Value>,
}

impl ErrorBody {
    pub fn new(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self {
            code,
            retryable,
            user_message: user_message.into(),
            details: None,
        }
    }

    /// Optional structured extras (encoder chain attempted, free bytes…).
    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CoreError {
    /// Desktop portal failures — capture consent, GlobalShortcuts (ashpd).
    Portal(ErrorBody),
    /// Encoder selection/init failures — the §6.1 fallback chain reads these.
    Encoder(ErrorBody),
    /// PipeWire stream/graph failures — frame and audio path lifecycles.
    PipeWire(ErrorBody),
    /// Capture-origin failures that are not portal failures (region math, camera).
    Capture(ErrorBody),
    /// Filesystem failures — mux writes, thumbnails, config persistence.
    Disk(ErrorBody),
    /// Settings schema/validation failures (TOML per ARCHITECTURE stack).
    Settings(ErrorBody),
    /// Failures of the IPC surface itself (contract, unknown command).
    Ipc(ErrorBody),
}

impl CoreError {
    // Kind-scoped constructors — call sites name the API.md §1 code explicitly
    // so a grep on a code finds every producer.
    pub fn portal(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::Portal(ErrorBody::new(code, retryable, user_message))
    }
    pub fn encoder(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::Encoder(ErrorBody::new(code, retryable, user_message))
    }
    pub fn pipewire(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::PipeWire(ErrorBody::new(code, retryable, user_message))
    }
    pub fn capture(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::Capture(ErrorBody::new(code, retryable, user_message))
    }
    pub fn disk(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::Disk(ErrorBody::new(code, retryable, user_message))
    }
    pub fn settings(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::Settings(ErrorBody::new(code, retryable, user_message))
    }
    pub fn ipc(code: &'static str, retryable: bool, user_message: impl Into<String>) -> Self {
        Self::Ipc(ErrorBody::new(code, retryable, user_message))
    }

    /// Attach structured extras to any variant.
    pub fn with_details(self, details: Value) -> Self {
        let map = |body: ErrorBody| body.with_details(details);
        match self {
            Self::Portal(b) => Self::Portal(map(b)),
            Self::Encoder(b) => Self::Encoder(map(b)),
            Self::PipeWire(b) => Self::PipeWire(map(b)),
            Self::Capture(b) => Self::Capture(map(b)),
            Self::Disk(b) => Self::Disk(map(b)),
            Self::Settings(b) => Self::Settings(map(b)),
            Self::Ipc(b) => Self::Ipc(map(b)),
        }
    }

    pub fn code(&self) -> &str {
        self.body().code
    }
    pub fn retryable(&self) -> bool {
        self.body().retryable
    }
    pub fn user_message(&self) -> &str {
        &self.body().user_message
    }
    pub fn details(&self) -> Option<&Value> {
        self.body().details.as_ref()
    }

    fn body(&self) -> &ErrorBody {
        match self {
            Self::Portal(b)
            | Self::Encoder(b)
            | Self::PipeWire(b)
            | Self::Capture(b)
            | Self::Disk(b)
            | Self::Settings(b)
            | Self::Ipc(b) => b,
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code(), self.user_message())
    }
}

impl std::error::Error for CoreError {}

/* ---------- IPC boundary projection (ARCHITECTURE §4.2 layer 2) ---------- */

/// Error family over the wire — serialized to the API.md §1 `kind` strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Portal,
    Encoder,
    // serde's snake_case would emit "pipe_wire"; API.md §1 says "pipewire".
    #[serde(rename = "pipewire")]
    PipeWire,
    Capture,
    Disk,
    Settings,
    Ipc,
}

/// The serialized error every command returns and every `*`/error event
/// payload reuses — byte-for-byte the API.md §1 shape (camelCase wire names).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    kind: ErrorKind,
    code: String,
    retryable: bool,
    user_message: String,
    details: Option<Value>,
}

impl From<CoreError> for IpcError {
    fn from(err: CoreError) -> Self {
        let kind = match err {
            CoreError::Portal(_) => ErrorKind::Portal,
            CoreError::Encoder(_) => ErrorKind::Encoder,
            CoreError::PipeWire(_) => ErrorKind::PipeWire,
            CoreError::Capture(_) => ErrorKind::Capture,
            CoreError::Disk(_) => ErrorKind::Disk,
            CoreError::Settings(_) => ErrorKind::Settings,
            CoreError::Ipc(_) => ErrorKind::Ipc,
        };
        let body = err.body();
        Self {
            kind,
            code: body.code.to_string(),
            retryable: body.retryable,
            user_message: body.user_message.clone(),
            details: body.details.clone(),
        }
    }
}

impl CoreError {
    /// The wire shape, for tests and for error payloads inside events.
    pub fn to_ipc(&self) -> IpcError {
        IpcError::from(self.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // API.md §1 shapes the wire error exactly; camelCase keys are contract.
    #[test]
    fn serializes_to_the_api_md_1_shape() {
        let err = CoreError::settings(
            "settings.invalid_value",
            true,
            "Frame rate must be between 5 and 240.",
        )
        .with_details(json!({ "field": "capture.frameRate", "got": 1000 }));
        let value = serde_json::to_value(err.to_ipc()).expect("serialize");
        assert_eq!(
            value,
            json!({
                "kind": "settings",
                "code": "settings.invalid_value",
                "retryable": true,
                "userMessage": "Frame rate must be between 5 and 240.",
                "details": { "field": "capture.frameRate", "got": 1000 }
            })
        );
    }

    #[test]
    fn details_default_to_null_and_kinds_map() {
        let err = CoreError::pipewire("pipewire.stream_lost", true, "The capture stream ended.");
        let value = serde_json::to_value(err.to_ipc()).expect("serialize");
        assert_eq!(value["details"], serde_json::Value::Null);
        assert_eq!(value["kind"], "pipewire");
        assert_eq!(value["retryable"], true);

        let disk = CoreError::disk(
            "disk.no_space",
            false,
            "Not enough free space to save the recording.",
        );
        assert_eq!(serde_json::to_value(disk.to_ipc()).unwrap()["kind"], "disk");
    }

    #[test]
    fn display_is_log_friendly_not_ui_copy() {
        // Raw Display output is for tracing; userMessage stays separate (§7.9).
        let err = CoreError::portal(
            "portal.denied",
            false,
            "Screen capture permission was declined.",
        );
        assert!(err.to_string().starts_with("portal.denied:"));
    }
}
