# DESIGN.md — ScreenStudio Pro Design System

**Version:** 4.0 · **Date:** 2026-11-24 · **Authority:** PRD.md (product scope) → PRODUCT.md (brand feel) → **this file (visual law)**  
**Rule:** Every UI built later must follow this file strictly. Do not invent new colors or fonts outside it. To change a token, change it here first.

**v4.0 Changelog (2026-11-24) — "Linear Precision Studio":**
Migrates from frosted glass islands to the Linear-Style Design System (Dark & Light). Replaces all `backdrop-filter: blur()` and semi-transparent fills with 100% opaque solid matte graphite (`#121215`, `#17171c`) and alabaster (`#ffffff`, `#f2f2f4`) surfaces. Retains the wide tri-panel architecture, hero 16:9 canvas, and Studio Burgundy / Broadcast Signal Red identity while introducing 1px hairline precision borders and Linear dual-shadow bevel illumination. Motion standardizes strictly to `motion/react` with mechanical easing (`cubic-bezier(0.16, 1, 0.3, 1)`).

**v3.2 Changelog (2026-11-23) — "Quiet Studio Instrument":**
Keeps the wide tri-panel architecture, Obsidian/Burgundy identity, and Familjen Grotesk/JetBrains Mono pairing from v3.1, but moves richness out of the chrome and into the product's own moments. Overline labels are sentence case; surfaces are quiet neutral steps with hairlines instead of specular glass glow; Burgundy is reserved for the primary Record action and true selection; signal red remains live-only. The mono timecode readout with one live signal dot is the product's signature and appears only where capture state is real. Motion uses one restrained easing curve.

---

## 1. Brand Feel & Design Principles

**Feel:** A precise, instrument-like studio controller for Wayland desktops. Solid matte surfaces, micro-hairlines, inset edge lighting, zero-glass blur, and high-contrast telemetry. Calm and focused while idle, unmistakably alive when **Record** is armed. Built for Hyprland, niri, MangoWC, and KDE Plasma.

### Principle 1 — Solid Precision Islands
Surfaces do not cling edge-to-edge like legacy dashboards. Major sections are **floating solid matte islands** (`#121215` in Dark, `#ffffff` in Light with 16px corner radius, a crisp 1px hairline `#23232a`, and dual-shadow bevel illumination `shadow-linear-dark`). No `backdrop-filter: blur()`. The central 16:9 canvas and its flanking inspector and gallery panels share disciplined vertical heights and breathing margins (`space.4` / 16px). Depth comes from physical elevation and top edge inset lighting, never glass glow.

### Principle 2 — The Hero 16:9 Canvas is King
A screen recorder captures widescreen displays. The canvas is **always 16:9 widescreen native**, floating prominently in the center of the viewport with gentle rounded corners (`r.lg` = 16px) and a subtle 1px border. Letterboxing and square 1:1 frames are prohibited. Overlays (camera PiP, region crop) live directly on this canvas.

### Principle 3 — Studio-Grade Controls & Honest Telemetry
Controls are tactile, segmented switches, precision sliders, and studio faders. Audio is treated as a first-class visual element with live dual-channel peak/RMS meter bars; DSP state is quiet mono text, not a colored badge. Telemetry (resolution, framerate, encoder backend) is permanently visible in calm mono type.

### Principle 4 — One Accent, One Signal
- **Studio Burgundy (`accent`):** Reserved for the primary Record action, true selected/live state, focus rings, and meaningful meter fill. It does not decorate secondary tabs, sort labels, badges, icons, or hover states.
- **Broadcast Signal Red (`signal`):** Reserved **strictly and exclusively** for the live recording state (HUD dot, record timer, recording border). Never used for decoration or static UI elements.
- **Signature — mono timecode:** A `JetBrains Mono`, tabular-nums readout paired with one signal dot wherever capture state is real. It appears in the HUD and the live preview readout, and nowhere as decoration.

---

## 2. Color System

### 2.1 Dark Mode (Default)
Dark mode is the primary studio environment. Neutrals use deep Obsidian Slate tones to maximize video contrast and eliminate desktop glare.

| Token | Hex / Value | Role |
|---|---|---|
| `bg.canvas` | `#08080a` | Deep Obsidian background under all floating islands |
| `surface.1` | `#121215` | Solid elevated primary deck (Left Inspector, Right Gallery, HUD) |
| `surface.2` | `#17171c` | Solid nested containers, channel strips, inputs |
| `surface.3` | `#202026` | Hover and active interactive states |
| `border.subtle` | `#23232a` | 1px hairline boundary on floating islands, cards, and canvas |
| `border.active` | `#33333d` | Active input or hovered card boundary |
| `border.focus` | `#C77493` | 2px focus ring on active controls |
| `text.primary` | `#F4F5F8` | High-contrast headings and active labels (17.5:1 on canvas) |
| `text.secondary` | `#a1a1aa` | Subtext, property descriptions, inactive tab labels |
| `text.on-canvas` | `#F4F5F8` | Fixed light copy on the black preview canvas, both themes |
| `text.disabled` | `#71717a` | Disabled controls, inactive placeholders |
| `accent` | `#A3284E` | Studio Burgundy (primary Record action, true selection, meter fill) |
| `accent.hover` | `#BA335D` | Hover state on interactive accent elements |
| `accent.active` | `#8C1E40` | Pressed / active state |
| `accent.text` | `#FFFFFF` | Text rendered on accent grounds (9.04:1) |
| `accent.muted` | `rgba(163, 40, 78, 0.15)` | Reserved for selected-state wash, never general hover |
| `signal` | `#C92A2A` | Broadcast Signal Red (Recording live indicator only; white CTA text ≥4.5:1) |
| `signal.muted` | `rgba(201, 42, 42, 0.16)` | Background wash behind recording timer and HUD badge |
| `success` | `#2ECC71` | Validated states, good signal levels (>-18 dBFS) |
| `warning` | `#F39C12` | Compression zone (-6 dBFS to 0 dBFS), CPU warning |
| `error` | `#E74C3C` | Fatal errors, clipping indicator (>0 dBFS) |

### 2.2 Light Mode (Secondary Face)

| Token | Hex / Value | Role |
|---|---|---|
| `bg.canvas` | `#f7f7f8` | Crisp studio paper/grey-white background |
| `surface.1` | `#ffffff` | Pure white solid elevated deck base |
| `surface.2` | `#f2f2f4` | Nested containers and channel strips |
| `surface.3` | `#e8e8ec` | Interactive hover states |
| `border.subtle` | `#e2e2e7` | 1px precision light card delimiter |
| `border.active` | `#c8c8d0` | Focused input border, active toggle ring |
| `text.primary` | `#09090b` | Dark graphite headings (17.2:1 on canvas) |
| `text.secondary` | `#52525b` | Secondary labels and metadata |
| `text.on-canvas` | `#F4F5F8` | Fixed light copy on the black preview canvas (does not swap in light mode) |
| `text.disabled` | `#8e8e93` | Disabled text |
| `accent` | `#8B1E3F` | Deep studio burgundy (primary Record action, true selection) |
| `accent.hover` | `#751834` | Hover state |
| `accent.text` | `#FFFFFF` | Text on accent buttons (9.12:1) |
| `accent.muted` | `rgba(139, 30, 63, 0.12)` | Selected-state wash only |
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
| `display.lg` | 1.75rem (28px) | 1.15 | 600 | Primary modal and view titles |
| `display.md` | 1.375rem (22px) | 1.2 | 600 | Panel and section titles |
| `heading` | 1.125rem (18px) | 1.35 | 500 | Inspector section headers, drawer titles |
| `body-md` | 0.9375rem (15px) | 1.5 | 400 | General descriptions, setting descriptions |
| `body-sm` | 0.875rem (14px) | 1.45 | 400 / 500 | Control labels, device names, card titles; never shrink to fit |
| `label` | 0.75rem (12px) | 1.3 | 500 | Sentence-case overline labels ("Sources", "Audio mixer", "Takes") — never uppercase or tracked |
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
| `elev.1` | `0 1px 2px rgba(0,0,0,0.20)` | Inner cards, channel strips |
| `elev.2` | `0 2px 8px rgba(0,0,0,0.24)` | Floating decks, popovers, drawers |
| `elev.float` | `0 6px 20px -6px rgba(0,0,0,0.32)` | Hero Canvas, floating HUD, PiP frame |

### 4.3 Studio Glass Recipes

| Recipe | Fill | Blur | Border | Shadow |
|---|---|---|---|---|
| **Studio Deck** | `surface.glass-strong` | `blur(12px) saturate(110%)` | `border.subtle` 1px | `elev.1` |
| **Hero Canvas** | `#000000` (video frame) | — | `border.subtle` 1px | `elev.1` |
| **Floating HUD**| `surface.glass-strong` | `blur(16px) saturate(120%)` | `border.subtle` 1px | `elev.2` |
| **Modal Glass** | `surface.glass-strong` | `blur(20px)` | `border.subtle` 1px | `elev.2` |

---

## 5. Component Inventory

### 5.1 Integrated Studio Titlebar (NavBar CSD)
- **Dimensions:** Height 52px, full window width.
- **Left Group:** Window controls (traffic lights on macOS / custom dots on Wayland) + App Logo + "ScreenStudio Pro" (`body-sm` 600).
- **Center Group:** Sleek segmented view capsule:
  - `Record` | `Library` | `Settings`
  - Active tab: quiet `surface.hover` step + 1px hairline, `text.primary`; no accent wash.
  - Live signal dot: one mono-timecode readout beside the Record CTA when recording.- **Right Action Cluster:**
  - **Telemetry Pill:** `mono-sm` badge (`1080p60` · `VAAPI` / `x264`).
  - **Stream (V2) Pill:** Disabled ghost pill with "V2" badge.
  - **Record Pill CTA:** Minimum 40px height, `r.full` pill button.  - Compact header law: auxiliary telemetry hides below 1280px; navigation icons are 16px and labels use `body-sm`; no window control, tab icon, or action label may overlap.
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
- **Geometry:** Dominates center viewport, responsive scaling with `r.lg` (16px) corners and a quiet 1px hairline (`border.subtle`).
- **Content:** Live PipeWire video frame with GPU zero-copy preview.
- **Overlays:**
  - Camera PiP frame rendered directly in position with corner docking guides.
  - Region Crop overlay: Smooth drag-rect handles when Region mode is active.
- **Sub-Canvas Floating Audio Mixer Deck (Meld Studio Style):**
  - Horizontally aligned floating deck directly below the 16:9 canvas.
  - Two dedicated vertical channel cards:
    - **Microphone Channel Card:**
      - Title & device dropdown.
      - DSP state as quiet mono text: `RNNoise`, `Gate`.
      - Dual stereo peak/RMS meter bars (-60 dB to 0 dB with -6 dB compression zone); accent fill below -6 dB, signal red above.
      - Volume slider fader.
      - High-contrast Mute button.
    - **Desktop Audio Channel Card:**
      - Title & output sink monitor name.
      - Desktop audio state as quiet mono text: `Auto-Ducking`.
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
- **Responsive Behavior:** On viewports <1120px wide, the right panel collapses into an expandable gallery. At 720–1119px, the inspector and hero/mixer remain in a 280px + fluid two-column workspace and the expanded gallery spans both columns; below 720px, all panels stack in DOM reading order. No breakpoint creates horizontal page overflow.

---

## 6. Workspace Layout Anatomy

### Wide Desktop Layout (>1200px)

```
+-----------------------------------------------------------------------------------------------------------------------+
|  (o)(o)(o)  [SSP Mark] ScreenStudio Pro      [  Record  |  Library  |  Settings  ]      [1080p60 VAAPI]  [● Record]  |
+-----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                       |
|  +--------------------+   +-------------------------------------------------------------+   +----------------------+  |
|  | Capture inspector  |   |                     Hero 16:9 canvas                        |   | Recent takes         |  |
|  |                    |   |                                                             |   |                      |  |
|  | [Mon | Win | Reg]  |   |                                                             |   | +------------------+ |  |
|  |                    |   |                                                             |   | | [16:9 Thumbnail] | |  |
|  | Display 1 (1080p)  |   |                                                             |   | | 01:45 · 1080p60  | |  |
|  | [DP-1          v]  |   |                                            +--------------+ |   | +------------------+ |  |
|  |                    |   |                                            | Camera PiP   | |   |                      |  |
|  | Camera PiP         |   |                                            | (Draggable)  | |   | +------------------+ |  |
|  | [Facecam HD    v]  |   |                                            +--------------+ |   | | [16:9 Thumbnail] | |  |
|  | Shape: (o) [ ]     |   +-------------------------------------------------------------+   | | 08:20 · 1080p60  | |  |
|  | Corner: [::]       |                                                                     | +------------------+ |  |
|  | Size: [===|----]   |   +-------------------------------------------------------------+   |                      |  |
|  |                    |   | Audio mixer deck                                            |   | +------------------+ |  |
|  | Quality preset     |   |                                                             |   | | [16:9 Thumbnail] | |  |
|  | [YouTube 1080p v]  |   |  MIC [USB Mic v]           DESKTOP [System Audio v]         |   | | 00:32 · 1080p60  | |  |
|  |                    |   |  [AI Noise] [Gate]         [Auto-Ducking]                   |   | +------------------+ |  |
|  | Encoder            |   |  [====||||||-------] -12   [======||||||||----] -6          |   |                      |  |
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
5. **Motion Law:** One easing curve (`cubic-bezier(0.22, 1, 0.36, 1)`) governs all transitions. Only color, background, border, opacity, and transform may animate. No looping motion on non-live elements, no bounce, and no animated layout properties.
