import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_SESSION, INITIAL_TOASTS, useSspStore } from "../lib/store";
import type * as ipcModule from "../lib/ipc";

vi.mock("../lib/hudWindow", () => ({ openHud: vi.fn(), closeHud: vi.fn() }));
vi.mock("../lib/ipc", async (original) => ({
  ...(await original<typeof ipcModule>()),
  windowHide: vi.fn(),
}));
import { openHud, closeHud } from "../lib/hudWindow";
import { windowHide } from "../lib/ipc";
import { useHudWindow } from "./useHudWindow";

function start() {
  act(() =>
    useSspStore.getState().onStarted({ recordingId: "rec_1", encoder: "x264", startedAt: "now" }),
  );
}

describe("useHudWindow lifetime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({ session: INITIAL_SESSION, ...INITIAL_TOASTS });
    vi.mocked(openHud).mockResolvedValue();
    vi.mocked(closeHud).mockResolvedValue();
    vi.mocked(windowHide).mockResolvedValue({ ok: true });
  });

  it("waits for real HUD creation before requesting guarded hide", async () => {
    let ready!: () => void;
    vi.mocked(openHud).mockReturnValue(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    renderHook(useHudWindow);
    start();
    expect(openHud).toHaveBeenCalledWith("rec_1");
    expect(windowHide).not.toHaveBeenCalled();
    await act(async () => ready());
    expect(windowHide).toHaveBeenCalledWith("rec_1");
  });

  it("destroys a late HUD without hiding after Stop", async () => {
    let ready!: () => void;
    vi.mocked(openHud).mockReturnValue(
      new Promise((resolve) => {
        ready = resolve;
      }),
    );
    renderHook(useHudWindow);
    start();
    act(() => useSspStore.setState({ session: INITIAL_SESSION }));
    await act(async () => ready());
    expect(windowHide).not.toHaveBeenCalled();
    expect(closeHud).toHaveBeenCalledWith("rec_1");
  });

  it("keeps the main controls reachable and reports failed creation", async () => {
    vi.mocked(openHud).mockRejectedValue(new Error("native raw failure"));
    renderHook(useHudWindow);
    start();
    await vi.waitFor(() => expect(useSspStore.getState().toasts).toHaveLength(1));
    expect(windowHide).not.toHaveBeenCalled();
    expect(useSspStore.getState().session.recordingId).toBe("rec_1");
    expect(useSspStore.getState().toasts[0].code).toBe("ipc.window_failed");
  });

  it("reports unavailable tray without losing the live take", async () => {
    vi.mocked(windowHide).mockRejectedValue({
      kind: "ipc",
      code: "ipc.tray_unavailable",
      retryable: true,
      userMessage: "Keep this window open.",
      details: null,
    });
    renderHook(useHudWindow);
    start();
    await vi.waitFor(() =>
      expect(useSspStore.getState().toasts[0]?.code).toBe("ipc.tray_unavailable"),
    );
    expect(useSspStore.getState().session.recordingId).toBe("rec_1");
  });
});
