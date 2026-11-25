# Changelog

All notable changes to ScreenStudio Pro are documented here. Format follows Keep a Changelog. Versions follow the app version in `Cargo.toml` / `tauri.conf.json`; the IPC contract version is tracked separately in `API.md`.

## [Unreleased]

## [0.1.0-beta.3] - 2026-11-25

### Fixed
- **Multi-distro FFmpeg SONAME crash (`libavutil.so.58` / `libavcodec.so.60` not found):** Switched release packaging in `.github/workflows/release.yml` (via `zvirox/release-workflows@v1` `per_distro_build: true`) to compile release binaries natively inside Ubuntu 24.04, Fedora Latest (`ffmpeg-free-devel`), and Arch Linux Latest (`ffmpeg`) containers instead of repacking one Ubuntu-linked binary across incompatible FFmpeg ABIs.
- **Explicit runtime dependencies & custom protocol:** Added `ffmpeg` and ALSA runtime dependencies (`libasound2t64 | libasound2` for `.deb`, `alsa-lib` + `(libav*-free or ffmpeg-libs)` for `.rpm`, `ffmpeg` + `alsa-lib` for `.pkg.tar.zst`) in `packaging/nfpm.yaml`, enabled `--features custom-protocol` explicitly in release builds, and excluded `ubuntu:22.04` smoke test (`smoke_ubuntu22: false`) since `ssp-mux` uses FFmpeg >= 5.1 `AVChannelLayout`.
- **CI & container smoke-test hardening:** Added early `--version` / `-V` CLI handling in `src-tauri/src/main.rs` so headless containers can execute `screen-studio-pro --version` (`check_version_flag: true`), verified shared-library resolution (`ldd`) across `/usr/bin/*` ELF binaries in clean containers, and added `npm run check:linear` and `npm run build` to `.github/workflows/ci.yml`.

## [0.1.0-beta.2] - 2026-11-25

- **Phase 7.4 — real hardware encoders pulled forward from 10.2:** `hw_vaapi.rs` and `hw_nvenc.rs` are no longer stubs. VAAPI creates a DRM-render-node AVHWDeviceContext + NV12 AVHWFramesContext, uploads system-memory frames to surfaces, and encodes with `h264_vaapi`; NVENC mirrors the path with a CUDA device and `h264_nvenc` (compiles + probes, UNQUALIFIED here — no NVIDIA GPU on the test host). Availability probes now require real device init, `SSP_FORCE_ENCODER` fails typed instead of silently falling back, and all backends share the `Encoder` seam behind `Box<dyn Encoder>`. Hardware streams get a yuv420p codecpar so MKV/fragmented MP4 stay ffprobe-valid. The perf harness now measures A/V drift from actual `EncodedPacket` pts (a half-rate audio feeder bug was fixed in the process) and activates the PRD §8 hardware gates via `is_hardware`. Reconciled PRD §8 with PLAN 7.4 to the stricter **<50 ms / 60 min, <150 MB RSS, <0.5% drops @1080p60** targets. Measured on Intel TigerLake (release, 5 s @1080p60): **0% steady drops, 126 MiB RSS, 10.6 ms drift**; a shortened 5 × 60 s soak held 0 drops/take, 113–128 MiB RSS and 10.66 ms drift with flat threads — short-take gates pass; the full 60-min soak and NVIDIA qualification remain open. No UI changes; DESIGN.md v5.0 untouched.

- **Phase 9 gate — automated SIGKILL proof**: `sigkill_parent_leaves_probeable_file` re-execs the test harness as a real parent, kills it with `SIGKILL`, and verifies the orphaned `ssp-mux` child finalizes an ffprobe-valid, duration-bearing MKV. `mpv` full-seek playback remains a human gate.
- **Phase 9.3 — native chapters & gapless auto-split (code-complete)**: `recordings.chapter_json` is authoritative; `ssp-mux` projects it into native MKV/MP4 chapter tags after stream setup, after each split and at finalize (`ffprobe -show_chapters` proof). Added `recording_add_chapter` as an additive alias of `recording_flag`, the `recording/split` event, and additive `segmentJson`/`chapterCount` reply + library fields. Files settings gain default-off `autoSplitEnabled` with validated duration (1–240 min) and size (64–16384 MB) thresholds; the worker requests gapless segment paths over the same bounded pipe with no dropped frames. One logical take stays one SQLite row: migration `0003_auto_split.sql` adds `segment_json` (`user_version` 3) with ordered segment paths/sizes/durations and `updated_at` on mutations. IPC contract advanced to **1.8.0** (additive only). The full SIGKILL stress gate stays separate and is NOT claimed.
- **Final Locked Linear UI (`DESIGN.md v5.0`)**: Completed full Unified Linear-Style Design System across every surface — solid opaque dark (`#050505` / `#111213` / `#1A1B1E`) and light (`#F3F4F6` / `#FFFFFF` / `#F4F5F7`) tokens, 1px hairline borders, self-hosted `Inter` + `JetBrains Mono` typography (`12/13/14/16/20/28 px`), minimal `8px/6px/4px` rounding with zero pill clutter, zero dark-mode shadows, zero `rgba()`/translucency, and zero macOS CSD dots. Studio Burgundy / Broadcast Signal Red reserved exclusively for recording buttons and live recording indicators.
- **Window & Chrome**: Updated primary window defaults to `1280×800` (min `1024×640`, `decorations: false`, `transparent: false`), added dynamic `tauri.conf.json` version badge and live recording indicator to `TitleBar`, unified theme persistence on `localStorage["ui-theme"]`, and updated close button hover to `#E5484D`.
- **Telemetry & Meters**: Added `TelemetryDeck` with Apache ECharts real-time FPS/dropped line trace (`RangeTabs`) and CPU/GPU encode donut (`DonutLegend`) driven by live `session.stats`; updated `AudioMixerDeck` level meters to green → amber → red with blue gain sliders.
- **Enforcement**: Hardened `scripts/check-linear.mjs` (`npm run check:linear`) to fail on blur, translucency, glow, dark-mode shadows, macOS CSD dots, disallowed pill shapes, and raw hex colors outside `src/tailwind.css`.
- **Phase 9.1 — native hybrid MP4 (code-complete)**: `.mp4` takes are now written as fragmented MP4 (`moof`/`mdat`) by `ssp-mux` with a 1 s fragment cadence; the old post-take MKV→MP4 remux was removed. An EOF-finalized take is ffprobe-valid and contains `moof` boxes. Full SIGKILL/player-seek proof remains open.
- **Phase 9.2 — subprocess muxer isolation (code-complete)**: All takes now spawn `ssp-mux`; the parent keeps encoders and sends length-prefixed, bounded packet frames over an anonymous pipe. The child owns libavformat, flushes AVIO at the session's 1 Hz cadence, and writes the container trailer on stdin EOF — the kernel guarantees EOF when the parent dies. Added `[[bin]] ssp-mux`, nfpm packaging of `/usr/bin/ssp-mux`, and EOF/finalization tests with ffprobe checks. Full SIGKILL gate remains open.
- **Phase 8 — Starship Control bridge (code-complete)**: Publishes a real manifest at boot, binds the UDS socket with same-uid peer verification, and routes `capture.status/start/stop/pause/resume/flag` through the single `AppState` lifecycle. Removed fabricated zoom/checkpoint tools and stub replies. Exports derived `cet/1.0` sidecars with observed header/marker facts only; `recording_stop` now returns an additive `cetPath`. IPC contract advanced to **1.7.0** (additive). External Starship GUI discovery/command remains a live gate.

## [0.1.0-beta.1] - 2026-11-24

- **Packaging & CI**: Locked `nfpm` packaging workflow generating native `.deb`, `.rpm`, and `.pkg.tar.zst` assets alongside `SHA256SUMS` (AppImage, Flatpak, tarballs, and AUR retired).
- **Starship Control Bridge Scaffold**: Added `starship_bridge.rs` (`starship-plugin` SDK schema & tool definitions with unit tests; live runtime daemon startup and CET telemetry export scheduled in Phase 8).

## [0.0.1+alpha.9] - 2026-11-23

Released under tag `v0.0.1-alpha.9` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Design system v3.2, "Quiet Studio Instrument". No capture, encoder, IPC, or production behavior changed.

### Changed

- `DESIGN.md` advanced to v3.2: sentence-case labels, quiet neutral surfaces and hairlines, Burgundy reserved for the primary Record action and true selection, fixed-contrast copy on the black preview canvas, and one easing curve.
- Tokens, glass recipes, component classes, and documentation screenshots updated across the whole app.
- Duplicated bottom preset selector removed; HUD/library/settings copy tightened; decorative accent hovers, uppercase tracked overlines, and bouncy motion removed.

## [0.0.1+alpha.8] - 2026-11-23

Released under tag `v0.0.1-alpha.8` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Flatpak offline asset loading hotfix; application behavior and the DESIGN.md v3.1 interface are otherwise unchanged from alpha.7.

### Fixed

- **Bundle static frontend assets and enable custom protocol for Flatpak.** Raw `cargo build --release --offline` in the Flatpak sandbox built the app in dev mode (`cfg(dev)` active) because `custom-protocol` was not declared or enabled, directing the WebKitGTK webview to `http://localhost:1420` instead of the embedded assets (`tauri://localhost`). Added `custom-protocol = ["tauri/custom-protocol"]` to `src-tauri/Cargo.toml` and enabled `--features custom-protocol` in the Flatpak manifest.
- **Added CI release verification gates.** The Flatpak release workflow now inspects the binary to ensure `tauri://localhost` is present and verifies `flatpak-startup.log` does not report connection refused or localhost connection failures.

## [0.0.1+alpha.7] - 2026-11-22

Released under tag `v0.0.1-alpha.7` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Flpak packaging hotfix; application behavior and the DESIGN.md v3.1 interface are otherwise unchanged from alpha.6.

### Fixed

- Grant network access with `--share=network`; the `xdg-desktop-portal` ProxyResolver returns `NotAllowed` when the app has no network access, which was the persistent in-app GDBus error after alpha.6.
- Preserve the GNOME 49 runtime, the `--talk-name=org.freedesktop.portal.ProxyResolver` permission, and the alpha.6 release-time shared-library and 20-second startup gates.

## [0.0.1+alpha.6] - 2026-11-22

Released under tag `v0.0.1-alpha.6` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Flatpak packaging hotfix; application behavior and the DESIGN.md v3.1 interface are otherwise unchanged from alpha.5.

### Fixed

- Allow the WebKitGTK proxy-resolution portal call by adding `--talk-name=org.freedesktop.portal.ProxyResolver` to the Flatpak manifest.
- Preserve the GNOME 49 runtime and the alpha.5 release-time shared-library and 20-second startup gates.

## [0.0.1+alpha.5] - 2026-11-22

Released under tag `v0.0.1-alpha.5` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Flatpak runtime hotfix; application behavior and the DESIGN.md v3.1 interface are otherwise unchanged from alpha.4.

### Changed

- Build and run the Flatpak on GNOME 49 instead of GNOME 48 to address the remaining external `SIGKILL` during WebKit startup.
- Preserve the bundled libappindicator tray runtime and the release-time shared-library and 20-second startup gates.

### Diagnostic evidence

- The same alpha.4 binary and real app data survived five eight-second launches and three full 20-second launches with GNOME 49; three matched GNOME 48 controls exited with status `137` within five seconds.
- The evidence isolates the correction to the runtime stack, not to WebKitGTK or Mesa individually.

### Validation boundaries

- Packaging-only change: no capture, recording, encoder or production frontend behavior changed.
- The published alpha.5 Flatpak must still pass release CI and repeated 20-second launches from the existing system installation before the startup correction is considered verified; clean-VM installation and full recording validation remain open.

## [0.0.1+alpha.4] - 2026-11-22

Released under tag `v0.0.1-alpha.4` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Flatpak startup hotfix; application behavior and the DESIGN.md v3.1 interface are otherwise unchanged from alpha.3.

### Fixed

- Bundle the libappindicator tray runtime and its libdbusmenu/libindicator dependencies so the Flatpak no longer panics before opening its main window.
- Add built-sandbox shared-library checks and an Xvfb + D-Bus startup smoke gate before the release workflow can attach the `.flatpak` asset.

### Validation boundaries

- Packaging-only change: no capture, recording, encoder or production frontend behavior changed.
- Release run `45004143614` passed the library/startup gates and all four package jobs. The published Flatpak also passed an isolated host install, dependency-resolution and 30-second launch check; clean-VM installation and full recording validation remain open.

## [0.0.1+alpha.3] - 2026-11-22

Released under tag `v0.0.1-alpha.3` (Tauri bundlers reject `-` in version strings, so app metadata uses the semver-equivalent `+` form).

Third alpha release: DESIGN.md v3.1 legibility, responsive-layout and accessibility refinement, with refreshed documentation and labelled mocked-IPC UI previews.

### Added

- Responsive two-column and stacked Record layouts below the desktop tri-panel breakpoint, without horizontal page overflow.
- Shared button treatment and clearer control, gallery, mixer and settings states across both themes.
- Four refreshed 1440×960 README previews covering Record dark/light, Settings and Library.

### Fixed

- Region crop dragging now registers with its drag provider, uses native-source coordinates and respects letterboxed preview geometry; keyboard nudges remain native-pixel steps.
- Settings tabs now implement arrow-key navigation and explicit tab/panel relationships.
- Navigation targets, text wrapping, focus visibility, scale/translate motion and reduced-motion behavior were corrected across the studio UI.

### Verified

- Frontend: `npm run typecheck`, `npm run lint`, 321 Vitest tests across 35 files, and production build all pass.
- Rendered browser checks: 1440×960, 1040×680 and 640×800 in both themes, keyboard navigation, reduced motion, no horizontal overflow and no console errors.
- CI run `44995837385` passed the frontend and Rust jobs for the UI/documentation change set. The local Rust rerun was blocked by host FFmpeg 8 bindgen requiring unavailable CUDA SDK types; no production Rust behavior changed in this release.

### Known limitations

- VAAPI/NVENC remain unimplemented; x264 is the working fallback.
- Packages are CI-built but have not been install-verified on test VMs.
- README screenshots are mocked-IPC frontend previews, not real recording sessions or packaged-app captures.

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

First buildable alpha. The MVP recording pipeline, UI and local library are implemented and CI-verified. Four installer formats (`.deb`, `.rpm`, `.AppImage`, `.flatpak`) were attached to this release by the tag-triggered release workflow.

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
- Installers shipped with this release for all four formats (.deb/.rpm/.AppImage/.flatpak), published without VM install verification (Tier-2); AUR packaging follows.
- AUR PKGBUILD, archived launch screenshots and the ≤60s first-recording metric are open.
- Hardware-path perf targets, no-tray-host compositor behavior, live portal global-shortcut activation, and two rare portal/webcam anomalies remain unresolved — see [release notes](docs/releases/0.0.1-alpha.1.md) and [portal support](docs/portal-support.md).
