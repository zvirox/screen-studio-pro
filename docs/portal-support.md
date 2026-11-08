# portal-support.md — compositor quirks matrix

**Status: partial observations** — populated from real capture runs (PLAN task 1.1+),
growing per manual QA pass (TESTING.md §7). Manifest format: one section per
compositor, updated in the session where the observation was made.

This file is supporting context, not a contract — but every "works on my machine"
claim about a compositor should end up here.

## Template (copy per compositor)

```
### <Compositor + version> (distro)

| Capability | Status | Notes |
|---|---|---|
| Monitor capture (portal) | ✅/⚠️/❌ | |
| Window capture | ✅/⚠️/❌ | |
| Region capture (cursor/keyboard modes) | ✅/⚠️/❌ | |
| restore_token reuse | ✅/⚠️/❌ | |
| global-shortcuts portal | ✅/⚠️/❌ | |
| Window list in picker | ✅/⚠️/❌ | |

Known quirks: ...
Repro of any anomaly: ...
Logged: <date, app build>
```

## Hyprland

*Not yet observed — first capture run pending (task 1.1).*

## KDE Plasma (Wayland)

Observed: task 1.1 manual gate (app-side PipeWire client, ashpd 0.13.13).

| Capability | Status | Notes |
|---|---|---|
| Monitor capture (portal) | ✅ | Consent dialog fires per session; 60 fps sustained (480 frames / 8 s) at native monitor geometry. |
| Window capture | 🚫 not tested | Task 1.1 ships `monitor` only; re-observed at M2. |
| Region capture (cursor/keyboard modes) | 🚫 not tested | M3. |
| restore_token reuse | 🚫 not tested | `PersistMode::Application` requested (transient, no disk persistence); restore-token flow lands M2+. |
| global-shortcuts portal | 🚫 not tested | — |
| Window list in picker | ✅ | KDE picker offers monitor/window tabs on its own. |

Known quirks:
- **PipeWire node caps are session-specific.** `pw-dump` of two sessions on the same monitor: one advertises size FIXED 1920×1080, another FIXED 1919×1079 (KWin scale-rounding). Never pin sizes hand-authored; use the portal response's `Stream::size()` as the range default (it matches the node).
- **`framerate` is advertised as fixed 0/1** ("variable"), with `maxFramerate` ≈ 60.02 as a separate choice. A client range of `[60..60]` does NOT intersect `{0/1}` → stream dies instantly with `no more input formats`. The client range must contain 0.
- **Format choices are BGRA (default) + BGRx only** — no RGB/RGBA/I420 offers on the screencast node.
- **DMABUF modifiers are offered** alongside `0` — and **modifier `0` means `DRM_FORMAT_MOD_INVALID` (dmabuf, implicit modifier), NOT system memory** (task 1.5, log-proven). KWin's screencast (`screencaststream.cpp::onStreamParamChanged`) allocates DMABUF buffers whenever ANY modifier key — including a `{0}` "pin" — survives into the fixated format: every buffer then arrives unmapped (`spa_data.data == null`, `SPA_DATA_DmaBuf`), `MAP_BUFFERS` cannot map it, and a client copying via the data pointer silently gets zero frames while the dequeue counter still reports 60 fps. **The fix:** offer NO `VideoModifier` property at all. KWin then resets its dmabuf params (`m_dmabufParams.reset()`) and allocates MemFd buffers (`dataType = 1 << SPA_DATA_MemFd`), which pw maps for us. (The earlier `no more input formats` death ~4 s in — run 3 — was a different pod shape; the modifier-free offer with the §48 framerate range fixates cleanly via KWin's SHM EnumFormat.) DMABUF capture (zero-copy) is the hardware-encode-era revisit, not a client-side workaround now.

Repro of any anomaly: run 1.1's ignored manual gate (`cargo test --manifest-path src-tauri/Cargo.toml manual_consent_frame_floor -- --ignored --nocapture`) + `pw-dump --monitor` during the session; the negotiations are all in the JSON.

Logged: 2026-11-01, app build 0.1.0 (task 1.1), host plasma 6 / PipeWire 1.6.11.

### Task 2.6 — native tray and session lifecycle

Logged: 2026-11-08, app `0.0.1-alpha.1` development build; CachyOS,
Plasma/KWin 6.8.2, PipeWire 1.6.10, xdg-desktop-portal-kde 6.8.2.

| Check | Observation |
|---|---|
| Titlebar hide / tray Show | Main window hides and restores. KDE exposes the labeled AppIndicator menu; `Stop & save` renders with its ampersand. |
| Tray Start / Pause / HUD Resume | Start creates the HUD and hides main; Pause changes the menu to Resume; HUD Resume returns the running phase. |
| Tray Stop | Main restores, HUD closes, saved toast shows `0:10`. `first-rec-4.mkv`: SQLite row 2, `ready`, 10412 ms, 1149141 bytes; ffprobe H.264 1920×1080 + AAC, 10.449 s against measured Start→Stop 10.486 s. |
| Second take on the same source → Quit | `first-rec-5.mkv`: row 3, `ready`, 9526 ms, 533906 bytes; ffprobe H.264 1920×1080 + AAC, 9.871 s against measured Start→Quit 10.122 s. Process exited 5.870 s after Quit. |
| Lost source while idle | Destroying only the app-owned `screen-studio-capture` PipeWire node disables tray Start. Pressing main Record is rejected with “Select a capture source before recording (or the source id changed).” No new file/index row was produced. |
| Quit after source loss | One run exited in 0.288 s. Another, after a rejected main Record action, exceeded the 15 s exit gate and later exited on its own before a debugger attached. Replaying source loss → rejected Record → Quit under GDB exited normally in 0.049 s. Both paths removed their PipeWire client and portal source; the library remained at three rows. The earlier shutdown delay remains unresolved; the fast replay does not establish a reliable timing bound. |

Two recording defects found during these checks were reproduced in Rust tests
and fixed in `pipeline/session.rs`:

- **Idle frame backlog contaminated new takes:** a short synthetic take reported
  60066 ms because queued frames predated Start. Start now discards the bounded
  idle backlog before handing the consumer to the recording worker. Regression
  coverage includes first and repeated takes on the same source.
- **Quiet video starved audio muxing:** the AAC queue was drained only when a
  video frame arrived. Native Quit failed with “Audio writing fell too far behind
  the recording.” Audio now drains independently of video arrivals; a synthetic
  four-second PCM tail exceeding the bounded AAC hop verifies complete output.

Earlier `first-rec-2.mkv` has an inflated 60.135 s duration and is **not** timing
success evidence. Failed pre-fix Quit kept the app open with visible error copy.

An earlier portal stream disappeared; a later graph showed a link to webcam
node 82 (MJPG/YUY2), incompatible with the screen consumer's BGRx/BGRA offer.
A fresh monitor selection succeeded without format changes. The cause of that
link/session anomaly is unresolved; runtime node IDs must always be rediscovered.

Evidence retained locally under `/tmp/opencode/`: `task26-fixed-live.png`,
`task26-fixed-save.png`, `task26-lost-start-rejected.png`,
`task26-quit-audio-error.png`, `task26-session-red.log`,
`task26-rust-final.log`, `task26-loss-before-final.json`,
`task26-loss-debug-before.json`, `task26-lost-start-debug.png`, and
`task26-quit-debug-replay.log`. The replay log records the inferior exiting
normally; GDB's exit status 1 came from its subsequent `continue` after exit.
The earlier attach attempt (`task26-quit-hang-stacks.txt`) found no process,
so no stack trace of the delayed shutdown was captured.
Native actions used the real D-Bus tray menu and AT-SPI; screenshots used
Spectacle because WebKit traversal is incomplete in `agent-desktop` here.
These checks do not establish audible mic/system output, mute A/B, the ignored
live-pause gate, or behavior on a compositor without a tray host.

## niri

*Not yet observed.*

## MangoWC

*Not yet observed.*
