# Release & Packaging Audit — ScreenStudio Pro

**Audited:** 2026-11-24  
**Auditor:** Prakash / Antigravity  
**Repository:** `screen-studio-pro` (`https://github.com/zvirox/screen-studio-pro`)

---

## 1. Workflows in `.github/workflows/`

* **`.github/workflows/ci.yml`**:
  * **Trigger:** `push` / `pull_request` on `main`.
  * **Jobs:** `rust` (check, test, clippy), `frontend` (typecheck, lint, vitest), `package-build` (dry run).
* **`.github/workflows/release.yml`**:
  * **Trigger:** `push` on tags matching `v*`.
  * **Jobs:**
    1. `tauri-bundles`: runs `tauri-action` to build `.deb`, `.rpm`, `AppImage`.
    2. `flatpak`: runs 90-minute container build with `flatpak-builder` producing `ScreenStudio-Pro-${GITHUB_REF_NAME}-x86_64.flatpak`.

---

## 2. Existing Packaging Files & Configuration

* **`src-tauri/tauri.conf.json`**:
  * `"productName": "ScreenStudio Pro"`
  * `"bundle": { "active": true, "targets": "all" }`
* **`packaging/` directory contents:**
  * `packaging/flatpak/com.zvirox.screenstudiopro.json` (Flatpak manifest)
  * `packaging/flatpak/com.zvirox.screenstudiopro.desktop`
  * `packaging/flatpak/com.zvirox.screenstudiopro.metainfo.xml`
  * `packaging/flatpak/shared-modules/...` (vendored libappindicator patches, intltool, dbus-glib)

---

## 3. Existing Tags and Release Assets

* **Tags:** `v0.0.1-alpha.1` through `v0.0.1-alpha.9`
* **Latest Release (`v0.0.1-alpha.9`):**
  * `ScreenStudio.Pro_0.0.1+alpha.9_amd64.deb` (4.80 MiB)
  * `ScreenStudio.Pro-0.0.1+alpha.9-1.x86_64.rpm` (4.81 MiB)
  * `ScreenStudio.Pro_0.0.1+alpha.9_amd64.AppImage` (143.01 MiB)
  * `ScreenStudio-Pro-v0.0.1-alpha.9-x86_64.flatpak` (264.08 MiB)
  * *(Notice: No Arch `pkg.tar.zst` package was produced; bloated 143MB AppImage and 264MB Flatpak were shipped)*

---

## 4. Version Alignment Check

| Location | Version | Matches Latest Tag (`v0.0.1-alpha.9`)? |
|---|---|---|
| `src-tauri/Cargo.toml` | `0.0.1+alpha.9` | Matches semver (`+` used because Tauri bundler rejected `-`) |
| `package.json` | `0.0.1+alpha.9` | Matches semver |
| `src-tauri/tauri.conf.json` | `0.0.1+alpha.9` | Matches semver |

---

## 5. Naming Matrix & Identifier Alignment

* **GitHub Repository Name:** `screen-studio-pro`
* **Cargo Binary Name:** `screen-studio-pro` (`src-tauri/Cargo.toml`: `[package] name = "screen-studio-pro"`)
* **Tauri `productName`:** `"ScreenStudio Pro"` (Produced dot-separated asset names `ScreenStudio.Pro`)
* **Tauri Identifier:** `com.zvirox.screenstudiopro`
* **Desktop File:** `packaging/flatpak/com.zvirox.screenstudiopro.desktop`
* **Mismatch Assessment:**
  - Asset filenames had `ScreenStudio.Pro` instead of kebab-case `screen-studio-pro`.
  - Under Rule 1, package name and asset prefix must strictly be `screen-studio-pro`.

---

## 6. Runtime Dependencies & Extra Files

* **Target Binary:** `/usr/bin/screen-studio-pro`
* **Desktop Entry:** `/usr/share/applications/screen-studio-pro.desktop`
* **Icons:** `/usr/share/icons/hicolor/<size>/apps/screen-studio-pro.png`
* **Runtime Dependencies:**
  * Debian/Ubuntu: `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `libpipewire-0.3-0`, `xdg-desktop-portal`
  * Fedora/RPM: `webkit2gtk4.1`, `gtk3`, `libayatana-appindicator-gtk3`, `pipewire-libs`, `xdg-desktop-portal`
  * Arch Linux: `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator`, `pipewire`, `xdg-desktop-portal`
* **Extra daemons / units:** None. Uses Portal & PipeWire user sessions.

---

## 7. Secrets Used

* **`GITHUB_TOKEN`**: Standard repository write token. No external secrets.

---

## 8. Packaging Formats & Migration Action Table

| Format | Present | Job / File Location | Action |
|---|---|---|---|
| **Debian (.deb)** | Yes | `.github/workflows/release.yml` (`tauri-action`) | **Replace** with unified `nfpm` workflow |
| **RPM (.rpm)** | Yes | `.github/workflows/release.yml` (`tauri-action`) | **Replace** with unified `nfpm` workflow |
| **Arch (.pkg.tar.zst)** | No | None | **Add** via unified `nfpm` workflow |
| **AppImage** | Yes | `.github/workflows/release.yml` (`tauri-action`) | **Delete** (stops 143MB AppImage bloat) |
| **Flatpak** | Yes | `.github/workflows/release.yml` (`flatpak` job) & `packaging/flatpak/` | **Delete** job & `packaging/flatpak/` (stops 264MB Flatpak bloat) |
| **AUR Publishing** | No | None | **N/A** |
| **Checksums** | No | None generated in release | **Add** `SHA256SUMS` + signature |
