# Changelog

All notable changes to ScreenStudio Pro are documented here. Format follows Keep a Changelog. Versions follow the app version in `Cargo.toml` / `tauri.conf.json`; the IPC contract version is tracked separately in `API.md`.

## [Unreleased]

Planned but not shipped: distro packages and first tag (7.5), AUR PKGBUILD, archived launch screenshots and G3 timing metric (7.6), hardware encoder completion (3.3 / 11.2), replay buffer (V3), scene compositor and streaming (V2). See [PLAN.md](PLAN.md) for the phased roadmap.

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
