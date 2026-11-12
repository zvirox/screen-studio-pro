import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_SESSION, INITIAL_SOURCE, INITIAL_SETTINGS, INITIAL_PREFS, INITIAL_TOASTS, useSspStore } from "./store";
import type {
  AudioListDevicesReply,
  CaptureSettings,
  IpcError,
  PrefEntry,
  PrefsGetReply,
  RecordingStartReply,
  Settings,
  SourceCapabilities,
} from "../types/ipc";
import type * as ipcModule from "./ipc";
import type { SettingsSlice } from "./store";

vi.mock("./ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  sourceSelect: vi.fn(),
  recordingStart: vi.fn(),
  recordingStop: vi.fn(),
  recordingPause: vi.fn(),
  recordingResume: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  prefsGet: vi.fn(),
  prefsSet: vi.fn(),
  presetsList: vi.fn(),
  audioSetChannel: vi.fn(),
  audioListDevices: vi.fn(),
}));

import {
  recordingStart,
  recordingStop,
  recordingPause,
  recordingResume,
  settingsGet,
  settingsSet,
  prefsGet,
  prefsSet,
  presetsList,
  audioSetChannel,
  audioListDevices,
  sourceSelect,
} from "./ipc";
const mockedSelect = vi.mocked(sourceSelect);
const mockedStart = vi.mocked(recordingStart);
const mockedStop = vi.mocked(recordingStop);
const mockedPause = vi.mocked(recordingPause);
const mockedResume = vi.mocked(recordingResume);
const mockedSettingsGet = vi.mocked(settingsGet);
const mockedSettingsSet = vi.mocked(settingsSet);
const mockedPrefsGet = vi.mocked(prefsGet);
const mockedPrefsSet = vi.mocked(prefsSet);
const mockedPresetsList = vi.mocked(presetsList);
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

/* 2.3: the §2.3 pause/resume bad_state class (API.md §2.3 error rows). */
const BAD_STATE: IpcError = {
  kind: "ipc",
  code: "ipc.bad_state",
  retryable: false,
  userMessage: "The recording is already paused.",
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

describe("tray and IPC ordering (API §4.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({ source: INITIAL_SOURCE, session: INITIAL_SESSION, ...INITIAL_TOASTS });
  });

  const started = { ...START_REPLY, encoder: "x264" };

  it("projects tray start without a command and ignores duplicate start resets", () => {
    useSspStore.getState().onStarted(started);
    useSspStore
      .getState()
      .onTick({ recordingId: started.recordingId, elapsedMs: 2000, state: "paused" });
    useSspStore.getState().onStarted(started);
    expect(useSspStore.getState().session).toMatchObject({
      recordingId: started.recordingId,
      elapsedMs: 2000,
      paused: true,
    });
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("does not resurrect a stopped take from a late start reply", async () => {
    liveSource();
    let resolve!: (reply: RecordingStartReply) => void;
    mockedStart.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = useSspStore.getState().startRecording();
    useSspStore.getState().onStarted(started);
    useSspStore.getState().onShellError({ error: STREAM_LOST, recordingActive: false });
    resolve(START_REPLY);
    await pending;
    expect(useSspStore.getState().session).toEqual(INITIAL_SESSION);
  });

  it("preserves live native failures and deduplicates stop fault feedback", () => {
    recordingSession();
    useSspStore.getState().onSessionError(STREAM_LOST);
    useSspStore.getState().onShellError({ error: STREAM_LOST, recordingActive: true });
    expect(useSspStore.getState().session.recordingId).toBe(START_REPLY.recordingId);
    useSspStore.getState().onShellError({ error: STREAM_LOST, recordingActive: false });
    expect(useSspStore.getState().session).toEqual(INITIAL_SESSION);
    expect(useSspStore.getState().toasts).toHaveLength(1);
  });
});

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

  it("onTick carries the 2.3 phase — `paused` flips with tick.state (Rust truth)", () => {
    recordingSession();
    // The frozen elapsed still updates from the tick (the Rust side sends
    // the same frozen value for every paused beat; the UI never invents
    // the freeze locally).
    useSspStore.getState().onTick({
      recordingId: "rec_01HV3",
      elapsedMs: 1100,
      state: "paused",
    });
    expect(useSspStore.getState().session.paused).toBe(true);
    expect(useSspStore.getState().session.status).toBe("recording");
    useSspStore.getState().onTick({
      recordingId: "rec_01HV3",
      elapsedMs: 1101,
      state: "recording",
    });
    expect(useSspStore.getState().session.paused).toBe(false);
  });

  it("onStats stores the latest §3 stats payload while a take runs (3.5)", () => {
    recordingSession();
    const stats = { fps: 59.8, droppedFrames: 0, bitrateKbps: 12_100, encodeTimeMs: 5.2 };
    useSspStore.getState().onStats(stats);
    expect(useSspStore.getState().session.stats).toEqual(stats);
    useSspStore.getState().onStats({ fps: 60, droppedFrames: 1, bitrateKbps: 9000, encodeTimeMs: 4 });
    expect(useSspStore.getState().session.stats?.droppedFrames).toBe(1);
  });

  it("onStats outside a recording session is dropped — no stale stats on the idle row", () => {
    useSspStore.getState().onStats({ fps: 60, droppedFrames: 0, bitrateKbps: 1000, encodeTimeMs: 1 });
    expect(useSspStore.getState().session.stats).toBeNull();
  });

  it("a new take starts with empty stats (onStarted resets the slice)", () => {
    recordingSession();
    useSspStore.getState().onStats({ fps: 60, droppedFrames: 0, bitrateKbps: 1000, encodeTimeMs: 1 });
    useSspStore.getState().onStarted({
      recordingId: "rec_new",
      encoder: "x264",
      startedAt: "2026-11-02T11:00:00Z",
    });
    expect(useSspStore.getState().session.stats).toBeNull();
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

describe("pause/resume (2.3, API §2.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      ...INITIAL_TOASTS,
    });
  });

  it("pauseRecording invokes §2.3 with the take id and flips paused on the reply", async () => {
    liveSource();
    recordingSession();
    mockedPause.mockResolvedValue({ status: "paused" });
    await useSspStore.getState().pauseRecording();
    expect(mockedPause).toHaveBeenCalledWith("rec_01HV3");
    const s = useSspStore.getState().session;
    // Paused is a sub-state of the take, not a status of its own — the
    // session stays "recording" (Stop & save must stay live, §5.9).
    expect(s.paused).toBe(true);
    expect(s.status).toBe("recording");
  });

  it("pauseRecording outside a live take is a guarded no-op (no IPC)", async () => {
    await useSspStore.getState().pauseRecording();
    expect(mockedPause).not.toHaveBeenCalled();
  });

  it("pauseRecording rejection → §5.6 error toast; paused stays false", async () => {
    liveSource();
    recordingSession();
    mockedPause.mockRejectedValue(BAD_STATE);
    await useSspStore.getState().pauseRecording();
    const s = useSspStore.getState();
    expect(s.session.paused).toBe(false);
    expect(s.toasts.some((t) => t.kind === "error" && t.code === "ipc.bad_state")).toBe(true);
  });

  it("resumeRecording invokes §2.3 and flips paused off", async () => {
    liveSource();
    recordingSession();
    useSspStore.setState({
      session: { ...useSspStore.getState().session, paused: true },
    });
    mockedResume.mockResolvedValue({ status: "recording" });
    await useSspStore.getState().resumeRecording();
    expect(mockedResume).toHaveBeenCalledWith("rec_01HV3");
    expect(useSspStore.getState().session.paused).toBe(false);
  });

  it("resumeRecording when not paused is a guarded no-op (no IPC)", async () => {
    liveSource();
    recordingSession();
    await useSspStore.getState().resumeRecording();
    expect(mockedResume).not.toHaveBeenCalled();
  });

  it("resumeRecording rejection → §5.6 error toast; paused stays true", async () => {
    liveSource();
    recordingSession();
    useSspStore.setState({
      session: { ...useSspStore.getState().session, paused: true },
    });
    mockedResume.mockRejectedValue(BAD_STATE);
    await useSspStore.getState().resumeRecording();
    const s = useSspStore.getState();
    expect(s.session.paused).toBe(true);
    expect(s.toasts.some((t) => t.kind === "error" && t.code === "ipc.bad_state")).toBe(true);
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

/* ---------- presets (M11; API §2.5) ---------- */

const PRESETS = [
  { id: "youtube" as const, label: "For YouTube", description: "1080p60, ~12 Mbps", fps: 60, height: 1080, container: "mp4" },
  { id: "discord" as const, label: "For Discord", description: "720p30, ~6 Mbps", fps: 30, height: 720, container: "mp4" },
  { id: "lossless" as const, label: "Lossless local", description: "native resolution, visually lossless", fps: 60, height: 0, container: "mkv" },
  { id: "smallest" as const, label: "Smallest file", description: "720p30, ~2 Mbps", fps: 30, height: 720, container: "mp4" },
];

describe("presets (§2.5; M11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      presets: { status: "idle", error: null, presets: [], presetId: null },
      toasts: [],
      nextToastId: 1,
    });
  });

  it("loadPresets fetches the list and mirrors settings.capture.qualityPreset", async () => {
    mockedPresetsList.mockResolvedValue({ presets: PRESETS });
    mockedSettingsGet.mockResolvedValue({
      frameRate: 60,
      encoder: "auto",
      qualityPreset: "discord",
      cameraSelfInsert: false,
    } as CaptureSettings);
    await useSspStore.getState().loadPresets();
    const p = useSspStore.getState().presets;
    expect(p.status).toBe("ready");
    expect(p.presets.map((x) => x.id)).toEqual(["youtube", "discord", "lossless", "smallest"]);
    expect(p.presetId).toBe("discord");
    expect(mockedPresetsList).toHaveBeenCalledTimes(1);
  });

  it("loadPresets failure lands in the slice and pushes the §1 toast", async () => {
    mockedPresetsList.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().loadPresets();
    expect(useSspStore.getState().presets.status).toBe("error");
    expect(useSspStore.getState().presets.error).toEqual(PORTAL_DENIED);
    expect(useSspStore.getState().toasts[0]!.title).toBe(PORTAL_DENIED.userMessage);
  });

  it("setPreset persists capture.qualityPreset and updates the slice; rollback on rejection", async () => {
    mockedSettingsSet.mockResolvedValue({} as never);
    await useSspStore.getState().setPreset("smallest");
    expect(mockedSettingsSet).toHaveBeenCalledWith({ capture: { qualityPreset: "smallest" } });
    expect(useSspStore.getState().presets.presetId).toBe("smallest");

    mockedSettingsSet.mockRejectedValue(PORTAL_DENIED);
    await useSspStore.getState().setPreset("discord");
    expect(useSspStore.getState().presets.presetId).toBe("smallest"); // rolled back
    expect(useSspStore.getState().toasts[0]!.title).toBe(PORTAL_DENIED.userMessage);
  });

  it("setPreset is a no-op while recording (take-snapshot law)", async () => {
    useSspStore.setState({
      session: { ...INITIAL_SESSION, status: "recording", recordingId: "rec_1" },
      presets: { status: "ready", error: null, presets: PRESETS, presetId: "youtube" },
    });
    await useSspStore.getState().setPreset("discord");
    expect(mockedSettingsSet).not.toHaveBeenCalled();
    expect(useSspStore.getState().presets.presetId).toBe("youtube");
  });

  it("startRecording sends the selected preset in presetId", async () => {
    useSspStore.setState({
      source: {
        status: "live",
        sourceId: "src_1",
        label: "Monitor",
        capabilities: CAPS,
        error: null,
        selectingKind: null,
        regionRect: null,
      },
      presets: { status: "ready", error: null, presets: PRESETS, presetId: "discord" },
    });
    mockedStart.mockResolvedValue(START_REPLY);
    await useSspStore.getState().startRecording();
    expect(mockedStart).toHaveBeenCalledWith(expect.objectContaining({ presetId: "discord" }));
  });
});

describe("Settings projection (§6.4 / 4.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({ settings: INITIAL_SETTINGS, prefs: INITIAL_PREFS });
  });

  it("loadCaptureSettings loads capture settings", async () => {
    mockedSettingsGet.mockResolvedValue({
      frameRate: 60,
      encoder: "auto",
      qualityPreset: "youtube",
      cameraSelfInsert: false,
    } as CaptureSettings);
    await useSspStore.getState().loadCaptureSettings();
    expect(mockedSettingsGet).toHaveBeenCalledWith("capture");
    expect(useSspStore.getState().settings.capture?.cameraSelfInsert).toBe(false);
  });

  it("setCameraSelfInsert toggles and persists", async () => {
    mockedSettingsSet.mockResolvedValue({} as Settings);
    useSspStore.setState({
      settings: {
        capture: { frameRate: 60, encoder: "auto", qualityPreset: "youtube", cameraSelfInsert: false },
        captureLoading: false,
      } as SettingsSlice,
    });
    await useSspStore.getState().setCameraSelfInsert(true);
    expect(mockedSettingsSet).toHaveBeenCalledWith({ capture: { cameraSelfInsert: true } });
    expect(useSspStore.getState().settings.capture?.cameraSelfInsert).toBe(true);
  });

  it("setCameraSelfInsert rolls back on rejection", async () => {
    mockedSettingsSet.mockRejectedValue({
      kind: "ipc",
      code: "settings.invalid_value",
      userMessage: "Bad value.",
      details: null,
    } as IpcError);
    useSspStore.setState({
      settings: {
        capture: { frameRate: 60, encoder: "auto", qualityPreset: "youtube", cameraSelfInsert: false },
        captureLoading: false,
      } as SettingsSlice,
    });
    await useSspStore.getState().setCameraSelfInsert(true);
    expect(useSspStore.getState().settings.capture?.cameraSelfInsert).toBe(false);
  });

  it("loadPipPrefs loads all three pip prefs", async () => {
    mockedPrefsGet.mockResolvedValue({ key: "pip.position", value: "corner:bottom-right,margin:24" } as PrefsGetReply);
    mockedPrefsGet
      .mockResolvedValueOnce({ key: "pip.position", value: "corner:bottom-right,margin:24" } as PrefsGetReply)
      .mockResolvedValueOnce({ key: "pip.shape", value: "circle" } as PrefsGetReply)
      .mockResolvedValueOnce({ key: "pip.size", value: 240 } as PrefsGetReply);
    await useSspStore.getState().loadPipPrefs();
    expect(useSspStore.getState().prefs.pipPosition).toBe("corner:bottom-right,margin:24");
    expect(useSspStore.getState().prefs.pipShape).toBe("circle");
    expect(useSspStore.getState().prefs.pipSize).toBe(240);
  });

  it("setPipPosition persists corner+margin wire shape", async () => {
    mockedPrefsSet.mockResolvedValue({} as PrefEntry);
    await useSspStore.getState().setPipPosition("corner:top-left,margin:24");
    expect(mockedPrefsSet).toHaveBeenCalledWith("pip.position", "corner:top-left,margin:24");
    expect(useSspStore.getState().prefs.pipPosition).toBe("corner:top-left,margin:24");
  });

  it("setPipShape persists circle/rounded", async () => {
    mockedPrefsSet.mockResolvedValue({} as PrefEntry);
    await useSspStore.getState().setPipShape("rounded");
    expect(mockedPrefsSet).toHaveBeenCalledWith("pip.shape", "rounded");
    expect(useSspStore.getState().prefs.pipShape).toBe("rounded");
  });

  it("setPipSize persists size clamped 160-320", async () => {
    mockedPrefsSet.mockResolvedValue({} as PrefEntry);
    await useSspStore.getState().setPipSize(320);
    expect(mockedPrefsSet).toHaveBeenCalledWith("pip.size", 320);
    expect(useSspStore.getState().prefs.pipSize).toBe(320);
  });
});
