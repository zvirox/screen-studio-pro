import { create } from "zustand";
import {
  audioListDevices,
  audioSetChannel,
  cameraListDevices,
  cameraOpen,
  cameraClose,
  prefsGet,
  prefsSet,
  presetsList,
  libraryList,
  libraryGet,
  libraryDelete,
  recordingStart,
  recordingStop,
  recordingPause,
  recordingResume,
  settingsGet,
  settingsSet,
  sourceSelect,
  sourceRegionSet,
  sourceRegionClear,
  systemCapabilities,
} from "./ipc";
import type {
  AudioChannelSpec,
  AudioListDevicesReply,
  CameraDeviceInfo,
  Capabilities,
  CaptureSettings,
  IpcError,
  Preset,
  PresetId,
  RecordingFinishedEvt,
  RecordingMetersEvt,
  RecordingStartedEvt,
  RecordingStatsEvt,
  RecordingTickEvt,
  ShellErrorEvt,
  SourceCapabilities,
  LibraryGetReply,
  LibraryListFilter,
  LibraryListItem,
  LibraryListSort,
  LibraryUpdatedEvt,
} from "../types/ipc";

/* lib/store.ts — Zustand UI-state wiring (ARCHITECTURE §2).
   §4.1 state law: the store is a PROJECTION WITH A SCHEMA, not a peer of
   Rust truth. Recording session and source/portal state are owned by the
   core; events push the reducers (hooks/useRecordingState) and commands
   are the only mutations. Ephemeral command-in-flight status ("selecting",
   "starting", "stopping") is UI state and lives here only for the
   DESIGN §5.1 loading states — a reply or rejection always resolves it. */

export type ViewId = "record" | "library" | "settings";

/* ---------- Source projection (§6.1 source deck; API §2.1) ---------- */

export type SourceStatus = "idle" | "selecting" | "live" | "error";

/** Which source kind is currently in the portal selection flow (M2/M3). */
export type SelectingKind = "monitor" | "window" | "region" | null;

export interface SourceSlice {
  status: SourceStatus;
  sourceId: string | null;
  label: string | null;
  capabilities: SourceCapabilities | null;
  /** §1 error from the last failed selection (drives the §6.3 slot copy). */
  error: IpcError | null;
  /** M2: which chip is currently in the selecting state. */
  selectingKind: SelectingKind;
  /** M3: region crop rect in source coordinates. */
  regionRect: { x: number; y: number; w: number; h: number } | null;
}

export const INITIAL_SOURCE: SourceSlice = {
  status: "idle",
  sourceId: null,
  label: null,
  capabilities: null,
  error: null,
  selectingKind: null,
  regionRect: null,
};

/* ---------- Session projection (§6.5 flow; API §2.3 + §3) ---------- */

/** "starting"/"stopping" are command-in-flight UI (DESIGN §5.1 loading);
    "recording" ⇄ "idle" is the Rust-truth status carried by tick/finished. */
export type SessionStatus = "idle" | "starting" | "recording" | "stopping";

export interface SessionSlice {
  status: SessionStatus;
  recordingId: string | null;
  encoderBackend: string | null;
  startedAt: string | null;
  /** Elapsed wall time of the take, pushed by `recording/tick` (1 Hz). */
  elapsedMs: number;
  /** 2.3 sub-state from tick.state (API §3): a paused take is still a
      live "recording" session — Stop & save stays enabled (§5.9). */
  paused: boolean;
  /** Human copy of an asynchronous fault (API §3 1.4 note) or the
      authoritative stop-reply failure. Rendered once — §6.5 no-double-telling. */
  fault: IpcError | null;
  /** Latest `recording/stats` payload (0.5 Hz, API §3); null until the
      take's first beat. Resets with the slice — the §6.1 #6 stats line
      renders only while a take is active. */
  stats: RecordingStatsEvt | null;
}

export const INITIAL_SESSION: SessionSlice = {
  status: "idle",
  recordingId: null,
  encoderBackend: null,
  startedAt: null,
  elapsedMs: 0,
  paused: false,
  fault: null,
  stats: null,
};

/* ---------- Audio projection (§6.1 #3 strip; API §2.2 + §3, task 2.2) ---------- */

/** One channel card's truth — mirrored from the §2.6 audio settings
    snapshot (loadAudio) and mutated ONLY through `audio_set_channel`
    (the Rust settings snapshot is what recording_start consumes). */
export interface AudioChannelState {
  enabled: boolean;
  muted: boolean;
  /** null = system default (API §2.2). */
  deviceId: string | null;
  /** 0–100 — post-gain meter law reads through this (§3 meters note). */
  level: number;
}

export type AudioStatus = "idle" | "loading" | "ready" | "error";

/** State half of the audio wiring — the ACTIONS live top-level on the
    store (house convention: slices are projections, actions sit beside
    selectMonitor/onTick). */
export interface AudioSlice {
  status: AudioStatus;
  error: IpcError | null;
  mic: AudioChannelState;
  desktop: AudioChannelState;
  /** Latest `recording/meters` payload (≤30 Hz); null until a take
      emits. Keys are ALWAYS present (API §3): a channel not in the take
      reads rms/peak 0 — the strip renders that as its idle bar. */
  meters: RecordingMetersEvt | null;
  /** §2.2 device lists — loaded once on first popover open (the reply is
      a snapshot; re-open re-checks). */
  devices: AudioListDevicesReply | null;
  devicesLoading: boolean;
}

export const INITIAL_AUDIO: AudioSlice = {
  status: "idle",
  error: null,
  mic: { enabled: false, muted: false, deviceId: null, level: 100 },
  desktop: { enabled: false, muted: false, deviceId: null, level: 100 },
  meters: null,
  devices: null,
  devicesLoading: false,
};

/* ---------- Camera projection (§6.1 #4 slab / §6.6 PiP; API §2.2, 4.1) ---------- */

/** "opening" is command-in-flight UI (DESIGN §5.1 loading); "open" is the
    Rust-truth status — the reply resolves only after the reader decoded
    its first frame (API §2.2), so "open" implies a servable still. */
export type CameraStatus = "idle" | "opening" | "open" | "error";

export interface CameraSlice {
  status: CameraStatus;
  /** The §2.2 stills handle — the PiP's poll and the stills hook key off
      this. Non-null ⇔ the camera is open. */
  cameraId: string | null;
  /** The `v4l2_/dev/videoN` id that produced the handle — the
      device/changed membership check (§3 camera half) keys off it. */
  deviceId: string | null;
  /** Device label as listed by `camera_list_devices`. */
  label: string | null;
  /** Negotiated capture dims from the open reply (§2.2). */
  width: number | null;
  height: number | null;
  /** §1 error from the last failed open — the slab renders its copy
      inline (§5.5); cleared by the next open attempt. */
  error: IpcError | null;
  /** §2.2 device-list snapshot — re-listed per popover open and on the
      device/changed camera half (the reply is a snapshot, never live). */
  devices: CameraDeviceInfo[] | null;
  devicesLoading: boolean;
}

export const INITIAL_CAMERA: CameraSlice = {
  status: "idle",
  cameraId: null,
  deviceId: null,
  label: null,
  width: null,
  height: null,
  error: null,
  devices: null,
  devicesLoading: false,
};

/* ---------- Settings projection (§6.4, API §2.6) ---------- */

/** Projection of `settings.capture` (the Rust settings snapshot is the
    owner; settingsGet/set round-trip it through TOML). */export interface SettingsSlice {
  capture: CaptureSettings | null;
  captureLoading: boolean;
}

export const INITIAL_SETTINGS: SettingsSlice = {
  capture: null,
  captureLoading: false,
};

/* ---------- ui_prefs projection (§6.6 / API §2.6, DATABASE §2.2) ---------- */

/** Persisted PiP prefs — shape/size/position survive restarts. Keys live
    in the `pip.*` namespace (PREF_NAMESPACES on the Rust side). */
export interface PrefsSlice {
  pipPosition: string | null; // "corner:bottom-right,margin:24"
  pipShape: "circle" | "rounded" | null;
  pipSize: number | null;
  prefsLoading: boolean;
}

export const INITIAL_PREFS: PrefsSlice = {
  pipPosition: null,
  pipShape: null,
  pipSize: null,
  prefsLoading: false,
};

/* ---------- Library projection (§6.2 / API §2.4, DATABASE §2.1) ---------- */

export type LibraryStatus = "idle" | "loading" | "ready" | "error";

export interface LibrarySlice {
  status: LibraryStatus;
  error: IpcError | null;
  items: LibraryListItem[];
  total: number;
  limit: number;
  offset: number;
  filter: LibraryListFilter;
  sort: LibraryListSort;
  /** The recording currently opened in the detail drawer. */
  selectedRecording: LibraryGetReply | null;
  /** Whether the drawer is open. */
  drawerOpen: boolean;
}

export const INITIAL_LIBRARY: LibrarySlice = {
  status: "idle",
  error: null,
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  filter: {},
  sort: { field: "created_at", direction: "desc" },
  selectedRecording: null,
  drawerOpen: false,
};

/* ---------- Presets projection (API §2.5, task 3.4 / M11) ---------- */

export type PresetsStatus = "idle" | "loading" | "ready" | "error";

export interface PresetsSlice {
  status: PresetsStatus;
  error: IpcError | null;
  presets: Preset[];
  /** Selected preset id — mirrored from `settings.capture.qualityPreset`. */
  presetId: PresetId | null;
}

export const INITIAL_PRESETS: PresetsSlice = {
  status: "idle",
  error: null,
  presets: [],
  presetId: null,
};

/* ---------- Toasts (§5.6 saved-file feedback; PLAN 1.7) ---------- */

export type ToastKind = "status" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  /** Human copy (§7.9 vocabulary) — errors render the §1 userMessage. */
  title: string;
  /** Take duration in ms — the Saved toast's mono line (§5.6). */
  durationMs?: number;
  /** The saved file's path — Reveal/Copy actions ride it (§5.6). */
  path?: string;
  /** API §1 code — the no-double-telling key (§6.5): a fault is only
      pushed when no open toast carries its code already. */
  code?: string;
}

/* §4.1 ephemeral-UI law (ARCHITECTURE §2): toast state never round-trips
   to Rust. The store only accumulates/dismisses; auto-dismiss TIMERS live
   in ToastHost (§5.6: 5s plain, 6s with action, errors persist). */
const TOAST_LIMIT = 3;
export const INITIAL_TOASTS: Pick<SspState, "toasts" | "nextToastId"> = {
  toasts: [],
  nextToastId: 1,
};

type ToastPush = Pick<SspState, "toasts" | "nextToastId">;

function pushToast(state: ToastPush, toast: Omit<Toast, "id">): ToastPush {
  const toasts = [...state.toasts, { ...toast, id: state.nextToastId }].slice(-TOAST_LIMIT);
  return { toasts, nextToastId: state.nextToastId + 1 };
}

interface SspState {
  view: ViewId;
  setView: (view: ViewId) => void;

  source: SourceSlice;
  session: SessionSlice;
  /** §6.1 #3 audio strip (2.2) — §2.6 settings projection + meters/events. */
  audio: AudioSlice;

  /* §6.1 #4 camera slab (4.1/4.2) — device snapshot + the one open
     handle. PiP position/shape/size are LOCAL UI state (CameraPip) until
     4.4 persists them via ui_prefs. */
  camera: CameraSlice;

  /* §6.4 settings — Capture settings projection (camera_self_insert is
     the 4.3/4.4 self-insert flag). */
  settings: SettingsSlice;

  /* §6.4 settings actions (4.4). */
  loadCaptureSettings: () => Promise<void>;
  setCameraSelfInsert: (value: boolean) => Promise<void>;

  /* §6.6 ui_prefs — PiP position/shape/size persisted via prefs_set. */
  prefs: PrefsSlice;

  /* §6.2 library grid (5.2) — recordings index projected from `library_list`. */
  library: LibrarySlice;

  /* Camera actions (4.2) — camera_open/close; device lists re-list per
     popover open and on device/changed (hooks/useRecordingState). */
  loadCameraDevices: () => Promise<void>;
  openCamera: (deviceId: string) => Promise<void>;
  closeCamera: () => Promise<void>;
  /** `evt://device/changed` reducer (camera half, API §3): re-list, and
      auto-close when the open camera's device vanished (unplug law —
      the 4.1 reader self-exits; the UI leaves with ONE telling). */
  onDeviceChanged: () => Promise<void>;
  /** `evt://library/updated` reducer (5.2): remove deleted items from
      the grid; new items trigger a re-list via loadLibrary. */
  onLibraryUpdated: (evt: LibraryUpdatedEvt) => void;

  /* Library actions (5.2). */
  loadLibrary: () => Promise<void>;
  deleteRecording: (id: number) => Promise<void>;
  setLibraryOffset: (offset: number) => void;
  setLibraryFilter: (filter: Partial<LibraryListFilter>) => void;
  setLibrarySort: (sort: Partial<LibraryListSort>) => void;
  /** Task 5.3: fetch a single recording's details for the drawer. */
  libraryGet: (id: number) => Promise<void>;
  /** Task 5.3: open the drawer with the given recording loaded. */
  openDrawer: (id: number) => Promise<void>;
  /** Task 5.3: close the drawer and clear the selection. */
  closeDrawer: () => void;

  /* ui_prefs actions (4.4). */
  loadPipPrefs: () => Promise<void>;
  setPipPosition: (value: string) => Promise<void>;
  setPipShape: (value: "circle" | "rounded") => Promise<void>;
  setPipSize: (value: number) => Promise<void>;

  /* Audio actions (2.2) — audio_set_channel persists; ON ONE SUBSCRIPTION
     through hooks/useRecordingState (onMeters). */
  loadAudio: () => Promise<void>;
  loadDevices: () => Promise<void>;
  setChannelEnabled: (channel: "mic" | "desktop", enabled: boolean) => Promise<void>;
  setChannelDevice: (channel: "mic" | "desktop", deviceId: string | null) => Promise<void>;
  onMeters: (evt: RecordingMetersEvt) => void;

  /** `cmd://source_select("monitor")` — portal consent (§2.1). */
  selectMonitor: () => Promise<void>;
  /** `cmd://source_select("window")` — portal window picker (M2). */
  selectWindow: () => Promise<void>;
  /** `cmd://source_select("region")` — portal monitor picker + crop rect (M3). */
  selectRegion: () => Promise<void>;
  /** `cmd://source_region_set` — set the region crop rect (M3). */
  setRegionRect: (sourceId: string, rect: { x: number; y: number; w: number; h: number }) => Promise<void>;
  /** `cmd://source_region_clear` — clear the region crop rect (M3). */
  clearRegionRect: (sourceId: string) => Promise<void>;
  /** `cmd://recording_start` with §2.3 neutral fields (1.3 scope). */
  startRecording: () => Promise<void>;
  /** `cmd://recording_stop` for the active take. */
  stopRecording: () => Promise<void>;
  /** `cmd://recording_pause` / `cmd://recording_resume` (2.3) — phase
      transitions under the same §5.6 error-toast law as the other commands. */
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;

  /* Event reducers — subscribe exactly once (hooks/useRecordingState). */
  onStarted: (evt: RecordingStartedEvt) => void;
  onShellError: (evt: ShellErrorEvt) => void;
  showError: (err: IpcError) => void;
  onTick: (evt: RecordingTickEvt) => void;
  onStats: (evt: RecordingStatsEvt) => void;
  onSessionError: (err: IpcError) => void;
  onFinished: (evt: RecordingFinishedEvt) => void;

  /** Capabilities probe (§2.5) — loaded once at boot. */
  capabilities: Capabilities | null;
  loadCapabilities: () => Promise<void>;

  /* Presets (§2.5, M11) — fetched once at boot; selection persists via
     settings capture.qualityPreset (the take resolves the settings
     snapshot at start, ARCHITECTURE §4.1). */
  presets: PresetsSlice;
  loadPresets: () => Promise<void>;
  setPreset: (id: PresetId) => Promise<void>;

  /* Toasts (§5.6) — ToastHost renders; dismissToast is the user's ✕. */
  toasts: Toast[];
  nextToastId: number;
  dismissToast: (id: number) => void;
}

export const useSspStore = create<SspState>((set, get) => ({
  view: "record",
  setView: (view) => set({ view }),

  source: INITIAL_SOURCE,
  session: INITIAL_SESSION,
  audio: INITIAL_AUDIO,
  camera: INITIAL_CAMERA,
  settings: INITIAL_SETTINGS,
  prefs: INITIAL_PREFS,
  library: INITIAL_LIBRARY,
  ...INITIAL_TOASTS,
  capabilities: null,
  presets: INITIAL_PRESETS,

  async loadCapabilities() {
    if (get().capabilities) return;
    try {
      const caps = await systemCapabilities();
      set({ capabilities: caps });
    } catch (err) {
      // Non-fatal: the UI will simply not know about window capture support.
      console.warn("[store] capabilities probe failed:", err);
    }
  },

  async loadPresets() {
    if (get().presets.status === "loading") return;
    set({ presets: { ...INITIAL_PRESETS, status: "loading" } });
    try {
      const { presets } = await presetsList();
      const capture = await settingsGet("capture");
      set({
        presets: {
          status: "ready",
          error: null,
          presets,
          presetId: capture.qualityPreset as PresetId,
        },
      });
    } catch (err) {
      set({ presets: { ...INITIAL_PRESETS, status: "error", error: err as IpcError } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async setPreset(id) {
    const prior = get().presets.presetId;
    if (prior === id || get().session.status === "recording") return;
    set({ presets: { ...get().presets, presetId: id } });
    try {
      await settingsSet({ capture: { qualityPreset: id } });
    } catch (err) {
      set({ presets: { ...get().presets, presetId: prior } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async loadAudio() {
    if (get().audio.status === "loading") return;
    set({ audio: { ...get().audio, status: "loading", error: null } });
    try {
      const settings = await settingsGet("audio");
      set({
        audio: {
          ...get().audio,
          status: "ready",
          mic: {
            enabled: settings.micEnabled,
            muted: settings.micMuted,
            deviceId: settings.micDeviceId,
            level: settings.micLevel,
          },
          desktop: {
            enabled: settings.desktopAudio,
            muted: settings.desktopMuted,
            deviceId: settings.desktopDeviceId,
            level: settings.desktopLevel,
          },
        },
      });
    } catch (err) {
      // §5.5 error state lives in the slice; §5.6 toast carries the copy.
      set({
        audio: { ...get().audio, status: "error", error: err as IpcError },
      });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async loadDevices() {
    if (get().audio.devices || get().audio.devicesLoading) return;
    set({ audio: { ...get().audio, devicesLoading: true } });
    try {
      const devices = await audioListDevices();
      set({ audio: { ...get().audio, devices, devicesLoading: false } });
    } catch (err) {
      // §2.2 flag ⚠: enumeration failure — the popover renders the §1
      // copy inline; the previously loaded state survives untouched.
      set({ audio: { ...get().audio, devicesLoading: false } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async setChannelEnabled(channel, enabled) {
    const current = get().audio[channel];
    if (current.enabled === enabled) return;
    // Optimistic card flip (§5.1 press responsiveness); a rejection
    // rolls the field back and its copy rides the §5.6 toast.
    set({ audio: { ...get().audio, [channel]: { ...current, enabled } } });
    try {
      await audioSetChannel({ channel, enabled });
    } catch (err) {
      set((s) => {
        const audio = { ...s.audio };
        audio[channel] = current;
        return { audio };
      });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async setChannelDevice(channel, deviceId) {
    const current = get().audio[channel];
    if (current.deviceId === deviceId) return;
    set({ audio: { ...get().audio, [channel]: { ...current, deviceId } } });
    try {
      await audioSetChannel({ channel, deviceId });
    } catch (err) {
      set((s) => {
        const audio = { ...s.audio };
        audio[channel] = current;
        return { audio };
      });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  onMeters(evt) {
    // ≤30 Hz pushes land here and nowhere else (hooks/useRecordingState);
    // the strip reads the projection — never its own subscription.
    set({ audio: { ...get().audio, meters: evt } });
  },

  /* ---------- Camera actions (4.2) ---------- */

  async loadCameraDevices() {
    if (get().camera.devicesLoading) return;
    set({ camera: { ...get().camera, devicesLoading: true } });
    try {
      // Always re-list: the reply is a snapshot (API §2.2), and both the
      // popover-open path and the hotplug reducer want fresh data.
      const { devices } = await cameraListDevices();
      set({ camera: { ...get().camera, devices, devicesLoading: false } });
    } catch (err) {
      // §2.2: enumeration failure keeps the previously loaded list; the
      // popover renders the §1 copy inline (§5.5).
      set({ camera: { ...get().camera, devicesLoading: false, error: err as IpcError } });
    }
  },

  async openCamera(deviceId) {
    if (get().camera.status === "opening" || get().camera.status === "open") return;
    set({ camera: { ...get().camera, status: "opening", error: null, deviceId } });
    try {
      // The reply resolves after the reader's first decoded frame (API
      // §2.2) — the PiP's first poll can never race the decoder.
      const reply = await cameraOpen(deviceId);
      const label =
        get().camera.devices?.find((d) => d.id === deviceId)?.label ?? deviceId;
      set({
        camera: {
          ...get().camera,
          status: "open",
          cameraId: reply.cameraId,
          deviceId,
          label,
          width: reply.width,
          height: reply.height,
          error: null,
        },
      });
    } catch (err) {
      set({
        camera: {
          ...INITIAL_CAMERA,
          devices: get().camera.devices,
          status: "error",
          error: err as IpcError,
        },
      });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async closeCamera() {
    const camera = get().camera;
    if (camera.status === "idle") return;
    set({ camera: { ...INITIAL_CAMERA, devices: camera.devices } });
    if (camera.cameraId) {
      try {
        // Idempotent per API §2.2 — an unknown/already-closed id still
        // succeeds, so a raced close needs no rollback.
        await cameraClose(camera.cameraId);
      } catch (err) {
        set((s) =>
          pushToast(s, {
            kind: "error",
            title: (err as IpcError).userMessage,
            code: (err as IpcError).code,
          }),
        );
      }
    }
  },

  async onDeviceChanged() {
    // §3 camera half: re-list, then leave with ONE telling if the open
    // camera's device vanished (the 4.1 reader already self-exited; its
    // stills simply went stale).
    await get().loadCameraDevices();
    const camera = get().camera;
    if (
      camera.status === "open" &&
      camera.deviceId &&
      camera.devices &&
      !camera.devices.some((d) => d.id === camera.deviceId)
    ) {
      await get().closeCamera();
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: "Camera disconnected. Replug it and pick it again from the camera list.",
          code: "capture.camera_unavailable",
        }),
      );
    }
  },

  onLibraryUpdated(evt) {
    if (evt.deleted) {
      // A recording was soft-deleted — remove it from the grid.
      set((s) => ({
        library: {
          ...s.library,
          items: s.library.items.filter((it) => it.id !== evt.id),
          total: Math.max(0, s.library.total - 1),
        },
      }));
    } else {
      // A new recording was added — refresh the grid.
      void get().loadLibrary();
    }
  },

  /* ---------- Settings actions (4.4) ---------- */

  async loadCaptureSettings() {
    if (get().settings.captureLoading) return;
    set({ settings: { ...get().settings, captureLoading: true } });
    try {
      const capture = await settingsGet("capture");
      set({ settings: { ...get().settings, capture, captureLoading: false } });
    } catch (err) {
      set({ settings: { ...get().settings, captureLoading: false, capture: null } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /** 4.4: toggle self-insert on the Capture settings snapshot. Rolls back
      on rejection and toasts the error. */
  async setCameraSelfInsert(value: boolean) {
    const prior = get().settings.capture;
    if (!prior) return;
    set({ settings: { ...get().settings, capture: { ...prior, cameraSelfInsert: value } } });
    try {
      await settingsSet({ capture: { cameraSelfInsert: value } });
    } catch (err) {
      set({ settings: { ...get().settings, capture: prior } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /* ---------- ui_prefs actions (4.4) ---------- */

  async loadPipPrefs() {
    if (get().prefs.prefsLoading) return;
    set({ prefs: { ...get().prefs, prefsLoading: true } });
    try {
      // Load all three pip prefs in parallel; missing keys read as null.
      const [position, shape, size] = await Promise.all([
        prefsGet("pip.position"),
        prefsGet("pip.shape"),
        prefsGet("pip.size"),
      ]);
      set({
        prefs: {
          ...get().prefs,
          pipPosition: typeof position === "string" ? position : null,
          pipShape: typeof shape === "string" ? (shape as "circle" | "rounded") : null,
          pipSize: typeof size === "number" ? size : null,
          prefsLoading: false,
        },
      });
    } catch (err) {
      set({ prefs: { ...get().prefs, prefsLoading: false } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /** Prefs are upsert-only (API §2.6): no history, latest write wins. */
  async setPipPosition(value: string) {
    const prior = get().prefs.pipPosition;
    if (prior === value) return;
    set({ prefs: { ...get().prefs, pipPosition: value } });
    try {
      await prefsSet("pip.position", value);
    } catch (err) {
      set({ prefs: { ...get().prefs, pipPosition: prior } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async setPipShape(value: "circle" | "rounded") {
    const prior = get().prefs.pipShape;
    if (prior === value) return;
    set({ prefs: { ...get().prefs, pipShape: value } });
    try {
      await prefsSet("pip.shape", value);
    } catch (err) {
      set({ prefs: { ...get().prefs, pipShape: prior } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async setPipSize(value: number) {
    const prior = get().prefs.pipSize;
    if (prior === value) return;
    set({ prefs: { ...get().prefs, pipSize: value } });
    try {
      await prefsSet("pip.size", value);
    } catch (err) {
      set({ prefs: { ...get().prefs, pipSize: prior } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /* ---------- Library actions (5.2) ---------- */

  async loadLibrary() {
    if (get().library.status === "loading") return;
    set({ library: { ...get().library, status: "loading", error: null } });
    try {
      const { items, total, page } = await libraryList(
        get().library.limit,
        get().library.offset,
        get().library.filter,
        get().library.sort,
      );
      set({
        library: {
          ...get().library,
          status: "ready",
          items,
          total,
          limit: page.limit,
          offset: page.offset,
        },
      });
    } catch (err) {
      set({ library: { ...get().library, status: "error", error: err as IpcError } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /** Task 5.2: soft-delete a recording. Optimistic removal, rollback on
      rejection with a toast. */
  setLibraryOffset(offset) {
    set({ library: { ...get().library, offset } });
  },
  setLibraryFilter(filter) {
    set({ library: { ...get().library, filter, offset: 0 } });
  },
  setLibrarySort(sort) {
    set({
      library: {
        ...get().library,
        sort: {
          field: sort.field ?? "created_at",
          direction: sort.direction ?? "desc",
        },
        offset: 0,
      },
    });
  },

  async deleteRecording(id: number) {
    const priorItems = get().library.items;
    set({
      library: {
        ...get().library,
        items: priorItems.filter((it) => it.id !== id),
      },
    });
    try {
      await libraryDelete(id);
      // Refresh to reflect server-side state.
      void get().loadLibrary();
    } catch (err) {
      set({ library: { ...get().library, items: priorItems } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /** Task 5.3: fetch a single recording's details for the drawer. */
  async libraryGet(id: number) {
    set({ library: { ...get().library, status: "loading", error: null } });
    try {
      const reply = await libraryGet(id);
      set({
        library: {
          ...get().library,
          status: "ready",
          selectedRecording: reply,
        },
      });
    } catch (err) {
      set({ library: { ...get().library, status: "error", error: err as IpcError } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  /** Task 5.3: open the drawer with the given recording loaded. */
  async openDrawer(id: number) {
    await get().libraryGet(id);
    set({ library: { ...get().library, drawerOpen: true } });
  },

  /** Task 5.3: close the drawer and clear the selection. */
  closeDrawer() {
    set({ library: { ...get().library, drawerOpen: false, selectedRecording: null } });
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async selectMonitor() {
    if (get().source.status === "selecting") return;
    set({ source: { ...INITIAL_SOURCE, status: "selecting", selectingKind: "monitor", regionRect: null } });
    try {
      const src = await sourceSelect("monitor");
      set({
        source: {
          status: "live",
          sourceId: src.sourceId,
          label: src.label,
          capabilities: src.capabilities,
          error: null,
          selectingKind: null,
          regionRect: null,
        },
      });
    } catch (err) {
      set({ source: { ...INITIAL_SOURCE, status: "error", error: err as IpcError, selectingKind: null, regionRect: null } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async selectWindow() {
    if (get().source.status === "selecting") return;
    set({ source: { ...INITIAL_SOURCE, status: "selecting", selectingKind: "window", regionRect: null } });
    try {
      const src = await sourceSelect("window");
      set({
        source: {
          status: "live",
          sourceId: src.sourceId,
          label: src.label,
          capabilities: src.capabilities,
          error: null,
          selectingKind: null,
          regionRect: null,
        },
      });
    } catch (err) {
      set({ source: { ...INITIAL_SOURCE, status: "error", error: err as IpcError, selectingKind: null, regionRect: null } });
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async selectRegion() {
    if (get().source.status === "selecting") return;
    set({ source: { ...INITIAL_SOURCE, status: "selecting", selectingKind: "region", regionRect: null } });
    try {
      const src = await sourceSelect("region");
      set({
        source: {
          status: "live",
          sourceId: src.sourceId,
          label: src.label,
          capabilities: src.capabilities,
          error: null,
          selectingKind: null,
          regionRect: null,
        },
      });
      } catch (err) {
        set({ source: { ...INITIAL_SOURCE, status: "error", error: err as IpcError, selectingKind: null } });
        set((s) =>
          pushToast(s, {
            kind: "error",
            title: (err as IpcError).userMessage,
            code: (err as IpcError).code,
          }),
        );
      }
    },

    async setRegionRect(sourceId, rect) {
      try {
        await sourceRegionSet(sourceId, rect);
        // Update local state with the new rect
        set((state) => {
          if (state.source.sourceId === sourceId) {
            return {
              source: {
                ...state.source,
                regionRect: rect,
              },
            };
          }
          return state;
        });
      } catch (err) {
        set((s) =>
          pushToast(s, {
            kind: "error",
            title: (err as IpcError).userMessage,
            code: (err as IpcError).code,
          }),
        );
      }
    },

    async clearRegionRect(sourceId) {
      try {
        await sourceRegionClear(sourceId);
        set((state) => {
          if (state.source.sourceId === sourceId) {
            return {
              source: {
                ...state.source,
                regionRect: null,
              },
            };
          }
          return state;
        });
      } catch (err) {
        set((s) =>
          pushToast(s, {
            kind: "error",
            title: (err as IpcError).userMessage,
            code: (err as IpcError).code,
          }),
        );
      }
    },

    async startRecording() {
    const { source } = get();
    // Guard matches the ActionRow's disabled logic — the button gates the
    // click, the store gates everything else (keyboard, rapid re-click).
    if (source.status !== "live" || !source.sourceId) return;
    if (get().session.status !== "idle") return;
    set({ session: { ...INITIAL_SESSION, status: "starting" } });
    try {
      // 2.2: the §2.3 audio array carries the strip's ENABLED channels.
      // The Rust take consumes the settings snapshot (audio_set_channel
      // already persisted it) — the array stays the contract-complete
      // wire shape, never a second source of truth.
      const { audio } = get();
      const channels: AudioChannelSpec[] = [];
      if (audio.mic.enabled) {
        channels.push({ channel: "mic", deviceId: audio.mic.deviceId });
      }
      if (audio.desktop.enabled) {
        channels.push({ channel: "desktop", deviceId: audio.desktop.deviceId });
      }
      const reply = await recordingStart({
        sourceId: source.sourceId,
        // 1.3/1.5 scope: video-only monitor take — neutral values at their
        // API §2.3 shapes until M3/M5 light their fields up.
        regionRect: null,
        audio: channels,
        cameraId: null,
        // M11: the take resolves the SETTINGS SNAPSHOT's qualityPreset
        // at start (config-snapshot law); the id rides the body at its
        // contract shape so the wire stays complete.
        presetId: get().presets.presetId,
        outputDir: null,
      });
      // A start event may already have advanced (or ended) the take.
      // Only the still-pending command may initialize from its reply.
      if (get().session.status === "starting") {
        get().onStarted({ ...reply, encoder: reply.encoder.backend });
      }
    } catch (err) {
      // Command failure rides the reply (API §3 note) — back to idle, the
      // error toast carries the copy (the inline fault line is gone with
      // ToastHost, 1.7).
      if (get().session.status === "starting") {
        set({ session: { ...INITIAL_SESSION, fault: err as IpcError } });
      }
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async stopRecording() {
    const { session } = get();
    if (session.status !== "recording" || !session.recordingId) return;
    set({ session: { ...session, status: "stopping" } });
    try {
      // Reply is the authoritative outcome (finished event lands too, and
      // onFinished is idempotent on an already-idle session).
      await recordingStop(session.recordingId);
      if (get().session.recordingId === session.recordingId) {
        set({ session: { ...INITIAL_SESSION } });
      }
    } catch (err) {
      const fault = err as IpcError;
      const prior = get().session.fault;
      // §6.5 no-double-telling: the async fault already surfaced at fault
      // time; the stop reply carries the same error — keep one copy.
      const keep = prior && prior.code === fault.code ? prior : fault;
      if (get().session.recordingId === session.recordingId) {
        set({ session: { ...INITIAL_SESSION, fault: keep } });
      }
      // Same law at toast level: the existing error toast (same code) IS
      // the copy the user is reading — a stop reply that repeats it must
      // not stack a second one.
      const told = get().toasts.some((t) => t.kind === "error" && t.code === fault.code);
      if (!told) {
        set((s) =>
          pushToast(s, {
            kind: "error",
            title: fault.userMessage,
            code: fault.code,
          }),
        );
      }
    }
  },

  async pauseRecording() {
    const { session } = get();
    // Guarded no-op outside a live, unpaused take — the Rust side owns the
    // authoritative §2.3 bad_state matrix; the UI never double-asks.
    if (session.status !== "recording" || !session.recordingId || session.paused) return;
    try {
      await recordingPause(session.recordingId);
      // The tick phase confirms at the next 1 Hz beat; the reply flips the
      // chip immediately (no frozen-timer flash of the wrong phase).
      if (get().session.recordingId === session.recordingId) {
        set({ session: { ...get().session, paused: true } });
      }
    } catch (err) {
      // The take is untouched by a refused pause (bad_state class) — toast
      // the §7.9 copy, session stays as-is.
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  async resumeRecording() {
    const { session } = get();
    if (session.status !== "recording" || !session.recordingId || !session.paused) return;
    try {
      await recordingResume(session.recordingId);
      if (get().session.recordingId === session.recordingId) {
        set({ session: { ...get().session, paused: false } });
      }
    } catch (err) {
      set((s) =>
        pushToast(s, {
          kind: "error",
          title: (err as IpcError).userMessage,
          code: (err as IpcError).code,
        }),
      );
    }
  },

  onStarted(evt) {
    if (get().session.recordingId === evt.recordingId) return;
    set({
      session: {
        ...INITIAL_SESSION,
        status: "recording",
        recordingId: evt.recordingId,
        encoderBackend: evt.encoder,
        startedAt: evt.startedAt,
      },
    });
  },

  showError(err) {
    if (get().toasts.some((t) => t.kind === "error" && t.code === err.code)) return;
    set((s) => pushToast(s, { kind: "error", title: err.userMessage, code: err.code }));
  },

  onShellError(evt) {
    if (!evt.recordingActive) set({ session: { ...INITIAL_SESSION } });
    get().showError(evt.error);
  },

  onTick(evt) {
    const { session } = get();
    if (session.recordingId !== evt.recordingId) return;
    // 2.3: the phase rides every tick (API §3 `state`) — the projection
    // NEVER invents the paused sub-state from elapsed time.
    set({
      session: {
        ...session,
        elapsedMs: evt.elapsedMs,
        paused: evt.state === "paused",
      },
    });
  },

  onStats(evt) {
    const { session } = get();
    // Stats only mean something inside a live take — a late beat after
    // teardown must not resurrect the §6.1 #6 line on the idle row.
    if (session.status !== "recording") return;
    set({ session: { ...session, stats: evt } });
  },

  onSessionError(err) {
    const { session } = get();
    if (session.status !== "recording") return;
    // Fault at take time: the worker has ended, but the take only resolves
    // with the authoritative stop reply — keep status, show the copy now.
    set({ session: { ...session, fault: err } });
    // §5.6 errors persist until dismissed; the stop reply's repeat is
    // deduped by code (§6.5).
    set((s) =>
      pushToast(s, {
        kind: "error",
        title: err.userMessage,
        code: err.code,
      }),
    );
  },

  onFinished(evt) {
    // Trailer written; the session is over regardless of which trigger won
    // the race (stop reply resolves alongside this event).
    if (!get().session.recordingId || get().session.recordingId === evt.recordingId) {
      set({ session: { ...INITIAL_SESSION } });
    }
    // §6.2 step 3: ONE saved toast — duration + path for Reveal/Copy
    // (rendered by ToastHost with the §5.6 6s auto-dismiss).
    set((s) =>
      pushToast(s, {
        kind: "status",
        title: "Recording saved",
        durationMs: evt.recording.durationMs,
        path: evt.recording.path,
      }),
    );
  },
}));
