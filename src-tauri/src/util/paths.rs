use std::path::PathBuf;

/* XDG path resolution — ARCHITECTURE §5.3 is the exhaustive env-var list:
SSP_CONFIG_DIR / SSP_DATA_DIR override the XDG defaults; SSP_LOG_* join
with the 0.9 tracing task. Linux-only app: $HOME is the documented base. */

const APP_SUBDIR: &str = "screen-studio-pro";

fn home_dir() -> PathBuf {
    // Linux session always defines HOME; fall back to / for safety, never panic.
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Config dir for `settings.toml` (§5.3: `SSP_CONFIG_DIR` overrides).
pub fn config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SSP_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".config"));
    base.join(APP_SUBDIR)
}

/// Data dir for the library database (§5.3: `SSP_DATA_DIR` overrides;
/// consumed by the 0.8 store).
#[allow(dead_code)] // wired when library/store.rs lands (task 0.8)
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SSP_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".local/share"));
    base.join(APP_SUBDIR)
}

/// Default save directory for recordings (PRD §7.5 Files group / M9:
/// write under the user's Videos). `user-dirs.dirs` localization parsing
/// joins with task 1.3 if a distro ships exotic paths.
pub fn videos_dir() -> PathBuf {
    std::env::var_os("XDG_VIDEOS_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join("Videos"))
        .join(APP_SUBDIR)
}

#[cfg(test)]
mod tests {
    use super::*;

    // set_var is unsafe in edition 2024 and env mutation races across the
    // test pool — every env-touching test in this module holds this lock.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn ssp_config_dir_override_wins() {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        // SAFETY: single-threaded wrt these vars via ENV_LOCK; test process.
        unsafe { std::env::set_var("SSP_CONFIG_DIR", tmp.path()) };
        assert_eq!(config_dir(), tmp.path());
        unsafe { std::env::remove_var("SSP_CONFIG_DIR") };
    }

    #[test]
    fn config_dir_falls_under_xdg_or_home() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::remove_var("SSP_CONFIG_DIR") };
        unsafe { std::env::remove_var("XDG_CONFIG_HOME") };
        let dir = config_dir();
        assert!(dir.starts_with(home_dir()));
        assert!(dir.ends_with(".config/screen-studio-pro"));
    }
}
