# OBS Studio 32.2.2 — Reverse-Engineering Evidence Base for SSP

**Purpose.** OBS Studio is the maturity benchmark for ScreenStudio Pro. This set of docs records
what the *installed OBS build on this machine actually ships* — its architecture, UI, settings,
and workflows — so that SSP implementation decisions can cite observed behavior instead of memory
or folklore. Read this index first; per-topic docs cite their own evidence.

## What was analyzed

| Item | Value | Source |
|---|---|---|
| Package | `obs-studio 32.2.2-3.fc45`, x86_64, GPL-2.0-or-later | `rpm -qi obs-studio` (host observation) |
| Install size | 16,649,357 B across **1,762 files** | `rpm -ql obs-studio | wc -l` |
| Frontend binary | `/usr/bin/obs` (5,621,088 B), links **Qt6** (Core, DBus, Gui, Network, Svg, Widgets, Xml) | `ldd /usr/bin/obs` |
| Core library | `/usr/lib64/libobs.so.30` (1,154,992 B), sha256 `d6f239697a85ca66e9965a5db0de70b5f0b37a908e85b43eb8a2675bc4d4c5bc` | REA `open_binary` |
| Frontend API bridge | `/usr/lib64/libobs-frontend-api.so.30` (obs binary is dynamically linked against it and libobs) | `ldd /usr/bin/obs` |
| Plugin binaries | **29 `.so`** in `/usr/lib64/obs-plugins/` | `ls /usr/lib64/obs-plugins` |
| Shipped data | `/usr/share/obs/obs-plugins/` **1,435 files** (per-plugin locale + defaults), `/usr/share/obs/libobs/` 22 GLSL effect files, `/usr/share/obs/obs-studio/` (themes, locale, images) | rpm file list |
| UI vocabulary | `/usr/share/obs/obs-studio/locale/en-US.ini` — **1,683 keys**, every string OBS renders | grep inventory |
| Theme system | `themes/Yami.obt` (2,263 lines) + `Yami_*.{obt,ovt}` variants, plus Acri/Dark/Light/Rachni/System | rpm file list |
| Build version string | `obs --version` → `OBS Studio - 32.2.2` | host observation |

## Method and evidence hygiene

Three evidence classes were used, and every claim in these docs is labeled with one:

1. **[REA]** — Evidence records from the REA analysis session (binary-level inspection). The
   libobs export table is retained Evidence, parent ID
   `ev_c211a329134862d124d10dbd673c6e0336f04a3665a208db9efe1a4812b829f0`
   (complete: 1,756 defined dynamic exports for the sha256 above).
2. **[HOST]** — Direct shell observation of the installed package: `rpm -ql`, `ldd`,
   `strings` on plugin binaries, reading shipped locale/theme files. These are observations of
   shipped *data*, not of running behavior.
3. **[INFER]** — Inference from the above (e.g. thread model deduced from API shape). Explicitly
   marked, never cited as observation.

**Unknowns are real unknowns.** No execution tracing of OBS was performed; no decompilation of
function bodies (the export *names* and shipped data carry the conclusions). Plugin internals
beyond their exported 8-symbol ABI and their shipped locale/defaults are unknown. Where a
conclusion rests on a filename, it says so.

## Evidence ID register (REA)

| Evidence ID | Operation | Subject |
|---|---|---|
| `ev_c211a3…2b829f0` | `inspect_native_exports` (complete, 1,756 exports) | `/usr/lib64/libobs.so.30` |
| `ev_59985….cff2b5005` | `inspect_analysis_view` summary of the above | libobs exports summary |
| `ev_5b8d8a…406f8388` | `inspect_native_exports` (8 exports) | `/usr/lib64/obs-plugins/obs-ffmpeg.so` |
| `ev_468147…86af5ab` | `inspect_native_exports` receipt | obs-ffmpeg.so |
| `ev_f37808…b5b549` | receipt | linux-pipewire.so |
| `ev_51c406…e1e28` | receipt | obs-outputs.so |
| `ev_9eef4c…d8055371` | receipt | obs-websocket.so |
| `ev_c1dd19…ddce05` | receipt | obs-nvenc.so |
| `ev_f981d5…6e2fe4e9` | receipt | linux-pulseaudio.so |

## Document map

| Doc | Contents |
|---|---|
| [01-architecture.md](01-architecture.md) | Process/library layering, plugin ABI, libobs export-surface classification, media data flow, render pipeline |
| [02-ui-map.md](02-ui-map.md) | Main-window regions (widget-level), complete menu tree, dock system, theming |
| [03-settings-map.md](03-settings-map.md) | All 9 settings pages with their option inventories; profiles & scene collections |
| [04-workflows.md](04-workflows.md) | How user requests are fulfilled: record, stream, replay, pause/split/chapters, vcam, auto-config, remux |
| [05-feature-matrix-and-ssp-mapping.md](05-feature-matrix-and-ssp-mapping.md) | OBS capability matrix mapped onto SSP PRD milestones M1–M14/V2, with adopt/borrow/defer rulings |

## Reading rules for SSP work

- These docs are **research input, not contracts**. They never override PRD.md scope decisions;
  where OBS has a feature SSP's PRD defers to V2 (scenes, streaming), the matrix says so rather
  than quietly expanding scope.
- Anything harvested into an SSP contract (API.md, DESIGN.md, ARCHITECTURE.md) must go through
  the normal contract-editing workflow, in the same task as the code.
