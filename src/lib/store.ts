import { create } from "zustand";
import {
  recordingStart,
  recordingStop,
  sourceSelect,
} from "./ipc";
import type {
  IpcError,
  RecordingFinishedEvt,
  RecordingTickEvt,
  SourceCapabilities,
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

export interface SourceSlice {
  status: SourceStatus;
  sourceId: string | null;
  label: string | null;
  capabilities: SourceCapabilities | null;
  /** §1 error from the last failed selection (drives the §6.3 slot copy). */
  error: IpcError | null;
}

export const INITIAL_SOURCE: SourceSlice = {
  status: "idle",
  sourceId: null,
  label: null,
  capabilities: null,
  error: null,
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
  /** Human copy of an asynchronous fault (API §3 1.4 note) or the
      authoritative stop-reply failure. Rendered once — §6.5 no-double-telling. */
  fault: IpcError | null;
}

export const INITIAL_SESSION: SessionSlice = {
  status: "idle",
  recordingId: null,
  encoderBackend: null,
  startedAt: null,
  elapsedMs: 0,
  fault: null,
};

interface SspState {
  view: ViewId;
  setView: (view: ViewId) => void;

  source: SourceSlice;
  session: SessionSlice;

  /** `cmd://source_select("monitor")` — portal consent (§2.1). */
  selectMonitor: () => Promise<void>;
  /** `cmd://recording_start` with §2.3 neutral fields (1.3 scope). */
  startRecording: () => Promise<void>;
  /** `cmd://recording_stop` for the active take. */
  stopRecording: () => Promise<void>;

  /* Event reducers — subscribe exactly once (hooks/useRecordingState). */
  onTick: (evt: RecordingTickEvt) => void;
  onSessionError: (err: IpcError) => void;
  onFinished: (evt: RecordingFinishedEvt) => void;
}

export const useSspStore = create<SspState>((set, get) => ({
  view: "record",
  setView: (view) => set({ view }),

  source: INITIAL_SOURCE,
  session: INITIAL_SESSION,

  async selectMonitor() {
    if (get().source.status === "selecting") return;
    set({ source: { ...INITIAL_SOURCE, status: "selecting" } });
    try {
      const src = await sourceSelect("monitor");
      set({
        source: {
          status: "live",
          sourceId: src.sourceId,
          label: src.label,
          capabilities: src.capabilities,
          error: null,
        },
      });
    } catch (err) {
      // errors.ts already normalized the throw into the §1 shape (lib/ipc).
      set({ source: { ...INITIAL_SOURCE, status: "error", error: err as IpcError } });
    }
  },

  async startRecording() {
    const { source } = get();
    // Guard matches the ActionRow's disabled logic — the button gates the
    // click, the store gates everything else (keyboard, rapid re-click).
    if (source.status !== "live" || !source.sourceId) return;
    set({ session: { ...INITIAL_SESSION, status: "starting" } });
    try {
      const reply = await recordingStart({
        sourceId: source.sourceId,
        // 1.3/1.5 scope: video-only monitor take — neutral values at their
        // API §2.3 shapes until M3/M4/M5 light their fields up.
        regionRect: null,
        audio: [],
        cameraId: null,
        presetId: null,
        outputDir: null,
      });
      set({
        session: {
          status: "recording",
          recordingId: reply.recordingId,
          encoderBackend: reply.encoder.backend,
          startedAt: reply.startedAt,
          elapsedMs: 0,
          fault: null,
        },
      });
    } catch (err) {
      // Command failure rides the reply (API §3 note) — back to idle, the
      // ActionRow surfaces the copy inline.
      set({ session: { ...INITIAL_SESSION, fault: err as IpcError } });
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
      set({ session: { ...INITIAL_SESSION } });
    } catch (err) {
      const fault = err as IpcError;
      const prior = get().session.fault;
      // §6.5 no-double-telling: the async fault already surfaced at fault
      // time; the stop reply carries the same error — keep one copy.
      const keep = prior && prior.code === fault.code ? prior : fault;
      set({ session: { ...INITIAL_SESSION, fault: keep } });
    }
  },

  onTick(evt) {
    const { session } = get();
    if (session.recordingId !== evt.recordingId) return;
    set({ session: { ...session, elapsedMs: evt.elapsedMs } });
  },

  onSessionError(err) {
    const { session } = get();
    if (session.status !== "recording") return;
    // Fault at take time: the worker has ended, but the take only resolves
    // with the authoritative stop reply — keep status, show the copy now.
    set({ session: { ...session, fault: err } });
  },

  onFinished() {
    // Trailer written; the session is over regardless of which trigger won
    // the race (stop reply resolves alongside this event).
    set({ session: { ...INITIAL_SESSION } });
  },
}));
