//! Shared IPC/tray lifecycle (ARCHITECTURE §4.1). Only blocking workers take
//! the operation lock: encoder drain and SQLite must never block the GUI.
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

use crate::{capture::CaptureHandle, util::error::CoreError};
#[cfg(feature = "encode")]
use crate::{
    ipc::events,
    library::{LibraryHandle, extract_thumbnail},
    pipeline::session::{RecordingHandle, StopOutcome},
};

#[derive(Default)]
pub struct AppState {
    operations: Mutex<Lifecycle>,
    pub exit_allowed: AtomicBool,
}

#[derive(Default)]
struct Lifecycle {
    // A finalized file survives an index failure. Retrying Quit/Stop must
    // retry the upsert, never call the already-drained encoder again.
    #[cfg(feature = "encode")]
    pending: Option<(String, StopOutcome)>,
}

pub enum Action {
    Refresh,
    Release(String),
    Hide {
        recording_id: Option<String>,
        host: bool,
    },
    Quit,
    #[cfg(feature = "encode")]
    Start {
        source_id: Option<String>,
        output_dir: Option<String>,
        region_rect: Option<crate::capture::RegionRect>,
        camera_id: Option<String>,
    },
    #[cfg(feature = "encode")]
    Pause(String),
    #[cfg(feature = "encode")]
    Resume(String),
    #[cfg(feature = "encode")]
    TogglePause,
    #[cfg(feature = "encode")]
    Stop(Option<String>),
}

pub fn bad_state(message: &'static str) -> CoreError {
    CoreError::ipc("ipc.bad_state", false, message)
}

/// Native callers have no command reply: deliver their error to the main
/// window via shell/error, with the authoritative post-operation liveness.
pub async fn run(
    app: tauri::AppHandle,
    action: Action,
    native: bool,
) -> Result<serde_json::Value, CoreError> {
    let fallback = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut lifecycle = state.operations.lock().unwrap_or_else(|p| p.into_inner());
        if state.exit_allowed.load(Ordering::Acquire) {
            return Err(bad_state("The app is closing."));
        }
        if !matches!(action, Action::Refresh | Action::Hide { .. }) {
            crate::tray::busy(&app);
        }
        let quit = matches!(action, Action::Quit);
        let result = lifecycle.apply(&app, action);
        let snapshot = lifecycle.snapshot(&app);
        crate::tray::update(&app, &snapshot);
        if let Err(err) = &result {
            crate::tray::restore(&app);
            if native {
                crate::tray::report(&app, err, snapshot.recording_id.is_some());
            }
        } else if quit {
            state.exit_allowed.store(true, Ordering::Release);
            app.exit(0);
        }
        result
    })
    .await
    .map_err(|err| {
        tracing::error!(error = %err, "shell worker failed");
        let error = CoreError::ipc(
            "ipc.task_failed",
            false,
            "The action could not finish. The app has stayed open.",
        );
        crate::tray::restore(&fallback);
        if native {
            crate::tray::report(&fallback, &error, true);
        }
        error
    })?
}

pub fn dispatch(app: &tauri::AppHandle, action: Action) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = run(app, action, true).await;
    });
}

#[derive(Default)]
pub struct Snapshot {
    pub source_ready: bool,
    pub recording_id: Option<String>,
    pub paused: bool,
    pub ended: bool,
    pub pending: bool,
}

impl Lifecycle {
    #[cfg(feature = "encode")]
    fn can_start(&self) -> Result<(), CoreError> {
        if self.pending.is_some() {
            return Err(bad_state(
                "Finish saving the previous recording before starting another.",
            ));
        }
        Ok(())
    }

    fn snapshot(&self, app: &tauri::AppHandle) -> Snapshot {
        #[allow(unused_mut)]
        let mut snapshot = Snapshot {
            source_ready: app.state::<CaptureHandle>().is_ready(),
            ..Default::default()
        };
        #[cfg(feature = "encode")]
        {
            if let Some((id, paused, ended)) = app.state::<RecordingHandle>().snapshot() {
                snapshot.recording_id = Some(id);
                snapshot.paused = paused;
                snapshot.ended = ended;
            }
            snapshot.pending = self.pending.is_some();
        }
        snapshot
    }

    fn apply(
        &mut self,
        app: &tauri::AppHandle,
        action: Action,
    ) -> Result<serde_json::Value, CoreError> {
        match action {
            Action::Refresh => {}
            Action::Hide { recording_id, host } => {
                let snapshot = self.snapshot(app);
                if !snapshot.may_hide(recording_id.as_deref()) {
                    return Ok(serde_json::json!({"ok": true}));
                }
                crate::tray::hide(app, host)?;
            }
            Action::Release(id) => {
                #[cfg(feature = "encode")]
                if app.state::<RecordingHandle>().snapshot().is_some() {
                    return Err(CoreError::portal(
                        "portal.busy",
                        false,
                        "Stop the recording before releasing its source.",
                    ));
                }
                release(app, &id)?;
            }
            Action::Quit => {
                #[cfg(feature = "encode")]
                if self.pending.is_some() || app.state::<RecordingHandle>().snapshot().is_some() {
                    self.stop(app, None)?;
                }
                let capture = app.state::<CaptureHandle>();
                if let Some(id) = capture.active_id() {
                    release(app, &id)?;
                }
            }
            #[cfg(feature = "encode")]
            Action::Start {
                source_id,
                output_dir,
                region_rect,
                camera_id,
            } => {
                self.can_start()?;
                let capture = app.state::<CaptureHandle>();
                let rect = region_rect.or_else(|| capture.region_rect());
                let info = start(app, source_id, output_dir, rect, camera_id)?;
                events::recording_started(app, &info);
                return Ok(
                    serde_json::json!({"recordingId": info.recording_id, "status": "recording", "encoder": {"backend": info.encoder.backend, "isHardware": info.encoder.is_hardware}, "startedAt": info.started_at}),
                );
            }
            #[cfg(feature = "encode")]
            Action::Stop(id) => {
                let result = self.stop(app, id);
                crate::tray::restore(app);
                return result;
            }
            #[cfg(feature = "encode")]
            Action::Pause(id) => {
                app.state::<RecordingHandle>().pause(&id)?;
                return Ok(serde_json::json!({"status": "paused"}));
            }
            #[cfg(feature = "encode")]
            Action::Resume(id) => {
                app.state::<RecordingHandle>().resume(&id)?;
                return Ok(serde_json::json!({"status": "recording"}));
            }
            #[cfg(feature = "encode")]
            Action::TogglePause => {
                let recordings = app.state::<RecordingHandle>();
                let (id, paused, _) = recordings
                    .snapshot()
                    .ok_or_else(|| bad_state("No recording is running."))?;
                if paused {
                    recordings.resume(&id)?;
                } else {
                    recordings.pause(&id)?;
                }
            }
        }
        Ok(serde_json::json!({"ok": true}))
    }

    #[cfg(feature = "encode")]
    fn stop(
        &mut self,
        app: &tauri::AppHandle,
        id: Option<String>,
    ) -> Result<serde_json::Value, CoreError> {
        let recordings = app.state::<RecordingHandle>();
        let library = app.state::<LibraryHandle>();
        let stop = AtomicBool::new(false);
        let thumbs_dir = crate::util::paths::data_dir().join("thumbs");
        let _ = std::fs::create_dir_all(&thumbs_dir);
        let mut thumb_path: Option<String> = None;
        let (recording_id, outcome, row_id) = self.finalize(&recordings, id, |outcome| {
            // 5.1: extract a thumbnail from the finalized MKV, non-fatal.
            let tp = extract_thumbnail(&outcome.path, &thumbs_dir, &stop)
                .ok()
                .and_then(|p| p.to_str().map(|s| s.to_string()));
            thumb_path = tp.clone();
            let mut rec = crate::library::FinalizedRecording::from(outcome);
            rec.thumb_path = tp;
            library.record_finalize(&rec)
        })?;
        events::recording_finished(app, &recording_id, &outcome, row_id, thumb_path.clone());
        events::library_updated(app, row_id);
        Ok(serde_json::json!({
            "recording": events::library_recording(&outcome, row_id, thumb_path.clone())
        }))
    }

    #[cfg(feature = "encode")]
    fn finalize(
        &mut self,
        recordings: &RecordingHandle,
        id: Option<String>,
        save: impl FnOnce(&StopOutcome) -> Result<i64, CoreError>,
    ) -> Result<(String, StopOutcome, i64), CoreError> {
        if self.pending.is_none() {
            let id = id
                .or_else(|| recordings.snapshot().map(|s| s.0))
                .ok_or_else(|| bad_state("No recording is running."))?;
            let outcome = recordings.stop(&id)??;
            self.pending = Some((id, outcome));
        } else if let Some(id) = id
            && self.pending.as_ref().map(|p| &p.0) != Some(&id)
        {
            return Err(bad_state("No recording is running with that id."));
        }
        let (id, outcome) = self
            .pending
            .as_ref()
            .expect("successful stop retained its outcome");
        let row_id = save(outcome)?;
        let id = id.clone();
        let (_, outcome) = self.pending.take().expect("saved outcome is owned here");
        Ok((id, outcome, row_id))
    }
}

#[cfg(feature = "encode")]
fn start(
    app: &tauri::AppHandle,
    source_id: Option<String>,
    output_dir: Option<String>,
    region_rect: Option<crate::capture::RegionRect>,
    camera_id: Option<String>,
) -> Result<crate::pipeline::session::StartInfo, CoreError> {
    let capture = app.state::<CaptureHandle>();
    let source = capture
        .active_info()
        .filter(|s| source_id.as_ref().is_none_or(|id| &s.source_id == id))
        .ok_or_else(|| {
            bad_state("Select a capture source before recording (or the source id changed).")
        })?;
    let bus = source
        .frame_bus
        .ok_or_else(|| bad_state("The active source does not produce a recording stream."))?;
    let settings = app
        .state::<Mutex<crate::settings::SettingsStore>>()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get()
        .clone();
    let audio = crate::pipeline::audio::build_audio_plan(&settings.audio)?;
    let dir = output_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(crate::util::paths::videos_dir);
    let sink = std::sync::Arc::new(events::TauriEventSink::new(app.clone()));
    app.state::<RecordingHandle>().start(
        bus,
        source.geometry,
        &dir,
        sink,
        audio,
        region_rect,
        camera_id,
        Some(app),
    )
}

impl Snapshot {
    fn may_hide(&self, recording_id: Option<&str>) -> bool {
        recording_id.is_none_or(|id| self.recording_id.as_deref() == Some(id) && !self.ended)
    }
}

fn release(app: &tauri::AppHandle, id: &str) -> Result<(), CoreError> {
    if let Some(mut source) = app.state::<CaptureHandle>().take(id)? {
        source.stop_frames();
        tauri::async_runtime::block_on(source.close());
    }
    Ok(())
}

#[cfg(all(test, feature = "encode"))]
mod tests {
    use super::*;
    use crate::pipeline::{
        Frame, FrameBus, FrameLayout, Push,
        stats::{EventSink, SessionEvent},
    };
    use std::sync::Arc;

    struct Sink;
    impl EventSink for Sink {
        fn emit(&self, _: SessionEvent) {}
    }

    fn take(dir: &std::path::Path) -> (RecordingHandle, String) {
        let recordings = RecordingHandle::new();
        let bus = Arc::new(FrameBus::new(16));
        let info = recordings
            .start(
                bus.clone(),
                (64, 64),
                dir,
                Arc::new(Sink),
                None,
                None,
                None,
                None,
            )
            .expect("start");
        for n in 0..8 {
            assert!(matches!(
                bus.try_push(Frame {
                    width: 64,
                    height: 64,
                    stride: 256,
                    layout: FrameLayout::Bgrx,
                    pts_us: n * 16_666,
                    data: vec![n as u8; 64 * 64 * 4],
                }),
                Push::Pushed
            ));
        }
        (recordings, info.recording_id)
    }

    fn save(library: &LibraryHandle, outcome: &StopOutcome) -> Result<i64, CoreError> {
        library.record_finalize(&crate::library::FinalizedRecording::from(outcome))
    }

    #[test]
    fn finalize_commits_a_real_take_and_keeps_it_on_index_failure() {
        let dir = tempfile::tempdir().expect("temp");
        let library = LibraryHandle::open(dir.path());
        let (recordings, id) = take(dir.path());
        let mut lifecycle = Lifecycle::default();
        // Wrong id cannot consume the encoder or call the index writer.
        assert_eq!(
            lifecycle
                .finalize(&recordings, Some("wrong".into()), |_| panic!(
                    "wrong id saved"
                ))
                .unwrap_err()
                .code(),
            "ipc.bad_state"
        );
        assert!(recordings.snapshot().is_some());
        assert_eq!(
            lifecycle
                .finalize(&recordings, Some(id.clone()), |_| Err(CoreError::disk(
                    "disk.write_failed",
                    true,
                    "Retry save."
                )))
                .unwrap_err()
                .code(),
            "disk.write_failed"
        );
        assert!(recordings.snapshot().is_none());
        assert!(lifecycle.can_start().is_err());
        let path = lifecycle.pending.as_ref().expect("retained").1.path.clone();
        let bytes = std::fs::read(&path).expect("file survives");
        assert_eq!(
            lifecycle
                .finalize(&recordings, Some("wrong".into()), |_| panic!(
                    "wrong id saved"
                ))
                .unwrap_err()
                .code(),
            "ipc.bad_state"
        );
        let (saved_id, outcome, row) = lifecycle
            .finalize(&recordings, None, |outcome| save(&library, outcome))
            .expect("Quit retry");
        assert_eq!(saved_id, id);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(lifecycle.can_start().is_ok());
        let conn = rusqlite::Connection::open(dir.path().join("library.db")).unwrap();
        let stored: (String, String, i64) = conn
            .query_row(
                "SELECT path, status, size_bytes FROM recordings WHERE id = ?1",
                [row],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            (
                outcome.path.display().to_string(),
                "ready".into(),
                outcome.size_bytes as i64
            )
        );
        let probe = ffmpeg_next::format::input(&outcome.path).expect("playable container");
        assert!(
            probe
                .streams()
                .best(ffmpeg_next::media::Type::Video)
                .is_some()
        );
    }

    #[test]
    fn concurrent_stop_and_quit_only_finalize_once() {
        let dir = tempfile::tempdir().unwrap();
        let library = LibraryHandle::open(dir.path());
        let (recordings, id) = take(dir.path());
        let operations = Mutex::new(Lifecycle::default());
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let handles: Vec<_> = [Some(id), None]
                .into_iter()
                .map(|id| {
                    let (operations, recordings, library, barrier) =
                        (&operations, &recordings, &library, &barrier);
                    scope.spawn(move || {
                        barrier.wait();
                        operations
                            .lock()
                            .unwrap()
                            .finalize(recordings, id, |outcome| save(library, outcome))
                    })
                })
                .collect();
            let successes = handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .filter(Result::is_ok)
                .count();
            assert_eq!(successes, 1);
        });
        let conn = rusqlite::Connection::open(dir.path().join("library.db")).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM recordings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert!(recordings.snapshot().is_none());
    }

    #[test]
    fn auto_hide_rejects_stale_ended_and_pending_takes() {
        let mut state = Snapshot {
            recording_id: Some("rec_1".into()),
            ..Default::default()
        };
        assert!(state.may_hide(Some("rec_1")));
        assert!(!state.may_hide(Some("old")));
        state.ended = true;
        assert!(!state.may_hide(Some("rec_1")));
        state.recording_id = None;
        state.pending = true;
        assert!(!state.may_hide(Some("rec_1")));
        assert!(state.may_hide(None));
    }
}
