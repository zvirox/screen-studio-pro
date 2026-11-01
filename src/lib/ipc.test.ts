import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { asIpcError, ipcHello, isContractMatch, settingsGet, settingsSet, systemCapabilities } from "./ipc";
import { IPC_CONTRACT_VERSION } from "../types/ipc";

/* Contract tests against mock IPC (TESTING §1 P1) — the lib/ipc.ts ↔
   src-tauri/ipc mirror. Wire names here must match API.md §2.5 exactly. */

describe("lib/ipc", () => {
  afterEach(() => invokeMock.mockReset());

  it("ipcHello calls the cmd verb and returns the handshake", async () => {
    invokeMock.mockResolvedValue({ ipcContract: "1.0.0" });
    await expect(ipcHello()).resolves.toEqual({ ipcContract: "1.0.0" });
    expect(invokeMock).toHaveBeenCalledWith("ipc_hello");
  });

  it("systemCapabilities calls the probe verb", async () => {
    invokeMock.mockResolvedValue({ encoders: [], portal: {}, version: { app: "0.1.0", ipcContract: "1.0.0" } });
    await systemCapabilities();
    expect(invokeMock).toHaveBeenCalledWith("system_capabilities");
  });

  it("settingsGet addresses one section (API §2.6)", async () => {
    invokeMock.mockResolvedValue({ frameRate: 60, encoder: "auto", qualityPreset: "youtube" });
    await settingsGet("capture");
    expect(invokeMock).toHaveBeenCalledWith("settings_get", { section: "capture" });
  });

  it("settingsSet sends the partial patch and returns merged settings", async () => {
    const merged = {
      capture: { frameRate: 30, encoder: "auto", qualityPreset: "youtube" },
      audio: { micDeviceId: null, desktopAudio: true, echoCancel: false },
      files: { dir: "/home/u/Videos/SSP", namingPattern: "screen-%Y-%m-%d-%H%M", container: "mp4" },
      shortcuts: { quickRecord: "Super+Shift+R", pause: "Super+Shift+P", stop: "Super+Shift+S" },
    };
    invokeMock.mockResolvedValue(merged);
    await expect(settingsSet({ capture: { frameRate: 30 } })).resolves.toBe(merged);
    expect(invokeMock).toHaveBeenCalledWith("settings_set", {
      patch: { capture: { frameRate: 30 } },
    });
  });

  it("passes §1-shaped errors through without rewrapping", async () => {
    const shaped = {
      kind: "encoder",
      code: "encoder.unavailable",
      retryable: true,
      userMessage: "Hardware encoding failed. Falling back to x264.",
      details: { attempted: ["nvenc"] },
    };
    invokeMock.mockRejectedValueOnce(shaped);
    await expect(systemCapabilities()).rejects.toEqual(shaped);
  });

  it("wraps non-§1 failures in the ipc fallback copy", () => {
    const err = asIpcError("permission denied: not allowed");
    expect(err.kind).toBe("ipc");
    expect(err.code).toBe("ipc.unknown_command");
    expect(err.userMessage).toBe("ScreenStudio Pro could not reach its recording core.");
    expect(err.details).toEqual({ cause: "permission denied: not allowed" });
  });

  it("asIpcError accepts anything, never throws", () => {
    expect(asIpcError(undefined).kind).toBe("ipc");
    expect(asIpcError(42).kind).toBe("ipc");
  });

  it("pins the webview contract version (API §5.1)", () => {
    expect(IPC_CONTRACT_VERSION).toBe("1.0.0");
    expect(isContractMatch("1.0.0")).toBe(true);
    expect(isContractMatch("1.1.0")).toBe(false);
    expect(isContractMatch("2.0.0")).toBe(false);
  });
});
