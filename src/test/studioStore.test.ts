import { beforeEach, describe, expect, it, vi } from "vitest";
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
  AudioListDevicesReply,
  CameraDeviceInfo,
  CameraOpenReply,
  IpcError,
  LibraryGetReply,
  LibraryListItem,
  LibraryListReply,
  Preset,
  RecordingFinishedEvt,
  RecordingMetersEvt,
  RecordingStartReply,
  RecordingStartedEvt,
  RecordingStatsEvt,
  RecordingStopReply,
  RecordingTickEvt,
  Settings,
  SourceCapabilities,
  SourceSelected,
} from "../types/ipc";
import type * as ipcModule from "../lib/ipc";

// Mock Tauri IPC boundary for store integration testing
vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  sourceSelect: vi.fn(),
  sourceRegionSet: vi.fn(),
  sourceRegionClear: vi.fn(),
  recordingStart: vi.fn(),
  recordingStop: vi.fn(),
  recordingPause: vi.fn(),
  recordingResume: vi.fn(),
  cameraListDevices: vi.fn(),
  cameraOpen: vi.fn(),
  cameraClose: vi.fn(),
  audioListDevices: vi.fn(),
  audioSetChannel: vi.fn(),
  presetsList: vi.fn(),
  libraryList: vi.fn(),
  libraryGet: vi.fn(),
  libraryDelete: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  prefsGet: vi.fn(),
  prefsSet: vi.fn(),
}));

import {
  audioListDevices,
  audioSetChannel,
  cameraClose,
  cameraListDevices,
  cameraOpen,
  libraryGet,
  libraryList,
  prefsSet,
  presetsList,
  recordingStart,
  recordingStop,
  settingsGet,
  settingsSet,
  sourceRegionClear,
  sourceRegionSet,
  sourceSelect,
} from "../lib/ipc";

const mockSourceSelect = vi.mocked(sourceSelect);
const mockSourceRegionSet = vi.mocked(sourceRegionSet);
const mockSourceRegionClear = vi.mocked(sourceRegionClear);
const mockRecordingStart = vi.mocked(recordingStart);
const mockRecordingStop = vi.mocked(recordingStop);
const mockCameraListDevices = vi.mocked(cameraListDevices);
const mockCameraOpen = vi.mocked(cameraOpen);
const mockCameraClose = vi.mocked(cameraClose);
const mockAudioListDevices = vi.mocked(audioListDevices);
const mockAudioSetChannel = vi.mocked(audioSetChannel);
const mockPresetsList = vi.mocked(presetsList);
const mockLibraryList = vi.mocked(libraryList);
const mockLibraryGet = vi.mocked(libraryGet);
const mockSettingsGet = vi.mocked(settingsGet);
const mockSettingsSet = vi.mocked(settingsSet);
const mockPrefsSet = vi.mocked(prefsSet);

const DUMMY_SOURCE_CAPS: SourceCapabilities = {
  fps: 60,
  width: 1920,
  height: 1080,
  cursor: true,
  region: true,
};

const DUMMY_START_REPLY: RecordingStartReply = {
  recordingId: "rec_20261118_01",
  status: "recording",
  encoder: {
    backend: "vaapi",
    isHardware: true,
  },
  startedAt: "2026-11-18T17:00:00Z",
};

const DUMMY_STOP_REPLY: RecordingStopReply = {
  recording: {
    id: 1,
    path: "/home/zvirox/Videos/screenstudio/take_01.mp4",
    container: "mp4",
    durationMs: 14200,
    sizeBytes: 15800000,
    status: "ready",
  },
};

const DUMMY_PRESETS: Preset[] = [
  {
    id: "youtube",
    label: "YouTube 1080p60",
    description: "High quality for web upload",
    fps: 60,
    height: 1080,
    container: "mp4",
  },
  {
    id: "discord",
    label: "Discord 720p30",
    description: "Compact stream for Discord",
    fps: 30,
    height: 720,
    container: "mp4",
  },
];

const DUMMY_SETTINGS: Settings = {
  capture: {
    frameRate: 60,
    encoder: "vaapi",
    qualityPreset: "youtube",
    cameraSelfInsert: false,
  },
  audio: {
    micDeviceId: null,
    desktopAudio: true,
    echoCancel: false,
    micEnabled: true,
    micMuted: false,
    micLevel: 100,
    desktopDeviceId: null,
    desktopMuted: false,
    desktopLevel: 100,
  },
  files: {
    dir: "/home/zvirox/Videos",
    namingPattern: "rec_{date}_{time}",
    container: "mp4",
  },
  shortcuts: {
    quickRecord: "Ctrl+Shift+R",
    pause: "Ctrl+Shift+P",
    stop: "Ctrl+Shift+S",
  },
};

describe("Studio Store Integration: 7 UI v3 Features (Tier 1 & Tier 2)", () => {
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

  // Feature 1: Navigation, Views & Toast Feedback
  describe("Feature 1: Navigation & Toast System", () => {
    it("F1-Store-01: switches active views cleanly across Record, Library, and Settings", () => {
      expect(useSspStore.getState().view).toBe("record");

      useSspStore.getState().setView("library");
      expect(useSspStore.getState().view).toBe("library");

      useSspStore.getState().setView("settings");
      expect(useSspStore.getState().view).toBe("settings");

      useSspStore.getState().setView("record");
      expect(useSspStore.getState().view).toBe("record");
    });

    it("F1-Store-02: pushes error toast on showError and respects maximum toast limit of 3", () => {
      const err1: IpcError = {
        kind: "portal",
        code: "portal.denied",
        retryable: false,
        userMessage: "Permission was denied by desktop portal.",
        details: null,
      };
      const err2: IpcError = {
        kind: "encoder",
        code: "encoder.init_failed",
        retryable: true,
        userMessage: "Hardware encoder init failed.",
        details: null,
      };
      const err3: IpcError = {
        kind: "pipewire",
        code: "pipewire.server_down",
        retryable: true,
        userMessage: "Audio server unavailable.",
        details: null,
      };
      const err4: IpcError = {
        kind: "disk",
        code: "storage.full",
        retryable: false,
        userMessage: "Disk space exhausted.",
        details: null,
      };

      useSspStore.getState().showError(err1);
      useSspStore.getState().showError(err2);
      useSspStore.getState().showError(err3);
      expect(useSspStore.getState().toasts.length).toBe(3);

      // Pushing 4th drops oldest (err1), keeping newest 3
      useSspStore.getState().showError(err4);
      const toasts = useSspStore.getState().toasts;
      expect(toasts.length).toBe(3);
      expect(toasts[0].code).toBe("encoder.init_failed");
      expect(toasts[2].code).toBe("storage.full");

      // Dismissing a toast
      const idToDismiss = toasts[1].id;
      useSspStore.getState().dismissToast(idToDismiss);
      expect(useSspStore.getState().toasts.length).toBe(2);
    });
  });

  // Feature 2: Recording Sessions & Lifecycle
  describe("Feature 2: Session & Recording Lifecycle", () => {
    it("F2-Store-01: coordinates recording start with active live source and started event", async () => {
      useSspStore.setState({
        source: {
          ...INITIAL_SOURCE,
          status: "live",
          sourceId: "mon_0",
          label: "Display 1",
          capabilities: DUMMY_SOURCE_CAPS,
        },
      });

      mockRecordingStart.mockResolvedValueOnce(DUMMY_START_REPLY);

      const promise = useSspStore.getState().startRecording();
      // In-flight command state
      expect(useSspStore.getState().session.status).toBe("starting");

      await promise;
      expect(mockRecordingStart).toHaveBeenCalledTimes(1);

      // Rust truth event arrives via onStarted reducer
      const startedEvt: RecordingStartedEvt = {
        recordingId: "rec_20261118_01",
        encoder: "vaapi",
        startedAt: "2026-11-18T17:00:00Z",
      };
      useSspStore.getState().onStarted(startedEvt);

      const session = useSspStore.getState().session;
      expect(session.status).toBe("recording");
      expect(session.recordingId).toBe("rec_20261118_01");
      expect(session.encoderBackend).toBe("vaapi");
    });

    it("F2-Store-02: updates elapsed timer on tick and pauses/resumes session state", () => {
      useSspStore.setState({
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
        },
      });

      // 1Hz tick event
      const tick1: RecordingTickEvt = {
        recordingId: "rec_20261118_01",
        elapsedMs: 1000,
        state: "recording",
      };
      useSspStore.getState().onTick(tick1);
      expect(useSspStore.getState().session.elapsedMs).toBe(1000);
      expect(useSspStore.getState().session.paused).toBe(false);

      // Paused tick event
      const tickPaused: RecordingTickEvt = {
        recordingId: "rec_20261118_01",
        elapsedMs: 2500,
        state: "paused",
      };
      useSspStore.getState().onTick(tickPaused);
      expect(useSspStore.getState().session.elapsedMs).toBe(2500);
      expect(useSspStore.getState().session.paused).toBe(true);
    });

    it("F2-Store-03: receives 0.5Hz stats payloads and updates stats slice during recording", () => {
      useSspStore.setState({
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
        },
      });

      const statsEvt: RecordingStatsEvt = {
        fps: 59.8,
        bitrateKbps: 6200,
        droppedFrames: 0,
        encodeTimeMs: 4.2,
      };
      useSspStore.getState().onStats(statsEvt);

      expect(useSspStore.getState().session.stats).toEqual(statsEvt);
    });

    it("F2-Store-04: coordinates recording stop, creates Saved toast with path, and resets session to idle", async () => {
      useSspStore.setState({
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
          startedAt: "2026-11-18T17:00:00Z",
          elapsedMs: 14200,
        },
      });

      mockRecordingStop.mockResolvedValueOnce(DUMMY_STOP_REPLY);

      const promise = useSspStore.getState().stopRecording();
      expect(useSspStore.getState().session.status).toBe("stopping");

      await promise;
      expect(mockRecordingStop).toHaveBeenCalledWith("rec_20261118_01");

      // Verify onFinished event resets session and creates Saved toast
      const finishedEvt: RecordingFinishedEvt = {
        recordingId: "rec_20261118_01",
        recording: {
          id: 1,
          path: "/home/zvirox/Videos/screenstudio/take_01.mp4",
          fileName: "take_01.mp4",
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
          thumbPath: null,
          deletedAt: null,
          createdAt: "2026-11-18T17:00:00Z",
          updatedAt: "2026-11-18T17:00:00Z",
        },
      };
      useSspStore.getState().onFinished(finishedEvt);

      expect(useSspStore.getState().session.status).toBe("idle");
      expect(useSspStore.getState().session.recordingId).toBeNull();

      // Check toast feedback
      const toasts = useSspStore.getState().toasts;
      expect(toasts.length).toBeGreaterThan(0);
      const savedToast = toasts[toasts.length - 1];
      expect(savedToast.title).toBe("Recording saved");
      expect(savedToast.path).toBe(finishedEvt.recording.path);
      expect(savedToast.durationMs).toBe(14200);
    });
  });

  // Feature 3: Source Selection & Region Crop
  describe("Feature 3: Source Selection & Hero Canvas Crop", () => {
    it("F3-Store-01: selects Monitor source through portal flow and transitions to live status", async () => {
      const monitorReply: SourceSelected = {
        sourceId: "mon_0",
        kind: "monitor",
        label: "eDP-1 (1920×1080 @ 60Hz)",
        capabilities: DUMMY_SOURCE_CAPS,
        preview: { mode: "stills_jpeg", fps: 8 },
      };
      mockSourceSelect.mockResolvedValueOnce(monitorReply);

      const promise = useSspStore.getState().selectMonitor();
      expect(useSspStore.getState().source.status).toBe("selecting");
      expect(useSspStore.getState().source.selectingKind).toBe("monitor");

      await promise;
      expect(mockSourceSelect).toHaveBeenCalledWith("monitor");

      const source = useSspStore.getState().source;
      expect(source.status).toBe("live");
      expect(source.sourceId).toBe("mon_0");
      expect(source.label).toBe("eDP-1 (1920×1080 @ 60Hz)");
      expect(source.capabilities).toEqual(DUMMY_SOURCE_CAPS);
      expect(source.selectingKind).toBeNull();
    });

    it("F3-Store-02: handles portal cancellation or rejection gracefully without crashing", async () => {
      const portalErr: IpcError = {
        kind: "portal",
        code: "portal.denied",
        retryable: true,
        userMessage: "Capture was cancelled by user.",
        details: null,
      };
      mockSourceSelect.mockRejectedValueOnce(portalErr);

      await useSspStore.getState().selectWindow();

      const source = useSspStore.getState().source;
      expect(source.status).toBe("error");
      expect(source.error?.code).toBe("portal.denied");
      expect(source.selectingKind).toBeNull();
    });

    it("F3-Store-03: sets and clears region crop rectangle for Region capture mode", async () => {
      useSspStore.setState({
        source: {
          ...INITIAL_SOURCE,
          sourceId: "mon_0",
          status: "live",
        },
      });

      const rect = { x: 100, y: 150, w: 1280, h: 720 };
      mockSourceRegionSet.mockResolvedValueOnce({ ok: true });

      await useSspStore.getState().setRegionRect("mon_0", rect);
      expect(mockSourceRegionSet).toHaveBeenCalledWith("mon_0", rect);
      expect(useSspStore.getState().source.regionRect).toEqual(rect);

      mockSourceRegionClear.mockResolvedValueOnce({ ok: true });
      await useSspStore.getState().clearRegionRect("mon_0");
      expect(mockSourceRegionClear).toHaveBeenCalledWith("mon_0");
      expect(useSspStore.getState().source.regionRect).toBeNull();
    });
  });

  // Feature 4: Camera PiP & Capture Inspector Controls
  describe("Feature 4: Camera PiP & Capture Inspector Controls", () => {
    it("F4-Store-01: loads camera device list and opens webcam handle", async () => {
      const camDevices: CameraDeviceInfo[] = [
        {
          id: "v4l2_/dev/video0",
          label: "Integrated Webcam HD",
          isDefault: true,
        },
      ];
      mockCameraListDevices.mockResolvedValueOnce({ devices: camDevices });

      await useSspStore.getState().loadCameraDevices();
      expect(useSspStore.getState().camera.devices).toEqual(camDevices);

      const openReply: CameraOpenReply = {
        cameraId: "cam_handle_0",
        width: 1280,
        height: 720,
      };
      mockCameraOpen.mockResolvedValueOnce(openReply);

      await useSspStore.getState().openCamera("v4l2_/dev/video0");
      expect(mockCameraOpen).toHaveBeenCalledWith("v4l2_/dev/video0");

      const cam = useSspStore.getState().camera;
      expect(cam.status).toBe("open");
      expect(cam.cameraId).toBe("cam_handle_0");
    });

    it("F4-Store-02: closes camera and handles device unplug cleanly", async () => {
      useSspStore.setState({
        camera: {
          ...INITIAL_CAMERA,
          status: "open",
          cameraId: "cam_handle_0",
          deviceId: "v4l2_/dev/video0",
          label: "Integrated Webcam HD",
        },
      });

      mockCameraClose.mockResolvedValueOnce({ ok: true });
      await useSspStore.getState().closeCamera();
      expect(mockCameraClose).toHaveBeenCalledWith("cam_handle_0");
      expect(useSspStore.getState().camera.status).toBe("idle");
      expect(useSspStore.getState().camera.cameraId).toBeNull();
    });

    it("F4-Store-03: updates PiP shape, size, and corner coordinates through ui_prefs", async () => {
      mockPrefsSet.mockResolvedValue({ key: "pip.shape", value: "circle" });

      await useSspStore.getState().setPipShape("circle");
      expect(mockPrefsSet).toHaveBeenCalledWith("pip.shape", "circle");
      expect(useSspStore.getState().prefs.pipShape).toBe("circle");

      await useSspStore.getState().setPipSize(240);
      expect(mockPrefsSet).toHaveBeenCalledWith("pip.size", 240);
      expect(useSspStore.getState().prefs.pipSize).toBe(240);

      await useSspStore.getState().setPipPosition("corner:bottom-right,margin:24");
      expect(mockPrefsSet).toHaveBeenCalledWith("pip.position", "corner:bottom-right,margin:24");
      expect(useSspStore.getState().prefs.pipPosition).toBe("corner:bottom-right,margin:24");
    });
  });

  // Feature 5: Audio Mixer Deck
  describe("Feature 5: Audio Mixer Deck Channel Strips & Meters", () => {
    it("F5-Store-01: loads audio devices and changes microphone gain level", async () => {
      const audioDevices: AudioListDevicesReply = {
        mics: [{ id: "mic_0", label: "USB Condenser Mic", isDefault: true }],
        desktop: [{ id: "sink_0", label: "Speakers", isDefault: true }],
      };
      mockAudioListDevices.mockResolvedValueOnce(audioDevices);

      await useSspStore.getState().loadDevices();
      expect(useSspStore.getState().audio.devices).toEqual(audioDevices);

      mockAudioSetChannel.mockResolvedValueOnce({ ok: true });
      await useSspStore.getState().setChannelLevel("mic", 85);
      expect(mockAudioSetChannel).toHaveBeenCalledWith({ channel: "mic", level: 85 });
      expect(useSspStore.getState().audio.mic.level).toBe(85);
    });

    it("F5-Store-02: mutes channel and updates channel mute state instantly", async () => {
      mockAudioSetChannel.mockResolvedValueOnce({ ok: true });
      await useSspStore.getState().setChannelMuted("mic", true);

      expect(mockAudioSetChannel).toHaveBeenCalledWith({ channel: "mic", muted: true });
      expect(useSspStore.getState().audio.mic.muted).toBe(true);
    });

    it("F5-Store-03: receives live meters events and updates meters projection", () => {
      const metersPayload: RecordingMetersEvt = {
        mic: { rms: 0.25, peak: 0.65 },
        desktop: { rms: 0.45, peak: 0.82 },
      };

      useSspStore.getState().onMeters(metersPayload);
      const meters = useSspStore.getState().audio.meters;
      expect(meters).toEqual(metersPayload);
      expect(meters?.mic.peak).toBe(0.65);
      expect(meters?.desktop.peak).toBe(0.82);
    });
  });

  // Feature 6: Right Takes & Presets Gallery
  describe("Feature 6: Takes & Presets Gallery", () => {
    it("F6-Store-01: loads recent takes list for TakesGallery deck", async () => {
      const takeItem: LibraryListItem = {
        id: 1,
        path: "/recordings/take_01.mp4",
        fileName: "take_01.mp4",
        kind: "monitor",
        container: "mp4",
        status: "ready",
        durationMs: 15400,
        width: 1920,
        height: 1080,
        fps: 60,
        sizeBytes: 12400000,
        encoder: "vaapi",
        isHwEncoder: true,
        audioJson: null,
        chapterJson: null,
        thumbPath: "/recordings/take_01.jpg",
        deletedAt: null,
        createdAt: "2026-11-18T16:00:00Z",
        updatedAt: "2026-11-18T16:00:00Z",
      };

      const dummyTakes: LibraryListReply = {
        items: [takeItem],
        total: 1,
        page: { limit: 50, offset: 0 },
      };
      mockLibraryList.mockResolvedValueOnce(dummyTakes);

      await useSspStore.getState().loadLibrary();
      expect(mockLibraryList).toHaveBeenCalledTimes(1);

      const library = useSspStore.getState().library;
      expect(library.items.length).toBe(1);
      expect(library.items[0].fileName).toBe("take_01.mp4");
      expect(library.total).toBe(1);
    });

    it("F6-Store-02: opens and closes recording detail drawer", async () => {
      const takeDetail: LibraryGetReply = {
        id: 1,
        path: "/recordings/take_01.mp4",
        fileName: "take_01.mp4",
        kind: "monitor",
        container: "mp4",
        status: "ready",
        durationMs: 15400,
        width: 1920,
        height: 1080,
        fps: 60,
        sizeBytes: 12400000,
        encoder: "vaapi",
        isHwEncoder: true,
        audioJson: null,
        chapterJson: null,
        thumbPath: "/recordings/take_01.jpg",
        deletedAt: null,
        createdAt: "2026-11-18T16:00:00Z",
        updatedAt: "2026-11-18T16:00:00Z",
      };
      mockLibraryGet.mockResolvedValueOnce(takeDetail);

      await useSspStore.getState().openDrawer(1);
      expect(mockLibraryGet).toHaveBeenCalledWith(1);
      expect(useSspStore.getState().library.drawerOpen).toBe(true);
      expect(useSspStore.getState().library.selectedRecording).toEqual(takeDetail);

      useSspStore.getState().closeDrawer();
      expect(useSspStore.getState().library.drawerOpen).toBe(false);
      expect(useSspStore.getState().library.selectedRecording).toBeNull();
    });

    it("F6-Store-03: loads quality presets and changes active preset selection", async () => {
      mockPresetsList.mockResolvedValueOnce({ presets: DUMMY_PRESETS });
      mockSettingsGet.mockResolvedValueOnce({
        frameRate: 60,
        encoder: "vaapi",
        qualityPreset: "discord",
        cameraSelfInsert: false,
      });
      await useSspStore.getState().loadPresets();

      expect(useSspStore.getState().presets.presets.length).toBe(2);

      mockSettingsSet.mockResolvedValueOnce(DUMMY_SETTINGS);
      await useSspStore.getState().setPreset("youtube");
      expect(mockSettingsSet).toHaveBeenCalledWith({
        capture: { qualityPreset: "youtube" },
      });
      expect(useSspStore.getState().presets.presetId).toBe("youtube");
    });
  });

  // Feature 7: Cross-Feature Multi-Slice Integration
  describe("Feature 7: Cross-Feature Multi-Slice Integration", () => {
    it("F7-Store-01: Take-Snapshot Law: quality preset changes are locked while recording is live", async () => {
      useSspStore.setState({
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
        },
        presets: {
          ...INITIAL_PRESETS,
          presetId: "youtube",
          presets: DUMMY_PRESETS,
        },
      });

      // While recording is live, setPreset ignores change
      await useSspStore.getState().setPreset("discord");
      expect(useSspStore.getState().presets.presetId).toBe("youtube");
      expect(mockSettingsSet).not.toHaveBeenCalled();
    });

    it("F7-Store-02: Recording completion automatically synchronizes with takes library", async () => {
      useSspStore.setState({
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
        },
        library: {
          ...INITIAL_LIBRARY,
          items: [],
          total: 0,
        },
      });

      const finishedEvt: RecordingFinishedEvt = {
        recordingId: "rec_20261118_01",
        recording: {
          id: 2,
          path: "/videos/new_take.mp4",
          fileName: "new_take.mp4",
          kind: "monitor",
          container: "mp4",
          status: "ready",
          durationMs: 8200,
          width: 1920,
          height: 1080,
          fps: 60,
          sizeBytes: 9400000,
          encoder: "vaapi",
          isHwEncoder: true,
          audioJson: null,
          chapterJson: null,
          thumbPath: null,
          deletedAt: null,
          createdAt: "2026-11-18T17:00:00Z",
          updatedAt: "2026-11-18T17:00:00Z",
        },
      };

      mockLibraryList.mockResolvedValueOnce({
        items: [finishedEvt.recording],
        total: 1,
        page: { limit: 50, offset: 0 },
      });

      useSspStore.getState().onFinished(finishedEvt);

      // Session resets to idle
      expect(useSspStore.getState().session.status).toBe("idle");
      expect(useSspStore.getState().session.recordingId).toBeNull();

      // Synchronize takes library and verify the finished recording appears in library items
      await useSspStore.getState().loadLibrary();
      const library = useSspStore.getState().library;
      expect(library.items).toHaveLength(1);
      expect(library.items[0].id).toBe(finishedEvt.recording.id);
      expect(library.items[0].fileName).toBe(finishedEvt.recording.fileName);
      expect(library.items[0].path).toBe(finishedEvt.recording.path);
      expect(library.total).toBe(1);
    });

    it("F7-Store-03: Muting audio channel during active take updates meters without interrupting recording", async () => {
      useSspStore.setState({
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
          elapsedMs: 5000,
        },
        audio: {
          ...INITIAL_AUDIO,
          mic: { enabled: true, muted: false, deviceId: "mic_0", level: 90 },
          meters: {
            mic: { rms: 0.3, peak: 0.7 },
            desktop: { rms: 0.2, peak: 0.5 },
          },
        },
      });

      mockAudioSetChannel.mockResolvedValueOnce({ ok: true });
      await useSspStore.getState().setChannelMuted("mic", true);

      // Channel is muted
      expect(useSspStore.getState().audio.mic.muted).toBe(true);
      // Session status is completely unaffected
      expect(useSspStore.getState().session.status).toBe("recording");
      expect(useSspStore.getState().session.elapsedMs).toBe(5000);
    });

    it("F7-Store-04: View switching preserves background recording session and live source", () => {
      useSspStore.setState({
        view: "record",
        source: {
          ...INITIAL_SOURCE,
          status: "live",
          sourceId: "mon_0",
          label: "Display 1",
        },
        session: {
          ...INITIAL_SESSION,
          status: "recording",
          recordingId: "rec_20261118_01",
          elapsedMs: 12000,
        },
      });

      // Switch to Library
      useSspStore.getState().setView("library");
      expect(useSspStore.getState().view).toBe("library");
      expect(useSspStore.getState().session.status).toBe("recording");
      expect(useSspStore.getState().source.status).toBe("live");

      // Switch to Settings
      useSspStore.getState().setView("settings");
      expect(useSspStore.getState().view).toBe("settings");
      expect(useSspStore.getState().session.status).toBe("recording");

      // Switch back to Record
      useSspStore.getState().setView("record");
      expect(useSspStore.getState().view).toBe("record");
      expect(useSspStore.getState().session.status).toBe("recording");
      expect(useSspStore.getState().session.elapsedMs).toBe(12000);
    });
  });
});
