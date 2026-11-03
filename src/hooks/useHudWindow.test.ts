import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* The hook is the SPAWN half only: main window hears `recording/started`
   (the take's birth announcement, API §3) and opens the HUD child; the
   HUD closes itself on finished/error (its own subscription). */
const openHud = vi.fn().mockResolvedValue(undefined);
const unlisten = vi.fn();
let startedHandler: ((evt: { recordingId: string }) => void) | null = null;

vi.mock("../lib/hudWindow", () => ({ openHud: (...args: unknown[]) => openHud(...args) }));

vi.mock("../lib/events", () => ({
  listenEvent: vi.fn(
    (_topic: string, handler: (evt: { recordingId: string }) => void) => {
      startedHandler = handler;
      return Promise.resolve(unlisten);
    },
  ),
}));

import { useHudWindow } from "./useHudWindow";

describe("useHudWindow (recording/started → spawn)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openHud.mockResolvedValue(undefined);
    startedHandler = null;
  });

  it("opens the HUD with the started take's id", async () => {
    const { unmount } = renderHook(() => useHudWindow());
    await vi.waitFor(() => expect(startedHandler).toBeTypeOf("function"));
    startedHandler?.({ recordingId: "rec_01HV9" });
    expect(openHud).toHaveBeenCalledWith("rec_01HV9");
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens on unmount — no leaked subscription", async () => {
    const { unmount } = renderHook(() => useHudWindow());
    await vi.waitFor(() => expect(startedHandler).toBeTypeOf("function"));
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
