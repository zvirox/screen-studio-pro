# docs — supporting context (not source of truth)

Contract files live at the repo root (priority order in [AGENTS.md](../AGENTS.md) §2).
This directory holds *supporting* artifacts referenced by the contracts.

| File | Purpose | Governed by |
|---|---|---|
| [`portal-support.md`](portal-support.md) | Compositor quirks matrix — how xdg-desktop-portal behaves per DE, manual QA results | TESTING.md §5, §7 |

## Branch protection (repo settings, not a file)

Per PLAN task 0.3, `main` should be protected once the remote exists:

- **Require pull request reviews** — off for a solo project, on when collaborators join
- **Require status checks:** `Rust (fmt · clippy · test)`, `Frontend (lint · typecheck · test)`
- **Require branches up to date** — on
- **Disallow force pushes / deletions** — on
