# 05 — OBS Feature Matrix → SSP Milestone Mapping

Purpose: turn the OBS evidence base into a **borrow list** per SSP milestone, without expanding
PRD scope. Every row cites the OBS evidence doc. PRD M-numbers from PRD.md §5; OBS facts from
docs 01–04. SSP's deliberately-absent features are called out as such (AGENTS.md conflict rule:
scope is the PRD's call, not this research's).

## 1. Direct matrix

| SSP | Milestone | OBS counterpart (evidence) | What to borrow | What to skip |
|---|---|---|---|---|
| M1 | Monitor capture | linux-pipewire plugin, ScreenCast portal `PipeWireSelectMonitor` (02 §6/04 §6) | — | OBS's fallback to X11 `xshm_input` (Wayland-first SSP can require portals) |
| M2 | Window capture | `PipeWireSelectWindow` with portal user-picker (04 §6) | portal picker as the primary UX | per-window icon/preview grids (native protocol work) |
| M3 | Region capture | OBS has **no dedicated region source** — region preview cropping [INFER: crop/transform on sources] | treat region as crop-of-monitor, as planned | — |
| M4 | Audio sources | `pulse_input_capture` + `pulse_output_capture` = separate *sources* per channel; settings page has 6 device slots + meter decay/type options (03 §4) | per-channel device model (SSP API `audio_set_channel` matches); meter decay/type as future tuning | push-to-talk (not in MVP); 6-slot generality |
| M5 | Webcam PiP | portal camera: camera-portal strings in linux-pipewire (00 §What/04 §6) | portal-first camera with V4L2 fallback; OBS proves portal-camera is viable in production | OBS's camera device grids |
| M6 | HUD toolbar | OBS has no HUD (its Controls row is in-window). UPSTREAM GAP: this is where SSP exceeds OBS on Wayland | nothing — SSP's Float HUD (DESIGN §5.9, task 2.4) has no OBS precedent to copy | — |
| M7 | Pause/resume | **Output-level pause with pause-offset continuity**: `obs_output_can_pause/pause/get_pause_offset`, encoder `get_pause_offset`; split-file and chapter-marker actions gated to Hybrid MP4 (01 §3, 04 §1) | pause-offset concept: keep encoders running, drop/stitch, timestamp continuity owned by output+muxer layer (task 2.3) | OBS's per-quality pause restrictions (Simple-mode warning) |
| M8 | HW encoders | Registered encoders observed: `jim_nvenc`, `jim_hevc_nvenc`, `obs_qsv11`, `obs_x264`, `ffmpeg_openh264`, `ffmpeg_aom_av1`; availability-driven picker (01 §2, 03 §2) | OBS's **enumerate→filter→prefer-HW→fallback-SW** order; CRB-style single-quality dial (Simple mode) as default UI | per-encoder expert panels (Advanced mode) in MVP |
| M9 | File output | MKV record-safe default + auto-remux job on stop (`media_remux_job_*`, `obs-ffmpeg-mux` helper); Hybrid MP4 as modern default (03 §2, 04 §1) | validate SSP's MKV→remux decision (already shipped in 1.6 — OBS does the same thing); future: Hybrid-MP4-style crash-safe container as an option | FLV/TS/HLS formats |
| M10 | Basic settings | Video page: decoupled canvas/output resolution + named downscale filters + common-FPS list (03 §1) | **common-values FPS dropdown** (30/60); keep resolution source-derived as SSP does; future: downscale filter choice | fractional FPS, renderer choice |
| M11 | Quality presets | Simple mode's outcome-phrased ladder: "Same as stream / High Quality (Medium) / Indistinguishable (Large) / Lossless (Tremendous)" (03 §2) | phrase-presets-as-language for "For YouTube/Discord/Lossless/Smallest": OBS's labels beat bitrate numbers for non-experts | OBS's per-quality bitrate mechanics |
| M12 | Quick-record hotkey | `obs_hotkey_*` (36 exports) incl. portable binding save/load; GlobalShortcuts equivalent (01 §3) | hotkey bindings with persisted save/load semantics | OBS's per-context hotkey matrix |
| M13 | Recording indicator | No OBS equivalent observed (x11 indicator absent on Wayland) [HOST: no corresponding locale/theme keys] | — | — |
| M14 | Library | Status-bar "Recording saved to '<path>'" + `File.ShowRecordings` opens the folder; **no in-app library grid exists in OBS** — imported via Importer (8 keys) only. SSP's M14 exceeds OBS here | the saved-to announcement already shipped (1.7); Importer's "detect and import external recordings" idea for later | — |

Ruling: **SSP is already past OBS** on HUD (M6), library grid (M14), and will be past OBS on
first-run simplicity. OBS is past SSP on pause/split/chapters (M7), encoder breadth (M8), and
diagnostics surface. The matrix is not "copy OBS" — it is parity where OBS is ahead,
confidence where SSP is ahead.

## 2. V2 / Later items observed in OBS (notes for future PLAN feeding)

| SSP future | OBS evidence to reuse | Caution |
|---|---|---|
| V1 RTMP streaming | output-level reconnect model, congestion + dynamic bitrate, service capability readouts, stream delay with force-discard (01 §3, 03 §3, 04 §2) | entire workflow is V2 per PRD; do not implement early |
| V2 scene compositor | scene graph API shape (`obs_scene/sceneitem/groups`, transforms, undo/redo across scene edits; GLSL scale/composition effect set) (01 §3–4) | the *compositor seam* exists in SSP's architecture as named seam only |
| V3 replay buffer | replay = an *output* (buffered, saves on demand) (04 §3) | same |
| V4 screenshot | Screenshot strings exist ("ScreenshotSavedTo") — a capture one-shot of the same pipeline (02 §4→StatusBar) | — |
| V7 multi-monitor mix | canvas API (`obs_canvas_*`, 25 exports) is OBS's multi-canvas primitive | — |
| L1 plugin model | the 8-symbol module ABI is the entire contract (01 §2) — plugins are *vulnerable surface*, not a security model | SSP's plugin idea (L6) must not copy OBS's dlopen-everything without a trust story |
| L4/L8 instant edit, AI subtitles | no OBS counterpart for "instant edit-on-stop" (only replay + remux). SSP's signature features are genuinely differentiated | — |

## 3. Maturity lessons OBS teaches (independent of milestones)

From the workflow+settings evidence, ranked by cost-to-borrow:

1. **Signals everywhere.** OBS's output layer is event-first: stop/error/reconnect/pause are
   signals a UI subscribes to (`obs_output_get_signal_handler`), not return codes. SSP's
   event model (API.md §3) mirrors this already — keep it strict.
2. **Warnings, not walls.** Dangerous choices (Lossless, IgnoreRecommended, Multichannel) ship
   with explicit warning copy and confirmation modals instead of hiding the option
   (03 §2–3). SSP's §7.9 pattern should grow the same "confirm modal on destructive expert
   choices" reflex.
3. **The status bar narrates.** Every finish/drop/reconnect/remux announces itself in one
   always-visible line (02 §4, 04 §1). SSP's toast system (1.7) is the analog; a persistent
   one-line state strip is a cheap later addition.
4. **Safe mode + log upload + crash reporting are standard product surface** (04 §7), not
   dev-only tools. Defer, but remember them when SSP ships to distro users.
5. **Defaults edited by a wizard, not by hand.** OBS chooses encoders/FPS for the user first
   (03 §7); SSP's hardcoded sane defaults from M8/M10 are the same philosophy compressed.

## 4. Known unknowns (do not build on these)

- Exact internal thread counts/scheduling of video-io and audio-io (not traced at runtime).
- obs-websocket's command surface (session opened but exports are the generic ABI only —
  its RPC registry is internal data, not exported symbols).
- rtmp-services' bundled service list contents (data file not inventoried).
- Replay buffer's on-disk behavior (inferred output type, never run).
