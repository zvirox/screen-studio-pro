# src/fonts — self-hosted webfonts

All bundled faces ship under the **SIL Open Font License 1.1** (`OFL.txt` in each upstream repo), which permits
redistribution and web embedding. Licenses ship with the app bundle.

| File | Face | Upstream |
|---|---|---|
| `Inter-*.woff2` | Inter (variable, wght 400–700) — latin + latin-ext | https://github.com/rsms/inter |
| `JetBrainsMono-*.woff2` | JetBrains Mono (variable, wght 400–600) — latin + latin-ext | https://github.com/JetBrains/JetBrainsMono |

Subsets downloaded from the Google Fonts v2 API (variable woff2). DESIGN.md §3 forbids a hosted
CDN stylesheet in the app — these files are served locally and are the only sanctioned delivery.
