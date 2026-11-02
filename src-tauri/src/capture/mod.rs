pub mod pipewire;
pub mod portal;

use crate::util::error::CoreError;
use serde::Serialize;
use std::sync::Mutex;

/* Source capture origin — API §2.1. One portal session at a time; frame
consumption stays on the Rust side of the IPC boundary (API §6: frames
never travel as IPC payloads — previews are stills at a documented
cadence, landing with the Record view in 1.5). */

/// §2.1 source kinds. `monitor` is live in 1.1; `window`/`region` join
/// with M2/M3 and are rejected until then (`capture.invalid_kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Monitor,
    Window,
    Region,
}

impl SourceKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "monitor" => Some(Self::Monitor),
            "window" => Some(Self::Window),
            "region" => Some(Self::Region),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Monitor => "monitor",
            Self::Window => "window",
            Self::Region => "region",
        }
    }
}

/* ---------- §2.1 reply shapes (serde mirror of the contract) ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCapabilities {
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub cursor: bool,
    pub region: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreview {
    /// §2.1: the preview channel is stills-only (§6 media law).
    pub mode: &'static str,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSelected {
    pub source_id: String,
    pub kind: &'static str,
    pub label: String,
    pub capabilities: SourceCapabilities,
    pub preview: SourcePreview,
}

/* ---------- the capture seam (ARCHITECTURE §2 tree) ---------- */

/// One live capture session. `MonitorSession` (portal.rs) is the 1.1 impl;
/// window/region/camera sources implement this as their features land —
/// no speculative methods.
#[async_trait::async_trait]
pub trait LiveSource: Send {
    fn source_id(&self) -> &str;
    /// End frame consumption (sync — joins the PipeWire data thread).
    fn stop_frames(&mut self);
    /// Close the portal session itself (async, best-effort).
    async fn close(&mut self);
    /// The encode-tier frame bus this source feeds, if it produces one.
    /// Recordings attach their session drain to THIS bus (not a slot
    /// re-fetch) so a stop/start cycle needs no bus re-lookup.
    #[cfg(feature = "encode")]
    fn frame_bus(&self) -> Option<std::sync::Arc<crate::pipeline::FrameBus>> {
        None
    }
    /// Negotiated capture geometry (even-dim clamping happens downstream
    /// in the recording session; the raw portal size is the truth here).
    #[cfg(feature = "encode")]
    fn geometry(&self) -> (u32, u32) {
        (0, 0)
    }
}

/* ---------- the single-session slot (§2.1 portal.busy rule) ---------- */

/// What `active_info` hands the recording session: id, the encode-tier
/// bus (if the source produces frames), and the negotiated geometry.
#[cfg(feature = "encode")]
pub struct ActiveCaptureInfo {
    pub source_id: String,
    pub frame_bus: Option<std::sync::Arc<crate::pipeline::FrameBus>>,
    pub geometry: (u32, u32),
}

/// Managed state: at most one live capture session. The slot reserves
/// during the (long, user-paced) portal consent await so a second
/// `source_select` sees `portal.busy` instead of racing two dialogs.
pub struct CaptureHandle {
    slot: Mutex<Slot>,
}

enum Slot {
    Free,
    Starting,
    Active(Box<dyn LiveSource>),
}

impl CaptureHandle {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(Slot::Free),
        }
    }

    /// Free → Starting, or `portal.busy`.
    pub fn begin(&self) -> Result<(), CoreError> {
        let mut slot = self.locked();
        if !matches!(*slot, Slot::Free) {
            return Err(CoreError::portal(
                "portal.busy",
                false,
                "A capture session is already running. Stop it before starting another.",
            ));
        }
        *slot = Slot::Starting;
        Ok(())
    }

    /// Starting → Active (call after the portal flow succeeded).
    pub fn commit(&self, source: Box<dyn LiveSource>) {
        let mut slot = self.locked();
        if let Slot::Starting = *slot {
            *slot = Slot::Active(source);
        }
    }

    /// Starting → Free (call after the portal flow failed).
    pub fn abort(&self) {
        let mut slot = self.locked();
        if let Slot::Starting = *slot {
            *slot = Slot::Free;
        }
    }

    /// Active(+matching id) → hands the session back for teardown, leaving
    /// the slot Free. Starting, or a different active id → `portal.busy`.
    /// Free → `None` (release is idempotent — §2.1 defines no error for a
    /// session that was never there).
    pub fn take(&self, source_id: &str) -> Result<Option<Box<dyn LiveSource>>, CoreError> {
        let mut slot = self.locked();
        match &*slot {
            Slot::Free => Ok(None),
            Slot::Starting => Err(CoreError::portal(
                "portal.busy",
                false,
                "A capture session is still starting — try again in a moment.",
            )),
            Slot::Active(source) => {
                if source.source_id() == source_id {
                    match std::mem::replace(&mut *slot, Slot::Free) {
                        Slot::Active(source) => Ok(Some(source)),
                        _ => unreachable!("slot matched Active above"),
                    }
                } else {
                    Err(CoreError::portal(
                        "portal.busy",
                        false,
                        "A different capture session is active. Stop that one first.",
                    ))
                }
            }
        }
    }

    /// Snapshot of the active session for the recording session lookup
    /// (API §2.3: `recording_start` binds to the active `sourceId`).
    /// `None` = nothing active; a `Starting` slot reads as None because a
    /// recording cannot attach to a source the user has not confirmed.
    #[cfg(feature = "encode")]
    pub fn active_info(&self) -> Option<ActiveCaptureInfo> {
        let slot = self.locked();
        match &*slot {
            Slot::Active(source) => Some(ActiveCaptureInfo {
                source_id: source.source_id().to_owned(),
                frame_bus: source.frame_bus(),
                geometry: source.geometry(),
            }),
            _ => None,
        }
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, Slot> {
        // A panic holding the slot leaves plain state — recover (§6.4).
        self.slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    fn slot_name(&self) -> &'static str {
        match &*self.locked() {
            Slot::Free => "free",
            Slot::Starting => "starting",
            Slot::Active(_) => "active",
        }
    }
}

impl Default for CaptureHandle {
    fn default() -> Self {
        Self::new()
    }
}

/// Source ids: `src_` + monotonic timestamp hex + a rollover counter —
/// unique under any clock, sortable by creation.
pub fn new_source_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed) & 0xffff;
    format!("src_{nanos:x}{counter:04x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    /// Test double for the LiveSource slot — the real one needs a portal.
    struct FakeSource {
        id: String,
        stopped: std::sync::Arc<std::sync::atomic::AtomicBool>,
    }

    #[async_trait::async_trait]
    impl LiveSource for FakeSource {
        fn source_id(&self) -> &str {
            &self.id
        }
        fn stop_frames(&mut self) {
            self.stopped.store(true, Ordering::Relaxed);
        }
        async fn close(&mut self) {}
    }

    fn fake(id: &str) -> (FakeSource, std::sync::Arc<std::sync::atomic::AtomicBool>) {
        let stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        (
            FakeSource {
                id: id.to_string(),
                stopped: stopped.clone(),
            },
            stopped,
        )
    }

    #[test]
    fn begin_is_busy_while_active_or_starting_and_free_after_abort() {
        let handle = CaptureHandle::new();
        handle.begin().expect("first begin");
        assert_eq!(
            handle.begin().unwrap_err().code(),
            "portal.busy",
            "second concurrent begin must be busy"
        );
        handle.abort();
        handle.begin().expect("begin after abort");
        handle.abort();
    }

    #[test]
    fn commit_only_lands_from_starting_and_take_releases_the_matching_id() {
        let handle = CaptureHandle::new();

        // commit while Free is a no-op
        let (source, _stopped_a) = fake("src_a");
        handle.commit(Box::new(source));
        assert_eq!(handle.slot_name(), "free");

        handle.begin().expect("begin reserved");
        assert_eq!(handle.slot_name(), "starting");
        // release during start = still busy, nothing handed back
        assert!(handle.take("src_a").is_err(), "take during Starting");
        assert_eq!(handle.slot_name(), "starting");

        let (source, stopped_b) = fake("src_a");
        handle.commit(Box::new(source));
        assert_eq!(handle.slot_name(), "active");

        // Wrong id → busy, slot stays.
        assert!(handle.take("src_b").is_err(), "wrong id is busy");
        assert_eq!(handle.slot_name(), "active");

        let mut returned = handle.take("src_a").expect("matched id").expect("some");
        assert_eq!(returned.source_id(), "src_a");
        returned.stop_frames();
        assert!(stopped_b.load(Ordering::Relaxed), "stop_frames ran");
        assert_eq!(handle.slot_name(), "free");
    }

    #[test]
    fn take_on_a_free_slot_is_idempotent_none() {
        let handle = CaptureHandle::new();
        assert!(handle.take("src_any").expect("free slot").is_none());
    }

    #[test]
    fn close_is_reachable_through_the_trait_seam() {
        let handle = CaptureHandle::new();
        handle.begin().unwrap();
        let (source, stopped) = fake("src_x");
        handle.commit(Box::new(source));
        let mut source = handle.take("src_x").expect("take").expect("some");
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("test runtime")
            .block_on(source.close());
        // The fake close is a no-op; the assertion is that the seam compiles
        // and the session object is still usable for stop after close.
        source.stop_frames();
        assert!(stopped.load(Ordering::Relaxed));
    }

    #[test]
    fn source_ids_are_prefixed_and_unique() {
        let a = new_source_id();
        let b = new_source_id();
        assert!(a.starts_with("src_"));
        assert_ne!(a, b, "consecutive ids differ (counter disambiguates)");
    }

    #[test]
    fn source_kind_parses_only_contract_kinds() {
        assert_eq!(SourceKind::parse("monitor"), Some(SourceKind::Monitor));
        assert_eq!(SourceKind::parse("window"), Some(SourceKind::Window));
        assert_eq!(SourceKind::parse("region"), Some(SourceKind::Region));
        assert!(SourceKind::parse("camera").is_none());
        assert_eq!(SourceKind::Monitor.as_str(), "monitor");
    }
}
