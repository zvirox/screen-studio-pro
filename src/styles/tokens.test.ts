import { describe, expect, it } from "vitest";

/* src/styles/tokens.test.ts — Feature 1: Design Tokens & Linear Palette
   Provenance: DESIGN.md v6.1 (Unified Linear-Style Design System — Final & Locked)
   Verifies:
   - Tier 1: Core dark/light palette tokens, the per-app Burgundy accent, recording-only
     red, minimal rounding scale, one card shadow, and approved alpha token roles
   - Tier 2: WCAG contrast floors, reduced-motion overrides, solid utilities, z-level scale */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (mod: string) => any;

function readCss(filePath: string): string {
  const fs = require("fs");
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = globalThis as any;
  const cwd = globalAny.process ? globalAny.process.cwd() : ".";
  const cssPath = path.resolve(cwd, filePath);
  return fs.readFileSync(cssPath, "utf-8") as string;
}

function hasToken(cssText: string, name: string): boolean {
  return new RegExp(`${name}:\\s*[^;]+;`).test(cssText);
}

const css = readCss("src/tailwind.css");
const themeCss = readCss("src/styles/linear-theme.css");
const accentCss = readCss("src/styles/app-accent.css");
const recordingCss = readCss("src/styles/recording-tokens.css");

function getRelativeLuminance(hex: string): number {
  const sanitized = hex.replace("#", "");
  const r = parseInt(sanitized.substring(0, 2), 16) / 255;
  const g = parseInt(sanitized.substring(2, 4), 16) / 255;
  const b = parseInt(sanitized.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Feature 1: Linear Design Tokens & Surface System (Tier 1)", () => {
  it("F1-T1-01: declares the dark palette roles", () => {
    const dark = themeCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(
      [
        "--bg-app",
        "--bg-surface-2",
        "--bg-hover",
        "--bg-track",
        "--border",
        "--text",
        "--text-secondary",
        "--text-muted",
        "--text-faint",
      ].every((name) => hasToken(dark, name)),
    ).toBe(true);
  });

  it("F1-T1-02: defines the shared series palette, the Burgundy accent and the recording red", () => {
    expect(
      ["--blue", "--sky", "--sky-text", "--amber", "--red", "--red-text", "--chip-sky", "--chip-red"].every(
        (name) => hasToken(themeCss, name),
      ),
    ).toBe(true);
    // Green and teal are removed from the shared palette.
    expect(hasToken(themeCss, "--green")).toBe(false);
    expect(hasToken(themeCss, "--teal")).toBe(false);
    expect(
      ["--primary", "--primary-hover", "--primary-fg", "--primary-text", "--primary-tint", "--primary-border"].every(
        (name) => hasToken(accentCss, name),
      ),
    ).toBe(true);
    expect(hasToken(recordingCss, "--rec-red")).toBe(true);
  });

  it("F1-T1-02a: matches the byte-identical shared theme and accent references", () => {
    const crypto = require("crypto");
    const themeDigest = crypto.createHash("sha256").update(themeCss).digest("hex") as string;
    const accentDigest = crypto.createHash("sha256").update(accentCss).digest("hex") as string;
    expect(themeDigest).toBe("90d28b21ec7d9964400bddfed725802585a51499a9f37ea4d3a4899dd3da4695");
    expect(accentDigest).toBe("93c397ac30645e1f62dc8b5bf37af9c6ca5fba38cd8f3552d1217988e61f6ecf");
  });

  it("F1-T1-03: defines minimal Linear rounding scale in @theme inline (4px/6px/8px)", () => {
    expect(css).toContain("--radius-none: 0px;");
    expect(css).toContain("--radius-xs: 4px;");
    expect(css).toContain("--radius-sm: 6px;");
    expect(css).toContain("--radius-md: 8px;");
    expect(css).toContain("--radius-lg: 8px;");
  });

  it("F1-T1-04: allows the card shadow and alpha only on approved tokens", () => {
    expect(themeCss).toContain("--shadow-card:");
    expect(themeCss).toContain("--scrim:");
    expect(themeCss).toContain("--chart-fade-up:");
    expect(themeCss).toContain("--chart-fade-down:");
    expect(themeCss).toContain("box-shadow: var(--shadow-card);");
  });

  it("F1-T1-05: provides the light theme values", () => {
    const light = themeCss.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(
      [
        "--bg-app",
        "--bg-surface",
        "--bg-surface-2",
        "--bg-hover",
        "--border",
        "--border-strong",
        "--text",
        "--text-muted",
        "--text-faint",
      ].every((name) => hasToken(light, name)),
    ).toBe(true);
  });

  it("F1-T1-06: carries DESIGN.md v6.1 provenance and self-hosted Inter font face", () => {
    expect(css).toMatch(/\/\*\s*DESIGN\.md v6\.1\s*\*\//);
    expect(css).toContain("Provenance: DESIGN.md v6.1");
    expect(css).toContain('font-family: "Inter";');
    expect(css).toContain("--font-sans: \"Inter\", system-ui, -apple-system, sans-serif;");
  });
});

describe("Feature 1: Linear Design Tokens & Accessibility (Tier 2 Boundary & Edge)", () => {
  it("F1-T1-07: keeps Inter type scale and outline focus indicators theme-aware", () => {
    expect(css).toContain("--text-body-md: 0.875rem;");
    expect(css).toContain("--text-body-sm: 0.8125rem;");
    expect(css).toContain("--color-focus: var(--primary-text);");
    expect(css).toContain("outline: 2px solid var(--primary-text);");
  });

  it("F1-T2-01: enforces WCAG contrast floors for copy, accent and status in dark and light modes", () => {
    const dark = themeCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const light = themeCss.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const darkAccent = accentCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const lightAccent = accentCss.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const darkRecording = recordingCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const lightRecording = recordingCss.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const token = (block: string, name: string) =>
      block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];

    const darkBg = token(dark, "--bg-app")!;
    const darkText = token(dark, "--text")!;
    const lightBg = token(light, "--bg-app")!;
    const lightText = token(light, "--text")!;

    const darkPrimary = token(darkAccent, "--primary")!;
    const darkPrimaryFg = token(darkAccent, "--primary-fg")!;
    const darkPrimaryHover = token(darkAccent, "--primary-hover")!;
    const darkPrimaryText = token(darkAccent, "--primary-text")!;
    const darkPrimaryTint = token(darkAccent, "--primary-tint")!;
    const lightPrimary = token(lightAccent, "--primary")!;
    const lightPrimaryFg = token(lightAccent, "--primary-fg")!;
    const lightPrimaryHover = token(lightAccent, "--primary-hover")!;
    const lightPrimaryText = token(lightAccent, "--primary-text")!;
    const lightPrimaryTint = token(lightAccent, "--primary-tint")!;

    const darkSurface = token(dark, "--bg-surface")!;
    const lightSurface = token(light, "--bg-surface")!;
    const darkChipSky = token(dark, "--chip-sky")!;
    const lightChipSky = token(light, "--chip-sky")!;
    const darkChipRed = token(dark, "--chip-red")!;
    const lightChipRed = token(light, "--chip-red")!;

    // Copy
    expect(getContrastRatio(darkText, darkBg)).toBeGreaterThanOrEqual(17.0);
    expect(getContrastRatio(lightText, lightBg)).toBeGreaterThanOrEqual(15.0);
    expect(
      getContrastRatio(token(dark, "--text-muted")!, token(dark, "--bg-surface-2")!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(token(light, "--text-muted")!, token(light, "--bg-surface-2")!),
    ).toBeGreaterThanOrEqual(4.5);

    // Primary button text
    expect(getContrastRatio(darkPrimaryFg, darkPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(lightPrimaryFg, lightPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(darkPrimaryFg, darkPrimaryHover)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(lightPrimaryFg, lightPrimaryHover)).toBeGreaterThanOrEqual(4.5);

    // Primary text (links, focus) and assigned chip
    expect(getContrastRatio(darkPrimaryText, darkSurface)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(lightPrimaryText, lightSurface)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(darkPrimaryText, darkPrimaryTint)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(lightPrimaryText, lightPrimaryTint)).toBeGreaterThanOrEqual(4.5);

    // Primary graphic (switch, fill) on surface
    expect(getContrastRatio(darkPrimary, darkSurface)).toBeGreaterThanOrEqual(3.0);
    expect(getContrastRatio(lightPrimary, lightSurface)).toBeGreaterThanOrEqual(3.0);

    // Status chips
    expect(getContrastRatio(token(dark, "--sky-text")!, darkChipSky)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(light, "--sky-text")!, lightChipSky)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(dark, "--red-text")!, darkChipRed)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(light, "--red-text")!, lightChipRed)).toBeGreaterThanOrEqual(4.5);

    // Recording red (live dot / timer)
    expect(getContrastRatio(token(darkRecording, "--rec-red")!, darkBg)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(lightRecording, "--rec-red")!, lightBg)).toBeGreaterThanOrEqual(4.5);

    // Close button hover
    expect(getContrastRatio(darkText, token(dark, "--close-hover")!)).toBeGreaterThanOrEqual(3.0);
    expect(getContrastRatio(lightText, token(light, "--close-hover")!)).toBeGreaterThanOrEqual(3.0);
  });

  it("F1-T2-02: enforces prefers-reduced-motion override", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important;");
    expect(css).toContain("transition-duration: 0.01ms !important;");
    expect(css).toContain("animation-iteration-count: 1 !important;");
  });

  it("F1-T2-03: implements flat Linear surface utilities with the tokenized card shadow", () => {
    expect(css).toContain("@utility studio-deck {");
    expect(css).toContain("background-color: var(--bg-surface);");
    expect(css).toContain("border: 1px solid var(--border);");
    expect(css).toContain("box-shadow: var(--shadow-card);");
    expect(css).toContain("@utility hero-canvas {");
    expect(css).not.toContain("csd-dot-");
  });

  it("F1-T2-04: strictly adheres to monotonic fixed z-level scale", () => {
    const zBase = parseInt(css.match(/--ssp-z-base:\s*(\d+);/)?.[1] ?? "-1", 10);
    const zSticky = parseInt(css.match(/--ssp-z-sticky:\s*(\d+);/)?.[1] ?? "-1", 10);
    const zOverlay = parseInt(css.match(/--ssp-z-overlay:\s*(\d+);/)?.[1] ?? "-1", 10);
    const zToast = parseInt(css.match(/--ssp-z-toast:\s*(\d+);/)?.[1] ?? "-1", 10);
    const zModal = parseInt(css.match(/--ssp-z-modal:\s*(\d+);/)?.[1] ?? "-1", 10);
    const zHud = parseInt(css.match(/--ssp-z-hud:\s*(\d+);/)?.[1] ?? "-1", 10);

    expect(zBase).toBe(0);
    expect(zSticky).toBe(10);
    expect(zOverlay).toBe(40);
    expect(zToast).toBe(50);
    expect(zModal).toBe(60);
    expect(zHud).toBe(70);
  });

  it("F1-T2-05: maps semantic Tailwind colors exclusively to CSS variables without hex literals in @theme", () => {
    const themeMatch = css.match(/@theme inline\s*\{([\s\S]*?)\}/);
    expect(themeMatch).not.toBeNull();
    const themeBody = themeMatch![1];

    expect(themeBody).toContain("--color-canvas: var(--bg-app);");
    expect(themeBody).toContain("--color-app: var(--bg-app);");
    expect(themeBody).toContain("--color-primary: var(--primary);");
    expect(themeBody).toContain("--color-primary-fg: var(--primary-fg);");
    expect(themeBody).toContain("--color-raised: var(--bg-surface);");
    expect(themeBody).toContain("--color-accent: var(--primary-text);");
    expect(themeBody).toContain("--color-signal: var(--rec-red);");
    expect(themeBody).toContain("--color-success: var(--sky);");
    expect(themeBody).toContain("--color-ink: var(--text);");
    expect(themeBody).not.toContain("--color-record");
    expect(themeBody).not.toContain("--color-green");

    const hexInColorToken = /--color-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/.test(themeBody);
    expect(hexInColorToken).toBe(false);
  });
});