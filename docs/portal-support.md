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
| Window capture | ✅ | Portal window picker (`SourceType::Window`) works; KDE's xdg-desktop-portal-kde presents the window tab. User selects a window, consent granted, stream starts. |
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

### Task 3.1 — window capture (M2)

Logged: 2026-11-08, app `0.0.1-alpha.1` development build; CachyOS,
Plasma/KWin 6.8.2, PipeWire 1.6.10, xdg-desktop-portal-kde 6.8.2.

| Check | Observation |
|---|---|
| Window picker | `SourceType::Window` consent dialog appears with KDE's window tab; user selects a target window. |
| Stream start | After consent, PipeWire stream starts with the window's geometry; frame bus receives frames. |
| Unsupported compositor | `portal.windowCapture` capability probe returns `false` on unknown compositors; the Window chip is hidden from the SourceDeck. |
| SourceDeck UI | Two chips (Monitor + Window) render side-by-side when `windowCapture: true`; only Monitor when `false`. Selecting state shows "Working…" on the active chip. |

Implementation: `select_window` in `capture/portal.rs` mirrors `select_monitor` with `SourceType::Window`. The `source_select` command dispatches based on `kind`. Capability probe sets `portal.windowCapture` conservatively (`true` for KDE/Plasma). Source state gains `selectingKind` to track which chip is loading. Tests updated for the new flow.

## niri

*Not yet observed.*

## MangoWC

*Not yet observed.*

### Phase 2 live gates — 2026-11-17 (audio A/B, meters, flags, live pause)

Logged on the live CachyOS / Plasma 6 / KWin 6.8.2 / Wayland box, PipeWire
1.6.11, with the real `xdg-desktop-portal-kde` consent dialog. The user
approved live recordings, tones and consent; the Allow click was performed
through the dialog's own AT-SPI tree (select "Laptop screen" → dialog accepts).

| Check | Observation |
|---|---|
| `manual_pause_excludes_paused_time` | Real portal consent, 3 s record / 5 s pause / 3 s resume. Take `duration_ms=5986`, `paused_ticks=5`; ffprobe duration in the 4–8.5 s window — the pause is excluded from the encoded timeline. PASS. |
| Live A/B — mic unmuted | Real take, h264 + aac @ 48 kHz. 440 Hz band −27.7 dB, 880 Hz band −27.5 dB: both tones in the file. Mic meter peak 0.12497. |
| Live A/B — mic muted | 440 Hz band −63.7 dB (gone), 880 Hz band −27.5 dB (desktop intact). Mic meter peak exactly 0.0, desktop 0.12497. PASS — mute is reflected in the file and the bar. |
| Flags → sqlite | 3 flags in each take at 1000/2000/3000 ms; `chapter_json` JSON array round-tripped through a real `library.db` row via `LibraryHandle::record_finalize` → `library_get`; `audio_json` present. PASS. |

Tone rig and limits observed here (rig details, not product-path failures):
`pactl load-module module-null-sink sink_name=ssp_test` + default source
`ssp_test.monitor` carried the injected 440 Hz at −21 dB; the real default
speaker sink carried 880 Hz at −33 dB (volume 0.25). `pw-record --target
ssp_test --format f32 --container raw` captured the null-sink monitor at
−21 dB and fed the mic-designated ring through a test-side thread. cpal's
f32 input streams on this box's ALSA virtual devices (default / pulse /
pipewire) open but deliver **no samples**, even though `arecord -D
default|pipewire` captures the same tone at −21 dB; a pinned `start_desktop`
capture leg likewise did not carry it. No passwordless sudo for `snd_aloop`.
The rig feeder's sample clock runs ~2× real time (file probes ~7.6 s vs a
3.9 s take); the session's own duration (3877/3893 ms) is the product fact.

Band levels were measured with ffmpeg `volumedetect` after three cascaded
20 Hz high-Q `bandpass` filters; the filter chain rejects the off-tone by
64 dB (verified on the pure 440/880 files). A single lowpass leaked the
strong 880 Hz tone into the 440 Hz probe and gave a false "mic present"
reading — the sharp filter and the live meter peak together removed that
false positive.

Evidence retained locally: `/tmp/opencode/p2-pause-gate.log`,
`/tmp/opencode/p2-audio-ab.log`, `/tmp/opencode/p2-clippy.log`,
`/tmp/opencode/p2-vitest.log`. Verification after the new ignored gate:
`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test --lib` (137 pass / 5 ignored), `npx tsc --noEmit`,
`npx eslint src`, `npx vitest run` (219 pass) — all clean. The no-default-
features Clippy red on the unused `library/mod.rs` re-export stays queued
for Phase 5; CI gates default features only.

Still unresolved: the >15 s Quit-after-rejected-Record anomaly (a GDB replay
exited in 0.049 s), the disappeared portal source / wrong webcam link, and
behavior on a compositor without a tray host. A further timed replay was not
driven on 2026-11-17: the app process had exited before the gate was reached,
and the main window's Record button is not on the AT-SPI bus here (no
coordinate-input fallback), so the rejected-Record step cannot be injected
headlessly. Human ears on a real mic remain optional — measured band levels
are the agreed accept signal.
