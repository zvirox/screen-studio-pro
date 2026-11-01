# SETUP.md — Running ScreenStudio Pro locally

**Version:** 1.0 · **Truthfulness rule:** Every command below is labeled by what it is verified against, *today*. Nothing here invents a working script: this repo is a **Wayland/Linux desktop app in planning phase** — the product spec exists (see `README.md`), the app binary does **not** exist yet.

---

## 0. Current state of this repo (read first)

| You want to… | Possible today? |
|---|---|
| Read/validate the specification docs | ✅ |
| Run the app (`cargo tauri dev`) | ❌ — no `src-tauri/` yet (see `PLAN.md` Phase 0) |
| Run tests / lint | ❌ — no buildable code yet |

Sections 1–2 are copy-pasteable **today**. Section 3 is the exact planned setup that becomes correct the moment **PLAN.md task 0.1** (scaffold) lands — it is written against ARCHITECTURE.md/PLAN.md v1.0 and will be re-verified against the real `package.json`/`Cargo.toml` files at scaffold time, then the ⚠ labels in this file are removed.

---

## 1. Prerequisites

### 1.1 Today (docs-only work)
| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| A Markdown renderer for review | optional | — |

### 1.2 When the scaffold lands (⚠ planned, re-verify at 0.1)
| Tool | Version | Why / check |
|---|---|---|
| **Node.js + npm** | Node ≥ 20 LTS (22 LTS recommended; 19 and below break Vite 7-era tooling) | `node -v` |
| **Rust** | ≥ 1.85 (edition 2024 per ARCHITECTURE §5.2) | `rustup --version`, `rustc --version` |
| **Linux only — Tauri system deps** | `webkit2gtk-4.1`, `build-essential`/gcc, `pkg-config`, `libudev`, plus Tauri CLI 2.x | see distro commands below |
| **PipeWire** | ≥ 1.0 (client dev libs for `pipewire-rs`) | `pipewire --version`, `pw-cli ls Node \| head` |
| **Desktop portal runtime** | `xdg-desktop-portal` + a compositor-portal backend (KDE/GNOME/wlr) ≥ 1.17 for GlobalShortcuts | `busctl --user list \| grep -i portal` |
| **FFmpeg dev libraries** | FFmpeg ≥ 6.1 / 7.x with libav* headers (needed by `ffmpeg-sys-next`) | `pkg-config --modversion libavcodec libavformat libavutil` |
| **VAAPI/NVENC** (optional, hw path) | Intel/AMD: `mesa-va-drivers`; NVIDIA: driver + nvidia utils | `vainfo` / `nvidia-smi` |
| Python | **not required** | — |
| Database | **not installed by you** — SQLite is embedded via `rusqlite` and created at first app boot (DATABASE.md §1) | — |

**Platform differences (truthful):**
- 🐧 **Linux = the product.** All capture/encode paths (PipeWire, portals, V4L2, VAAPI) exist only here. Wayland session expected; X11 is out of MVP scope.
- 🍎 **macOS = frontend-only preview.** You can run the Vite dev server of the React UI to view mockups/components, but the Rust core cannot build (no PipeWire/portals). Support for this path lands with task 0.5+; PRD N3 rules out a mac *product*.
- 🪟 **Windows = not supported at all**, dev or product (PRD N3). Do not attempt.

---

## 2. Today's setup — verified commands ✅

```bash
# 1. Clone
git clone https://github.com/zvirox/screen-studio-pro.git
cd screen-studio-pro

# 2. Inspect the current tree (9 doc files, LICENSE, no code yet)
ls -la

# 3. Read the contracts in priority order (AGENTS.md §2)
$PAGER PRD.md ARCHITECTURE.md DESIGN.md DATABASE.md API.md PLAN.md

# 4. Verify nothing is broken in the docs themselves
git status && git log --oneline -5
```

That's the complete, honest setup for the current phase.

---

## 3. Developer setup once scaffolded (⚠ pending — becomes verified at PLAN 0.1)

### 3.1 Install distro prerequisites (Linux)

```bash
# Arch / EndeavourOS
sudo pacman -S --needed base-devel pkgconf cmake clang ffmpeg webkit2gtk-4.1 \
  pipewire pipewire-audio gst-plugin-pipewire

# Debian 13+ / Ubuntu 25.04+
sudo apt install -y build-essential curl pkg-config libwebkit2gtk-4.1-dev \
  libudev-dev libssl-dev ffmpeg libavcodec-dev libavformat-dev libavutil-dev \
  libpipewire-0.3-dev libspa-0.2-dev

# Fedora
sudo dnf install -y gcc gcc-c++ clang make cmake pkgconf-pkg-config \
  webkit2gtk4.1-devel libudev-devel openssl-devel ffmpeg-devel \
  pipewire-devel pipewire-spa-devel
```

```bash
# Tauri CLI + Rust (both needed regardless of distro)
npm install -g @tauri-apps/cli@^2
rustup install stable --profile default
rustup default stable
```

```bash
# Clone + install
git clone https://github.com/zvirox/screen-studio-pro.git
cd screen-studio-pro
npm install          # frontend deps (planned to exist at 0.1)
```

### 3.2 Environment variables (⚠ — no `.env` file exists, deliberately)

This app **does not use a dotenv loader** — Tauri doesn't read `.env` automatically and ARCHITECTURE.md deliberately keeps runtime config in shell env + TOML. So instead of editing `.env`, export the vars your shell (or build your `.bashrc` alias). The full canonical list is ARCHITECTURE §5.3; the two you actually need first:

```bash
# Put recordings + library somewhere explicit (defaults to XDG dirs otherwise)
export SSP_DATA_DIR="$HOME/Videos/SSP"
export SSP_LOG_LEVEL=debug            # debug while developing
mkdir -p "$SSP_DATA_DIR"
```

All variables: see ARCHITECTURE.md §5.3 (`SSP_LOG_FILE`, `SSP_CONFIG_DIR`, `SSP_FORCE_ENCODER`, `SSP_DISABLE_PORTAL_CACHE`). When task 0.x lands the scaffold, a minimal `.env.example` will be committed matching that table — until then, treat the ARCHITECTURE table as the source.

### 3.3 Database setup, migrations, seeds (⚠)

**There are no manual migration or seed commands — by design** (DATABASE.md §1/§8):

```bash
# nothing to run: on first app boot the runner creates
#   $XDG_DATA_DIR/screen-studio-pro/library.db     (WAL, 0600)
# and applies 0001_recordings.sql, 0002_ui_prefs.sql in order,
# seeding ui_prefs defaults (DATABASE.md §7.1) automatically.
```

To verify migrations applied (⚠ after first boot):

```bash
sqlite3 "$XDG_DATA_HOME/screen-studio-pro/library.db" \
  'PRAGMA user_version;'          # expect: 2
sqlite3 "$XDG_DATA_HOME/screen-studio-pro/library.db" \
  'SELECT key FROM ui_prefs;'     # expect: hud.position, pip.shape, …
```

To reset the DB during development (safe — it's throwaway locality data, recordings themselves live in `$SSP_DATA_DIR`):

```bash
rm "$XDG_DATA_HOME/screen-studio-pro/library.db"      # recreated on next boot
```

### 3.4 Start dev server (⚠)

```bash
npm run tauri dev    # compiles Rust once (~2–6 min first build), then launches the app window
```

- Tauri opens the **app window itself** — this is a desktop app: there is **no localhost URL to open**.
- Behind the scenes Vite serves the React bundle at `http://localhost:1420`; you only visit that in a plain browser for pure-frontend work (DESIGN mockups / component sheets) when the app isn't involved first.
- Hot reload: TS errors appear live; Rust errors fail the tauri build in the terminal pane.

### 3.5 Run tests (⚠)

```bash
# Rust unit tests (frame bus, muxer crop math, migration runner…)
npm run tauri dev -- --no-watch   # build once, or:
cd src-tauri && cargo test

# Frontend type integrity (strict, guards the IPC contract)
npm run typecheck

# Lint (both sides — AGENTS DO #7)
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings
npm run lint

# Full pre-PR gate (also what ci.yml runs)
npm run tauri build && cargo test && npm run typecheck && npm run lint
```

---

## 4. Common setup errors and fixes (8+)

1. **`webkit2gtk-4.1 not found / pkg-config can't find it`** — the #1 Tauri 2 build failure.
   → Install the `-dev`/`-devel` variant listed in §3.1 (not the runtime package). Verify: `pkg-config --modversion webkit2gtk-4.1`.
2. **`error: failed to select a version for 'ashpd' ...` / portal crate build failure** — stale Cargo lock or wrong Tauri CLI major.
   → `rm src-tauri/Cargo.lock && cargo build`; ensure `tauri --version` reports a 2.x CLI, not 1.x (`npm i -g @tauri-apps/cli@^2`).
3. **`ffmpeg-sys-next: pkg-config did not find libavutil`** — you have the ffmpeg *runtime*, not the *dev* headers.
   → Install `libav*-dev` (deb) / `ffmpeg-devel` (rpm) / the `ffmpeg` group's headers (Arch ships them in `ffmpeg`). Re-check with `pkg-config --modversion libavutil`.
4. **`GLIBC / rustc edition 2024 requires 1.85`** — distro Rust is too old.
   → Don't use the system rustc; use rustup: `rustup install stable && rustup default stable` then rebuild.
5. **`pw_context_connect failed` / `pipewire.stream_lost` on a Wayland compositor without portals installed** — e.g., a minimal Hyprland install lacking `xdg-desktop-portal-hyprland`.
   → Install your compositor's portal backend + `xdg-desktop-portal-gtk` (fallback), then `systemctl --user restart xdg-desktop-portal`.
6. **App window opens but preview pane stays in the education slot & no consent dialog appears** — the portal desktop file isn't registered (containerized/sandboxed setups, some Nix configs).
   → Run outside a sandbox first; check `journalctl --user -u xdg-desktop-portal -f` while clicking a source. (This is exactly PRD's per-compositor risk — record findings in `docs/portal-support.md`.)
7. **`sqlite3: command not found` while verifying migrations in §3.3** — expected on fresh systems; the app needs only `rusqlite`.
   → `sudo apt install sqlite3` / `sudo pacman -S sqlite` / `sudo dnf install sqlite`, or verify via the app's About pane instead.
8. **JS build fails: `Node 18 is not supported` / engine mismatch** — Nodeifier too old for the planned template.
   → Node ≥ 20 LTS (22 recommended): use `nvm install 22 && nvm use 22`, then delete `node_modules/` + `package-lock.json` and `npm install` again.
9. **DB `user_version` reports 0 after boot / migrations re-run forever** — someone wrote to the DB with a different tool between boots or `SSP_DATA_DIR` changed mid-session.
   → Reset per §3.3 and confirm `SSP_DATA_DIR` is exported identically everywhere you launch.
10. **`cargo tauri dev` exits: `another daemon is already holding the portal session`** — a crashed dev instance left the session alive.
    → Kill stale SSP processes: `pkill -f screen-studio-pro` (or close old windows), then re-run dev.
11. **Permissions trap:** you copied the repo into a folder with restrictive ACLs and DB creation fails with `disk.write_failed` poisoning the boot.
    → Ensure `$XDG_DATA_HOME/screen-studio-pro/` is owned by your user with `0700` (see DATABASE.md §6).

---

## 5. When this file gets re-verified

| Trigger | Action |
|---|---|
| PLAN.md task **0.1** merges (scaffold exists) | Run every §3 command for real; fix to what works; drop all ⚠ labels; commit `.env.example` placeholders if any env var deserves one |
| Any dependency version bump in ARCHITECTURE §1 | Update §1.2 table above in the same PR (README rule: no invented commands) |
| First release (PLAN 7.5) | Add a user-facing "install" section pointer to distro packages; keep this file dev-only |
