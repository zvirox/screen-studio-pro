# src/fonts — self-hosted webfonts

Both faces ship under the **SIL Open Font License 1.1** (~/OFL.txt in each repo), which permits
 redistribution and web embedding. Licenses must ship with the app bundle (packaging task 7.x).

| File | Face | Upstream |
|---|---|---|
| `FamiljenGrotesk-*.woff2` | Familjen Grotesk (variable, wght 400–700) — latin + latin-ext | https://github.com/fourstacks/familjen-grotesk |
| `JetBrainsMono-*.woff2` | JetBrains Mono (variable, wght 400–600) — latin + latin-ext | https://github.com/JetBrains/JetBrainsMono |

Subsets downloaded from the Google Fonts v2 API (variable woff2). DESIGN.md §3 forbids a hosted
CDN stylesheet in the app — these files are served locally and are the only sanctioned delivery.
