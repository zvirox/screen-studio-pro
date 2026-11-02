/* Contract mirror of API.md v1.0.0 — the webview half of ARCHITECTURE §2's
   `types/ipc.ts` ↔ `src-tauri/ipc/` pairing (TESTING §1 P1: #1 breakage risk).
   JSON-projection law (API §5.2): Rust truth is a superset — consumers must
   tolerate unknown/additional fields; this file pins the webview's subset.
   No `any` in this file (ARCHITECTURE §5.2): the contract is typed both ways.

   `ipcContract` pins the whole contract (API §5.1); the Rust twin is
   `ipc/commands.rs::IPC_CONTRACT_VERSION`. Bump both, and API.md, together. */
export const IPC_CONTRACT_VERSION = "1.0.0";

/* ---------- §1 Standard Error Format ---------- */

export type ErrorKind =
  | "portal"
  | "encoder"
  | "pipewire"
  | "capture"
  | "disk"
  | "settings"
  | "ipc";

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
    (`audioJson`, `chapterJson`) travel as strings and decode at use sites. */
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
