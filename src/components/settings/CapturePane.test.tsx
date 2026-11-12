import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CapturePane from "./CapturePane";
import { useSspStore, INITIAL_PRESETS } from "../../lib/store";
import type { CaptureSettings } from "../../types/ipc";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  presetsList: vi.fn().mockResolvedValue({ presets: [] }),
}));

import { settingsSet } from "../../lib/ipc";
const mockedSettingsSet = vi.mocked(settingsSet);

function setCaptureSettings(capture: Partial<CaptureSettings>) {
  useSspStore.setState({
    settings: {
      capture: capture as CaptureSettings,
      captureLoading: false,
      files: null,
      filesLoading: false,
      shortcuts: null,
      shortcutsLoading: false,
    },
  });
}

function setPresets(presets: { status: string; presets: { id: string; label: string; description: string; fps: number; height: number; container: string }[]; presetId: string }) {
  useSspStore.setState({ presets: { ...INITIAL_PRESETS, ...presets } });
}

/* §6.4 Settings — Capture pane: frameRate / encoder / qualityPreset. */

describe("CapturePane (§6.4 / 6.1)", () => {
  beforeEach(() => {
    setCaptureSettings({
      frameRate: 60,
      encoder: "auto",
      qualityPreset: "youtube",
    });
    setPresets({
      status: "ready",
      presets: [
        { id: "youtube", label: "For YouTube", description: "1080p60, ~12 Mbps", fps: 60, height: 1080, container: "mp4" },
        { id: "discord", label: "For Discord", description: "720p30, ~6 Mbps", fps: 30, height: 720, container: "mp4" },
      ],
      presetId: "youtube",
    });
    vi.clearAllMocks();
  });

  it("renders frame rate select defaulting to 60", () => {
    render(<CapturePane />);
    expect(screen.getByLabelText(/Frame rate/)).toBeInTheDocument();
    const select = screen.getByLabelText(/Frame rate/) as HTMLSelectElement;
    expect(select.value).toBe("60");
  });

  it("renders encoder select defaulting to auto", () => {
    render(<CapturePane />);
    expect(screen.getByLabelText(/Encoder/)).toBeInTheDocument();
    const select = screen.getByLabelText(/Encoder/) as HTMLSelectElement;
    expect(select.value).toBe("auto");
  });

  it("renders quality preset select from presets list", () => {
    render(<CapturePane />);
    expect(screen.getByLabelText(/Quality preset/)).toBeInTheDocument();
    expect(screen.getByText("For YouTube")).toBeInTheDocument();
    expect(screen.getByText("For Discord")).toBeInTheDocument();
  });

  it("calls setPreset when quality preset changes", async () => {
    render(<CapturePane />);
    fireEvent.change(screen.getByLabelText(/Quality preset/), {
      target: { value: "discord" },
    });
    await waitFor(() =>
      expect(useSspStore.getState().presets.presetId).toBe("discord"),
    );
  });

  it("updates frame rate via settingsSet", async () => {
    render(<CapturePane />);
    const select = screen.getByLabelText(/Frame rate/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "30" } });
    await waitFor(() =>
      expect(mockedSettingsSet).toHaveBeenCalledWith({ capture: { frameRate: 30 } }),
    );
  });

  it("updates encoder via settingsSet", async () => {
    render(<CapturePane />);
    const select = screen.getByLabelText(/Encoder/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "vaapi" } });
    await waitFor(() =>
      expect(mockedSettingsSet).toHaveBeenCalledWith({ capture: { encoder: "vaapi" } }),
    );
  });
});
