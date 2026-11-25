# TESTING.md — Full Testing & QA Matrix

**Version:** 2.0 · **Authority chain:** PRD.md (success metrics) → FEATURES.md (feature acceptance) → TESTING.md (verification gates)

**Current status (2026-11-25):** Active test suites run in CI (`.github/workflows/ci.yml`) and locally (`316` Vitest unit/component/UI-contract tests + Rust unit/integration + release performance harness). Manual multi-compositor hardware runs and `#[ignore]` hardware/soak gates track the remaining pre-GA verification items in §7 below.

---

## 1. Tools by layer (with the one-line reason)

| Layer                   | Tool                                                                                     | Why                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Rust unit + integration | **`cargo test`** (built-in) + **`tokio::test`** for async pipelines                      | Zero extra deps; async is real in capture/session code                                                               |
| Rust property tests     | **`proptest`** (dev-dep)                                                                 | Crop math, filename expansion, event coalescing are invariant-friendly — property tests find the boring bug          |
| Rust e2e (desktop)      | **`tauri-driver` + WebdriverIO** ⚠ _lowest-confidence area; limited to availability_     | Official Tauri a11y/WebDriver bridge; Linux-only, compositor-dependent → E2E is **manual-gate heavy**, not CI-heroic |
| Frontend unit           | **Vitest** (Vite-native)                                                                 | Same transform pipeline as the app; fast HMR-coupled runs                                                            |
| Frontend component      | **Vitest + @testing-library/react** (+ `jsdom`)                                          | Radix/shadcn tests want the a11y/query idioms                                                                        |
| Contract tests          | **Vitest against mock IPC** + a Rust parity table test                                   | The `lib/ipc.ts` ↔ `src-tauri/ipc/` mirror is the project's #1 silent breakage risk (API.md contract)                |
| File/video oracle       | **`ffprobe` CLI** via golden assertions; **`jq` + `sqlite3`** in shell e2e scripts       | Honest oracles: we assert on real bytes/stream truth, not on our own logs                                            |
| Performance             | `tracing` spans + scripted soak runs (`/usr/bin/time -v`, rss snapshot)                  | PRD §8 hardware-path metrics (<150 MB RSS, <0.5% dropped @1080p60, <50 ms A/V drift over 60 min)                     |
| CI                      | GitHub Actions (`ci.yml`) — fmt/clippy/tsc/vitest/cargo test on every PR                 | AGENTS DO #7 made real                                                                                               |
| Manual                  | A11y walkthrough, compositor matrix session (PLAN 7), screen-recorder probe alternatives | Wayland capture truth is human-verified per compositor                                                               |

---

## 2. What to test in each layer — priority order (critical paths first)

**P0 — the pipeline (money path):** capture frame → encode → write → row. Any failure here is total: `pipeline/mod.rs` state machine, `muxer.rs` crash safety, event throttles, `recording_*` commands end-to-end (mocked sources), library row finalization.
**P1 — contracts:** IPC payload parity (`types/ipc.ts` vs Rust), every API.md §1 error code produced by at least one test, DB schema ↔ migration files, `system_capabilities` gating of UI chips.
**P2 — per-feature acceptance:** the M1–M14 checklists (§3 tables).
**P3 — UI component states:** states per DESIGN §5 (focus rings, disabled, loading, reduced-motion), i18n-ish copy length, compact/standard/wide breakpoints.
**P4 — perf/soak:** RSS guard, event rates, 30-min soak, coverage report process.

---

## 3. Test-case tables per feature (P2, one per M–feature)

Legend: `type` = unit (U) / integration (I) / e2e-shell (S) / manual (M) / property (P).

### F-M1 Monitor capture

| Scenario                      | Input                            | Expected                                                               |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `m1.grant_flow` (S/M)         | select monitor 1 → grant         | preview updates; `source_select` resp capabilities match portal        |
| `m1.record_playback` (S)      | record 10s, monitor 2560×1440@60 | ffprobe: h264, 2560×1440, fps 60±0.5, duration 10s±0.5                 |
| `m1.deny_consent` (M)         | deny portal dialog               | education slot UI; `portal.denied` code; no crash; zero raw error text |
| `m1.unplug_mid` (I, mock)     | source lost event mid-take       | session → stopped-safe; row `ready`; MKV plays; user copy shown        |
| `m1.multi_monitor_pick` (S/M) | 2 monitors; pick #2              | frames only from #2 (pixel diff vs captured stills)                    |

### F-M2 Window capture

| Scenario                        | Input                        | Expected                                                                  |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `m2.window_only` (S/M)          | record single window         | ffprobe frames contain no wallpaper pixels (sample corners vs desktop EM) |
| `m2.window_closed_mid` (I)      | close window mid-take        | `source/lost` handling == monitor unplug; clean stop                      |
| `m2.unsupported_compositor` (I) | capabilities: `window:false` | chip disabled + tooltip; `source_select(window)` → `portal.unavailable`   |

### F-M3 Region capture

| Scenario                 | Input                                | Expected                                                                  |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------- |
| `m3.crop_exact` (U/P)    | rect(120,80,1280,720) over 2560×1440 | output 1280×720 exactly; property: arbitrary valid rects crop identically |
| `m3.rect_invalid` (I)    | rect outside monitor / min <64px     | `capture.region_invalid` before start; UI inline error                    |
| `m3.one_stream` (I)      | 3 consecutive region recordings      | portal session count in log == 1                                          |
| `m3.locked_at_start` (I) | change rect mid-take                 | output keeps start rect (documented limit)                                |

### F-M4 Audio sources

| Scenario                       | Input                            | Expected                                                            |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------- |
| `m4.two_channels` (S/M)        | mic + desktop, speak & play tone | A/V sync ≤100ms across 10-min (ffprobe drift + manual listen)       |
| `m4.mute_byte_honest` (S)      | mic muted                        | ffprobe audio stream absent-or-silent for mic range; desktop intact |
| `m4.device_gone_mid` (I, mock) | mic device removed mid-take      | event `device/changed`; UI chip "device gone"; recording continues  |
| `m4.meter_rate` (U)            | synthetic meter flood            | coalescer output ≤30Hz measured in test harness                     |
| `m4.unknown_device` (I)        | `audio_set_channel` bad id       | `settings.invalid_value`; no partial state change                   |

### F-M5 Webcam PiP

| Scenario                        | Input                           | Expected                                                  |
| ------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `m5.off_no_frames` (I)          | PiP shown, self_insert=false    | encoder input contains zero camera frames                 |
| `m5.pos_composite_parity` (S/M) | drag PiP to bottom-left, record | composited position == UI position (side-by-side compare) |
| `m5.prefs_roundtrip` (I)        | move/resize → restart           | shape/size/position restored from `ui_prefs`              |
| `m5.camera_busy` (I)            | device held by other process    | `capture.camera_unavailable` inline; slab state honest    |
| `m5.unplug_frozen` (I, mock)    | unplug with self_insert on      | last-frame freeze; session continues; `device/changed`    |

### F-M6 HUD

| Scenario                   | Input                    | Expected                                                  |
| -------------------------- | ------------------------ | --------------------------------------------------------- |
| `m6.floats_on_targets` (M) | full-HD window + HUD     | HUD above target app windows (compositor matrix recorded) |
| `m6.timer_stability` (I)   | mock tick 3600×          | no layout shift; width fixed at 60min+ (px snapshot e2e)  |
| `m6.keyboard_only` (M)     | tab-cycle all controls   | reach + operate stop/pause/flag; visible focus rings      |
| `m6.no_started_toast` (S)  | start recording          | zero "Recording started" toast events while HUD visible   |
| `m6.reduce_motion` (I)     | `prefers-reduced-motion` | pulse disabled; transitions opacity-only ≤100ms           |

### F-M7 Session controls

| Scenario                   | Input                         | Expected                                                 |
| -------------------------- | ----------------------------- | -------------------------------------------------------- |
| `m7.pause_stitch` (S)      | 10s, pause 10s, 5s, stop      | duration ≈15s±0.7; one continuous playable take          |
| `m7.flags_json` (I)        | 3 flags at 1s/4.2s/9s         | `chapter_json` offsets [1000,4200,9000]; HUD tick thrice |
| `m7.spam_idempotent` (I)   | rapid pause-pause / stop-stop | `ipc.bad_state` extras; single toast; no orphan segments |
| `m7.flag_clamp` (U)        | flag at 40ms                  | offset=0; second flag same ms → +1                       |
| `m7.crash_kill9_pause` (S) | kill -9 mid-pause             | MKV playable; row `ready                                 | missing`; boot library shows file status honestly |

### F-M8 Encoders

| Scenario                             | Input                      | Expected                                                          |
| ------------------------------------ | -------------------------- | ----------------------------------------------------------------- |
| `m8.autoselect_vaapi` (S/M)          | Intel/AMD box              | chip vaapi; log agree; row encoder=vaapi                          |
| `m8.broken_nvenc_fallback` (I, mock) | nvenc init fail            | chain → next; UI zap-off notice; recording succeeds               |
| `m8.all_fail` (I, mock)              | all three fail             | `encoder.unavailable` + `encoderChain` details; honest copy       |
| `m8.force_flag` (I)                  | `SSP_FORCE_ENCODER=x264`   | honored + logged deviation                                        |
| `m8.force_unavailable` (I)           | forced backend init fail   | `encoder.unavailable` + `details.forced`; NO silent x264 fallback |
| `m8.row_truth` (I)                   | stop after fallback        | row `encoder` = actual used                                       |
| `m8.vaapi_real_take` (S, 7.4)        | usable `/dev/dri/renderD*` | ffprobe h264/yuv420p in MKV and fragmented MP4; chip `vaapi`      |

### F-M9 File output

| Scenario                         | Input                                                      | Expected                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m9.crash_three_boundaries` (S)  | kill -9 @ start/mid/pause                                  | three MKVs playable (PRD M9 core)                                                                                                                                                                                               |
| `m9.remux_default` (S)           | stop, remux ON                                             | `.mp4` row created; tmp `.mkv` removed; if OFF → `.mkv` row                                                                                                                                                                     |
| `m9.collision` (U)               | same-second save ×2                                        | `-1` suffix; content intact; never overwrite                                                                                                                                                                                    |
| `m9.disk_full` (I, mock fs)      | inject ENOSPC                                              | `disk.no_space`; guidance copy; no orphan trash                                                                                                                                                                                 |
| `m9.dir_gone` (I)                | dir deleted between records                                | recreate-if-possible else `path_unwritable` + dir-fix offer                                                                                                                                                                     |
| `m9.pattern_overflow` (U)        | maximal pattern/long dir                                   | fs-safe truncation; no silent rename                                                                                                                                                                                            |
| `m9.eof_finalize` (U)            | child `ssp-mux` fed real packets, then stdin EOF           | ffprobe reads a h264 stream with duration; trailer written without a finalize message                                                                                                                                           |
| `m9.parent_death_stdin_drop` (U) | drop the parent's `ChildStdin` mid-take, no finalize frame | child finalizes a probeable file (fd teardown simulation); real killed-parent SIGKILL gate remains manual                                                                                                                       |
| `m9.chapter_native_tags` (U)     | `Chapter` frames through `ssp-mux`, EOF finalize           | `ffprobe -show_chapters` sees title/start from the DB JSON projection (`chapter_frames_produce_native_chapter_tags`, `flags_are_projected_as_native_chapters_with_additive_count`)                                              |
| `m9.gapless_split` (U)           | duration threshold crossed mid-take (`Split` frame)        | two separately probeable segment files, no dropped frames, ordered `segment_json` with `updated_at` on mutations (`split_writes_two_gapless_probeable_segments`, `auto_split_writes_gapless_segments_and_ordered_segment_json`) |

### F-M10 Settings

| Scenario                  | Input                        | Expected                                                   |
| ------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `m10.roundtrip_all` (I)   | set every control → restart  | values intact (TOML readback audit)                        |
| `m10.broken_toml` (I)     | invalid hand edit            | `settings.schema_mismatch`; old vals kept; human copy      |
| `m10.session_lock` (I)    | open settings mid-recording  | session-sensitive rows disabled + "applies next recording" |
| `m10.invalid_payload` (I) | `settings_set` bad frameRate | `settings.invalid_value`; no partial write                 |

### F-M11 Presets

| Scenario                 | Input                        | Expected                                   |
| ------------------------ | ---------------------------- | ------------------------------------------ |
| `m11.output_effects` (S) | record @youtube vs @smallest | ffprobe dims/fps/bitrate deltas as defined |
| `m11.default_seed` (I)   | fresh profile                | presetId = "youtube" (DB seed)             |
| `m11.unknown_preset` (I) | start presetId="nope"        | `settings.invalid_value`                   |
| `m11.copy_language` (M)  | inspect UI                   | zero CRF/CBR/CQP strings (grep gate in CI) |

### F-M12 Shortcuts

| Scenario                   | Input                              | Expected                                         |
| -------------------------- | ---------------------------------- | ------------------------------------------------ |
| `m12.global_toggle` (S/M)  | hotkey while unfocused app focused | toggle-record fires (KDE reality + matrix notes) |
| `m12.taken_combo` (I)      | register already-used combo        | denied → surfaced in UI + log, never swallowed   |
| `m12.portal_absent` (I)    | capabilities globalShortcuts=none  | tray parity + capability panel copy; no crash    |
| `m12.mid_pause_hotkey` (I) | hotkey spam during pause           | same idempotence as F-M7                         |

### F-M13 Indicator consistency

| Scenario                        | Input                  | Expected                                               |
| ------------------------------- | ---------------------- | ------------------------------------------------------ |
| `m13.no_os_indicator_touch` (S) | grep audit             | zero calls to draw/suppress system indicator           |
| `m13.no_double_indicator` (M)   | run on KDE (native UI) | HUD secondary treatment; no red duplication near clock |

### F-M14 Library

| Scenario                       | Input                      | Expected                                                      |
| ------------------------------ | -------------------------- | ------------------------------------------------------------- |
| `m14.page_speed` (S)           | 150 rows seeded            | 50-row page < 300ms; `EXPLAIN QUERY PLAN` shows index use     |
| `m14.soft_delete_audit` (I)    | delete recording           | grid hides row; DB row remains (`deleted_at` set)             |
| `m14.file_gone` (I)            | rm file on disk            | card → `missing` state with honest copy + retry               |
| `m14.filter_sort_contract` (I) | whitelist sort + junk sort | whitelist works; junk → typed error; matches API §2.4 exactly |
| `m14.kbd_navigation` (M)       | arrow-key roving           | grid reachable without pointer; a11y §7                       |
| `m14.upsert_path` (I)          | duplicate path insert      | row upserts, no dupes (DB UNIQUE + pipeline code)             |

---

## 4. Edge cases & negative tests (cross-cutting)

- **Invalid input:** every command gets a malformed-payload test through the typed `lib/ipc.ts` boundary — unknown fields ignored (MINOR-version forward tolerance, API §5), missing required → typed error, wrong types → `settings.invalid_value`-family. Property tests (`proptest`) fuzz region rects, naming patterns, meter floods.
- **Unauthorized access:** model is "single-user local app," so "unauthorized" = **IPC surface defense**: commands reject out-of-context callers (window id ≠ main window per capability law), Tauri capability deny-by-default, and a test asserting the HUD window can invoke only session commands (`recording_*`) — not `library_delete` or `settings_set` (API §2 Auth column made real).
- **Network failure:** the app has no network (CSP denies remote). Negative: supply a webview trying `fetch` → blocked; events from broken compositors Manifest as the portal/pipewire errors covered in M1/M2 tables — never timeouts-as-crashes.
- **Resources:** disk full (mock fs), permissions traps (`disk.path_unwritable`), DB locked (WAL reader discipline), DB mainline renaming under concurrent write, camera busy.
- **Time/sequence:** pause at pause; suspend/resume mid-take; hotplug storms (debounce assertions); 60min+ drift checks.
- **A11y as a negative gate:** color-only state detection fails review — every state must pass the icon+text+shape redundancy test (DESIGN §7.4).

---

## 5. Test data & mocking strategy

- **Sources:** they're all trait objects (`capture::CaptureSource`), so runs use stacked synthetic sources: mono-color frames, moving-gradient frames (sync tests), "glitch" frames (drop every Nth), variable-SR audio generators, fake V4L2 (device file never touched in CI). The real portal path is only exercised on manual/S-tier runs.
- **Encoders:** all three backends implement the same trait `Encoder`, so the session worker holds `Box<dyn Encoder>`; no `NullEncoder` is needed on the video path (the real x264 backend is the CI oracle). `hw_vaapi` self-skips when no usable DRM render node exists, and runs a REAL ffprobe-verified take when one does (Phase 7.4); `hw_nvenc` compiles and probes, but stays _manual-matrix_ until an NVIDIA host is available (no performance claim). Hardware gates use the same `EncodedPacket` pts tap as the A/V drift meter (`stats::packet_probe`, test build only).
- **Filesys:** tempdirs (`tempfile` crate) per test; mock fs layer for ENOSPC/EPERM injection keeps the failures deterministic.
- **DB:** real SQLite in a per-test tempdir through the real migrations (DATABASE §8 — the `user_version` runner is itself tested); fixtures are SQL fixtures from DATABASE §7, not hand-built objects.
- **IPC:** frontend tests run against a typed mock store implementing `lib/ipc.ts` interface (the contract), with fuzzed event firing; contract parity is asserted by a shared JSON schema generated per version (kept in `src-tauri/ipc/schema.json` and imported by `types/ipc.ts`) — drift = instant red CI.
- **Recordings fixtures:** five golden MKV/MP4 files (different containers, code rates) in `src-tauri/tests/fixtures/`, committed at real but tiny sizes, used as ffprobe/feed inputs.
- **Time:** injectable clock into session controller (`tick` independence from wall time) — pause-stitch tests are deterministic to ms.
- **Compositor truth:** `docs/portal-support.md` is the fixture-ish artifact — the manual matrix (M1/M2/M6/M12/M13) results get logged there per COMPOSITOR; CI covers mocked paths only, manual covers hardware truth.

---

## 6. Coverage targets & commands

**Targets (measured at PR level, no vanity):**

| Area                               | Target                           | Rationale                                       |
| ---------------------------------- | -------------------------------- | ----------------------------------------------- |
| Rust pipeline/encode/capture/state | ≥ 85% line, ≥ 80% branch         | the money path deserves the floor               |
| Rust ipc + settings + library      | ≥ 80%                            | thin glue, high contract risk                   |
| Frontend stores + ipc + errors     | ≥ 85%                            | projection layer                                |
| UI components                      | (not % — state coverage instead) | every §5 state asserted somewhere (manual + JS) |
| Overall hard floor                 | 80%                              | never gate a PR on a delta < 2pp                |

**Commands (live & CI-verified):**

```bash
# Full pre-PR / CI parity gate (Frontend Linear check + TS + ESLint + Vitest + Build, plus Rust fmt/clippy/test)
npm run check:linear && npm run typecheck && npm run lint && npm test -- --run && npm run build
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test

# Hardware / manual-gated tests (#[ignore]d in CI)
cd src-tauri && SSP_LOG_LEVEL=debug cargo test -- --ignored --nocapture

# Frontend unit tests (contract or component focus)
npm test -- --run src/lib
```

**Reporting:** CI publishes coverage summary; regressions > 2pp are review-blockers; per-feature table updates ticked alongside FEATURE loop PRs.

---

## 7. Manual QA & Pre-Release Status Checklist

Run on: KDE Plasma Wayland (tested baseline), Arch + Hyprland, Fedora, plus niri/MangoWC smoke pass. Update `docs/portal-support.md`.

**Install & packaging (`nfpm` — `.deb` / `.rpm` / `.pkg.tar.zst`)**

- [ ] Clean-container install/uninstall verification across Ubuntu `.deb`, Fedora `.rpm`, and Arch `.pkg.tar.zst` (desktop entry, icon, launcher)
- [ ] Fresh profile `install → first saved file` timed (<60s target, PRD G3)
- [x] About pane dynamically displays `tauri.conf.json` version and `ipcContract` (`1.6.0`)

**Recording core & audio**

- [x] Monitor recording + KDE portal consent + ffprobe playable MKV/MP4 + SQLite `library.db` row (live KDE verified)
- [x] Pause/resume live take excludes paused time & audio A/B mute verified on KDE (Phase 2 live gates, 2026-11-17)
- [x] MKV crash-tolerance verified automatically (`mem::forget` / `avio_flush` ffprobe test); Phase 9.2 `ssp-mux` EOF finalization + `ChildStdin`-drop simulation green — real killed-parent `SIGKILL` gate still pending (not claimed)
- [x] Phase 9.3 automated gates: native chapter tags via `ffprobe -show_chapters`, two gapless probeable segments with ordered `segment_json`, settings threshold bounds, and IPC 1.8.0 contract parity.
- [x] Phase 9 automated SIGKILL gate: `sigkill_parent_leaves_probeable_file` re-execs the test harness, kills the real parent with `kill -9`, and ffprobes the orphaned `ssp-mux` child's finalized file. `mpv` full-seek playback remains a human gate.
- [x] VAAPI real encoding verification (2026-11-25, TigerLake Iris Xe): real `h264_vaapi` take ffprobed as h264/yuv420p in MKV and hybrid MP4; release perf take measured 0% steady drops, 126 MiB RSS, 10.6 ms A/V drift (PRD §8 short-take gates pass). Shortened soak (5 × 60 s) held 0 drops/take, 113–128 MiB RSS and 10.66 ms drift with flat threads.
- [ ] NVENC real encoding verification — compiles and probes, but this host has no NVIDIA device; needs an NVIDIA test machine (no performance claim here)
- [ ] Multi-compositor live runs (Hyprland, niri, MangoWC, X11) for Window/Region capture, HUD overlay stacking, and GlobalShortcuts

**UI, accessibility & Linear lock**

- [x] Unified Linear UI lock passes `npm run check:linear` (zero blur, translucency, dark-mode shadows, macOS CSD dots, pill clutter, or raw component hex)
- [x] Dark & Light theme verification across Record / Library / Settings at `1280×800` and `1024×640` with zero horizontal overflow
- [x] `prefs_set` / settings TOML roundtrip, focus outlines, reduced-motion rules, and human-only `CoreError::*` `userMessage` audit (verified in Vitest + inspection)
- [ ] Live 30-min 1080p60 HW-encoder soak + 60-min A/V drift take meeting PRD §8 (<150 MB RSS, <0.5% dropped frames, <50 ms drift) — 5 s perf passes, long-duration qualification still manual
- [ ] Screen-reader smoke test and native HUD webview focus pass across Wayland compositors
