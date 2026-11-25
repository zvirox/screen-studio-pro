# SETUP.md — Running ScreenStudio Pro Locally

**Version:** 2.0 · **Current State:** Active Tauri 2 + Rust + React codebase (`0.1.0-beta.1`, Unified Linear UI v5.0). Builds, tests, and packages natively via `nfpm`.

---

## 0. Current State of the Repository

| Task | Supported Today? | Command / Notes |
|---|---|---|
| Build & run desktop app (`npm run tauri dev`) | ✅ | Compiles Rust core + starts Vite HMR on Wayland/X11 Linux |
| Run frontend gates (`check:linear`, `typecheck`, `lint`, `test`, `build`) | ✅ | 35 Vitest suites / 316 tests, strict TypeScript, ESLint, Linear design check |
| Run Rust gates (`cargo fmt`, `clippy`, `cargo test`) | ✅ | Verified inside `src-tauri/` |
| Generate native Linux packages (`.deb`, `.rpm`, `.pkg.tar.zst`) | ✅ | `nfpm` via `packaging/nfpm.yaml` + `.github/workflows/release.yml` |

---

## 1. Prerequisites (Linux Build & Runtime)

| Tool | Version / Role | Check |
|---|---|---|
| **Node.js + npm** | Node ≥ 20 LTS (`22` recommended) | `node -v && npm -v` |
| **Rust toolchain** | Stable `>= 1.85` (Rust 2024 edition) | `rustc --version` |
| **Tauri 2 Linux deps** | `webkit2gtk-4.1`, `pkg-config`, `libudev`, `openssl`, `libappindicator` | `pkg-config --modversion webkit2gtk-4.1` |
| **PipeWire + ALSA** | `pipewire`, `libpipewire-0.3-dev`, `libspa-0.2-dev`, `libasound2-dev` | `pw-cli --version` |
| **FFmpeg dev headers** | `libavcodec`, `libavformat`, `libavutil`, `libswscale`, `libavdevice` | `pkg-config --modversion libavcodec libavformat` |
| **XDG Portals** | `xdg-desktop-portal` + compositor backend (`hyprland`/`kde`/`gtk`/`wlr`) | `busctl --user list \| grep -i portal` |
| **SQLite** | Embedded via `rusqlite` — no external database daemon needed | Created on first launch (`library.db`) |

**Platform Matrix:**
- **Linux (Wayland-first, X11 portal compatible):** Full product runtime (PipeWire capture, XDG Portals, V4L2 camera, FFmpeg encode/mux, native tray & HUD).
- **Non-Linux / headless dev:** Vite frontend preview (`npm run dev` / `npm run preview`) works without PipeWire/Tauri; Rust capture requires Linux system libraries.

---

## 2. Install Distro Prerequisites

### Arch / EndeavourOS / Manjaro / CachyOS
```bash
sudo pacman -S --needed base-devel pkgconf cmake clang ffmpeg webkit2gtk-4.1 \
  pipewire pipewire-audio gst-plugin-pipewire alsa-lib libappindicator-gtk3
```

### Debian / Ubuntu / Pop!_OS
```bash
sudo apt install -y build-essential curl pkg-config libwebkit2gtk-4.1-dev \
  libudev-dev libssl-dev ffmpeg libavcodec-dev libavformat-dev libavutil-dev \
  libswscale-dev libavdevice-dev libpipewire-0.3-dev libspa-0.2-dev \
  libasound2-dev libayatana-appindicator3-dev
```

### Fedora / RHEL
```bash
sudo dnf install -y gcc gcc-c++ clang make cmake pkgconf-pkg-config \
  webkit2gtk4.1-devel libudev-devel openssl-devel ffmpeg-free-devel \
  pipewire-devel pipewire-libs alsa-lib-devel libxdo-devel \
  libayatana-appindicator-gtk3-devel
```
*(Or `ffmpeg-devel` instead of `ffmpeg-free-devel` when RPM Fusion is enabled.)*

---

## 3. Clone, Run & Verify Locally

```bash
git clone https://github.com/zvirox/screen-studio-pro.git
cd screen-studio-pro
npm install
```

### Run Desktop App in Dev Mode
```bash
npm run tauri dev
```
This launches the native Tauri window (`1280×800`, min `1024×640`) powered by Vite at `http://localhost:1420`.

### Environment Variables (Optional — No `.env` file used)
See `ARCHITECTURE.md §5.3` for the complete list (`SSP_LOG_LEVEL`, `SSP_LOG_FILE`, `SSP_DATA_DIR`, `SSP_CONFIG_DIR`, `SSP_FORCE_ENCODER`, `SSP_DISABLE_PORTAL_CACHE`):
```bash
export SSP_LOG_LEVEL=debug
export SSP_DATA_DIR="$HOME/Videos/SSP"
```

### Verification Commands (Exact CI Parity)
```bash
# Frontend: Linear design gate, strict TypeScript, ESLint, Vitest (316 tests), Vite build
npm run check:linear && npm run typecheck && npm run lint && npm test -- --run && npm run build

# Rust core: formatting, lint, unit & integration tests
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test

# Optional real-hardware portal/audio manual tests (#[ignore]-gated)
SSP_LOG_LEVEL=debug cargo test -- --ignored --nocapture
```

---

## 4. Database & Reset During Development

SQLite (`$XDG_DATA_HOME/screen-studio-pro/library.db`, WAL mode, `0600`) applies embedded migrations automatically on startup (`user_version = 2`):
```bash
sqlite3 "${XDG_DATA_HOME:-$HOME/.local/share}/screen-studio-pro/library.db" 'PRAGMA user_version; SELECT key FROM ui_prefs;'
```
To reset local index state cleanly:
```bash
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/screen-studio-pro/library.db"*
```

---

## 5. Common Setup Errors & Fixes

1. **`webkit2gtk-4.1 not found`** → Install `-dev`/`-devel` package and check `pkg-config --modversion webkit2gtk-4.1`.
2. **`ffmpeg-sys-next` missing headers or FFmpeg 9 enum mismatches** → Install `libav*-dev` / `ffmpeg-devel`; `src-tauri/Cargo.toml` already enables `ffmpeg-next` `non-exhaustive-enums`.
3. **Portal consent dialog never opens on Hyprland/niri** → Ensure `xdg-desktop-portal` and your compositor backend (`xdg-desktop-portal-hyprland` / `-kde` / `-wlr`) are running: `systemctl --user restart xdg-desktop-portal`.
4. **`pipewire-rs` build fails linking `libpipewire-0.3`** → Install `libpipewire-0.3-dev` + `libspa-0.2-dev` (or `pipewire-devel` / `pipewire-spa-devel`).
5. **Prebuilt Distro Package Install** → Download `.deb`, `.rpm`, or `.pkg.tar.zst` + `SHA256SUMS` from GitHub Releases (Flatpak, AppImage, tarballs, and AUR are permanently retired).
