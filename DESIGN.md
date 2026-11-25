# DESIGN.md — ScreenStudio Pro Design System

**Version:** 5.0 · **Date:** 2026-11-25 · **Status:** **FINAL & LOCKED**  
**Authority:** PRD.md (product scope) → PRODUCT.md (brand feel) → **this file (visual law)**  
**Lock Rule:** The **Unified Linear-Style Design System** is finalized and permanently locked. No UI style redesigns or alternate themes (frosted glass, translucency, pill buttons, dark-mode shadows, or macOS traffic lights) are permitted. Automated enforcement runs on every check via `npm run check:linear` (`scripts/check-linear.mjs`).

---

## 1. Brand Feel & Core Visual Law

**Feel:** High-density, crisp, flat-matte Linux desktop engineering studio inspired by Linear. Built for clarity, low cognitive overhead, and effortless contrast across **Dark** (default) and **Light** modes (`html[data-theme="dark|light"]`, persisted under `localStorage["ui-theme"]` and applied before first paint in `index.html`).

### Non-Negotiable Principles
1. **Solid Flat Opaque Surfaces Only:** All chrome, decks, cards, drawers, modals, popovers, and HUDs use solid hex surface tokens separated by `1px` structural borders (`--border`, `--border-strong`). `backdrop-filter: blur(...)`, `rgba()`/`hsla()`, Tailwind `/opacity` modifiers on surfaces/text/borders, glow effects, and box-shadows in dark mode are forbidden.
2. **Dark Default, Light Parity:**
   - Dark mode: **zero** shadows on cards, buttons, popovers, or drawers (`--ssp-shadow-card: none`). Focus rings use crisp `outline: 2px solid var(--accent-blue)`.
   - Light mode: subtle hairline card elevation **only** (`--ssp-shadow-card: 0 1px 2px rgb(16 24 40 / 5%)`).
3. **Hero 16:9 Canvas:** Screen preview uses a native 16:9 container on `--hero-canvas-bg` (`--bg-app` dark `#050505` / crisp `#111213` light frame) with `1px` `--border`, `8px` corners, zero blur, and zero shadow. Overlays (webcam PiP, region drag-rect) render directly inside this frame.
4. **Minimal Structural Rounding & Zero Pills:**
   - Cards & containers: `8px` (`rounded-md` / `--radius-md`)
   - Buttons, inputs, tabs, select menus, switches: `6px` (`rounded-sm` / `--radius-sm`)
   - Chips, tags, badges, progress bars, tooltips: `4px` (`rounded-xs` / `--radius-xs`)
   - Pill shapes (`rounded-full`) are forbidden everywhere except tiny circular status dots (`<= 10px`, marked `linear-exception: dot`), ECharts donut ends, and the optional circular webcam PiP mask (`CameraPip`).
5. **Recording-Only Burgundy / Signal Red Exception:**
   - Primary UI actions, interactive focus, switch active states, telemetry accents, and gain sliders use **Linear Blue** (`#3355FF`).
   - **Studio Burgundy** (`#A3284E` / `#8B1E3F`) and **Broadcast Signal Red** (`#C92A2A` / `#D32F2F`) are permitted **strictly and exclusively** on the primary Record/Stop CTA button and active recording indicators (titlebar `REC` badge/timer, HUD live pulse dot, active PiP recording border).

---

## 2. Closed Color Token Set (`src/tailwind.css`)

All color values live **exclusively** inside `src/tailwind.css`. Raw `#hex` literals in `.ts`/`.tsx` components fail `npm run check:linear`.

### 2.1 Dark Mode (`:root`, Default)

| Token | Hex | Role |
|---|---|---|
| `--bg-app` | `#050505` | Deep matte window chrome and workspace ground |
| `--bg-surface` | `#111213` | Primary elevated deck, card, drawer, and nav strip |
| `--bg-surface-2` | `#1A1B1E` | Nested cards, audio strips, input wells, raised tabs |
| `--bg-bar-idle` | `#202128` | Idle meter/progress tracks and subtle hover fills |
| `--border` | `#1F2125` | 1px primary divider and card border |
| `--border-strong` | `#2C2E33` | Hovered card boundary, strong separator |
| `--text` | `#F5F5F6` | Primary headings, labels, active values (>17:1 contrast) |
| `--text-muted` | `#8A8B91` | Secondary copy, axis labels, muted chrome icons |
| `--text-faint` | `#5A5B62` | Disabled states, placeholders, keyboard hints |
| `--bg-scrim` | `#08090B` | Solid matte dimmed modal/drawer backdrop |

### 2.2 Light Mode (`:root[data-theme="light"], .light`)

| Token | Hex | Role |
|---|---|---|
| `--bg-app` | `#F3F4F6` | Workspace app ground and titlebar |
| `--bg-surface` | `#FFFFFF` | Card, inspector, mixer deck, drawer, and nav ground |
| `--bg-surface-2` | `#F4F5F7` | Nested containers, inset inputs, secondary buttons |
| `--bg-bar-idle` | `#EAF0FF` | Idle meter/progress tracks and active hover fills |
| `--border` | `#E5E7EB` | 1px light card delimiter and hairline |
| `--border-strong` | `#D1D5DB` | Hovered control/card delimiter |
| `--text` | `#0F1115` | Primary ink (>15:1 contrast on canvas & surface) |
| `--text-muted` | `#6B7280` | Secondary labels and icons |
| `--text-faint` | `#9CA3AF` | Disabled text |
| `--bg-scrim` | `#E2E5EB` | Solid matte dimmed modal/drawer backdrop |

### 2.3 Accents & Precomputed Solid Tints

| Token | Value | Role |
|---|---|---|
| `--accent-blue` | `#3355FF` | Primary brand actions, focus rings (`--border-focus`), switches, gain sliders (`hover: #2944CC`, `active: #1F3399`) |
| `--accent-sky` | `#38B6F0` | Telemetry / ECharts secondary series |
| `--accent-green` | `#22C55E` | Online status dots, safe meter zone, FPS chart trace |
| `--accent-amber` | `#EAB308` | Compression zone (`-6 dB` warning), amber meter zone |
| `--accent-red` | `#F43F5E` | Clipping (`>0 dBFS`), dropped frames trace, danger actions |
| `--close-hover` | `#E5484D` | Window Close button hover background in `TitleBar` |
| `--accent-teal` | `#1FB5A5` | CPU encode budget donut series |
| `--accent-pink` | `#EC4899` | Auxiliary chart series |
| `--accent-purple` | `#7C5CE6` | Auxiliary chart series |
| `--accent-orange` | `#F97316` | Auxiliary chart series |
| `--tint-*` | Precomputed per theme | Opaque blended icon-chip & delta backgrounds (e.g. Dark `#15192B`, Light `#EBEEFF` for blue; never translucent `rgba()`) |
| `--ssp-accent` | Dark `#A3284E` / Light `#8B1E3F` | **Recording-only exception:** Idle Record CTA button & app mark |
| `--ssp-signal` | Dark `#C92A2A` / Light `#D32F2F` | **Recording-only exception:** Live recording Stop CTA, TitleBar `REC` badge, HUD pulse dot, active PiP 2px border |

---

## 3. Typography & Scale (`12 / 13 / 14 / 16 / 20 / 28 px`)

Both typefaces are self-hosted `.woff2` files in `src/fonts/` (SIL OFL 1.1; network CDNs forbidden):
- **`Inter` (variable 400–700):** `--font-sans`, all UI prose, controls, headers, and numeric stat tiles (`tabular-nums`).
- **`JetBrains Mono` (variable 400–600):** `--font-mono`, recording timers, dB scales, resolution/fps/bitrate telemetry, hotkeys, and diagnostic logs.

| Token | Size | Weight | Role |
|---|---|---|---|
| `display-lg` | `28px` (`1.75rem`) | `600` | StatCard primary metrics |
| `display-md` | `20px` (`1.25rem`) | `600` | Settings pane titles |
| `heading` | `16px` (`1rem`) | `600` | Deck headers, modal/drawer headings |
| `body-md` | `14px` (`0.875rem`) | `400` | Descriptions, body copy |
| `body-sm` | `13px` (`0.8125rem`) | `400 / 500` | Control labels, tab titles, buttons, table rows |
| `label` | `12px` (`0.75rem`) | `500` | Field labels, chips, metadata captions |
| `mono-md` / `mono-sm` | `14px` / `12px` | `500 / 400` | Timers (`tabular-nums`), telemetry badges |

---

## 4. Window Chrome, Shared Primitives & Layout Geometry

### 4.1 Frameless Window & Custom TitleBar (`src-tauri/tauri.conf.json`)
- **Window dimensions:** `1280×800` default, `1024×640` minimum, centered, `decorations: false`, `transparent: false`, `resizable: true`, `shadow: true`.
- **Top `TitleBar` (`40px`, `h-10`, `--bg-app`, `border-b --border`):**
  - **Left:** `20px` app icon, `Screen Studio Pro` (`13px` semibold), dynamic `11px` monospace version pill read from `tauri.conf.json` (`v0.1.0-beta.1`), and optional live `REC` / `PAUSED` timer indicator while recording.
  - **Center:** Draggable empty region (`data-tauri-drag-region`) supporting double-click maximize/restore.
  - **Right:** `ThemeToggle` (`ui-theme` persisted in `localStorage`), vertical hairline divider, Minimize (`-`), Maximize/Restore, and Close (`×` turns `--close-hover` `#E5484D`). Zero macOS traffic-light CSD dots.

### 4.2 Navigation Strip & Tri-Panel Studio
- **`NavBar` (`48px`, `h-12`, `--bg-surface`, `border-b --border`):** Centered 3-tab switcher (`Record` | `Library` | `Settings`) using `6px` rounded flat tabs with arrow-key roving; right-aligned telemetry status chip (`1080p60 VAAPI`) + `40px` Record/Stop CTA (`6px` radius).
- **Record View (`RecordView.tsx`):**
  - `>= 1120px`: Tri-panel layout — Left `CaptureInspector` (`300px`), Center stack (`SourceDeck` 16:9 Hero Canvas + `AudioMixerDeck` + `ActionRow` fit above the `1280×800` fold + `TelemetryDeck` below), Right `TakesGallery` (`260px`).
  - `720px–1119px`: `280px` Inspector + fluid Center column; `TakesGallery` toggles cleanly without overflow.
  - `AudioMixerDeck`: Peak meter bars step **Green → Amber → Red**; gain fader sliders use `--accent-blue`; mute toggles and device popovers use flat solid surfaces.
  - `TelemetryDeck`: Real-time `StatCard` metrics, ECharts FPS/dropped line trace with `RangeTabs`, CPU/GPU encode donut + `DonutLegend` styled through `echarts-linear-theme.ts` reading live CSS variables.

### 4.3 Library, Settings, Modals & Floating HUDs
- **Library (`LibraryGrid.tsx`):** Search bar, sort bar, responsive card grid (`8px` cards), opaque dark thumbnail duration chips (`4px`), keyboard-accessible quick actions, right-slide `RecordingDrawer` (`420px`) & `DeleteConfirm` (`480px`) over solid matte `--bg-scrim`.
- **Settings (`SettingsView.tsx`):** `208px` (`min-[720px]:w-52`) left section rail (horizontal scrollable tab bar on compact `<720px`) + centered `560px` reading pane across 7 sections (`First Run`, `Capture`, `Audio`, `Camera`, `Files`, `Shortcuts`, `About` reading `tauri.conf.json` version dynamically).
- **Floating HUD (`HudBar.tsx`) & Camera PiP (`CameraPip.tsx`):** Dedicated transparent HUD window renders solid `--bg-surface` bar (`--border-strong`), live pulse dot, `tabular-nums` timer, Pause/Stop/Flag buttons. `CameraPip` supports optional `circle` or `rounded` frame mask and switches to a `2px` `--ssp-signal` border while recording.

---

## 5. Accessibility, Motion & Verification Law

- **Motion:** `150ms ease-out` (`cubic-bezier(0, 0, 0.2, 1)`) everywhere; reduced to `0.01ms` via `@media (prefers-reduced-motion: reduce)` and `<MotionConfig reducedMotion="user">`.
- **Focus:** `2px solid var(--ssp-border-focus)` outline with `2px` offset (`box-shadow` focus glows removed).
- **Hit Targets:** Primary controls maintain `>= 36px` (`h-9` / `min-h-9`) touch/pointer targets; Primary Record CTA is `40px`/`48px`.
- **Governance Gate (`npm run check:linear`):** Any `blur`, `rgba`/`hsla`, Tailwind opacity modifier, dark-mode shadow, macOS CSD dot, disallowed pill shape, or raw `#hex` outside `src/tailwind.css` fails CI immediately.
