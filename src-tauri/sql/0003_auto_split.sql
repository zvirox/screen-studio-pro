-- 0003_auto_split.sql — DATABASE.md §2.1/§8: Phase 9.3 segment metadata.
-- One logical take stays ONE row (`path` is the upsert key); the gapless
-- segments produced by `ssp-mux` are an ordered JSON value object on that
-- row, never extra rows. Native chapter tags are a projection of chapter_json
-- and are therefore not duplicated here.
ALTER TABLE recordings ADD COLUMN segment_json TEXT;
