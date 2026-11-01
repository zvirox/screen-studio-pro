# FEATURES.md — MVP Build Guide

**Version:** 1.0 · **Authority chain:** PRD.md (M-features) → FEATURES.md (how each is built) → PLAN.md (order/checkboxes)

**Execution law (per your rule):** build **one feature at a time**, strictly in the order below (mapped onto the PLAN.md vertical slices). After finishing a feature: tick its mapped PLAN.md checkboxes (each guide's *Build order* names them), verify the acceptance checklist in-app, **stop and wait for user confirmation** before starting the next.

**Shared ground (not repeated per feature):** every UI detail from DESIGN.md §2–§5 tokens/components; every error surfaces in the API.md §1 shape; full states (default/hover/focus/active/disabled/loading/error) per DESIGN §5; DB writes only through the pipeline (ARCHITECTURE §4); verification always includes `cargo clippy -D warnings`, `tsc --noEmit`, tests passed, and a manual run on real compositor hardware (Hyprland or KDE minimum).

---

## F-M1 — Monitor Capture

- **What & story:** Record one full monitor through the portal — the guaranteed-baseline source (PRD risk mitigation). *Story:* "As a riced-Hyprland user, I want to pick my monitor through a modern-looking picker, so that recording feels native to my setup."
- **Screens & components:** Record view `SourceDeck` monitor chip (lucide `monitor`, capability line in `mono-sm`); live preview frame (§6.1, stills ≤8fps); grant education slot (§6.3); NavBar Record segment (§5.8). Compact window: chips collapse to segmented control.
- **Database & API:** DB — no row until stop (`recording_stop` inserts). API — `source_select` (kind `monitor`), `source_release`, `recording_start`/`recording_stop`, events `recording/*`, `source/lost`.
- **Build order:** ① `capture/portal.rs` — ashpd screencast session + consent (PLAN 1.1) → ② `capture/pipewire.rs` frame consumption (1.1) → ③ `source_select`/`source_release` commands + preview-stills task (partial 3.5: one still refresh acceptable until Phase 3) → ④ SourceDeck chip + education slot (1.5) → ⑤ wire into `recording_start` payload.
- **Edge cases, validation, states:** multi-monitor → one chip per output, remembered per-session only (ephemeral UI per ARCHITECTURE §4 — no DB write); consent denied → `portal.denied` + education slot, no glossy toast (inline, retryable); monitor unplugged mid-recording → `source/lost` → clean stop with `pipewire.stream_lost` copy, MKV preserved; compositor without portal backend → `portal.unavailable` inline. Validation: unknown output target → `portal.timeout`-family error, never a blank preview.
- **Acceptance criteria:**
  - [ ] Consent dialog appears on first selection; preview updates right after grant
  - [ ] Recording yields a file of exactly that monitor's resolution at preset fps (ffprobe-verified)
  - [ ] Denied consent → inline education slot; zero raw errors in UI
  - [ ] Monitor gone mid-take → safe stop, playable file, human copy
  - [ ] Works on Hyprland **and** KDE with zero compositor-specific hacks (portal path only)

## F-M2 — Window Capture

- **What & story:** Record a specific app window where the portal offers it; degrade gracefully where it doesn't. *Story:* the M1 Ricer story extended — "monitor **or window**."
- **Screens & components:** SourceDeck window chip (lucide `app-window`); system portal user-picker (native dialog, unstyled by us); capability notice + `docs/portal-support.md` row.
- **Database & API:** DB — none until stop. API — `source_select` kind `window`; chip visibility gated by `system_capabilities`.
- **Build order:** ① extend portal session to window mode → ② capability detection: chip present-but-disabled with tooltip "This compositor's portal doesn't offer window capture" (never silently hidden) → ③ reuse the M1 frame path for the window handle. *(PLAN 3.1.)*
- **Edge cases, validation, states:** window closes mid-recording → handled as `source/lost` (same recovery as monitor unplug); window resizes → follow requested geometry, letterbox if the source shrinks (documented, no styling ambition this feature); portaled window list quirks per compositor → recorded in docs, never worked around with hacks.
- **Acceptance criteria:**
  - [ ] Captured file contains only the window's content (wallpaper excluded)
  - [ ] Window closed mid-take → clean stop, playable file, honest message
  - [ ] Unsupported compositor → disabled chip + tooltip (discoverability preserved)
  - [ ] `docs/portal-support.md` updated with tested results per compositor

## F-M3 — Region Capture

- **What & story:** Record an arbitrary rectangle, cropped from a monitor stream. *Story:* commuter demo recording — "region where the code demo lives."
- **Screens & components:** SourceDeck region chip (lucide `scan`); draggable rect overlay (dnd-kit) with `mono-sm` W×H readout; arrow-key nudge 1px / Shift+10px (DESIGN §7.4).
- **Database & API:** DB — none until stop. API — `source_select` kind `region` + `source_region_set` (rect validation), error `capture.region_invalid`.
- **Build order:** ① capture full monitor and crop at the compositing stage (`pipeline/composite.rs`) — never one stream per region → ② overlay UI: drag, 2px grid snap, live size → ③ validation: min 64×64, within monitor bounds, integers only, pre-submit rejection. *(PLAN 3.2.)*
- **Edge cases, validation, states:** rect resize mid-recording → locked at start (live-resize is not promised in PRD M3 — code comment tags it as future `zoom` land); 1440p monitor with 1080p rect → exact crop mapping verified; region is per-session (no persistence — nothing to restore).
- **Acceptance criteria:**
  - [ ] Output dimensions equal the selected rect exactly (ffprobe px-verified)
  - [ ] Keyboard nudge at both increments; overlay live-size readout in mono
  - [ ] Invalid rects rejected before recording with inline field error (§5.2)
  - [ ] Exactly ONE portal stream consumed regardless of region (log-verified)

## F-M4 — Audio Sources (mic + desktop)

- **What & story:** Two independent channels — mic + system audio — with device pickers, mute, live levels. *Story:* "As a user, I want to see which mic and which system outputs are active, so that 'the right sound got recorded' is not a mystery."
- **Screens & components:** AudioStrip (§6.1 slot 3): channel cards, 4px meter bars (`accent` fill, `signal` peaks over −6dB), per-channel switch, device popover (§5.3), silent-mic hint (§6.3), Settings→Audio pane rows.
- **Database & API:** DB — channels recorded as `audio_json` on the row at stop. API — `audio_list_devices`, `audio_set_channel`, events `recording/meters` (≤30Hz), `device/changed`.
- **Build order:** ① cpal mic chain (default device first) → ② PipeWire default-sink monitor tap → ③ mix into the encoder input (48kHz stereo, container/codec per preset) → ④ meters computation + Rust-side event coalescer → ⑤ AudioStrip live. *(PLAN 2.1–2.2.)*
- **Edge cases, validation, states:** device unplug mid-take → `pipewire.audio_device_gone` event; UI shows that channel as "device gone" state chip, encoding continues with the remaining channel; all-audio-muted recording is legal (video-only) but shows the silent-mic hint; unknown deviceId in payload → `settings.invalid_value`; MVP = one mic + one desktop channel (multi-mic is not in PRD and is not built).
- **Acceptance criteria:**
  - [ ] A/V sync ≤ 100ms over a 10-min take (PRD §8 metric, logged during verify)
  - [ ] Meters coalesed ≤ 30Hz (Rust-side assert — webview never sees per-sample events)
  - [ ] Mute is respected byte-for-byte in the output (A/B listen test)
  - [ ] Unplug mid-take → recording survives, UI state reflects reality, no crash
  - [ ] Device lists show real PipeWire/cpal devices with defaults pinned

## F-M5 — Webcam PiP

- **What & story:** Draggable glass camera frame in the UI; composited into the output only when "self-insert" is on (default off). *Story:* "As a creator, I want my webcam in a rounded, floating glass PiP frame, so that my recording looks like Screen Studio without buying a Mac."
- **Screens & components:** CameraSlab — "Add camera" ghost chip when off, live preview when on (§6.1 slot 4); `huds/CameraPip.tsx` — Float recipe, circle/rounded toggle, drag + 44px resize + 8px corner snap, 2px `signal` ring while recording (§6.6); Settings→Camera pane.
- **Database & API:** DB — geometry lives in `ui_prefs` (`pip.shape`, `pip.position`, `pip.size`, `pip.self_insert`). API — `camera_open`/`camera_close`, `prefs_get/set`, `device/changed`.
- **Build order:** ① `capture/camera_v4l2.rs` direct V4L2 first, portal Camera only as fallback (ARCHITECTURE resolved Q1) → ② PiP overlay UI (drag physics, snap guides, shape/size) → ③ `pipeline/composite.rs` overlay stage (mask, scale, position) → ④ self-insert toggle (default **off**) + camera settings pane + restart persistence. *(PLAN 4.1–4.4.)*
- **Edge cases, validation, states:** no camera on machine → chip hidden, no error spam; camera busy (used elsewhere) → `capture.camera_unavailable` inline on the slab; camera unplugged with self-insert on → last-frame freeze + `device/changed` notice (recording survives); hotplug while PiP open → auto-reattach, no modal. Validation: PiP clamped 160–320px, position within window bounds.
- **Acceptance criteria:**
  - [ ] UI PiP position matches composited output position exactly (side-by-side test)
  - [ ] Shape/size/position survive restart via `ui_prefs`
  - [ ] self_insert=false → zero camera frames in the output (encoder-log proof)
  - [ ] 2px `signal` ring only while recording is live
  - [ ] Unplugged camera mid-take (self-insert on) → frozen-frame + honest UI, session continues

## F-M6 — Floating Recording HUD

- **What & story:** The glass toolbar living above captured content during a session. *Story:* "As a user, I want pause/resume in a single quiet toolbar, so that a tutorial with mistakes comes out as one clean file."
- **Screens & components:** `huds/HudBar.tsx` in a dedicated transparent always-on-top, skip-taskbar Tauri window — Float recipe, 46px, `r.full`: rec-dot pulse, `mono-md` tabular timer, pause/stop/flag icons, drag-anywhere + 8px corner-snap ghosts, double-click pin (0.85 opacity), tab-cyclic keyboard, ≥44px targets (§5.9, §7.6).
- **Database & API:** DB — none (session state only). API — consumes `recording/tick` (1Hz), optionally meters display cap; issues `recording_pause`/`recording_resume`/`recording_stop`/`recording_flag`.
- **Build order:** ① second window config (transparent, alwaysOnTop, Wayland overlay-safe) → ② full HUD anatomy + states (rec/paused/stop-hover) + keyboard → ③ drag + snap guides → ④ main-window hide-to-tray on start; NO "Recording started" toast while HUD visible (§6.5 law). *(PLAN 2.4.)*
- **Edge cases, validation, states:** Wayland overlay limits per compositor (some stack fullscreen apps above overlays) → capability panel documents it, no hacks to defeat focus stealing; 60min+ takes → timer stays fixed-width (tabular figures); stop-while-paused → legal, saves stitched segments; rapid start/stop spam → idempotent guards in the session controller.
- **Acceptance criteria:**
  - [ ] Floats above normal app windows on all four targets (per-compositor limitation documented, not hacked)
  - [ ] Timer pixel-stable past 1 hour ; pulse disabled under reduced-motion
  - [ ] Full keyboard control; focus ring visible on all four controls
  - [ ] No "Recording started" toast while the HUD exists (double-telling law)
  - [ ] Drag + corner snap verified at all four corners

## F-M7 — Recording Controls (start/pause/resume/flag/stop state machine)

- **What & story:** Session lifecycle owned by the pipeline state machine; surfaced by HUD + main window. *Story:* M6's story plus the flagger flow (PRD §7.2).
- **Screens & components:** HUD buttons, NavBar recording variant, flag tick on the timer chip, stop flow: shutter flash (once) → Saved toast → Library highlight (§6.5).
- **Database & API:** DB — `chapter_json` appends; final row UPDATE at stop (`status` finalizing→ready). API — `recording_start/pause/resume/stop/flag`; events `recording/{started,tick,paused,flagged,finished,error}`; `ipc.bad_state` on illegal transitions.
- **Build order:** ① `pipeline/mod.rs` state machine (idle→recording↔paused→finalizing→ready/failed, typed transitions only) → ② pause = segment boundary + encoder drain (continuation, not a restart) → ③ flag append (JSON, auto-label `flag-N`, offset clamp >0) → ④ stop: mux close → remux → thumbnail → row finalize (built here, shared with F-M9) → ⑤ shutter + toast + Library highlight. *(PLAN 2.3, 2.5; stop-flow remainder of 1.4.)*
- **Edge cases, validation, states:** flag in the first 100ms → offset clamps to 0; duplicate flag same ms → offset+1; double stop → second call `ipc.bad_state`, UI no-op (idempotence from UI too); system suspend mid-take → on wake the portal stream is likely dead → `source/lost` path stops cleanly (documented limitation).
- **Acceptance criteria:**
  - [ ] Pause 10s → resume: output excludes the pause; one continuous take (stitch-verified by playback)
  - [ ] 3 flags → correct offsets in `chapter_json` + HUD tick each time
  - [ ] Lifecycle buttons idempotent under spam — no orphan segments, no double toasts
  - [ ] Shutter flash exactly once per session end
  - [ ] kill -9 during pause-boundary leaves a playable MKV (crash-safety test)

## F-M8 — Hardware Encoders (VAAPI/NVENC → x264)

- **What & story:** Auto-detect and prefer hardware encode; fall back visibly, never fail outright. *Story:* "As a user on a mixed GPU laptop, I want the app to just use my iGPU via VAAPI, so that I record at full fps silently."
- **Screens & components:** ActionRow encoder chip (`mono-sm`: VAAPI/NVENC/x264); x264 fallback notice with lucide `zap-off` — warning tone, non-blocking (§6.1); Settings→Capture encoder info; SSP debug note in About.
- **Database & API:** DB — `encoder`, `is_hw_encoder` columns on the row at stop. API — `system_capabilities.encoders` probe; start payload auto-selects per chain; on total failure `details.encoderChain` lists attempts.
- **Build order:** ① `encode/mod.rs` trait + probe (device enumeration, driver presence) → ② VAAPI impl → ③ NVENC impl → ④ auto chain NVENC→VAAPI→x264 at start (error only if ALL fail) → ⑤ chip + notice UI. *(PLAN 3.3.)*
- **Edge cases, validation, states:** driver present but session init fails → next chain entry (visible only as encoder change + log line); NVIDIA on unsupported kernel → x264 + notice; `SSP_FORCE_ENCODER` honored and logged as a deviation; color-format negotiation between capture and encoder resolved at wire-in; CPU-only verdict: 1080p60 x264 acceptable on ≥8 cores (preset medium).
- **Acceptance criteria:**
  - [ ] Intel/AMD test box picks VAAPI automatically (chip + log agree)
  - [ ] Broken-NVENC machine → recording still succeeds via fallback + visible warning notice
  - [ ] There is no user-visible path where "encoder unavailable" leaves the user stuck
  - [ ] `SSP_FORCE_ENCODER=x264` on HW-capable box → honored + logged as deviation
  - [ ] Row records actual encoder used

## F-M9 — File Output & Save Flow (MKV→MP4, naming, save dir)

- **What & story:** Crash-safe MKV recording, default remux to MP4, predictable file naming, correct save directory, informative saved toast. *Story:* "As a user, I want recordings saved as MKV and auto-remuxed to MP4, so that a crash doesn't lose the file and I still get an upload-ready output."
- **Screens & components:** Settings→Files pane (dir picker, naming pattern with live `mono` preview, remux toggle); Saved toast (`mono-md` duration, `mono-sm` path, Reveal + Copy actions, §5.6); disk-space inline handling.
- **Database & API:** DB — the `recordings` row **is** this feature's output (`path`, `file_name`, `container`, `status`, `duration_ms`, `size_bytes`). API — `recording_stop` full-row response; `settings_get/set` files section; errors `disk.no_space`, `disk.write_failed`, `disk.path_unwritable`.
- **Build order:** ① `pipeline/muxer.rs` MKV writer (crash-safety verified by kill-9 at three boundaries) → ② naming pattern expansion `%Y-%m-%d-%H%M%S` + collision suffix `-1` → ③ MKV→MP4 remux post-stop (setting default ON; failure keeps MKV + explains) → ④ Files pane + live preview → ⑤ Saved toast + Reveal. *(PLAN 1.3, 6.2, row from 1.6.)*
- **Edge cases, validation, states:** save dir deleted before stop → create-if-possible else `disk.path_unwritable` with a fix-it path (offered dir change); disk under 5% free at start → non-blocking inline warning; same-second name collision → suffixing, never overwrite (filesystem audit test); long filename > fs limit → truncate pattern segments safely; remux failure → original MKV kept, copy explains exactly what happened and where.
- **Acceptance criteria:**
  - [ ] kill -9 at start/mid/pause boundaries each leaves a playable MKV (three kill tests, documented)
  - [ ] remux=ON default produces `.mp4` rows; OFF produces `.mkv` rows — honored without re-record
  - [ ] Collisions suffix `-1`; overwrite never happens (regression test)
  - [ ] Disk-full → typed error + free-space guidance; partial artifact deleted (DATABASE-status `missing` won't be reachable from a stale row)
  - [ ] Saved toast Reveal opens the real file in the file manager

## F-M10 — Basic Settings (six tabs)

- **What & story:** The complete Settings surface: Capture / Audio / Camera / Files / Shortcuts / About. *Story:* the commuter — "one preset and one button"; settings serve those who want them, invisibly until opened.
- **Screens & components:** `settings/SettingsView.tsx` rail (§6.4) + six panes, 560px reading column, label+description+control rows, per-§5.2 validation.
- **Database & API:** DB — none (TOML per ARCHITECTURE; ui_prefs only for HUD/PiP geometry via Camera pane). API — `settings_get/set` (+`settings.schema_mismatch`), `audio_list_devices`, `camera_open` probe, `system_capabilities` (About), `shortcuts_apply` (Shortcuts tab).
- **Build order:** ① rail + pane plumbing → ② Capture pane (fps 30/60, preset mirror, encoder info, plain-language descriptions) → ③ Audio pane (devices, levels, echo-cancel hint) → ④ Camera pane (wraps F-M5's pane work; single owner) → ⑤ Files pane (wraps F-M9's) → ⑥ About (versions incl. `ipcContract`, licenses, GitHub). *(PLAN 6.1 spread across features by dependency order.)*
- **Edge cases, validation, states:** mid-recording → session-dependent controls disabled with "applies next recording" copy (never live-reconfigure an encoding session); hand-edited invalid TOML → boot-time `settings.schema_mismatch` toast, old values kept (never silently discarded); every control keyboard-first with visible focus.
- **Acceptance criteria:**
  - [ ] Every control roundtrips: set → restart → value intact (TOML readback spot audit)
  - [ ] Invalid TOML produces a human message + old values preserved
  - [ ] Mid-recording lock behavior honors the disable-with-copy rule everywhere it applies
  - [ ] All six panes pass DESIGN §6.4 layout & §5.2 validation patterns
  - [ ] About shows real versions incl. `ipcContract: 1.0.0`

## F-M11 — Quality Presets

- **What & story:** Plain-language bundles replacing encoder jargon. *Story:* "As a commuter, I want one preset ('For Discord') and one button, so that I don't have to learn what CBR and CRF mean."
- **Screens & components:** ActionRow preset select (left of Record, §6.1); Settings→Capture mirror select; default `youtube` on fresh install (ui_prefs seed, DATABASE §7.1).
- **Database & API:** DB — `last.preset_id` in ui_prefs. API — `presets_list` (static TOML), start payload `presetId`, `prefs_get/set`.
- **Build order:** ① 4 static presets in TOML (youtube/discord/lossless/smallest per PRD M11) → ② `presets_list` + ActionRow wiring → ③ last-used persistence → ④ Settings Capture mirror hydration (one data source, two views). *(PLAN 3.4.)*
- **Edge cases, validation, states:** unknown `presetId` at start → `settings.invalid_value`; lossless on HW-encoder box → accepted via HW CQP in MKV (quality semantics documented, never silently swapped); preset fps/height never surfaced as separate user controls in MVP (PRD M10 keeps them bundled); UI copy contains zero CRF/CBR/CQP jargon (PRD §7.5 law).
- **Acceptance criteria:**
  - [ ] Switching presets visibly changes output (ffprobe dims/fps/bitrate delta)
  - [ ] Copy reads exactly PRD §7.5 plain language
  - [ ] Last-used preset survives restart
  - [ ] Fresh install defaults to "For YouTube" (seed verified)
  - [ ] Adding a preset = TOML + API.md-flagged change, not scattered code

## F-M12 — Quick-Record Hotkey (+ tray fallback)

- **What & story:** Global shortcuts via the portal GlobalShortcuts API; tray as the honest fallback; capability transparency. *Story:* streamer muscle memory (PRD M12) under the GlobalShortcuts-availability risk.
- **Screens & components:** Settings→Shortcuts pane (bindings editor + grant state), tray icon menu (quick-record/pause/stop), "Runtime capabilities" transparency panel (PRD risk mitigation).
- **Database & API:** DB — none (bindings persist in TOML). API — `shortcuts_apply` (granted/denied map), `system_capabilities.portal`; errors `portal.unavailable` on missing support.
- **Build order:** ① ashpd GlobalShortcuts session + binding registration → ② 3 defaults: toggle-record / pause / stop → ③ Settings editor showing granted/denied truthfully → ④ tray menu parity actions + capability panel copy → ⑤ `docs/portal-support.md` GlobalShortcuts row. *(PLAN 6.3; tray from 2.6.)*
- **Edge cases, validation, states:** compositor lacks GlobalShortcuts → capability panel says exactly that + tray offered (never a dead key joked about); shortcut combo already taken → denied list surfaces honestly; hotkey during pause → same state machine guards as F-M7; bindings pressed while app unfocused → still route through the idempotent controller.
- **Acceptance criteria:**
  - [ ] Toggle-record works while an unfocused fullscreen app has input (KDE-verified; others documented)
  - [ ] Denied/taken bindings appear honestly in the UI + log, never silently ignored
  - [ ] Tray actions cover every shortcut action where the portal grants nothing
  - [ ] User can always discover WHY a shortcut doesn't work (transparency law)
  - [ ] `docs/portal-support.md` row updated per compositor

## F-M13 — Recording Indicator Consistency (compliance, not a UI build)

- **What & story:** Stay consistent with the compositor's native recording indicator; never fake or fight system UI. *Story:* PRD M13 + anti-goal of looking like a phishing overlay.
- **Screens & components:** no new component — a compliance rule across HUD dot (§5.9), PiP ring (§6.6), shutter flash (§6.5), and a hard ban on drawing/suppressing the OS indicator.
- **Database & API:** none (flagged ⚠ no-table in API §6 as expected).
- **Build order:** ① audit native indicator behavior on each target compositor → ② adjustment: where a native indicator exists (KDE), our HUD dot gets secondary treatment to avoid duplicate-red clutter → ③ document in `docs/portal-support.md` + release notes. *(Scheduled into PLAN Phase 7 (7.6); built last, by design.)*
- **Edge cases, validation, states:** compositor WITH native indicator → avoid double red near the clock; WITHOUT → HUD dot is the only indicator at full §7 contrast (scrim-rule verified on bright wallpapers).
- **Acceptance criteria:**
  - [ ] No code path draws or suppresses the system recording indicator (greppable absence)
  - [ ] No duplicate indicator clutter where a native one exists (visual audit per compositor)
  - [ ] HUD dot remains discoverable as THE indicator where no native one exists (contrast verified)

## F-M14 — Library (Recent Recordings)

- **What & story:** Thumbnail grid + metadata + detail drawer + soft delete. *Story:* "As a user, I want a glassy media library of my recordings with thumbnails and durations, so that finding last Tuesday's clip doesn't mean opening my file manager."
- **Screens & components:** LibraryView header (search/sort, `Show more`), grid 4/3/1 cols of §5.5 items with hover action row (open/copy/delete-danger), `RecordingDrawer` (focus trap, §5.7), all five states (empty/loading/error/missing/search-empty) per §6.3.
- **Database & API:** DB — `recordings` SELECT (partial-index: `ready`, not deleted), soft-delete UPDATE, `thumb_path`. API — `library_list` (pagination/filter/sort per §2.4), `library_get`, `library_delete`, events `library/updated`, `recording/finished` (highlight §6.5).
- **Build order:** ① `library/thumbs.rs` scheduled PNG extraction (never blocks view mount) → ② `library_list/get/delete` commands → ③ grid UI + skeletons + state coverage → ④ drawer + focus trap + restore → ⑤ delete confirm (danger modal) + soft delete + `missing`-file card with retry state. *(PLAN 5.1–5.5.)*
- **Edge cases, validation, states:** file deleted on disk under the app → card renders `missing` error state with honest copy (never a broken thumb icon); >1000 rows → still instant per DATABASE §5 (LIKE fine; FTS5 stays reserved as 0003); duplicate path from pipeline retry → upsert-on-path semantics; delete during active read → WAL readers unaffected; keyboard → arrow-key roving on the grid (not per-card tab stops — a11y §7).
- **Acceptance criteria:**
  - [ ] 50-record page loads < 300ms with explain-plan showing index use
  - [ ] Search/sort honor the API §2.4 whitelist; invalid sort → typed error
  - [ ] Soft-deleted row vanishes from grid but survives in DB (audit readback)
  - [ ] On-disk-deleted file → `missing` error card, honest copy, no broken thumb
  - [ ] All five states triggered for real (screenshot evidence vs DESIGN §6.3)
  - [ ] Drawer focus-trapped + restored; arrow-key grid navigation works

---

## Execution order & the one-feature-at-a-time loop

```
F-M1 → F-M2 → F-M3 → F-M4 → F-M6 → F-M7 → F-M8 → F-M9 → F-M5 → F-M14 → F-M10 → F-M11 → F-M12 → F-M13 (Phase 7)
```

**Order rationale:** capture variants (M1–M3), then audio (M4), then the HUD + controls (M6/M7), then encoders + files (M8/M9), then the independent PiP (M5), then the library (M14), then configuration (M10/M11/M12), and the M13 compliance gate last (Phase 7). Each feature completes its PLAN.md checkboxes; phases stay internally runnable per PLAN.md's vertical-slice rule.

**The loop, verbatim per your rule:**
1. Read this guide's feature section + its cited contract sections.
2. Build the build-order steps (they name the PLAN tasks to tick).
3. Verify every acceptance criterion on real hardware; capture evidence (ffprobe/sqlite/screenshots/log lines).
4. Tick PLAN.md checkboxes in the same commit.
5. Post the short change summary (AGENTS §5) — files touched, contract files updated (or "none"), verification evidence.
6. **Wait for the user's confirmation. Only then start the next feature.**
7. If any acceptance check forces a contract change, open the governing file (DESIGN/DATABASE/API) first — never code-first (AGENTS §6).
