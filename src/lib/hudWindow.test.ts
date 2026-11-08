import { beforeEach, describe, expect, it, vi } from "vitest";

/* Mock BEFORE the import: the harness never talks to a real webview
   (§1: frontend unit layer drives fakes, never Tauri). */
const constructed: Array<{ label: string; opts?: Record<string, unknown> }> = [];
const existingWindows = new Map<string, { destroy: () => Promise<void> }>();
const handlers = new Map<string, () => void>();
let autoCreate = true;

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    constructor(label: string, opts?: Record<string, unknown>) {
      constructed.push({ label, opts });
      // Mirror the real backend: registration happens once the create
      // command lands, and it must be visible to getByLabel afterwards.
      existingWindows.set(label, this as never);
    }
    static async getByLabel(label: string) {
      return existingWindows.get(label) ?? null;
    }
    async destroy() {
      existingWindows.delete("hud");
      handlers.get("tauri://destroyed")?.();
    }
    async once(event: string, handler: () => void) {
      handlers.set(event, handler);
      if (event === "tauri://created" && autoCreate) queueMicrotask(handler);
      return () => {};
    }
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: vi.fn(),
}));

import { openHud, closeHud, _resetLiveForTests } from "./hudWindow";
import { currentMonitor, type Monitor } from "@tauri-apps/api/window";
const mockedMonitor = vi.mocked(currentMonitor);

/* §5.9 HUD float window: 46px tall transparent always-on-top child, born
   at recording start with the take id in its URL, parked bottom-right at
   the 8px inset corner-snap. */
describe("openHud (lib/hudWindow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructed.length = 0;
    existingWindows.clear();
    handlers.clear();
    autoCreate = true;
    _resetLiveForTests();
    mockedMonitor.mockResolvedValue({
      name: null,
      size: { width: 1920, height: 1080, type: "Physical" },
      position: { x: 0, y: 0, type: "Physical" },
      scaleFactor: 1,
    } as unknown as Monitor);
  });

  it("creates the hud webview with §5.9 window opts + the take id param", async () => {
    await openHud("rec_01HV3");
    expect(constructed).toHaveLength(1);
    const { label, opts } = constructed[0];
    expect(label).toBe("hud");
    expect(String(opts?.url)).toContain("hud.html");
    expect(String(opts?.url)).toContain("recordingId=rec_01HV3");
    expect(opts?.transparent).toBe(true);
    expect(opts?.decorations).toBe(false);
    expect(opts?.alwaysOnTop).toBe(true);
    expect(opts?.skipTaskbar).toBe(true);
    expect(opts?.height).toBe(46);
    // tao's Linux path clamps resizable:false to a 200px min height — the
    // size is pinned with equal min/max constraints instead (2.4 gate).
    expect(opts?.minWidth).toBe(264);
    expect(opts?.minHeight).toBe(46);
    expect(opts?.maxWidth).toBe(264);
    expect(opts?.maxHeight).toBe(46);
  });

  it("parks the window bottom-right at the 8px corner-snap inset", async () => {
    await openHud("rec_01HV3");
    const { opts } = constructed[0];
    expect(opts?.x).toBe(1920 - 264 - 8);
    expect(opts?.y).toBe(1080 - 46 - 8);
  });

  it("still opens when the monitor probe fails (WM default placement)", async () => {
    mockedMonitor.mockRejectedValue(new Error("no monitor"));
    await openHud("rec_01HV3");
    expect(constructed).toHaveLength(1);
    expect(constructed[0].opts?.x).toBeUndefined();
  });

  it("replaces an orphan from a previous take", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    existingWindows.set("hud", { destroy });
    await openHud("rec_01HV3");
    expect(destroy).toHaveBeenCalledOnce();
    expect(constructed).toHaveLength(1);
  });

  it("serializes concurrent spawns — React's dev double-effect cannot race two windows", async () => {
    await Promise.all([openHud("rec_01"), openHud("rec_01")]);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].label).toBe("hud");
  });

  it("waits for created and serializes Stop behind pending creation", async () => {
    autoCreate = false;
    const opened = vi.fn();
    const opening = openHud("rec_1").then(opened);
    await vi.waitFor(() => expect(handlers.has("tauri://created")).toBe(true));
    const closing = closeHud("rec_1");
    expect(opened).not.toHaveBeenCalled();
    handlers.get("tauri://created")?.();
    await Promise.all([opening, closing]);
    expect(existingWindows.size).toBe(0);
  });

  it("rejects creation errors and lets the next take create a HUD", async () => {
    autoCreate = false;
    const opening = openHud("rec_1");
    const rejected = expect(opening).rejects.toThrow("HUD creation failed");
    await vi.waitFor(() => expect(handlers.has("tauri://error")).toBe(true));
    existingWindows.clear();
    handlers.get("tauri://error")?.();
    await rejected;
    autoCreate = true;
    await openHud("rec_2");
    await closeHud("rec_1");
    expect(existingWindows.size).toBe(1);
    await closeHud("rec_2");
    expect(existingWindows.size).toBe(0);
  });
});
