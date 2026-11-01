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

*Not yet observed.*

## niri

*Not yet observed.*

## MangoWC

*Not yet observed.*
