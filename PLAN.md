# PLAN.md — ScreenStudio Pro MVP Implementation Roadmap

**Version:** 1.0 · **Authority chain:** PRD.md (scope) → ARCHITECTURE.md (structure) → PLAN.md (order of work)
**Working rule:** every phase ends with a **runnable app** (vertical slices — `cargo tauri dev` produces real behavior at each phase boundary, never "backend first, UI later"). Tasks are sized ≤ 1–2 hours. The rulebook for executing any task is [AGENTS.md](AGENTS.md).

**Adaptation note:** the standard "Auth" phase is intentionally absent — this desktop app has no credentials/roles (PRD non-goal N6). "Integrations" here means system integrations (portals, PipeWire, V4L2), which are distributed inside the slices rather than a late phase, because capture *is* the product.

---

## Phase 0 — Foundation (runnable: glass app window opens)

> Goal: scaffold, design tokens live, settings + DB infrastructure idle-waiting. No capture yet.

- [x] **0.1 Scaffold Tauri 2 + React 19 + TS + Vite workspace** — `npm create tauri-app` (Rust/React-TS template), pin versions per ARCHITECTURE §1; `cargo tauri dev` shows stock app. *Files:* `src-tauri/*`, `src/*`, configs. *Verify:* dev window opens; `cargo clippy -D warnings` + `tsc --noEmit` clean from day one (CI mirrors this from 0.3). *Depends on:* — *(Done: Tauri 2.12 / React 19.1 / TS 6 / Vite 8 / edition 2024; verified clippy + tsc clean, dev window ran on Wayland.)*
- [x] **0.2 Install the chosen dependency set** — Tailwind v4, framer-motion, zustand, dnd-kit, lucide-react, shadcn/ui init; Rust: `ashpd`, `pipewire-rs`, `cpal`, `ffmpeg-next` feature-gated (compile-only this phase), `rusqlite`, `thiserror`/`anyhow`, `tracing*`, `config` + `v4l2r` (behind feature flag). This is the single approved batch of AGENTS §4.2 asks. *Files:* `package.json`, `src-tauri/Cargo.toml`. *Verify:* both ecosystems compile; `ffmpeg-sys-next` builds against system dev libs. *Depends on: 0.1, user OK* ⚠ *Deviation: `ffmpeg-devel` headers absent (no sudo in session) — media crates are optional behind `encode`/`camera` features, so `ffmpeg-sys-next` compile-check is deferred to task 1.3 after `sudo dnf install ffmpeg-devel`. shadcn/ui component init moved to 0.4 (components generated when first needed).*
- [ ] **0.3 Repo hygiene** — `.github/workflows/ci.yml` (fmt, clippy, tsc, test), `.editorconfig`, issue templates, `docs/` placeholder, branch protection stub. *Verify:* CI runs green on the docs-only diff. *Depends on:* 0.1
- [ ] **0.4 Window chrome + NavBar skeleton** — custom CSD window (`decorations: false`), 52px Pane recipe top bar with app mark + Record/Library/Settings segmented control + Stream pill (disabled, "V2") per DESIGN §5.8. *Files:* `src/components/chrome/NavBar.tsx`, `src/App.tsx`, `src-tauri/tauri.conf.json`. *Verify:* window renders glass top bar; segmented control switches views (stub panels); compact window (<720px) doesn't break layout. *Depends on:* 0.1, 0.2
- [ ] **0.5 Tailwind `@theme` from DESIGN.md tokens** — full token set (§2–§4: colors dark+light, spacing, radii, shadows, motion) with `/* DESIGN.md v1.0 */` provenance; both faces self-hosted (`FamiljenGrotesk`, `JetBrainsMono`) via `@font-face`. *Files:* `src/tailwind.css`, `src/fonts/*`. *Verify:* swatch page toggling `light` class renders both palettes; mono figures are tabular. *Depends on:* 0.2
- [ ] **0.6 Typed IPC skeleton** — `src-tauri/src/ipc/{commands,events}.rs`, `types/ipc.ts`, `lib/ipc.ts`, `lib/events.ts` mirroring API.md §1 error shape + `system_capabilities` + `ipc.hello` handshake returning `{ipcContract:"1.0.0"}`. *Files:* per ARCHITECTURE tree. *Verify:* boot checks version, mismatch renders boot-error screen. *Depends on:* 0.1
- [ ] **0.7 Settings store** — `settings/{mod,defaults}.rs` (TOML at XDG config dir, defaults per PRD G3), `SSP_CONFIG_DIR` honored; commands `settings_get/set` wired to schema validation (`settings.invalid_value`). *Verify:* hand-edit TOML → app picks it up on restart; invalid value → typed error. *Depends on:* 0.6
- [ ] **0.8 DB migrations runner** — `library/store.rs` with `PRAGMA user_version` runner + `sql/0001_recordings.sql`, `sql/0002_ui_prefs.sql` embedded; `prefs_get/set` commands live. *Verify:* fresh start creates `library.db` (WAL, 0600), seed rows from DATABASE §7.1 present; `prefs_set` upserts. *Depends on:* 0.6
- [ ] **0.9 Logging + util** — `tracing-subscriber` file+stdout, `util/{paths,error}.rs` (`CoreError`, XDG dirs), `SSP_LOG_LEVEL`/`SSP_LOG_FILE`. *Verify:* boot writes rotating log; forced bad path logs clearly without panic. *Depends on:* 0.1

**Definition of Done — Phase 0:** app launches to a themed glass window with working nav, typed errors, logging, config load, seeded DB; `tsc`, clippy, fmt, CI green; UI-only screenshots show no token drift from DESIGN.md.

---

## Phase 1 — First Recording (runnable: real 10-second monitor recording saved)

> Goal: the thinnest end-to-end vertical slice: monitor source → x264 → MKV saved → library row written.

- [ ] **1.1 Portal screencast session** — `capture/portal.rs` + `capture/pipewire.rs`: `source_select(kind=monitor)` via ashpd → frame consumption loop → capture trait; event `evt://source/lost` wired. *Files:* `src-tauri/capture/*`, `ipc/commands.rs`. *Verify:* Hyprland/KDE manual run: consent dialog → Rust receives ≥ 1 fps debug frames logged (never sent to webview). *Depends on:* 0.6, 0.9
- [ ] **1.2 Mutex-less frame bus** — `pipeline/mod.rs` SpSC handoff + backpressure policy (ARCHITECTURE §6: drop preview before encode frames behind a feature-flagged comment). *Verify:* unit test with N synthetic frames; asserts no unbounded growth. *Depends on:* 1.1
- [ ] **1.3 x264 encoder → MKV writer** — `encode/sw_x264.rs`, `pipeline/muxer.rs`: fixed 1080p60 medium preset from captured dims; writes `$XDG_VIDEOS/SSP/first-rec.mkv` on `recording_start`/`recording_stop`. *Files:* encode/, pipeline/. *Verify:* ffprobe shows valid h264 stream, correct duration; crash-kill test leaves playable MKV. *Depends on:* 1.2
- [ ] **1.4 Recording session events** — `recording/started`,`tick`(1Hz),`error`,`finished` emission + throttling scaffolding (stats stub). *Files:* `src-tauri/pipeline/stats.rs`, `src-tauri/ipc/events.rs`, `src/lib/events.ts`. *Verify:* UI log console receives events at documented cadences (arch §6 law). *Depends on:* 1.3
- [ ] **1.5 Record view slice 1** — SourceDeck (monitor chip only + solid preview frame placeholder via decoded still), ActionRow with 48px Record button wired to `recording_start/stop`; loading/disabled/error states per DESIGN §5.1. *Files:* `src/components/record/*`. *Verify:* click → consent → button transitions to HUD-over-canvas state → file lands; error path shows human copy on portal deny. *Depends on:* 1.3, 1.4
- [ ] **1.6 Library row upsert on stop** — pipeline writes `recordings` row (status finalizing→ready) per DATABASE §2.1; `library/updated` event. *Verify:* sqlite3 readback shows full row incl. `updated_at`. *Depends on:* 1.3
- [ ] **1.7 Minimal saved-file feedback** — toast (Float recipe) with path + Reveal action on `finished`. *Files:* `src/components/chrome/ToastHost.tsx`. *Verify:* stop → toast appears with correct path; platform open on file works. *Depends on:* 1.5, 1.6

**Definition of Done — Phase 1:** from cold start, on Hyprland or KDE, user selects monitor, presses Record, records 10s, stops, and gets a playable MKV + a library row + a saved-path toast. Errors (portal deny) present human copy, not raw strings.

---

## Phase 2 — Audio + recording controls (runnable: recordings with sound, pause/resume, floating HUD)

- [ ] **2.1 cpal mic capture + PipeWire desktop audio** — `capture/audio.rs`, `audio_list_devices`, `audio_set_channel`; mix into encoder audio streams. *Verify:* record and listen: mic voice + system sound present; devicegone mid-recording produces `pipewire.audio_device_gone` event handled gracefully. *Depends on:* 1.x
- [ ] **2.2 Audio strip UI** — AudioStrip channel cards (enable switch, meter bar idle→live, device popover), wire `recording/meters` events. *Verify:* speak → bars move; mute reflected in output file (listen A/B). *Depends on:* 2.1
- [ ] **2.3 Pause/resume + segment stitching** — `recording_pause/resume`; muxer inter-segment continuity; `tick` state field, `ipc.bad_state` errors. *Verify:* pause 10s → resume: output duration excludes paused time; final file is one continuous, cleanly playable take. *Depends on:* 1.3
- [ ] **2.4 HUD window** — `huds/HudBar.tsx` in a transparent always-on-top Tauri Float window: rec-dot pulse, `mono-md` timer from `tick`, pause/stop/flag buttons per DESIGN §5.9; tab-cyclic keyboard. *Verify:* visibly overlays content while a fullscreen window is behind it; draggable; `prefers-reduced-motion` disables pulse. *Depends on:* 1.4
- [ ] **2.5 Flag/chapter markers** — `recording_flag` command appends `chapter_json` + `recording/flagged` event + HUD tick feedback. *Verify:* flag 3× → sqlite JSON array readback; stopped. *Depends on:* 2.4
- [ ] **2.6 Tray + minimize-to-tray on record** — tray icon + quick actions; window hides during recording (PRD flow §7.5). *Verify:* recording started → main window hides; tray menu actions work. *Depends on:* 2.4

**Definition of Done — Phase 2:** user records voice + desktop video, pauses mid-take (clean edits), flags chapters, controls it all from the floating HUD with the main app in tray. Meters animate; no crashes when devices vanish.

---

## Phase 3 — Sources & encoders maturity (runnable: window + region recording, hw encoder detection + presets)

- [ ] **3.1 Window capture** — portal user-picker path; graceful "not supported" education slot in compositors lacking it (PRD M2, docs/portal-support.md table started). *Verify:* pick window on KDE → recording contains only that surface; niri/GNOME fallback matches documented capability matrix. *Depends on:* 1.1
- [ ] **3.2 Region capture** — drag-rect overlay canvas + `source_region_set` + crop in `pipeline/composite.rs`; arrow-key nudge (1px/shift 10px) per DESIGN §7. *Verify:* crop math unit test; manual: select 720p rect → output exactly that size. *Depends on:* 1.1
- [ ] **3.3 Capability probe + encoder traits** — `system_capabilities` real implementation; `encode/mod.rs` trait + VAAPI + NVENC impls with auto-select chain + `SSP_FORCE_ENCODER`. *Verify:* on Intel test box picks vaapi (log); broken NVENC env → visible x264 fallback notice in UI chip (DESIGN §6.1). *Depends on:* 1.3
- [ ] **3.4 Quality presets** — `presets_list` static TOML presets (YouTube/Discord/lossless/smallest), ActionRow preset select wired into start payload; plain-language descriptions per PRD M11. *Verify:* switching preset changes ffprobe dims/bitrate accordingly. *Depends on:* 3.3
- [ ] **3.5 Stats + preview stills** — decode thumbnails at ≤8fps webview preview per ARCHITECTURE §3.1 preview law; `recording/stats` real values. *Verify:* preview visibly updates; webview memory stable (no leak) recording 5min. *Depends on:* 1.4, 3.1–3.2

**Definition of Done — Phase 3:** users record by window and region, hardware encoder is picked automatically with honest fallback notice, and the source preview pane shows real content without dragging recording performance.

---

## Phase 4 — Camera PiP (runnable: webcam in the glass frame, composited into output)

- [ ] **4.1 V4L2 camera viewer** — `capture/camera_v4l2.rs` behind async task, `camera_open/close`, hotplug event; portal-fallback stub returns compliant error. *Verify:* open/close camera without deadlock; device unplugged mid-open handled. *Depends on:* 1.x
- [ ] **4.2 PiP overlay UI** — `huds/CameraPip.tsx` (Float recipe circle/rounded toggle, dnd drag + corner snap, resize 44px handle, signal ring during recording) per DESIGN §6.6. *Verify:* drag to all corners; resize within 160–320px; reduced-motion satisfies. *Depends on:* 4.1
- [ ] **4.3 Compositing into encode** — `pipeline/composite.rs` overlay stage: shape mask, position/scale, optional self-insert disabled by default; camera settings pane (design §6.4). *Verify:* recorded file shows the PiP exactly where the UI showed it; UI-only preview parity. *Depends on:* 4.2
- [ ] **4.4 Camera settings pane + prefs** — pip shape/size/position/self-insert persisted via ui_prefs; "Add camera" education slot when off (§6.3). *Verify:* restart keeps position; self_insert=false matches recorded rectangle. *Depends on:* 4.3

**Definition of Done — Phase 4:** toggle webcam → glass PiP appears, user places it, records; recording contains exactly what the overlay showed, and its place remembers across restarts.

---

## Phase 5 — Library (runnable: full library experience, real data)

- [ ] **5.1 Thumbnail service** — `library/thumbs.rs` ffmpeg frame → PNG cache at `thumbs/`, scheduled post-finalize (never blocks view mount). *Verify:* 10 recordings → thumbs exist; deleting thumb row regenerates on next open attempt. *Depends on:* 1.6
- [ ] **5.2 LibraryGrid UI** — card item tokens (thumb tile, duration chip, meta row, hover action row: open/copy/delete-danger) with loading skeletons + `search`/`sort` query per API §2.4 (limit 50, `Show more`). *Files:* `src/components/library/*`. *Verify:* screen `library_list` pagination; card interactions fire correct commands; hover meets DESIGN §5.5. *Depends on:* 5.1
- [ ] **5.3 RecordingDrawer** — detail drawer (§5.7) with metadata table + Reveal action + chapter list, disabled "Trim later V" tooltip rule. *Verify:* drawer opens/closes with focus trap; Esc restores focus. *Depends on:* 5.2
- [ ] **5.4 Deletion flows** — soft delete via `library_delete` + confirm modal (danger per §5.1) + ` deleted_at` hide logic verified against `library_list` filter. *Verify:* deleted disappears immediately; DB preserves the row (soft delete audit in sqlite). *Depends on:* 5.2
- [ ] **5.5 Empty + error states** — per DESIGN §6.3 exact copy/patterns incl. search-empty & missing-file (`status='missing'` error card + retry). *Verify:* screenshot review vs DESIGN.md checklist for all four empty states. *Depends on:* 5.2

**Definition of Done — Phase 5:** library grid stays fast over 100 seeded recordings; find/open/delete flows all safe; no raw DB errors visible; keyboard-only navigation passes.

---

## Phase 6 — Settings, shortcuts & save polish (runnable: fully configurable, hotkey first-class)

- [ ] **6.1 Settings panes** — all six tabs (Capture/Audio/Camera/Files/Shortcuts/About) wired to `settings_get/set` with validation, plain-language preset descriptions (PRD §7.5), 560px reading column per DESIGN §6.4. *Verify:* every control persists and reloads; disabled/broken logic flagged at review vs schema mismatches. *Depends on:* 0.7, 3.x, 4.x
- [ ] **6.2 Output patterns & remux toggle** — file naming `%Y-%m-%d-%H%M`, MP4-remux on/off setting; `recording_stop` respects. *Verify:* filenames match pattern; remux-off leaves MKV as final. *Depends on:* 6.1
- [ ] **6.3 Global shortcuts via portal** — `shortcuts_apply` (ashpd GlobalShortcuts), Settings listing + tray fallback notice per PRD risk; bindings toggle-record/pause/stop. *Verify:* KDE: portal binding prompt; binding fires recording toggle while app unfocused; MangoWC: documented fallback into docs/portal-support.md. *Depends on:* 2.6
- [ ] **6.4 First-run education moments** — preview-not-granted slot, mic silent hint, capability transparency panel ("Runtime capabilities" per PRD risk mitigation). *Verify:* fresh profile walkthrough manual ≤60s to first recording (PRD G3 metric logged). *Depends on:* 6.1

**Definition of Done — Phase 6:** complete settings surface persists; record hotkey works system-wide where the compositor supports it; fresh-install metric achieves <60s-to-first-recording on the test machines.

---

## Phase 7 — Polish & Launch (runnable: releasable distro-packaged app)

- [ ] **7.1 Light mode audit** — both modes rebuilt per DESIGN §2.3/§8 (never light-as-afterthought): swatch screenshot pass over Record/HUD/Library/Settings. *Verify:* every composited glass layer keeps 4.5:1 in light mode; screenshots archived in docs/. *Depends on:* 5.x, 6.x
- [ ] **7.2 Accessibility sweep** — full keyboard pass (§7), focus visible in HUD + PiP + drawers, `aria-label`s, reduced-motion, screen-reader smoke test. *Verify:* `better-accessibility`-style checklist output clean or fixed. *Depends on:* 5.x, 6.x
- [ ] **7.3 Error copy sweep** — all `CoreError` branches produce §1 `userMessage`s from the §7.9 vocabulary; raw-strings audit script. *Verify:* simulate each error code; UI copy correct with detail-only in log. *Depends on:* 1–6
- [ ] **7.4 Perf validation** — RSS guard (<150MB @1080p60), dropped-frame metric (<0.5%), event throttling conformance, memory soak 30min. *Verify:* recorded harness results attached to the PR (PRD §8 targets). *Depends on:* 3.x
- [ ] **7.5 Packaging** — `packaging/aur/PKGBUILD` (with real git-tag source), deb + rpm spec + icons; CI `release.yml` artifacts; README install steps finalized (replacing the kept-honest placeholder). *Verify:* builds + installs clean on Arch/deb/rpm test VMs; `pacman -Qi`/`dpkg -i`/`rpm -i` success. *Depends on:* 7.4
- [ ] **7.6 Launch docs** — README screenshots replaced with real captures, CHANGELOG v0.1.0, release notes incl. capability matrix table + known quirks, AUR announce. *Verify:* link check, screenshot freshness audit. *Depends on:* 7.5

**Definition of Done — Phase 7 (MVP shippable):** tagged release with distro packages, real screenshots, honest capability matrix, a11y/perf evidence, and PRD success metrics instrumented (time-to-first-recording, crash rate via tracing aggregation). Streaming tab remains the DESIGN-mandated "V2" pill — nothing shipped early.

---

## Dependency map (phase level)

```
0 ──▶ 1 ──▶ 2 ──▶ 3 ──▶ 4 ──▶ 5 ──▶ 6 ──▶ 7
                ▲____________________|
        (5 Library needs 1.x rows; 6 needs 3/4 pane content; 7 audits everything)
```

Hard rules the map encodes: 1.x unlocks everything behind it; 5 starts only after phase 1 writes real rows; 6.3 can slip behind 7 without blocking 4/5; light mode (7.1) is a launch gate, not a deferred afterthought (DESIGN §8).
