use super::pipewire;
use super::{LiveSource, SourceCapabilities, SourceKind, SourcePreview, SourceSelected};
#[cfg(feature = "encode")]
use crate::pipeline::{DEFAULT_CAPACITY, FrameBus};
use crate::util::error::CoreError;
use ashpd::desktop::screencast::{
    CursorMode, OpenPipeWireRemoteOptions, Screencast, SelectSourcesOptions, SourceType,
    StartCastOptions,
};
use ashpd::desktop::{CreateSessionOptions, PersistMode, ResponseError, Session};
use ashpd::{Error as PortalError, WindowIdentifier, enumflags2::BitFlags};
use std::os::fd::OwnedFd;
#[cfg(feature = "encode")]
use std::sync::Arc;
use std::time::Duration;

/* Portal screencast orchestration (ashpd) — API §2.1 `source_select`,
monitor flavour (PRD M1). Flow: create session → select sources →
start (the consent dialog pauses here) → open the PipeWire remote →
hand the fd to pipewire.rs. Consent pacing belongs to the user, so the
only timeout we impose is generous and maps to `portal.timeout`. */

/// How long the consent dialog may stay open before we call it a timeout.
/// Manual UX means minutes, not milliseconds — 2 minutes, then recoverable.
const CONSENT_TIMEOUT: Duration = Duration::from_secs(120);

/// A live monitor capture session: the ashpd session (for `Close`), the
/// PipeWire consumption guard (for frame teardown), and the encode-tier
/// frame bus (task 1.3 — recordings attach to it via `frame_bus()`).
pub struct MonitorSession {
    source_id: String,
    session: Session<Screencast>,
    stream: pipewire::StreamGuard,
    /// Encode-tier wiring (task 1.3): the frame bus recordings drain and
    /// the negotiated geometry. Only the `encode` feature consumes them —
    /// without it the capture path stays count-only.
    #[cfg(feature = "encode")]
    frame_bus: Arc<FrameBus>,
    #[cfg(feature = "encode")]
    width: u32,
    #[cfg(feature = "encode")]
    height: u32,
}

impl MonitorSession {
    /// Manual-gate hook (PLAN 1.1 verify: ≥ 1 fps in the debug log); the
    /// 1.2 frame bus replaces the counting consumer underneath it.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn frames(&self) -> u64 {
        self.stream.frames()
    }
}

#[async_trait::async_trait]
impl LiveSource for MonitorSession {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn is_live(&self) -> bool {
        self.stream.is_live()
    }

    fn stop_frames(&mut self) {
        // Stop consuming BEFORE closing the portal session so the
        // stream-error path can't race `source/lost` with a deliberate
        // release (release is not a loss).
        self.stream.stop();
    }

    async fn close(&mut self) {
        // Best-effort: an already-dead session still produced a usable
        // stop above; the next select starts a fresh session either way.
        if let Err(err) = self.session.close().await {
            tracing::warn!(%err, "portal session close failed");
        }
    }

    #[cfg(feature = "encode")]
    fn frame_bus(&self) -> Option<Arc<FrameBus>> {
        Some(self.frame_bus.clone())
    }

    #[cfg(feature = "encode")]
    fn geometry(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

/// Orchestrate one monitor capture session. `source_id` comes from the
/// caller (commands) so the `source/lost` closure can name the same
/// session it belongs to. `on_lost` = stream died underneath us.
pub async fn select_monitor(
    source_id: String,
    on_lost: impl FnOnce(&str) + Send + 'static,
) -> Result<(MonitorSession, SourceSelected), CoreError> {
    let screencast = Screencast::new().await.map_err(portal_unavailable)?;

    // Cursor: baked into the stream when the compositor supports it
    // ( Embedded ) else metadata — recording without a cursor is only the
    // last resort. What we got decides the reply's `capabilities.cursor`.
    let modes = screencast
        .available_cursor_modes()
        .await
        .map_err(portal_unavailable)?;
    let (cursor_mode, cursor_capable) = if modes.contains(CursorMode::Embedded) {
        (CursorMode::Embedded, true)
    } else if modes.contains(CursorMode::Metadata) {
        (CursorMode::Metadata, true)
    } else {
        (CursorMode::Hidden, false)
    };

    let session = screencast
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(portal_unavailable)?;

    screencast
        .select_sources(
            &session,
            SelectSourcesOptions::default()
                .set_sources(BitFlags::from(SourceType::Monitor))
                .set_cursor_mode(cursor_mode)
                .set_multiple(false)
                // Transient persistence: reusing the grant within this app
                // run skips repeat dialogs (PRD G3 zero-ceremony), nothing
                // persists to disk — a fresh boot re-consents once.
                .set_persist_mode(PersistMode::Application),
        )
        .await
        .map_err(portal_unavailable)?;

    // The user is the clock here: consent can take a while by design.
    let streams = tokio::time::timeout(
        CONSENT_TIMEOUT,
        screencast.start(
            &session,
            Option::<&WindowIdentifier>::None,
            StartCastOptions::default(),
        ),
    )
    .await
    .map_err(|_| {
        CoreError::portal(
            "portal.timeout",
            true,
            "The capture dialog timed out while waiting for a choice. Click a source to try again.",
        )
    })?
    .and_then(|request| request.response())
    .map_err(portal_error)?;

    let stream = streams.streams().first().ok_or_else(|| {
        CoreError::portal(
            "portal.unavailable",
            true,
            "The portal returned no monitor stream. Click a source to try again.",
        )
    })?;
    let node_id = stream.pipe_wire_node_id();
    let (width, height) = stream.size().ok_or_else(|| {
        CoreError::portal(
            "portal.unavailable",
            true,
            "The portal didn't report the monitor's size. Click a source to try again.",
        )
    })?;
    let (width, height) = (width.max(0) as u32, height.max(0) as u32);

    let remote_fd: OwnedFd = screencast
        .open_pipe_wire_remote(&session, OpenPipeWireRemoteOptions {})
        .await
        .map_err(portal_error)?;

    // The encode-tier bus (1.2): capacity 8 ≈ 133 ms of 1080p at 60 fps
    // — bounded by design (§6 memory law), enough to ride out a stall.
    // Without the `encode` feature there is no consumer, so the capture
    // path stays count-only (header-less sandboxes still work).
    #[cfg(feature = "encode")]
    let frame_bus = Arc::new(FrameBus::new(DEFAULT_CAPACITY));
    #[cfg(feature = "encode")]
    let stream_guard = pipewire::start(
        node_id,
        (width, height),
        remote_fd,
        Some(frame_bus.clone()),
        Box::new(on_lost),
    )?;
    #[cfg(not(feature = "encode"))]
    let stream_guard =
        pipewire::start(node_id, (width, height), remote_fd, None, Box::new(on_lost))?;

    tracing::info!(
        %source_id,
        node_id,
        width,
        height,
        "monitor portal session started"
    );

    let reply = SourceSelected {
        source_id: source_id.clone(),
        kind: SourceKind::Monitor.as_str(),
        // The portal doesn't name outputs; geometry does the disambiguation
        // until the source-picker UI (M2) adds restore tokens.
        label: format!("Monitor ({width}×{height})"),
        capabilities: SourceCapabilities {
            // We offer 60 first (PRD M8 default); the negotiated framerate
            // lands in the frame metadata from task 1.2 onward.
            fps: 60,
            width,
            height,
            cursor: cursor_capable,
            // Region overlay is pipeline cropping (M3) — always offered on
            // top of a monitor session.
            region: true,
        },
        preview: SourcePreview {
            mode: "stills_jpeg",
            fps: 8,
        },
    };

    Ok((
        MonitorSession {
            source_id,
            session,
            stream: stream_guard,
            #[cfg(feature = "encode")]
            frame_bus,
            #[cfg(feature = "encode")]
            width,
            #[cfg(feature = "encode")]
            height,
        },
        reply,
    ))
}

/// Orchestrate one window capture session. Uses the portal's window
/// picker (SourceType::Window) so the user chooses a specific window.
/// Returns `portal.unavailable` if the compositor doesn't offer window
/// capture — callers should treat that as "not supported on this desktop"
/// and hide the Window chip gracefully.
pub async fn select_window(
    source_id: String,
    on_lost: impl FnOnce(&str) + Send + 'static,
) -> Result<(MonitorSession, SourceSelected), CoreError> {
    let screencast = Screencast::new().await.map_err(portal_unavailable)?;

    // Cursor handling mirrors monitor capture — embedded when available.
    let modes = screencast
        .available_cursor_modes()
        .await
        .map_err(portal_unavailable)?;
    let (cursor_mode, cursor_capable) = if modes.contains(CursorMode::Embedded) {
        (CursorMode::Embedded, true)
    } else if modes.contains(CursorMode::Metadata) {
        (CursorMode::Metadata, true)
    } else {
        (CursorMode::Hidden, false)
    };

    let session = screencast
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(portal_unavailable)?;

    screencast
        .select_sources(
            &session,
            SelectSourcesOptions::default()
                .set_sources(BitFlags::from(SourceType::Window))
                .set_cursor_mode(cursor_mode)
                .set_multiple(false)
                .set_persist_mode(PersistMode::Application),
        )
        .await
        .map_err(portal_unavailable)?;

    let streams = tokio::time::timeout(
        CONSENT_TIMEOUT,
        screencast.start(
            &session,
            Option::<&WindowIdentifier>::None,
            StartCastOptions::default(),
        ),
    )
    .await
    .map_err(|_| {
        CoreError::portal(
            "portal.timeout",
            true,
            "The capture dialog timed out while waiting for a choice. Click a window to try again.",
        )
    })?
    .and_then(|request| request.response())
    .map_err(portal_error)?;

    let stream = streams.streams().first().ok_or_else(|| {
        CoreError::portal(
            "portal.unavailable",
            true,
            "The portal returned no window stream. Click a window to try again.",
        )
    })?;
    let node_id = stream.pipe_wire_node_id();
    let (width, height) = stream.size().ok_or_else(|| {
        CoreError::portal(
            "portal.unavailable",
            true,
            "The portal didn't report the window's size. Click a window to try again.",
        )
    })?;
    let (width, height) = (width.max(0) as u32, height.max(0) as u32);

    let remote_fd: OwnedFd = screencast
        .open_pipe_wire_remote(&session, OpenPipeWireRemoteOptions {})
        .await
        .map_err(portal_error)?;

    #[cfg(feature = "encode")]
    let frame_bus = Arc::new(FrameBus::new(DEFAULT_CAPACITY));
    #[cfg(feature = "encode")]
    let stream_guard = pipewire::start(
        node_id,
        (width, height),
        remote_fd,
        Some(frame_bus.clone()),
        Box::new(on_lost),
    )?;
    #[cfg(not(feature = "encode"))]
    let stream_guard =
        pipewire::start(node_id, (width, height), remote_fd, None, Box::new(on_lost))?;

    tracing::info!(
        %source_id,
        node_id,
        width,
        height,
        "window portal session started"
    );

    let reply = SourceSelected {
        source_id: source_id.clone(),
        kind: SourceKind::Window.as_str(),
        label: format!("Window ({width}×{height})"),
        capabilities: SourceCapabilities {
            fps: 60,
            width,
            height,
            cursor: cursor_capable,
            region: true,
        },
        preview: SourcePreview {
            mode: "stills_jpeg",
            fps: 8,
        },
    };

    Ok((
        MonitorSession {
            source_id,
            session,
            stream: stream_guard,
            #[cfg(feature = "encode")]
            frame_bus,
            #[cfg(feature = "encode")]
            width,
            #[cfg(feature = "encode")]
            height,
        },
        reply,
    ))
}

/// ashpd → CoreError: the user said no, or the portal is unusable.
fn portal_error(err: PortalError) -> CoreError {
    match err {
        PortalError::Response(ResponseError::Cancelled) => CoreError::portal(
            "portal.denied",
            false,
            "Screen capture permission was declined. Click a source to try again.",
        ),
        _ => portal_unavailable(err),
    }
}

fn portal_unavailable(err: PortalError) -> CoreError {
    // Raw cause → tracing only; the UI gets §7.9 copy (ARCHITECTURE §4.2).
    tracing::error!(error = %err, "portal screencast failure");
    CoreError::portal(
        "portal.unavailable",
        true,
        "ScreenStudio Pro couldn't reach the system's screen-capture portal.",
    )
}

/* ---------- manual gate (TESTING §1: portals are manual-gate heavy) ---------- */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::new_source_id;

    /// PLAN 1.1 verify, run by hand on a live desktop:
    ///
    /// ```sh
    /// SSP_LOG_LEVEL=debug cargo test --manifest-path src-tauri/Cargo.toml \
    ///   manual_consent_frame_floor -- --ignored --nocapture
    /// ```
    ///
    /// A consent dialog appears; approve it. Assertions: the portal returns
    /// a stream, frames flow at ≥ 1 fps, and release tears everything down.
    /// Frame accounting lives in Rust only — nothing here crosses the IPC.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "manual gate: needs a live portal + a human consent click"]
    async fn manual_consent_frame_floor() {
        // Tests don't run the app's tracing bootstrapping; wire fmt straight
        // to the test writer so --nocapture shows the §6 cadence logs (the
        // 1 Hz fps lines are part of the PLAN 1.1 verify evidence).
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_test_writer()
            .try_init();

        let source_id = new_source_id();
        let lost_id = source_id.clone();
        let (session, reply) = select_monitor(source_id.clone(), move |reason| {
            tracing::error!(source = %lost_id, reason, "capture source lost during manual gate");
        })
        .await
        .expect("portal consent + stream");

        assert_eq!(reply.kind, "monitor");
        assert!(reply.capabilities.width > 0 && reply.capabilities.height > 0);

        // ≥ 8 frames in 8 seconds ≈ ≥ 1 fps sustained (PLAN 1.1).
        tokio::time::sleep(Duration::from_secs(8)).await;
        let frames = session.frames();
        tracing::info!(frames, "manual gate: frames received");
        assert!(frames >= 8, "expected at least 1 fps for 8s, got {frames}");

        let mut session = session;
        session.stop_frames();
        session.close().await;
    }
}
