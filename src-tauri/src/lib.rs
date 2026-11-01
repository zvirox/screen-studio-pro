mod capture;
mod ipc;
mod library;
mod settings;
mod util;

use tauri::Manager;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/* Tracing bootstrapping — ARCHITECTURE §5.3 defines the whole env surface:
SSP_LOG_LEVEL (default info) and SSP_LOG_FILE (default: daily-rotated log
in the XDG state dir). Both layers (stdout + file) share the filter; raw
error chains live here, never in the UI (DESIGN §7.9). */

/// Level from `SSP_LOG_LEVEL` (§5.3: trace/debug/info/warn/error); anything
/// unparseable falls back to info. A plain LevelFilter — the env var carries
/// bare levels only, no directive syntax.
fn log_level() -> tracing::Level {
    match std::env::var("SSP_LOG_LEVEL").as_deref() {
        Ok("trace") => tracing::Level::TRACE,
        Ok("debug") => tracing::Level::DEBUG,
        Ok("warn") => tracing::Level::WARN,
        Ok("error") => tracing::Level::ERROR,
        _ => tracing::Level::INFO,
    }
}

/// Fallible file writer: the exact `SSP_LOG_FILE` path (no rotation) or a
/// daily-rotated log in the XDG state dir. `Err` = unusable path — callers
/// continue stdout-only, never panic the boot.
fn build_file_appender() -> Result<tracing_appender::rolling::RollingFileAppender, std::io::Error> {
    use tracing_appender::rolling::{Builder, Rotation};
    let mut builder = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("screen-studio-pro.log");
    let mut dir = util::paths::state_dir();
    if let Some(file) = std::env::var_os("SSP_LOG_FILE") {
        let path = std::path::PathBuf::from(file);
        let file_name = path
            .file_name()
            .map(std::ffi::OsStr::to_owned)
            .ok_or_else(|| std::io::Error::other("SSP_LOG_FILE is not a file path"))?;
        dir = path
            .parent()
            .unwrap_or(std::path::Path::new("/"))
            .to_owned();
        builder = builder
            .rotation(Rotation::NEVER)
            .filename_prefix(file_name.to_string_lossy().as_ref());
    }
    builder
        .build(dir)
        .map_err(|err| std::io::Error::other(err.to_string()))
}

/// Init once; the non-blocking worker guard must outlive the app, so it is
/// intentionally leaked (app-wide lifetime, one-time cost).
fn init_tracing() {
    let level = log_level();
    let stdout_layer = tracing_subscriber::fmt::layer().with_writer(std::io::stdout);

    let file_layer = match build_file_appender() {
        Ok(appender) => {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            std::boxed::Box::leak(Box::new(guard));
            Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(writer),
            )
        }
        Err(err) => {
            eprintln!(
                "warning: log file unusable ({}); continuing with stdout logging only",
                err
            );
            None
        }
    };

    tracing_subscriber::registry()
        .with(tracing_subscriber::filter::LevelFilter::from_level(level))
        .with(stdout_layer)
        .with(file_layer)
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // ARCHITECTURE §4.1: settings cached in Rust at boot. A corrupt
            // or unwritable TOML must not kill the boot — fall back to
            // in-memory defaults; the Settings UI (M10) surfaces recovery.
            let dir = util::paths::config_dir();
            let store = match settings::SettingsStore::load_or_create(&dir) {
                Ok(store) => store,
                Err(err) => {
                    tracing::error!(code = %err.code(), "settings load failed; using in-memory defaults");
                    settings::SettingsStore::from_defaults(&dir)
                }
            };
            app.manage(std::sync::Mutex::new(store));
            // DATABASE §1: the library index lives beside the app data dir.
            app.manage(library::LibraryHandle::open(&util::paths::data_dir()));
            // §2.1: the single active portal session lives in managed state.
            app.manage(capture::CaptureHandle::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::ipc_hello,
            ipc::commands::system_capabilities,
            ipc::commands::settings_get,
            ipc::commands::settings_set,
            ipc::commands::prefs_get,
            ipc::commands::prefs_set,
            ipc::commands::source_select,
            ipc::commands::source_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
