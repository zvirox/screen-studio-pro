# 04 — OBS Workflows: How Requests Are Fulfilled

Each workflow below traces the user's action through the observed layers. Sources: binary
export surface [REA], shipped locale data [HOST]. Execution internals (exact signal
ordering inside libobs) are [INFER] unless the export table directly proves the mechanism.

## 1. Record the screen (the workflow SSP mirrors, minus scenes)

**User path:** Controls → `Start Recording` → state changes to `Stop Recording` → on stop,
status bar announces `Recording saved to '<path>'` (and `Auto remuxed to '<path>'` when
auto-remux is on) [HOST: Basic.Main.StatusBar / Basic.StatusBar.RecordingSavedTo].

**What happens underneath:**

1. Output layer: `obs_output_create` (type from a registered recorder; on Linux a recording
   output from obs-ffmpeg) → `obs_output_initialize_encoders` → `obs_output_start`
   [REA: all present].
2. Pipeline wiring: output binds a video encoder and one-or-more audio encoders
   (`obs_output_set_video_encoder` / `set_audio_encoder` / `set_mixers`); mixer selection
   per-track (`obs_output_set_mixer` single vs `set_mixers` bitmask) [REA].
3. Video side supplies frames through `video_output_open/connect` with
   `video_output_lock_frame/unlock_frame` handoff and skip accounting
   (`video_output_get_skipped_frames`) [REA].
4. Packets flow via packet callbacks (`obs_output_add_packet_callback`); container writing
   happens in the output implementation. Post-stop remux (`media_remux_job_process`) when
   MKV→MP4 conversion is configured [REA + HOST: `obs-ffmpeg-mux` helper].
5. Failure surfacing: `obs_output_get_last_error`, stop signaling (`obs_output_signal_stop`,
   `obs_output_force_stop`) [REA].

**Pause/split/chapters** (observed control surface [HOST]): Pause Recording / Unpause
Recording / Split Recording File / Add Chapter Marker (Hybrid MP4/MOV only). Mechanism [REA +
INFER]: pause is output-level (`obs_output_can_pause`, `obs_output_pause`,
`obs_output_get_pause_offset` — the *offset* is reported to encoders so timestamps stay
continuous); split-file settings live in the Output page; chapters are a container feature
gated to Hybrid MP4/MOV.

## 2. Stream (context: PRD-V2 for SSP)

Service selection resolves to server/URL from rtmp-services plugin data; user enters key;
`Start Streaming` starts an output with reconnection configured
(`obs_output_set_reconnect_settings`, reconnect status strings in the status bar
`Disconnected, reconnecting in %2 second(s) (attempt %1)` → `Reconnection successful`), optional
stream delay (`obs_output_set_delay`, `ForceStopStreaming (discard delay)`), congestion-driven
dynamic bitrate [REA + HOST]. The broadcastButton / "Go Live" (`SetupBroadcast`) flow is for
platforms with broadcast management (Twitch/YouTube) [HOST: Basic.Main.*].

## 3. Replay buffer

An output variant (`obs_output_can_begin_data_capture` on a registered replay type — exact
type-id unknown [UNKNOWN]): runs continuously; `Save Replay` writes the rolling buffer to a
file. Settings: max time + estimated size [HOST: Output.ReplayBuffer keys]. SSP has no milestone
for this; noted for possible future "keep last N seconds" feature — the export surface shows it
is an *output*, not an encoder trick, i.e. disk-buffered [INFER].

## 4. Virtual camera

`Start Virtual Camera` / `Stop Virtual Camera` + `Configure Virtual Camera`
(`Basic.VCam.*`, `#virtualCamConfigButton`) — presents the (composited) scene as a V4L2
loopback device so conferencing apps see a webcam [INFER from name + platform convention;
**UNKNOWN**: implementation detail lives in the vcam code path]. V2 territory for SSP.

## 5. Scene management (PRD-V2)

Scenes/Sources docks drive: add source (SourceSelect dialog with create-new/existing +
visibility), per-source Properties dialog + Filters dialog, context-bar inline editing,
ordering/transform via Edit menu, transitions (`obs_transition_*`, `#transitionsFrame`).
Everything is registered via the same plugin registry (sources are plugins like
`pipewire`-captures). Persistence = Scene Collection file [cross-ref 03-settings §6].

## 6. Capture sources on this machine (Linux, relevant to SSP M1–M5)

Observed registered type-IDs and portal strings [HOST]:

| Need | OBS source | Mechanism |
|---|---|---|
| Monitor/window capture | linux-pipewire (default) / linux-capture `xshm_input` | **PipeWire + portals** (ScreenCast portal; camera via Camera portal — binary strings show camera-portal session negotiation, fd retrieval, format selection) |
| Mic input | `pulse_input_capture` | PulseAudio/PipeWire source; ALSA and JACK plugins also installed |
| Desktop/system audio | `pulse_output_capture` | sink monitor capture |
| Camera | linux-pipewire "OBS PipeWire Camera" + linux-v4l2 | portal-permissioned camera; V4L2 direct |
| Media files | vlc-video, image-source, ffmpeg_source | playlist/image/file playback sources |

SSP already mirrors the top four rows via ashpd/PipeWire — this table is confirmation by
installed-evidence, including the **camera-through-portal** pattern (OBS routes cameras through
the Camera portal when sandboxing demands it), which is SSP's documented portal-fallback rule.

## 7. Diagnostics workflows (maturity benchmarks)

- **Auto-config wizard** on first run (58-key flow, cross-ref 03-settings §7).
- **Stats dock** (`Basic.Stats.*`, 20 keys): FPS, CPU, memory, bitrate, dropped frames — live.
- **Safe mode restart** and **crash-log upload** (`Help.RestartSafeMode`, `CrashHandling` 8
  keys, `Help.CrashLogs.*`); log upload with one click (`Help.Logs.UploadCurrentLog`).
- **Missing-files detection** on scene load (`MissingFiles` 12 keys, `File.ShowMissingFiles`)
  — when a scene references media that vanished, OBS lists it and offers relocation.
- These are the "app never leaves the user stranded" layer [INFER from shipped copy] — the
  cheapest maturity wins for SSP later: stats + safe-mode + logs are product surface, not
  engineering privilege.
