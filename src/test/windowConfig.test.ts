import { describe, expect, it } from "vitest";
import tauriConf from "../../src-tauri/tauri.conf.json";

/* src/test/windowConfig.test.ts — Feature 2: Linear Window Configuration & Proportions
   Provenance: DESIGN.md v6.0 (Final & Locked Linear UI)
   Verifies:
   - Tier 1: Window config in `src-tauri/tauri.conf.json` (decorations false, transparent false, 1280x800 default, 1024x640 min)
   - Tier 2: Boundary invariants & valid build metadata */

interface TauriWindowConfig {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  center?: boolean;
  resizable?: boolean;
  decorations?: boolean;
  transparent?: boolean;
  shadow?: boolean;
}

interface TauriConfig {
  productName?: string;
  version?: string;
  identifier?: string;
  build?: {
    devUrl?: string;
    frontendDist?: string;
  };
  app?: {
    windows?: TauriWindowConfig[];
  };
}

describe("Feature 2: Window Configuration & Proportions (Tier 1)", () => {
  const config = tauriConf as unknown as TauriConfig;
  const primaryWindow = config.app?.windows?.[0];

  it("F2-T1-01: tauri.conf.json exists, is valid JSON, and defines one opaque frameless primary window", () => {
    expect(config).toBeDefined();
    expect(config.app?.windows).toHaveLength(1);
    expect(primaryWindow).toBeDefined();
    expect(primaryWindow?.decorations).toBe(false);
    expect(primaryWindow?.transparent).toBe(false);
    expect(primaryWindow?.resizable).toBe(true);
    expect(primaryWindow?.shadow).toBe(true);
  });

  it("F2-T1-02: enables window centering and product title", () => {
    expect(primaryWindow?.center).toBe(true);
    expect(primaryWindow?.title).toBe("Screen Studio Pro");
    expect(config.productName).toBe("Screen Studio Pro");
  });

  it("F2-T1-03: enforces Linear window dimensions 1280x800 default and 1024x640 minimum", () => {
    expect(primaryWindow?.width).toBe(1280);
    expect(primaryWindow?.height).toBe(800);
    expect(primaryWindow?.minWidth).toBe(1024);
    expect(primaryWindow?.minHeight).toBe(640);
  });
});

describe("Feature 2: Window Configuration & Proportions (Tier 2 Boundary & Invariants)", () => {
  const config = tauriConf as unknown as TauriConfig;
  const primaryWindow = config.app?.windows?.[0];

  it("F2-T2-01: minimum dimensions stay strictly <= default dimensions and aspect ratio stays widescreen", () => {
    const width = primaryWindow?.width ?? 0;
    const height = primaryWindow?.height ?? 0;
    const minWidth = primaryWindow?.minWidth ?? 0;
    const minHeight = primaryWindow?.minHeight ?? 0;

    expect(minWidth).toBeLessThanOrEqual(width);
    expect(minHeight).toBeLessThanOrEqual(height);
    expect(width / height).toBe(1.6);
    expect(minWidth / minHeight).toBe(1.6);
  });

  it("F2-T2-02: minimum width (1024px) keeps compact gallery collapse below 1120px without overflow", () => {
    const minWidth = primaryWindow?.minWidth ?? 0;
    expect(minWidth).toBe(1024);
    expect(minWidth).toBeLessThan(1120);
  });

  it("F2-T2-03: tauri config specifies valid build configuration", () => {
    expect(config.build?.devUrl).toBe("http://localhost:1420");
    expect(config.build?.frontendDist).toBe("../dist");
    expect(config.identifier).toBe("com.zvirox.screenstudiopro");
  });
});
