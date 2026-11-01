# AGENTS.md — Rules for AI coding assistants working in this repo

This file is the first thing any AI assistant reads. It binds every session, every task, no exceptions for "small changes."

---

## 1. Project Summary (5 lines)

1. ScreenStudio Pro is an open-source screen recording app for Linux (Wayland-first), built to give riced-desktop users (Hyprland, niri, MangoWC, KDE) a modern-looking alternative to OBS.
2. Current MVP scope: recording only — monitor/window/region capture, mic + desktop audio, webcam PiP, floating HUD, hardware encoders (VAAPI/NVENC/x264), MKV→MP4 output, library of recent recordings. Streaming and scenes are V2, not now.
3. Architecture: Tauri 2 desktop app — Rust core does all capture/encode (PipeWire, portals), React webview renders UI only and never touches video frames.
4. The visible UI follows a strict frosted-glass design system with a closed token set (dark default, light secondary).
5. No servers, no cloud, no HTTP APIs, no telemetry — distro packages + GitHub Releases are the entire distribution.

## 2. Source-of-Truth Files (priority order)

Read the one that governs your change — lower-numbered wins every conflict:

| Priority | File | Governs |
|---|---|---|
| 1 | **PRD.md** | Scope: MVP/V2/Later, non-goals, success metrics |
| 2 | **DESIGN.md** | All visual law: tokens, components, layouts, accessibility |
| 3 | **ARCHITECTURE.md** | Structure: stack, folder tree, data flow, state/error law |
| 4 | **DATABASE.md** | SQLite schema, indexes, migrations |
| 5 | **API.md** | The IPC contract: every command, event, error code |

Supporting context (not source of truth, read when relevant): `PRODUCT.md` (brand context), `docs/portal-support.md` (compositor quirks).

Also binding: `PRAGMA` note — behavior changes that alter any contract file must edit that file **in the same task**, before or together with the code.

---

## 3. DO — Required in every change

1. **Follow the folder structure** in ARCHITECTURE.md §2 exactly. Logic goes where the tree says (`capture/`, `encode/`, `pipeline/`, `library/` on the Rust side; `components/<view>/` on the React side). A "tiny" business-logic file placed outside the tree is a wrong file.
2. **Reuse existing components and systems first.** Before writing any UI control, check `components/ui/` and DESIGN.md §5 — a second button style is a defect. Before writing Rust logic, check whether a sibling module already has the trait or helper (e.g., `Encoder`, error variants).
3. **Write small focused functions.** One purpose per function; Tauri command handlers stay thin (validate → delegate) per ARCHITECTURE §2 tree rules. No 300-line handlers, no god components.
4. **Comment complex logic** — the *why*, never the *what*. Any non-obvious choice (event throttling rates, backpressure policy, remux ordering) cites its governing section (e.g., `// ARCHITECTURE §6: drop preview frames before encode frames`). Leave the codebase more readable than you found it.
5. **Handle errors and loading states in every path you touch.** Every Rust failure returns a typed `CoreError`; every IPC error is the standard shape from API.md §1; every UI view renders empty/loading/error states (DESIGN §6.3, §5.5). Shipping a screen that can't fail gracefully is shipping it broken.
6. **Keep the contracts type-complete:** when you change a payload, update `types/ipc.ts` and `lib/ipc.ts` together with `src-tauri/ipc/`; new error codes get added to API.md §1's list; SQL changes carry a numbered migration file (DATABASE §8).
7. **Verify before you claim it works.** Run `cargo fmt && cargo clippy -D warnings` in `src-tauri/`, `tsc --noEmit` (strict) and lint in `src/`, run the tests you added, and report real command output. Never announce success without evidence.
8. **Design-law provenance:** Tailwind `@theme` carries the `/* DESIGN.md vX.Y */` comment; tokens referenced by name only — computed hex/px literals in components are review failures (DESIGN §8).

## 4. DO NOT — Hard limits

1. **Do not change the tech stack** — Tauri 2 + React 19 + Rust is decided. No Electron proposals, no Svelte rewrite, no "officially recommend sqlite-wasm" sidebars.
2. **Do not add new libraries without asking.** If a dependency seems necessary, stop and ask; list the candidate, its maintenance state, and what it replaces. Vendored duplicate logic < one small dependency < asking first.
3. **Do not modify the database schema without updating DATABASE.md in the same change.** Schema edits are migration-file edits in order (DATABASE §8); no ad-hoc `CREATE TABLE` in code, no column edits in history, `updated_at` required on mutations.
4. **Do not delete or rewrite working code unless the task asks for it.** "While I'm here" cleanup refactors are scope violations. Reading, editing around, and preserving working behavior is the default; propose refactors as tasks, don't execute them silently.
5. **Do not hardcode secrets — there are none to hardcode.** No API keys, no tokens, no credentials; env vars are the documented list in ARCHITECTURE §5.3 only. Any discovered secret goes to the user immediately, never committed.
6. **Do not invent colors, fonts, spacing, radii, shadows, or event rates outside DESIGN.md/ARCHITECTURE.md token sets.** "Just this once" teal is how every design system dies.
7. **Do not cross the IPC with media:** video frames/bytes never flow through command payloads or events (API.md §6 standing flags). Previews are stills at the documented cadence only.
8. **Do not implement V2 features early.** No scene compositor, no RTMP, no editor, no plugin API, no speculations. V2 seams already exist in the code where named (Encoder trait, composite stage, `kind` column); write nothing beyond those.
9. **Do not ship raw backend error strings to the UI.** Human copy (DESIGN §7.9 pattern) is rendered; causes go to tracing logs only.
10. **Do not skip accessibility.** Full states, real focus rings, keyboard reachability, reduced-motion compliance, `aria-label`s — per DESIGN §7, enforced per change.

## 5. Workflow (every task, in order)

1. **Read before writing.** Relevant source-of-truth sections plus the files you're changing. If the task is unclear, ask — never guess between two readings of the same instruction.
2. **Plan first, briefly.** State which contract files govern the change, the files you'll create/modify, and the verification commands you'll run. For anything beyond a one-file fix, wait for the user's OK on that plan.
3. **Then code** the smallest change that fully satisfies the task, following DO/DO NOT above.
4. **Verify** (run the commands; show real output; two rounds of visual inspection if UI changed).
5. **Then explain what changed in a short summary:** files touched, contract files updated (or "none"), verification evidence, anything the user should double-check. Short means short — no novel-length recaps.

Commits stay small, `ci.yml` stays green, and the contract files' version bumps follow their own governance rules (DESIGN §8, API §5, DATABASE §8).

## 6. Conflict Rule (the stop-and-ask rule)

**If a request conflicts with any source-of-truth file — stop and ask the user before proceeding.**

Examples: adding an HTTP endpoint (violates ARCHITECTURE/API), adding a purple accent (violates DESIGN), a scenes feature in MVP (violates PRD non-goals V-time), a schema tweak without DATABASE.md (violates DATABASE), a new dependency without approval (violates §4.2 of this file).

Say: *"This conflicts with `<file> §<section>: <what>. The request needs either a contract change or a different approach — which do you want?"* Never silently reconcile by editing the code "just to match the user." The contracts were written deliberately; changing them is the user's call, made explicitly, in the contract file, before the code follows.

One narrow exception: if the user explicitly overrules and acknowledges both the conflict and its consequence in their own words, update the governing file first, then implement — the file is always updated in the same task as the code, never after, never not at all.
