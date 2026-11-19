# DESIGN.md — ScreenStudio Pro Design System

**Version:** 3.0 · **Authority:** PRD.md (product scope) → PRODUCT.md (brand feel) → **this file (visual law)**  
**Rule:** Every UI built later must follow this file strictly. Do not invent new colors or fonts outside it. To change a token, change it here first.

**v3.0 Changelog (2026-11-18) — "Wide-Window Floating Studio Overhaul":**  
Inspired by modern studio workstations (Camo Studio, Meld Studio, PRISM Live Studio), v3.0 replaces the narrow vertical two-column layout and the square (1:1) preview frame with a **wide-window, tri-panel floating island architecture**. The centerpiece is a cinematic **hero 16:9 widescreen canvas** flanked by symmetrical, perfectly aligned floating glass decks (Left: Capture & Device Inspector; Center-Bottom: Audio Mixer Deck; Right: Takes & Presets Gallery). Corner radii evolve to a refined hardware scale (`r.md=12px`, `r.lg=16px`, `r.xl=20px`), neutral grounds deepen to Obsidian Slate, and top chrome unifies into an integrated CSD titlebar with floating pill action clusters (`Record`, `1080p60` telemetry).

---

## 1. Brand Feel & Design Principles

**Feel:** Precision-engineered, frosted, wide-canvas studio software. Floating glass islands that hover gracefully over dark obsidian grounds. Calm and focused while idle; electrifying and unmistakable the moment **Record** is activated. The interface feels like high-end broadcast hardware redesigned by Apple and crafted for modern Wayland desktops (Hyprland, niri, MangoWC, KDE Plasma).

### Principle 1 — Symmetrical Floating Islands
Surfaces do not cling edge-to-edge like legacy dashboards. Every major section is a **floating glass island** (`surface.glass-strong` with 16px corner radius, 1px specular glass border, and ambient drop shadow). The central 16:9 canvas and its flanking inspector and gallery panels share disciplined vertical heights and breathing margins (`space.4` / 16px).

### Principle 2 — The Hero 16:9 Canvas is King
A screen recorder captures widescreen displays. The canvas is **always 16:9 widescreen native**, floating prominently in the center of the viewport with gentle rounded corners (`r.lg` = 16px) and a subtle 1px border. Letterboxing and square 1:1 frames are prohibited. Overlays (camera PiP, region crop) live directly on this canvas.

### Principle 3 — Studio-Grade Controls & Honest Telemetry
Controls are tactile, segmented pills, precision sliders, and studio faders. Audio is treated as a first-class visual element with live dual-channel peak/RMS meter bars and active DSP status badges (`RNNoise`, `Ducking`). Telemetry (resolution, framerate, encoder backend) is permanently visible in a top-bar pill badge.

### Principle 4 — One Accent, One Signal
- **Studio Burgundy (`accent`):** Denotes selection, active tabs, slider fills, and primary interaction.
- **Broadcast Signal Red (`signal`):** Reserved **strictly and exclusively** for the live recording state (HUD pulsing dot, record pill glow, recording borders). Never used for decoration or static UI elements.

---

## 2. Color System

### 2.1 Dark Mode (Default)
Dark mode is the primary studio environment. Neutrals use deep Obsidian Slate tones to maximize video contrast and eliminate desktop glare.

| Token | Hex / Value | Role |
|---|---|---|
| `bg.canvas` | `#0A0B0E` | Deep Obsidian background under all floating islands |
| `bg.raised` | `#12141A` | Opaque base layer for forms, settings, and tables |
| `surface.glass` | `rgba(255, 255, 255, 0.045)` | Subtle glass fill (inner cards, secondary containers) |
| `surface.glass-strong` | `rgba(18, 20, 26, 0.82)` | Primary floating island deck (Left Inspector, Right Gallery, HUD) |
| `surface.solid` | `#181A22` | Cards, channel strips, and tiles resting inside decks |
| `surface.hover` | `rgba(255, 255, 255, 0.06)` | Hover state for interactive cards and rows |
| `border.subtle` | `rgba(255, 255, 255, 0.08)` | Dividers, inactive card strokes |
| `border.glass` | `rgba(255, 255, 255, 0.14)` | Specular 1px outer stroke on floating islands and canvas |
| `border.focus` | `#A3284E` | 2px focus ring on active controls |
| `text.primary` | `#F4F5F8` | High-contrast headings and active labels (17.5:1 on canvas) |
| `text.secondary` | `rgba(244, 245, 248, 0.65)` | Subtext, property descriptions, inactive tab labels |
| `text.disabled` | `rgba(244, 245, 248, 0.32)` | Disabled controls, inactive placeholders |
| `accent` | `#A3284E` | Studio Burgundy (primary selection, active pills, sliders) |
| `accent.hover` | `#BA335D` | Hover state on interactive accent elements |
| `accent.active` | `#8C1E40` | Pressed / active state |
| `accent.text` | `#FFFFFF` | Text rendered on accent grounds (9.04:1) |
| `accent.muted` | `rgba(163, 40, 78, 0.15)` | Washes behind active chips and segmented controls |
| `signal` | `#E53935` | Broadcast Signal Red (Recording live indicator only) |
| `signal.muted` | `rgba(229, 57, 53, 0.16)` | Background wash behind recording timer and HUD badge |
| `success` | `#2ECC71` | Validated states, good signal levels (>-18 dBFS) |
| `warning` | `#F39C12` | Compression zone (-6 dBFS to 0 dBFS), CPU warning |
| `error` | `#E74C3C` | Fatal errors, clipping indicator (>0 dBFS) |

### 2.2 Light Mode (Secondary Face)

| Token | Hex / Value | Role |
|---|---|---|
| `bg.canvas` | `#F4F5F8` | Crisp studio grey-white background |
| `bg.raised` | `#FFFFFF` | Pure white opaque deck base |
| `surface.glass` | `rgba(255, 255, 255, 0.70)` | Frosted light glass fill |
| `surface.glass-strong` | `rgba(255, 255, 255, 0.88)` | Primary floating islands in light mode |
| `surface.solid` | `#EAECEF` | Cards and channel strips |
| `border.subtle` | `rgba(18, 20, 26, 0.08)` | Dividers and inactive borders |
| `border.glass` | `rgba(18, 20, 26, 0.12)` | Specular 1px outer stroke |
| `text.primary` | `#12141A` | Dark graphite headings (17.2:1 on canvas) |
| `text.secondary` | `rgba(18, 20, 26, 0.65)` | Secondary labels and metadata |
| `text.disabled` | `rgba(18, 20, 26, 0.35)` | Disabled text |
| `accent` | `#8B1E3F` | Deep studio burgundy (8.16:1 on canvas) |
| `accent.hover` | `#751834` | Hover state |
| `accent.text` | `#FFFFFF` | Text on accent buttons (9.12:1) |
| `accent.muted` | `rgba(139, 30, 63, 0.12)` | Active tab/chip wash |
| `signal` | `#D32F2F` | Live recording indicator |

---

## 3. Typography

| Face | Delivery | Role |
|---|---|---|
| **Familjen Grotesk** (variable, 400–700) | Self-hosted `.woff2` | Headings, UI labels, buttons, navigation |
| **JetBrains Mono** (variable, 400–600) | Self-hosted `.woff2` | Timers, dB levels, resolutions, bitrates, hotkeys |

### Scale Hierarchy

| Token | Size | Line Height | Weight | Application |
|---|---|---|---|---|
| `display.lg` | 1.75rem (28px) | 1.15 | 700 | Primary modal and view titles |
| `display.md` | 1.375rem (22px) | 1.2 | 700 | Panel and section titles |
| `heading` | 1.125rem (18px) | 1.35 | 600 | Inspector section headers, drawer titles |
| `body-md` | 0.9375rem (15px) | 1.5 | 400 | General descriptions, setting descriptions |
| `body-sm` | 0.8125rem (13px) | 1.45 | 400 / 500 | Control labels, device names, card titles |
| `label` | 0.75rem (12px) | 1.3 | 600 | Overline headers ("SOURCES", "AUDIO MIXER", "TAKES") |
| `mono-md` | 0.9375rem (15px) | 1.2 | 500 | Tabular recording timer, live duration |
| `mono-sm` | 0.8125rem (13px) | 1.3 | 400 | File sizes, hotkey badges (`⌘1`, `F1`), fps counters |

---

## 4. Radii, Shadows & Glass Recipes

### 4.1 Hardware-Grade Radius Scale

| Token | Value | Applied To |
|---|---|---|
| `r.none` | 0px | Flat flush dividers |
| `r.xs` | 4px | Small indicator chips, hotkey tags |
| `r.sm` | 8px | Dropdowns, inner buttons, slider thumbs, badge pills |
| `r.md` | 12px | Channel cards, settings cards, preset cards, popovers |
| `r.lg` | 16px | **Floating studio islands**, **Hero 16:9 canvas**, drawers |
| `r.xl` | 20px | App window corners, HUD floating bar |
| `r.full` | 999px | Record CTA pill, segmented switch capsules, circle PiP |

### 4.2 Elevation & Atmospheric Shadows

| Token | Dark Recipe | Purpose |
|---|---|---|
| `elev.1` | `0 2px 6px rgba(0,0,0,0.30), 0 8px 24px rgba(0,0,0,0.22)` | Inner cards, channel strips |
| `elev.2` | `0 4px 12px rgba(0,0,0,0.40), 0 16px 40px rgba(0,0,0,0.35)` | Floating decks, popovers, drawers |
| `elev.float` | `0 8px 32px -4px rgba(0,0,0,0.55), 0 24px 64px -8px rgba(0,0,0,0.45)` | Hero Canvas, floating HUD, PiP frame |

### 4.3 Studio Glass Recipes

| Recipe | Fill | Blur | Border | Shadow |
|---|---|---|---|---|
| **Studio Deck** | `surface.glass-strong` | `blur(24px) saturate(180%)` | `border.glass` 1px | `elev.2` |
| **Hero Canvas** | `#000000` (video frame) | — | `border.glass` 1px | `elev.float` |
| **Floating HUD**| `surface.glass-strong` | `blur(28px) saturate(200%)` | `border.glass` 1px | `elev.float` |
| **Modal Glass** | `surface.glass-strong` | `blur(32px)` | `border.subtle` 1px | `elev.2` |

---

## 5. Component Inventory

### 5.1 Integrated Studio Titlebar (NavBar CSD)
- **Dimensions:** Height 52px, full window width.
- **Left Group:** Window controls (traffic lights on macOS / custom dots on Wayland) + App Logo + "ScreenStudio Pro" (`body-sm` 600).
- **Center Group:** Sleek segmented view capsule:
  - `Record` | `Library` | `Settings`
  - Active tab: Smooth sliding `accent.muted` wash + `text.primary` font weight 600.
- **Right Action Cluster:**
  - **Telemetry Pill:** `mono-sm` badge (`1080p60` · `VAAPI` / `x264`).
  - **Stream (V2) Pill:** Disabled ghost pill with "V2" badge.
  - **Record Pill CTA:** 40px height, `r.full` pill button.
    - Idle state: Studio Burgundy fill, video camera icon, "Record" label.
    - Recording live: Broadcast Signal Red pulsing dot, tabular timer, "Stop" on hover.

### 5.2 Left Floating Inspector (Capture & Device Deck)
- **Width:** 300px fixed width, floating inside workspace (`r.lg` = 16px, Studio Deck recipe).
- **Segmented Source Switcher:**
  - Full-width 3-way toggle: `Monitor` | `Window` | `Region`.
- **Target Source Card:**
  - Dropdown showing selected monitor/window with display resolution badge (`1920×1080 @ 60Hz`).
- **Camera PiP Card:**
  - Camera device selector dropdown.
  - Shape toggle: Segmented icons for Circle (`r.full`) vs Rounded Rectangle (`r.md`).
  - Position grid: 4-corner snap selector (Top-Left, Top-Right, Bottom-Left, Bottom-Right).
  - Size slider: 160px to 320px with live percentage readout.
  - Self-Insert Toggle switch (controls whether webcam is composited into final recording).
- **Quality Preset Card:**
  - Plain-language dropdown: *"For YouTube — 1080p60 (~12 Mbps)"*, *"For Discord — 720p30 (~6 Mbps)"*, *"Lossless Native"*.

### 5.3 Center Hero Canvas (The Star of the Studio)
- **Aspect Ratio:** Strictly **16:9 widescreen**.
- **Geometry:** Dominates center viewport, responsive scaling with `r.lg` (16px) corners and 1px specular border (`border.glass`).
- **Content:** Live PipeWire video frame with GPU zero-copy preview.
- **Overlays:**
  - Camera PiP frame rendered directly in position with corner docking guides.
  - Region Crop overlay: Smooth drag-rect handles when Region mode is active.
- **Sub-Canvas Floating Audio Mixer Deck (Meld Studio Style):**
  - Horizontally aligned glass deck directly below the 16:9 canvas.
  - Two dedicated vertical channel cards:
    - **Microphone Channel Card:**
      - Title & device dropdown.
      - DSP active badges: `[AI Noise Isolation]` (RNNoise), `[Gate]`.
      - Dual stereo vertical/horizontal peak/RMS meter bars (-60 dB to 0 dB with -6 dB compression zone).
      - Volume slider fader.
      - High-contrast Mute button.
    - **Desktop Audio Channel Card:**
      - Title & output sink monitor name.
      - DSP active badge: `[Auto-Ducking]`.
      - Live system audio peak meter bars.
      - Volume slider fader + Mute button.

### 5.4 Right Takes & Presets Gallery (Camo Studio Style)
- **Width:** 260px fixed width, floating inside workspace (`r.lg` = 16px, Studio Deck recipe).
- **Header:** "Recent Takes" dropdown / toggle to "Presets".
- **Takes Gallery Stack:**
  - Vertical list of recent recordings.
  - 16:9 thumbnail preview card with duration chip (`02:14`) and size badge (`48 MB`).
  - Active hover reveals quick-action bar: `Play`, `Reveal in File Manager`, `Copy Path`.
- **Presets View (When toggled):**
  - Scene/Preset cards with hotkey badges (`F1`, `F2`, `F3`).
  - Clicking a preset instantly applies source, resolution, PiP position, and audio profiles.
- **Responsive Behavior:** On viewports <1120px wide, the right panel collapses into an expandable slide-out drawer or top-bar icon.

---

## 6. Workspace Layout Anatomy

### Wide Desktop Layout (>1200px)

```
+-----------------------------------------------------------------------------------------------------------------------+
|  (o)(o)(o)  [SSP Mark] ScreenStudio Pro      [  Record  |  Library  |  Settings  ]      [1080p60 VAAPI]  [● Record]  |
+-----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                       |
|  +--------------------+   +-------------------------------------------------------------+   +----------------------+  |
|  | CAPTURE INSPECTOR  |   |                     HERO 16:9 CANVAS                        |   | RECENT TAKES         |  |
|  |                    |   |                                                             |   |                      |  |
|  | [Mon | Win | Reg]  |   |                                                             |   | +------------------+ |  |
|  |                    |   |                                                             |   | | [16:9 Thumbnail] | |  |
|  | Display 1 (1080p)  |   |                                                             |   | | 01:45 · 1080p60  | |  |
|  | [DP-1          v]  |   |                                            +--------------+ |   | +------------------+ |  |
|  |                    |   |                                            | Camera PiP   | |   |                      |  |
|  | CAMERA PiP         |   |                                            | (Draggable)  | |   | +------------------+ |  |
|  | [Facecam HD    v]  |   |                                            +--------------+ |   | | [16:9 Thumbnail] | |  |
|  | Shape: (o) [ ]     |   +-------------------------------------------------------------+   | | 08:20 · 1080p60  | |  |
|  | Corner: [::]       |                                                                     | +------------------+ |  |
|  | Size: [===|----]   |   +-------------------------------------------------------------+   |                      |  |
|  |                    |   | AUDIO MIXER DECK                                            |   | +------------------+ |  |
|  | QUALITY PRESET     |   |                                                             |   | | [16:9 Thumbnail] | |  |
|  | [YouTube 1080p v]  |   |  MIC [USB Mic v]           DESKTOP [System Audio v]         |   | | 00:32 · 1080p60  | |  |
|  |                    |   |  [AI Noise] [Gate]         [Auto-Ducking]                   |   | +------------------+ |  |
|  | ENCODER            |   |  [====||||||-------] -12   [======||||||||----] -6          |   |                      |  |
|  | VAAPI (Hardware)   |   |  ( Mute )  [==|------]     ( Mute )  [====|----]            |   | [Open Library ...]   |  |
|  +--------------------+   +-------------------------------------------------------------+   +----------------------+  |
|                                                                                                                       |
+-----------------------------------------------------------------------------------------------------------------------+
```

---

## 7. Accessibility & Ergonomics Law

1. **Text Contrast Floor:** All text tokens maintain ≥ 4.5:1 relative contrast against their composited glass backgrounds; large text and headings maintain ≥ 7:1.
2. **Keyboard Reachability:**
   - Full roving arrow-key navigation on the top segmented bar (`Left`/`Right`).
   - Source selector switches with `1` (Monitor), `2` (Window), `3` (Region).
   - Hotkey `Space` or `Ctrl+R` triggers Start/Stop recording.
   - Hotkey `Ctrl+P` pauses and resumes.
3. **Reduced Motion:** If `prefers-reduced-motion` is active:
   - Rec-dot pulse turns to static bold signal red.
   - Glass island slide transitions step down to instant opacity fades (<90ms).
4. **Hit Target Sizes:** Every interactive button, pill, and switch satisfies $\ge 36\text{px}$ minimum clickable area; primary CTA Record pill is $\ge 40\text{px}$.
