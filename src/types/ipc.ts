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
