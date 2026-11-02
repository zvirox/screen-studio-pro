# 02 — OBS UI Map

Sources of truth for this doc: shipped theme `Yami.obt` (2,263 lines; widget `objectName`
selectors) and locale `en-US.ini` namespace counts [HOST]. Titles given below are the exact
shipped strings. Labels per 00-overview.

## 1. Main window regions

The Yami theme's ID selectors name the real widgets of the main window [HOST: extracted from
`#name {` selectors in Yami.obt]:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Menu bar (File Edit View Docks Tools Profile SceneCollection Export Help) │
├───────────────────────────────────────────────────┬──────────────────┤
│ #previewXContainer / #previewYContainer            │  Docks (right/   │
│   preview canvas; #previewZoomInButton/OutButton,   │  bottom, user-   │
│   #previewXScrollBar, #previewYScrollBar,           │  arrangeable):   │
│   #previewScalingMode, #previewScalePercent         │  • #stackedMixerArea│
│                                                   │    (#volMeterFrame,#volLabel)│
│ [contextContainer — the source toolbar,           │  • #transitionsFrame│
│  per-selected-source inline controls]             │  • #broadcastButton│
│                                                   │  • Scenes / Sources│
├───────────────────────────────────────────────────┤  • (thumbnails —  │
│ #controlsFrame                                    │   #thumbnail)     │
│   [Start Streaming/Generic] [Go Live (broadcastButton)]             │
│   [Start Recording] [Start Replay Buffer] [Settings]              │
│   #virtualCamConfigButton (virtual camera)     │
├──────────────────────────────────────────────────────────────────────┤
│ Status bar (11 strings, Basic.StatusBar.*)                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Observations an SSP designer should steal

- **Preview is a first-class scalable canvas** with its own scrollbars, zoom in/out,
  scaling-mode switch, and percent label — recording preview is interactable, not passive.
- **The Context Bar** (`contextContainer`, `Basic.Main.ShowContextBar` =
  "Show Source Toolbar") swaps its entire content per selected source — a property editor docked
  under the preview, separate from both Properties dialog and mixer.
- **Controls row buttons are stateful verbs, not toggles**: `Start Recording` ↔ `Stop Recording`
  ↔ `Stopping Recording…`; recording additionally exposes `Pause Recording`/`Unpause Recording`,
  `Split Recording File`, and `Add Chapter Marker (Hybrid MP4/MOV only)` [HOST: Basic.Main.*] —
  i.e. split-file/chapter actions live *next to* Pause, gated on container format (Hybrid MP4).
- **`#broadcastButton` is styled distinctly** (Twitch/YouTube "Go Live" pattern) and pairs with
  `Basic.Main.SetupBroadcast` ("Manage Broadcast") — streaming has its own hero affordance.

## 2. Dock system

- Docks: Scenes, Sources, Audio Mixer, Transitions (de-facto main four) plus user-creatables
  (`Docks.CustomBrowserDocks`). Menu: **Lock** UI (`Docks.LockDocks`), **Reset** layout
  (`Docks.ResetDocks`), side-dock management (`Docks.SideDocks`), visibility toggles [HOST:
  Basic.MainMenu.Docks.*]. OBS themes must style dockable panels as a widget class (hence
  QSS objectNames).
- Mixer dock: `#stackedMixerArea` (stacked per-channel strips), each with `#volMeterFrame`,
  `#volLabel` [HOST theme] and 24 mixer locale strings (`Basic.AudioMixer.*`, e.g.
  `Mixer`, `Mono`/`Stereo`, `DroppedFrames "%1 (%2%)"`) [HOST locale].

## 3. Complete menu tree (89 items, `Basic.MainMenu.*`)

Verbatim from the shipped locale [HOST]; this is the full functional surface of the app's
menu-bar commands:

- **File**: Settings, Show Recordings, Show Settings Folder, Show Profile Folder, Remux, Show
  Missing Files, Import, Export, Exit
- **Edit**: Undo, Redo, Advanced Audio Properties, Lock Preview, *Order* (Move Up/Down/To
  Top/To Bottom), *Transform* (Edit Transform, Reset, Center to Screen, H/V Center,
  Flip H/V, Rotate 90 CW/CCW, 180, Fit to Screen, Stretch to Screen, Copy/Paste Transform),
  *Scale* (Window, Canvas, Output, Manual, Reset Zoom, Zoom In/Out)
- **View**: Always On Top, Context (bar) toggle, Fullscreen UI, Listbox Toolbars, Reset UI,
  Scene List Mode (grid/list — `Basic.Main.GridMode`/`ListMode`), Source Icons, Status Bar,
  Toolbars
- **Docks**: see §2
- **Tools**: (auto-config "Auto-Optimization Wizard" seeds `Basic.AutoConfig` 58 keys), plus
  plugin-added entries
- **Profile**: (per-output-settings profiles) Exists, Import, Export — profiles are named
  settings sets switchable live
- **Scene Collection**: Import/Export, Migrate, Re-migrate — whole scene-tree as a portable file
- **Help**: Help Portal, Website, Discord, What's New, Release Notes, Check For Updates, Repair,
  Restart Safe Mode/Normal, Logs (Show/View Current/Upload Current/Upload Last), Crash Logs
  (Show/Upload Last), About

## 4. Per-window UI vocabulary in one line each

| Namespace | Count | Covers |
|---|---|---|
| `Basic.Settings.*` | 378 | nine-page settings dialog (see 03-settings-map) |
| `Basic.MainMenu.*` | 89 | menu tree above |
| `Basic.Main.*` | 59 | main-window verbs and dock titles |
| `Basic.AutoConfig.*` | 58 | first-run optimization wizard |
| `Basic.TransformWindow.*` | 39 | Edit-Transform dialog |
| `Basic.AudioMixer.*` | 24 | mixer dock |
| `Basic.Stats.*` | 20 | stats dock (dropped frames, bitrate, memory, CPU) |
| `Basic.AdvAudio.*` | 16 | per-source advanced audio (sync offset, tracks 1–6) |
| `Basic.PropertiesWindow.*` | 14 | source properties dialog |
| `Basic.SourceSelect.*` | 11 | add-source dialog (create new / add existing / visibility) |
| `Basic.StatusBar.*` | 11 | status bar incl. reconnect/delay/saved-to announcements |
| `Basic.VCam.*` | 6 | virtual camera |
| `Basic.Filters.*` | 6 | per-source filter dialog |

## 5. Theming (design-system precedent)

OBS ships one flagship theme (`Yami.obt`, 2,263 lines of Qt stylesheet describing *tokens*
per objectName) with **six optical variants** (`Yami_Acri/Classic/Default/Grey/Light/Rachni.ovt`,
plus legacy themes Acri/Dark/Light/Rachni/System) [HOST]. The variant file is small and only
overrides variables — same architecture as DESIGN.md's token set with a secondary light theme.
Also shipped: stateful SVG assets per control state (e.g.
`checkbox_checked_disabled.svg`, `checkbox_checked_focus.svg`) — every control ships
focus/disabled art, not just checked/unchecked [HOST: themes/Yami/ asset list].

SSP takeaway: DESIGN.md's closed token set maps cleanly onto this pattern (token theme +
variant override files if/when a light theme ships).
