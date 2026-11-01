# ARCHITECTURE.md — ScreenStudio Pro

**Version:** 1.0 · **Authority chain:** PRD.md (scope) → ARCHITECTURE.md (structure) → DESIGN.md (UI law)
**Rules applied:** simple, popular, well-documented tools only. No code in this file. MVP scope only (recording), with named seams for V2 streaming and the scene compositor — seams, not scaffolding.

---

## 1. Tech Stack (with one-line reasons)

| Layer | Choice | Reason |
|---|---|---|
| App shell | **Tauri 2** | Small native Linux binaries, custom titlebar/glass panels, and a clean Rust↔webview IPC — decided in stack selection |
| Frontend | **React 19 + TypeScript + Vite** | Fast HMR dev loop, TS types the IPC contract end-to-end, Vite is the standard bundler for Tauri |
| Styling | **Tailwind CSS v4** | `@theme` block generates directly from DESIGN.md tokens (§8 governance); utility speed for a panel-dense app |
| UI kit | **shadcn/ui + Radix primitives** | Accessible, copy-paste components restyled to DESIGN.md specs — no version-fight npm dependency |
| Motion | **framer-motion** | Spring-based motion tokens (§4.6) in one system without hand-rolled RAF code |
| State (TS) | **Zustand** | Async-heavy state syncing with Tauri events fits its vanilla-store model; smallest API surface |
| DnD | **dnd-kit** | Powers region overlay + V2 compositor canvas; keyboard-accessible by default |
| Language (core) | **Rust, single crate `screen-studio-pro` (workspace later if ever needed)** | All capture/encode logic is native; a monolith crate avoids premature workspace ceremony |
| Tauri plugin | **tauri-plugin-notification, tauri-plugin-dialog, tauri-plugin-global-shortcut** | Official, documented glue for toasts, file dialogs, portal shortcuts |
| Desktop portals | **ashpd** crate | Purpose-built async client for xdg-desktop-portal (screencast/camera/global-shortcuts) — the Wayland-first path PRD requires |
| Media framework | **PipeWire via `pipewire-rs`** | THE audio/video nerve center of every target compositor (Hyprland/niri/MangoWC/KDE); portal screencast lands here |
| Audio input | **cpal** (mic capture) + PipeWire desktop audio | cpal is the standard, simple Rust audio-device abstraction; desktop audio rides the PipeWire stream |
| Video encoding | **ffmpeg-next (libavcodec bindings)** | One API gives x264 today and Cy-codec hardware encoders (VAAPI/NVENC) via hwaccel configs; ubiquitous, documented |
| Mux/file IO | **ffmpeg-next muxing (libavformat)** | MKV/MP4/WebM containers and MKV→MP4 remux without a second dependency |
| Camera | **V4L2 via `v4l2r`** | Direct UVC webcam capture is more reliable than the portal Camera API on our target compositors (PRD open question #1 — resolved favoring V4L2 first, portal fallback) |
| Database | **SQLite via `rusqlite`** (local library index only) | Recordings metadata + thumbnails need a queryable local index; SQLite is the boring, correct answer — no server |
| Thumbnails | **ffmpeg-next frame extraction → PNG cache** | One dependency already present generates poster frames |
| Image | **image** crate | PNG decode/encode for thumbnails small utilities |
| Config | **`config` crate + TOML** | Readable user config; simple, human-editable, popular |
| Logging | **`tracing` + `tracing-subscriber` + tracing-appender** | Verbose diagnostics to file (§7.9: raw errors to log only) — industry standard |
| Error (Rust) | **thiserror** (core) / **anyhow** (glue) | Typed errors for the IPC contract, ergonomic ones for the shell |
| CI/CD | **GitHub Actions → GitHub Releases** | Standard; produces tagged builds consumed by distro packaging (PRD G5) |
| Hosting | **None** | Desktop app: distro packages + GitHub Releases are the distribution (no SaaS — PRD non-goal) |

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
├── packaging/                      # PRD G5: distro packaging
│   ├── aur/PKGBUILD
│   ├── deb/                        # debian/ control, rules
│   ├── rpm/                        # spec file
│   └── icons/                      # hicolor SVG/PNG icon set
├── docs/
│   └── portal-support.md           # Known per-compositor quirks (PRD risks §9)
└── src-tauri/                      # Rust core + Tauri shell
    ├── Cargo.toml
    ├── tauri.conf.json             # window config, CSP, bundle metadata
    ├── build.rs
    ├── capabilities/               # Tauri 2 permission manifests
    │   └── main.json
    ├── icons/                      # app icon set
    └── src/
        ├── main.rs                 # binary entry: builds Tauri app, binds commands
        ├── app_state.rs            # Owned AppState (recording controller handle, settings cache)
        ├── settings/
        │   ├── mod.rs              # load/save TOML config, Zod-equivalent validation
        │   └── defaults.rs         # first-run defaults (PRD G3: 60s-to-first-recording)
        ├── ipc/
        │   ├── mod.rs              # command + event registration (the UI↔core contract)
        │   ├── commands.rs         # #[tauri::command] handlers — thin, delegate to modules
        │   └── events.rs           # typed event payloads emitted to webview
        ├── capture/
        │   ├── mod.rs              # CaptureSource trait (monitor/window/region/camera/audio)
        │   ├── portal.rs           # ashpd screencast session orchestration
        │   ├── pipewire.rs         # PipeWire stream consumption → frame bus
        │   ├── camera_v4l2.rs      # V4L2 camera frames → frame bus (+ portal fallback)
        │   └── audio.rs            # cpal mic + PipeWire desktop audio → audio bus
        ├── encode/
        │   ├── mod.rs              # Encoder trait + capability detection (VAAPI/NVENC/x264)
        │   ├── hw_vaapi.rs         # VAAPI hwaccel encoder impl
        │   ├── hw_nvenc.rs         # NVENC hwaccel encoder impl
        │   └── sw_x264.rs          # CPU fallback impl
        ├── pipeline/
        │   ├── mod.rs              # Recording session controller: source→encode→file state machine
        │   ├── muxer.rs            # MKV/MP4/WebM writing + MKV→MP4 remux on stop
        │   ├── composite.rs        # webcam PiP compositing + region cropping (MVP overlay)
        │   └── stats.rs            # fps/drop/bitrate meters → throttled events
        ├── library/
        │   ├── mod.rs              # library index operations (CRUD)
        │   ├── store.rs            # rusqlite schema + migrations (embedded)
        │   └── thumbs.rs           # thumbnail generation + cache
        └── util/
            ├── paths.rs            # XDG dirs: config/data/cache locations
            └── error.rs            # CoreError enum → serializable IPC errors
└── src/                            # React frontend (Tauri webview)
    ├── package.json / vite.config.ts / tsconfig.json / index.html
    ├── tailwind.css                # @theme tokens generated per DESIGN.md v1.0
    ├── components.json             # shadcn config
    ├── main.tsx
    ├── App.tsx                     # NavBar + view router (Record/Library/Settings)
    ├── lib/
    │   ├── ipc.ts                  # typed wrappers over invoke() — mirrors src-tauri/ipc
    │   ├── events.ts               # typed listeners for Tauri events (single source)
    │   ├── store.ts                # Zustand store wiring: UI state ↔ events
    │   └── errors.ts               # CoreError → human copy mapping (DESIGN §7.9)
    ├── components/
    │   ├── ui/                     # shadcn primitives restyled to DESIGN.md §5
    │   ├── record/
    │   │   ├── SourceDeck.tsx      # monitor/window/region chips + preview (§6.1)
    │   │   ├── AudioStrip.tsx      # channel cards, meters, device popovers
    │   │   ├── CameraSlab.tsx      # PiP toggle/preview
    │   │   └── ActionRow.tsx       # Record button, preset select, encoder chip
    │   ├── library/
    │   │   ├── LibraryGrid.tsx     # §5.5 recording items
    │   │   ├── RecordingDrawer.tsx # detail drawer (§5.7)
    │   │   └── EmptyStates.tsx     # §6.3 education slots
    │   ├── settings/
    │   │   ├── SettingsView.tsx    # left rail + panes (§6.4)
    │   │   └── panes/              # Capture/Audio/Camera/Files/Shortcuts/About
    │   ├── huds/
    │   │   ├── HudBar.tsx          # recording toolbar (§5.9)
    │   │   └── CameraPip.tsx       # floating PiP (§6.6)
    │   └── chrome/
    │       ├── NavBar.tsx          # window chrome (§5.8)
    │       └── ToastHost.tsx       # sonner-styled toasts (§5.6)
    ├── hooks/
    │   ├── useRecordingState.ts    # store selectors, session flow (§6.5)
    │   └── useGlobalShortcuts.ts   # portal shortcut registration via plugin
    └── types/
        ├── ipc.ts                  # command/event payload types (contract mirror)
        └── domain.ts               # Recording, Preset, SourceKind...
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
 │        → encode (VAAPI/NVENC/x264) → muxer (MKV→MP4)      │
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

### 3.2 Flow: start recording (the core path)
1. UI: user selects source chip → `invoke("select_source", kind)` → Rust orchestrates ashpd portal session (compositor consent prompt) → returns capability list + PipeWire fd handle. UI state = source live.
2. UI: user presses Record → `invoke("start_recording", {sourceId, audioChannels, presetId})`.
3. Rust pipeline: validates preset → wires buses (source→composite→encoder→muxer) → hot-swaps encoder by capability → opens MKV at target path → flips AppState → `emit("recording/started")`.
4. Rust emits throttled events while running: `recording/tick` (1s: elapsed), `recording/meters` (~20–30Hz: mic/desktop levels), `recording/stats` (2s: fps, dropped, bitrate).
5. UI HUD consumes those events only (§5.9). No polling of Rust internals; the event stream *is* the state sync.
6. Stop → `invoke("stop_recording")` → muxer closes → remux MKV→MP4 if configured → thumbnail extracted → row upserted into SQLite → `emit("recording/finished", {path, meta})` → toast + Library highlight (DESIGN §6.5).
7. Failure at any point → typed `CoreError` → `recording/error` event → human copy mapping; raw error only in tracing log.

### 3.3 Third-party services
None of the network kind. "Third-party" for MVP = **system services**: xdg-desktop-portal, PipeWire, V4L2, compositor-specific protocols — encountered only through their documented client crates. No outbound HTTP in MVP (that keeps the security story short and the CSP strict: `default-src 'self'; ipc: http://ipc.localhost`).

---

## 4. State Management & Error Handling

### 4.1 State ownership law
| State | Owner | Sync |
|---|---|---|
| Recording session (status, timers, meters, stats) | **Rust** — `AppState` pipeline controller | Events push → Zustand reducers; Rust truth, UI views |
| Source/portal capability state | **Rust** | Events after each portal session change |
| Library rows & metadata | **Rust (SQLite)** | Commands (query on view mount + after `recording/finished`) |
| User settings | **Tauri store, mirrored TOML on disk** | Commands read/write; cache in Rust; UI reads via `invoke("get_settings")` |
| Ephemeral UI (panel open, PiP position, popover open, drag ghosts) | **React/Zustand** | Never round-trips to Rust; persisted only where DESIGN.md says (PiP position) via `invoke("set_ui_pref")` |

Principles: Rust is the single source of truth for anything hardware-related; the webview store is a **projection with a schema**, not a peer. Events are the only crossing for streaming data; commands are the only crossing for mutations. No shared mutable state over IPC.

### 4.2 Error-handling strategy (layered)
1. **Rust:** every module returns typed `CoreError` (thiserror): `Portal{...}`, `Encoder{...}`, `PipeWire{...}`, `Disk{...}`, `Settings{...}`. Bubble to command boundary; never `.unwrap()` outside tests; tracing captures full context (`span`s per session).
2. **IPC boundary:** `CoreError` → serializable `{code, kind, retryable, userMessage}` where `userMessage` is the exact human copy (DESIGN §7.9 vocabulary). Codes are stable strings (`portal.denied`, `encoder.unavailable`, `disk.full`).
3. **Frontend:** `lib/errors.ts` maps codes → toast/inline patterns per DESIGN §5.2/§5.6; unknown codes render the generic fallback with a "Details" action that opens the log. Errors never render raw backend strings.
4. **Recovery defaults:** encoder failure → automatic fallback chain NVENC→VAAPI→x264 with the §6.1 warning notice; portal denial → education slot (§6.3) not an error; disk issues → error toast with free-space guidance. Retryable ops expose the action; non-retryable explain the cause.
5. **Crash-safety:** record to MKV always (remux after stop) — a crash mid-recording leaves a playable MKV (PRD M9).

---

## 5. Naming, Code Style, Environment

### 5.1 Naming conventions
- Rust: `snake_case` modules/functions, `UpperCamelCase` types, `SCREAMING_SNAKE` consts. Modules named by domain (`capture/portal.rs` not `portal_capture.rs`).
- TS: `PascalCase` components, `camelCase` functions/vars, `kebab-case` CSS/token files. Types end in plain nouns; no `I` prefixes.
- IPC contract: commands `snake_case` verbs (`start_recording`), events `domain/verb` (`recording/tick`, `library/updated`).
- Design tokens: exactly the DESIGN.md names in Tailwind `@theme` (`accent`, `surface-glass`, `elev-float`…).
- Files: one primary type per file; test files `name.rs` + `#[cfg(test)] mod tests` (Rust), `name.test.ts` (TS where meaningful).

### 5.2 Code style
- Rust: rustfmt + clippy `-D warnings`; edition 2024. TS: tsc strict, eslint, prettier; no `any` in the ipc contract (that file is fully typed both directions).
- Comments explain *why*, never restate *what*; every exported contract has a doc comment citing the governing doc (PRD feature ID / DESIGN section).
- All UI work must pass DESIGN.md §8 lint governance (`/* DESIGN.md v1.0 */` provenance in tailwind `@theme`).

### 5.3 Environment variables list (dev/runtime only — none in production UI)
| Var | Meaning | Default |
|---|---|---|
| `SSP_LOG_FILE` | Override log file path | XDG state dir |
| `SSP_LOG_LEVEL` | trace/debug/info/warn/error | info |
| `SSP_DATA_DIR` | Override recordings/library data dir | XDG data dir |
| `SSP_CONFIG_DIR` | Override config dir | XDG config dir |
| `SSP_FORCE_ENCODER` | force `nvenc`/`vaapi`/`x264` (dev/debug) | auto-detect |
| `SSP_DISABLE_PORTAL_CACHE` | Skip portal consent caching | unset |
| `TAURI_ENV_*` | Tauri building standard vars (dev) | n/a |

Runtime env is never a release setting — user-facing configuration lives in the TOML config and Settings UI only.

---

## 6. Scalability & Performance Notes

- **Video never crosses the IPC.** The webview receives state and 1–8fps still previews; all heavy pixel work stays in the Rust process (DESIGN.md requirement + biggest perf win). This means UI perf is decoupled from recording perf by construction.
- **Event throttling is a contract:** meters ≤30Hz, stats 2s, ticks 1s — coalesced in Rust before emit; the webview never receives per-frame events.
- **Buses, not copies:** frame bus uses `SpScQueue` handoff; compositing and encode run in dedicated worker threads pinned by the session controller; one allocation per frame max, reuse of buffers via a small `BytesMut` pool.
- **Encoder priority:** hardware path (VAAPI/NVENC) is switched per-machine on first selection and remembered; automatic x264 fallback is visible (§6.1) so perf surprises are explained, not mysterious (PRD M8).
- **SQLite discipline:** single writer connection (library index), WAL mode, upserts only after file finalization; indexing on the few real queries (recent, by-date, search path) — it's a metadata index, not a data warehouse.
- **Thumbnails:** one frame per recording, cached as PNG next to metadata row; drawn cheap in the grid; never generated synchronously with view mount (deferred task).
- **Startup:** no blocking IO on the Tauri main thread; settings load async; first frame ≤ 500ms after consent — measured by CI perf test (PRD G3).
- **Memory:** recording at 1080p60 stays ~<150MB process RSS; guard via pipeline test backstop (ring buffers, bounded channels — backpressure drops oldest preview frames before dropping encode frames).
- **V2 seams (built-in but unused):** `Encoder` trait and `Composite` stage cleanly extend to multi-source compositing and RTMP muxing; `library/` schema includes `kind` column now (recording/screenshot/stream-marker) so V2 features need migrations, not rewrites. Everything else: **no speculative V2 code**.
- **Scaling users, not servers:** the app scales by distro packaging and GitHub Releases; the only "hosting" is repo artifacts. Community growth handled by repo hygiene (issues, templates), not infrastructure.
