# portal-support.md — compositor quirks matrix

**Status: placeholder** — populated from the first real capture runs (PLAN task 1.1+),
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

## niri

*Not yet observed.*

## MangoWC

*Not yet observed.*
