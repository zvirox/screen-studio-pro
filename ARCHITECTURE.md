# ARCHITECTURE.md — ScreenStudio Pro

**Version:** 1.2 · **Authority chain:** PRD.md (scope) → ARCHITECTURE.md (structure) → DESIGN.md (UI law v6.0, Final & Locked)
**Rules applied:** simple, popular, well-documented tools only. No code in this file. MVP scope only (recording), with named seams for V2 streaming and the scene compositor — seams, not scaffolding.

---

## 1. Tech Stack (with one-line reasons)

| Layer                      | Choice                                                                                  | Reason                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell                  | **Tauri 2**                                                                             | Small native Linux binaries, frameless flat titlebar, and a clean Rust↔webview IPC — decided in stack selection                                                        |
| Frontend                   | **React 19 + TypeScript + Vite**                                                        | Fast HMR dev loop, TS types the IPC contract end-to-end, Vite is the standard bundler for Tauri                                                                        |
| Styling                    | **Tailwind CSS v4**                                                                     | `@theme` maps DESIGN.md v6.0 tokens from `src/styles/`; enforced by `scripts/check-linear.mjs`                                                                         |
| UI kit & Charts            | **Radix primitives (Popover/Switch) + custom `components/linear/*` + Apache ECharts 6** | Accessible primitives restyled to flat Linear specs (`8px`/`6px`/`4px` radii) plus real-time telemetry charts                                                          |
| Motion                     | **framer-motion**                                                                       | 150ms ease-out motion tokens with `<MotionConfig reducedMotion="user">`                                                                                                |
| State (TS)                 | **Zustand**                                                                             | Async-heavy state syncing with Tauri events fits its vanilla-store model; smallest API surface                                                                         |
| DnD                        | **dnd-kit**                                                                             | Powers region overlay + V2 compositor canvas; keyboard-accessible by default                                                                                           |
| Language (core)            | **Rust, single crate `screen-studio-pro` (workspace later if ever needed)**             | All capture/encode logic is native; a monolith crate avoids premature workspace ceremony                                                                               |
| Tauri plugin               | **tauri-plugin-notification, tauri-plugin-dialog, tauri-plugin-global-shortcut**        | Official, documented glue for toasts, file dialogs, portal shortcuts                                                                                                   |
| Desktop portals            | **ashpd** crate                                                                         | Purpose-built async client for xdg-desktop-portal (screencast/camera/global-shortcuts) — the Wayland-first path PRD requires                                           |
| Media framework            | **PipeWire via `pipewire-rs`**                                                          | THE audio/video nerve center of every target compositor (Hyprland/niri/MangoWC/KDE); portal screencast lands here                                                      |
| Audio input                | **cpal** (mic capture) + PipeWire desktop audio                                         | cpal is the standard, simple Rust audio-device abstraction; desktop audio rides the PipeWire stream                                                                    |
| Video encoding             | **ffmpeg-next (libavcodec bindings)**                                                   | One API gives x264 today and Cy-codec hardware encoders (VAAPI/NVENC) via hwaccel configs; ubiquitous, documented                                                      |
| Mux/file IO                | **ffmpeg-next muxing (libavformat)**                                                    | MKV/MP4/WebM containers and MKV→MP4 remux without a second dependency                                                                                                  |
| Camera                     | **V4L2 via `v4l2r`**                                                                    | Direct UVC webcam capture is more reliable than the portal Camera API on our target compositors (PRD open question #1 — resolved favoring V4L2 first, portal fallback) |
| Database                   | **SQLite via `rusqlite`** (local library index only)                                    | Recordings metadata + thumbnails need a queryable local index; SQLite is the boring, correct answer — no server                                                        |
| Thumbnails                 | **ffmpeg-next frame extraction → PNG cache**                                            | One dependency already present generates poster frames                                                                                                                 |
| Image                      | **image** crate                                                                         | PNG decode/encode for thumbnails small utilities                                                                                                                       |
| Config                     | **`config` crate + TOML**                                                               | Readable user config; simple, human-editable, popular                                                                                                                  |
| Logging                    | **`tracing` + `tracing-subscriber` + tracing-appender**                                 | Verbose diagnostics to file (§7.9: raw errors to log only) — industry standard                                                                                         |
| Error (Rust)               | **thiserror** (core) / **anyhow** (glue)                                                | Typed errors for the IPC contract, ergonomic ones for the shell                                                                                                        |
| External control (Phase 8) | **`starship-plugin` + a local Unix domain socket**                                      | Starship Control discovery and recording automation without HTTP, WebSocket, or cloud; peer-uid checked on every connection                                            |
| Telemetry export (Phase 8) | **Derived `cet/1.0` JSONL sidecar**                                                     | Local editor metadata beside the media file; no DB column, no upload, no fabricated events                                                                             |
| CI/CD                      | **GitHub Actions → GitHub Releases**                                                    | Standard; produces tagged builds consumed by distro packaging (PRD G5)                                                                                                 |
| Hosting                    | **None**                                                                                | Desktop app: distro packages + GitHub Releases are the distribution (no SaaS — PRD non-goal)                                                                           |

**Explicitly not in the stack:** Electron, Node, Python, Docker, Kubernetes, message queues, Redis, cloud services — desktop app, no server.

---

## 2. Folder & File Structure

```
screen-studio-pro/
├── ARCHITECTURE.md                 # This contract
├── DESIGN.md                       # UI law (tokens, components, layouts)
├── PRD.md                          # Product scope source of truth
├── PRODUCT.md                      # Brand/product context for design work
├── README.md
├── LICENSE
├── CHANGELOG.md
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # lint + test + build (Linux)
│   │   └── release.yml             # tagged build → GitHub Releases artifacts
│   └── ISSUE_TEMPLATE/
├── packaging/                      # PRD G5: uniform nfpm packaging (.deb, .rpm, .pkg.tar.zst)
│   ├── nfpm.yaml                   # Single manifest generating all 3 formats
│   ├── screen-studio-pro.desktop   # Desktop entry
│   ├── scripts/                    # postinstall.sh / preremove.sh hooks
│   └── icons/                      # hicolor PNG icon set
├── scripts/
│   └── check-linear.mjs            # Linear UI enforcement gate (zero blur/rgba/pills/raw-hex)
├── docs/
│   ├── portal-support.md           # Known per-compositor quirks (PRD risks §9)
│   └── screenshots/                # Dark/Light rendered Linear UI previews
└── src-tauri/                      # Rust core + Tauri shell
    ├── Cargo.toml
    ├── tauri.conf.json             # 1280x800 default / 1024x640 min, decorations:false, transparent:false
    ├── build.rs
    ├── capabilities/               # Tauri 2 permission manifests
    │   └── default.json
    ├── icons/                      # app icon set
    └── src/
        ├── main.rs                 # binary entry: calls ssp::run()
        ├── bin/
        │   └── ssp-mux.rs          # Phase 9.2: helper binary — owns libavformat for one take;
        │                           #   reads length-prefixed JSON frames on stdin (wire codec here),
        │                           #   finalizes on EOF. Also #[path]-included by muxer.rs so both
        │                           #   sides share ONE wire definition.
        ├── lib.rs                  # setup, tracing bootstrap, Tauri invoke handler registration
        ├── starship_bridge.rs      # Phase 8: manifest publisher + UDS bridge, AppState-backed tools
        ├── app_state.rs            # Owned AppState (recording controller handle, settings cache)
        ├── tray.rs                 # Native tray menu + main-window visibility; delegates lifecycle to app_state
        ├── settings/
        │   ├── mod.rs              # load/save TOML config, serde validation
        │   └── defaults.rs         # first-run defaults (PRD G3: 60s-to-first-recording)
        ├── ipc/
        │   ├── mod.rs              # command + event registration (the UI↔core contract)
        │   ├── commands.rs         # #[tauri::command] handlers — thin, delegate to modules
        │   └── events.rs           # typed event payloads emitted to webview
        ├── capture/
        │   ├── mod.rs              # CaptureSource trait (monitor/window/region/camera/audio)
        │   ├── portal.rs           # ashpd screencast session orchestration
        │   ├── pipewire.rs         # PipeWire stream consumption → frame bus
        │   ├── preview.rs          # Drop-oldest PreviewMailbox + ≤8fps JPEG encoder
        │   ├── camera_v4l2.rs      # V4L2 camera frames → stills mailbox (+ sysfs hotplug watcher)
        │   └── audio.rs            # cpal mic + PipeWire desktop audio → audio bus
        ├── encode/
        │   ├── mod.rs              # Encoder trait, selection chain, EncoderSelection + raw hw
        │   │                       #   device/frames/upload helpers (ffmpeg-sys FFI)
        │   ├── hw_vaapi.rs         # Real h264_vaapi: render-node probe + VAAPI surfaces
        │   ├── hw_nvenc.rs         # Real h264_nvenc: CUDA probe + CUDA surfaces (unqualified: no NVIDIA host)
        │   └── sw_x264.rs          # CPU H.264 encoder impl (ffmpeg-next) — always-last fallback
        ├── pipeline/
        │   ├── mod.rs              # Recording session controller + SPSC ring
        │   ├── audio.rs            # Audio rings, linear mix & meter calculation
        │   ├── presets.rs          # Static M11 quality presets (YouTube/Discord/Lossless/Smallest)
        │   ├── session.rs          # Worker loops, pause tracking, naming & remux orchestration
        │   ├── muxer.rs            # Direct encoder-open helpers + subprocess muxer CLIENT
        │                           #   (spawns ssp-mux, writes the wire pipe); Phase 9.3 adds
        │                           #   add_chapter + split frames; legacy in-process
        │                           #   Muxer/MuxerBuilder stay for the crash-tolerance regression
        │                           #   and the MKV→MP4 remux path lives in session.rs
        │   └── bin/ssp-mux.rs       # (src-tauri/src/bin/) the muxer CHILD: bounded length-
        │                           #   prefixed JSON wire codec shared with muxer.rs via #[path];
        │                           #   native chapter tags + gapless segment open on Split
        │   ├── cet.rs              # Phase 8: derived cet/1.0 telemetry JSONL sidecar
        │   ├── composite.rs        # webcam PiP compositing + region cropping
        │   └── stats.rs            # fps/drop/bitrate/encode-time stats + A/V packet drift (7.4)
        ├── library/
        │   ├── mod.rs              # library index exports
        │   ├── store.rs            # rusqlite schema, WAL migrations & CRUD
        │   └── thumbs.rs           # thumbnail PNG extraction + cache
        └── util/
            ├── paths.rs            # XDG dirs: config/data/cache locations
            ├── time.rs             # monotonic / wall-clock formatting helpers
            └── error.rs            # CoreError enum → serializable IPC errors
└── src/                            # React frontend (Tauri webview)
    ├── package.json / vite.config.ts / tsconfig.json / index.html (`ui-theme` pre-paint)
    ├── tailwind.css                # Tailwind utility bridge, Inter + JetBrains Mono fonts
    ├── styles/                     # Shared palette, SSP recording tokens, token tests
    │   ├── linear-theme.css        # Shared v6.0 palette (byte-identical across apps)
    │   ├── recording-tokens.css    # SSP-only Record/recording colors
    │   └── tokens.test.ts          # Palette values and contrast tests
    ├── main.tsx / hud-main.tsx
    ├── App.tsx                     # TitleBar + NavBar + view router (Record/Library/Settings)
    ├── lib/
    │   ├── ipc.ts                  # typed wrappers over invoke() — mirrors src-tauri/ipc
    │   ├── events.ts               # typed listeners for Tauri events (single source)
    │   ├── store.ts                # Zustand store wiring: UI state ↔ events
    │   ├── boot.ts / format.ts / hudWindow.ts / motion.ts / cn.ts
    │   └── errors.ts               # CoreError → human copy mapping
    ├── components/
    │   ├── linear/                 # Locked Linear primitives: TitleBar, ThemeToggle, LinearCard, LinearButton, StatCard, StatusPill, ProgressRow, RangeTabs, DonutLegend, echarts-linear-theme
    │   ├── ui/                     # Restyled Button, Radix Popover & Switch, Reveal
    │   ├── record/
    │   │   ├── RecordView.tsx      # Tri-panel studio layout (1120px) & responsive compact stack
    │   │   ├── CaptureInspector.tsx# Source mode, Camera PiP controls, quality preset & encoder badge
    │   │   ├── SourceDeck.tsx      # Hero 16:9 canvas + JPEG preview + region crop overlay
    │   │   ├── AudioMixerDeck.tsx  # Dual channel cards, green→amber→red meters, blue gain sliders
    │   │   ├── TakesGallery.tsx    # Recent takes gallery & preset quick switcher
    │   │   ├── TelemetryDeck.tsx   # Live FPS/bitrate/drop StatCards + ECharts line/donut charts
    │   │   └── ActionRow.tsx       # Record/Stop CTA, elapsed timer, paused indicator & stats line
    │   ├── library/
    │   │   ├── LibraryGrid.tsx     # §5.5 recording cards + search/sort/empty/missing states
    │   │   ├── RecordingDrawer.tsx # 420px metadata drawer
    │   │   └── DeleteConfirm.tsx   # Centered confirmation dialog over solid dimmed scrim
    │   ├── settings/
    │   │   ├── SettingsView.tsx    # Left rail + 560px content column
    │   │   └── *Pane.tsx           # FirstRun, Capture, Audio, Camera, Files, Shortcuts, About
    │   ├── huds/
    │   │   ├── HudBar.tsx          # Transparent-window floating matte Linear HUD toolbar
    │   │   └── CameraPip.tsx       # Draggable/resizable webcam PiP frame inside Hero Canvas
    │   └── chrome/
    │       ├── NavBar.tsx          # 3-tab flat segmented bar, telemetry chip & Record CTA
    │       ├── BootError.tsx       # Contract version mismatch fallback
    │       └── ToastHost.tsx       # Bottom-center notifications stack
    ├── hooks/
    │   ├── useRecordingState.ts    # Single event-subscription bridge
    │   ├── useSourcePreview.ts     # ≤8fps polled source & camera stills
    │   └── useHudWindow.ts         # Recording HUD lifecycle spawn/teardown
    └── types/
        └── ipc.ts                  # command/event payload types (contract mirror)
```

Tree rules: `commands.rs` handlers stay thin (validation + delegation); no business logic in ipc; frontend never imports Rust internals — only the typed contract in `lib/ipc.ts` ↔ `types/ipc.ts`.

---

## 3. Data Flow

### 3.1 System map (MVP — no backend server, no third-party cloud)

```
 ┌────────────────────── Linux system ─────────────────────┐
 │  xdg-desktop-portal     PipeWire        V4L2 devices    │
 │  (screencast/auth/      (video composite,(webcams)        │
 │   global shortcuts)      desktop audio)                  │
 └─────┬──────────────────────┬──────────────────┬──────────┘
       │ streams (fd/SPA)     │ frames           │ frames
 ┌─────▾──────────────────────▾──────────────────▾──────────┐
 │              Rust core (src-tauri)                        │
 │  capture → pipeline(frame bus + audio bus)                │
 │        → composite (PiP, region crop)                     │
 │        → encode (VAAPI/NVENC/x264) → packets on anonymous pipe → ssp-mux child (owns muxer/file)      │
 │        → file save + thumbnail → library (SQLite)         │
 │  settings (TOML)    stats (meters)    logs (tracing)      │
 └─────┬───────────────────────────────────────────┬─────────┘
       │ Tauri IPC: commands (req/resp)             │ events (push)
 ┌─────▾───────────────────────────────────────────▾─────────┐
 │           React webview (UI only, DESIGN.md law)          │
 │  Zustand store ← lib/events.ts      → invoke via lib/ipc  │
 │  Views: Record / Library / Settings   Overlays: HUD, PiP  │
 │  NO video frames ever (only <img> thumbnails + previews   │
 │  served as encoded stills or tiny JPEG frames @1–8fps)    │
 └───────────────────────────────────────────────────────────┘
        Local disk: ~/Videos/SSP (recordings), XDG config/data/cache
```

**Phase 9.2 muxer isolation (PLAN 9.2):** the parent opens the encoders via
`muxer::open_selected_video_encoder`/`open_audio_encoder` (the thin
`open_video_encoder` remains the x264-only helper for regressions) and hands
only encoded packets to `ssp-mux` over a length-prefixed pipe (a private fd
pair — no Tauri command/event ever carries media bytes, API §6). The child
creates the streams with codecpar copied from the opened encoders
(GLOBAL_HEADER extradata included, so MKV/MP4 CodecPrivate is unchanged),
writes the header, and finalizes on stdin EOF. Parent death closes the kernel
pipe write end ⇒ EOF ⇒ trailer, independently of the parent's destructors.

**Phase 7.4 hardware path:** selection happens BEFORE `avcodec_open2`:
`select_encoder` returns an `EncoderSelection` (codec name, consume pix_fmt,
backend options, device path). For VAAPI/NVENC the parent attaches an
AVHWFramesContext to the codec context before opening, then the backend
uploads swscale-produced NV12 frames to surfaces and emits packets in the µs
time base. The codecpar sent to `ssp-mux` is rewritten to **yuv420p** — the
container describes decoded frames, not a `vaapi`/`cuda` surface format — so
MKV CodecPrivate and fragmented MP4 stay probeable. All three backends
implement the same `Encoder` trait; the worker holds `Box<dyn Encoder>`.

**Phase 10.1 zero-copy DMA-BUF ingestion (opt-in):** `capture/dmabuf.rs` models a PipeWire DMA-BUF frame (borrowed plane-0 fd, fourcc, modifier, stride) and imports it as an EGLImage via `EGL_LINUX_DMA_BUF_EXT` (surfaceless Mesa display) with **no host readback**; a `memmap2` CPU map is the fallback for drivers that forbid host mapping, and any import failure degrades to that map (never a lost frame). The producer (`capture/pipewire.rs`) handles `DataType::DmaBuf` buffers when the `SSP_DMA_BUF` opt-in is set and feeds the encode bus from the CPU map, so behaviour is unchanged by default (the MemFd path is untouched). Feeding the EGLImage straight into the encoder (`PASS_TEXTURE`, no upload) and flipping the format offer to request DMA-BUF are Phase 10.2 / the live-gate step. All DMA-BUF code is behind the `encode` feature; `--no-default-features` stays green.

**Phase 10.2 HEVC/AV1 + zero-copy hook:** `encode::select_encoder_codec` maps the output codec (`h264`/`hevc`/`av1`, via `capture.codec` or `SSP_FORCE_CODEC`) × backend to `h264|hevc|av1_vaapi` / `_nvenc` (unknown or unsupported pairs fail typed, never a silent H.264). `pipeline::Frame` carries `dmabuf: Option<Arc<DmaBufRef>>` (an owned dup of the plane-0 fd) so the buffer outlives the capture→worker hand-off; `HwEncoder::encode` calls `Context::import_dmabuf` (zero-copy `av_hwframe_map` DRM_PRIME→VAAPI) first and falls back to the CPU upload on any error. **Blocked:** the `AVDRMFrameDescriptor` types are absent from ffmpeg-sys-next's bindgen allowlist, so the DRM_PRIME source frame cannot be built here — the zero-copy map needs an allowlist extension (build change) or direct `vaImportSurface` FFI; until then `import_dmabuf` returns a typed error and the upload path runs (no regression).

### 3.2 Flow: start recording (the core path)

1. UI: user selects source chip → `invoke("select_source", kind)` → Rust orchestrates ashpd portal session (compositor consent prompt) → returns capability list + PipeWire fd handle. UI state = source live.
2. UI: user presses Record → `invoke("start_recording", {sourceId, audioChannels, presetId})`.
3. Rust pipeline: validates preset → wires buses (source→composite→encoder→subprocess muxer) → hot-swaps encoder by capability → spawns `ssp-mux`, which opens the MKV and acks its header synchronously → flips AppState → `emit("recording/started")`.
4. Rust emits throttled events while running: `recording/tick` (1s: elapsed), `recording/meters` (~20–30Hz: mic/desktop levels), `recording/stats` (2s: fps, dropped, bitrate).
5. UI HUD consumes those events only (§5.9). No polling of Rust internals; the event stream _is_ the state sync.
6. Stop → `invoke("stop_recording")` → the parent's `ChildStdin` is dropped → `ssp-mux` sees EOF, writes the trailer and exits (parent waits, bounded) → remux MKV→MP4 if configured → thumbnail extracted → row upserted into SQLite → `emit("recording/finished", {path, meta})` → toast + Library highlight (DESIGN §6.5).
7. Failure at any point → typed `CoreError` → `recording/error` event → human copy mapping; raw error only in tracing log.

### 3.3 Third-party services

None of the network kind. "Third-party" for MVP = **system services**: xdg-desktop-portal, PipeWire, V4L2, compositor-specific protocols — encountered only through their documented client crates. No outbound HTTP in MVP (that keeps the security story short and the CSP strict: `default-src 'self'; ipc: http://ipc.localhost`).

---

## 4. State Management & Error Handling

### 4.1 State ownership law

| State                                                              | Owner                                     | Sync                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Recording session (status, timers, meters, stats)                  | **Rust** — `AppState` pipeline controller | Events push → Zustand reducers; Rust truth, UI views                                                      |
| Source/portal capability state                                     | **Rust**                                  | Events after each portal session change                                                                   |
| Library rows & metadata                                            | **Rust (SQLite)**                         | Commands (query on view mount + after `recording/finished`)                                               |
| User settings                                                      | **Tauri store, mirrored TOML on disk**    | Commands read/write; cache in Rust; UI reads via `invoke("get_settings")`                                 |
| Ephemeral UI (panel open, PiP position, popover open, drag ghosts) | **React/Zustand**                         | Never round-trips to Rust; persisted only where DESIGN.md says (PiP position) via `invoke("set_ui_pref")` |

Principles: Rust is the single source of truth for anything hardware-related; the webview store is a **projection with a schema**, not a peer. Events are the only crossing for streaming data; commands are the only crossing for mutations. No shared mutable state over IPC.

Task 2.6: `app_state.rs` serializes recording actions from IPC, the native tray,
and Quit on a blocking worker (never the GUI thread). Stop and Quit share the
same flush → library upsert → finished-event path. A failed index write retains
the finalized take for retry; Quit reports failure and keeps the app open.
`tray.rs` owns native menu handles. Hiding requires an available tray host;
automatic hiding additionally follows successful HUD creation for the current
take. Stop/failure restores the main window. Closing the main window hides it;
explicit Quit finalizes before exiting. `recording/started` initializes the
frontend projection even when the tray initiated the recording.
Main owns HUD teardown as well as creation, so Stop cannot leave a late-created
toolbar orphaned. Source release uses the same lifecycle lock as tray Start.
Stream loss invalidates Start readiness before notifying the tray; the source
handle remains owned for release/Quit cleanup, including loss before selection
finishes committing.

Phase 8 adds `starship_bridge.rs` as a _client_ of this same `AppState`: at boot it publishes the manifest, binds the UDS socket, and accepts only same-uid peers. Every bridge tool delegates to `app_state::run` or the shared `ipc::commands::select_source`/`flag_recording` helpers; it never keeps a parallel recording controller or cache. CET sidecars are derived metadata written at finalize from `StopOutcome` and chapter facts, next to the media file — no DB column, no upload, no synthetic click/silence events. A failed sidecar write is logged and never discards a valid take.

### 4.2 Error-handling strategy (layered)

1. **Rust:** every module returns typed `CoreError` (thiserror): `Portal{...}`, `Encoder{...}`, `PipeWire{...}`, `Disk{...}`, `Settings{...}`. Bubble to command boundary; never `.unwrap()` outside tests; tracing captures full context (`span`s per session).
2. **IPC boundary:** `CoreError` → serializable `{code, kind, retryable, userMessage}` where `userMessage` is the exact human copy (DESIGN §7.9 vocabulary). Codes are stable strings (`portal.denied`, `encoder.unavailable`, `disk.full`).
3. **Frontend:** `lib/errors.ts` maps codes → toast/inline patterns per DESIGN §5.2/§5.6; unknown codes render the generic fallback with a "Details" action that opens the log. Errors never render raw backend strings.
4. **Recovery defaults:** with `auto`, encoder failure → fallback chain NVENC→VAAPI→x264 with the §6.1 warning notice. An EXPLICITLY requested backend (`settings.capture.encoder` or `SSP_FORCE_ENCODER`) that cannot initialize returns `encoder.unavailable` with `details.forced`/`details.encoderChain` — it never silently records with a different backend and mislabels the chip (API §1/§2.3, PLAN 7.4). Portal denial → education slot (§6.3) not an error; disk issues → error toast with free-space guidance. Retryable ops expose the action; non-retryable explain the cause.
5. **Crash-safety:** `ssp-mux` writes directly into the selected container — MKV with 1 s clusters, or fragmented MP4 with `moof`/`mdat` pairs (Phase 9.1). A parent crash closes stdin; the child flushes AVIO and writes the trailer, leaving a probeable file without a post-take remux (PRD M9).
6. **9.3 projections (chapters / segments):** the Rust/SQLite layer is the ONLY source of truth for markers (`recordings.chapter_json`) and segment boundaries (`recordings.segment_json`). The parent sends bounded `Chapter`/`Split` control frames on the same `ssp-mux` pipe in FIFO order; the child projects native chapter tags after stream setup, after each Split and at finalize, and opens the next segment path without dropping a frame. No media bytes cross Tauri IPC (API §6 standing flag) and no native tag is ever read back as authoritative.

---

## 5. Naming, Code Style, Environment

### 5.1 Naming conventions

- Rust: `snake_case` modules/functions, `UpperCamelCase` types, `SCREAMING_SNAKE` consts. Modules named by domain (`capture/portal.rs` not `portal_capture.rs`).
- TS: `PascalCase` components, `camelCase` functions/vars, `kebab-case` CSS/token files. Types end in plain nouns; no `I` prefixes.
- IPC contract: commands `snake_case` verbs (`start_recording`), events `domain/verb` (`recording/tick`, `library/updated`).
- Design tokens: DESIGN.md v6.0 semantic roles live in `src/styles/linear-theme.css` and `src/styles/recording-tokens.css`, then map to Tailwind `@theme inline` (`--bg-app`, `--bg-surface`, `--bg-active`, `--blue`, `--blue-text`, `--shadow-card`…).
- Files: one primary type per file; test files `name.rs` + `#[cfg(test)] mod tests` (Rust), `*.test.{ts,tsx}` (TS).

### 5.2 Code style

- Rust: rustfmt + clippy `-D warnings`; edition 2024. TS: tsc strict, eslint, prettier; no `any` in the ipc contract.
- Comments explain _why_, never restate _what_; exported contracts carry doc comments.
- All UI work must obey DESIGN.md v6.0 (verified automatically by `npm run check:linear` + `/* DESIGN.md v6.0 */` provenance).

### 5.3 Environment variables list (dev/runtime only — none in production UI)

| Var                        | Meaning                                                                                         | Default        |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `SSP_LOG_FILE`             | Override log file path                                                                          | XDG state dir  |
| `SSP_LOG_LEVEL`            | trace/debug/info/warn/error                                                                     | info           |
| `SSP_DATA_DIR`             | Override recordings/library data dir                                                            | XDG data dir   |
| `SSP_CONFIG_DIR`           | Override config dir                                                                             | XDG config dir |
| `SSP_FORCE_ENCODER`        | force `nvenc`/`vaapi`/`x264` (dev/debug); unavailable forced backend = typed error, no fallback | auto-detect    |
| `SSP_DISABLE_PORTAL_CACHE` | Skip portal consent caching                                                                     | unset          |
| `SSP_MUX_BIN`              | Override the `ssp-mux` helper path (dev/test/packaging)                                         | sibling binary |
| `TAURI_ENV_*`              | Tauri building standard vars (dev)                                                              | n/a            |

Runtime env is never a release setting — user-facing configuration lives in the TOML config and Settings UI only.

---

## 6. Scalability & Performance Notes

- **Video never crosses the IPC.** The webview receives state and 1–8fps still previews; all heavy pixel work stays in the Rust process (DESIGN.md requirement + biggest perf win). This means UI perf is decoupled from recording perf by construction. Encoded packets cross a _private anonymous pipe_ to `ssp-mux` (Phase 9.2) — a process fd, not a Tauri channel; each wire frame is length-prefixed with an 8 MiB cap, so the child's memory is bounded.
- **Crash-finalized takes (Phase 9.2).** The muxer subprocess finalizes on stdin EOF, which the kernel provides even when the parent is SIGKILLed; no in-process destructor is required. The child writes the header synchronously before the parent's start reply and flushes AVIO at the session's 1 Hz cadence, bounding crash loss to ~1 s.
- **Helper fd hygiene (Phase 9.2).** `ssp-mux` is spawned with `pre_exec` closing fds ≥ 3: libavdevice's raw `/dev/video*` opens are not `O_CLOEXEC`, and an inherited camera fd otherwise blocks camera close→reopen (proven by a parallel-test failure). Only the three stdio fds survive into the child.
- **Packaging seam (Phase 9.2).** `bundle.active` stays false and nfpm ships the app; the release pipeline must place the `[[bin]] ssp-mux` artifact beside the executable (or in Tauri's resource dir). `tauri.conf.json`'s `externalBin` entry is deliberately deferred: tauri-build rejects the config when `binaries/ssp-mux-<triple>` is not staged, so it is added in the packaging task that stages that artifact. `SSP_MUX_BIN` overrides discovery for dev/tests.
- **Event throttling is a contract:** meters ≤30Hz, stats 2s, ticks 1s — coalesced in Rust before emit; the webview never receives per-frame events.
- **Buses, not copies:** frame bus uses `SpScQueue` handoff; compositing and encode run in dedicated worker threads pinned by the session controller; one allocation per frame max, reuse of buffers via a small `BytesMut` pool.
- **Encoder priority:** auto chain NVENC → VAAPI → x264. Probes are device-init based (VAAPI: usable DRM render node; NVENC: usable CUDA device) and cached per process; automatic x264 fallback is visible (§6.1) so perf surprises are explained, not mysterious (PRD M8). Hardware PRD §8 gates (<0.5% drops @1080p60, <150 MB RSS, <50 ms A/V drift / 60 min) are activated by `is_hardware`; x264 uses separate gross bounds (PLAN 7.4). A forced unavailable backend fails typed instead of falling back.
- **SQLite discipline:** single writer connection (library index), WAL mode, upserts only after file finalization; indexing on the few real queries (recent, by-date, search path) — it's a metadata index, not a data warehouse.
- **Thumbnails:** one frame per recording, cached as PNG next to metadata row; drawn cheap in the grid; never generated synchronously with view mount (deferred task).
- **Startup:** no blocking IO on the Tauri main thread; settings load async; first frame ≤ 500ms after consent — measured by CI perf test (PRD G3).
- **Memory:** recording at 1080p60 stays ~<150MB process RSS; guard via pipeline test backstop (ring buffers, bounded channels — backpressure drops oldest preview frames before dropping encode frames).
- **V2 seams (built-in but unused):** `Encoder` trait and `Composite` stage cleanly extend to multi-source compositing and RTMP muxing; `library/` schema includes `kind` column now (recording/screenshot/stream-marker) so V2 features need migrations, not rewrites. Everything else: **no speculative V2 code**.
- **Scaling users, not servers:** the app scales by distro packaging and GitHub Releases; the only "hosting" is repo artifacts. Community growth handled by repo hygiene (issues, templates), not infrastructure.
