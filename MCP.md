# MCP.md — Connecting AI assistants to tools (Model Context Protocol)

**Version:** 1.0 · **Rulebook:** every session follows [AGENTS.md](AGENTS.md); this file governs *how* assistants get tool access, at least privilege.
**Golden rules:** read-only by default · never real keys in any file — environment-variable placeholders only · destructive actions require explicit human confirmation, every time, even once the assistant has been told "yes" earlier.

---

## 1. Which servers this project needs (and why)

| Server | Why this project needs it | Status |
|---|---|---|
| **filesystem** | Read the contract files (PRD/DESIGN/ARCHITECTURE/DATABASE/API/PLAN/FEATURES) and source code; write docs. | Core |
| **sqlite** | Inspect `library.db` during development: verify migrations (DATABASE §8), audit soft deletes, check seeds | Core (dev only) |
| **github** | Issues/PR `good first issue` triage, PR checks on `ci.yml`, release artifacts verification (PLAN 7.5) | Core |
| **browser** | Review DESIGN.md mockup sheets and UI previews (KDE/vite proceeding pending), prefer the built-in Review pane when available | Optional |
| **docs (context7)** | Look up exact API of fast-moving deps (`ashpd`, `pipewire-rs`, `ffmpeg-next`, Tauri 2, React 19) without stale training data | Recommended |

**Deliberately NOT configured:** any cloud-hosted DB, Slack/Discord, generic shell/proxy hubs — least privilege: every server on this list maps to an actual AGENTS.md workflow; nothing speculative.

---

## 2. Configuration snippets

> Format below is the generic JSON/TOML note used by MCP hosts; adjust the host-specific syntax (e.g. opencode `opencode.json` `["mcp"]`, Claude Desktop `mcpServers`) but keep the *arguments and env contracts* exactly as written. **Placeholders only — never commit real tokens.**

### 2.1 filesystem (repo-scoped, write-limited to docs)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y", "@modelcontextprotocol/server-filesystem",
        "/home/you/Projects/screen-studio-pro"
      ],
      "env": {}
    }
  }
}
```
Why scoped: the single argument is the **entire** reachable tree — the repo only. Backups: keep the path exact; `~` must be expanded by your host, not passed.

### 2.2 sqlite (dev library database)
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": [
        "-y", "@modelcontextprotocol/server-sqlite",
        "--db-path", "${SSP_DATA_DIR}/screen-studio-pro/library.db"
      ],
      "env": { "SSP_DATA_DIR": "${SSP_DATA_DIR}" }
    }
  }
}
```
Dev-only. **Blocked in CI and releases:** the MCP server never runs on end-user machines — features touching SQLite go through the app's own `rusqlite` pipeline (ARCHITECTURE §4), never via assistant writers.

### 2.3 github (repo-fenced, token via env placeholder)
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
        "GITHUB_REPOS": "zvirox/screen-studio-pro"
      }
    }
  }
}
```
Token scope must be minim: `repo:issues`, `repo:pull_requests` write on **this repo only**; no `delete_repo`, no org scopes, no `workflow` scope unless explicitly needed for a release task and asked for first.

### 2.4 browser (mockups / UI preview only)
```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
      "env": {}
    }
  }
}
```
Allowed targets: `http://localhost:1420` (Vite dev preview), `file://` paths inside the repo (mockup sheets). **Never** the assistant's credentials or any account-bearing page in a browser the agent drives.

### 2.5 docs (context7 — current API hooks for FastAPI-independent deps)
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {}
    }
  }
}
```
Used to resolve crate/API truth for `ashpd`, `pipewire-rs`, `ffmpeg-next`, Tauri 2, React 19 — because training-data lag is a real defect source in the AGENTS verification rule (`cargo` compile tells the truth; docs get close).

---

## 3. Tool allowlist / blocklist (least privilege per server)

| Server | ✅ Allowed tools | 🚫 Blocked / require confirm |
|---|---|---|
| filesystem | `read_file`, `read_multiple_files`, `list_directory`, `directory_tree`, `search_files`, `get_file_info`, `list_allowed_directories` | `write_file`/`edit_file` → allowed only for contract docs + `docs/**` + test fixtures; **any other write needs a stated file plan first** · `move_file`, `create_directory` (outside contract dirs) → confirm · any deletion → confirm, always |
| sqlite | `list_tables`, `describe_table`, `read_query` (`SELECT`) | `write_query`/`create_table`/`alter_table` → allowed **only** when producing/editing a numbered migration (DATABASE §8) **with the user's explicit OK per task** · `drop_table` → never (soft delete exists; dropping is a migration-file change) |
| github | `get_issue`, `list_issues`, `search_issues`, `get_pull_request`, `list_pull_requests`, `get_pull_request_status`, `get_file_contents`, `list_commits` | `create_issue`/`create_pull_request` → allowed for assistant-authored fixes; `merge_pull_request` → **human only, always** · any release-to-main action → human · `add_issue_comment` → fine; mass-open (bulk comment) → confirm |
| browser | `navigate`, `screenshot`, `click`, `get_text` on allowed targets only | anything requiring OAuth/login sessions; download execution; typing into forms with real credentials — never |
| context7 | `resolve-library-id`, `get-library-docs` | none — read-only by nature |

**Session-level rules (AGENTS.md §4 cross-applied):**
1. Read-only default: if a destructive tool could be replaced by returning analysis to the user, do that instead.
2. Confirm-before-destructive: any of — file deletion, `sqlite` writes outside migration tasks, DB reset (`rm` library.db in SETUP.md §3.3), git history changes, force pushes, `gh pr merge` — needs a fresh, explicit human "yes" in the current session.
3. Key hygiene: tokens are `${ENV_VAR}` placeholders resolved by the *host*, never stored in files; never echo token values into logs, summaries, or PRs; a leaked/discovered secret is reported to the user immediately (AGENTS §4.5).
4. Escalation on demand: when a task legitimately needs a blocked tool, the assistant *describes the exact call + why*, asks, and waits — it does not attempt the blocked call.

---

## 4. Testing each connection (paste-run checks)

| Server | Test (single command or tool call) | Success looks like |
|---|---|---|
| filesystem | `list_allowed_directories` | Returns exactly `["/home/you/Projects/screen-studio-pro"]` |
| filesystem (write scope) | Try `write_file` on `AGENTS.md` (no-op line then revert, **with user OK**) or a scratch `docs/tmp-readcheck.md` | Write succeeds only inside allowed paths; attempts outside fail with permission error |
| sqlite | `list_tables` | Shows `recordings`, `ui_prefs` (after first app boot; before boot returns "no such file" — see §5.4) |
| sqlite (read) | `SELECT COUNT(*) FROM ui_prefs;` | ≥ 7 rows (DATABASE §7.1 seed) |
| github | `get_file_contents` path `README.md` on `zvirox/screen-studio-pro` | Returns the current README content |
| github (token floor) | `list_pull_requests` state=#{open}` | 200, listing works; a **write** op attempted without approval fails per §3 |
| browser | `navigate` → `http://localhost:1420` while `npm run tauri dev` runs despite no backend yet, vite alone serves | Screenshot returns, page title matches app dev page |
| context7 | `resolve-library-id` for `"tauri"` | Returns list incl. current Tauri 2 lib id |

Add these checks to onboarding when a new contributor configures MCP for the first time; they take under two minutes.

---

## 5. Troubleshooting common connection errors

1. **`server filesystem: directory not a directory / ENOENT`** — the path arg uses an unexpanded `~` or a moved repo path.
   → Put the absolute path in the args; verify with `ls /home/you/Projects/screen-studio-pro` from the same shell your host spawns tools in.
2. **sqlite: `unable to open database file`** — `SSP_DATA_DIR` env placeholder didn't expand in the host, or the app hasn't booted once yet (DB is created at first boot, SETUP §3.3).
   → Boot the app once; then point `--db-path` at the literal file path as a test: `ls ~/.local/share/screen-studio-pro/library.db`.
3. **sqlite: `database is locked`** — the dev app is running (WAL single-writer per ARCHITECTURE §6).
   → Expected; read the app's copies through `read_query` (WAL readers work) and avoid write tools while `tauri dev` is live.
4. **github: `Bad credentials / 401`** — `${GITHUB_TOKEN}` not present in the host's environment or pasted with quotes/whitespace.
   → `gh auth status` sanity check; re-export the real token in the *host's* launch environment, never in a file (§3.3).
5. **github: `404 Not Found` on a repo you own** — token lacks `repo` read on a private repo or `GITHUB_REPOS` fencing excludes it.
   → Widen only to this one repo; keep the fence (least privilege beats convenience).
6. **browser: page loads blank on `localhost:1420`** — Vite isn't running (`tauri dev` down or crashed, or PLAN Phase 0 hasn't landed yet).
   → Start `npm run tauri dev`; if scaffolding doesn't exist yet, that's expected — browser review is pending until then (README status).
7. **context7: `no results / rate limited`** — network egress blocked (CI sandbox, VPN rules) or out-of-quota.
   → Retry later or read the vendored docs; do not pin a copy inside the repo (docs freshness is its value).
8. **sandboxed shells can't bind ports/portals** (browser tools) — host sandbox blocks socket open.
   → Launch the host through the least-sandboxed path available for the session; note it in session notes; don't fight it per-call.
9. **Host "sees" the server but tools return `tool not allowed`** — you gated allowed tools in your host's narrower allowlist (a good thing) but forgot to include the read tools you need now.
   → Re-check §3's allow column; adjust the host config, not the MCP server's builtin auth.
10. **Everything disconnects after a reboot / after suspending the IDE** — many hosts drop MCP stdio sessions on shutdown rather than reconnect.
    → Restart the host's MCP session; long-lived server processes are the host's responsibility, not the repo's.

---

## 6. Change control for this file

Adding, removing, or re-scoping a server follows the same law as the other contracts: **edit this file first** (AGENTS §6), name the workflow it enables (which AGENTS/PLAN task needs it), then configure the host. A server nobody can name a task for gets dropped.
