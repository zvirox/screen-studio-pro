import { Dot, LoaderCircle, Square, Zap, Cpu } from "lucide-react";
import { useSspStore } from "../../lib/store";
import { formatElapsed, formatStats } from "../../lib/format";

/* DESIGN.md v3.1 §5.1/§6.1/§7.4 — recording controls wrap as one responsive
   row; long encoder labels never force sibling controls to overlap.
   §6.5 flow: Record → loading ("Working…") → while the take runs the row
   shows the elapsed mono timer + Stop & save (the §5.9 HUD window itself
   lands in PLAN 2.4) → idle again. Fault copy surfaces once, at floatover
   level, through the store's error toasts (§5.6, ToastHost since 1.7) —
   the row renders no second telling of it. */

/* Encoder chip — shows the active backend (NVENC/VAAPI/x264) with fallback notice.
   DESIGN §6.1: x264 shows a neutral inline notice with zap-off icon:
   "Falling back to CPU encode". */
function EncoderChip({ backend, isFallback }: { backend: string; isFallback: boolean }) {
  const label = backend.toUpperCase();
  const icon =
    backend === "nvenc" ? (
      <Cpu size={12} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
    ) : backend === "vaapi" ? (
      <Cpu size={12} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
    ) : (
      <Cpu size={12} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
    );
  const fallbackNotice = isFallback ? (
    <span className="flex min-w-0 items-start gap-1 text-label text-ink-secondary">
      <Zap size={10} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">Falling back to CPU encode</span>
    </span>
  ) : null;

  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 rounded-sm border border-subtle bg-solid px-2 py-1 text-body-sm font-mono text-ink">
      {icon}
      <span className="min-w-0 break-words">{label}</span>
      {fallbackNotice}
    </div>
  );
}

export default function ActionRow() {
  const source = useSspStore((s) => s.source);
  const session = useSspStore((s) => s.session);
  const startRecording = useSspStore((s) => s.startRecording);
  const stopRecording = useSspStore((s) => s.stopRecording);

  const busy = session.status === "starting" || session.status === "stopping";
  const recording = session.status === "recording";
  const idle = session.status === "idle";
  // A fault still tints the retry state (primary action after failure);
  // its copy renders once, in the error toast (§6.5 no-double-telling).
  const fault = session.fault;

  const label = busy ? (
    <span role="status" aria-live="polite" className="flex items-center justify-center gap-2">
      <LoaderCircle size={14} strokeWidth={1.5} className="animate-spin-slow" aria-hidden="true" />
      Working…
    </span>
  ) : recording ? (
    <span className="flex items-center justify-center gap-2">
      <Square size={16} strokeWidth={1.5} className="fill-current" aria-hidden="true" />
      Stop &amp; save
    </span>
  ) : (
    <span className="flex items-center justify-center gap-2">
      <Dot size={20} strokeWidth={1.5} className="fill-current" aria-hidden="true" />
      Record
    </span>
  );

  return (
    <section aria-label="Recording controls" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        {recording ? (
          <>
            <div
              role="timer"
              className="rounded-sm border border-subtle bg-solid px-2.5 py-1.5 font-mono text-mono-md tabular-nums text-ink"
            >
              {formatElapsed(session.elapsedMs)}
            </div>
            {/* §5.9 paused law: the timer freezes and the "Paused" chip
                chip sits beside it — text + placement carry the phase
                (§7.8: never color-only). No pause/resume buttons here —
                §5.9 reserves them for the 2.4 HUD window. */}
            {session.paused ? (
              <div
                role="status"
                className="rounded-xs bg-signal-muted px-2 py-1.5 text-label font-medium text-red-text"
              >
                Paused
              </div>
            ) : null}
            {/* Encoder chip — right side during recording */}
            <EncoderChip
              backend={session.encoderBackend || "x264"}
              isFallback={session.encoderBackend === "x264" && !!session.startedAt}
            />
          </>
        ) : (
          /* Encoder chip — idle state shows configured encoder */
          <EncoderChip backend={session.encoderBackend || "auto"} isFallback={false} />
        )}
        <button
          type="button"
          // §5.1: the Record button is always primary, always 48px; fixed
          // width across states so the loading swap never shifts layout.
          // Disabled while a command is in flight, or when nothing live
          // can be recorded — during a take the button is Stop.
          disabled={busy || (!recording && source.status !== "live")}
          onClick={() => (recording ? void stopRecording() : void startRecording())}
          className={
            idle && fault
              ? // retry after a failure is still the primary action
                "h-12 min-w-0 max-w-full flex-1 basis-full min-[640px]:basis-40 rounded-sm border border-primary-border bg-primary text-body-sm font-medium text-primary-fg hover:bg-primary-hover transition-colors duration-fast motion-reduce:scale-none enabled:active:scale-[0.98] active:bg-primary-hover disabled:border disabled:border-subtle disabled:bg-subtle disabled:text-ink-disabled"
              : busy
                ? "h-12 min-w-0 max-w-full flex-1 basis-full min-[640px]:basis-40 rounded-sm border border-primary-border bg-primary text-body-sm font-medium text-primary-fg disabled:border disabled:border-subtle disabled:bg-subtle disabled:text-ink-disabled"
                : recording
                  ? "h-12 min-w-0 max-w-full flex-1 basis-full min-[640px]:basis-40 rounded-sm border border-primary-border bg-primary text-body-sm font-medium text-primary-fg hover:bg-primary-hover transition-colors duration-fast motion-reduce:scale-none enabled:active:scale-[0.98] active:bg-primary-hover"
                  : "h-12 min-w-0 max-w-full flex-1 basis-full min-[640px]:basis-40 rounded-sm border border-subtle bg-subtle text-body-sm font-medium text-ink-disabled"
          }
        >
          {label}
        </button>
      </div>
      {/* §6.1 #6 (3.5): stats line under the action row, recording-state
          only — state-driven visibility, never hidden content. */}
      {recording && session.stats ? (
        <p className="font-mono text-mono-sm tabular-nums text-ink">{formatStats(session.stats)}</p>
      ) : null}
    </section>
  );
}
