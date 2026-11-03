import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_SESSION,
  INITIAL_SOURCE,
  useSspStore,
} from "./store";
import type {
  AudioListDevicesReply,
  IpcError,
  RecordingStartReply,
  Settings,
  SourceCapabilities,
} from "../types/ipc";
import type * as ipcModule from "./ipc";

vi.mock("./ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  sourceSelect: vi.fn(),
  recordingStart: vi.fn(),
  recordingStop: vi.fn(),
  settingsGet: vi.fn(),
  audioSetChannel: vi.fn(),
  audioListDevices: vi.fn(),
}));

import { recordingStart, recordingStop, settingsGet, audioSetChannel, audioListDevices, sourceSelect } from "./ipc";
const mockedSelect = vi.mocked(sourceSelect);
const mockedStart = vi.mocked(recordingStart);
const mockedStop = vi.mocked(recordingStop);
const mockedSettingsGet = vi.mocked(settingsGet);
const mockedSetChannel = vi.mocked(audioSetChannel);
const mockedAudioListDevices = vi.mocked(audioListDevices);

/* §4.1 state law: the store is a projection with a schema — recording
   session truth lives in Rust (events push reducers), source truth arrives
   through source_select's reply, and commands are the only mutations.
   ActionRow/SourceDeck render from this slice. */

const CAPS: SourceCapabilities = {
  fps: 60,
  width: 2560,
  height: 1440,
  cursor: true,
  region: true,
};

const PORTAL_DENIED: IpcError = {
  kind: "portal",
  code: "portal.denied",
  retryable: false,
  userMessage: "Screen capture was blocked.",
  details: null,
};

const START_REPLY: RecordingStartReply = {
  recordingId: "rec_01HV3",
  status: "recording",
  encoder: { backend: "x264", isHardware: false },
  startedAt: "2026-11-02T10:00:00Z",
};

const STREAM_LOST: IpcError = {
  kind: "pipewire",
  code: "pipewire.stream_lost",
  retryable: false,
  userMessage: "The capture stream ended unexpectedly.",
  details: null,
};

function liveSource() {
  useSspStore.setState({
    source: {
      ...INITIAL_SOURCE,
      status: "live",
      sourceId: "src_01HV3",
      label: "Monitor 1 (2560×1440)",
      capabilities: CAPS,
    },
  });
}

function recordingSession() {
  useSspStore.setState({
    session: {
      ...INITIAL_SESSION,
      status: "recording",
      recordingId: "rec_01HV3",
      encoderBackend: "x264",
      startedAt: "2026-11-02T10:00:00Z",
      elapsedMs: 1000,
    },
  });
}

describe("source slice (§6.1 monitor chip)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({ source: INITIAL_SOURCE, session: INITIAL_SESSION });
  });

  it("starts idle with no source and no session", () => {
    const s = useSspStore.getState();
    expect(s.source.status).toBe("idle");
    expect(s.session.status).toBe("idle");
  });

  it("selectMonitor resolves to live with label + capabilities from §2.1", async () => {
    mockedSelect.mockResolvedValue({
      sourceId: "src_01HV3",
      kind: "monitor",
      label: "Monitor 1 (2560×1440)",
      capabilities: CAPS,
      preview: { mode: "stills_jpeg", fps: 8 },
    });
    const p = useSspStore.getState().selectMonitor();
    expect(useSspStore.getState().source.status).toBe("selecting");
    await p;
    const s = useSspStore.getState().source;
    expect(s.status).toBe("live");
    expect(s.sourceId).toBe("src_01HV3");
    expect(s.label).toBe("Monitor 1 (2560×1440)");
    expect(s.capabilities).toEqual(CAPS);
  });

  it("selectMonitor rejection → source error carrying the §1 IpcError", async () => {
    mockedSelect.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().selectMonitor();
    const s = useSspStore.getState().source;
    expect(s.status).toBe("error");
    expect(s.error).toEqual(PORTAL_DENIED);
  });

  it("startRecording with no live source is a guarded no-op (no IPC)", async () => {
    await useSspStore.getState().startRecording();
    expect(mockedStart).not.toHaveBeenCalled();
    expect(useSspStore.getState().session.status).toBe("idle");
  });

  it("startRecording: idle → starting → recording with the §2.3 reply", async () => {
    liveSource();
    mockedStart.mockResolvedValue({
      recordingId: "rec_01HV3",
      status: "recording",
      encoder: { backend: "x264", isHardware: false },
      startedAt: "2026-11-02T10:00:00Z",
    });
    const p = useSspStore.getState().startRecording();
    expect(useSspStore.getState().session.status).toBe("starting");
    await p;
    const s = useSspStore.getState().session;
    expect(s.status).toBe("recording");
    expect(s.recordingId).toBe("rec_01HV3");
    expect(s.encoderBackend).toBe("x264");
    expect(s.elapsedMs).toBe(0);
    expect(mockedStart).toHaveBeenCalledWith({
      sourceId: "src_01HV3",
      regionRect: null,
      audio: [],
      cameraId: null,
      presetId: null,
      outputDir: null,
    });
  });

  it("stopRecording: recording → stopping → idle; source stays live", async () => {
    liveSource();
    recordingSession();
    mockedStop.mockResolvedValue({
      recording: {
        id: 0,
        path: "/home/u/Videos/SSP/first-rec.mkv",
        container: "mkv",
        durationMs: 1500,
        sizeBytes: 42_000,
        status: "ready",
      },
    });
    const p = useSspStore.getState().stopRecording();
    expect(useSspStore.getState().session.status).toBe("stopping");
    await p;
    expect(useSspStore.getState().session.status).toBe("idle");
    expect(useSspStore.getState().source.status).toBe("live");
  });
});

describe("session event projection (Rust truth, §4.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({ source: INITIAL_SOURCE, session: INITIAL_SESSION });
  });

  it("onTick advances elapsedMs and ignores foreign recording ids", () => {
    recordingSession();
    useSspStore.getState().onTick({
      recordingId: "rec_01HV3",
      elapsedMs: 5400,
      state: "recording",
    });
    expect(useSspStore.getState().session.elapsedMs).toBe(5400);
    useSspStore.getState().onTick({
      recordingId: "rec_other",
      elapsedMs: 99_000,
      state: "recording",
    });
    expect(useSspStore.getState().session.elapsedMs).toBe(5400);
  });

  it("onSessionError sets the fault copy without leaving recording state (take still ending)", () => {
    recordingSession();
    useSspStore.getState().onSessionError(STREAM_LOST);
    const s = useSspStore.getState().session;
    expect(s.status).toBe("recording");
    expect(s.fault).toEqual(STREAM_LOST);
  });

  it("stopRecording rejection after a fault is no-double-telling (§6.5): fault retained, status idle", async () => {
    liveSource();
    recordingSession();
    useSspStore.getState().onSessionError(STREAM_LOST);
    // Same code, different copy — the reply must not overwrite the copy the
    // user is already looking at.
    mockedStop.mockRejectedValue({ ...STREAM_LOST, userMessage: "Take ended early." });
    await useSspStore.getState().stopRecording();
    const s = useSspStore.getState().session;
    expect(s.status).toBe("idle");
    expect(s.fault).toEqual(STREAM_LOST);
  });

  it("stopRecording rejection WITHOUT a prior fault carries the authoritative §1 error", async () => {
    liveSource();
    recordingSession();
    mockedStop.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().stopRecording();
    const s = useSspStore.getState().session;
    expect(s.status).toBe("idle");
    expect(s.fault).toEqual(PORTAL_DENIED);
  });

  it("onFinished tears the session down and keeps the live source", () => {
    liveSource();
    recordingSession();
    useSspStore.getState().onFinished({
      recordingId: "rec_01HV3",
      recording: {
        id: 0,
        path: "/home/u/Videos/SSP/first-rec.mkv",
        fileName: "first-rec.mkv",
        kind: "monitor",
        container: "mkv",
        status: "ready",
        durationMs: 1500,
        width: 320,
        height: 240,
        fps: 60,
        sizeBytes: 42_000,
        encoder: "x264",
        isHwEncoder: false,
        audioJson: null,
        chapterJson: null,
        thumbPath: null,
        deletedAt: null,
        createdAt: "2026-11-02T10:00:00Z",
        updatedAt: "2026-11-02T10:00:01Z",
      },
    });
    const s = useSspStore.getState();
    expect(s.session).toEqual(INITIAL_SESSION);
    expect(s.source.status).toBe("live");
  });
});

describe("toasts (§5.6 saved-file feedback; 1.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      toasts: [],
      nextToastId: 1,
    });
  });

  const FINISHED = {
    recordingId: "rec_01HV3",
    recording: {
      id: 17,
      path: "/home/u/Videos/SSP/first-rec.mkv",
      fileName: "first-rec.mkv",
      kind: "recording",
      container: "mkv",
      status: "ready",
      durationMs: 65_400,
      width: 1920,
      height: 1080,
      fps: 60,
      sizeBytes: 593_282,
      encoder: "x264",
      isHwEncoder: false,
      audioJson: null,
      chapterJson: null,
      thumbPath: null,
      deletedAt: null,
      createdAt: "2026-11-02T10:00:00Z",
      updatedAt: "2026-11-02T10:01:05Z",
    },
  } as const;

  it("onFinished pushes ONE saved toast carrying path + duration for §5.6/§6.2", () => {
    liveSource();
    recordingSession();
    useSspStore.getState().onFinished(FINISHED);
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    const saved = toasts[0]!;
    expect(saved.kind).toBe("status");
    expect(saved.path).toBe("/home/u/Videos/SSP/first-rec.mkv");
    expect(saved.durationMs).toBe(65_400);
  });

  it("toasts are capped at three — oldest drops (§5.6 stack law)", () => {
    const push = useSspStore.getState();
    // Four finished events → only the three newest toasts remain.
    push.onFinished(FINISHED);
    push.onFinished({ ...FINISHED, recordingId: "rec_2" });
    push.onFinished({ ...FINISHED, recordingId: "rec_3" });
    push.onFinished({ ...FINISHED, recordingId: "rec_4" });
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts[0]!.durationMs).toBe(65_400);
  });

  it("dismissToast removes exactly one toast by id", () => {
    useSspStore.getState().onFinished(FINISHED);
    const first = useSspStore.getState().toasts[0]!;
    useSspStore.getState().dismissToast(first.id);
    expect(useSspStore.getState().toasts).toHaveLength(0);
  });

  it("a NEW fault pushes one error toast; the no-double-telling stop reply adds none", async () => {
    liveSource();
    recordingSession();
    useSspStore.getState().onSessionError(STREAM_LOST);
    const afterFault = useSspStore.getState().toasts;
    expect(afterFault).toHaveLength(1);
    expect(afterFault[0]!.kind).toBe("error");
    expect(afterFault[0]!.title).toBe(STREAM_LOST.userMessage);

    // The authoritative stop reply carries the SAME code — the copy the
    // user is reading is kept, and no second toast may appear (§6.5).
    mockedStop.mockRejectedValue({
      ...STREAM_LOST,
      userMessage: "Take ended early.",
    });
    await useSspStore.getState().stopRecording();
    expect(useSspStore.getState().toasts).toHaveLength(1);
  });

  it("a stop reply failure with a NEW code pushes its own error toast", async () => {
    liveSource();
    recordingSession();
    mockedStop.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().stopRecording();
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.title).toBe(PORTAL_DENIED.userMessage);
  });

  it("selectMonitor rejection surfaces as an error toast (floatover level now that ToastHost exists)", async () => {
    mockedSelect.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().selectMonitor();
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.kind).toBe("error");
    // The §1 copy keeps flowing from the slice — the toast renders it once.
    expect(toasts[0]!.title).toBe(PORTAL_DENIED.userMessage);
  });
});

/* ---------- 2.2 audio strip (§6.1 #3; API §2.2 + §3 meters) ---------- */

const AUDIO_SETTINGS: Settings["audio"] = {
  micDeviceId: null,
  desktopAudio: true,
  echoCancel: false,
  micEnabled: true,
  micMuted: false,
  micLevel: 80,
  desktopDeviceId: null,
  desktopMuted: false,
  desktopLevel: 70,
};

const DEVICES: AudioListDevicesReply = {
  mics: [
    { id: "alsa:mic0", label: "Blue Yeti", isDefault: true },
    { id: "alsa:mic1", label: "Webcam mic", isDefault: false },
  ],
  desktop: [{ id: "pwp:sink0", label: "Speakers (monitor)", isDefault: false }],
};

describe("audio slice (§6.1 #3 strip; 2.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      audio: {
        status: "idle",
        error: null,
        mic: { enabled: false, muted: false, deviceId: null, level: 100 },
        desktop: { enabled: false, muted: false, deviceId: null, level: 100 },
        meters: null,
        devices: null,
        devicesLoading: false,
      },
      toasts: [],
      nextToastId: 1,
    });
  });

  function readyAudio() {
    const current = useSspStore.getState().audio;
    useSspStore.setState({
      audio: {
        ...current,
        status: "ready",
        mic: { enabled: true, muted: false, deviceId: null, level: 80 },
        desktop: { enabled: true, muted: false, deviceId: null, level: 70 },
      },
    });
  }

  it("loads the §2.6 audio settings snapshot into per-channel state", async () => {
    mockedSettingsGet.mockResolvedValue(AUDIO_SETTINGS);
    await useSspStore.getState().loadAudio();
    const a = useSspStore.getState().audio;
    expect(a.status).toBe("ready");
    expect(a.mic).toEqual({
      enabled: true,
      muted: false,
      deviceId: null,
      level: 80,
    });
    expect(a.desktop.enabled).toBe(true);
  });

  it("loadAudio failure lands in the slice error (the strip renders §5.5 error state)", async () => {
    mockedSettingsGet.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().loadAudio();
    expect(useSspStore.getState().audio.status).toBe("error");
    expect(useSspStore.getState().audio.error).toEqual(PORTAL_DENIED);
  });

  it("toggling a channel persists through audio_set_channel and updates the slice", async () => {
    readyAudio();
    mockedSetChannel.mockResolvedValue({ ok: true });
    await useSspStore.getState().setChannelEnabled("mic", false);
    expect(mockedSetChannel).toHaveBeenCalledWith({
      channel: "mic",
      enabled: false,
    });
    expect(useSspStore.getState().audio.mic.enabled).toBe(false);
    expect(useSspStore.getState().audio.status).toBe("ready");
  });

  it("a rejected channel toggle pushes the §1 copy as a toast, keeps prior state", async () => {
    readyAudio();
    mockedSetChannel.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().setChannelEnabled("desktop", false);
    expect(useSspStore.getState().audio.desktop.enabled).toBe(true);
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.title).toBe(PORTAL_DENIED.userMessage);
  });

  it("picking a device persists deviceId (null = system default clears it)", async () => {
    readyAudio();
    mockedSetChannel.mockResolvedValue({ ok: true });
    await useSspStore.getState().setChannelDevice("mic", "alsa:mic1");
    expect(mockedSetChannel).toHaveBeenCalledWith({
      channel: "mic",
      deviceId: "alsa:mic1",
    });
    expect(useSspStore.getState().audio.mic.deviceId).toBe("alsa:mic1");
    await useSspStore.getState().setChannelDevice("mic", null);
    expect(useSspStore.getState().audio.mic.deviceId).toBe(null);
  });

  it("loadDevices fills the §2.2 snapshot once; a re-load reuses the cache", async () => {
    mockedAudioListDevices.mockResolvedValue(DEVICES);
    await useSspStore.getState().loadDevices();
    expect(useSspStore.getState().audio.devices).toEqual(DEVICES);
    await useSspStore.getState().loadDevices();
    expect(mockedAudioListDevices).toHaveBeenCalledTimes(1);
  });

  it("a failed device enumeration leaves prior state and pushes the §1 toast", async () => {
    useSspStore.setState({
      audio: { ...useSspStore.getState().audio, devicesLoading: false },
    });
    mockedAudioListDevices.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().loadDevices();
    expect(useSspStore.getState().audio.devicesLoading).toBe(false);
    expect(useSspStore.getState().audio.devices).toBe(null);
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.title).toBe(PORTAL_DENIED.userMessage);
  });

  it("onMeters stores the latest two-key payload and startRecording sends the enabled channels", async () => {
    readyAudio();
    liveSource();
    useSspStore
      .getState()
      .onMeters({ mic: { rms: 0.42, peak: 0.71 }, desktop: { rms: 0, peak: 0 } });
    expect(useSspStore.getState().audio.meters).toEqual({
      mic: { rms: 0.42, peak: 0.71 },
      desktop: { rms: 0, peak: 0 },
    });

    mockedStart.mockResolvedValue(START_REPLY);
    await useSspStore.getState().startRecording();
    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: [
          { channel: "mic", deviceId: null },
          { channel: "desktop", deviceId: null },
        ],
      }),
    );
  });

  it("startRecording sends only ENABLED channels (disabled ones ride as nothing)", async () => {
    readyAudio();
    useSspStore.getState().onMeters({
      mic: { rms: 0, peak: 0 },
      desktop: { rms: 0, peak: 0 },
    });
    useSspStore.setState({
      audio: {
        ...useSspStore.getState().audio,
        mic: { ...useSspStore.getState().audio.mic, enabled: false },
      },
    });
    liveSource();
    mockedStart.mockResolvedValue(START_REPLY);
    await useSspStore.getState().startRecording();
    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: [{ channel: "desktop", deviceId: null }],
      }),
    );
  });

  it("meters keep the LAST payload when the take ends (strip decays visually, no stale crash)", () => {
    readyAudio();
    useSspStore
      .getState()
      .onMeters({ mic: { rms: 0.3, peak: 0.3 }, desktop: { rms: 0.1, peak: 0.1 } });
    useSspStore.getState().onFinished({
      recordingId: "rec_01HV3",
      recording: {
        id: 7,
        path: "/tmp/a.mkv",
        fileName: "a.mkv",
        kind: "monitor",
        container: "mkv",
        status: "ready",
        durationMs: 1000,
        width: null,
        height: null,
        fps: null,
        sizeBytes: 1,
        encoder: "x264",
        isHwEncoder: false,
        audioJson: null,
        chapterJson: null,
        thumbPath: null,
        deletedAt: null,
        createdAt: "2026-11-02T10:00:00Z",
        updatedAt: "2026-11-02T10:00:00Z",
      },
    });
    // The strip is idle-visible: the last readings freeze on purpose at
    // 29 Hz cadence end; the EDUCATION state keys off recording status,
    // not meter silence (§6.3 pairs them in the component).
    expect(useSspStore.getState().audio.meters).toEqual({
      mic: { rms: 0.3, peak: 0.3 },
      desktop: { rms: 0.1, peak: 0.1 },
    });
  });
});


