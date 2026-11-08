# API.md — ScreenStudio Pro IPC Contract

**Version:** 1.3.0 · **Authority chain:** PRD.md (features) → ARCHITECTURE.md (§3/§4 IPC law) → this file (the full surface)

**Contract nature (read first):** ScreenStudio Pro has **no HTTP server and no network API** — PRD non-goal N6 and ARCHITECTURE §3.3 forbid it. The app's entire API surface is the **Tauri IPC**: *commands* (request/response, like REST) and *events* (push, like webhooks in reverse). This file documents that surface in REST-style conventions so it can be reviewed the same way: every command has a purpose, payload schema, success shape, and every error code the frontend may receive.

**Node conventions:** commands are `snake_case`, addressed as `cmd://<name>`; events are `domain/verb`, addressed as `evt://<topic>`. "Auth" below means *Tauri capability allowlist* (which webview windows may invoke it) — the app has exactly one implicit role: `app` (local user). There is no auth server, no tokens, no roles beyond that.

---

## 1. Standard Error Format (used everywhere, no exceptions)

Every error response — command failure or `error` event payload — is one shape:

```json
{
  "kind": "portal",
  "code": "portal.denied",
  "retryable": false,
  "userMessage": "Screen capture permission was declined. Click a source to try again.",
  "details": null
}
```

| Field | Type | Rules |
|---|---|---|
| `kind` | `portal \| encoder \| pipewire \| capture \| disk \| settings \| ipc` | Error family; maps to `CoreError` variants (ARCHITECTURE §4.2) |
| `code` | `string` | Stable, machine-matchable: `resource.path`, lower_snake. Codes are only ever added, never renamed |
| `retryable` | `boolean` | Tells the UI whether to offer a Retry action |
| `userMessage` | `string` | Human copy, DESIGN §7.9 vocabulary — UI renders **only** this; raw errors stay in the tracing log |
| `details` | `object \| null` | Optional structured extras (encoder chain attempted, free bytes, compositor name) |

**Canonical error codes (initial set):** `portal.unavailable`, `portal.denied`, `portal.timeout`, `portal.busy` · `encoder.unavailable`, `encoder.init_failed`, `encoder.encode_failed`, `encoder.fallback_applied` · `pipewire.stream_lost`, `pipewire.audio_device_gone`, `pipewire.audio_enum_failed` · `capture.region_invalid`, `capture.camera_unavailable`, `capture.invalid_kind` · `disk.no_space`, `disk.write_failed`, `disk.path_unwritable` · `settings.invalid_value`, `settings.schema_mismatch` · `ipc.contract_mismatch`, `ipc.unknown_command`, `ipc.bad_state`. *(Set is add-only; codes exist before their UI surfaces them.)*

*(Additions since v1.0.0: `portal.busy` — §2.1 always intended it ("a session is already active — code added to canonical set §1") but the list above missed it; corrected at task 1.1. `capture.invalid_kind` — added at task 1.1 for window/region kinds before their portal flavours land (M2/M3). Codes are add-only (§1 rule). `capture.no_frames` — added at task 1.5: a stop that encoded zero frames fails loudly instead of finalizing an unreadable header-only container; the partial file is removed, retryable=true (§2.4). **v1.1.0 (task 2.3, MINOR — additive):** `cmd://recording_pause` + `cmd://recording_resume` went live, and `recording/tick`'s `state` carries the real phase (`paused` when the take is paused, previously pinned to `"recording"`). No existing command/event/error changed shape.)*

Error → HTTP-style severity mapping for the UI: `retryable=false` + `disk.*`/`portal.denied` → persistent toast (DESIGN §5.6); all others → inline field/panel error per §5.2 or auto-fallback per §6.1.

**v1.2.0 (task 2.6, MINOR):** adds `window_hide`, `shell/error`, and
`ipc.window_failed`, `ipc.tray_unavailable`, `ipc.task_failed` (all kind `ipc`).
Window/HUD failures keep recording controls reachable. Native tray actions use
the same recording operations as commands; failures restore the main window.
Quit drains the take and commits its library row before exit. Failed index
writes retain the finalized outcome for retry by Stop or Quit and prevent a
new take from replacing it. Existing command/event payloads keep their shapes.

**v1.3.0 (task 3.1, MINOR):** `cmd://source_select` now accepts `kind: "window"`
(M2) alongside `"monitor"` — the portal's `SourceType::Window` picker is used.
Unsupported compositors hide the Window chip; `portal.windowCapture` in
`system_capabilities` reports availability. No existing payload shapes change.

---

## 2. Commands by Resource

Legend: **PRD** = feature ID it serves (M = MVP, V = V2 seam exercised) · **DB** = table it touches (`R` = recordings, `P` = ui_prefs, `—` = no table: TOML settings / in-memory portal state). **Flag column: `✓` = maps to both a PRD feature and a DB table; `⚠` = maps to a PRD feature but no table (expected for pipeline/runtime state); `⚑ FLAG` = would be suspicious if it stay unmapped across releases.**

### 2.1 Sources (capture origin)

#### `cmd://source_select`
- **Method:** command (req/resp) · **PRD:** M1/M2/M3 · **DB:** — · **Flag:** ⚠
- **Purpose:** begin a portal session for a source kind; returns live capability info and preview channel handle. Compositor consent dialog fires on first use per session.
- **Auth/capability:** `app` (allowed from main window only)
- **Request headers:** none (IPC). Request body:
```json
{ "kind": "monitor", "target": "output-1" }
```
`kind ∈ monitor | window | region`; `target` is monitor id / window handle / null (region overlays the chosen monitor).
*(Task 1.1 note: `monitor` is live; `window` is live since M2 (task 3.1); `region` returns `capture.invalid_kind` until M3 portal flavour lands. For `monitor`/`window`, `target` is accepted but deferred — the portal picker owns output choice until the restore-token flow.)*
- **Success 200:**
```json
{
  "sourceId": "src_01HV3…",
  "kind": "monitor",
  "label": "Monitor 1 (2560×1440)",
  "capabilities": { "fps": 60, "width": 2560, "height": 1440, "cursor": true, "region": true },
  "preview": { "mode": "stills_jpeg", "fps": 8 }
}
```
- **Errors:** `400`-class `capture.region_invalid` (rect out of bounds) · `403`-class `portal.denied` · `503`-class `portal.unavailable`, `portal.timeout` · `409`-class implied conflict: `portal.busy` (a session is already active — code added to canonical set §1)

#### `cmd://source_region_set`
- **Method:** command · **PRD:** M3 · **DB:** — · **Flag:** ⚠
- **Purpose:** set/adjust the crop rect for region mode (arrow-key adjustable, DESIGN §7.4).
- Body: `{ "sourceId": "src_01HV3…", "rect": { "x": 120, "y": 80, "w": 1280, "h": 720 } }`
- **Success 200:** `{ "ok": true }` · **Errors:** `capture.region_invalid`

#### `cmd://source_release`
- **Method:** command · **PRD:** M1–M3 · **DB:** — · **Flag:** ⚠
- **Purpose:** end the portal session / free the PipeWire stream.
- Body: `{ "sourceId": "src_01HV3…" }` · **Success:** `{ "ok": true }` · **Errors:** `portal.busy` (recording active — stop first)

### 2.2 Audio & camera

#### `cmd://audio_list_devices`
- **Method:** command · **PRD:** M4 · **DB:** — · **Flag:** ⚠
- **Purpose:** enumerate PipeWire sinks/sources + cpal microphones with defaults marked.
- Body: `{}` → **200:**
```json
{ "mics": [{ "id": "mic_blue-snowball", "label": "Blue Snowball", "isDefault": true }],
  "desktop": [{ "id": "sink_0", "label": "Built-in Output", "isDefault": true }] }
```
**Errors:** `pipewire.audio_enum_failed` (the device list could not be read — PipeWire down, graph unreachable)

#### `cmd://audio_set_channel`
- **Method:** command · **PRD:** M4 · **DB:** — · **Flag:** ⚠ (persisted via `settings_set`, not DB row)
- **Purpose:** enable/mute a channel, pick device, set level (0–100).
- Body: `{ "channel": "mic", "enabled": true, "muted": false, "deviceId": "mic_blue-snowball", "level": 80 }`
- **200:** `{ "ok": true }` · **Errors:** `settings.invalid_value` · `pipewire.audio_device_gone` (a concrete `deviceId` checked against the live system before persisting; `deviceId: null` = clear to the system default, no check) · `pipewire.audio_enum_failed`

#### `cmd://camera_open` / `cmd://camera_close`
- **Method:** command · **PRD:** M5 · **DB:** — · **Flag:** ⚠
- **Purpose:** open V4L2 device (portal fallback per ARCHITECTURE) returning a preview handle; close/free.
- `camera_open` body: `{ "deviceId": "v4l2_/dev/video0" }` → **200:** `{ "cameraId": "cam_01HV3…", "width": 1920, "height": 1080 }`
- **Errors:** `capture.camera_unavailable` (both); `camera_close` succeeds idempotently

### 2.3 Recording session

*(Task 1.3 scope: video-only monitor recording. `regionRect`, `cameraId`, `presetId` are accepted at their §-shapes but not honored until M3/M5/M11. **2.1 audio:** every enabled channel in the SETTINGS snapshot records into one pre-mixed stereo AAC track; a start-time capture failure rejects the start typed, before any media flows, and a device lost mid-take renders ONE non-fatal `pipewire.audio_device_gone` event while the take continues with that channel silent. The request body's `audio` array stays contract-shaped-but-not-honored — the settings snapshot governs the take (config-snapshot law); mid-take settings changes do not reshape a running take. `outputDir` is honored when given, else the default `$XDG_VIDEOS_DIR/SSP`. The stop reply omits the library row `id` and `thumbPath` until the DB upsert (task 1.6); `container` is `"mkv"` — remux to MP4 joins M9. Mid-take faults (mux disk errors, codec failures, a panicked or lost capture stream) surface at `recording_stop` as the §1 error; the event-stream join is task 1.4. **2.3:** pause is a phase of the ONE running take — nothing on disk changes (no separate segment files); frames fed while paused are discarded and the paused wall time is excluded from the encoded timeline (the resumed stream's pts continue where the pause began). Stop-while-paused is legal and finalizes the pre-pause content.)*

#### `cmd://recording_start`
- **Method:** command · **PRD:** M1–M5, M7–M11 · **DB:** R (INSERT with `status='recording'`, `created_at` set) · **Flag:** ✓
- **Purpose:** wire source→composite→encode→mux, open the MKV, flip AppState, start event feeds.
- Request body:
```json
{
  "sourceId": "src_01HV3…",
  "regionRect": null,
  "audio": [{ "channel": "mic", "deviceId": "mic_blue-snowball" },
            { "channel": "desktop", "deviceId": "sink_0" }],
  "cameraId": "cam_01HV3…",
  "presetId": "youtube",
  "outputDir": "/home/z/Videos/SSP"
}
```
- **Success 200:**
```json
{ "recordingId": "rec_01HV4…", "status": "recording",
  "encoder": { "backend": "vaapi", "isHardware": true },
  "startedAt": "2026-11-01T14:05:00Z" }
```
- **Errors:** `encoder.unavailable`+`encoder.init_failed` (the x264 **fallback is applied automatically first** and only errors if that also fails — `details.encoderChain` then lists what was tried) · `portal.denied` (session lapsed) · `disk.no_space`, `disk.path_unwritable` · `pipewire.stream_lost` · `pipewire.audio_device_gone` (an audio channel's device is gone or unusable **at start** — fatal for the take, which never starts) · `409`-class `ipc.bad_state` (a recording is already active, or `sourceId` is not the active source)

Task 2.6: a source whose stream has reported loss is not startable
(`ipc.bad_state`); tray Start is disabled until a live source is selected.
The lost source handle is retained for `source_release`/Quit cleanup.

#### `cmd://recording_pause` / `cmd://recording_resume`
- **Method:** command · **PRD:** M7 (segment stitching; **live since 2.3**) · **DB:** R (no row change; session state) · **Flag:** ⚠
- Body: `{ "recordingId": "rec_01HV4…" }` · **200:** `{ "status": "paused" }` / `{ "status": "recording" }`
- **Errors:** `ipc.bad_state` (409-class) for: no running take with that id (`"No recording is running with that id."`), pause on an already-paused take (`"The recording is already paused."`), resume on a take that is not paused (`"The recording is not paused."`)
- *(2.3 law: the phase rides `recording/tick` `state` within one 1 Hz beat of the command reply; the UI's Stop stays live while paused — stop-while-paused finalizes the take.)*

#### `cmd://recording_stop`
- **Method:** command · **PRD:** M7, M9 · **DB:** R (UPDATE: final duration/size/dims, `status='ready'`, `thumb_path`) · **Flag:** ✓
- **Purpose:** close mux, remux MKV→MP4 if configured, extract thumbnail, upsert library row, emit finished.
- Body: `{ "recordingId": "rec_01HV4…" }` · **200:**
```json
{ "recording": { "id": 17, "path": "/home/z/Videos/SSP/screen-2026-11-01-1412.mp4",
    "durationMs": 102550, "sizeBytes": 147174400, "container": "mp4",
    "thumbPath": "/home/z/.local/share/screen-studio-pro/thumbs/2026-11-01-1412.png",
    "status": "ready" } }
```
- **Errors:** `disk.write_failed`, `disk.no_space` · `409`-class `ipc.bad_state` (nothing active / id mismatch — the session survives a wrong id) · mid-take faults surface here: `disk.write_failed` (made it to stop), `encoder.encode_failed` (codec failure or worker panic), `pipewire.stream_lost` (capture died mid-take; a probeable partial MKV is kept) · `capture.no_frames` (a stop that encoded zero frames — no file is written; task 1.5, see §1 additions) — remux failure downgrades to `encoder.init_failed` with `userMessage` explaining MKV was preserved

#### `cmd://recording_flag`
- **Method:** command · **PRD:** flow 7.2 (chapter markers) · **DB:** R (UPDATE `chapter_json` append) · **Flag:** ✓
- Body: `{ "recordingId": "rec_01HV4…", "label": null }` (auto-named `flag-3` when null)
- **200:** `{ "chapter": { "offsetMs": 45200, "label": "flag-3" } }` · **Errors:** `ipc.bad_state`

### 2.4 Library (read/write over the `recordings` index; pagination & sorting live here)

#### `cmd://library_list`
- **Method:** command · **PRD:** M14 · **DB:** R (SELECT) · **Flag:** ✓
- **Purpose:** paged library grid query.
- Request:
```json
{ "limit": 50, "offset": 0,
  "filter": { "status": "ready", "kind": "recording", "search": "demo" },
  "sort": { "field": "created_at", "direction": "desc" } }
```
Constraints (API law): `limit ≤ 100` (default 50 — the paved-path page size); offsets page; `search` is `LIKE`-based on file_name/path (DATABASE §5 — no FTS at this scale); `sort.field ∈ created_at | duration | size`; only `status='ready' AND deleted_at IS NULL` rows served here.
- **200:**
```json
{ "total": 128, "items": [{ "id": 17, "fileName": "screen-2026-11-01-1412.mp4",
    "path": "/home/z/Videos/SSP/screen-2026-11-01-1412.mp4", "kind": "recording",
    "container": "mp4", "durationMs": 102550, "width": 2560, "height": 1440,
    "fps": 60, "sizeBytes": 147174400, "encoder": "vaapi", "isHwEncoder": true,
    "thumbPath": "…/thumbs/2026-11-01-1412.png", "chapterCount": 2,
    "createdAt": "2026-11-01T14:05:00Z" }],
  "page": { "limit": 50, "offset": 0 } }
```
- **Errors:** `settings.invalid_value` (bad limit/sort value)

#### `cmd://library_get`
- **Method:** command · **PRD:** M14 (drawer detail) · **DB:** R (SELECT one) · **Flag:** ✓
- Body: `{ "id": 17 }` · **200:** full row (all §2.1 columns incl. `audioJson`, `chapterJson`) · **Errors:** `404`-class `library.not_found` (added to canonical set: id valid, row gone/trashed)

#### `cmd://library_delete`
- **Method:** command · **PRD:** M14 · **DB:** R (UPDATE `deleted_at = now`) **soft delete** per DATABASE §2.1 · **Flag:** ✓
- Body: `{ "id": 17 }` · **200:** `{ "ok": true }` · **Errors:** `library.not_found`; `ipc.bad_state` (recording still in progress)

Purge is a **V2 nicety** (empty-trash) and is deliberately absent: with soft delete only, trash provinciaally grows until a purge command lands — flagged in §5 tracking.

### 2.5 Presets & system capabilities

#### `cmd://presets_list`
- **Method:** command · **PRD:** M11 · **DB:** — (presets are static TOML defaults, not DB rows) · **Flag:** ⚠
- Body: `{}` → **200:**
```json
{ "presets": [{ "id": "youtube", "label": "For YouTube", "description": "1080p60, ~12 Mbps", "fps": 60, "height": 1080, "container": "mp4" }] }
```
(Also: `discord` 720p30 ~6Mbps · `lossless` MKV CQP hi-quality · `smallest` 720p30 CRB-constrained.)
**Errors:** none (static config). **Flag note:** if presets ever become user-defined, they get a table — until then this stays static contract.

#### `cmd://system_capabilities`
- **Method:** command · **PRD:** M8/M12 · **DB:** — · **Flag:** ⚠
- **Purpose:** cold-start probe result: available encoders, portal support matrix, global-shortcut availability — drives the encoder chip and the §6.1 fallback warning.
- Body: `{}` → **200:**
```json
{ "encoders": [{ "backend": "vaapi", "isHardware": true, "available": true },
               { "backend": "nvenc", "isHardware": true, "available": false },
               { "backend": "x264", "isHardware": false, "available": true }],
  "portal": { "screencast": true, "globalShortcuts": "partial", "compositor": "hyprland" },
  "version": { "app": "0.0.1-alpha.1", "ipcContract": "1.2.0" } }
```

### 2.6 Settings & preferences

#### `cmd://settings_get` / `cmd://settings_set`
- **Method:** command · **PRD:** M10 · **DB:** — (TOML config per ARCHITECTURE stack) · **Flag:** ⚠
- `settings_get` body: `{ "section": "capture" }` → returns that TOML section as JSON.
- `settings_set` body: partial merge, e.g.
```json
{ "capture": { "frameRate": 60, "qualityPreset": "youtube" },
  "files": { "dir": "/home/z/Videos/SSP", "namingPattern": "screen-%Y-%m-%d-%H%M" } }
```
- **200:** full merged settings · **Errors:** `settings.invalid_value`, `settings.schema_mismatch`, `disk.path_unwritable` (persist fail)

#### `cmd://prefs_get` / `cmd://prefs_set`
- **Method:** command · **PRD:** UI-persistence surface of DESIGN §6.5/§6.6 (HUD/pinned state, PiP position/shape/size) · **DB: P (ui_prefs)** · **Flag:** ✓
- GET body: `{ "key": "pip.position" }` → `{ "key": "…", "value": "corner:bottom-right,margin:24" }` (or all keys with `{}`). All-keys reply (clarified at task 0.8): `{ "prefs": [{ "key": "hud.pinned", "value": false }, …] }`; an unknown key reads as `{ "key": "…", "value": null }` — prefs are optional by design.
- SET body: `{ "key": "hud.pinned", "value": true }` → **200:** `{ "key": "hud.pinned", "value": true }`
- **Errors:** `settings.invalid_value` (unknown key / non-JSON value) — `pip.*`/`hud.*`/`last.*` namespaces only, per DATABASE §2.2
- **Rate law:** set at most once per drag-frame batch (~60Hz max), values flushed by the frontend's throttle; no history — `upsert only`

### 2.7 Shortcuts

#### `cmd://shortcuts_apply`
- **Method:** command · **PRD:** M12 · **DB:** — (persisted in TOML, not DB) · **Flag:** ⚠
- **Purpose:** (re)register global shortcuts via the portal; body: `{ "bindings": [{ "action": "toggle_record", "combo": "Super+Shift+R" }] }` → **200:** `{ "granted": ["toggle_record"], "denied": [] }`
- **Errors:** `portal.unavailable` (compositor lacks GlobalShortcuts — UI shows tray fallback notice per PRD risk)

---

## 3. Events (push — the streaming half of the API)

| Topic | Payload (example) | Rate law (rate limits §4) | PRD | DB |
|---|---|---|---|---|
| `evt://recording/started` | `{ recordingId, encoder: "vaapi", startedAt }` | once per session | M7 | R ✓ |
| `evt://recording/tick` | `{ recordingId, elapsedMs, state: "recording" \| "paused" }` | **1 Hz** | M6→DESIGN §5.9 timer | R ⚠ |
| `evt://recording/meters` | `{ mic: {rms: 0.42, peak: 0.71}, desktop: {rms: 0.12, peak: 0.3} }` | **≤ 30 Hz, coalesced in Rust** | M4 | — ⚠ |
| `evt://recording/stats` | `{ fps: 59.8, droppedFrames: 0, bitrateKbps: 12100, encodeTimeMs: 5.2 }` | **0.5 Hz** | M8 | — ⚠ |
| `evt://recording/flagged` | `{ recordingId, chapter: { offsetMs, label } }` | on user action | flow 7.2 | R ✓ |
| `evt://recording/error` | standard error shape (§1) | on failure | M7 | R ✓ |
| `evt://recording/finished` | `{ recordingId, recording: {…library row…} }` | once per session | M9/M14 | R ✓ |
| `evt://library/updated` | `{ id, deleted: false }` | on row change | M14 | R ✓ |
| `evt://source/lost` | `{ sourceId, reason: "portal.denied" }` | on compositor teardown | M1–M3 | — ⚠ |
| `evt://device/changed` | `{ audio: true, camera: false }` | on PipeWire/V4L2 hotplug (≤ 1 Hz debounced) | M4/M5 | — ⚠ |
| `evt://shell/error` | `{ error: <§1>, recordingActive }` | on native/HUD action failure, main window only (§4.1) | M6/M12 | — ⚠ |

All event payloads are JSON, all carry the topic-scoped kind already shown; the webview subscribes through `lib/events.ts` exactly once per topic.

*(Task 1.4 scope: the recording-session events are live — `recording/started` (once, from `recording_start`, after the session went live), `recording/tick` (1 Hz, `elapsedMs` = wall-clock take time), `recording/stats` (0.5 Hz: fps, dropped frames, encoded bitrate, mean encode time), `recording/error` (a mid-take fault, pushed AT FAULT TIME), `recording/finished` (once, after the trailer was written). Task 1.6: the stop path now upserts the `recordings` row first (`finalizing`→`ready`, one transaction), so `finished.recording.id` is the REAL row id, `recording_stop` returns it, and `library/updated` `{ id, deleted: false }` rides after the upsert commits (M14 event, live now). The JSON/thumbnail columns stay null until M4/flow 7.2/5.1. Task 2.2: `recording/meters` is **live** (audio bus landed) — POST-gain law: readings measure exactly what is recorded, so a muted channel reads zeros and the level slider shapes the bar; BOTH keys are always present in every payload, with a channel that is not enabled in the take (or whose device died mid-take) reading `rms: 0, peak: 0`; a delivered reading holds ~250ms after its ring runs dry and then decays to zeros (bars fall, never freeze); rate = 34 ms period ≈ 29.4 Hz, coalesced in the Rust audio worker (§4/ARCHITECTURE §6). `recording/flagged` needs `cmd://recording_flag` (flow 7.2). `tick.state` carries the live take phase (`"recording"` | `"paused"`, 2.3) — the paused phase freezes `elapsedMs` at pause start and returns with the post-pause value on resume; the UI never infers the phase from elapsed time. Commands `recording_pause`/`recording_resume` flip it (§2.3). Channels: a command failure (`recording_start`/`recording_stop` rejected) travels on the command reply; the event stream carries the ASYNCHRONOUS failures — a mid-take fault is pushed at fault time AND returned by `recording_stop`, so a UI renders one failure once (DESIGN §6.5's no-double-telling law). The error payload is the §1 shape verbatim — it carries no recording id, so a consumer matches it to a take by the code it already knows. A failed index write fails the stop reply typed (`disk.write_failed`) — the take file stays on disk, no `finished`/`library/updated` is emitted.)*

---

## 4. Pagination, Filtering, Sorting, Rate Limits

- **Pagination:** only `library_list` paginates — offset/limit (default 50, max 100), response always echoes `page`. Backend caps hidden growth by returning only `status='ready' AND deleted_at IS NULL` (DATABASE §5 partial index). No cursor pagination: offsets are safe here because the index is write-behind-history and small; revisit only if trash-purge ever reorders rows.
- **Filtering:** `library_list.filter` supports `status`, `kind`, `search` (case-insensitive LIKE). `prefs_get` filters by namespace prefix (`hud.*`, `pip.*`, `last.*`). No other endpoint accepts filters (the surface stays small by design).
- **Sorting:** only `library_list.sort` allows client choice, whitelisted to `created_at | duration | size` × `asc | desc`; default `created_at desc`. Whitelist is exhaustive — arbitrary columns are rejected, matching the exact-indexes discipline of DATABASE §5.
- **Rate limits:** commands are human-initiated — no limiter (a desktop IPC has no strangers), **except** `prefs_set` batched at ≤60Hz as noted; and `source_select` no more than once per 500ms (portal sessions are heavyweight). Events have hard coalescing ceilings **in Rust, not the webview** (meters ≤30Hz, stats 2s, tick 1s, hotplug debounced 1s) — ARCHITECTURE §6 law, restated here as the API contract.

---

### 4.1 Window lifecycle (task 2.6)

- `cmd://window_hide`: main window only. Body `{ "recordingId"?: string }`,
  reply `{ "ok": true }`. Omit the id for explicit titlebar minimize-to-tray.
  Supply it only after HUD creation for automatic hiding; a stale/ended take
  is an idempotent no-op. Missing tray host returns `ipc.tray_unavailable` and
  leaves the window reachable; window-operation failures use `ipc.window_failed`.
- `evt://shell/error`: main-window-only native action failure, payload
  `{ "error": <standard §1 error>, "recordingActive": boolean }`.
  Emitted on failure, never polled. `false` resets the session projection after
  a failed stop/finalize; `true` preserves the current recording. Render human
  copy once, deduplicated with any existing recording-error toast.
- `recording/started` initializes the main projection for both tray and IPC
  starts. Stop and native failures restore the main window for feedback.
  Main owns HUD creation and teardown, including late creation after Stop.
  HUD command failures also use `shell/error` for visible main-window feedback.
  Library routing/highlight remains part of the Phase 5 Library surface.

## 5. API Versioning Rules

1. The contract is versioned as a whole: `ipcContract: "MAJOR.MINOR.PATCH"` returned by `system_capabilities` (no HTTP URL to version). The webview pins the expected version in `types/ipc.ts` and checks it at `main.tsx` boot; mismatch → `ipc.contract_mismatch` boot error screen naming both versions.
2. **MINOR bumps** = additive only: new optional fields, new commands, new event topics, new error codes. Older behavior never changes shape. Webview must tolerate unknown fields (the JSON-projection law: Rust truth superset, webview schema subset).
3. **MAJOR bumps** = renamed/removed commands, changed required fields, changed default semantics. Requires editing this file first (governance law carried over from DESIGN §8), a release-note entry, and a migration note for any persisted payload keys.
4. **PATCH** = doc clarifications and new `userMessage` copy; never schema changes.
5. Events default to "fire if subscribed" — a MINOR-added topic is safe against older webviews because the webview subscribes per topic.
6. Since there is no HTTP layer, **there are no URL/path version prefixes**; the `cmd://` and `evt://` schemes and this file's version are the only address space.

---

## 6. Complete Mapping Matrix (the "flag" audit)

| Endpoint | PRD feature | DB table | Flag |
|---|---|---|---|
| `source_select` / `source_region_set` / `source_release` | M1/M2/M3 | — | ⚠ runtime only, expected |
| `audio_list_devices` / `audio_set_channel` | M4 | — | ⚠ devices are system state |
| `camera_open` / `camera_close` | M5 | — | ⚠ runtime only, expected |
| `recording_start` | M1–M5, M7–M11 | recordings INSERT | ✓ |
| `recording_pause` / `recording_resume` | M7 | recordings (no row change) | ⚠ pipelining is session state |
| `recording_stop` | M7, M9 | recordings UPDATE | ✓ |
| `recording_flag` | flow 7.2 | recordings UPDATE (chapter_json) | ✓ |
| `library_list` / `library_get` / `library_delete` | M14 | recordings SELECT/UPDATE | ✓ |
| `presets_list` | M11 | — (static TOML) | ⚠ flagged only if user-defined presets arrive without a table |
| `system_capabilities` | M8/M12 | — | ⚠ probe surface, expected |
| `settings_get` / `settings_set` | M10 | — (TOML) | ⚠ settings-are-TOML is law |
| `prefs_get` / `prefs_set` | UI persistence (DESIGN §6.5/§6.6) | ui_prefs UPSERT | ✓ |
| `shortcuts_apply` | M12 | — (TOML) | ⚠ matches runtime binding |
| `window_hide` | M6/M12, DESIGN §5.8/§6.5 | — | ⚠ window lifecycle |
| All events | their commands' features | as tabled above | audited above |

**Standing flags to re-audit each release:** (1) any `⚠` endpoint that starts persisting state It shouldn't (would need a table + this file's edit first); (2) `library_delete` without a purge command (soft-delete growth — V2 ticket); (3) any event payload that starts carrying media bytes (forbidden — ARCHITECTURE §6).
