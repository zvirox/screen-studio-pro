-- 0002_ui_prefs.sql — DATABASE.md §2.2 + §7.1: key-value prefs with the
-- first-run seed (run once, inside the migration's transaction).
CREATE TABLE ui_prefs (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO ui_prefs (key, value_json) VALUES
  ('hud.position',      '"corner:bottom-right,margin:24"'),
  ('hud.pinned',        'false'),
  ('pip.shape',         '"circle"'),
  ('pip.position',      '"corner:bottom-right,margin:24"'),
  ('pip.size',          '220'),
  ('pip.self_insert',   'false'),
  ('last.preset_id',    '"youtube"');
