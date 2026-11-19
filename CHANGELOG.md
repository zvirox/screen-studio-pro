# Changelog

All notable changes to ScreenStudio Pro are documented here. Format follows Keep a Changelog. Versions follow the app version in `Cargo.toml` / `tauri.conf.json`; the IPC contract version is tracked separately in `API.md`.

## [Unreleased]

Planned but not shipped: distro packages and first tag (7.5), AUR PKGBUILD, archived launch screenshots and G3 timing metric (7.6), hardware encoder completion (3.3 / 11.2), replay buffer (V3), scene compositor and streaming (V2). See [PLAN.md](PLAN.md) for the phased roadmap.

## [0.0.1+alpha.2] - 2026-11-19

Released under tag `v0.0.1-alpha.2` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Second alpha release: complete wide-window floating-island studio redesign inspired by Camo Studio, Meld Studio, and PRISM Live Studio, full test suite expansion, and release timeline codification.

### Added

- **Design System v3.0 (DESIGN.md v3.0)**: Symmetrical floating glass islands, Obsidian Slate neutral palette (`#0A0B0E`), refined hardware radii (`r.sm=8px`, `r.md=12px`, `r.lg=16px`, `r.xl=20px`), specular glass borders (`border.glass`), and atmospheric shadow tiers (`elev.1`, `elev.2`, `elev.float`).
- **Integrated Studio Titlebar (NavBar CSD)**: Custom CSD header with window control dots, centered view capsule (`Record` | `Library` | `Settings`), live telemetry pill (`1080p60 VAAPI`), and 40px primary Record pill CTA button.
- **Hero 16:9 Floating Preview Canvas (SourceDeck)**: Abolished the 1:1 square frame; preview is now native 16:9 widescreen with 16px corner radius and 1px specular border, housing interactive Camera PiP and region drag handles directly on canvas.
- **Left Floating Inspector Deck (CaptureInspector)**: 300px glass island housing 3-way segmented source switcher (`Monitor` | `Window` | `Region`) with hotkeys `1`, `2`, `3`; target resolution badge; Camera PiP controls (device popover, circle/rounded shape switcher, 4-corner snap grid, size slider, self-insert switch); quality preset dropdown; hardware encoder status badge (`VAAPI (Hardware)` / `CPU Fallback`).
- **Sub-Canvas Floating Audio Mixer Deck (AudioMixerDeck)**: Positioned symmetrically below 16:9 canvas with dedicated vertical channel cards for Mic and Desktop audio, live stereo peak/RMS meter bars (-60 to 0 dBFS with -6 dB compression zone), volume gain fader sliders, tactile Mute buttons, and DSP badges (`RNNoise`, `Gate`, `Auto-Ducking`).
- **Right Takes & Presets Gallery (TakesGallery)**: 260px floating glass card with fast toggle between Takes (16:9 thumbnails, duration chips, quick actions) and Presets (hotkey badges `F1`, `F2`), empty state illustration, and full library navigation.
- **Responsive Layout Architecture (RecordView)**: Tri-panel studio integration with responsive collapse toggle for viewports narrower than 1120px.
- **Ecosystem Architecture (REAOS.md)**: Reverse-engineering study of installed broadcast app and modern Wayland screen recorders, detailing multi-track audio pipelines, zero-copy compositing, and plugin architectures.
- **Release Timeline (PLAN.md & PRD.md)**: Formally divided into Strict Alpha (Phases 0–9), Strict Beta (Phases 10–14), and First Stable Release (`v1.0.0` post-Phase 14).

### Fixed

- Eliminated black bar letterboxing for widescreen desktop captures by switching preview canvas aspect ratio to 16:9.
- Dynamic app version resolution in `AboutPane.tsx` from capabilities probe instead of hardcoded string.
- Prevented premature library re-fetch lockup when navigating between studio decks and library grid.

### Verified

- Frontend: `npm run typecheck` (0 errors), `npm run lint` (0 errors, 0 warnings), Vitest (309 passing tests across 35 test files, including 6 end-to-end studio scenarios in `e2eScenarios.test.tsx`).
- Rust backend: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and 137 unit tests passing.

## [0.0.1+alpha.1] - 2026-11-18

Released under tag `v0.0.1-alpha.1` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

First buildable alpha. The MVP recording pipeline, UI and local library are implemented and CI-verified. No installer packages have been published yet.

### Added

- **Capture**: monitor, window and region source selection through xdg-desktop-portal + PipeWire; real frame consumption, source-loss reporting and live preview stills.
- **Audio**: cpal mic and PipeWire desktop capture, per-channel enable/mute/level, post-gain meters, mix into one AAC track, device-gone handling.
- **Recording controls**: pause/resume with paused time excluded from the encoded timeline, floating HUD (timer, pause/resume, stop, chapter flags), tray quick actions and minimize-to-tray on record.
- **Files**: MKV output, strftime naming pattern, MP4 remux toggle, quality presets, library index with thumbnails, search, sort, detail drawer, soft delete and missing-file states.
- **Settings**: Capture / Audio / Camera / Files / Shortcuts / About / First Run panes with rollback-on-rejection and validation.
- **Camera**: V4L2 viewer, floating PiP with drag/snap/resize/shape controls and optional self-insert compositing.
- **Reliability**: SQLite migration runner, typed errors with human copy, tracing to a local log, finalize-on-quit.
- **UI v2 (2026-11-18)**: DESIGN.md v2.0 contract, burgundy-on-near-black glass palette with complete light mode, minimal-round rectangle geometry, square 1:1 preview in a two-column workspace, one-scroll-per-surface shell, rectangular icon nav and HUD, tokenized motion with reduced-motion support, fixed z-scale.

### Fixed

- Encoder worker rebuilt its own video-only muxer over a two-stream file, breaking every take with audio; the muxer is now opened once at start and shared (task 7.4 root-cause fix).
- Idle frame backlog contaminated short takes; Start now discards the bounded backlog.
- Quiet video starved AAC draining; audio now drains independently of video arrivals.
- Light-mode contrast violations across cards, inputs, toggles and secondary text (task 7.1).
- Duplicate settings pane wrappers/headings and undefined design tokens removed during the UI v2 work.

### Verified

- Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib` (137 passed / 5 ignored).
- Frontend: `tsc --noEmit`, `eslint src`, Vitest (222 tests), production build.
- Live gates (2026-11-17, measured): portal consent on KDE, pause excluding paused time (5986 ms take, 5 paused ticks), audio A/B in-file (440 Hz mic band −27.7 dB unmuted → −63.7 dB muted, 880 Hz desktop intact), live meters, 3× flag → sqlite `chapter_json` round-trip.
- Perf harness: x264 fallback bounds and 30-take soak with no lifecycle leak; PRD §8 hardware targets remain gated on VAAPI/NVENC completion.

### Known limitations

- VAAPI/NVENC encoder backends are stubs; x264 is the working fallback.
- No published packages yet; Flatpak manifest and release workflow exist but have never been run against a tag.
- AUR PKGBUILD, archived launch screenshots and the ≤60s first-recording metric are open.
- Hardware-path perf targets, no-tray-host compositor behavior, live portal global-shortcut activation, and two rare portal/webcam anomalies remain unresolved — see [release notes](docs/releases/0.0.1-alpha.1.md) and [portal support](docs/portal-support.md).
