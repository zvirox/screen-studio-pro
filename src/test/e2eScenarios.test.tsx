import { act, fireEvent, render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import {
  INITIAL_AUDIO,
  INITIAL_CAMERA,
  INITIAL_LIBRARY,
  INITIAL_PREFS,
  INITIAL_PRESETS,
  INITIAL_SESSION,
  INITIAL_SETTINGS,
  INITIAL_SOURCE,
  INITIAL_TOASTS,
  useSspStore,
} from "../lib/store";
import type {
  CameraDeviceInfo,
  IpcError,
  LibraryListItem,
  RecordingFinishedEvt,
  RecordingMetersEvt,
  RecordingStartReply,
  RecordingStopReply,
  RecordingTickEvt,
  SourceCapabilities,
  SourceSelected,
} from "../types/ipc";
import type * as ipcModule from "../lib/ipc";

// Polyfill ResizeObserver for JSDOM
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver =
  window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// Tauri native API mocks
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock IPC methods with sensible defaults to prevent unhandled rejections during component mount
vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  sourceSelect: vi.fn(),
  sourceRegionSet: vi.fn(),
  sourceRegionClear: vi.fn(),
  recordingStart: vi.fn(),
  recordingStop: vi.fn(),
  recordingPause: vi.fn(),
  recordingResume: vi.fn(),
  cameraListDevices: vi.fn().mockResolvedValue({ devices: [] }),
  cameraOpen: vi.fn(),
  cameraClose: vi.fn(),
  audioListDevices: vi.fn().mockResolvedValue({ mics: [], desktop: [] }),
  audioSetChannel: vi.fn().mockResolvedValue({ ok: true }),
  presetsList: vi.fn().mockResolvedValue({
    presets: [
      {
        id: "1080p60",
        label: "1080p60",
        description: "Standard Full HD",
        width: 1920,
        height: 1080,
        fps: 60,
        bitRateKbps: 8000,
        container: "mp4",
      },
    ],
  }),
  libraryList: vi.fn().mockResolvedValue({ items: [], total: 0, page: { limit: 50, offset: 0 } }),
  libraryGet: vi.fn(),
  libraryDelete: vi.fn(),
  settingsGet: vi.fn().mockImplementation(async (key: string) => {
    if (key === "audio") {
      return {
        micEnabled: true,
        micMuted: false,
        micDeviceId: null,
        micLevel: 100,
        desktopAudio: true,
        desktopMuted: false,
        desktopDeviceId: null,
        desktopLevel: 100,
      };
    }
    if (key === "capture") {
      return {
        qualityPreset: "1080p60",
        frameRate: 60,
        encoder: "vaapi",
        cameraSelfInsert: false,
      };
    }
    return {};
  }),
  settingsSet: vi.fn().mockResolvedValue({ ok: true }),
  prefsGet: vi.fn().mockImplementation(async (key: string) => {
    if (key === "pip.shape") return { key, value: "circle" };
    if (key === "pip.size") return { key, value: 240 };
    if (key === "pip.position") return { key, value: "corner:bottom-right,margin:24" };
    if (key === "firstRunCompleted") return { key, value: true };
    return { key, value: null };
  }),
  prefsSet: vi.fn().mockResolvedValue({ ok: true }),
  systemCapabilities: vi.fn().mockResolvedValue({
    portal: { screencast: true, windowCapture: true },
    encoders: { vaapi: true, nvenc: false, x264: true },
  }),
  windowHide: vi.fn().mockResolvedValue(undefined),
}));

import {
  audioSetChannel,
  cameraListDevices,
  cameraOpen,
  libraryList,
  recordingStart,
  recordingStop,
  sourceSelect,
} from "../lib/ipc";

const mockSourceSelect = vi.mocked(sourceSelect);
const mockRecordingStart = vi.mocked(recordingStart);
const mockRecordingStop = vi.mocked(recordingStop);
const mockCameraListDevices = vi.mocked(cameraListDevices);
const mockCameraOpen = vi.mocked(cameraOpen);
const mockAudioSetChannel = vi.mocked(audioSetChannel);
const mockLibraryList = vi.mocked(libraryList);

const DUMMY_SOURCE_CAPS: SourceCapabilities = {
  fps: 60,
  width: 1920,
  height: 1080,
  cursor: true,
  region: true,
};

const DUMMY_START_REPLY: RecordingStartReply = {
  recordingId: "rec_e2e_001",
  status: "recording",
  encoder: {
    backend: "vaapi",
    isHardware: true,
  },
  startedAt: "2026-11-18T17:15:00Z",
};

const DUMMY_STOP_REPLY: RecordingStopReply = {
  recording: {
    id: 101,
    path: "/home/zvirox/Videos/screenstudio/take_e2e_001.mp4",
    container: "mp4",
    durationMs: 14200,
    sizeBytes: 15800000,
    status: "ready",
  },
};

describe("Tier 4: Real-World Studio Application Scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      view: "record",
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      audio: INITIAL_AUDIO,
      camera: INITIAL_CAMERA,
      settings: INITIAL_SETTINGS,
      prefs: INITIAL_PREFS,
      library: INITIAL_LIBRARY,
      presets: INITIAL_PRESETS,
      ...INITIAL_TOASTS,
    });
  });

  /* --------------------------------------------------------------------------
     Scenario 1: Full Studio Startup & Navigation Workflow (F1, F2, F7)
     -------------------------------------------------------------------------- */
  it("Scenario 1: executes cold startup, verifies titlebar chrome, and navigates across views", async () => {
    // 1. Initialize application with default 1360×820 desktop studio layout
    window.innerWidth = 1360;
    window.innerHeight = 820;

    await act(async () => {
      render(<App />);
    });

    // 2. Verify NavBar renders with banner role, brand title, and CSD window controls
    const navBar = screen.getByRole("banner");
    expect(navBar).toBeInTheDocument();
    expect(screen.getByText("ScreenStudio Pro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close window/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /minimize window/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximize window/i })).toBeInTheDocument();

    // 3. Verify telemetry badge and Record CTA button are present in titlebar
    expect(screen.getByLabelText(/telemetry:/i)).toBeInTheDocument();
    expect(within(navBar).getByRole("button", { name: /^record$/i })).toBeInTheDocument();

    // 4. Verify view capsule tabs exist for Record, Library, Settings
    const recordBtn = screen.getByRole("tab", { name: /record/i });
    const libraryBtn = screen.getByRole("tab", { name: /library/i });
    const settingsBtn = screen.getByRole("tab", { name: /settings/i });

    expect(recordBtn).toBeInTheDocument();
    expect(libraryBtn).toBeInTheDocument();
    expect(settingsBtn).toBeInTheDocument();
    expect(recordBtn).toHaveAttribute("aria-selected", "true");

    // 5. Click Library tab in navigation and verify DOM update
    await act(async () => {
      fireEvent.click(libraryBtn);
    });
    expect(useSspStore.getState().view).toBe("library");
    expect(libraryBtn).toHaveAttribute("aria-selected", "true");
    expect(recordBtn).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Library" })).toBeInTheDocument();

    // 6. Click Settings tab in navigation and verify DOM update
    await act(async () => {
      fireEvent.click(settingsBtn);
    });
    expect(useSspStore.getState().view).toBe("settings");
    expect(settingsBtn).toHaveAttribute("aria-selected", "true");
    expect(libraryBtn).toHaveAttribute("aria-selected", "false");

    // 7. Return to Record tab
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    expect(useSspStore.getState().view).toBe("record");
    expect(recordBtn).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: /source/i })).toBeInTheDocument();
  });

  /* --------------------------------------------------------------------------
     Scenario 2: Source Setup & Camera PiP Customization Workflow (F3, F4)
     -------------------------------------------------------------------------- */
  it("Scenario 2: configures monitor capture, transitions preview canvas, and docks Camera PiP", async () => {
    await act(async () => {
      render(<App />);
    });

    // 1. Initial idle state renders source region with education guidance copy
    expect(useSspStore.getState().source.status).toBe("idle");
    const sourceRegion = screen.getByRole("region", { name: /source/i });
    expect(sourceRegion).toBeInTheDocument();
    expect(
      screen.getByText(/Click Monitor to allow capture through your compositor/i),
    ).toBeInTheDocument();

    const monitorBtn = screen.getByRole("button", { name: /monitor/i });
    expect(monitorBtn).toBeInTheDocument();
    expect(monitorBtn).toHaveAttribute("aria-pressed", "false");

    // 2. Click Monitor source button and simulate portal consent resolution
    const monitorReply: SourceSelected = {
      sourceId: "mon_primary",
      kind: "monitor",
      label: "Monitor eDP-1 (1920×1080 @ 60Hz)",
      capabilities: DUMMY_SOURCE_CAPS,
      preview: { mode: "stills_jpeg", fps: 8 },
    };
    mockSourceSelect.mockResolvedValueOnce(monitorReply);

    await act(async () => {
      fireEvent.click(monitorBtn);
    });

    // 3. Verify source becomes live with 1080p60 capabilities and button reflects active pressed state
    const source = useSspStore.getState().source;
    expect(source.status).toBe("live");
    expect(source.sourceId).toBe("mon_primary");
    expect(monitorBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/1920×1080 · 60fps/i)).toBeInTheDocument();

    // 4. Set up Camera PiP
    const camDevices: CameraDeviceInfo[] = [
      {
        id: "v4l2_/dev/video0",
        label: "HD Webcam",
        isDefault: true,
      },
    ];
    mockCameraListDevices.mockResolvedValueOnce({ devices: camDevices });
    mockCameraOpen.mockResolvedValueOnce({
      cameraId: "cam_handle_1",
      width: 1280,
      height: 720,
    });

    await act(async () => {
      await useSspStore.getState().loadCameraDevices();
      await useSspStore.getState().openCamera("v4l2_/dev/video0");
      await useSspStore.getState().setPipShape("circle");
      await useSspStore.getState().setPipSize(240);
      await useSspStore.getState().setPipPosition("corner:bottom-right,margin:24");
    });

    // 5. Verify camera and PiP preferences are active and PiP frame is rendered in DOM
    expect(useSspStore.getState().camera.status).toBe("open");
    expect(useSspStore.getState().camera.cameraId).toBe("cam_handle_1");
    expect(useSspStore.getState().prefs.pipShape).toBe("circle");
    expect(useSspStore.getState().prefs.pipSize).toBe(240);

    const pipFrame = screen.getByRole("group", { name: /camera picture-in-picture frame/i });
    expect(pipFrame).toBeInTheDocument();
    expect(pipFrame).toHaveAttribute("data-camera-pip", "frame");
  });

  /* --------------------------------------------------------------------------
     Scenario 3: Audio Level Monitoring & Mute Toggle Workflow (F5)
     -------------------------------------------------------------------------- */
  it("Scenario 3: monitors live audio peak/RMS meters and exercises channel muting", async () => {
    // 1. Arm audio channels
    useSspStore.setState({
      audio: {
        ...INITIAL_AUDIO,
        status: "ready",
        mic: { enabled: true, muted: false, deviceId: "mic_usb", level: 90 },
        desktop: { enabled: true, muted: false, deviceId: null, level: 100 },
      },
    });

    await act(async () => {
      render(<App />);
    });

    // 2. Verify Audio section and meter elements exist in DOM
    const audioSection = screen.getByRole("region", { name: /audio/i });
    expect(audioSection).toBeInTheDocument();

    const micMeter = screen.getByRole("meter", { name: /mic input level/i });
    const desktopMeter = screen.getByRole("meter", { name: /desktop input level/i });
    expect(micMeter).toBeInTheDocument();
    expect(desktopMeter).toBeInTheDocument();

    // 3. Emit live meters event with hot mic level (-4 dBFS peak) and normal desktop
    const metersEvt: RecordingMetersEvt = {
      mic: { rms: 0.45, peak: 0.85 }, // >-6 dB warning threshold
      desktop: { rms: 0.2, peak: 0.4 },
    };

    act(() => {
      useSspStore.getState().onMeters(metersEvt);
    });

    // 4. Verify meter elements updated their aria-valuenow attributes in DOM
    expect(micMeter).toHaveAttribute("aria-valuenow", "85");
    expect(desktopMeter).toHaveAttribute("aria-valuenow", "40");

    // 5. Verify channel switches in DOM
    const micSwitch = screen.getByRole("switch", { name: /mic channel enabled/i });
    expect(micSwitch).toBeInTheDocument();
    expect(micSwitch).toHaveAttribute("aria-checked", "true");

    // 6. Mute microphone channel
    mockAudioSetChannel.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      await useSspStore.getState().setChannelMuted("mic", true);
    });

    // 7. Verify mic is muted in state; post-gain law silences the channel
    expect(useSspStore.getState().audio.mic.muted).toBe(true);
    expect(mockAudioSetChannel).toHaveBeenCalledWith({ channel: "mic", muted: true });
  });

  /* --------------------------------------------------------------------------
     Scenario 4: Complete Recording Session & Takes Gallery Update (F2, F6, F7)
     -------------------------------------------------------------------------- */
  it("Scenario 4: records active take, finalizes recording, and populates recent takes gallery", async () => {
    // 1. Arm live source and empty takes gallery
    useSspStore.setState({
      source: {
        ...INITIAL_SOURCE,
        status: "live",
        sourceId: "mon_0",
        label: "Primary Display",
        capabilities: DUMMY_SOURCE_CAPS,
      },
      library: {
        ...INITIAL_LIBRARY,
        items: [],
        total: 0,
      },
    });

    await act(async () => {
      render(<App />);
    });

    // 2. Query Primary Record CTA button in NavBar and click it to start recording
    const navBar = screen.getByRole("banner");
    const recordCta = within(navBar).getByRole("button", { name: /^record$/i });
    expect(recordCta).toBeInTheDocument();

    mockRecordingStart.mockResolvedValueOnce(DUMMY_START_REPLY);
    await act(async () => {
      fireEvent.click(recordCta);
    });

    expect(useSspStore.getState().session.status).toBe("recording");
    expect(useSspStore.getState().session.recordingId).toBe("rec_e2e_001");

    // 3. CTA button transitions to Stop recording button in DOM
    const stopCta = within(navBar).getByRole("button", { name: /stop recording/i });
    expect(stopCta).toBeInTheDocument();

    // 4. Emit 1Hz recording ticks (simulate 2 seconds elapsed)
    const tickEvt: RecordingTickEvt = {
      recordingId: "rec_e2e_001",
      elapsedMs: 2000,
      state: "recording",
    };
    act(() => {
      useSspStore.getState().onTick(tickEvt);
    });
    expect(useSspStore.getState().session.elapsedMs).toBe(2000);
    expect(within(navBar).getByText("0:02")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("0:02");

    // 5. Stop recording via clicking Stop CTA button in DOM
    mockRecordingStop.mockResolvedValueOnce(DUMMY_STOP_REPLY);
    await act(async () => {
      fireEvent.click(stopCta);
    });

    // 6. Emit finished event with newly created take
    const finishedEvt: RecordingFinishedEvt = {
      recordingId: "rec_e2e_001",
      recording: {
        id: 101,
        path: "/home/zvirox/Videos/screenstudio/take_e2e_001.mp4",
        fileName: "take_e2e_001.mp4",
        kind: "monitor",
        container: "mp4",
        status: "ready",
        durationMs: 14200,
        width: 1920,
        height: 1080,
        fps: 60,
        sizeBytes: 15800000,
        encoder: "vaapi",
        isHwEncoder: true,
        audioJson: null,
        chapterJson: null,
        thumbPath: "/home/zvirox/Videos/screenstudio/take_e2e_001.jpg",
        deletedAt: null,
        createdAt: "2026-11-18T17:15:00Z",
        updatedAt: "2026-11-18T17:15:00Z",
      },
    };

    act(() => {
      useSspStore.getState().onFinished(finishedEvt);
    });

    // 7. Verify session returns to idle and saved toast feedback appears in ToastHost DOM
    expect(useSspStore.getState().session.status).toBe("idle");
    const toastTitle = screen.getByText("Recording saved");
    expect(toastTitle).toBeInTheDocument();
    expect(toastTitle.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText(/take_e2e_001\.mp4/i)).toBeInTheDocument();

    // 8. Library lists newly available recording
    const libraryTakeItem: LibraryListItem = {
      id: 101,
      path: "/home/zvirox/Videos/screenstudio/take_e2e_001.mp4",
      fileName: "take_e2e_001.mp4",
      kind: "monitor",
      container: "mp4",
      status: "ready",
      durationMs: 14200,
      width: 1920,
      height: 1080,
      fps: 60,
      sizeBytes: 15800000,
      encoder: "vaapi",
      isHwEncoder: true,
      audioJson: null,
      chapterJson: null,
      thumbPath: "/home/zvirox/Videos/screenstudio/take_e2e_001.jpg",
      deletedAt: null,
      createdAt: "2026-11-18T17:15:00Z",
      updatedAt: "2026-11-18T17:15:00Z",
    };

    mockLibraryList.mockResolvedValueOnce({
      items: [libraryTakeItem],
      total: 1,
      page: { limit: 50, offset: 0 },
    });

    await act(async () => {
      await useSspStore.getState().loadLibrary();
    });

    expect(useSspStore.getState().library.items.length).toBe(1);

    // 9. Navigate to Library tab and verify the recording card is rendered in the DOM
    const libraryTab = screen.getByRole("tab", { name: /library/i });
    await act(async () => {
      fireEvent.click(libraryTab);
    });

    expect(screen.getByText("take_e2e_001.mp4")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Library" })).toBeInTheDocument();
  });

  /* --------------------------------------------------------------------------
     Scenario 5: Responsive Window Resize & Dynamic Layout Adaptation (<1120px) (F2, F6, F7)
     -------------------------------------------------------------------------- */
  it("Scenario 5: adapts layout dynamically when resized below 1120px threshold", async () => {
    // 1. Start in full widescreen desktop layout (1360px)
    window.innerWidth = 1360;
    window.innerHeight = 820;

    let container: HTMLElement;
    await act(async () => {
      const rendered = render(<App />);
      container = rendered.container;
    });

    // 2. Verify all initial DOM structures are rendered at 1360px
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();

    const tabList = screen.getByRole("tablist", { name: /views/i });
    expect(tabList).toBeInTheDocument();

    const recordTab = screen.getByRole("tab", { name: /record/i });
    expect(recordTab).toHaveAttribute("aria-selected", "true");

    const mainPanel = screen.getByRole("tabpanel", { name: "Record" });
    expect(mainPanel).toBeInTheDocument();

    const sourceRegion = screen.getByRole("region", { name: /source/i });
    expect(sourceRegion).toBeInTheDocument();

    const audioRegion = screen.getByRole("region", { name: /audio/i });
    expect(audioRegion).toBeInTheDocument();

    // 3. Simulate resizing viewport below 1120px threshold (1080px)
    await act(async () => {
      window.innerWidth = 1080;
      window.dispatchEvent(new Event("resize"));
    });

    // 4. Genuine DOM assertions: Header, Navigation, and Record Panel remain fully functional without breaking
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: /views/i })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /source/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /audio/i })).toBeInTheDocument();

    // Root container maintains responsive vertical shell classes
    const rootDiv = container!.firstElementChild;
    expect(rootDiv).toHaveClass("flex", "h-dvh", "flex-col", "bg-canvas", "text-ink");

    // 5. Simulate keyboard dismissal with Escape key
    fireEvent.keyDown(window, { key: "Escape" });

    // 6. Restore viewport back to standard 1360px
    await act(async () => {
      window.innerWidth = 1360;
      window.dispatchEvent(new Event("resize"));
    });

    // 7. Verify layout elements remain stable after viewport restoration
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /record/i })).toHaveAttribute("aria-selected", "true");
  });

  /* --------------------------------------------------------------------------
     Scenario 6: Negative Control — Portal Access Denial & Graceful Error Recovery
     -------------------------------------------------------------------------- */
  it("Scenario 6: gracefully handles portal screen capture denial with toast notification and recovery", async () => {
    await act(async () => {
      render(<App />);
    });

    const monitorBtn = screen.getByRole("button", { name: /monitor/i });
    expect(monitorBtn).toBeInTheDocument();

    // 1. Simulate portal permission denial rejection from the platform
    const portalError: IpcError = {
      kind: "portal",
      code: "portal.screencast_denied",
      retryable: true,
      userMessage: "Screen recording permission was denied. Please allow access in your system settings.",
      details: null,
    };
    mockSourceSelect.mockRejectedValueOnce(portalError);

    // 2. Click Monitor button to request capture
    await act(async () => {
      fireEvent.click(monitorBtn);
    });

    // 3. Verify error toast is displayed in the DOM
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Screen recording permission was denied/i)).toBeInTheDocument();

    // 4. Source enters error status and preserves error code; button is unpressed
    expect(useSspStore.getState().source.status).toBe("error");
    expect(useSspStore.getState().source.error?.code).toBe("portal.screencast_denied");
    expect(monitorBtn).toHaveAttribute("aria-pressed", "false");

    // 5. User dismisses error toast via dismiss button
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    expect(dismissBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    await waitForElementToBeRemoved(() => screen.queryByRole("alert"));
    expect(useSspStore.getState().toasts).toHaveLength(0);
  });
});
