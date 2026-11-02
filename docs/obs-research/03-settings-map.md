# 03 — OBS Settings Map

Source: `Basic.Settings.*` namespace of the shipped `en-US.ini` (378 keys) plus the Output-page
value strings [HOST]. Every page title below is the exact shipped string. Counts are shipped
locale keys per page — a good proxy for each page's real complexity (they include option labels,
tooltip groups, and warning messages).

## Page inventory (left nav order as shipped)

| # | Page | Keys | Dominant content |
|---|---|---|---|
| 1 | General | 59 | language, theme, system-tray, warn-before-exit, projectors, undo/redo |
| 2 | Appearance | 11 | theme selection, UI options (`Basic.Settings.Appearance.*`, paired with Docks menu) |
| 3 | Stream | 40 | service, server, key, bandwidth test, multitrack video (WHIP/Enhanced Broadcasting) |
| 4 | Output | 136 | the giant — see §2 |
| 5 | Video | 19 | canvas/output resolution, downscale filter, FPS, renderer |
| 6 | Audio | 32 | sample rate, channels, meters, 6 device slots, push-to-talk/mute, low-latency buffering |
| 7 | Hotkeys | 5 | container page (per-action bindings live elsewhere) |
| 8 | Accessibility | 14 | color filters, selection color, subtitles/caption prefs |
| 9 | Advanced | 50 | catch-all: video, audio, network, stream delay, auto-remux, hotkey behavior |

## 1. Video page (19 keys) — what a capture-first app actually needs

- Base (Canvas) Resolution vs Output (Scaled) Resolution: **the scene canvas and the encoded
  output are decoupled sizes**; one downscale filter choice applies.
- Downscale filters: Bilinear / **Area (default)** / Bicubic / Lanczos — each a shipped libobs
  GLSL effect (see 01-architecture §4). `DownscaleFilter.Unavailable` warns when the filter
  can't apply (e.g. no scaling needed).
- FPS: **common values list + fractional mode** (Numerator/Denominator). Integer-only UI with a
  fraction escape hatch.
- Renderer: Direct3D/OpenGL choice + `Renderer.Experimental` opt-in.

SSP mapping: M2's fixed 1920×1080@60 is a strict subset of this page; the *decoupled
canvas/output resolution + named filter* concept is the piece worth borrowing when quality
tuning arrives.

## 2. Output page (136 keys) — two philosophies side by side

`Output Mode` toggle switches the page's body: **Simple** (32 keys) vs **Advanced** (45 keys),
plus shared groups: Format (12), Replay Buffer (8), Split File (5), Encoder (2), DynamicBitrate
(3), and a warnings block (7).

### Simple mode — the consumer recipe
- **Recording Quality**: `Same as stream` / `High Quality, Medium File Size` / `Indistinguishable
  Quality, Large File Size` / `Lossless Quality, Tremendously Large File Size` — the ladder is
  *phrased as outcome, not as bitrate number*.
- **Recording Format** (shared Format group): MKV / FLV / MP4 / MOV / TS / HLS / **Hybrid MP4
  (.mp4)** / Hybrid MOV / Fragmented MP4 / Fragmented MOV. OBS's recent default is Hybrid MP4 —
  crash-safe MP4 — while classic MP4 is still offered (with warning).
- **Encoder picker enumerates everything the machine has**: Software (x264), Software
  (OpenH264), Hardware (QSV/AMD/NVENC × H.264/HEVC/AV1), Software (x264 low-CPU preset) [HOST:
  value strings]. Audio codec: AAC (default) / Opus.
- Pause unavailable if quality = "Same as stream" (explicit warning).
- `TwitchVodTrack` ("uses Track 2") — even Simple mode leaks the multi-track concept.

### Advanced mode — the expert recipe
- Per-mode Streaming/Recording tabs (separate encoder settings each), with **audio tracks 1–6**
  checkboxes per output (`Adv.Audio.Track1..6`).
- Encoder presets (`EncoderPreset` ×4 keys — rate control, preset, profile),
  `CustomEncoderSettings`/`CustomMuxerSettings` free-text escapes,
  `DynamicBitrate` (network-adaptive), advanced **SplitFile** settings (size/time), replay-buffer
  (max time, estimated size).

## 3. Stream page (40 keys)

Service dropdown (rtmp-services plugin data), server URL, stream key with password masking,
authentication, **Bandwidth Test Mode**, custom-server escape (`Custom.Server`,
`ServiceCustomServer`), service capability readouts (`Recommended.MaxFPS/MaxResolution/…` with
`IgnoreRecommended` + warning modal), and the modern **MultitrackVideo/Enhanced Broadcasting**
cluster (`MultitrackVideo{ConfigOverride,Label,MaximumAggregateBitrate,…}`,
`WHIPSimulcast{Label,Info,TotalLayers}`) [HOST].

SSP mapping: streaming is PRD-V2 — none of this is MVP, but *service capability readout +
soft warnings rather than hard blocks* is the interaction pattern worth remembering.

## 4. Audio page (32 keys)

- Global: SampleRate (48k default), Channels (stereo/mono), **meter decay rate**
  (Fast/Medium/Slow) and **meter type** (SamplePeak vs TruePeak) — metering quality is a
  shipped setting, not an implementation detail.
- Devices: Desktop 1/2, Mic/Aux 1/2/3/4 — six slots, each a *channel*, not a device picker
  inside a mixer; plus per-channel enable happens elsewhere (mixer icons).
- Push-to-mute / push-to-talk with delay values; low-latency buffering mode with a
  confirm-warning modal.
- `UnknownAudioDevice`, `Disabled` states are explicit strings.

## 5. Advanced page (50 keys)

Grouped sub-headings shipped as keys: General, Video, Audio, Network, StreamDelay, Hotkeys,
AutoRemux, FormatWarning (+ warning copy). Auto-remux here is the "record MKV, auto-convert on
save" pairing with the MKV default — same trailer idea as SSP 1.6, exposed as one checkbox.

## 6. Profiles & Scene Collections (File menu)

- **Profile** = complete settings set, named, switchable live, import/export as folder
  (`Profile.Exists` guards names).
- **Scene Collection** = complete scene graph + sources + their settings, import/export,
  with *migration* tooling between OBS format versions (`SceneCollection.Migrate`,
  `SceneCollection.Remigrate`).
- These two concepts are OBS's.config persistence model: `basic/profiles/` + scenes JSON
  [INFER from folder menu items]. SSP's settings_set/DB model covers profiles' MVP needs;
  the "export/import as shareable file" idea is a candidate later checkbox.

## 7. First-run Auto-Config wizard (58 keys, `Basic.AutoConfig.*`)

A dedicated `Basic.AutoConfig` namespace runs before settings on first launch: asks usage
(optimizing for streaming vs recording priority vs virtual cam), base resolution, FPS, hardware
probe, then applies recommended Output/Video settings. Highest-leverage single UX flow in OBS
for onboarding [HOST: key count; exact dialog order INFER from key names `Tree.OptimizeFor.*`].
SSP's "first record in 30 s" goal (PRD) deliberately skips this — recording-only has fewer
knobs.
