# DESIGN.md — ScreenStudio Pro Design System

**Version:** 2.0 · **Authority:** PRD.md (product scope) → PRODUCT.md (brand feel) → **this file (visual law)**
**Rule:** Every UI built later must follow this file strictly. Do not invent new colors or fonts outside it. To change a token, change it here first.

**v2.0 changelog (2026-11-17):** PRD review completed as required by §8 — PRD §Vision/G2 and its risk list, plus PRODUCT.md's pinned brand feel, require a glassmorphic, translucent, animated, quiet desktop-native UI but do **not** pin a hue. The approved contract change replaces Aurora Teal with a **Burgundy** accent on **near-black warm neutrals**, switches the window/controls to **minimal-radius rectangles**, makes the preview **square (1:1)**, gives each surface **one scroll owner**, and adds **press / scroll-reveal** motion compositions. Every component must be rebuilt against these tokens; no v1.0 hex/px literal survives in a component.

---

## 1. Brand Feel & Design Principles

**Feel:** frosted, floating, quiet-software. Translucent glass panels that sit *on* the user's wallpaper — Hyprland, niri, MangoWC, KDE. Calm while idle; expressive and alive the instant **Record** is pressed. The app should look like it was made for the desktop it's recording: a modern, dark, burgundy-accented instrument panel with rectangular, minimally rounded surfaces — not a foreign dashboard imported from 2009.

**Principle 1 — Glass earns its keep.**
Translucency is used where it does a job (floating HUD, main panels, toasts — making the app feel light and at home on a riced desktop). Where reading matters most (settings forms, file tables, library grid rows), surfaces strengthen toward solid. Rules: glass layers always pair a tinted fill + `backdrop-blur` + a 1px inner border + a shadow, in one of the defined **Glass recipes** (§4.4); no blur without a supporting recipe. Anti-goal (PRD): frosted ≠ illegible — if a glass surface fails its contrast floor, it steps down to the solid equivalent (§7).

**Principle 2 — One accent, one signal.**
The UI is quiet near-black neutrals plus a single accent (**Burgundy**) meaning exactly one thing: *the primary action available right now*. The signal color (Signal Red) means exactly one thing: *recording is live*, forever — it never decorates anything else, so when the user sees red, they know they're on air. Success/warning/error exist only as semantic feedback. Color as decoration is banned outside the two sanctioned delight moments (§6.5).

**Principle 3 — Motion is information.**
Every animation states a fact: "recording started," "settings saved," "panel appeared." 90–240ms, one motion system (§4.6). No page-load choreography, no looping idle animation except the recording pulse. Motion uses compositor properties (transform, opacity) only — never layout properties.

---

## 2. Color

### 2.1 Strategy
**Restrained** (Operate mode floor): warm near-black neutral layers + one burgundy accent + semantic set. One sanctioned **Committed** moment: the live recording state, where Signal Red carries the HUD dot, timer accenting, and capture indicators.

### 2.2 Dark mode (default)
Dark is the default: the audience runs dark rices, and recording overlays live over bright, colorful content. All values are measured against §7's contrast floor; see the v2.0 audit in §8.

| Token | Value | Role |
|---|---|---|
| `bg.canvas` | `#0A0809` | App background under all glass (near-black, warm) |
| `bg.raised` | `#120E10` | Opaque layer for settings forms, tables |
| `surface.glass` | `rgba(255,240,244,0.055)` | Glass panel fill (Pane recipe) |
| `surface.glass-strong` | `rgba(26,12,18,0.76)` | Strong glass — HUD, modals, toasts |
| `surface.solid` | `#1A1417` | Cards resting on the canvas |
| `border.subtle` | `rgba(255,240,244,0.09)` | Hairlines, dividers |
| `border.glass` | `rgba(255,240,244,0.15)` | Inner border on glass layers |
| `text.primary` | `#F5EEF0` | Headings, body (17.47:1 on canvas) |
| `text.secondary` | `rgba(245,238,240,0.68)` | Labels, meta |
| `text.disabled` | `rgba(245,238,240,0.40)` | Disabled, inactive |
| `accent` | `#E2A0B0` | Burgundy primary actions, selection, active toggles (9.4:1 on canvas) |
| `accent.hover` | `#ECC0CC` | Accent hover |
| `accent.active` | `#C97F94` | Pressed/checked |
| `accent.text` | `#1A0A0F` | Text/icons on accent fill (9.04:1 — §7 floor ≥8:1) |
| `accent.muted` | `rgba(226,160,176,0.15)` | Selected rows, accent washes, hover zones |
| `signal` | `#FF5A66` | RECORDING LIVE. Never any other use (6.57:1 on canvas) |
| `signal.muted` | `rgba(255,90,102,0.16)` | Recording-state fills |
| `success` | `#5EE58A` | Confirmations (12.41:1) |
| `warning` | `#FFC24B` | Encoder-fallback notices, caution (12.43:1) |
| `error` | `#FF7A85` | Failures — always paired with icon + text (7.96:1) |
| `error.muted` | `rgba(255,122,133,0.14)` | Destructive hover washes |

### 2.3 Light mode
Light is a complete second face, never an afterthought (§8). Its accent is a deeper burgundy so white on-accent text clears the 8:1 floor.

| Token | Value |
|---|---|
| `bg.canvas` | `#F6F1F2` |
| `bg.raised` | `#FFFFFF` |
| `surface.glass` | `rgba(255,255,255,0.62)` |
| `surface.glass-strong` | `rgba(255,255,255,0.88)` |
| `surface.solid` | `#FFFFFF` |
| `border.subtle` | `rgba(26,10,15,0.09)` |
| `border.glass` | `rgba(255,255,255,0.9)` |
| `text.primary` | `#1A0A0F` (17.17:1 on canvas) |
| `text.secondary` | `rgba(26,10,15,0.66)` |
| `text.disabled` | `rgba(26,10,15,0.38)` |
| `accent` | `#7E2A44` (8.16:1 on canvas) |
| `accent.hover` | `#6E223A` |
| `accent.active` | `#5C1B30` |
| `accent.text` | `#FFFFFF` (9.12:1 on accent) |
| `accent.muted` | `rgba(126,42,68,0.12)` |
| `signal` | `#C42B45` (4.97:1 on canvas) |
| `signal.muted` | `rgba(196,43,69,0.12)` |
| `success` | `#1C7A44` (4.8:1) |
| `warning` | `#8A5A00` (5.3:1) |
| `error` | `#B3243E` (5.8:1) |
| `error.muted` | `rgba(179,36,62,0.12)` |

### 2.4 Hard rules
- Never invent a color. No gradient fills outside §4.4's sanctioned specular highlight and §6.5's shutter flash.
- `signal` (recording) and `error` (failure) are told apart by context and icon, never by color alone — see §5.1/§5.6.
- Accent never colors body text, never decorates, never appears on inactive elements.
- Every new palette value lands in §2 first **with its measured contrast ratio** (§7), then in the token layer (§8).

---

## 3. Typography

| Face | Delivery | Use |
|---|---|---|
| **Familjen Grotesk** (variable, 400–700) | Self-hosted `.woff2` + `@font-face`, served locally (never a hosted CDN stylesheet) | Everything textual: headings, body, labels, buttons |
| **JetBrains Mono** (variable, 400–600) | Self-hosted `.woff2`, served locally | Numerals that must align and matter: timers, durations, bitrates, file paths, stats, versions |

Familjen Grotesk carries the brand: a Scandinavian grotesk with warmth that reads "rice-era Linux" without borrowing Inter/Space Grotesk neutrality. JetBrains Mono is the audience-native numeric voice. Inter, IBM Plex, Space Grotesk, DM Sans and similar category-defaults are **off-menu**.

### Scale (fixed rem — desktop app, consistent DPI; no fluid clamps)
| Token | Size | Line height | Weight | Use | Family |
|---|---|---|---|---|---|
| `display.lg` | 1.75rem (28px) | 1.15 | 700 | Main-window state title ("Ready to record") | F. Grotesk |
| `display.md` | 1.375rem (22px) | 1.2 | 700 | Panel titles (Recordings, Settings) | F. Grotesk |
| `heading` | 1.125rem (18px) | 1.35 | 600 | Section headings, modal titles | F. Grotesk |
| `body-md` | 0.9375rem (15px) | 1.5 | 400 | Body copy, descriptions | F. Grotesk |
| `body-sm` | 0.8125rem (13px) | 1.45 | 400 | Secondary copy, list secondary lines | F. Grotesk |
| `label` | 0.75rem (12px) — floor | 1.3 | 500 | Overline labels ("MIC", "ENCODER"), tooltips | F. Grotesk |
| `mono-md` | 0.9375rem (15px) | 1.2 | 500 | Recording timer, meter numerals | J. Mono, tabular figures |
| `mono-sm` | 0.8125rem (13px) | 1.3 | 400 | Paths, sizes, fps/bitrate chips | J. Mono, tabular figures |

Scale ratio ≈1.15 between steps (Operate rule). No display face in labels, buttons, or data. `label` (12px) is the absolute floor — no smaller text token exists or is added.

---

## 4. Foundations

### 4.1 Spacing scale (4px base)
`space.1=4 · space.2=8 · space.3=12 · space.4=16 · space.5=20 · space.6=24 · space.8=32 · space.10=40 · space.12=48`
Rules: inside a component use 2–3; between grouped controls 4; between panel sections 6–8; window side margins 6. Rhythm: more space above a heading than below it — section top `space.8`, heading-to-content `space.3`. Spacing is owned once per surface (§6.0) — never doubled by nested wrappers.

### 4.2 Radius
Rectangular, minimally rounded surfaces: the window and panels use the smallest radius that still reads as a deliberate corner. Pill shapes survive only for the HUD-less inline chips and the PiP circle variant.

| Token | Value | Use |
|---|---|---|
| `r.none` | 0px | Flush dividers, flat table edges |
| `r.xs` | 4px | Inputs, inline chips, paused square |
| `r.sm` | 6px | Buttons, selects, HUD toolbar, small cards |
| `r.md` | 8px | Cards, toasts, glass panels, modal/drawer |
| `r.lg` | 10px | Main window corners, NavBar top corners |
| `r.full` | 999px | Pills, segmented controls, PiP circle variant |

A floating panel is `r.md`; the app window and NavBar are `r.lg`; an inline control never exceeds `r.sm`.

### 4.3 Shadows & elevation (soft, layered, never saturated)
Tinted toward near-black burgundy — never saturated color shadows.

| Token | Dark recipe | Light recipe | Use |
|---|---|---|---|
| `elev.1` | `0 1px 2px rgba(10,4,7,0.32), 0 4px 12px rgba(10,4,7,0.22)` | `rgba(26,10,15,0.12/0.10)` | Cards, popovers |
| `elev.2` | `0 2px 6px rgba(10,4,7,0.36), 0 12px 32px rgba(10,4,7,0.30)` | `.16/.18` mix | Modals, toasts |
| `elev.float` | `0 2px 8px rgba(10,4,7,0.40), 0 24px 64px -12px rgba(10,4,7,0.55)` | `.16/.28` mix | HUD, PiP frame |

### 4.4 Glass recipes (the only sanctioned blur treatments)
Every glass layer = fill + blur + border + shadow, exactly one recipe each:

| Recipe | Fill | Blur | Border | Shadow | Use for |
|---|---|---|---|---|---|
| **Pane** | `surface.glass` | `blur(20px) saturate(160%)` | `border.glass` 1px | `elev.1` | Main window panels, trays |
| **Float** | `surface.glass-strong` | `blur(28px) saturate(190%)` | `border.glass` 1px | `elev.float` | HUD, PiP, toasts, detached panels |
| **Modal** | `surface.glass-strong` | `blur(32px)` | `border.subtle` 1px | `elev.2` | Modals/drawers over a scrim of `rgba(10,4,7,0.5)` (0.24 light) + `blur(4px)` |

- Sanctioned extra: specular highlight — `linear-gradient(120deg, rgba(255,255,255,0.10), transparent 40%)` overlay, Float/Modal layers only.
- **Contrast floor:** every glass layer carries a `::before` scrim of `bg.canvas` at 55% opacity so text contrast holds over bright wallpapers. Part of the recipes, never optional.

### 4.5 Iconography & imagery
- **lucide-react** only, 1.5px stroke, 20px default (16px dense/inline). One style; no filled/blur variants, no icon mixing.
- Sort/direction glyphs (`▲`/`▼`) are replaced by lucide `ArrowUp`/`ArrowDown` 16px — no text glyphs as icons.
- Illustration (empty states, education slots): single-weight line work at `text.disabled` on `accent.muted` washes. No stock photos, no 3D blobs.
- Source previews show real frames from the live PipeWire stream only — never a fake gradient pretending to be the desktop.

### 4.6 Motion
- Tokens: `m.fast = 140ms ease-out-quart` · `m.base = 180ms spring(≈300, 24)` · `m.slow = 240ms spring(≈260, 20)` · `m.settle = 90ms ease-in`. These four are the closed numeric set.
- **Named compositions** (built from the four tokens, not new numbers): `m.press` — `scale(0.96)` over `m.fast`, ease-out, disabled buttons never scale; `m.reveal` — opacity 0→1 + `translateY(6px→0)` over `m.base`, used for scroll-revealed sections and view swaps.
- Hover/focus: color+fill on `m.fast`. Press: `m.press`.
- Enter: `m.reveal`. Exit: reverse on `m.settle`; content never waits for exit motion to become readable.
- **Recording pulse:** the 10px `signal` dot breathes opacity 1→0.35→1 over 1.4s — the only infinite loop in the system; disabled under reduced motion.
- **Shutter** (delight moment §6.5): on stop, a `rgba(255,255,255,0.35)` overlay fades over the UI 240ms — once per session end, never repeated.
- Reduced motion (`prefers-reduced-motion`): transforms removed, opacity-only, ≤100ms. **JavaScript motion must honor the same law** — framer-motion is wrapped in `<MotionConfig reducedMotion="user">`; a CSS media rule alone is not sufficient for JS-driven transforms.

---

## 5. Component Specs (all states: default / hover / focus / active / disabled / loading / error)

Built on shadcn/ui + Radix primitives, restyled to these tokens. Missing states = unfinished component. Universal focus ring: `0 0 0 2px <underlying ground>, 0 0 0 4px accent` — ≥3:1 against its surrounding, never suppressed.

### 5.1 Buttons
Variants: **primary** (accent fill, `accent.text` label; ≤1 per view), **secondary** (`surface.solid`, `border.subtle`, `text.primary`), **ghost** (transparent, `text.secondary`), **danger** (destructive only: delete recording, discard take; `error` border + text on hover fills `error.muted`), **icon** (40px `r.sm`, ghost or secondary).
Sizes: `sm` 32px/`r.sm` · `md` 40px · `lg` 48px (Record button only). Corner: `r.sm` everywhere — no pill buttons. Label: `body-sm`, weight 500. Icon left, gap `space.2`.
- **hover:** primary→`accent.hover`; secondary/ghost→`accent.muted` wash; danger→`error.muted`
- **active/press:** primary→`accent.active`; all→`m.press`
- **focus:** universal focus ring
- **disabled:** fill `border.subtle`, label `text.disabled`, no hover legible, never scales
- **loading:** label swaps to spinner (14px, 2px stroke, `m.slow` linear) + "Working…" with `aria-live="polite"`; width fixed, no layout shift
- **error:** never a button style — failures surface at the field/panel/toast level
- The Record start button is always primary, always 48px, `r.sm`, layout `[lucide dot ●] Record`.

### 5.2 Inputs (text, search, settings fields)
Default: `bg.raised` fill, `r.xs`, `border.subtle`, 44px min height; label (`body-sm` 500) above, description (`body-sm` `text.secondary`) optional below; left icon optional.
- hover: border `rgba(255,240,244,0.16)` dark / `rgba(26,10,15,0.16)` light
- focus: ring + border `accent`; label turns `accent`
- error: border `error` + message line below (`body-sm`, `error`, alert-circle 14px); label stays neutral — error = color + icon + text, never color alone
- disabled: all `text.disabled`, fill `border.subtle`, read-only semantics
- Numeric fields: value in JetBrains Mono; unit ("Mbps", "fps") as `label` suffix. Required suffix is `*` in `text.secondary` with `title="required"`.

### 5.3 Select / Combobox
Trigger = input spec + chevron-down 16px. Popover = Modal glass recipe on `elev.2`, `r.sm`, max-height 320px with scroll shadows. Item 36px: hover `accent.muted` wash; selected = check (lucide, right, `accent`) + weight 500; focus ring on item. Radix keyboard behavior + typeahead. Error shows on the trigger, not the popover.

### 5.4 Checkbox · Switch · Radio
All keyboard-operable with the universal ring, states for hover/active/disabled/error (error = group message + ring on active controls). Settings panes reuse this primitive — no hand-rolled toggles.
- **Checkbox:** 18px, `r.xs`; checked = `accent` fill + `accent.text` check; label right, gap `space.2`
- **Switch:** 40×24 pill; on = `accent` track, off = `bg.raised` + `border.subtle`; knob white, `m.fast` translate
- **Radio:** in choice lists (container MKV/MP4/WebM); selected = 2px `accent` ring + 6px `accent` center dot

### 5.5 Cards & the recording library grid
- **Card:** `surface.solid`, `r.md`, `border.subtle`, `elev.1`, padding `space.4`. Interactive hover: border → `accent`-tinted, y −1px on `m.fast`; static cards hoverless.
- **Loading:** skeleton grid — shimmer `rgba(255,255,255,0.05)→0.09` 1.6s on `surface.solid` shapes; skeletons everywhere content loads, never spinners mid-page.
- **Error (missing file):** thumbnail persists + `signal.muted` overlay chip "File missing".
- **Recording item:** 16:9 thumbnail (`r.sm`), duration chip bottom-right (`mono-sm`, scrim ground from §4.4 + `text.primary`), name `body-sm` 500, meta row (`label`/`mono-sm`: date · size · fps · encoder). Hover reveals icon-action row: open, copy path, delete-danger. Click = detail drawer (§5.7). Nothing important hidden behind hover.

### 5.6 Toasts
Glass **Float** recipe, `r.md`, bottom-center stack, max 3, auto-dismiss 5s (6s with action). Anatomy: 18px lucide icon in its semantic color, title `body-sm` 500, description `body-sm` `text.secondary`, optional ghost action. Enter `m.reveal`; exit fade `m.settle`. `aria-live:` polite (status) / assertive (error). **Error toast:** alert-triangle icon, 2px `error` left border, persists until dismissed. The "Saved" toast includes duration (`mono-md`) and path (`mono-sm`) with a copy icon-button.

### 5.7 Modal & Drawer
Centered `<dialog>` portaled (overlays escape clipping containers, always). Session: Modal recipe, `r.md`, max-width 480px; scrim closes + Esc; mandatory focus trap, restore focus on close. Drawer: right-slide 420px, same recipe. No nested modals, ever.

### 5.8 NavBar (window chrome)
52px bar, Pane recipe with `r.lg` top corners only. Left: app mark — 16px `r.xs` square with centered `signal` dot under `accent` tint — plus "ScreenStudio Pro" `body-sm` 500. Center: **flat rectangular tab row** (`r.sm`, no pill, no segmented capsule): **Record / Library / Stream(V2) / Settings**, each with a 16px lucide icon + label; active = `accent.muted` fill + 2px inset bottom `accent` indicator; Stream always disabled with `label` badge "V2" and tooltip "Streaming arrives in V2". Right: lucide sliders-horizontal (settings tray) + x (minimize to tray). We always render our own titlebar (custom CSD); native decorations off.

### 5.9 HUD (recording toolbar) — signature component
Float recipe, height 46px, **`r.sm` rounded rectangle** (not a pill), padding-inline `space.3`, min-width 220px, draggable everywhere, corner-snap guides at 8px insets. Anatomy →: rec-dot (10px `signal` circle, pulse loop) · timer (`mono-md`, tabular) · pause · stop · flag icon-buttons (`r.xs`).
- **rec (default above):** as described
- **paused:** dot becomes 22px `signal` square (`r.xs`); timer shows "PAUSED" (`label` chip beside)
- **stop-hover:** stop scales 1.06 on `m.fast`, tooltip "Stop & save"
- **double-click:** pin (opacity 0.85, `elev.float` retained)
Must hold 4.5:1 text contrast over any content — the §4.4 scrim floor guarantees it.

### 5.10 Lists & tables (audio device lists, recordings path table)
Row 44px (dense 36px), `border.subtle` dividers; hover `accent.muted`; selected `accent.muted` + 2px inset `accent` left bar. Header `label`-uppercase/tracking 0.05em, `text.secondary`. Whole row is the click and focus target — focus ring on the row, never per-cell.

---

## 6. Screen Layouts (every MVP surface in PRD §5–7 — layouts are law)

**Window breakpoints (desktop):** `compact <720px` · `standard 720–1120px` · `wide >1120px`. Compact must always work (WM-resized windows). HUD/PiP/toasts are overlays and never reflow.

### 6.0 Scroll ownership (new in v2.0 — the double-scroll fix)
Exactly **one** scroll container per surface:
- Record: the App shell's main content scrolls; its panels never own a scroll (except the compact audio strip's documented horizontal scroller).
- Library: the Library surface owns the vertical scroll; the App shell switches to `overflow-hidden` for this view. Header and sort bar stay pinned inside that surface.
- Settings: the Settings content column owns the vertical scroll; the App shell is `overflow-hidden`. The tab rail owns its own overflow independently (vertical on standard/wide, horizontal on compact).
No surface nests a second `overflow-y-auto` inside the first. Padding is applied by the scroll owner only.

### 6.1 Record (main window)
Vertical shell, all idle-visible, nothing hidden behind "more":
1. **NavBar** (§5.8)
2. **Workspace** — the source-and-preview working area. Standard/wide: two columns, `minmax(0,1fr)` main + `space.8` gap + 320px side rail. Main column: source chips row (Monitor / Window / Region, lucide monitor · app-window · scan, `mono-sm` capability line; selected = `accent.muted` fill + `accent` border + check) above a **square (1:1) preview frame** horizontally centered (`r.md`, `surface.solid`; live 16:9 frames are `object-contain` letterboxed — never cropped or stretched) with the region mini-canvas when selected. Side rail: Audio channel cards (Mic / Desktop: device name `body-sm`, 4px meter with −6 dB split, switch, device popover) above the Camera slab (live PiP inline or "Add camera" chip). Compact: chips become a segmented control, preview stays square at full width, audio cards scroll horizontally, side rail stacks below.
3. **Action row** — full-width primary **Record** (48px, `r.sm`) · quality preset select left (plain language: "For YouTube — 1080p60") · encoder chip right (`mono-sm`: VAAPI/NVENC/x264; x264 shows warning-state inline notice with zap-off icon: "Falling back to CPU encode"), pinned to the bottom of the workspace shell.
4. **Stats line** (recording-state only) — one `mono-sm` tabular line under the action row while a take is active: fps · dropped · bitrate · encode time, fed by `recording/stats` at 0.5 Hz. Not rendered when idle.

### 6.2 Library
NavBar → Library. One scroll owner (§6.0). Header: `display.md` "Recordings" · search (max 320px) · sort select with lucide `ArrowUp`/`ArrowDown` · space grouping, pinned above the scroll. Grid: 4/3/1 columns (wide/standard/compact) of §5.5 items, gap `space.4`. First 50 shown; "Show more" secondary button — no infinite scroll in MVP. Card click = detail drawer with large thumb, full meta table (mono values), `Reveal in file manager` secondary action, `Trim later` disabled with tooltip "Planned for V2". States: empty/loading-skeleton/error-with-retry (§6.3).

### 6.3 Empty & education states (teach the interface, never say "nothing here")
- **Library empty:** single-stroke frame illustration + heading "Nothing recorded yet" + body "Choose a source on the Record tab, then hit Record. Your clips will land here." + ghost "Go to Record".
- **Preview not yet granted:** `text.disabled` monitor icon centered in the square preview frame + label "Click Monitor to allow capture through your compositor" — the first-run education slot.
- **Search empty:** "No recordings match “<query>”" + ghost "Clear search".
- **Audio silent:** meter idle at 0 with label "Speak to test your mic level".

### 6.4 Settings
NavBar → Settings. **Rail:** on standard/wide, a 200px left rail (`flex-row` shell, rail `h-full`, its own vertical scroll, `border-r border.subtle`) with 7 entries — First Run / Capture / Audio / Camera / Files / Shortcuts / About — each a 16px lucide icon + `label`, active = `accent.muted` + `accent` text. On compact, the rail becomes a horizontally scrollable pill row above the content. **Content:** one scroll owner (§6.0), `bg.raised`, one `max-width: 560px` wrapper only (panes never re-wrap themselves), padding `space.6`, row rhythm `space.6` between groups and `space.3` heading-to-content. Every row: label (`body-sm` 500) + description (`body-sm` secondary) + control right-aligned; presets in plain human language ("For Discord — 720p30, ~6 Mbps") per PRD. All switches use §5.4's `ui/switch.tsx`. About tab: version (`mono-sm`), licenses, GitHub link, logo at `r.md`. No nested `<main>` element inside the App's tabpanel.

### 6.5 Recording session flow (the signature experience)
1. Record pressed → button shows loading spring briefly → window minimizes to tray → **HUD appears** (`m.base` reveal, bottom-right 24px margin) → rec-dot starts pulsing.
2. Mid-session: HUD per §5.9. Toast "Recording started" is **never shown** — the HUD already says it; no double-telling.
3. Stop → **shutter flash** (240ms, once) → HUD vanishes (`m.settle` exit) → "Saved" toast with duration + path + Reveal/Copy → window re-focuses on Library, new recording row highlighted with a 1.2s `accent.muted` fade-out.
4. Flag keypress drops a chapter marker (PRD M-flow): brief tick appears on the timer chip — silent, non-blocking.

### 6.6 Camera PiP
Float recipe, default **rounded-rect `r.md`** (circle still available via the existing shape toggle), 160–320px, draggable with corner-snap guides, `elev.float`, 1px `border.glass` ring, 2px `signal` ring while recording is live. Hover controls: camera-off freeze (preview only), resize handle 44px, drag everywhere else. Whether it composites into the output is an explicit "self-insert" toggle in Camera settings — default off.

---

## 7. Accessibility (hard law, checked per release)

1. **Contrast:** ≥ 4.5:1 for text on its real composited background (glass recipes' scrim floor exists for this); ≥ 3:1 large text and UI boundaries; `accent.text` on `accent` ≥ 8:1 as tokenized (dark 9.04:1, light 9.12:1 — measured, §8). Icon-only controls need the ring-visible icon + `aria-label`.
2. **Focus ring:** universal, never suppressed; 4px total, geometry + color redundancy; tab order = DOM = visual order; Esc closes floatovers; modals trap and restore focus.
3. **Keyboard:** everything reachable without pointer; segmented nav = arrow-key roving; selects follow Radix; HUD controls fully tabbable cyclically; region overlay adjustable by arrows (1px, shift = 10px).
4. **Color independence:** recording/paused/success/error always pair color with icon + shape change + text (rec-dot vs 22px square; alert-triangle; check). Never color-only.
5. **Motion:** honor `prefers-reduced-motion` in **both** CSS and JS (`MotionConfig reducedMotion="user"`); no looping animation besides the pulse (disabled under reduced motion).
6. **Targets:** HUD/PiP controls ≥ 44×44px effective hit area (they live over fullscreen content); no interactive element below 32px logical.
7. **Text floor:** nothing below 12px (`label` is the floor); zoom-tolerant (no fixed-px text scaling traps).
8. **Surface labeling:** stable `aria-label`s per window/surface ("Record — ScreenStudio Pro"); tray menu items labeled, never bare glyphs.
9. **Error copy:** portal/encoder failures are translated to human paragraphs (our §5.2 pattern) — raw backend errors stay in the debug log only.

---

## 8. Token Governance (the "strictly" clause)

- Tailwind v4's `@theme` block is generated from §2–§4 and cites the contract: `/* DESIGN.md v2.0 */`. shadcn components restyle to token values only; hard-coded hex values outside this file are review failures.
- **The closed set:** 2 typefaces · 22 tokens per mode · 9 space steps · **6 radii** · 3 shadows · 4 motion tokens (plus 2 named compositions in §4.6) · 3 glass recipes · **6 fixed z-levels** (`base 0 · sticky 10 · overlay 40 · toast 50 · modal 60 · hud 70`). Nothing "missing" is invented — it's composed from these. An extension requires a PRD review and an entry here first.
- Both modes are built for real: dark default, light complete — never light-as-afterthought; both ship in every UI change.
- Version bump rule: any token change edits this file first, then imports, never the reverse.
- **v2.0 measured contrast audit (2026-11-17, WCAG 2.1 relative luminance):**
  - Dark: `text.primary` on canvas 17.47:1 · on raised 16.76:1 · on solid 15.89:1 · `accent` on canvas 9.4:1 · `accent.text` on `accent` 9.04:1 · signal 6.57:1 · success 12.41:1 · warning 12.43:1 · error 7.96:1.
  - Light: `text.primary` on canvas 17.17:1 · on solid 19.19:1 · `accent` on canvas 8.16:1 · `accent.text` on `accent` 9.12:1 · signal 4.97:1 · success 4.8:1 · warning 5.3:1 · error 5.8:1.
  - Secondary/disabled text ratios follow the §2 alpha over their ground; component-level checks happen at render time (§7). Re-run this table whenever a §2 value changes.
