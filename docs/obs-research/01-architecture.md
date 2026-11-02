# 01 — OBS Architecture as Shipped

All claims cite the evidence register in [00-overview.md](00-overview.md).
Labels: **[REA]** retained Evidence · **[HOST]** shell observation of installed files ·
**[INFER]** inference.

## 1. Process and library layering

OBS Studio is a plain Qt6 single-process desktop app with a strict three-layer library split
[HOST: `ldd /usr/bin/obs`]:

```
/usr/bin/obs  (Qt6 Widgets frontend, 5.6 MB)
 │  links ↓
/usr/lib64/libobs-frontend-api.so.30     ← the frontend API boundary (thin)
 │  links ↓
/usr/lib64/libobs.so.30  (core engine, 1.15 MB, 1,756 exported symbols)  [REA]
 │  loads ↓ (dlopen at runtime)
/usr/lib64/obs-plugins/*.so  (29 plugins)  [HOST]
```

Observations that matter for SSP:

- **The frontend never touches media directly.** All capture/encode/mux machinery lives behind
  the `libobs` C ABI. The Qt layer is UI + orchestration only. This is the same principle SSP's
  ARCHITECTURE.md encodes as "the webview never touches video frames" — OBS proves the pattern
  at scale.
- **The frontend API is a *separate* library** (`libobs-frontend-api.so.30`) that the frontend
  binary links; libobs itself has **zero** `obs_frontend_*` exports [REA: the 1,756-export table
  contains none; searched `^obs_frontend` → 0 results]. Core never knows about UI. Plugins that
  want UI hooks (frontend-tools.so) link the frontend API themselves.
- **Single process.** No daemon, no helper service in the rpm file list [HOST]. (The separate
  `obs-ffmpeg-mux` helper binary exists on disk — used for remux job offload, see §5 [INFER:
  from `media_remux_job_*` exports in libobs and the helper's presence].)

## 2. Plugin system: an 8-symbol ABI

Every plugin exports **exactly** the standard module ABI and nothing else. Sampled with REA
across six plugins representing every plugin class — obs-ffmpeg (encoders+muxers),
linux-pipewire (portal capture), obs-outputs (RTMP), obs-websocket (automation), obs-nvenc (HW
encoder), linux-pulseaudio (audio capture) — all show the same 8 exports [REA, parent
`ev_5b8d8a…`]:

```
obs_module_load · obs_module_unload · obs_module_set_locale · obs_module_ver
obs_module_set_pointer · obs_module_get_string · obs_module_free_locale · obs_module_description
```

All real work happens in `obs_module_load`, which calls `obs_register_*` to hand libobs factory
functions and type IDs. Consequences:

- Type IDs surface as plain strings in the binary. Recovered by `strings` [HOST], these are the
  registered capabilities of the installed build:
  - **obs-ffmpeg**: `ffmpeg_muxer`, `ffmpeg_hls_muxer`, `ffmpeg_mpegts_muxer`, `ffmpeg_output`,
    `ffmpeg_aac`, `ffmpeg_opus`, `ffmpeg_flac`, `ffmpeg_alac`, `ffmpeg_aom_av1`,
    `ffmpeg_openh264` + `ffmpeg_options` (per-orphan-options UI hook)
  - **obs-nvenc**: `jim_nvenc`, `jim_hevc_nvenc`, `ffmpeg_nvenc`, `ffmpeg_hevc_nvenc`
  - **obs-x264**: `obs_x264` · **obs-qsv11**: `obs_qsv11`
  - **linux-pulseaudio**: `pulse_input_capture` (mic), `pulse_output_capture` (desktop audio)
  - **linux-capture**: `xshm_input`, `xshm_input_v2`
  - **linux-pipewire**: registered IDs not string-recoverable this way [UNKNOWN: exact type IDs];
    its locale data and binary strings prove it ships **desktop capture, window capture, and
    camera-via-portal** (`camera-portal` log-domain strings, `libpipewire-0.3.so.0` linkage,
    locale keys `PipeWireDesktopCapture`, `PipeWireWindowCapture`, `PipeWireCamera`,
    `PipeWireSelectMonitor/Window/ScreenCast`, `ShowCursor`, `VideoFormat`, `FrameRate`) [HOST]
- **Plugins are individually optional.** libobs queries capabilities it has registered, which is
  why the settings UI hides QSV/NVENC on machines without them [INFER from encoder-listing
  settings model, §3].

## 3. libobs export surface — the architecture in one table

The complete 1,756-symbol export table [REA `ev_c211a3…`] grouped by prefix (top 30 groups,
counts):

| Prefix group | Count | Role |
|---|---|---|
| `gs_*` | 277 | graphics subsystem (render/scaling/shader state machine) |
| `obs_source_*` | 158 | source plugin lifecycle, frames, flags, capabilities |
| `obs_data_*` | 156 | settings object layer (JSON-ish model with defaults/autoselect) |
| `os_*` | 108 | platform abstraction (files, paths, dynload, timing, threads) |
| `obs_property_*` | 81 | properties-list UI descriptors (per-login-free, per-widget) |
| `obs_output_*` | 75 | outputs: start/stop, encoders binding, pause, delay, reconnect, signals |
| `obs_sceneitem_*` + `obs_scene_*` | 67 + 24 (+ enum) | scene graph, item transforms, ordering, groups |
| `obs_get_*` / `obs_enum_*` | 62 + 21 | registry queries + enumeration (video, sources, encoders) |
| `obs_encoder_*` | 61 | encoder lifecycle, muxer binding, scale, colorspace/range, pause offset |
| `obs_hotkey_*` | 36 | global + context hotkeys, combos, bindings save/load |
| `obs_service_*` | 26 | streaming service abstraction (URL, key, recommended caps) |
| `obs_weak_*` | 25 | weak-ref counterpoints (dispose-safety) |
| `obs_transition_*` | 25 | scene transition types |
| `obs_canvas_*` | 25 | **canvas API** (multi-canvas/multi-output, new in 30.x line) |
| `video_*` | 27 | video-io: `video_output_open/connect/lock_frame/unlock_frame`, scaler |
| `audio_*` | 13 | audio-io: `audio_output_open/connect`, resampler |
| `obs_fader_*` (+ volmeter elsewhere) | 13 | audio metering/monitoring UI support |
| `config`, `dstr`, `profiler`, `cf_*` | 32+29+24+11 | config files, dynamic strings, profiler, circular frame buffer |
| `matrix4/3`, `quat`, `bounds` | 39 | 2D/3D math for transforms |

### The media-flow shape the table proves

1. **Sources** push/delete raw frames; `obs_add_tick_callback` and `obs_get_video_frame_time`
   show one global video timing master clock [REA].
2. **video-io / audio-io** are subscription buses: `video_output_connect/disconnect`,
   `audio_output_connect/disconnect`, with `video_output_lock_frame/unlock_frame` (zero-copy
   frame handoff with lock) and `video_output_get_skipped_frames` (drop accounting) [REA]. SSP's
   "previews are stills at documented cadence" and "frames never cross IPC" flags mirror this.
3. **Encoders** consume raw frames, produce packets: `obs_encoder_packet_ref/release`,
   `obs_encoder_get_extra_data` (codec headers), `obs_encoder_get_frame_size`, ROI APIs
   (`obs_encoder_add_roi`) [REA].
4. **Outputs** bind one video + N audio encoders (`obs_output_set_video_encoder`,
   `obs_output_set_audio_encoder`, `obs_output_set_mixers` — multi-track audio is a first-class
   concept; `obs_output_get_supported_video_codecs` negotiates) [REA].
5. **Pause is an output+encoder property**, not a capture one: `obs_output_pause/can_pause/`,
   `obs_output_get_pause_offset`, `obs_encoder_get_pause_offset` [REA]. Relevant to SSP 2.3.
6. **Streaming resilience lives in output**: `obs_output_set_reconnect_settings`,
   `obs_output_get_congestion`, `obs_output_set_delay` (stream delay), dynamic bitrate keys in
   settings [REA + HOST locale `Output.DynamicBitrate`].

## 4. Render pipeline (shipped GLSL effects)

`/usr/share/obs/libobs/*.effect` [HOST], 22 files:

- **Composition**: `default.effect` (main draw), `default_rect.effect`, `opaque.effect`,
  `solid.effect`, `premultiplied_alpha.effect`, `repeat.effect`, `color.effect`,
  `format_conversion.effect`
- **Scaling**: `bicubic_scale.effect`, `lanczos_scale.effect`, `bilinear_lowres_scale.effect`,
  `area.effect`
- **Deinterlace family** (9 files): base + blend/linear/yadif ×(1x/2x) + discard

These are the GPU programs the `gs_*` subsystem runs [INFER: shipped with libobs and named for
its stages]. SSP's planned composite stage (V2 seam) would need only the composition + scaling
set.

## 5. Distribution & helper process notes

- Single rpm, no runtime downloads of codec binaries except the *optional* browser runtime
  (obs-browser ships CEF separately upstream; the installed package links no CEF →
  browser-source functionality is present but inert here [HOST: no libcef in rpm; obs-browser.so
  present]). UNKNOWN: Fedora packaging detail, irrelevant to SSP.
- `obs-ffmpeg-mux` helper binary exists [HOST]; libobs exports `media_remux_job_create/process`
  [REA] — OBS's "remux MKV→MP4 after recording" is a post-stop job, matching SSP's planned
  MKV→MP4 trailer path (1.6).
- `obs-nvenc-test` helper binary [HOST] — encoder-availability probe, shipped for support
  diagnostics. SSP's encoder `ensure_init()` probe covers the same need.
