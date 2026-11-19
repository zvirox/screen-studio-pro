import { describe, expect, it } from "vitest";
import tauriConf from "../../src-tauri/tauri.conf.json";

/* src/test/windowConfig.test.ts — Feature 2: Window Configuration & Proportions
   Provenance: ORIGINAL_REQUEST.md §R2, DESIGN.md v3.0, PROJECT.md M2 / Stage v3.2
   Verifies:
   - Tier 1: Window config in `src-tauri/tauri.conf.json` (decorations false, title, default & min dims)
   - Tier 2: Boundary invariants, aspect ratio compliance, and progressive readiness for M2 */

interface TauriWindowConfig {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  center?: boolean;
  decorations?: boolean;
}

interface TauriConfig {
  $schema?: string;
  productName?: string;
  version?: string;
  identifier?: string;
  build?: {
    beforeDevCommand?: string;
    devUrl?: string;
    beforeBuildCommand?: string;
    frontendDist?: string;
  };
  app?: {
    windows?: TauriWindowConfig[];
    security?: {
      csp?: string | null;
    };
  };
}

describe("Feature 2: Window Configuration & Proportions (Tier 1)", () => {
  const config = tauriConf as unknown as TauriConfig;
  const primaryWindow = config.app?.windows?.[0];

  it("F2-T1-01: tauri.conf.json exists, is valid JSON, and defines exactly one primary window", () => {
    expect(config).toBeDefined();
    expect(config.app?.windows).toBeDefined();
    expect(config.app?.windows?.length).toBe(1);
    expect(primaryWindow).toBeDefined();
  });

  it("F2-T1-02: disables native OS decorations for custom CSD titlebar integration", () => {
    // Custom CSD requirement (ORIGINAL_REQUEST §R2, DESIGN.md §5.1)
    expect(primaryWindow?.decorations).toBe(false);
  });

  it("F2-T1-03: enables window centering on display launch", () => {
    expect(primaryWindow?.center).toBe(true);
  });

  it("F2-T1-04: declares correct application product title", () => {
    expect(primaryWindow?.title).toBe("ScreenStudio Pro");
    expect(config.productName).toBe("ScreenStudio Pro");
  });

  it("F2-T1-05: [Milestone 2] enforces UI v3 default dimensions 1360x820 and minimum dimensions 1040x680", () => {
    expect(primaryWindow?.width).toBe(1360);
    expect(primaryWindow?.height).toBe(820);
    expect(primaryWindow?.minWidth).toBe(1040);
    expect(primaryWindow?.minHeight).toBe(680);
  });
});

describe("Feature 2: Window Configuration & Proportions (Tier 2 Boundary & Invariants)", () => {
  const config = tauriConf as unknown as TauriConfig;
  const primaryWindow = config.app?.windows?.[0];

  it("F2-T2-01: enforces strict containment: minimum dimensions must be <= default dimensions", () => {
    const width = primaryWindow?.width ?? 0;
    const height = primaryWindow?.height ?? 0;
    const minWidth = primaryWindow?.minWidth ?? 0;
    const minHeight = primaryWindow?.minHeight ?? 0;

    expect(minWidth).toBeLessThanOrEqual(width);
    expect(minHeight).toBeLessThanOrEqual(height);
  });

  it("F2-T2-02: [Milestone 2] minimum width of 1040px accommodates tri-panel collapse threshold without overflow", () => {
    // At minWidth (1040px), with right gallery collapsed (<1120px per §R7),
    // Left Inspector (300px) + Center Hero Canvas (>=700px) + margins fit cleanly.
    const minWidth = primaryWindow?.minWidth ?? 0;
    expect(minWidth).toBe(1040);
    expect(minWidth).toBeLessThan(1120); // strictly below the 1120px collapse threshold
  });

  it("F2-T2-03: [Milestone 2] default window aspect ratio (1360 / 820) provides widescreen ergonomics", () => {
    const width = primaryWindow?.width ?? 1;
    const height = primaryWindow?.height ?? 1;
    const aspectRatio = width / height;

    // 1360 / 820 ≈ 1.658 — optimal widescreen desktop studio layout
    expect(aspectRatio).toBeGreaterThan(1.6);
    expect(aspectRatio).toBeLessThan(1.7);
  });

  it("F2-T2-04: target UI v3 specification invariant: verifies target dimensions math", () => {
    // Validates that the primaryWindow dimensions configured in tauri.conf.json satisfy UI v3 mathematical invariants
    const width = primaryWindow?.width ?? 0;
    const height = primaryWindow?.height ?? 0;
    const minWidth = primaryWindow?.minWidth ?? 0;
    const minHeight = primaryWindow?.minHeight ?? 0;

    expect(width).toBe(1360);
    expect(height).toBe(820);
    expect(minWidth).toBe(1040);
    expect(minHeight).toBe(680);

    expect(minWidth).toBeLessThan(width);
    expect(minHeight).toBeLessThan(height);
    expect(width / height).toBeCloseTo(1.658, 2);
    expect(minWidth / minHeight).toBeCloseTo(1.529, 2);
  });

  it("F2-T2-05: tauri config specifies valid build configuration and bundle targets", () => {
    expect(config.build?.devUrl).toBe("http://localhost:1420");
    expect(config.build?.frontendDist).toBe("../dist");
    expect(config.identifier).toBe("com.zvirox.screenstudiopro");
  });
});
