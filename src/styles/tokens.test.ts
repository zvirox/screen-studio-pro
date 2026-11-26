import { describe, expect, it } from "vitest";

/* src/styles/tokens.test.ts — Feature 1: Design Tokens & Linear Palette
   Provenance: DESIGN.md v6.0 (Unified Linear-Style Design System — Final & Locked)
   Verifies:
   - Tier 1: Core dark/light palette tokens, recording-only colors, minimal rounding scale,
     one card shadow, and approved alpha token roles
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
  it("F1-T1-01: declares the new dark palette roles", () => {
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

  it("F1-T1-02: defines the new chart palette and recording-only colors", () => {
    expect(["--blue", "--blue-text", "--green", "--green-text", "--red"].every((name) => hasToken(themeCss, name))).toBe(true);
    expect(
      ["--rec-burgundy", "--rec-burgundy-border", "--rec-red", "--rec-burgundy-text"].every((name) =>
        hasToken(recordingCss, name),
      ),
    ).toBe(true);
  });

  it("F1-T1-02a: matches the byte-identical shared theme reference", () => {
    const crypto = require("crypto");
    const digest = crypto.createHash("sha256").update(themeCss).digest("hex") as string;
    expect(digest).toBe("8f939da3eb48b2f04a80b5bc2f85c45a8ed2794cfc267744c32e8e5fae47d0f4");
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

  it("F1-T1-06: carries DESIGN.md v6.0 provenance and self-hosted Inter font face", () => {
    expect(css).toMatch(/\/\*\s*DESIGN\.md v6\.0\s*\*\//);
    expect(css).toContain("Provenance: DESIGN.md v6.0");
    expect(css).toContain('font-family: "Inter";');
    expect(css).toContain("--font-sans: \"Inter\", system-ui, -apple-system, sans-serif;");
  });
});

describe("Feature 1: Linear Design Tokens & Accessibility (Tier 2 Boundary & Edge)", () => {
  it("F1-T1-07: keeps Inter type scale and outline focus indicators theme-aware", () => {
    expect(css).toContain("--text-body-md: 0.875rem;");
    expect(css).toContain("--text-body-sm: 0.8125rem;");
    expect(css).toContain("--color-focus: var(--blue-text);");
    expect(css).toContain("outline: 2px solid var(--blue-text);");
  });

  it("F1-T2-01: enforces WCAG AAA contrast ratio floor (> 7.0:1) for primary copy in dark and light modes", () => {
    const dark = themeCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const light = themeCss.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const darkRecording = recordingCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const lightRecording = recordingCss.match(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const token = (block: string, name: string) =>
      block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];

    const darkBg = token(dark, "--bg-app")!;
    const darkText = token(dark, "--text")!;
    const lightBg = token(light, "--bg-app")!;
    const lightText = token(light, "--text")!;
    const darkPrimaryBg = token(dark, "--btn-primary-bg")!;
    const darkPrimaryText = token(dark, "--btn-primary-text")!;
    const lightPrimaryBg = token(light, "--btn-primary-bg")!;
    const lightPrimaryText = token(light, "--btn-primary-text")!;
    const darkBurgundy = token(darkRecording, "--rec-burgundy")!;
    const lightBurgundy = token(lightRecording, "--rec-burgundy")!;
    const darkChipRed = token(dark, "--chip-red")!;
    const lightChipRed = token(light, "--chip-red")!;
    const darkChipGreen = token(dark, "--chip-green")!;
    const lightChipGreen = token(light, "--chip-green")!;

    expect(getContrastRatio(darkText, darkBg)).toBeGreaterThanOrEqual(17.0);
    expect(getContrastRatio(lightText, lightBg)).toBeGreaterThanOrEqual(15.0);
    expect(getContrastRatio(darkPrimaryText, darkPrimaryBg)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(lightPrimaryText, lightPrimaryBg)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(darkRecording, "--rec-burgundy-text")!, darkBurgundy)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(lightRecording, "--rec-burgundy-text")!, lightBurgundy)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(darkRecording, "--rec-red")!, darkBg)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(lightRecording, "--rec-red")!, lightBg)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(dark, "--red-text")!, darkChipRed)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(light, "--red-text")!, lightChipRed)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(dark, "--green-text")!, darkChipGreen)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(light, "--green-text")!, lightChipGreen)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(dark, "--text-muted")!, token(dark, "--bg-surface-2")!)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(token(light, "--text-muted")!, token(light, "--bg-surface-2")!)).toBeGreaterThanOrEqual(4.5);
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
    expect(themeBody).toContain("--color-btn: var(--btn-primary-bg);");
    expect(themeBody).toContain("--color-raised: var(--bg-surface);");
    expect(themeBody).toContain("--color-accent: var(--blue-text);");
    expect(themeBody).toContain("--color-signal: var(--rec-red);");
    expect(themeBody).toContain("--color-ink: var(--text);");
    expect(themeBody).toContain("--color-record: var(--rec-burgundy);");

    const hexInColorToken = /--color-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/.test(themeBody);
    expect(hexInColorToken).toBe(false);
  });
});
