# TESTING.md — Full Testing Plan

**Version:** 1.0 · **Authority chain:** PRD.md (success metrics) → FEATURES.md (feature guides + acceptance criteria) → TESTING.md (how each is verified)

**Execution law (per your rule):** tests are written **one feature at a time**, in the FEATURES.md order (`M1→…→M14`). A feature's tests must **all pass** before its feature is marked done (PLAN checkboxes) and the next one starts. This pairs with the FEATURES loop — code + tests are built and green together, never "test debt."

**Current status:** repo is pre-scaffold (docs-only, see README §Status). Tools/commands in §1–§6 are the *planned* harness pinned by ARCHITECTURE.md; they execute for real when PLAN 0.1/0.3 (scaffold + CI) land, and CI keeps them guarded from commit one.

---

## 1. Tools by layer (with the one-line reason)

| Layer | Tool | Why |
|---|---|---|
| Rust unit + integration | **`cargo test`** (built-in) + **`tokio::test`** for async pipelines | Zero extra deps; async is real in capture/session code |
| Rust property tests | **`proptest`** (dev-dep) | Crop math, filename expansion, event coalescing are invariant-friendly — property tests find the boring bug |
| Rust e2e (desktop) | **`tauri-driver` + WebdriverIO** ⚠ *lowest-confidence area; limited to availability* | Official Tauri a11y/WebDriver bridge; Linux-only, compositor-dependent → E2E is **manual-gate heavy**, not CI-heroic |
| Frontend unit | **Vitest** (Vite-native) | Same transform pipeline as the app; fast HMR-coupled runs |
| Frontend component | **Vitest + @testing-library/react** (+ `jsdom`) | Radix/shadcn tests want the a11y/query idioms |
| Contract tests | **Vitest against mock IPC** + a Rust parity table test | The `lib/ipc.ts` ↔ `src-tauri/ipc/` mirror is the project's #1 silent breakage risk (API.md contract) |
| File/video oracle | **`ffprobe` CLI** via golden assertions; **`jq` + `sqlite3`** in shell e2e scripts | Honest oracles: we assert on real bytes/stream truth, not on our own logs |
| Performance | `tracing` spans + scripted soak runs (`/usr/bin/time -v`, rss snapshot) | PRD §8 metrics (≤150MB RSS, <0.5% dropped, ≤100ms A/V drift) |
| CI | GitHub Actions (`ci.yml`) — fmt/clippy/tsc/vitest/cargo test on every PR | AGENTS DO #7 made real |
| Manual | A11y walkthrough, compositor matrix session (PLAN 7), screen-recorder probe alternatives | Wayland capture truth is human-verified per compositor |

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
| Scenario | Input | Expected |
|---|---|---|
| `m1.grant_flow` (S/M) | select monitor 1 → grant | preview updates; `source_select` resp capabilities match portal |
| `m1.record_playback` (S) | record 10s, monitor 2560×1440@60 | ffprobe: h264, 2560×1440, fps 60±0.5, duration 10s±0.5 |
| `m1.deny_consent` (M) | deny portal dialog | education slot UI; `portal.denied` code; no crash; zero raw error text |
| `m1.unplug_mid` (I, mock) | source lost event mid-take | session → stopped-safe; row `ready`; MKV plays; user copy shown |
| `m1.multi_monitor_pick` (S/M) | 2 monitors; pick #2 | frames only from #2 (pixel diff vs captured stills) |

### F-M2 Window capture
| Scenario | Input | Expected |
|---|---|---|
| `m2.window_only` (S/M) | record single window | ffprobe frames contain no wallpaper pixels (sample corners vs desktop EM) |
| `m2.window_closed_mid` (I) | close window mid-take | `source/lost` handling == monitor unplug; clean stop |
| `m2.unsupported_compositor` (I) | capabilities: `window:false` | chip disabled + tooltip; `source_select(window)` → `portal.unavailable` |

### F-M3 Region capture
| Scenario | Input | Expected |
|---|---|---|
| `m3.crop_exact` (U/P) | rect(120,80,1280,720) over 2560×1440 | output 1280×720 exactly; property: arbitrary valid rects crop identically |
| `m3.rect_invalid` (I) | rect outside monitor / min <64px | `capture.region_invalid` before start; UI inline error |
| `m3.one_stream` (I) | 3 consecutive region recordings | portal session count in log == 1 |
| `m3.locked_at_start` (I) | change rect mid-take | output keeps start rect (documented limit) |

### F-M4 Audio sources
| Scenario | Input | Expected |
|---|---|---|
| `m4.two_channels` (S/M) | mic + desktop, speak & play tone | A/V sync ≤100ms across 10-min (ffprobe drift + manual listen) |
| `m4.mute_byte_honest` (S) | mic muted | ffprobe audio stream absent-or-silent for mic range; desktop intact |
| `m4.device_gone_mid` (I, mock) | mic device removed mid-take | event `device/changed`; UI chip "device gone"; recording continues |
| `m4.meter_rate` (U) | synthetic meter flood | coalescer output ≤30Hz measured in test harness |
| `m4.unknown_device` (I) | `audio_set_channel` bad id | `settings.invalid_value`; no partial state change |

### F-M5 Webcam PiP
| Scenario | Input | Expected |
|---|---|---|
| `m5.off_no_frames` (I) | PiP shown, self_insert=false | encoder input contains zero camera frames |
| `m5.pos_composite_parity` (S/M) | drag PiP to bottom-left, record | composited position == UI position (side-by-side compare) |
| `m5.prefs_roundtrip` (I) | move/resize → restart | shape/size/position restored from `ui_prefs` |
| `m5.camera_busy` (I) | device held by other process | `capture.camera_unavailable` inline; slab state honest |
| `m5.unplug_frozen` (I, mock) | unplug with self_insert on | last-frame freeze; session continues; `device/changed` |

### F-M6 HUD
| Scenario | Input | Expected |
|---|---|---|
| `m6.floats_on_targets` (M) | full-HD window + HUD | HUD above target app windows (compositor matrix recorded) |
| `m6.timer_stability` (I) | mock tick 3600× | no layout shift; width fixed at 60min+ (px snapshot e2e) |
| `m6.keyboard_only` (M) | tab-cycle all controls | reach + operate stop/pause/flag; visible focus rings |
| `m6.no_started_toast` (S) | start recording | zero "Recording started" toast events while HUD visible |
| `m6.reduce_motion` (I) | `prefers-reduced-motion` | pulse disabled; transitions opacity-only ≤100ms |

### F-M7 Session controls
| Scenario | Input | Expected |
|---|---|---|
| `m7.pause_stitch` (S) | 10s, pause 10s, 5s, stop | duration ≈15s±0.7; one continuous playable take |
| `m7.flags_json` (I) | 3 flags at 1s/4.2s/9s | `chapter_json` offsets [1000,4200,9000]; HUD tick thrice |
| `m7.spam_idempotent` (I) | rapid pause-pause / stop-stop | `ipc.bad_state` extras; single toast; no orphan segments |
| `m7.flag_clamp` (U) | flag at 40ms | offset=0; second flag same ms → +1 |
| `m7.crash_kill9_pause` (S) | kill -9 mid-pause | MKV playable; row `ready|missing`; boot library shows file status honestly |

### F-M8 Encoders
| Scenario | Input | Expected |
|---|---|---|
| `m8.autoselect_vaapi` (S/M) | Intel/AMD box | chip vaapi; log agree; row encoder=vaapi |
| `m8.broken_nvenc_fallback` (I, mock) | nvenc init fail | chain → next; UI zap-off notice; recording succeeds |
| `m8.all_fail` (I, mock) | all three fail | `encoder.unavailable` + `encoderChain` details; honest copy |
| `m8.force_flag` (I) | `SSP_FORCE_ENCODER=x264` | honored + logged deviation |
| `m8.row_truth` (I) | stop after fallback | row `encoder` = actual used |

### F-M9 File output
| Scenario | Input | Expected |
|---|---|---|
| `m9.crash_three_boundaries` (S) | kill -9 @ start/mid/pause | three MKVs playable (PRD M9 core) |
| `m9.remux_default` (S) | stop, remux ON | `.mp4` row created; tmp `.mkv` removed; if OFF → `.mkv` row |
| `m9.collision` (U) | same-second save ×2 | `-1` suffix; content intact; never overwrite |
| `m9.disk_full` (I, mock fs) | inject ENOSPC | `disk.no_space`; guidance copy; no orphan trash |
| `m9.dir_gone` (I) | dir deleted between records | recreate-if-possible else `path_unwritable` + dir-fix offer |
| `m9.pattern_overflow` (U) | maximal pattern/long dir | fs-safe truncation; no silent rename |

### F-M10 Settings
| Scenario | Input | Expected |
|---|---|---|
| `m10.roundtrip_all` (I) | set every control → restart | values intact (TOML readback audit) |
| `m10.broken_toml` (I) | invalid hand edit | `settings.schema_mismatch`; old vals kept; human copy |
| `m10.session_lock` (I) | open settings mid-recording | session-sensitive rows disabled + "applies next recording" |
| `m10.invalid_payload` (I) | `settings_set` bad frameRate | `settings.invalid_value`; no partial write |

### F-M11 Presets
| Scenario | Input | Expected |
|---|---|---|
| `m11.output_effects` (S) | record @youtube vs @smallest | ffprobe dims/fps/bitrate deltas as defined |
| `m11.default_seed` (I) | fresh profile | presetId = "youtube" (DB seed) |
| `m11.unknown_preset` (I) | start presetId="nope" | `settings.invalid_value` |
| `m11.copy_language` (M) | inspect UI | zero CRF/CBR/CQP strings (grep gate in CI) |

### F-M12 Shortcuts
| Scenario | Input | Expected |
|---|---|---|
| `m12.global_toggle` (S/M) | hotkey while unfocused app focused | toggle-record fires (KDE reality + matrix notes) |
| `m12.taken_combo` (I) | register already-used combo | denied → surfaced in UI + log, never swallowed |
| `m12.portal_absent` (I) | capabilities globalShortcuts=none | tray parity + capability panel copy; no crash |
| `m12.mid_pause_hotkey` (I) | hotkey spam during pause | same idempotence as F-M7 |

### F-M13 Indicator consistency
| Scenario | Input | Expected |
|---|---|---|
| `m13.no_os_indicator_touch` (S) | grep audit | zero calls to draw/suppress system indicator |
| `m13.no_double_indicator` (M) | run on KDE (native UI) | HUD secondary treatment; no red duplication near clock |

### F-M14 Library
| Scenario | Input | Expected |
|---|---|---|
| `m14.page_speed` (S) | 150 rows seeded | 50-row page < 300ms; `EXPLAIN QUERY PLAN` shows index use |
| `m14.soft_delete_audit` (I) | delete recording | grid hides row; DB row remains (`deleted_at` set) |
| `m14.file_gone` (I) | rm file on disk | card → `missing` state with honest copy + retry |
| `m14.filter_sort_contract` (I) | whitelist sort + junk sort | whitelist works; junk → typed error; matches API §2.4 exactly |
| `m14.kbd_navigation` (M) | arrow-key roving | grid reachable without pointer; a11y §7 |
| `m14.upsert_path` (I) | duplicate path insert | row upserts, no dupes (DB UNIQUE + pipeline code) |

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
- **Encoders:** trait `Encoder` with a `NullEncoder` (drops frames, writes placeholder NALs) for pipeline logic tests; `sw_x264` is the real-oracle integration encoder used in CI (fast CPU path); hw encoders are *manual-matrix* tested (CI can't guarantee GPUs).
- **Filesys:** tempdirs (`tempfile` crate) per test; mock fs layer for ENOSPC/EPERM injection keeps the failures deterministic.
- **DB:** real SQLite in a per-test tempdir through the real migrations (DATABASE §8 — the `user_version` runner is itself tested); fixtures are SQL fixtures from DATABASE §7, not hand-built objects.
- **IPC:** frontend tests run against a typed mock store implementing `lib/ipc.ts` interface (the contract), with fuzzed event firing; contract parity is asserted by a shared JSON schema generated per version (kept in `src-tauri/ipc/schema.json` and imported by `types/ipc.ts`) — drift = instant red CI.
- **Recordings fixtures:** five golden MKV/MP4 files (different containers, code rates) in `src-tauri/tests/fixtures/`, committed at real but tiny sizes, used as ffprobe/feed inputs.
- **Time:** injectable clock into session controller (`tick` independence from wall time) — pause-stitch tests are deterministic to ms.
- **Compositor truth:** `docs/portal-support.md` is the fixture-ish artifact — the manual matrix (M1/M2/M6/M12/M13) results get logged there per COMPOSITOR; CI covers mocked paths only, manual covers hardware truth.

---

## 6. Coverage targets & commands

**Targets (measured at PR level, no vanity):**

| Area | Target | Rationale |
|---|---|---|
| Rust pipeline/encode/capture/state | ≥ 85% line, ≥ 80% branch | the money path deserves the floor |
| Rust ipc + settings + library | ≥ 80% | thin glue, high contract risk |
| Frontend stores + ipc + errors | ≥ 85% | projection layer |
| UI components | (not % — state coverage instead) | every §5 state asserted somewhere (manual + JS) |
| Overall hard floor | 80% | never gate a PR on a delta < 2pp |

**Commands (⚠ labels here follow SETUP.md — they become real.exe in PLAN 0.x):**
```bash
# everything (Rust + TS) — the pre-PR gate, also run by ci.yml
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings \
  && (cd src-tauri && cargo test) \
  && npm run lint && npm run typecheck && npm run test

# per-side fast loops
cargo test -p screen-studio-pro        # Rust unit+integration
cargo test -p screen-studio-pro -- --ignored  # include ffmpeg-oracle S-tier tests
npm run test -- --coverage            # vitest + coverage report
npm run test -- src/lib               # contract tests only

# property tests (subset)
cargo test proptest

# manual e2e shell suites (compositor hardware; see §7)
tests/e2e/run.sh                    # ffprobe/sqlite/jq assertions after scripted sessions
```

**Reporting:** CI publishes coverage summary; regressions > 2pp are review-blockers; per-feature table updates ticked alongside FEATURE loop PRs.

---

## 7. Manual QA checklist (pre-release — PLAN Phase 7 gate)

Run on: Arch + Hyprland (primary), Fedora + KDE Wayland, plus a MangoWC/niri smoke pass. Report against `docs/portal-support.md`.

**Install & first-run**
- [ ] Distro package installs clean (`pacman`/`deb`/`rpm`); icon + .desktop land; app in app drawer
- [ ] Fresh profile: portal prompt → monitor select → record 60s — clock the `install→first saved file` (<60s target, PRD G3)
- [ ] About pane versions correct incl. `ipcContract`

**Recording core**
- [ ] Monitor / window / region each record a correct-resolution file (ffprobe evidence archived)
- [ ] Pause/resume/flag/idempotent-spam — M7 checklist green on real hardware
- [ ] kill -9 crash pairs: files all playable (`tests/e2e/run.sh` re-run after crash)
- [ ] A/V listen: 10-min take drift check; lip-sync feel + ffprobe offset
- [ ] x264 fallback path on a no-HW VM → warning notice appears, recording fine

**Audio**
- [ ] Mic levels: silence → dynamics marker above −6 dB peak; noise-floor sanity check in silence
- [ ] Mute mic: A/B byte-honest check; desktop audio intact
- [ ] Unplug/replug devices mid-session → chips reflect reality; no crash

**HUD / PiP**
- [ ] HUD on top of: fullscreen video, tabbed browser, terminal emulators per compositor; documented any inability
- [ ] Drag + snap at all corners; pin; double-click; reduced-motion honored
- [ ] PiP: drag/resize/snap; self-insert parity test; signal ring only during session

**Library**
- [ ] 100+ generated recordings → swarm via seeded scripts; speed + UX sanity
- [ ] Delete/restore `missing` file-state cards behave; focus restore works keyboard-only
- [ ] Saved-toast Reveal opens file; Copy copies exact path

**Settings & shortcuts**
- [ ] Every control roundtrip survives restart; broken TOML rescue path
- [ ] Global hotkeys on KDE: grant dialog, gate-keeping when combo is taken
- [ ] Tray: quick-record, pause, stop, quit — all work; no dead items

**A11y + polish (pre-release blockers)**
- [ ] Keyboard-only full walkthrough of MVP flows (a11y §7)
- [ ] Reduced-motion run: idle pulse off, no scale springs
- [ ] Light mode full pass: no contrast violations (DESIGN §7)
- [ ] Error-copy audit: simulate `portal.denied`, `disk.no_space`, `encoder.unavailable`, `settings.schema_mismatch` — human copy everywhere, zero raw strings
- [ ] Archive screenshots for README (replaces placeholders) + release notes columns in `docs/portal-support.md`
- [ ] Performance soak: 30-min 1080p60 recording — RSS < 150MB, dropped < 0.5%, meter CPU negligible; numbers archived to release notes

**Pre-release sign-off**
- [ ] All P0/P1 CI tests green; release build from clean checkout
- [ ] Every FEATURES.md acceptance checklist ticked with evidence
- [ ] PLAN.md Phase 7 tasks 7.1–7.6 all green; CHANGELOG + release notes written
- [ ] This file's ⚠ labels retired (commands verified against the real scaffold)
