import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CaptureInspector from "./CaptureInspector";
import {
  INITIAL_CAMERA,
  INITIAL_PREFS,
  INITIAL_PRESETS,
  INITIAL_SESSION,
  INITIAL_SETTINGS,
  INITIAL_SOURCE,
  useSspStore,
} from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";
import type {
  CameraDeviceInfo,
  CaptureSettings,
  Preset,
  SourceCapabilities,
  SourceSelected,
} from "../../types/ipc";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.ResizeObserver =
    window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

vi.mock("../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof ipcModule>();
  return {
    ...actual,
    sourceSelect: vi.fn(),
    cameraListDevices: vi.fn(),
    cameraOpen: vi.fn(),
    cameraClose: vi.fn(),
    prefsGet: vi.fn(),
    prefsSet: vi.fn(),
    presetsList: vi.fn(),
    settingsGet: vi.fn().mockResolvedValue({ qualityPreset: "youtube_1080p60" }),
    settingsSet: vi.fn(),
  };
});

import {
  cameraClose,
  cameraListDevices,
  cameraOpen,
  prefsSet,
  presetsList,
  settingsGet,
  sourceSelect,
} from "../../lib/ipc";

const DUMMY_CAPS: SourceCapabilities = {
  fps: 60,
  width: 1920,
  height: 1080,
  cursor: true,
  region: true,
};

const DUMMY_SELECTED_MONITOR: SourceSelected = {
  sourceId: "mon_0",
  kind: "monitor",
  label: "Monitor 1 (1920×1080)",
  capabilities: DUMMY_CAPS,
  preview: { mode: "stills_jpeg", fps: 8 },
};

const DUMMY_CAMERAS: CameraDeviceInfo[] = [
  { id: "cam_1", label: "Facecam HD", isDefault: true },
  { id: "cam_2", label: "USB Webcam 4K", isDefault: false },
];

const DUMMY_PRESETS: Preset[] = [
  {
    id: "youtube",
    label: "For YouTube",
    description: "1080p60 (~12 Mbps)",
    fps: 60,
    height: 1080,
    container: "mp4",
  },
  {
    id: "discord",
    label: "For Discord",
    description: "720p30 (~6 Mbps)",
    fps: 30,
    height: 720,
    container: "mp4",
  },
];

describe("CaptureInspector (Stage v3.4 Left Floating Inspector Deck)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      camera: INITIAL_CAMERA,
      settings: INITIAL_SETTINGS,
      prefs: INITIAL_PREFS,
      presets: {
        ...INITIAL_PRESETS,
        presets: DUMMY_PRESETS,
        presetId: "youtube",
        status: "ready",
      },
      capabilities: {
        portal: {
          screencast: true,
          windowCapture: true,
          globalShortcuts: "portal",
          compositor: "hyprland",
        },
        encoders: [
          { backend: "vaapi", isHardware: true, available: true },
          { backend: "x264", isHardware: false, available: true },
        ],
        version: { app: "0.0.1", ipcContract: "1.0.0" },
      },
    });

    vi.mocked(presetsList).mockResolvedValue({
      presets: DUMMY_PRESETS,
    });
    const mockCaptureSettings: CaptureSettings = {
      frameRate: 60,
      encoder: "vaapi",
      qualityPreset: "youtube",
      cameraSelfInsert: true,
    };
    vi.mocked(settingsGet).mockResolvedValue(
      mockCaptureSettings as unknown as Awaited<ReturnType<typeof settingsGet>>,
    );
  });

  it("renders all four core inspector sections cleanly", () => {
    render(<CaptureInspector />);

    // Main aside container
    expect(screen.getByRole("complementary", { name: "Capture Inspector" })).toBeInTheDocument();

    // Section 1: Sources
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Monitor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Window/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Region/ })).toBeInTheDocument();

    // Section 2: Camera PiP
    expect(screen.getByText("Camera PiP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add camera/ })).toBeInTheDocument();

    // Section 3: Quality Preset
    expect(screen.getByText("Quality Preset")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Quality preset" })).toBeInTheDocument();

    // Section 4: Encoder
    expect(screen.getByText("Encoder")).toBeInTheDocument();
    expect(screen.getByText("Hardware")).toBeInTheDocument();
  });

  it("switches source to Monitor on button click and emits IPC sourceSelect", async () => {
    vi.mocked(sourceSelect).mockResolvedValue(DUMMY_SELECTED_MONITOR);

    render(<CaptureInspector />);

    const monitorBtn = screen.getByRole("button", { name: /Monitor/ });
    fireEvent.click(monitorBtn);

    expect(vi.mocked(sourceSelect)).toHaveBeenCalledWith("monitor");
  });

  it("switches source via hotkeys 1, 2, and 3", async () => {
    vi.mocked(sourceSelect).mockResolvedValue(DUMMY_SELECTED_MONITOR);

    render(<CaptureInspector />);

    fireEvent.keyDown(window, { key: "1" });
    expect(vi.mocked(sourceSelect)).toHaveBeenCalledWith("monitor");

    await flushEffects();

    // Reset status back to idle so next keypress is selectable
    useSspStore.setState({ source: INITIAL_SOURCE });
    await flushEffects();

    fireEvent.keyDown(window, { key: "2" });
    expect(vi.mocked(sourceSelect)).toHaveBeenCalledWith("window");
  });

  it("displays live resolution badge when source is live", () => {
    useSspStore.setState({
      source: {
        ...INITIAL_SOURCE,
        status: "live",
        sourceId: "mon_0",
        label: "Primary Display",
        capabilities: DUMMY_CAPS,
      },
    });

    render(<CaptureInspector />);

    expect(screen.getByText("Primary Display")).toBeInTheDocument();
    expect(screen.getByText("1920×1080 · 60fps")).toBeInTheDocument();
  });

  it("keeps the source switcher and live metadata compact without truncation collisions", () => {
    const sourceLabel = "Monitor 1 — Built-in Display with a very long name";
    useSspStore.setState({
      source: {
        ...INITIAL_SOURCE,
        status: "live",
        sourceId: "mon_0",
        label: sourceLabel,
        capabilities: DUMMY_CAPS,
      },
    });

    render(<CaptureInspector />);

    expect(screen.getByRole("group", { name: "Capture source switcher" })).toHaveClass(
      "grid-cols-[repeat(3,minmax(0,1fr))]",
    );
    for (const name of ["Monitor", "Window", "Region"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("h-11", "min-w-0", "flex-col");
      expect(button.querySelector("span")).toHaveClass("whitespace-nowrap");
      expect(button.querySelector("span")).not.toHaveClass("truncate");
    }

    const metadata = screen.getByText(sourceLabel);
    expect(metadata).toHaveClass("min-w-0", "break-words");
    expect(metadata.parentElement).toHaveClass("min-w-0", "flex-wrap", "gap-y-1");
    expect(screen.getByRole("combobox", { name: "Quality preset" })).toHaveClass(
      "min-w-0",
      "max-w-full",
      "pr-9",
    );
  });

  it("uses resilient wrapping and 36px camera controls", () => {
    const cameraLabel = "Facecam HD — USB Video Device With An Extremely Long Name";
    useSspStore.setState({
      camera: {
        ...INITIAL_CAMERA,
        status: "open",
        cameraId: "cam_handle_1",
        deviceId: "cam_1",
        label: cameraLabel,
        width: 1280,
        height: 720,
      },
    });

    render(<CaptureInspector />);

    const deviceLabel = screen.getByText(cameraLabel);
    expect(deviceLabel).toHaveClass("min-w-0", "break-words");
    expect(deviceLabel.parentElement?.parentElement).toHaveClass("min-w-0", "flex-wrap");
    expect(screen.getByRole("button", { name: "Remove" })).toHaveClass("min-h-9");

    for (const name of ["Circle shape", "Rounded rectangle shape"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("h-9", "w-9");
    }
    const corners = screen.getAllByRole("button", { name: /Snap to / });
    expect(corners).toHaveLength(4);
    for (const corner of corners) {
      expect(corner).toHaveClass("h-9", "w-9");
    }

    const slider = screen.getByRole("slider", { name: "Camera PiP size" });
    expect(slider).toHaveClass("h-9");
    expect(slider.className).toContain("[&::-webkit-slider-runnable-track]:h-1.5");

    const hardware = screen.getByText("Hardware");
    expect(hardware).toHaveClass("text-ink");
    expect(hardware).not.toHaveClass("text-accent");
    expect(hardware.parentElement).toHaveClass("min-w-0", "flex-wrap");
  });

  it("lists camera devices and opens selected camera device", async () => {
    vi.mocked(cameraListDevices).mockResolvedValue({ devices: DUMMY_CAMERAS });
    vi.mocked(cameraOpen).mockResolvedValue({
      cameraId: "cam_handle_1",
      width: 1280,
      height: 720,
    });

    render(<CaptureInspector />);
    await flushEffects();

    const addCameraBtn = screen.getByRole("button", { name: /Add camera/ });
    fireEvent.click(addCameraBtn);
    await flushEffects();

    await waitFor(() => {
      expect(vi.mocked(cameraListDevices)).toHaveBeenCalled();
    });

    const option = await screen.findByRole("option", { name: /Facecam HD/ });
    fireEvent.click(option);

    expect(vi.mocked(cameraOpen)).toHaveBeenCalledWith("cam_1");
  });

  it("renders PiP controls (shape, corner snap, size, self-insert) when camera is active", async () => {
    useSspStore.setState({
      camera: {
        ...INITIAL_CAMERA,
        status: "open",
        cameraId: "cam_handle_1",
        deviceId: "cam_1",
        label: "Facecam HD",
        width: 1280,
        height: 720,
      },
      prefs: {
        ...INITIAL_PREFS,
        pipPosition: "corner:bottom-right,margin:24",
        pipShape: "circle",
        pipSize: 240,
      },
    });

    render(<CaptureInspector />);

    expect(screen.getByText("Facecam HD")).toBeInTheDocument();

    // Shape toggle
    const roundedBtn = screen.getByRole("button", { name: "Rounded rectangle shape" });
    fireEvent.click(roundedBtn);
    expect(vi.mocked(prefsSet)).toHaveBeenCalledWith("pip.shape", "rounded");

    // Corner snap grid
    const topLeftBtn = screen.getByRole("button", { name: "Snap to top-left" });
    fireEvent.click(topLeftBtn);
    expect(vi.mocked(prefsSet)).toHaveBeenCalledWith("pip.position", "corner:top-left,margin:24");

    // Size slider
    const slider = screen.getByRole("slider", { name: "Camera PiP size" });
    fireEvent.change(slider, { target: { value: "280" } });
    expect(vi.mocked(prefsSet)).toHaveBeenCalledWith("pip.size", 280);

    // Remove camera
    const removeBtn = screen.getByRole("button", { name: /Remove/i });
    fireEvent.click(removeBtn);
    expect(vi.mocked(cameraClose)).toHaveBeenCalled();
  });

  it("changes quality preset through dropdown", async () => {
    const setPreset = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({
      loadPresets: vi.fn().mockResolvedValue(undefined),
      setPreset,
      presets: {
        status: "ready",
        error: null,
        presets: DUMMY_PRESETS,
        presetId: "youtube",
      },
    });

    render(<CaptureInspector />);
    await flushEffects();

    const select = screen.getByRole("combobox", { name: "Quality preset" });
    fireEvent.change(select, { target: { value: "discord" } });

    expect(setPreset).toHaveBeenCalledWith("discord");
  });

  // Preset selection belongs to the inspector only (the detached bottom
  // selector was removed). These cases keep that coverage with its owner.
  it("quality preset select: renders presets in plain language", () => {
    const presets: Preset[] = [
      { id: "youtube", label: "For YouTube", description: "1080p60, ~12 Mbps", fps: 60, height: 1080, container: "mp4" },
      { id: "discord", label: "For Discord", description: "720p30, ~6 Mbps", fps: 30, height: 720, container: "mp4" },
      { id: "lossless", label: "Lossless local", description: "native resolution, visually lossless", fps: 60, height: 0, container: "mkv" },
      { id: "smallest", label: "Smallest file", description: "720p30, ~2 Mbps", fps: 30, height: 720, container: "mp4" },
    ];
    useSspStore.setState({
      loadPresets: vi.fn().mockResolvedValue(undefined),
      presets: { status: "ready", error: null, presets, presetId: "youtube" },
    });
    render(<CaptureInspector />);
    const select = screen.getByRole("combobox", { name: /Quality preset/ }) as HTMLSelectElement;
    expect(select).toHaveValue("youtube");
    expect(select.textContent).toContain("For YouTube — 1080p60, ~12 Mbps");
    expect(select.textContent).toContain("For Discord — 720p30, ~6 Mbps");
    expect(select).toBeEnabled();
  });

  it("quality preset select: disabled while recording (take-snapshot law)", () => {
    useSspStore.setState({
      loadPresets: vi.fn().mockResolvedValue(undefined),
      presets: {
        status: "ready",
        error: null,
        presets: DUMMY_PRESETS,
        presetId: "youtube",
      },
      session: { ...INITIAL_SESSION, status: "recording", recordingId: "rec_1" },
    });
    render(<CaptureInspector />);
    expect(screen.getByRole("combobox", { name: /Quality preset/ })).toBeDisabled();
  });
});
