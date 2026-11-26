# docs — supporting context (not source of truth)

Contract files live at the repo root (priority order in [AGENTS.md](../AGENTS.md) §2).
This directory holds _supporting_ artifacts referenced by the contracts.

| File                                     | Purpose                                                                             | Governed by       |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | ----------------- |
| [`portal-support.md`](portal-support.md) | Compositor quirks matrix — how xdg-desktop-portal behaves per DE, manual QA results | TESTING.md §5, §7 |

## Work planning

`PLAN.md` at the repo root is the source of truth for work order. Its **Current status & remaining work register (2026-11-25)** is the single list of open work; do not duplicate it in this directory.

Current baseline: `v0.1.0-beta.1` with `DESIGN.md` v6.0 locked. The register tracks the alpha closer gates (Phases 7.4–9), beta track (Phases 10–14), stable GA (Phase 15), residual human/live gates, and the CI gap for `check:linear`.

## Branch protection (repo settings, not a file)

Per PLAN task 0.3, `main` should be protected once the remote exists:

- **Require pull request reviews** — off for a solo project, on when collaborators join
- **Require status checks:** `Rust (fmt · clippy · test)`, `Frontend (lint · typecheck · test)`
- **Planned status check:** `Linear UI (check:linear)` once the job is added to `.github/workflows/ci.yml` (tracked in `PLAN.md`'s remaining-work register)
- **Require branches up to date** — on
- **Disallow force pushes / deletions** — on
