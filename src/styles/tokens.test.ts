import { describe, expect, it } from "vitest";

/* src/styles/tokens.test.ts — Feature 1: Design Tokens & Linear Palette
   Provenance: DESIGN.md v5.0 (Unified Linear-Style Design System — Final & Locked)
   Verifies:
   - Tier 1: Core Linear dark & light palette tokens, recording-only Burgundy/Signal tokens,
     minimal rounding scale (4/6/8px), zero dark-mode shadows, zero blur/rgba
   - Tier 2: WCAG contrast floors, prefers-reduced-motion overrides, solid utilities, z-level scale */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (mod: string) => any;

function getTailwindCss(): string {
  const fs = require("fs");
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = globalThis as any;
  const cwd = globalAny.process ? globalAny.process.cwd() : ".";
  const cssPath = path.resolve(cwd, "src/tailwind.css");
  return fs.readFileSync(cssPath, "utf-8") as string;
}

const css = getTailwindCss();

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
  it("F1-T1-01: declares exact Linear dark palette root variables in :root", () => {
    expect(css).toContain("--bg-app: #050505;");
    expect(css).toContain("--bg-surface: #111213;");
    expect(css).toContain("--bg-surface-2: #1A1B1E;");
    expect(css).toContain("--bg-bar-idle: #202128;");
    expect(css).toContain("--border: #1F2125;");
    expect(css).toContain("--border-strong: #2C2E33;");
    expect(css).toContain("--text: #F5F5F6;");
    expect(css).toContain("--text-muted: #8A8B91;");
    expect(css).toContain("--text-faint: #5A5B62;");
  });

  it("F1-T1-02: defines Linear accent tokens plus Studio Burgundy / Broadcast Signal Red recording-only tokens", () => {
    expect(css).toContain("--accent-blue: #3355FF;");
    expect(css).toContain("--accent-sky: #38B6F0;");
    expect(css).toContain("--accent-green: #22C55E;");
    expect(css).toContain("--accent-red: #F43F5E;");
    expect(css).toContain("--accent-amber: #EAB308;");
    expect(css).toContain("--accent-teal: #1FB5A5;");
    expect(css).toContain("--accent-pink: #EC4899;");
    expect(css).toContain("--accent-purple: #7C5CE6;");
    expect(css).toContain("--accent-orange: #F97316;");
    expect(css).toContain("--close-hover: #E5484D;");

    expect(css).toContain("--ssp-accent: #A3284E;");
    expect(css).toContain("--ssp-signal: #C92A2A;");
  });

  it("F1-T1-03: defines minimal Linear rounding scale in @theme inline (4px/6px/8px)", () => {
    expect(css).toContain("--radius-none: 0px;");
    expect(css).toContain("--radius-xs: 4px;");
    expect(css).toContain("--radius-sm: 6px;");
    expect(css).toContain("--radius-md: 8px;");
    expect(css).toContain("--radius-lg: 8px;");
  });

  it("F1-T1-04: enforces zero shadows in dark mode and restrained card hairline shadow in light mode only", () => {
    expect(css).toContain("--ssp-shadow-card: none;");
    expect(css).toContain("--ssp-shadow-card: 0 1px 2px rgb(16 24 40 / 5%);");
    expect(css).toContain("--shadow-card: var(--ssp-shadow-card);");
    expect(css).not.toContain("rgba(");
    expect(css).not.toContain("hsla(");
  });

  it("F1-T1-05: provides complete Linear light mode face overrides in :root[data-theme=\"light\"]", () => {
    expect(css).toContain(':root[data-theme="light"],');
    expect(css).toContain(".light {");
    expect(css).toContain("--bg-app: #F3F4F6;");
    expect(css).toContain("--bg-surface: #FFFFFF;");
    expect(css).toContain("--bg-surface-2: #F4F5F7;");
    expect(css).toContain("--bg-bar-idle: #EAF0FF;");
    expect(css).toContain("--border: #E5E7EB;");
    expect(css).toContain("--border-strong: #D1D5DB;");
    expect(css).toContain("--text: #0F1115;");
    expect(css).toContain("--text-muted: #6B7280;");
    expect(css).toContain("--text-faint: #9CA3AF;");
  });

  it("F1-T1-06: carries DESIGN.md v5.0 provenance comment and self-hosted Inter font face", () => {
    expect(css).toMatch(/\/\*\s*DESIGN\.md v5\.0\s*\*\//);
    expect(css).toContain("Provenance: DESIGN.md v5.0");
    expect(css).toContain('font-family: "Inter";');
    expect(css).toContain("--font-sans: \"Inter\", system-ui, -apple-system, sans-serif;");
  });
});

describe("Feature 1: Linear Design Tokens & Accessibility (Tier 2 Boundary & Edge)", () => {
  it("F1-T1-07: keeps Inter type scale and outline focus indicators theme-aware", () => {
    expect(css).toContain("--text-body-md: 0.875rem;");
    expect(css).toContain("--text-body-sm: 0.8125rem;");
    expect(css).toContain("--color-focus: var(--ssp-border-focus);");
    expect(css).toContain("outline: 2px solid var(--ssp-border-focus);");
  });

  it("F1-T2-01: enforces WCAG AAA contrast ratio floor (> 7.0:1) for primary copy in dark and light modes", () => {
    const rootBlockMatch = css.match(/(?:^|\n):root\s*\{([\s\S]*?)\}/);
    expect(rootBlockMatch).not.toBeNull();
    const rootBlock = rootBlockMatch?.[1] ?? "";

    const darkBgApp = rootBlock.match(/--bg-app:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const darkText = rootBlock.match(/--text:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const darkAccent = rootBlock.match(/--ssp-accent:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const darkAccentText = rootBlock.match(/--ssp-accent-text:\s*(#[0-9a-fA-F]{6});/)?.[1];

    expect(darkBgApp).toBeDefined();
    expect(darkText).toBeDefined();
    expect(darkAccent).toBeDefined();
    expect(darkAccentText).toBeDefined();

    const lightBlockMatch = css.match(/(?:^|\n)\s*:root\[data-theme="light"\][^{]*\{([\s\S]*?)\}/);
    expect(lightBlockMatch).not.toBeNull();
    const lightBlock = lightBlockMatch?.[1] ?? "";

    const lightBgApp = lightBlock.match(/--bg-app:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const lightText = lightBlock.match(/--text:\s*(#[0-9a-fA-F]{6});/)?.[1];

    expect(lightBgApp).toBeDefined();
    expect(lightText).toBeDefined();

    expect(getContrastRatio(darkText!, darkBgApp!)).toBeGreaterThanOrEqual(17.0);
    expect(getContrastRatio(lightText!, lightBgApp!)).toBeGreaterThanOrEqual(15.0);
    expect(getContrastRatio(darkAccentText!, darkAccent!)).toBeGreaterThanOrEqual(4.5);
  });

  it("F1-T2-02: enforces prefers-reduced-motion override", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important;");
    expect(css).toContain("transition-duration: 0.01ms !important;");
    expect(css).toContain("animation-iteration-count: 1 !important;");
  });

  it("F1-T2-03: implements solid flat Linear surface utilities (zero blur, zero dark shadow)", () => {
    expect(css).toContain("@utility studio-deck {");
    expect(css).toContain("background-color: var(--bg-surface);");
    expect(css).toContain("border: 1px solid var(--border);");
    expect(css).toContain("box-shadow: var(--ssp-shadow-card);");
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

    expect(themeBody).toContain("--color-canvas: var(--ssp-bg-canvas);");
    expect(themeBody).toContain("--color-raised: var(--ssp-bg-raised);");
    expect(themeBody).toContain("--color-accent: var(--ssp-accent);");
    expect(themeBody).toContain("--color-signal: var(--ssp-signal);");
    expect(themeBody).toContain("--color-ink: var(--ssp-text-primary);");

    const hexInColorToken = /--color-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/.test(themeBody);
    expect(hexInColorToken).toBe(false);
  });
});
