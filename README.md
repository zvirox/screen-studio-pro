<p align="center">
  <img src="src/assets/screen-studio-pro-logo.png" alt="Screen Studio Pro logo" width="180">
  <h1 align="center">Screen Studio Pro</h1>
</p>

<p align="center">
  <strong>Modern, beautiful screen recording for Linux desktops</strong>
</p>

<p align="center">
  <a href="https://github.com/zvirox/screen-studio-pro/releases"><img src="https://img.shields.io/badge/Release-Latest_Packages-blue.svg" alt="Releases" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/Platform-Linux_(Wayland_&_X11)-orange.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Stack-Rust_·_Tauri_2_·_React_19-indigo.svg" alt="Stack" />
</p>

<p align="center">
  <a href="#what-is-screen-studio-pro">What is it?</a> ·
  <a href="#key-features">Key Features</a> ·
  <a href="#starship-control-integration">Starship Control Integration</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#frequently-asked-questions">FAQ</a>
</p>

---

## What is Screen Studio Pro?

Screen Studio Pro is a clean, focused screen recording application built natively for Linux. Designed to give users on Wayland compositors (like Hyprland, KDE Plasma, GNOME, niri, and MangoWC) a sleek alternative to complex broadcast tools, it makes capturing high-quality video simple.

You can record an entire monitor, select an application window, or draw a custom region on your screen. Everything runs locally with zero telemetry, zero cloud dependencies, and a clean dark theme.

---

## Key Features

- **Wayland Native Capture**: Captures displays, individual application windows, or screen regions cleanly using PipeWire and the desktop portal system.
- **Synchronized Audio Recording**: Record your microphone and desktop audio at the same time. Adjust gain levels in real time with live audio meters.
- **Webcam Picture-in-Picture**: Add your camera feed over recordings. Move the camera preview to any corner, resize it, and choose between rectangular and circular framing.
- **Compact Recording HUD**: A floating companion timer lets you pause, resume, flag important chapters, and stop recordings without getting in the way of your work.
- **Built-in Recording Library**: View recent recordings with automatic thumbnails, search takes by name, and manage exports directly within the app.
- **Standard Video Formats**: Produces standard MKV and MP4 video files ready to share, edit, or upload.
- **Modern Linear-Style Design**: Solid matte dark surfaces, clean typography, keyboard navigation shortcuts, and smooth animations.

---

## Starship Control Integration

Screen Studio Pro works completely on its own as a standalone recording application. You do not need any companion software to capture and export videos.

If you want hands-free automation, you can connect Screen Studio Pro to **Starship Control**, the unified Linux AI desktop assistant.

### Why It Exists

When you are giving a demonstration, playing a game, or presenting slides, switching windows to click recording buttons can break your concentration. Connecting Screen Studio Pro to Starship Control lets you trigger, pause, and configure recordings using simple voice or text commands from your keyboard.

### Real-World Use Cases

- **Hands-Free Captures**: Say *"Record the last 5 minutes of my screen"* or *"Start recording my secondary monitor with webcam overlay"* without clicking through menus.
- **Seamless Editing Handoff**: Ask Starship Control to *"Take a 60-second screen recording and open it in Easy Edits Pro to remove pauses."*
- **Automated Demo Clips**: Have the agent automatically capture specific application windows while you walk through software tutorials.

### How Connection Works

Connecting Screen Studio Pro to Starship Control requires zero manual configuration:

1. **Automatic Discovery**: When Screen Studio Pro starts, it creates a small discovery manifest in `$XDG_DATA_HOME/starship/plugins/ssp.json`.
2. **Private Local Socket**: The app opens a secure local Unix domain socket at `$XDG_RUNTIME_DIR/starship/bridges/ssp.sock`.
3. **Verified Operating System Security**: The bridge verifies connections using Linux peer credentials (`SO_PEERCRED`). Only programs running under your exact Linux user account can talk to the recorder. No network ports are opened, and no data is sent online.
4. **Instant Detection**: Open Starship Control or press `Super+Shift+Space`. It recognizes Screen Studio Pro immediately and gives you instant voice and text control.

---

## Installation

Download the latest prebuilt packages from the [Releases page](https://github.com/zvirox/screen-studio-pro/releases).

### Debian, Ubuntu, and Pop!_OS (`.deb`)

```bash
sudo apt install ./screen-studio-pro_*_amd64.deb
```

### Fedora, RHEL, and openSUSE (`.rpm`)

```bash
sudo dnf install ./screen-studio-pro-*.x86_64.rpm
```

### Arch Linux and Manjaro (`.pkg.tar.zst`)

```bash
sudo pacman -U ./screen-studio-pro-*-x86_64.pkg.tar.zst
```

### Building From Source

Requirements: Rust stable, Node.js 22+, and development packages for PipeWire (`libpipewire-0.3-dev`), ALSA (`libasound2-dev`), and WebKitGTK (`libwebkit2gtk-4.1-dev`).

```bash
git clone https://github.com/zvirox/screen-studio-pro.git
cd screen-studio-pro
npm install
npm run tauri build
```

---

## Frequently Asked Questions

#### Does Screen Studio Pro work on both Wayland and X11?
Yes. Screen Studio Pro is designed primarily for Wayland using PipeWire and portal interfaces, but it also functions smoothly on X11 desktop environments.

#### Does Screen Studio Pro require Starship Control?
No. Screen Studio Pro is a fully standalone application. Starship Control is an optional companion that adds natural language and cross-application workflows.

#### Where are my recordings saved?
By default, recordings are saved to your user Videos folder under a dedicated `Screen Studio Pro` directory. You can customize the save location in Settings.

#### Does the app include telemetry or account requirements?
No. Screen Studio Pro requires no account, has no subscription, and includes zero background analytics or internet phone-home features.

---

## License

Screen Studio Pro is open-source software licensed under the [Apache License, Version 2.0](LICENSE).
