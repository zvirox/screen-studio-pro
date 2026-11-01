use tauri::Manager;

mod ipc;
mod library;
mod settings;
mod util;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::ipc_hello,
            ipc::commands::system_capabilities,
            ipc::commands::settings_get,
            ipc::commands::settings_set,
            ipc::commands::prefs_get,
            ipc::commands::prefs_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
