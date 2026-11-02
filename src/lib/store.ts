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
  const toasts = [
    ...state.toasts,
    { ...toast, id: state.nextToastId },
  ].slice(-TOAST_LIMIT);
  return { toasts, nextToastId: state.nextToastId + 1 };
}

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
  ...INITIAL_TOASTS,

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

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
      // §5.6: with ToastHost live (1.7), faults surface at floatover level.
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
      // error toast carries the copy (the inline fault line is gone with
      // ToastHost, 1.7).
      set({ session: { ...INITIAL_SESSION, fault: err as IpcError } });
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
      set({ session: { ...INITIAL_SESSION } });
    } catch (err) {
      const fault = err as IpcError;
      const prior = get().session.fault;
      // §6.5 no-double-telling: the async fault already surfaced at fault
      // time; the stop reply carries the same error — keep one copy.
      const keep = prior && prior.code === fault.code ? prior : fault;
      set({ session: { ...INITIAL_SESSION, fault: keep } });
      // Same law at toast level: the existing error toast (same code) IS
      // the copy the user is reading — a stop reply that repeats it must
      // not stack a second one.
      const told = get().toasts.some(
        (t) => t.kind === "error" && t.code === fault.code,
      );
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
    set({ session: { ...INITIAL_SESSION } });
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
