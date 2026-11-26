# DESIGN.md — ScreenStudio Pro Design System

**Version:** 6.0 · **Date:** 2026-11-26 · **Status:** **FINAL & LOCKED**

**Authority:** PRD.md (product scope) → PRODUCT.md (brand feel) → **this file (visual law)**  
**Lock Rule:** The **Unified Linear-Style Design System** is finalized and locked to the palette and token exceptions in this version. Layout, typography, component geometry, and interactions remain unchanged. No frosted glass, translucent surfaces, pill buttons, extra shadows, or macOS traffic lights are permitted. Automated enforcement runs on every check via `npm run check:linear` (`scripts/check-linear.mjs`).

---

## 1. Brand Feel & Core Visual Law

**Feel:** High-density, crisp, flat-matte Linux desktop engineering studio inspired by Linear. Built for clarity, low cognitive overhead, and effortless contrast across **Dark** (default) and **Light** modes (`html[data-theme="dark|light"]`, persisted under `localStorage["ui-theme"]` and applied before first paint in `index.html`).

### Non-Negotiable Principles
1. **Flat Opaque Surfaces:** All chrome, decks, cards, drawers, modals, popovers, and HUDs use opaque surface tokens separated by `1px` structural borders (`--border`, `--border-strong`). `backdrop-filter: blur(...)`, translucent surface fills, Tailwind `/opacity` modifiers on surfaces/text/borders, and glow effects are forbidden. Only the scrim, chart-fade, and card-shadow tokens listed in §2 may use alpha colors.
2. **Dark Default, Light Parity:**
   - Dark mode uses the single card elevation token `--shadow-card`; no other shadows are permitted. Focus rings use crisp `outline: 2px solid var(--blue-text)`.
   - Light mode uses the same token for subtle hairline card elevation.
3. **Hero 16:9 Canvas:** Screen preview uses a native 16:9 container on `--hero-canvas-bg` (an alias of `--bg-app`) with `1px` `--border`, `8px` corners, zero blur, and zero shadow. Overlays (webcam PiP, region drag-rect) render directly inside this frame.
4. **Minimal Structural Rounding & Zero Pills:**
   - Cards & containers: `8px` (`rounded-md` / `--radius-md`)
   - Buttons, inputs, tabs, select menus, switches: `6px` (`rounded-sm` / `--radius-sm`)
   - Chips, tags, badges, progress bars, tooltips: `4px` (`rounded-xs` / `--radius-xs`)
   - Pill shapes (`rounded-full`) are forbidden everywhere except tiny circular status dots (`<= 10px`, marked `linear-exception: dot`), ECharts donut ends, and the optional circular webcam PiP mask (`CameraPip`).
5. **Recording-Only Burgundy / Signal Red Exception:**
   - Blue is the general interactive accent and telemetry series color; the primary button uses the theme-specific `--btn-primary-bg` / `--btn-primary-text` pair.
   - The Studio Burgundy and Broadcast Signal Red values in `src/styles/recording-tokens.css` are permitted only on the Record CTA and active recording indicators (titlebar `REC` badge/timer, HUD live pulse dot, active PiP `2px` border).

---

## 2. Color Token Set (`src/styles/linear-theme.css`)

Shared semantic color values live in `src/styles/linear-theme.css`; the recording-only values live in `src/styles/recording-tokens.css`. `src/tailwind.css` maps these tokens to Tailwind utilities and keeps non-color design tokens. Raw CSS colors are forbidden elsewhere in app source, enforced by `npm run check:linear`. The fixed brand image and unreferenced starter SVG assets are not theme sources and remain unchanged.

### 2.1 Dark Mode (default)

| Token | Value | Role |
|---|---|---|
| `--bg-app`, `--bg-sidebar`, `--bg-surface` | `#1C1C1C` | Window ground, sidebar, cards, panels, dialogs, HUD |
| `--bg-surface-2`, `--bg-active` | `#292929` | Inputs/nested surfaces and selected states |
| `--bg-hover` | `#232323` | Hover fill |
| `--bg-track`, `--bg-bar-idle` | `#333333` | Switch/progress tracks and idle chart bars |
| `--border`, `--chart-grid` | `#2E2E2E` | Hairline borders and chart gridlines |
| `--border-strong` | `#363636` | Strong/selected boundaries |
| `--text` | `#FFFFFF` | Headings, primary metrics, active text |
| `--text-secondary` | `#CBCBCB` | Body text, labels and table rows |
| `--text-muted` | `#B4B4B4` | Units, timestamps, table headers, inactive tabs |
| `--text-faint` | `#939393` | Hints and disabled text |
| `--blue`, `--blue-text` | `#346AFE`, `#3483FF` | Blue series/fills; links, focus and active state text |
| `--sky`, `--green`, `--green-text` | `#2FADFF`, `#1A9942`, `#38C84F` | Series/healthy states and positive delta text |
| `--amber`, `--teal`, `--pink`, `--purple`, `--orange` | `#F6940F`, `#0ACC8A`, `#FC669B`, `#6D59F9`, `#FB6801` | Telemetry/chart series and warning |
| `--red`, `--red-text` | `#FC4232`, `#FF6B5E` | Error/critical fills and negative delta text |
| `--gray` | `#4F4F4F` | Neutral chart series |
| `--chip-green`, `--chip-red`, `--chip-blue` | `#1C261E`, `#2D1F1F`, `#1B2531` | Solid status/delta chip fills |
| `--btn-primary-bg`, `--btn-primary-text` | `#FFFFFF`, `#1C1C1C` | Primary button fill and text |
| `--close-hover` | `#E5484D` | Window close hover fill; icon uses theme-aware `--text` to preserve the shared palette checksum |
| `--scrim`, `--chart-fade-up`, `--chart-fade-down` | `rgba(0,0,0,0.7)`, `rgba(26,153,66,0.15)`, `rgba(252,66,50,0.15)` | Modal scrim and chart-area fades; only these tokens may be translucent |
| `--shadow-card` | `0 12px 28px -6px rgba(0,0,0,0.5)` | Sole card shadow in either theme |

### 2.2 Light Mode

| Token | Value | Role |
|---|---|---|
| `--bg-app` | `#F8F9FA` | Window, titlebar and workspace ground |
| `--bg-sidebar`, `--bg-surface-2` | `#F3F4F6` | Sidebar/rail and nested surfaces |
| `--bg-surface` | `#FFFFFF` | Cards, panels, dialogs and HUD |
| `--bg-active`, `--bg-track`, `--bg-bar-idle` | `#E5E7EB` | Selected states, tracks and idle bars |
| `--bg-hover` | `#EEF0F2` | Hover fill |
| `--border` | `#E5E7EB` | Hairline borders |
| `--border-strong`, `--chart-grid` | `#D1D5DB` | Strong boundaries and chart gridlines |
| `--text`, `--text-secondary` | `#111827` | Headings, body text and labels |
| `--text-muted`, `--text-faint` | `#5B6370`, `#868E9C` | Secondary and faint text |
| `--blue`, `--blue-text` | `#2563EB` | Blue fills/series and links/focus text |
| `--sky`, `--green`, `--green-text`, `--amber` | `#0284C7`, `#059669`, `#15803D`, `#D97706` | Series/healthy states and semantic text |
| `--teal`, `--pink`, `--purple`, `--orange` | `#0D9488`, `#DB2777`, `#6D28D9`, `#EA580C` | Telemetry/chart series |
| `--red`, `--red-text`, `--gray` | `#DC2626`, `#B91C1C`, `#868E9C` | Error/critical, negative delta text and neutral series |
| `--chip-green`, `--chip-red`, `--chip-blue` | `#DCFCE7`, `#FEE2E2`, `#DBEAFE` | Solid status/delta chip fills |
| `--btn-primary-bg`, `--btn-primary-text` | `#2563EB`, `#FFFFFF` | Primary button fill and text |
| `--close-hover` | `#E5484D` | Window close hover fill; icon uses theme-aware `--text` to preserve the shared palette checksum |
| `--scrim`, `--chart-fade-up`, `--chart-fade-down` | `rgba(0,0,0,0.4)`, `rgba(5,150,105,0.1)`, `rgba(220,38,38,0.1)` | Modal scrim and chart-area fades; only these tokens may be translucent |
| `--shadow-card` | `0 1px 2px rgb(16 24 40 / 5%)` | Sole card shadow in either theme |

### 2.3 Recording-Only Tokens

| Token | Dark | Light | Role |
|---|---|---|---|
| `--rec-red` | `#EF4444` | `#DC2626` | Live recording indicator and timer |
| `--rec-burgundy` | `#831843` | `#9F1239` | Record button fill |
| `--rec-burgundy-border` | `#BE185D` | `#9F1239` | Record button border |
| `--rec-burgundy-text` | `#FFFFFF` | `#FFFFFF` | Record button text; preserves the existing high-contrast foreground |

Recording colors are strictly limited to the Record CTA and active recording indicators (titlebar `REC` badge/timer, HUD pulse dot and active PiP border). No other color may be hard-coded in components; all component colors reference semantic token names.

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
  - `AudioMixerDeck`: Peak meter bars step **Green → Amber → Red**; gain fader sliders use `--blue`; mute toggles and device popovers use flat solid surfaces.
  - `TelemetryDeck`: Real-time `StatCard` metrics, ECharts FPS/dropped line trace with `RangeTabs`, CPU/GPU encode donut + `DonutLegend` styled through `echarts-linear-theme.ts` reading live CSS variables.

### 4.3 Library, Settings, Modals & Floating HUDs
- **Library (`LibraryGrid.tsx`):** Search bar, sort bar, responsive card grid (`8px` cards), theme-aware thumbnail duration chips (`4px`), keyboard-accessible quick actions, right-slide `RecordingDrawer` (`420px`) & `DeleteConfirm` (`480px`) over the themed `--scrim` token.
- **Settings (`SettingsView.tsx`):** `208px` (`min-[720px]:w-52`) left section rail (horizontal scrollable tab bar on compact `<720px`) + centered `560px` reading pane across 7 sections (`First Run`, `Capture`, `Audio`, `Camera`, `Files`, `Shortcuts`, `About` reading `tauri.conf.json` version dynamically).
- **Floating HUD (`HudBar.tsx`) & Camera PiP (`CameraPip.tsx`):** The native HUD window backing remains transparent; the HUD bar itself is solid `--bg-surface` with `--border-strong`, live pulse dot, `tabular-nums` timer, Pause/Stop/Flag buttons. `CameraPip` supports optional `circle` or `rounded` frame mask and switches to a `2px` `--rec-red` border while recording.

---

## 5. Accessibility, Motion & Verification Law

- **Motion:** `150ms ease-out` (`cubic-bezier(0, 0, 0.2, 1)`) everywhere; reduced to `0.01ms` via `@media (prefers-reduced-motion: reduce)` and `<MotionConfig reducedMotion="user">`.
- **Focus:** `2px solid var(--blue-text)` outline with `2px` offset (`box-shadow` focus glows removed).
- **Hit Targets:** Primary controls maintain `>= 36px` (`h-9` / `min-h-9`) touch/pointer targets; Primary Record CTA is `40px`/`48px`.
- **Governance Gate (`npm run check:linear`):** Blur, Tailwind opacity modifiers, palette utility classes, retired palette values, non-token shadows, macOS CSD dots, disallowed pills, or raw colors outside the two palette files fail CI. Alpha functions are allowed only on `--scrim`, `--chart-fade-up`, `--chart-fade-down`, and `--shadow-card`; the HUD window backing stays natively transparent while its visible bar remains opaque.
