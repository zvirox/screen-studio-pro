import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { asIpcError, ipcHello, isContractMatch, prefsGet, prefsSet, recordingStart, recordingStop, settingsGet, settingsSet, sourceRelease, sourceSelect, systemCapabilities } from "./ipc";
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

  it("prefsGet/prefsSet address the ui_prefs verbs (API §2.6)", async () => {
    invokeMock.mockResolvedValueOnce({ key: "pip.position", value: "corner:bottom-right,margin:24" });
    await expect(prefsGet("pip.position")).resolves.toEqual({
      key: "pip.position",
      value: "corner:bottom-right,margin:24",
    });
    expect(invokeMock).toHaveBeenCalledWith("prefs_get", { key: "pip.position" });

    invokeMock.mockResolvedValueOnce({ prefs: [{ key: "hud.pinned", value: false }] });
    await expect(prefsGet("")).resolves.toEqual({ prefs: [{ key: "hud.pinned", value: false }] });
    expect(invokeMock).toHaveBeenCalledWith("prefs_get", { key: "" });

    invokeMock.mockResolvedValueOnce({ key: "hud.pinned", value: true });
    await expect(prefsSet("hud.pinned", true)).resolves.toEqual({ key: "hud.pinned", value: true });
    expect(invokeMock).toHaveBeenCalledWith("prefs_set", { key: "hud.pinned", value: true });
  });

  it("sourceSelect sends kind + null target and returns §2.1 reply shape", async () => {
    const reply = {
      sourceId: "src_01hv3",
      kind: "monitor",
      label: "Monitor (2560×1440)",
      capabilities: { fps: 60, width: 2560, height: 1440, cursor: true, region: true },
      preview: { mode: "stills_jpeg", fps: 8 },
    };
    invokeMock.mockResolvedValueOnce(reply);
    await expect(sourceSelect("monitor")).resolves.toEqual(reply);
    // No hint → explicit null so the Rust command gets a defined arg bag.
    expect(invokeMock).toHaveBeenCalledWith("source_select", { kind: "monitor", target: null });
  });

  it("sourceSelect forwards a monitor label target as the hint", async () => {
    invokeMock.mockResolvedValueOnce({ sourceId: "src_x", kind: "monitor", label: "Monitor (1920×1080)", capabilities: { fps: 60, width: 1920, height: 1080, cursor: true, region: true }, preview: { mode: "stills_jpeg", fps: 8 } });
    await sourceSelect("monitor", "DP-1");
    expect(invokeMock).toHaveBeenCalledWith("source_select", { kind: "monitor", target: "DP-1" });
  });

  it("sourceRelease addresses the source id and stays idempotent-shaped", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await expect(sourceRelease("src_01hv3")).resolves.toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("source_release", { sourceId: "src_01hv3" });
  });

  it("recordingStart sends the full §2.3 body shape", async () => {
    invokeMock.mockResolvedValueOnce({
      recordingId: "rec_01hv4",
      status: "recording",
      encoder: { backend: "x264", isHardware: false },
      startedAt: "2026-11-02T10:00:00Z",
    });
    const input = {
      sourceId: "src_01hv3",
      regionRect: null,
      audio: [],
      cameraId: null,
      presetId: null,
      outputDir: null,
    };
    await expect(recordingStart(input)).resolves.toMatchObject({
      recordingId: "rec_01hv4",
      status: "recording",
      encoder: { backend: "x264", isHardware: false },
      startedAt: "2026-11-02T10:00:00Z",
    });
    expect(invokeMock).toHaveBeenCalledWith("recording_start", input);
  });

  it("recordingStop addresses the recording id and returns the §2.3 recording object", async () => {
    invokeMock.mockResolvedValueOnce({
      recording: {
        path: "/home/u/Videos/SSP/first-rec.mkv",
        container: "mkv",
        durationMs: 1540,
        sizeBytes: 402_117,
        status: "ready",
      },
    });
    await expect(recordingStop("rec_01hv4")).resolves.toMatchObject({
      recording: { container: "mkv", status: "ready" },
    });
    expect(invokeMock).toHaveBeenCalledWith("recording_stop", { recordingId: "rec_01hv4" });
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
