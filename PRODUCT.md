# PRODUCT.md — ScreenStudio Pro

> Derived from PRD.md (v0.1, 2026-11-01), which remains the source of truth for scope. This file pins visual authority and product context for design work.

## Product
An open-source screen recording app for Linux (Wayland-first), written in Rust (Tauri 2 core) with a React frontend. OBS-capable capture quality with a modern "Screen Studio"-caliber interface. MVP = recording: monitor/window/region capture, mic + desktop audio, webcam PiP, floating HUD, hardware encoders, library of recent recordings. Streaming and scene compositor arrive in V2.

## Audience & scene
Primary: the Ricer — Hyprland/niri/MangoWC/custom-KDE user who posts screenshots to r/unixporn, records tutorials, and switches defaults for a better-looking tool. Uses dark-themed, minimal, translucent desktop environments on a modern GPU. Secondary: the Commuter on stock KDE/GNOME who records occasionally and wants one button. Mode of the app surface: **Operate** — task-first, glass as precision material, not decoration.

## Brand feel (pinned)
Frosted, floating, quiet-software. The UI should appear **of** the user's riced desktop — translucent panels that pick up the wallpaper, crisp type, springy-but-restrained motion. Calm by default, expressive the moment **Record** is engaged. The aesthetic the user must not notice is also banned: opaque gray "OBS dashboard" gravity.

## Success for a designed surface
A Hyprland user screenshots the app itself and posts it. A Commuter records their first clip in under 60 seconds without discovering a single extra control. Both read every label with zero ambiguity despite translucency (contrast is protected by token rules, not by hope).

## Constraints
- Tauri 2 webview + React 19 + Tailwind v4; all video frames and stats rendered by Rust, handed to the webview as state — the webview never paints a video region.
- shadcn/ui as the component base, restyled to this system; lucide-react icons; framer-motion for motion.
- Every UI built later must follow DESIGN.md strictly; no new colors or fonts outside it.
- App is a first-class Linux desktop citizen:GTK-free, portal-aware, tray-capable, compact window sizes must work.
