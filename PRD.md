# PRD — ScreenStudio Pro

**Status:** Draft v0.1 · **Owner:** zvirox · **Date:** 2026-11-01

---

## 1. Overview & Vision

ScreenStudio Pro is an open-source screen recording application for Linux, written largely in Rust, with a modern, expressive, glassmorphic UI that feels at home on today's riced desktop environments (Hyprland, niri, MangoWC, KDE Plasma Wayland).

**Vision:** OBS without the 2009 dashboard. Capture software that looks like it was made for the desktops people actually use in 2026 — translucent, animated, minimal — while the recording core beneath it is fast, native, and hardware-accelerated.

**One-line pitch:** *Record beautifully. The UI should be as good-looking as the desktop it's capturing.*

---

## 2. Problem Statement

OBS Studio is the dominant screen recorder on Linux, and it is functionally excellent — but visually alien on modern Wayland environments:

- Dense, legacy QX11-era UI with no theming or compositing that reads well against Hyprland/niri/MangoWC setups.
- The OBS model (scenes → sources → canvas) forces every user to configure a compositor to do what most people want: record my screen, my mic, my face.
- Wayland support in OBS works but is bolted on (portal integration, pipewire-capture plugins) and the experience is not discoverable or obvious.
- Modern-looking alternatives are thin on Linux: KDE Spectacle records clips but is not a creator tool; GPU Screen Recorder is minimalist but has limited composability; nothing offers an actual "Screen Studio"-caliber experience.

**The gap:** creators, distro YouTubers, and everyday users on Wayland rices have no recorder that is simultaneously (a) capable, (b) Wayland-native, and (c) genuinely modern-looking. ScreenStudio Pro aims at exactly that slice.

---

## 3. Target Users

### Primary: "The Ricer"
Runs Hyprland, niri, or MangoWC with a heavily customized setup, posts screenshots to r/unixporn, records clips for YouTube/TikTok tutorials. Cares that apps look native to their aesthetic. Will switch defaults for a better-looking tool. GPU-comfortable, Arch/Fedora/NixOS median.

### Secondary: "The Commuter"
Runs KDE Plasma or GNOME Wayland, records occasional demos, bug reports, conference talks. Wants record/pause/save with zero configuration. Will never open a scene editor.

### Tertiary: "The Streamer"
Builds on both above, currently on OBS or terminal-based GPU Screen Recorder, but streams run fully on hardware encoders with many scenes/overlays. Not the MVP's job to convert them — they arrive in V2/Later when streaming and composability land.

---

## 4. Goals & Non-Goals

### Goals
- **G1.** Shippable recording MVP: monitor / window / region capture, mic + desktop audio, hardware-encoded file output — on Wayland, through portals.
- **G2.** A UI users screenshot on its own: glass panels, springs, expressive motion — built on Tauri 2 + React as decided in stack selection.
- **G3.** Time-to-first-recording under 60 seconds from install, with zero manual portal/permission ceremony beyond the OS prompt.
- **G4.** Recording core is pure Rust: PipeWire capture, VAAPI/NVENC when available, x264 fallback.
- **G5.** Ship toward distro packaging users can install with `pacman`/`dnf`/`apt` (or AUR); later expandable to Flatpak.
- **G6.** Architecture leaves clean seams for V2 streaming (RTMP), scene compositor (dnd-kit canvas), and replay buffer.

### Non-Goals (MVP)
- **N1.** No OBS-style scene/source compositor. (V2+)
- **N2.** No RTMP/live streaming. (V2)
- **N3.** No Windows/macOS support. Linux only, Wayland-first.
- **N4.** No built-in video editor beyond a trim-crop at export.
- **N5.** No plugin/extension ecosystem, no scripting (Lua/JS).
- **N6.** No cloud accounts, telemetry-vendoring, or SaaS of any kind.
- **N7.** No claiming frame-for-frame color-grading parity with pro tools — colorists stay on OBS/ffmpeg.

### Anti-Goals (would be failure even if implemented)
- A UI that imports an OBS profile or asks users to configure scenes to record a simple clip.
- A glass overload that renders text unreadable on bright backgrounds — frosted ≠ illegible.
- Dropping frames at high resolutions on machines where hardware encoders exist.

---

## 5. Feature Set

### MVP — Must-Have (shippable bar)

| # | Feature | Notes |
|---|---------|-------|
| M1 | Monitor capture | Via xdg-desktop-portal screencast (PipeWire stream), per-monitor choice |
| M2 | Window capture | Portal user-picker or native compositor protocol where available; gracefully hidden on compositors lacking it |
| M3 | Region capture | Cropped output from monitor capture; visual selection overlay where compositor permits |
| M4 | Audio sources | Microphone + system/desktop audio via PipeWire; per-source mute and level |
| M5 | Webcam overlay (PiP) | Circular/rounded-corner frame, draggable overlay position, shutter animation — the "Screen Studio" signature |
| M6 | Floating recording toolbar/HUD | Glass toolbar: record / pause / resume / timer / flag / stop; draggable; translucent over whatever is being recorded |
| M7 | Recording controls | Pause/resume with clean segment stitching; elapsed timer |
| M8 | Hardware encoders | Auto-detect and prefer VAAPI (Intel/AMD) / NVENC (NVIDIA); x264 fallback; sane defaults (1080p, 60fps, CRB/CQP defaults) |
| M9 | File output | MKV (record-safe) + MP4/WebM export options; auto-remux MKV→MP4 on stop |
| M10 | Basic settings | Framerate (30/60), resolution/source, encoder, bitrate/quality presets, audio device pick, save directory |
| M11 | Quality presets | "For YouTube," "For Discord," "Lossless local," "Smallest file" |
| M12 | Quick-record hotkey | Via xdg-desktop-portal GlobalShortcuts where available; tray icon fallback |
| M13 | Recording indicator | if compositor exposes the Wayland screenshot/screen-recording indicator, stay consistent with it; never MIMIC system UI otherwise |
| M14 | Library/recent recordings panel | Thumbnail grid of past recordings with basic file metadata, open-in-file-manager |

### V2 — Should-Have (right after shippable)

| # | Feature | Notes |
|---|---------|-------|
| V1 | RTMP streaming | Twitch/YouTube/custom URL, stream-key flow, network-status resilience |
| V2 | Scene compositor | OBS-style but modern: scenes list, source stacking, dnd-kit canvas on glass panels, transforms |
| V3 | Replay buffer | Rolling last-N-seconds buffer with a single-key save |
| V4 | Screenshot mode | Full/window/region screenshot pipeline reusing capture stack |
| V5 | Better audio metering | Waveform visualizer with reactive UI animation |
| V6 | Auto-update of engine/backend choices | New portal‑protocol detection, encoder benchmarks |
| V7 | Multi-monitor mixed-source capture | Compose two monitors into one output — first stepping stone toward full compositor |
| V8 | Trim/crop on export | Simple in-app trim of saved recordings |

### Later — Nice-to-Have

| # | Feature |
|---|---------|
| L1 | Tauri webview "advanced panel" alternative styling/first-class hotkeys |
| L2 | Chroma-key (green screen) for webcam layer |
| L3 | Source-driven effects: spotlight/zoom-follow cursor, click/highlight effects — the true "Screen Studio" polish |
| L4 | Automatic highlight reel / instant edit-on-stop (fast, local) |
| L5 | NDI/SRT outputs, virtual camera (v4l2loopback) |
| L6 | Plugin model (community overlays/effects) |
| L7 | Optional collaborative cloud/sharing endpoints (self-hosted-first) |
| L8 | AI transcript/subtitle track burned-in on export |

---

## 6. User Stories

### Capture & recording (MVP focus)
- As a riced-Hyprland user, I want to pick my monitor or window through a modern-looking picker, so that recording feels native to my setup instead of like a foreign dashboard.
- As a creator, I want my webcam in a rounded, floating glass PiP frame, so that my recording looks like Screen Studio without buying a Mac.
- As a user, I want pause/resume in a single quiet toolbar, so that a tutorial with mistakes comes out as one clean file instead of three.
- As a commuter, I want one preset ("For Discord") and one button, so that I don't have to learn what CBR and CRF mean.
- As a user on a mixed GPU laptop, I want the app to just use my iGPU via VAAPI, so that my dGPU isn't woken up and I record at full fps silently.
- As a user, I want recordings saved as MKV and auto-remuxed to MP4, so that a crash doesn't lose the file and I still get an upload-ready output.
- As a user whose compositor doesn't support region selections, I still want region recording to work, so that the tool feels consistent across my machines.
- As a stream-minded user, I want the streaming tab clearly labeled "coming in V2," so that I trust the tool is growing in that direction instead of just not having it.

### Audio (MVP)
- As a user, I want to see which mic and which system outputs are active, chosen from PipeWire devices, so that "the right sound got recorded" is not a mystery.
- As a user who talks on stream while playing, I want per-source mute and level control, so that I don't capture my Discord call by accident.

### Library & export (MVP)
- As a user, I want a glassy media library of my recordings with thumbnails and durations, so that finding last Tuesday's clip doesn't mean opening my file manager.
- As a user, I want the exact save path shown in the "saved" toast, so that I can click through to the file immediately.

### Distribution (MVP)
- As an Arch user, I want an AUR package, so that I install with my normal tooling rather than shipping an AppImage around.
- As an rpm/deb user, I want the same recording capability without portal permission weirdness, so that the experience matches what Arch users report.

---

## 7. Key User Flows

### 7.1 First launch → first recording (must be < 60s)
1. User installs via their distro's package and launches the app.
2. Main window appears: floating glass panel, three visible sections — **Source** (monitor/window/region chips), **Audio** (mic + desktop toggles with levels), **Record** (big action button), nothing else.
3. User clicks the monitor chip; the Wayland portal fires its consent dialog once; the preview thumbnail appears in the panel.
4. Mic defaults to "system default" and shows a live level bar (audio is not even requested until it's toggled if the user enabled "ask me nothing" mode — see Open Questions).
5. User presses **Record** — toolbar HUD appears with a running timer; window minimizes to tray.
6. First "toast with effect" plays (spring-scale fade). Timer ticks.
7. User presses stop → glass "Saved" screen with thumbnail, duration, file path, and quick actions (Reveal, Open with player, Trim later).

### 7.2 Session mid-recording (HUD)
- Toolbar floats above whatever is being captured with pause/stop/flag buttons; center chip shows running timer and subtle pulsing rec dot.
- **Flag** keypress drops a chapter marker into the recording metadata (Later feature reads these; MVP just stores them in the sidecar file).
- Drag on the toolbar repositions it; double-click pins it through pause.

### 7.3 Webcam PiP add
1. Source panel shows "Add camera".
2. Camera devices present in-line (portal Camera API, or direct V4L2 where the portal path isn't reliable on a given compositor).
3. Glass PiP frame appears at default bottom-right, draggable with visual docking guides near corners.
4. Resize via pinch handles; circle vs rounded-square toggle from a popover.

### 7.4 Stop → export
1. Stop pressed → automatic MKV remux → file written with sensible filename (`screen-2026-11-01-14-05.mkv/.mp4`).
2. Library panel updates instantly with the new entry (thumbnail, duration, size).
3. User can copy path, open in player, or start recording again with the same settings — no re-configuration required.

### 7.5 Settings
1. Settings reachable via gear — visually moved aside, not hidden.
2. Groups: **Capture** (framerate, encoder, quality preset), **Audio** (devices, levels, spatial or echo-cancel toggle), **Files** (directory, naming pattern, container), **Shortcuts** (quick-record, pause, stop via GlobalShortcuts portal), **About** (version, licenses, GitHub link).
3. Quality presets described in plain language ("For YouTube — 1080p60, ~12 Mbps") rather than raw encoder jargon.

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Time-to-first-recording (install → first saved file) | < 60 seconds for 80% of fresh installs |
| Fracture/crash rate | < 0.5% of recorded sessions end in unrecoverable crash |
| A/V sync drift across a 10-min recording | < 100 ms on hardware-encoder path |
| Dropped-frame rate | < 0.5% at 1080p60 with VAAPI/NVENC on spec-reasonable hardware |
| Distro adoption (AUR votes, deb/rpm downloads, Nixpkgs merge) | AUR published at MVP; 500 tracked installs within 90 days |
| Durable retention | ≥ 40% of week-1 users still recording at week 8 |
| Community signal | GitHub ≥ 1,000 stars within 12 months; ≥ 20 third-party issue reports (healthy bug pipeline) |
| "Looks" proof points | ≥ 5 notable showcase posts (r/unixporn, Hyprland Discourse) featuring the UI |

---

## 9. Risks, Assumptions & Open Questions

### Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Portal screencast limitations vary by compositor (region picker, cursor capture, window-only capture) | Core feature behaves differently on Hyprland vs niri vs KDE | Design around monitor capture as guaranteed baseline; degrade gracefully and document per-compositor quirks |
| GlobalShortcuts portal support is uneven (KDE great, MangoWC immature) | Hotkey path varies | Tray-overlay fallback UI; expose "Runtime capabilities" panel so behavior is transparent |
| Hardware encoder availability/quality varies wildly (older AMD VAAPI, NVIDIA on non-standard kernels) | Recording quality/perf complaints | Bulletproof x264 fallback with clear UI note when falling back; nightly benchmark on first run |
| Tauri webview perf for live audio meters/preview | Janky-feeling UI on low-end machines | Push all bit-heavy work (previews, meters data) to Rust with lightweight event handoff; never render video frames in the webview |
| MKV→MP4 remux edge cases (variable framerate from compositor) | Broken exports | Extended/conservative encoder defaults; validation pass before final write |
| Solo/small team scope creep (23 feature ideas already above) | MVP doesn't ship | Ruthless MVP cut; feature gates live in the layer doc, not in code |

### Assumptions
- Target riced compositors (Hyprland, niri, MangoWC, KDE Plasma) all support xdg-desktop-portal screencast with monitor and window capture; region-crop fallback via software crop is acceptable UX for MVP.
- PipeWire is present and/or distro-default on every target (safe as of 2026); no JACK/PulseAudio legacy support needed for MVP.
- Users accept a portal permission prompt on first capture — we do not chase "zero prompts" via hacky protocols.
- Rust-only capture core is feasible via existing crates (pipewire, portals4.*, VA-API/NVENC via encoder crates/bindings); where crates are immature, thin C-FFI shims are acceptable engineering detail.
- App is fully open source (GPL-compatible host docs in README/LICENSE) and community-driven; no monetization pressure on milestones.

### Open Questions
1. **Camera plumbing:** Portal `Camera` vs direct V4L2 — which do Hyprland/niri/MangoWC portals reliably expose in 2026, or do we open a dialog to both paths based on runtime detection?
2. **Flag/chapter markers:** Store in MKV chapters (spec-friendly) or sidecar JSON (tool-friendly)? Need one decision before encoder pipeline is frozen.
3. **GlobalShortcuts fallback matrix:** What is the documented behavior set on MangoWC (youngest of the four) before we promise the hotkey in release notes?
4. **Distro packaging owners:** Self-maintaining AUR/deb/rpm vs. first-contributor handover — which do we staff for MVP release week?
5. **Naming conflict check:** "ScreenStudio" names a commercial macOS product — do we rename or rebrand to avoid trademark/legal friction before marketing on it?
6. **License choice for ecosystem effects:** If community overlays/effects arrive in Later, do we lock LGPL/GPL boundaries at architecture time?

---

## 10. Next Documents

1. **Technical Design Doc** — capture core architecture, PipeWire framing, encoder abstraction, Tauri command/event surface, UI↔Rust IPC contract.
2. **UI/UX Doc with Visual Companion mockups** — glass design language, motion spec, component inventory.
3. **Milestone/Release Plan** — MVP cut as issues, then V2 freeze criteria.
