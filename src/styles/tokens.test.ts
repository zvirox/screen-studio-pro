import { describe, expect, it } from "vitest";

/* src/styles/tokens.test.ts — Feature 1: Design Tokens & Obsidian Palette
   Provenance: DESIGN.md v3.0, ORIGINAL_REQUEST.md §R1, Stage v3.1
   Verifies:
   - Tier 1: Core palette root variables, accent/signal colors, hardware radii scale, elevation shadows, light mode
   - Tier 2: WCAG contrast floors, prefers-reduced-motion overrides, studio glass utility recipes, z-level scale */

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

/** Compute relative luminance for sRGB color hex (#RRGGBB). */
function getRelativeLuminance(hex: string): number {
  const sanitized = hex.replace("#", "");
  const r = parseInt(sanitized.substring(0, 2), 16) / 255;
  const g = parseInt(sanitized.substring(2, 4), 16) / 255;
  const b = parseInt(sanitized.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Compute WCAG contrast ratio between two hex colors. */
function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Feature 1: Design Tokens & Obsidian Palette (Tier 1)", () => {
  it("F1-T1-01: declares Obsidian palette root variables in dark mode :root", () => {
    expect(css).toContain("--ssp-bg-canvas: #0A0B0E;");
    expect(css).toContain("--ssp-bg-raised: #12141A;");
    expect(css).toContain("--ssp-surface-solid: #181A22;");
    expect(css).toContain("--ssp-surface-glass: rgba(255, 255, 255, 0.06);");
    expect(css).toContain("--ssp-surface-glass-strong: rgba(18, 20, 26, 0.94);");
    expect(css).toContain("--ssp-border-subtle: rgba(255, 255, 255, 0.14);");
    expect(css).toContain("--ssp-border-glass: rgba(255, 255, 255, 0.20);");
    expect(css).toContain("--ssp-text-primary: #F4F5F8;");
    expect(css).toContain("--ssp-text-secondary: rgba(244, 245, 248, 0.78);");
    expect(css).toContain("--ssp-text-disabled: rgba(244, 245, 248, 0.46);");
  });

  it("F1-T1-02: defines Studio Burgundy Accent and Broadcast Signal Red tokens with variants", () => {
    // Studio Burgundy Accent
    expect(css).toContain("--ssp-accent: #A3284E;");
    expect(css).toContain("--ssp-accent-hover: #BA335D;");
    expect(css).toContain("--ssp-accent-active: #8C1E40;");
    expect(css).toContain("--ssp-accent-text: #FFFFFF;");
    expect(css).toContain("--ssp-accent-muted: rgba(163, 40, 78, 0.15);");

    // Broadcast Signal Red
    expect(css).toContain("--ssp-signal: #C92A2A;");
    expect(css).toContain("--ssp-signal-muted: rgba(201, 42, 42, 0.16);");
  });

  it("F1-T1-03: defines the hardware radii scale in @theme inline", () => {
    expect(css).toContain("--radius-none: 0px;");
    expect(css).toContain("--radius-xs: 4px;");
    expect(css).toContain("--radius-sm: 8px;");
    expect(css).toContain("--radius-md: 12px;");
    expect(css).toContain("--radius-lg: 16px;");
    expect(css).toContain("--radius-xl: 20px;");
    expect(css).toContain("--radius-full: 999px;");
  });

  it("F1-T1-04: defines atmospheric elevation shadows for floating surfaces", () => {
    expect(css).toContain("--ssp-elev-1: 0 1px 3px rgba(0, 0, 0, 0.24), 0 6px 18px rgba(0, 0, 0, 0.16);");
    expect(css).toContain("--ssp-elev-2: 0 3px 10px rgba(0, 0, 0, 0.28), 0 14px 32px rgba(0, 0, 0, 0.24);");
    expect(css).toContain(
      "--ssp-elev-float: 0 6px 24px -4px rgba(0, 0, 0, 0.4), 0 20px 56px -8px rgba(0, 0, 0, 0.32);",
    );
    expect(css).toContain("--shadow-elev-1: var(--ssp-elev-1);");
    expect(css).toContain("--shadow-elev-2: var(--ssp-elev-2);");
    expect(css).toContain("--shadow-elev-float: var(--ssp-elev-float);");
  });

  it("F1-T1-05: provides complete light mode secondary face overrides in .light", () => {
    expect(css).toContain(":root[data-theme=\"light\"],");
    expect(css).toContain(".light {");
    expect(css).toContain("--ssp-bg-canvas: #F1F3F6;");
    expect(css).toContain("--ssp-bg-raised: #FFFFFF;");
    expect(css).toContain("--ssp-surface-solid: #E5E8ED;");
    expect(css).toContain("--ssp-surface-glass: rgba(255, 255, 255, 0.78);");
    expect(css).toContain("--ssp-surface-glass-strong: rgba(255, 255, 255, 0.96);");
    expect(css).toContain("--ssp-text-primary: #12141A;");
    expect(css).toContain("--ssp-accent: #8B1E3F;");
    expect(css).toContain("--ssp-signal: #D32F2F;");
  });

  it("F1-T1-06: carries the mandatory provenance header comment DESIGN.md v3.1", () => {
    expect(css).toMatch(/\/\*\s*DESIGN\.md v3\.1\s*\*\//);
    expect(css).toContain("Provenance: DESIGN.md v3.1");
  });
});

describe("Feature 1: Design Tokens & Obsidian Palette (Tier 2 Boundary & Edge)", () => {
  it("F1-T1-07: keeps interactive labels readable and focus indicators theme-aware", () => {
    expect(css).toContain("--text-body-sm: 0.875rem;");
    expect(css).toContain("--color-focus: var(--ssp-border-focus);");
    expect(css).toContain("0 0 0 4px var(--ssp-border-focus);");
  });

  it("F1-T2-01: enforces WCAG AAA contrast ratio floor (> 7.0:1) for primary copy in both dark and light modes", () => {
    // Dynamically extract color hex values from the loaded css
    const rootBlockMatch = css.match(/(?:^|\n):root\s*\{([\s\S]*?)\}/);
    expect(rootBlockMatch).not.toBeNull();
    const rootBlock = rootBlockMatch?.[1] ?? "";

    const darkBgCanvas = rootBlock.match(/--ssp-bg-canvas:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const darkTextPrimary = rootBlock.match(/--ssp-text-primary:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const darkAccent = rootBlock.match(/--ssp-accent:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const darkAccentText = rootBlock.match(/--ssp-accent-text:\s*(#[0-9a-fA-F]{6});/)?.[1];

    expect(darkBgCanvas).toBeDefined();
    expect(darkTextPrimary).toBeDefined();
    expect(darkAccent).toBeDefined();
    expect(darkAccentText).toBeDefined();

    // Extract light mode tokens
    const lightBlockMatch = css.match(/(?:^|\n)\s*:root\[data-theme="light"\][^{]*\{([\s\S]*?)\}/);
    expect(lightBlockMatch).not.toBeNull();
    const lightBlock = lightBlockMatch?.[1] ?? "";

    const lightBgCanvas = lightBlock.match(/--ssp-bg-canvas:\s*(#[0-9a-fA-F]{6});/)?.[1];
    const lightTextPrimary = lightBlock.match(/--ssp-text-primary:\s*(#[0-9a-fA-F]{6});/)?.[1];

    expect(lightBgCanvas).toBeDefined();
    expect(lightTextPrimary).toBeDefined();

    // Dark mode: text.primary on bg.canvas
    const darkRatio = getContrastRatio(darkTextPrimary ?? "#000000", darkBgCanvas ?? "#FFFFFF");
    expect(darkRatio).toBeGreaterThanOrEqual(17.0); // Far exceeds 7.0:1 AAA standard

    // Light mode: text.primary on bg.canvas
    const lightRatio = getContrastRatio(lightTextPrimary ?? "#FFFFFF", lightBgCanvas ?? "#000000");
    expect(lightRatio).toBeGreaterThanOrEqual(15.0); // Far exceeds 7.0:1 AAA standard

    // Accent button text on Burgundy Accent
    const accentRatio = getContrastRatio(darkAccentText ?? "#000000", darkAccent ?? "#FFFFFF");
    expect(accentRatio).toBeGreaterThanOrEqual(4.5); // Meets WCAG AA for UI controls
  });

  it("F1-T2-02: enforces prefers-reduced-motion override to disable animations and transition delays", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important;");
    expect(css).toContain("transition-duration: 0.01ms !important;");
    expect(css).toContain("animation-iteration-count: 1 !important;");
  });

  it("F1-T2-03: implements floating island glass utilities matching DESIGN.md §4.3 recipes", () => {
    // Studio Deck recipes (Left Inspector, Sub-Canvas Audio Deck, Right Takes Gallery)
    expect(css).toContain("@utility studio-deck {");
    expect(css).toContain("background-color: var(--ssp-surface-glass-strong);");
    expect(css).toContain("backdrop-filter: blur(24px) saturate(180%);");
    expect(css).toContain("border: 1px solid var(--ssp-border-glass);");
    expect(css).toContain("box-shadow: var(--ssp-elev-2);");

    // Hero Canvas utility
    expect(css).toContain("@utility hero-canvas {");
    expect(css).toContain("background-color: #000000;");
    expect(css).toContain("box-shadow: var(--ssp-elev-float);");

    // Floating HUD utility
    expect(css).toContain("@utility floating-hud {");
    expect(css).toContain("backdrop-filter: blur(28px) saturate(200%);");
    expect(css).toContain("box-shadow: var(--ssp-elev-float);");
  });

  it("F1-T2-04: strictly adheres to monotonic fixed z-level scale without arbitrary values", () => {
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

    // Monotonic order check
    expect(zBase).toBeLessThan(zSticky);
    expect(zSticky).toBeLessThan(zOverlay);
    expect(zOverlay).toBeLessThan(zToast);
    expect(zToast).toBeLessThan(zModal);
    expect(zModal).toBeLessThan(zHud);
  });

  it("F1-T2-05: maps semantic Tailwind colors exclusively to CSS variables without hex literals in @theme", () => {
    const themeMatch = css.match(/@theme inline\s*\{([\s\S]*?)\}/);
    expect(themeMatch).not.toBeNull();
    const themeBody = themeMatch![1];

    // Verify semantic colors use var(--ssp-*)
    expect(themeBody).toContain("--color-canvas: var(--ssp-bg-canvas);");
    expect(themeBody).toContain("--color-raised: var(--ssp-bg-raised);");
    expect(themeBody).toContain("--color-accent: var(--ssp-accent);");
    expect(themeBody).toContain("--color-signal: var(--ssp-signal);");
    expect(themeBody).toContain("--color-line-glass: var(--ssp-border-glass);");
    expect(themeBody).toContain("--color-ink: var(--ssp-text-primary);");

    // Verify no hardcoded hex color is declared in @theme color assignments
    const hexInColorToken = /--color-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/.test(themeBody);
    expect(hexInColorToken).toBe(false);
  });
});
