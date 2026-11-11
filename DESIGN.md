# DESIGN.md — ScreenStudio Pro Design System

**Version:** 1.0 · **Authority:** PRD.md (product scope) → PRODUCT.md (brand feel) → **this file (visual law)**
**Rule:** Every UI built later must follow this file strictly. Do not invent new colors or fonts outside it. To change a token, change it here first.

---

## 1. Brand Feel & Design Principles

**Feel:** frosted, floating, quiet-software. Translucent glass panels that sit *on* the user's wallpaper — Hyprland, niri, MangoWC, KDE. Calm while idle; expressive and alive the instant **Record** is pressed. The app should look like it was made for the desktop it's recording, not like a foreign dashboard imported from 2009.

**Principle 1 — Glass earns its keep.**
Translucency is used where it does a job (floating HUD, main panels, toasts — making the app feel light and at home on a riced desktop). Where reading matters most (settings forms, file tables, library grid rows), surfaces strengthen toward solid. Rules: glass layers always pair a tinted fill + `backdrop-blur` + a 1px inner border + a shadow, in one of the defined **Glass recipes** (§4.4); no blur without a supporting recipe. Anti-goal (PRD): frosted ≠ illegible — if a glass surface fails its contrast floor, it steps down to the solid equivalent (§7).

**Principle 2 — One accent, one signal.**
The UI is quiet neutrals plus a single accent (Aurora Teal) meaning exactly one thing: *the primary action available right now*. The signal color (Signal Red) means exactly one thing: *recording is live*, forever — it never decorates anything else, so when the user sees red, they know they're on air. Success/warning/error exist only as semantic feedback. Color as decoration is banned outside the two sanctioned delight moments (§6.5).

**Principle 3 — Motion is information.**
Every animation states a fact: "recording started," "settings saved," "panel appeared." 150–250ms, spring-based, one motion system (§4.6). No page-load choreography, no looping idle animation except the recording pulse.

---

## 2. Color

### 2.1 Strategy
**Restrained** (Operate mode floor): tinted neutral layers + one accent + semantic set. One sanctioned **Committed** moment: the live recording state, where Signal Red carries the HUD dot, timer accenting, and capture indicators.

### 2.2 Dark mode (default)
Dark is the default: the audience runs dark rices, and recording overlays live over bright, colorful content.

| Token | Value | Role |
|---|---|---|
| `bg.canvas` | `#0B0E13` | App background under all glass |
| `bg.raised` | `#10151D` | Opaque layer for settings forms, tables |
| `surface.glass` | `rgba(255,255,255,0.065)` | Glass panel fill (Pane recipe) |
| `surface.glass-strong` | `rgba(18,24,33,0.72)` | Strong glass — HUD, modals, toasts |
| `surface.solid` | `#151B26` | Cards resting on the canvas |
| `border.subtle` | `rgba(255,255,255,0.08)` | Hairlines, dividers |
| `border.glass` | `rgba(255,255,255,0.14)` | Inner border on glass layers |
| `text.primary` | `#ECF1F6` | Headings, body |
| `text.secondary` | `rgba(236,241,246,0.66)` | Labels, meta |
| `text.disabled` | `rgba(236,241,246,0.38)` | Disabled, inactive |
| `accent` | `#4FE3C6` | Primary actions, selection, active toggles |
| `accent.hover` | `#6EEBD5` | Accent hover |
| `accent.active` | `#2ECBA9` | Pressed/checked |
| `accent.text` | `#07271F` | Text/icons rendered on accent fill |
| `accent.muted` | `rgba(79,227,198,0.14)` | Selected rows, accent washes, hover zones |
| `signal` | `#FF5A66` | RECORDING LIVE. Never any other use |
| `signal.muted` | `rgba(255,90,102,0.16)` | Recording-state fills |
| `success` | `#5EE58A` | Confirmations |
| `warning` | `#FFC24B` | Encoder-fallback notices, caution |
| `error` | `#FF7A85` | Failures — always paired with icon + text |
| `error.muted` | `rgba(255,122,133,0.14)` | Destructive hover washes |

### 2.3 Light mode
| Token | Value |
|---|---|
| `bg.canvas` | `#E9EDF2` |
| `bg.raised` | `#F7F9FB` |
| `surface.glass` | `rgba(255,255,255,0.62)` |
| `surface.glass-strong` | `rgba(255,255,255,0.86)` |
| `surface.solid` | `#FFFFFF` |
| `border.subtle` | `rgba(13,20,29,0.08)` |
| `border.glass` | `rgba(255,255,255,0.9)` |
| `text.primary` | `#0F151D` |
| `text.secondary` | `rgba(15,21,29,0.64)` |
| `text.disabled` | `rgba(15,21,29,0.36)` |
| `accent` | `#0B8A72` |
| `accent.hover` | `#089A7E` |
| `accent.active` | `#076F5B` |
| `accent.text` | `#FFFFFF` |
| `accent.muted` | `rgba(11,138,114,0.12)` |
| `signal` | `#E5484D` |
| `signal.muted` | `rgba(229,72,77,0.12)` |
| `success` | `#1C8A44` |
| `warning` | `#9A6700` |
| `error` | `#D13438` |
| `error.muted` | `rgba(209,52,56,0.12)` |

### 2.4 Hard rules
- Never invent a color. No gradient fills outside §4.4's sanctioned specular highlight and §6.5's shutter flash.
- `signal` (recording) and `error` (failure) are told apart by context and icon, never by color alone — see §5.1/§5.6.
- Accent never colors body text, never decorates, never appears on inactive elements.

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

Scale ratio ≈1.15 between steps (Operate rule). No display face in labels, buttons, or data.

---

## 4. Foundations

### 4.1 Spacing scale (4px base)
`space.1=4 · space.2=8 · space.3=12 · space.4=16 · space.5=20 · space.6=24 · space.8=32 · space.10=40 · space.12=48`
Rules: inside a component use 2–3; between grouped controls 4; between panel sections 6–8; window side margins 6. Rhythm: more space above a heading than below it — section top `space.8`, heading-to-content `space.3`.

### 4.2 Radius
| Token | Value | Use |
|---|---|---|
| `r.xs` | 6px | Inputs, inline chips |
| `r.sm` | 10px | Buttons, selects, small cards |
| `r.md` | 14px | Cards, toasts, glass panels |
| `r.lg` | 20px | Floatovers: HUD, camera PiP, main window corners |
| `r.full` | 999px | Pills, segmented controls, PiP circle variant |

Expressive (glass softness) but consistent: a floating panel is always `r.lg`; an inline control never exceeds `r.sm`.

### 4.3 Shadows & elevation (soft, layered, never saturated)
| Token | Dark recipe | Light recipe | Use |
|---|---|---|---|
| `elev.1` | `0 1px 2px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.18)` | same in `rgba(13,20,29,0.12/0.10)` | Cards, popovers |
| `elev.2` | `0 2px 6px rgba(0,0,0,0.32), 0 12px 32px rgba(0,0,0,0.28)` | `.16/.18` mix | Modals, toasts |
| `elev.float` | `0 2px 8px rgba(0,0,0,0.35), 0 24px 64px -12px rgba(0,0,0,0.50)` | `.16/.28` mix | HUD, PiP frame |

### 4.4 Glass recipes (the only sanctioned blur treatments)
Every glass layer = fill + blur + border + shadow, exactly one recipe each:

| Recipe | Fill | Blur | Border | Shadow | Use for |
|---|---|---|---|---|---|
| **Pane** | `surface.glass` | `blur(20px) saturate(160%)` | `border.glass` 1px | `elev.1` | Main window panels, trays |
| **Float** | `surface.glass-strong` | `blur(28px) saturate(190%)` | `border.glass` 1px | `elev.float` | HUD, PiP, toasts, detached panels |
| **Modal** | `surface.glass-strong` | `blur(32px)` | `border.subtle` 1px | `elev.2` | Modals/drawers over a scrim of `rgba(0,0,0,0.4)` (0.24 light) + `blur(4px)` |

- Sanctioned extra: specular highlight — `linear-gradient(120deg, rgba(255,255,255,0.10), transparent 40%)` overlay, Float/Modal layers only.
- **Contrast floor:** every glass layer carries a `::before` scrim of `bg.canvas` at 55% opacity so text contrast holds over bright wallpapers. Part of the recipes, never optional.

### 4.5 Iconography & imagery
- **lucide-react** only, 1.5px stroke, 20px default (16px dense/inline). One style; no filled/blur variants, no icon mixing.
- Illustration (empty states, education slots): single-weight line work at `text.disabled` on `accent.muted` washes. No stock photos, no 3D blobs.
- Source previews show real frames from the live PipeWire stream only — never a fake gradient pretending to be the desktop.

### 4.6 Motion
- Tokens: `m.fast = 140ms ease-out-quart` · `m.base = 180ms spring(≈300, 24)` · `m.slow = 240ms spring(≈260, 20)` · `m.settle = 90ms ease-in`
- Hover/focus: color+fill on `m.fast`. Press: `scale(0.985)` settle.
- Enter: `y +6→0`, opacity 0→1 on `m.base`. Exit: reverse on `m.settle`; content never waits for exit motion to become readable.
- **Recording pulse:** the 10px `signal` dot breathes opacity 1→0.35→1 over 1.4s — the only infinite loop in the system; disabled under reduced motion.
- **Shutter** (delight moment §6.5): on stop, a `rgba(255,255,255,0.35)` overlay fades over the UI 240ms — once per session end, never repeated.
- Reduced motion (`prefers-reduced-motion`): transforms removed, opacity-only, ≤100ms.

---

## 5. Component Specs (all states: default / hover / focus / active / disabled / loading / error)

Built on shadcn/ui + Radix primitives, restyled to these tokens. Missing states = unfinished component. Universal focus ring: `0 0 0 2px <underlying ground>, 0 0 0 4px accent` — ≥3:1 against its surrounding, never suppressed.

### 5.1 Buttons
Variants: **primary** (accent fill, `accent.text` label; ≤1 per view), **secondary** (`surface.solid`, `border.subtle`, `text.primary`), **ghost** (transparent, `text.secondary`), **danger** (destructive only: delete recording, discard take; `error` border + text on hover fills `error.muted`), **icon** (40px squircle, ghost or secondary).
Sizes: `sm` 32px/r.sm · `md` 40px · `lg` 48px (Record button only). Label: `body-sm`, weight 500. Icon left, gap `space.2`.
- **hover:** primary→`accent.hover`; secondary/ghost→`accent.muted` wash; danger→`error.muted`
- **active:** primary→`accent.active`; all→`scale(0.985)`
- **focus:** universal focus ring
- **disabled:** fill `border.subtle`, label `text.disabled`, no hover legible
- **loading:** label swaps to spinner (14px, 2px stroke, 0.8s linear) + "Working…" with `aria-live="polite"`; width fixed, no layout shift
- **error:** never a button style — failures surface at the field/panel/toast level
- The Record start button is always primary, always 48px, layout `[lucide dot ●] Record`.

### 5.2 Inputs (text, search, settings fields)
Default: `bg.raised` fill, `r.xs`, `border.subtle`, 44px min height; label (`body-sm` 500) above, description (`body-sm` `text.secondary`) optional below; left icon optional.
- hover: border `rgba(255,255,255,0.16)` dark / `rgba(13,20,29,0.16)` light
- focus: ring + border `accent`; label turns `accent`
- error: border `error` + message line below (`body-sm`, `error`, alert-circle 14px); label stays neutral — error = color + icon + text, never color alone
- disabled: all `text.disabled`, fill `border.subtle`, read-only semantics
- Numeric fields: value in JetBrains Mono; unit ("Mbps", "fps") as `label` suffix. Required suffix is `*` in `text.secondary` with `title="required"`.

### 5.3 Select / Combobox
Trigger = input spec + chevron-down 16px. Popover = Modal glass recipe on `elev.2`, `r.sm`, max-height 320px with scroll shadows. Item 36px: hover `accent.muted` wash; selected = check (lucide, right, `accent`) + weight 500; focus ring on item. Radix keyboard behavior + typeahead. Error shows on the trigger, not the popover.

### 5.4 Checkbox · Switch · Radio
All keyboard-operable with the universal ring, states for hover/active/disabled/error (error = group message + ring on active controls).
- **Checkbox:** 18px, `r.xs`; checked = `accent` fill + `accent.text` check; label right, gap `space.2`
- **Switch:** 40×24 pill; on = `accent` track, off = `bg.raised` + `border.subtle`; knob white, `m.fast` translate
- **Radio:** in choice lists (container MKV/MP4/WebM); selected = 2px `accent` ring + 6px `accent` center dot

### 5.5 Cards & the recording library grid
- **Card:** `surface.solid`, `r.md`, `border.subtle`, `elev.1`, padding `space.4`. Interactive hover: border → `accent`-tinted, y −1px on `m.fast`; static cards hoverless.
- **Loading:** skeleton grid — shimmer `rgba(255,255,255,0.05)→0.09` 1.6s on `surface.solid` shapes; skeletons everywhere content loads, never spinners mid-page.
- **Error (missing file):** thumbnail persists + `signal.muted` overlay chip "File missing".
- **Recording item:** 16:9 thumbnail (`r.sm`), duration chip bottom-right (`mono-sm`, `rgba(0,0,0,0.5)` ground), name `body-sm` 500, meta row (`label`/`mono-sm`: date · size · fps · encoder). Hover reveals icon-action row: open, copy path, delete-danger. Click = detail drawer (§5.7). Nothing important hidden behind hover.

### 5.6 Toasts
Glass **Float** recipe, bottom-center stack, max 3, auto-dismiss 5s (6s with action). Anatomy: 18px lucide icon in its semantic color, title `body-sm` 500, description `body-sm` `text.secondary`, optional ghost action. Enter y+12/opacity on `m.base`; exit fade `m.settle`. `aria-live:` polite (status) / assertive (error). **Error toast:** alert-triangle icon, 2px `error` left border, persists until dismissed. The "Saved" toast includes duration (`mono-md`) and path (`mono-sm`) with a copy icon-button.

### 5.7 Modal & Drawer
Centered `<dialog>` portaled (overlays escape clipping containers, always). Session: Modal recipe, `r.lg`, max-width 480px; scrim closes + Esc; mandatory focus trap, restore focus on close. Drawer: right-slide 420px, same recipe. No nested modals, ever.

### 5.8 NavBar (window chrome)
52px bar, Pane recipe with `r.lg` top corners only. Left: app mark — 16px rounded square with centered `signal` dot under `text.primary-appropriate tint (r#) defined as accent in idle` — plus "ScreenStudio Pro" `body-sm` 500. Center: segmented pill control (`r.full`, 32px): **Record / Library / Stream(V2) / Settings** — active = `surface.solid` raise; Stream pill always disabled with `label` badge "V2" and tooltip "Streaming arrives in V2". Right: lucide sliders-horizontal (settings tray) + x (minimize to tray). We always render our own titlebar (custom CSD); native decorations off.

### 5.9 HUD (recording toolbar) — signature component
Float recipe, height 46px, `r.full`, padding-inline `space.3`, min-width 220px, draggable everywhere, corner-snap guides at 8px insets. Anatomy →: rec-dot (10px `signal` circle, pulse loop) · timer (`mono-md`, tabular) · pause · stop · flag icon-buttons.
- **rec (default above):** as described
- **paused:** dot becomes 22px `signal` square; timer shows "PAUSED" (`label` chip beside)
- **stop-hover:** stop scales 1.06, tooltip "Stop & save"
- **double-click:** pin (opacity 0.85, `elev.float` retained)
Must hold 4.5:1 text contrast over any content — the §4.4 scrim floor guarantees it.

### 5.10 Lists & tables (audio device lists, recordings path table)
Row 44px (dense 36px), `border.subtle` dividers; hover `accent.muted`; selected `accent.muted` + 2px inset `accent` left bar. Header `label`-uppercase/tracking 0.05em, `text.secondary`. Whole row is the click and focus target — focus ring on the row, never per-cell.

---

## 6. Screen Layouts (every MVP surface in PRD §5–7 — layouts are law)

**Window breakpoints (desktop):** `compact <720px` · `standard 720–1120px` · `wide >1120px`. Compact must always work (WM-resized windows). HUD/PiP/toasts are overlays and never reflow.

### 6.1 Record (main window)
Vertical stack, all idle-visible, nothing hidden behind "more":
1. **NavBar** (§5.8)
2. **Source deck** — Pane panel: three selectable chips **Monitor / Window / Region** (lucide monitor · app-window · scan), each with `mono-sm` capability line ("2560×1440 · 60fps"). Selected = `accent.muted` fill + `accent` border + check. Below chips: live preview frame (16:9, `r.sm`, `surface.solid` — the only place video frames may ever render) + region mini-canvas with draggable rect (dnd-kit) + `mono-sm` rect values.
3. **Audio strip** — Pane panel: two channel cards (Mic / Desktop): device name `body-sm`, level meter 4px bar (`accent` fill; peak segments `signal` above −6dB), per-channel switch, device-select popover.
4. **Camera slab** — live PiP preview inline when enabled; otherwise ghost "Add camera" chip (lucide video).
5. **Action row** — full-width primary **Record** (48px) · quality preset select left (plain language: "For YouTube — 1080p60") · encoder chip right (`mono-sm`: VAAPI/NVENC/x264; x264 shows warning-state inline notice with zap-off icon: "Falling back to CPU encode").
6. **Stats line** (task 3.5, recording-state only) — one `mono-sm` tabular line under the action row while a take is active: fps · dropped · bitrate · encode time (e.g. "59.8 fps · 0 dropped · 12.1 Mbps · 5.2 ms"), fed by `recording/stats` at its 0.5 Hz cadence. Not rendered when idle — state-driven visibility, not hidden content. Values use existing tokens only; no new chip anatomy.
Compact: source chips become a segmented control; audio strip horizontal-scrolls; action row sticky bottom.

### 6.2 Library
NavBar → Library. Header: `display.md` "Recordings" · search (max 320px) · sort select · space grouping. Grid: 4/3/1 columns (wide/standard/compact) of §5.5 items. First 50 shown; "Show more" secondary button — no infinite scroll in MVP. Card click = detail drawer with large thumb, full meta table (mono values), `Reveal in file manager` secondary action, `Trim later` disabled with tooltip "Planned for V2". Empty state: §6.3. States: empty/loading-skeleton/error-with-retry designed from day one.

### 6.3 Empty & education states (teach the interface, never say "nothing here")
- **Library empty:** single-stroke frame illustration + heading "Nothing recorded yet" + body "Choose a source on the Record tab, then hit Record. Your clips will land here." + ghost "Go to Record".
- **Preview not yet granted:** `text.disabled` monitor icon centered in the preview frame + label "Click Monitor to allow capture through your compositor" — the first-run education slot.
- **Search empty:** "No recordings match “<query>”" + ghost "Clear search".
- **Audio silent:** meter idle at 0 with label "Speak to test your mic level".

### 6.4 Settings
NavBar → Settings. Left rail 200px (compact: horizontal pills): Capture / Audio / Camera / Files / Shortcuts / About — 16px lucide icons + `label` text; active = `accent.muted` + accent text. Content: `bg.raised` (Principle 1 — forms strengthen to solid), max-width 560px. Every row: label (`body-sm` 500) + description (`body-sm` secondary) + control right-aligned; presets in plain human language ("For Discord — 720p30, ~6 Mbps") per PRD. About tab: version (`mono-sm`), licenses, GitHub link, logo at `r.lg`.

### 6.5 Recording session flow (the signature experience)
1. Record pressed → button shows loading spring briefly → window minimizes to tray → **HUD appears** (float spring, bottom-right 24px margin) → rec-dot starts pulsing.
2. Mid-session: HUD per §5.9. Toast "Recording started" is **never shown** — the HUD already says it; no double-telling.
3. Stop → **shutter flash** (240ms, once) → HUD vanishes (settle exit) → "Saved" toast with duration + path + Reveal/Copy → window re-focuses on Library, new recording row highlighted with a 1.2s `accent.muted` fade-out.
4. Flag keypress drops a chapter marker (PRD M-flow): brief tick appears on the timer chip — silent, non-blocking.

### 6.6 Camera PiP
Float recipe circle or rounded-rect (`r.full`/`r.lg` toggle), 160–320px, draggable with corner-snap guides, `elev.float`, 1px `border.glass` ring, 2px `signal` ring while recording is live. Hover controls: camera-off freeze (preview only), resize handle 44px, drag everywhere else. Whether it composites into the output is an explicit "self-insert" toggle in Camera settings — default off.

---

## 7. Accessibility (hard law, checked per release)

1. **Contrast:** ≥ 4.5:1 for text on its real composited background (glass recipes' scrim floor exists for this); ≥ 3:1 large text and UI boundaries; `accent.text` on `accent` ≥ 8:1 as tokenized. Icon-only controls need the ring-visible icon + `aria-label`.
2. **Focus ring:** universal, never suppressed; 4px total, geometry + color redundancy; tab order = DOM = visual order; Esc closes floatovers; modals trap and restore focus.
3. **Keyboard:** everything reachable without pointer; segmented nav = arrow-key roving; selects follow Radix; HUD controls fully tabbable cyclically; region overlay adjustable by arrows (1px, shift = 10px).
4. **Color independence:** recording/paused/success/error always pair color with icon + shape change + text (rec-dot vs 22px square; alert-triangle; check). Never color-only.
5. **Motion:** honor `prefers-reduced-motion` (§4.6); no looping animation besides the pulse (disabled under reduced motion).
6. **Targets:** HUD/PiP controls ≥ 44×44px effective hit area (they live over fullscreen content); no interactive element below 32px logical.
7. **Text floor:** nothing below 12px (`label` is the floor); zoom-tolerant (no fixed-px text scaling traps).
8. **Surface labeling:** stable `aria-label`s per window/surface ("Record — ScreenStudio Pro"); tray menu items labeled, never bare glyphs.
9. **Error copy:** portal/encoder failures are translated to human paragraphs (our §5.2 pattern) — raw backend errors stay in the debug log only.

---

## 8. Token Governance (the "strictly" clause)

- Tailwind v4's `@theme` block is generated from §2–§4 and cites the contract: `/* DESIGN.md v1.0 */`. shadcn components restyle to token values only; hard-coded hex values outside this file are review failures.
- **The closed set:** 2 typefaces · 22 tokens per mode · 9 space steps · 6 radii · 3 shadows · 4 motion tokens · 3 glass recipes. Nothing "missing" is invented — it's composed from these. An extension requires a PRD review and an entry here first.
- Both modes are built for real: dark default, light complete — never light-as-afterthought; both ship in every UI change.
- Version bump rule: any token change edits this file first, then imports, never the reverse.
