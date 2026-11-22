# Vendored Flatpak shared modules

These build recipes come from [Flathub `shared-modules`](https://github.com/flathub/shared-modules),
imported unchanged at commit `d3a85ee07ae4ff98fe7561f958ac58ac9e6e39bd` (2026-11-21).

Imported files:

- `libappindicator/libappindicator-gtk3-12.10.json` and its four patches
- `intltool/intltool-0.51.json` and its Perl compatibility patch
- `dbus-glib/dbus-glib.json`

Tauri's Linux tray integration loads `libappindicator3.so.1` dynamically. The GNOME 48
runtime does not provide it or its libdbusmenu/libindicator dependencies, so the recipes
are vendored here instead of adding a git submodule to the release build.
