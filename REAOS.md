# REAOS.md — Reverse-engineering study of an installed desktop live-production application

**Purpose:** learning and design study of a locally installed recording/streaming desktop application. Target identity is kept generic on purpose; no vendor or product name is used in this document. Paths that would reveal the identity are described by role (for example, "the share directory" instead of a literal path).

**Date:** 2026-11-18 · **Target:** installed native x86-64 desktop application, runtime window reports version 33.0.1; distribution package reports 33.0.1-1.1.

---

## 0. Method, evidence and limits

This study combines four evidence classes. They are never mixed silently:

1. **REA Evidence records** — produced by the installed `rea` CLI (v6.8.0). Two target-free inspections succeeded on the executable:
   - `inspect_elf_notes` → Evidence `ev_5cf021b6c084a900686d8739b83f9d68f5eca2732dc49d554c5f814bbd867c63`
   - `inspect_native_exports` → Evidence `ev_ac5fbb351e02a3321c8db9d4890d3ad014da9df9f0b6a87e87ae79fdadb60c9b`
   Both bind the same SHA-256 (`41caec5b…e87e`, 5,866,640-byte ELF64 PIE, stripped, Build ID `9ed917e1…`). Export coverage is complete but the image is stripped: only one C++ runtime object export is visible, so no function-level behavior was recovered from REA.
2. **Ordinary shell observations** — package file inventory (2,069 files), dynamic-linkage inspection, shipped public headers, shipped locale/UI string tables and plugin module inventories. These are *not* REA Evidence; they are labeled as shell observations.
3. **Runtime accessibility observation** — the application was launched once in the existing desktop session and inspected through the desktop accessibility tree (snapshot `s3fb8vu156n29`). Only the idle UI was observed; no recording or stream was performed.
4. **Inference** — reasoned architecture from the above, explicitly marked as such.

**Blocked operations (honest limits):** REA's MCP registration for this agent client is stale (doctor: `config_drift`), and no decompiler engine is configured (no Ghidra/IDA/Kuna/JADX; the installed Hopper launcher is unauthenticated/unsupported). `rea inspect` failed with "Analysis failed"; `inspect_binary_layout` returned `provider_unavailable` requiring a caller-supplied pwntools 4.15.0 / pyelftools 0.33 / Unicorn 2.1.2 Python. Neither was retried unchanged. There is no function-level pseudocode, no observed encode loop, no measured performance data, and no source code comparison in this study. The settings dialog was opened but its accessibility snapshot was not retained; its categories are evidenced from shipped strings instead.

---

## 1. Identity and build (observations)

| Property | Value | Source |
|---|---|---|
| Format | ELF64 PIE, x86-64, stripped, dynamically linked, GNU/Linux 4.4.0 | REA Evidence (both) + `file` |
| Size / digest | 5,866,640 bytes; SHA-256 `41caec5b…e87e` | REA Evidence |
| Build identity | GNU build-id `9ed917e1d0948047ae361436ee85ca48c3d47597` (from ELF notes) | REA Evidence `…5cf021b6…` |
| Version | 33.0.1 (runtime window title), package 33.0.1-1.1 | Runtime observation + package query |
| Export surface | 1 global object export (C++ shared-pointer tag), complete coverage | REA Evidence `…ac5fbb35…` |
| Dependencies (selected) | Qt 6 Core/Gui/Widgets/Network/DBus/Xml/Svg; FFmpeg `avcodec`/`avformat`/`avutil` (63/61); x264; dav1d; rav1e; core library and frontend API library; PulseAudio; PipeWire/Wayland client; X11; VLC-derived media libs | Shell `ldd` observation |

**Inference:** the program is a Qt/Widgets frontend over a separately linked core engine and a FFmpeg-based media stack; the stripped export surface means the real modularity lives in separately shipped plugin modules rather than in this executable's symbol table.

---

## 2. Overall architecture (inference from shipped headers + linkage + runtime layout)

Layered structure, top to bottom:

1. **Qt frontend (executable)** — main window, menu bar, dock widgets, dialogs, status bar, Qt graphics preview canvas.
2. **Frontend API library** — bridge between UI and engine. Shipped header observations show functions for: enumerating/selecting scenes and transitions; setting transition duration and timeline position; creating/duplicating/deleting profiles and scene collections; registering tools-menu items and dock widgets; subscribing to frontend events, save and preload callbacks.
3. **Core engine library** — shipped headers declare the principal object model:
   - source types enumerated as INPUT / FILTER / TRANSITION / SCENE;
   - descriptor structs for sources, outputs, encoders and services (each a plugin-implemented vtable-style interface);
   - video and audio info/config structures, audio frame structure, signal handler and a generic settings/data object with source save/load;
   - media-io utilities: audio resampler, format conversion, frame-rate helpers, video scaler, media remux.
4. **Graphics layer** — shipped OpenGL renderer module; shader and effect parsing headers are present.
5. **Scripting/extension layer** — Lua and Python binding modules, frontend API, WebSocket API.
6. **OS/platform layer** — capture modules for screen (X11 and PipeWire/Wayland), camera (V4L2), audio (ALSA, PulseAudio, JACK), broadcast hardware (DeckLink), plus virtual camera and browser modules.
7. **Output sinks** — local files (multiple containers) and network streaming services.

**Event model (inference):** the presence of a signal handler in core headers plus frontend event callbacks and a settings/data API implies an event-driven composition model: sources emit signals, the frontend subscribes, settings are serialized into profiles/scene collections, and UI state is a projection of engine state.

---

## 3. User interface and workspace (runtime + shipped strings)

### 3.1 Main window anatomy — runtime observation (snapshot `s3fb8vu156n29`)

```
Window
├── Menu bar: File | Edit | View | Docks | Profile | Scene Collection | Tools | Help
├── Central area
│   ├── preview canvas container (4 children; disabled-state widget hidden)
│   └── context container (8 children)
├── Status bar (read-only)
│   └── frames: message · delay · issues · network · stream · record · CPU · FPS
└── Dock widgets (each with Close + Float actions)
    ├── Scenes
    ├── Sources
    ├── Audio Mixer (stacked mixer area + 10-item toolbar)
    ├── Scene Transitions
    └── Controls
```

**Controls dock buttons observed:** Start Streaming, Start Recording, Pause Recording (hidden while idle), Start Replay Buffer / Save Replay (hidden), Start Virtual Camera, Configure Virtual Camera, preview/program mode toggle, Settings.

**Audio Mixer dock observed:** two channels by default — a desktop-output channel and a mic/aux channel; each has a mute checkbox, "Enable Monitoring" checkbox and a volume slider. The mixer toolbar has a hidden-count checkbox, horizontal-layout toggle, Advanced Audio Properties button and an Options menu button. Runtime log observation: "Device for 'Audio Output Capture' source … is also used for audio monitoring. Deduplication logic is being applied to all monitored sources" — an explicit anti-double-capture measure.

### 3.2 Menu inventory (shipped locale strings, English)

- **File:** Export/Import, Show Recordings, Remux Recordings, Settings, Show Settings/Profile Folder, Check for Missing Files, Exit.
- **Edit:** Undo/Redo, Lock Preview, Preview Scaling (window/canvas/output/manual, zoom), Transform (edit/copy/paste/reset, rotate/flip, fit/stretch/center), Order (move up/down/top/bottom), Advanced Audio Properties.
- **View:** Toolbars, dock toolbars, source toolbar, source icons, status bar, fullscreen interface, reset UI, always-on-top, scene-list mode.
- **Docks:** Reset Docks, Lock Docks, Full-Height Docks, Custom Browser Docks (plus per-dock show/hide).
- **Profile / Scene Collection:** create, import, export, duplicate, delete, reset/set base resolution.
- **Tools / Help:** virtual camera, auto-config, stats, log files (show/upload/view current and previous), release notes, update check, file-integrity check, safe-mode restart, crash reports, about.

### 3.3 UX patterns evidenced by copy

- Confirmation dialogs before starting/stopping streams and stopping recordings.
- Visible "Encoding overloaded!" banner advising lower video settings or a faster preset.
- Dock-close warning explaining how to reopen a dock from the Docks menu.
- Missing-files recovery dialog and a remux tool for incompatible containers.
- Preview/program split mode with configurable transition duration and optional duplicate sources; quick transitions.
- Source alignment snapping (screen edges, center, other sources) with adjustable sensitivity and pixel guides.
- Projectors (scene/source full-screen outputs) with always-on-top and cursor hiding; limit one fullscreen projector per screen.
- Minimize-to-tray options, auto-start tray behavior, and "automatically record when streaming" / replay-buffer coupling.

**Inference:** the workspace is a dockable, production-style control surface optimized for a fixed set (scenes, sources, mixer, transitions, controls), with UI reset/lock and tray/projector modes for long-running sessions. This contrasts with a compact single-purpose recorder surface.

---

## 4. Workflows (shipped strings + runtime)

1. **First-run auto-configuration wizard:** choose usage intent ("optimize for streaming", "optimize just for recording", or virtual camera only), choose base resolution / preferred FPS (60 or 30, high FPS vs high resolution), optional service account or stream key, optional bandwidth test (explicit warning that randomized video will be sent), encoder test for both streaming and recording, then apply settings. The copy explicitly explains that canvas resolution ≠ output resolution and that downscaling reduces resource/bitrate needs.
2. **Composition:** create scenes; add sources (capture, devices, images, text, browser, etc.); reorder, transform, snap, filter; add transitions; optionally enable preview/program mode to preview before going live.
3. **Output configuration:** choose Output Mode — Simple, Advanced or custom FFmpeg output; choose container and quality/encoder; configure global audio devices and per-source mixer; set hotkeys.
4. **Go live:** Start Streaming / Start Recording / Start Replay Buffer / Start Virtual Camera; Pause Recording where supported; Save Replay; status bar reports bitrate, dropped frames, CPU and FPS.
5. **Post-production:** stop, locate recordings via File → Show Recordings, remux if the container needs it, check missing files, inspect logs.

**Constraint copied from the app's own warnings:** pausing is unavailable for one "same as stream" recording quality; replay buffer cannot save while paused; replay buffer is unavailable with lossless recording or custom FFmpeg output; incompatible containers warn before starting.

---

## 5. Audio path (shipped strings + runtime + headers)

- **Global devices:** two desktop-audio slots and four mic/auxiliary slots; sample rate and channel count configurable; "device not connected" state handled explicitly.
- **Metering:** 4 meter styles implied by decay options — Fast, Medium (Type I PPM), Slow (Type II PPM); peak meter type Sample Peak or True Peak (explicitly documented as higher CPU).
- **Latency/routing:** push-to-mute and push-to-talk with configurable delays; low-latency audio buffering mode intended for hardware outputs; per-source monitoring with deduplication when a monitored device is also used elsewhere.
- **Filters (shipped module strings):** noise gate, noise suppression, gain, delay, invert polarity, video delay, plus many video filters (color correction, LUT, mask/blend, crop/pad, chroma/key, sharpen, scaling, render delay, HDR tone mapping).
- **Mixer UX:** per-channel mute, volume slider, monitoring toggle, horizontal/vertical layout, advanced properties, hidden-source counter.
- **Core API:** audio info structures and resampler/format-conversion utilities are shipped in public headers; encode-side audio encoders are separate plugin objects (AAC / Opus in simple settings).

**Inference:** audio is a first-class parallel graph: global input devices feed source channels, each channel is independently filtered/metered/routed/monitored, and a mix is supplied to encoders and outputs. This is materially richer than a two-channel "mic + desktop" model.

---

## 6. Video, capture and composition (shipped headers/strings + modules)

- **Canvas vs output:** base (canvas) resolution and output (scaled) resolution are separate; FPS may be common, integer or fractional (numerator/denominator); downscale filters are Bilinear (fastest), Bicubic (16 samples), Lanczos (36 samples) and Area (4/6/9 samples); renderer is selectable.
- **Capture modules (shipped module inventory):** screen capture for X11 and PipeWire/Wayland; camera capture via V4L2; desktop audio via ALSA, PulseAudio and JACK; DeckLink broadcast I/O; browser capture; image and text sources; virtual camera output.
- **Transitions (shipped strings):** Cut, Fade, Swipe, Slide, Stinger, Fade-to-Color, with direction, color, video-file and transition-point (frame/audio) settings.
- **Source transforms:** rotate 90/180, flip, fit/stretch/center to screen, copy/paste transform, edit-transform dialog; snapping to screen edges/center/other sources.
- **Graphics:** OpenGL renderer module, effect/shader parsing headers, GPU delay and render-delay filters, HDR/SDR composition filters.

**Inference:** the composition stage is a GPU-rendered scene graph where each source is a node with transform and filter chain, the canvas defines the coordinate space, and the output stage scales/encodes the resulting frame.

---

## 7. Encoding, decoding, containers and outputs (shipped strings + linkage + modules)

### Recording containers
MKV, FLV, MP4, MOV, MPEG-TS, HLS, hybrid MP4/MOV and fragmented MP4/MOV. The app's own tooltip explains that hybrid/fragmented formats write in chunks and avoid finalization, keeping files playable after interruption (power loss or crash), with a Remux action for compatibility.

### Quality/encoder choices
- Simple recording quality tiers: same-as-stream, high-quality/medium size, indistinguishable/large, lossless (explicit warning of multi-gigabyte-per-minute sizes).
- Video encoders: software x264 (plus a low-CPU preset that increases file size), and hardware QSV / AMD / NVENC / Apple in H.264, HEVC and AV1 variants where available.
- Audio codecs: AAC (default) and Opus.
- Dynamic bitrate to manage congestion; "prefer hardware encoding" in the wizard with the tradeoff (less CPU, possibly more bitrate for equal quality) stated in the tooltip.
- Encoding-overload detection in the status bar with actionable guidance.
- Replay buffer with maximum seconds and a memory cap plus an estimated-usage calculation and oversize warning.

### Linkage/decoding evidence
FFmpeg codec/format libraries are linked directly; x264, dav1d (AV1 decoder) and rav1e (AV1 encoder) are present as shared libraries. Plugin modules include an FFmpeg module, an x264 module, an NVENC module, an Intel QSV module, an FDK-AAC module, an RTMP-services module, a WebRTC module and an output module.

### Streaming
Services with account/token/bearer auth, custom server/key, SRT/RIST parameters, restream channels, bandwidth test, and multitrack-video testing. Protocol strings in settings cover RTMP, SRT and RIST.

**Inference:** encoders, outputs and services are plugin objects selected by capability, with a simple preset path and an advanced path exposing the same underlying objects. Containers are chosen partly for crash resilience, not merely compatibility — a notable design lesson.

---

## 8. Plugins and extensibility (shipped module inventory)

Observed shipped modules (categorized by name/locale content, shell observation):

| Category | Modules observed |
|---|---|
| Core platform | core library, frontend API, OpenGL renderer, scripting framework |
| Capture/devices | screen capture (X11/PipeWire), V4L2 camera, ALSA/PulseAudio/JACK, DeckLink (+ captions/output UI), browser |
| Encoding | FFmpeg, x264, NVENC, QSV, FDK-AAC |
| Outputs/services | output module, RTMP services, WebRTC, virtual camera |
| Filters/transitions | filter set, transition set |
| Scripts/integration | Lua scripting, Python scripting binding, WebSocket API, VST |
| UI/tools | frontend tools, image source, text renderer |

**Observed UI support:** a plugin manager dialog (missing-plugin list, restart required), custom browser docks, add-tools-menu-item and add-dock APIs in the shipped frontend header.

**Inference:** extensibility is a first-class subsystem: nearly every capture/encode/output feature is a loadable module behind a stable descriptor interface, and the UI is a host for module-contributed docks and tools.

---

## 9. Performance optimizations (observation vs inference)

**Observed / directly evidenced**
- Hardware-encoder preference setting with an explicit CPU-vs-bitrate tradeoff in product copy.
- Separate canvas/output resolution with four downscale filters — scaling is a deliberate cost control.
- Dynamic bitrate and encoding-overload detection with actionable UI feedback.
- Replay buffer memory cap and estimated-usage warning (bounded RAM use).
- Audio monitoring deduplication applied at runtime (log observation).
- Audio buffering adjustment at startup (log observation: 21 ms added).
- Low-latency audio buffering mode for specific outputs; sample-vs-true-peak metering tradeoff stated in UI copy.
- Fragmented/hybrid recording formats avoid finalization — a crash-resilience optimization.
- Status bar exposes CPU, FPS, dropped frames and bitrate — continuous operator feedback.

**Inference (not measured)**
- GPU scene composition via the OpenGL module, with GPU-side filters (render delay, LUT, HDR tone mapping).
- Low-CPU x264 preset as a deliberate throughput/quality trade for constrained machines.
- Auto-config wizard performs test encodes to pick settings empirically instead of guessing.

**Not established:** RSS, actual drop rates, encode latency, throughput of specific encoders, or any benchmark — this study performed no recording.

---

## 10. Learnings for a recording application (design takeaways)

1. **Separate composition space from output space.** Canvas vs scaled resolution lets users reduce encode cost without rebuilding scenes.
2. **Treat container choice as a reliability decision.** Fragmented/hybrid containers and a remux tool preserve takes after crashes.
3. **Expose cost in the UI.** Overload banners, CPU/FPS/drop readouts, true-peak CPU warnings and lossless-size warnings turn hidden tradeoffs into informed choices.
4. **One scene graph, many outputs.** A single source/filter/transition model feeds recording, streaming, replay buffer and virtual camera — avoiding duplicate pipelines.
5. **Audio is a graph, not two channels** (in larger tools): device slots, per-source filters, monitoring, PTT/push-to-mute, metering decay and sync offsets all matter for production use.
6. **Extensibility via descriptor objects** lets hardware vendors and community authors add encoders/captures without forking the UI.
7. **Workspaces must be reconfigurable.** Dockable/floatable/lockable panels, reset UI, profiles and scene collections support long-lived, changing setups.
8. **Wizard + advanced mode coexistence:** an empirical auto-config path for beginners and an advanced object-level path for experts, sharing the same engine.
9. **Safe-state affordances:** confirmations before destructive transitions, missing-file recovery and dock-close explanations reduce user error.

---

## 11. Unknowns / not answered

- No function-level decompilation: encoder loops, thread topology, buffer sizes and scheduling policy are **unknown**.
- No runtime recording: actual A/V sync behavior, audio buffering math, drop-rate handling and encoder presets in practice are **unknown**.
- Settings dialog categories were not captured live; the list is inferred from shipped locale strings (General, Stream, Output, Video, Audio, Hotkeys, Advanced areas are evidenced by string keys).
- Plugin module descriptions come from names and locale tables; internal dependency wiring between modules is **not established**.
- No source-code comparison was performed; nothing here should be read as a claim about upstream implementation details beyond the shipped artifacts inspected.

---

## Appendix A — evidence index

| ID / observation | Type | What it supports |
|---|---|---|
| `ev_5cf021b6c084a900686d8739b83f9d68f5eca2732dc49d554c5f814bbd867c63` | REA `inspect_elf_notes` | ELF identity, size, digest, build ID, note tables |
| `ev_ac5fbb351e02a3321c8db9d4890d3ad014da9df9f0b6a87e87ae79fdadb60c9b` | REA `inspect_native_exports` | Dynamic export inventory (stripped image, 1 export) |
| `s3fb8vu156n29` | Desktop accessibility snapshot | Menu bar, status-bar frames, dock names, control buttons, mixer channels |
| Shell observations | `pacman -Ql`, `ldd`, `file`, `nm -D`, header/locale reads | Package inventory (2,069 files), module list, linkage, API model, UI strings |
| Runtime log observation | Application stdout/stderr on launch | Audio monitoring deduplication, 21 ms audio buffering |
