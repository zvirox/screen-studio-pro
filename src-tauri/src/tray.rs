//! Native shell (PRD M12 / DESIGN §5.8, §6.5). Linux tray clicks are
//! compositor-owned, so all actions are available as labeled menu items.
use crate::{
    app_state::{self, Action, Snapshot},
    util::error::CoreError,
};
use tauri::{
    Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

struct Tray {
    status: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    pause: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "tray.status", "Ready", false, None::<&str>)?;
    let show = MenuItem::with_id(
        app,
        "tray.show",
        "Show ScreenStudio Pro",
        true,
        None::<&str>,
    )?;
    let start = MenuItem::with_id(
        app,
        "tray.start",
        "Start recording (select a source first)",
        false,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(app, "tray.pause", "Pause", false, None::<&str>)?;
    // Native menu labels use & for mnemonics; escape the visible ampersand.
    let stop = MenuItem::with_id(app, "tray.stop", "Stop && save", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray.quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &show,
            &PredefinedMenuItem::separator(app)?,
            &start,
            &pause,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("screen-studio-pro")
        .menu(&menu)
        .title("ScreenStudio Pro")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray.show" => restore(app),
            "tray.quit" => app_state::dispatch(app, Action::Quit),
            #[cfg(feature = "encode")]
            "tray.start" => app_state::dispatch(
                app,
                Action::Start {
                    source_id: None,
                    output_dir: None,
                },
            ),
            #[cfg(feature = "encode")]
            "tray.pause" => app_state::dispatch(app, Action::TogglePause),
            #[cfg(feature = "encode")]
            "tray.stop" => app_state::dispatch(app, Action::Stop(None)),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(Tray {
        status,
        start,
        pause,
        stop,
        quit,
    });
    Ok(())
}

pub fn busy(app: &tauri::AppHandle) {
    if let Some(tray) = app.try_state::<Tray>() {
        let result = (|| -> tauri::Result<()> {
            tray.status.set_text("Working…")?;
            for item in [&tray.start, &tray.pause, &tray.stop, &tray.quit] {
                item.set_enabled(false)?;
            }
            Ok(())
        })();
        if let Err(err) = result {
            tracing::warn!(error = %err, "tray busy state failed");
        }
    }
}

/// Pure presentation policy, shared by the native menu and its state tests.
fn menu_state(s: &Snapshot) -> (&'static str, bool, bool, bool) {
    let active = s.recording_id.is_some();
    let label = if s.pending {
        "Save needs retry"
    } else if s.ended {
        "Recording ended — stop to finish"
    } else if s.paused {
        "Paused"
    } else if active {
        "Recording"
    } else {
        "Ready"
    };
    (
        label,
        cfg!(feature = "encode") && s.source_ready && !active && !s.pending,
        active && !s.ended,
        active || s.pending,
    )
}

pub fn update(app: &tauri::AppHandle, s: &Snapshot) {
    if let Some(tray) = app.try_state::<Tray>() {
        let (label, start, pause, stop) = menu_state(s);
        let result = (|| -> tauri::Result<()> {
            tray.status.set_text(label)?;
            tray.start.set_text(if s.source_ready {
                "Start recording"
            } else {
                "Start recording (select a source first)"
            })?;
            tray.start.set_enabled(start)?;
            tray.pause
                .set_text(if s.paused { "Resume" } else { "Pause" })?;
            tray.pause.set_enabled(pause)?;
            tray.stop.set_text(if s.pending {
                "Retry save"
            } else {
                "Stop && save"
            })?;
            tray.stop.set_enabled(stop)?;
            tray.quit.set_enabled(true)?;
            Ok(())
        })();
        if let Err(err) = result {
            tracing::warn!(error = %err, "tray state update failed");
        }
    }
}

pub fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let result = window
            .show()
            .and_then(|_| window.unminimize())
            .and_then(|_| window.set_focus());
        if let Err(err) = result {
            tracing::warn!(error = %err, "main window restore failed");
        }
    }
}

pub fn report(app: &tauri::AppHandle, error: &CoreError, recording_active: bool) {
    use tauri::Emitter;
    tracing::error!(code = %error.code(), "native shell action failed");
    let _ = app.emit_to(
        "main",
        crate::ipc::events::topic::SHELL_ERROR,
        crate::ipc::events::ShellError {
            error: error.to_ipc(),
            recording_active,
        },
    );
}

pub fn hide(app: &tauri::AppHandle, host: bool) -> Result<(), CoreError> {
    if !host || app.try_state::<Tray>().is_none() {
        return Err(CoreError::ipc(
            "ipc.tray_unavailable",
            true,
            "Your desktop has no available system tray. Keep this window open to control recording.",
        ));
    }
    let window = app.get_webview_window("main").ok_or_else(window_error)?;
    window.hide().map_err(|err| {
        tracing::warn!(error = %err, "main window hide failed");
        window_error()
    })
}

fn window_error() -> CoreError {
    CoreError::ipc(
        "ipc.window_failed",
        true,
        "The window could not be hidden. Keep it open to control recording.",
    )
}

/// A successfully constructed AppIndicator does not prove a tray exists
/// (e.g. GNOME without an extension). Check the host before EVERY hide.
pub async fn host_available() -> bool {
    let probe = async {
        let connection = ashpd::zbus::Connection::session().await.ok()?;
        let proxy = ashpd::zbus::Proxy::new(
            &connection,
            "org.kde.StatusNotifierWatcher",
            "/StatusNotifierWatcher",
            "org.kde.StatusNotifierWatcher",
        )
        .await
        .ok()?;
        proxy
            .get_property::<bool>("IsStatusNotifierHostRegistered")
            .await
            .ok()
    };
    // Bounded shell-service lookup, not an event cadence (ARCHITECTURE §6).
    tokio::time::timeout(std::time::Duration::from_secs(2), probe)
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
}

pub fn close_to_tray(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let host = host_available().await;
        let _ = app_state::run(
            app,
            Action::Hide {
                recording_id: None,
                host,
            },
            true,
        )
        .await;
    });
}

#[cfg(all(test, feature = "encode"))]
mod tests {
    use super::*;

    #[test]
    fn menu_only_offers_actions_valid_for_the_session() {
        let mut state = Snapshot::default();
        assert_eq!(menu_state(&state), ("Ready", false, false, false));
        state.source_ready = true;
        assert_eq!(menu_state(&state), ("Ready", true, false, false));
        state.recording_id = Some("rec_1".into());
        assert_eq!(menu_state(&state), ("Recording", false, true, true));
        state.paused = true;
        assert_eq!(menu_state(&state), ("Paused", false, true, true));
        state.ended = true;
        assert_eq!(
            menu_state(&state),
            ("Recording ended — stop to finish", false, false, true)
        );
        state.recording_id = None;
        state.pending = true;
        assert_eq!(menu_state(&state), ("Save needs retry", false, false, true));
    }
}
