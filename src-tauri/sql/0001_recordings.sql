-- 0001_recordings.sql — DATABASE.md §2.1 + §5: the library index.
-- Indexes ship WITH the table (§8 rule); `path` UNIQUE doubles as
-- uq_recordings_path (§5: "covered by constraint").
CREATE TABLE recordings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    path          TEXT    NOT NULL UNIQUE,
    file_name     TEXT    NOT NULL,
    kind          TEXT    NOT NULL DEFAULT 'recording'
                  CHECK (kind IN ('recording','screenshot','stream_marker')),
    container     TEXT    NOT NULL CHECK (container IN ('mkv','mp4','webm')),
    status        TEXT    NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('recording','finalizing','ready','missing')),
    duration_ms   INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    width         INTEGER CHECK (width > 0),
    height        INTEGER CHECK (height > 0),
    fps           INTEGER CHECK (fps > 0),
    size_bytes    INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    encoder       TEXT    NOT NULL,
    is_hw_encoder INTEGER NOT NULL DEFAULT 0 CHECK (is_hw_encoder IN (0,1)),
    audio_json    TEXT,
    chapter_json  TEXT,
    thumb_path    TEXT,
    deleted_at    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_recordings_created_at
    ON recordings (created_at DESC);

CREATE INDEX idx_recordings_status_deleted
    ON recordings (status) WHERE deleted_at IS NULL;

-- V2 library tabs (screenshot/stream_marker) — costs ~nothing, in V-scope (§5).
CREATE INDEX idx_recordings_kind_deleted
    ON recordings (kind) WHERE deleted_at IS NULL;
