use crate::util::error::CoreError;
use rusqlite::Connection;
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

/* Library index — DATABASE.md is the law: SQLite via rusqlite, WAL journal,
hand-rolled `PRAGMA user_version` migrations over embedded .sql files
(§1, §8). Files live on disk; the DB is an index, never a data warehouse.

§6 role split: this 0.8 connection serves the UI commands (prefs). The
pipeline's dedicated writer connection joins with task 1.6 — until then
one Mutex<Connection> is the honest shape. §6.3: every query is
parameterized; no string-built SQL. */

/// Allowed `ui_prefs` key namespaces (DATABASE §2.2/§3: hud.*, pip.*, last.*).
const PREF_NAMESPACES: [&str; 3] = ["hud.", "pip.", "last."];

/// (version, sql) applied in ascending order — §8: order is the identity.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../sql/0001_recordings.sql")),
    (2, include_str!("../../sql/0002_ui_prefs.sql")),
];

/// Open the connection and set session pragmas (§1/§6.4).
fn open_connection(path: &Path) -> Result<Connection, CoreError> {
    let conn = Connection::open(path).map_err(db_error)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    conn.busy_timeout(std::time::Duration::from_millis(500))
        .map_err(db_error)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(db_error)?;
    Ok(conn)
}

fn db_error(err: rusqlite::Error) -> CoreError {
    // §6.1: the library index is private metadata — failures are disk-family.
    tracing::error!(error = %err, "library db failure");
    CoreError::disk(
        "disk.write_failed",
        true,
        "ScreenStudio Pro can't access its recordings library on disk.",
    )
}

/// §8 runner: apply pending migrations in order. Each one runs inside a
/// single transaction that ALSO bumps `user_version`, so a failed migration
/// leaves the version at the last good step with no partial schema.
fn migrate(conn: &Connection) -> Result<(), CoreError> {
    migrate_with(conn, MIGRATIONS)
}

fn migrate_with(conn: &Connection, migrations: &[(i64, &str)]) -> Result<(), CoreError> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(db_error)?;
    for &(version, sql) in migrations {
        if version <= current {
            continue;
        }
        conn.execute_batch(&format!(
            "BEGIN; {sql}; PRAGMA user_version = {version}; COMMIT;"
        ))
        .map_err(|err| {
            tracing::error!(version, error = %err, "library migration failed");
            let _ = conn.execute_batch("ROLLBACK;");
            db_error(err)
        })?;
    }
    Ok(())
}

/// Shared handle for the managed state. `None` = the store failed to open
/// at boot — commands degrade to a typed error instead of crashing the app.
pub struct LibraryHandle(Option<LibraryStore>);

impl LibraryHandle {
    pub fn open(data_dir: &Path) -> Self {
        match LibraryStore::open(data_dir) {
            Ok(store) => Self(Some(store)),
            Err(err) => {
                tracing::error!(code = %err.code(), "library store unavailable at boot");
                Self(None)
            }
        }
    }

    pub fn unavailable_error() -> CoreError {
        CoreError::disk(
            "disk.write_failed",
            true,
            "The recordings library is unavailable. Restart the app to retry.",
        )
    }

    fn with_store<T>(
        &self,
        f: impl FnOnce(&LibraryStore) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let store = self.0.as_ref().ok_or_else(Self::unavailable_error)?;
        f(store)
    }

    /// API §2.6 `prefs_get`: one key, or all keys when `key` is empty.
    pub fn prefs_get(&self, key: &str) -> Result<Value, CoreError> {
        self.with_store(|store| store.prefs_get(key))
    }

    /// API §2.6 `prefs_set`: validated upsert, echoes {key, value}.
    pub fn prefs_set(&self, key: &str, value: &Value) -> Result<Value, CoreError> {
        self.with_store(|store| store.prefs_set(key, value))
    }
}

pub struct LibraryStore {
    conn: Mutex<Connection>,
}

impl LibraryStore {
    pub fn open(data_dir: &Path) -> Result<Self, CoreError> {
        std::fs::create_dir_all(data_dir).map_err(|_| {
            CoreError::disk(
                "disk.path_unwritable",
                false,
                "ScreenStudio Pro can't create its data folder. Check the folder's permissions.",
            )
        })?;
        let path = data_dir.join("library.db");
        let conn = open_connection(&path)?;
        set_owner_only(&path);
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn prefs_get(&self, key: &str) -> Result<Value, CoreError> {
        let conn = self.lock();
        if key.is_empty() {
            let mut stmt = conn
                .prepare("SELECT key, value_json FROM ui_prefs ORDER BY key")
                .map_err(db_error)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(db_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db_error)?;
            let prefs = rows
                .into_iter()
                .map(|(k, json)| {
                    // §2.2: rows are app-written JSON; a corrupt row degrades
                    // to null rather than failing the whole listing.
                    serde_json::json!({ "key": k, "value": parse_json(&json).unwrap_or(Value::Null) })
                })
                .collect::<Vec<_>>();
            Ok(serde_json::json!({ "prefs": prefs }))
        } else {
            let json: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM ui_prefs WHERE key = ?1",
                    [key],
                    |row| row.get(0),
                )
                .map_err(db_error)
                .ok();
            Ok(serde_json::json!({
                "key": key,
                // Unknown keys read as null — prefs are optional by design.
                "value": json.as_deref().and_then(parse_json).unwrap_or(Value::Null),
            }))
        }
    }

    fn prefs_set(&self, key: &str, value: &Value) -> Result<Value, CoreError> {
        if !PREF_NAMESPACES.iter().any(|ns| key.starts_with(ns)) {
            return Err(CoreError::settings(
                "settings.invalid_value",
                false,
                "That preference key isn't recognized.",
            ));
        }
        // §2.2: value_json is a single valid JSON value — Value IS that guarantee.
        let json = value.to_string();
        let conn = self.lock();
        // §2.2 note: app-maintained timestamps; created_at wins on first write.
        conn.execute(
            "INSERT INTO ui_prefs (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')",
            rusqlite::params![key, json],
        )
        .map_err(db_error)?;
        Ok(serde_json::json!({ "key": key, "value": value }))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic while holding the connection would poison the mutex; the
        // connection itself stays usable — recover it.
        self.conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn parse_json(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok()
}

#[cfg(unix)]
fn set_owner_only(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn open_tmp() -> (tempfile::TempDir, LibraryStore) {
        let tmp = tempfile::tempdir().unwrap();
        let store = LibraryStore::open(tmp.path()).expect("open");
        (tmp, store)
    }

    fn version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn fresh_db_migrates_to_version_2_with_seed_rows() {
        let (tmp, store) = open_tmp();
        let conn = store.lock();
        assert_eq!(version(&conn), 2);
        let seeds: i64 = conn
            .query_row("SELECT COUNT(*) FROM ui_prefs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(seeds, 7); // DATABASE §7.1
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('recordings','ui_prefs')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 2);
        drop(conn);
        drop(store);
        tmp.close().unwrap();
    }

    #[test]
    fn journal_mode_is_wal() {
        let (_, store) = open_tmp();
        let conn = store.lock();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn reopen_is_idempotent_and_does_not_duplicate_seeds() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let _ = LibraryStore::open(tmp.path()).unwrap();
        }
        {
            let store = LibraryStore::open(tmp.path()).unwrap();
            let conn = store.lock();
            assert_eq!(version(&conn), 2);
            let seeds: i64 = conn
                .query_row("SELECT COUNT(*) FROM ui_prefs", [], |r| r.get(0))
                .unwrap();
            assert_eq!(seeds, 7);
        }
    }

    #[test]
    fn created_db_file_is_owner_only_0600() {
        let tmp = tempfile::tempdir().unwrap();
        let _ = LibraryStore::open(tmp.path()).unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(tmp.path().join("library.db"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600); // §6.1
    }

    #[test]
    fn prefs_set_upserts_without_duplicating() {
        let (_, store) = open_tmp();
        store.prefs_set("pip.size", &json!(360)).unwrap();
        store.prefs_set("pip.size", &json!(442)).unwrap();
        {
            let conn = store.lock();
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM ui_prefs WHERE key = 'pip.size'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
            let updated: String = conn
                .query_row(
                    "SELECT value_json FROM ui_prefs WHERE key = 'pip.size'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(updated, "442");
        }
        // The lock guard above must drop first — prefs_get takes the same mutex.
        assert_eq!(store.prefs_get("pip.size").unwrap()["value"], json!(442));
    }

    #[test]
    fn unknown_namespace_is_typed_invalid_value() {
        let (_, store) = open_tmp();
        let err = store.prefs_set("theme.color", &json!("teal")).unwrap_err();
        assert_eq!(err.code(), "settings.invalid_value"); // API §2.6
    }

    #[test]
    fn missing_key_reads_as_null_value() {
        let (_, store) = open_tmp();
        let reply = store.prefs_get("pip.shape").unwrap();
        assert_eq!(reply["key"], "pip.shape");
        assert_eq!(reply["value"], json!("circle")); // seeded
        let reply = store.prefs_get("pip.unknown").unwrap();
        assert_eq!(reply["value"], serde_json::Value::Null);
    }

    #[test]
    fn empty_key_lists_every_pref() {
        let (_, store) = open_tmp();
        let all = store.prefs_get("").unwrap();
        let prefs = all["prefs"].as_array().unwrap();
        assert_eq!(prefs.len(), 7);
        let keys: Vec<&str> = prefs.iter().map(|p| p["key"].as_str().unwrap()).collect();
        assert!(keys.contains(&"last.preset_id"));
    }

    #[test]
    fn failed_migration_leaves_user_version_at_last_good_step() {
        // §8: atomicity lives in the runner, so test it generically.
        let conn = Connection::open_in_memory().unwrap();
        let bad: &[(i64, &str)] = &[
            (1, "CREATE TABLE t (id INTEGER);"),
            (2, "CREATE TABLE t (this, statement, is, wrong);"),
        ];
        let err = super::migrate_with(&conn, bad);
        assert!(err.is_err());
        assert_eq!(version(&conn), 1); // v1 committed, v2 rolled back whole
    }
}
