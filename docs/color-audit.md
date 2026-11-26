# Color Migration Audit

**Design contract:** `DESIGN.md` v6.0  
**Scope:** UI color tokens and component color roles only; layout, spacing, geometry, interactions, and media behavior are unchanged.

## Token ownership

- `src/styles/linear-theme.css` is the shared dark/light palette. It is byte-identical to `/home/zvirox/Downloads/linear-theme.css`; `cmp` returned `0`, and both SHA-256 digests are `8f939da3eb48b2f04a80b5bc2f85c45a8ed2794cfc267744c32e8e5fae47d0f4`.
- `src/styles/recording-tokens.css` contains ScreenStudio Pro’s recording-only Burgundy and Signal Red roles, plus the existing white Record-button foreground.
- `src/tailwind.css` contains the Tailwind utility bridge and non-color design tokens; it no longer owns palette values.

## Migration findings

| Area | Finding and result |
|---|---|
| `src/tailwind.css` | The old inline palette moved to the token files. Semantic Tailwind roles now map surfaces, active/hover states, track, text, blue focus, primary actions, recording controls, errors, and the shared card shadow. The app mark uses the general blue role, not recording Burgundy. |
| Primary and recording actions | General primary buttons use the theme-specific primary pair. Record and Stop CTAs use the recording-only Burgundy fill; Signal Red remains on live indicators, timers, and the camera recording border. |
| Record, library, settings, and chrome components | Hover and selected states now distinguish `--bg-hover` from `--bg-active`; track, sidebar, nested surface, and status-chip roles use their dedicated tokens. The close-hover foreground uses theme-aware `--text`, per the user’s choice to keep the shared stylesheet byte-identical. |
| `src/components/linear/echarts-linear-theme.ts` and `src/components/record/TelemetryDeck.tsx` | Inline tooltip shadow and legacy color reads were replaced with CSS-token reads. Gridlines use `--chart-grid`; FPS/drop areas use the approved chart fades; the encode donut uses blue/sky series. The existing theme-change rebuild remains in place. |
| `scripts/check-linear.mjs` | Checks app TS/TSX/CSS, tests, `index.html`, and `hud.html` for raw colors outside the two token files, forbidden palette utility classes, retired values, disallowed alpha/shadow usage, and the existing design-law violations. Test fixtures are excluded only from structural CSD/pill checks; color checks still apply. |

## Verification

- Passed `npm run check:linear`, `npm run typecheck`, `npm run lint`, `npm test` (320 tests across 35 files), and `npm run build`.
- Passed Rust `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test` (166 passed, 5 ignored).
- `git diff --check` passed; the shared stylesheet compares byte-for-byte with the supplied reference.
- Inspected one native Tauri screenshot of the light Record view at 1280×800; no obvious clipping or palette mismatch was visible.
- Not verified: pre-change baseline screenshot, dark theme, 1024×640, Library/Settings screens, or interactive keyboard states. Firefox outside Tauri shows the expected core-connection `BootError`; native Wayland keyboard automation was unavailable, and a second active-window capture did not target the app.

The production build succeeds with Vite’s non-fatal warning that the main bundle exceeds 500 kB. The test run also emitted non-fatal React `act(...)` warnings.

## Remaining fixed-color assets

The following stock SVGs are unreferenced by app HTML or TS/TSX/CSS and were left unchanged:

| File and line | Finding |
|---|---|
| `public/tauri.svg:2–5` | Fixed colors in the unused Tauri starter mark. |
| `public/vite.svg:1` | Fixed gradient colors in the unused Vite starter mark. |
| `src/assets/react.svg:1` | Fixed color in the unused React starter mark. |

The referenced binary branding assets `public/logo.png`, `src/assets/screen-studio-pro-logo.png`, and `public/favicon.ico` are also unchanged as required.

The SVG and binary assets are not scanned by `check:linear`; all rendered app UI source and the HTML entrypoints are covered.