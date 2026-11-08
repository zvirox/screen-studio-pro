/* Contract mirror of API.md v1.2.0 — the webview half of ARCHITECTURE §2's
   `types/ipc.ts` ↔ `src-tauri/ipc/` pairing (TESTING §1 P1: #1 breakage risk).
   JSON-projection law (API §5.2): Rust truth is a superset — consumers must
   tolerate unknown/additional fields; this file pins the webview's subset.
   No `any` in this file (ARCHITECTURE §5.2): the contract is typed both ways.

   `ipcContract` pins the whole contract (API §5.1); the Rust twin is
   `ipc/commands.rs::IPC_CONTRACT_VERSION`. Bump both, and API.md, together. */
export const IPC_CONTRACT_VERSION = "1.3.0";

/* ---------- §1 Standard Error Format ---------- */

export type ErrorKind = "portal" | "encoder" | "pipewire" | "capture" | "disk" | "settings" | "ipc";

/** Serialized shape of every command failure and `*`/error event payload. */
export interface IpcError {
  kind: ErrorKind;
  code: string;
  retryable: boolean;
  /** Human copy only (DESIGN §7.9) — raw backend errors stay in the log. */
  userMessage: string;
  details: Record<string, unknown> | null;
}

/* ---------- §2.5 system_capabilities / ipc_hello ---------- */

/** API §4.1 — native actions report to the main window. */
export interface ShellErrorEvt {
  error: IpcError;
  recordingActive: boolean;
}

export type EncoderBackend = "vaapi" | "nvenc" | "x264";

export interface EncoderCapability {
  backend: EncoderBackend;
  isHardware: boolean;
  available: boolean;
}

export interface PortalStatus {
  screencast: boolean;
  /** Literal set narrows via a contract MINOR bump when M12 probes it. */
  globalShortcuts: string;
  compositor: string;
  /** M2: whether the compositor's portal offers window capture (SourceType::Window). */
  windowCapture: boolean;
}

export interface VersionInfo {
  app: string;
  ipcContract: string;
}

export interface Capabilities {
  encoders: EncoderCapability[];
  portal: PortalStatus;
  version: VersionInfo;
}

export interface Hello {
  ipcContract: string;
}

/* ---------- §2.6 Settings (TOML sections; PRD §7.5 groups) ---------- */

export type SettingsSection = "capture" | "audio" | "files" | "shortcuts";

export interface CaptureSettings {
  /** M10: 30 or 60 only. */
  frameRate: number;
  /** "auto" | "vaapi" | "nvenc" | "x264". */
  encoder: string;
  /** M11 preset id (API §2.5). */
  qualityPreset: string;
}

export interface AudioSettings {
  /** null = system default source (M4 lists devices). */
  micDeviceId: string | null;
  desktopAudio: boolean;
  echoCancel: boolean;
  /* 2.1: per-channel enable/mute/level (API §2.2 audio_set_channel).
     Rust mirror — src-tauri/src/settings/mod.rs `Audio` (camelCase). */
  micEnabled: boolean;
  micMuted: boolean;
  /** 0–100 (API §2.2). */
  micLevel: number;
  /** null = the system default sink. */
  desktopDeviceId: string | null;
  desktopMuted: boolean;
  desktopLevel: number;
}

export interface FilesSettings {
  dir: string;
  /** strftime-style, expanded by the muxer (task 1.3). */
  namingPattern: string;
  /** "mkv" | "mp4" | "webm" (DATABASE §2.1 CHECK). */
  container: string;
}

export interface ShortcutsSettings {
  quickRecord: string;
  pause: string;
  stop: string;
}

export interface Settings {
  capture: CaptureSettings;
  audio: AudioSettings;
  files: FilesSettings;
  shortcuts: ShortcutsSettings;
}

/** Partial-merge payload for settings_set — any subset of sections. */
export type SettingsPatch = {
  [S in SettingsSection]?: Partial<Settings[S]>;
};

/* ---------- §2.6 Preferences (ui_prefs; DATABASE §2.2 namespaces) ---------- */

/** Wire value of a pref — the decoded JSON value (string|number|boolean). */
export type PrefValue = string | number | boolean;

export interface PrefEntry {
  key: string;
  value: PrefValue;
}

export interface PrefsGetReply {
  key: string;
  value: PrefValue | null;
}

export interface PrefsAllReply {
  prefs: PrefEntry[];
}

/* ---------- §2.2 Audio devices (task 2.1) ---------- */

/** One enumerated audio device row (API §2.2). `isDefault` mirrors the
    system default at listing time; sink rows have no default flag
    (deviation recorded in the PLAN ledger). */
export interface AudioDevice {
  id: string;
  label: string;
  isDefault: boolean;
}

/** `cmd://audio_list_devices` reply — a snapshot; re-list after
    plugging/unplugging (API §2.2 flag ⚠). */
export interface AudioListDevicesReply {
  mics: AudioDevice[];
  desktop: AudioDevice[];
}

/** `cmd://audio_set_channel` body (API §2.2): every field past `channel`
    is optional; `deviceId: null` clears back to the system default. */
export interface AudioSetChannelInput {
  channel: "mic" | "desktop";
  enabled?: boolean;
  muted?: boolean;
  deviceId?: string | null;
  /** 0–100 (API §2.2). */
  level?: number;
}

/* ---------- §2.3 Recording session ---------- */

/** Wire element of the `audio` array (API §2.3). */
export interface AudioChannelSpec {
  channel: "mic" | "desktop";
  deviceId: string | null;
}

/** Full §2.3 body shape — fields the 1.3 core does not honor yet are
    sent as their neutral values so the wire shape is contract-complete. */
export interface RecordingStartInput {
  sourceId: string;
  /** Region crop rect (M3); null = uncropped monitor capture. */
  regionRect: { x: number; y: number; w: number; h: number } | null;
  audio: AudioChannelSpec[];
  cameraId: string | null;
  presetId: string | null;
  outputDir: string | null;
}

/** §2.3 `recording_start` 200 reply. */
export interface RecordingStartReply {
  recordingId: string;
  status: "recording";
  encoder: {
    backend: EncoderBackend;
    isHardware: boolean;
  };
  startedAt: string;
}

/** The `recording` object of the §2.3 `recording_stop` reply. Task 1.3
    scope: `id` (library row) and `thumbPath` join when the DB upsert
    (PLAN 1.6) lands — consumer must tolerate their absence (§5.2). */
export interface RecordingStopInfo {
  id?: number;
  path: string;
  container: "mkv" | "mp4" | "webm";
  durationMs: number;
  sizeBytes: number;
  thumbPath?: string;
  status: "ready";
}

/** §2.3 `recording_stop` 200 reply. */
export interface RecordingStopReply {
  recording: RecordingStopInfo;
}

/** §2.3 `recording_pause`/`recording_resume` 200 reply — the new phase. */
export interface RecordingPhaseReply {
  status: RecordingPhase;
}

/* ---------- §3 Events (payload shapes only — lib/events.ts subscribes) ---------- */

export type RecordingPhase = "recording" | "paused";

export interface RecordingStartedEvt {
  recordingId: string;
  encoder: string;
  startedAt: string;
}

export interface RecordingTickEvt {
  recordingId: string;
  elapsedMs: number;
  state: RecordingPhase;
}

export interface MeterChannel {
  rms: number;
  peak: number;
}

export interface RecordingMetersEvt {
  mic: MeterChannel;
  desktop: MeterChannel;
}

export interface RecordingStatsEvt {
  fps: number;
  droppedFrames: number;
  bitrateKbps: number;
  encodeTimeMs: number;
}

export interface Chapter {
  offsetMs: number;
  label: string;
}

export interface RecordingFlaggedEvt {
  recordingId: string;
  chapter: Chapter;
}

/** `recording/error` — the payload IS the §1 standard error shape. */
export type RecordingErrorEvt = IpcError;

/** DATABASE §2.1 `recordings` projection; the JSON value columns
    (`audioJson`, `chapterJson`) travel as strings and decode at use sites.
    Since task 1.6 the stop path upserts the index row first — `id` is the
    real row id, and `library/updated` rides after the upsert commits. */
export interface LibraryRecording {
  id: number;
  path: string;
  fileName: string;
  kind: string;
  container: string;
  status: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  sizeBytes: number;
  encoder: string;
  isHwEncoder: boolean;
  audioJson: string | null;
  chapterJson: string | null;
  thumbPath: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `recording/finished` — once per session, after the trailer was written. */
export interface RecordingFinishedEvt {
  recordingId: string;
  recording: LibraryRecording;
}

export interface LibraryUpdatedEvt {
  id: number;
  deleted: boolean;
}

export interface SourceLostEvt {
  sourceId: string;
  reason: string;
}

export interface DeviceChangedEvt {
  audio: boolean;
  camera: boolean;
}

/* ---------- §2.1 Sources ---------- */

export type SourceKind = "monitor" | "window" | "region";

export interface SourceCapabilities {
  fps: number;
  width: number;
  height: number;
  cursor: boolean;
  /** Region overlay is pipeline cropping (M3) — offered atop a session. */
  region: boolean;
}

export interface SourcePreview {
  /** §2.1/§6: previews are stills only, never a frame channel. */
  mode: string;
  fps: number;
}

export interface SourceSelected {
  sourceId: string;
  kind: SourceKind;
  label: string;
  capabilities: SourceCapabilities;
  preview: SourcePreview;
}
