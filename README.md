# ScreenStudio Pro

**A modern, open-source screen recording app for Linux — a frosted-glass alternative to OBS for Hyprland, niri, MangoWC and KDE.**

> **Status: planning phase.** The product is fully specified and no application code exists yet. All source-of-truth documents are in this repo and reviewed. Implementation begins with the approved MVP milestone plan.

## 📸 Screenshots

<!-- TODO: replace with real captures from the first running build -->
| Record screen | Recording HUD | Library |
|:---:|:---:|:---:|
| *placeholder — main window with source deck, audio strip, camera slab* | *placeholder — floating glass toolbar with timer* | *placeholder — recordings grid, dark mode* |

## ✨ Key Features (MVP)

- **Wayland-native capture** — monitor, window, and region recording via xdg-desktop-portal + PipeWire
- **Audio from PipeWire** — microphone and system/desktop audio with per-channel mute and level control
- **Webcam picture-in-picture** — draggable glass PiP frame with circle or rounded-square shape
- **Floating recording HUD** — translucent glass toolbar: record / pause / resume / flag / stop, draggable with corner snapping
- **Hardware-first encoding** — auto-detects VAAPI (Intel/AMD) and NVENC (NVIDIA); falls back to x264 with a visible notice
- **Crash-safe files** — records to MKV, auto-remuxes to MP4 on stop; a crash never loses the take
- **Quality presets in plain language** — "For YouTube — 1080p60, ~12 Mbps" instead of encoder jargon
- **Recording library** — thumbnail grid of past recordings with duration, size, encoder metadata
- **A UI worth screenshotting** — frosted-glass panels, spring motion, dark mode by default

Parking-lot (from the roadmap, not in MVP): RTMP streaming, OBS-style scene compositor, replay buffer, screenshots, cursor spotlight/zoom effects — see PRD.md for the full V2/Later list.

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Core / backend | **Rust** — PipeWire (`pipewire-rs`), portals (`ashpd`), encoding via `ffmpeg-next` (VAAPI/NVENC/x264), audio via `cpal`, camera via `v4l2r` |
| App shell | **Tauri 2** (native Linux desktop app) |
| Frontend | **React 19 + TypeScript + Vite** |
| Styling / UI | **Tailwind CSS v4**, shadcn/ui (Radix primitives), framer-motion, dnd-kit, lucide-react |
| State | **Zustand** on the webview side; Rust pipeline as single source of truth |
| Data | **SQLite** (`rusqlite`) — local library index only, no server |
| Packaging | Arch (AUR), deb, rpm — GitHub Releases |

No servers, no HTTP APIs, no telemetry. The Rust core does all capture and encoding; the webview renders UI only and never touches a video frame.

## 🍴 Quick Start

> ⚠️ **No runnable build exists yet** — the repo is currently specification-only. The command-block below describes the *target* developer workflow for when the first buildable scaffold lands; it does not work today.
>
> Steps 1–3 work right now if you want to contribute to the specs:

1. **Clone the repo**
   ```bash
   git clone https://github.com/zvirox/screen-studio-pro.git
   cd screen-studio-pro
   ```
2. **Read the product brief** — [PRD.md](PRD.md) (scope, features, target users)
3. **Skim the contracts** — [DESIGN.md](DESIGN.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [API.md](API.md); the working rules for any AI or human contributor are in [AGENTS.md](AGENTS.md)
4. **Install the prerequisites for the Rust build side** — Rust toolchain (rustup), plus the PipeWire/portal development libraries your distro needs *(exact package list will be finalized with the first buildable crate)*
5. **Run the dev app once scaffolded** *(command will be documented here at scaffold time — nothing is invented here in advance)*

## 🌍 Environment Variables

Runtime/debug variables only (user-facing configuration lives in the app's Settings and TOML config — see ARCHITECTURE.md §5.3):

| Name | Purpose | Example value |
|---|---|---|
| `SSP_LOG_FILE` | Override the log file location | `~/ssp-debug.log` |
| `SSP_LOG_LEVEL` | Log verbosity: `trace`/`debug`/`info`/`warn`/`error` | `debug` |
| `SSP_DATA_DIR` | Override recordings/library data directory | `~/Videos/SSP` |
| `SSP_CONFIG_DIR` | Override config directory | `~/.config/screen-studio-pro` |
| `SSP_FORCE_ENCODER` | Force a specific encoder for testing | `vaapi` (or `nvenc`, `x264`) |
| `SSP_DISABLE_PORTAL_CACHE` | Skip portal consent caching | `1` |

## 📁 Folder Structure

**Today (specification phase):**
```
screen-studio-pro/
├── PRD.md              # Product requirements: scope, features, metrics
├── PRODUCT.md          # Brand feel & product context for design work
├── DESIGN.md           # UI design system: tokens, components, layouts, a11y law
├── ARCHITECTURE.md     # Stack, folder tree, data flow, state & error strategy
├── DATABASE.md         # SQLite schema, indexes, migrations
├── API.md              # Full IPC contract: commands, events, error codes
├── AGENTS.md           # Rulebook for AI coding assistants
├── docs/               # (planned: portal-support.md per-compositor quirks)
└── LICENSE             # MIT
```

**Target tree at MVP (from ARCHITECTURE.md §2):** `src-tauri/` (Rust: `capture/`, `encode/`, `pipeline/`, `library/`, `ipc/`) + `src/` (React: `components/{record,library,settings,huds,chrome}/`, `lib/`, `types/`) + `packaging/` (aur, deb, rpm, icons) + `.github/workflows/`.

## ⌨️ Available Scripts

**Currently available: none** — there is no buildable code yet, and we don't list commands that don't exist.

Planned once the scaffold lands (per ARCHITECTURE.md §5.2): Rust formatting/lint (`cargo fmt`, `cargo clippy -D warnings`), TypeScript strict check (`tsc --noEmit`), unit tests, Tauri dev/build entry points. Each will be wired into npm scripts and GitHub Actions CI and documented here at that time.

## 🤝 Contributing

Contributions are welcome — code, packaging, docs, and especially real-world Wayland bug reports (per-compositor quirks are our hardest problem). The rules of this repo are simple and binding for humans and AI assistants alike:

1. **Read AGENTS.md first** — it covers the workflow (plan → code → verify → summarize) and the hard limits (no stack changes, no new dependencies without asking, schema changes require updating DATABASE.md first).
2. **The contract files are law** — if a change conflicts with PRD/DESIGN/ARCHITECTURE/DATABASE/API, the request is a contract change, not a code change; propose it before implementing.
3. **Small, verified PRs** — one focused change per PR, tests and lint passed on it. Issues tagged `good first issue` on the PRD's MVP checklist are the intended entry points.
4. Bug reports: include your compositor (Hyprland/niri/MangoWC/KDE and version), portal/pipewire versions, GPU and driver — this data directly drives docs/portal-support.md.

## 📜 License

[MIT](LICENSE) © 2026 Zvirox
