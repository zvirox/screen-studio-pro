import { AlertCircle, Dot, LoaderCircle, Square } from "lucide-react";
import { useSspStore } from "../../lib/store";

/* §5.1/§6.1 #5 action row — 1.5 slice: the 48px primary Record button only
   (the preset select and encoder chip join with their features in 3.x).
   §6.5 flow: Record → loading ("Working…") → while the take runs the row
   shows the elapsed mono timer + Stop & save (the §5.9 HUD window itself
   lands in PLAN 2.4) → idle again. Faults render their §1 human copy once,
   inline, per the §5.2 error pattern — never raw backend strings. */

/** m:ss below an hour, h:mm:ss above — tabular figures on the mono face. */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function ActionRow() {
  const source = useSspStore((s) => s.source);
  const session = useSspStore((s) => s.session);
  const startRecording = useSspStore((s) => s.startRecording);
  const stopRecording = useSspStore((s) => s.stopRecording);

  const busy = session.status === "starting" || session.status === "stopping";
  const recording = session.status === "recording";
  const idle = session.status === "idle";
  // Any failure of the take (start rejection, async fault, stop reply)
  // surfaces through the one fault channel the store keeps — and stays
  // visible while the stop reply reconciles (§6.5 no-double-telling).
  const fault = session.fault;
  const faultVisible = fault !== null;

  const label = busy ? (
    <span role="status" aria-live="polite" className="flex items-center justify-center gap-2">
      <LoaderCircle
        size={14}
        strokeWidth={2}
        className="animate-spin [animation-duration:0.8s]"
        aria-hidden="true"
      />
      Working…
    </span>
  ) : recording ? (
    <span className="flex items-center justify-center gap-2">
      <Square size={16} strokeWidth={2} className="fill-current" aria-hidden="true" />
      Stop &amp; save
    </span>
  ) : (
    <span className="flex items-center justify-center gap-2">
      <Dot size={20} strokeWidth={2} className="fill-current" aria-hidden="true" />
      Record
    </span>
  );

  return (
    <section aria-label="Recording controls" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {recording ? (
          <div
            role="timer"
            className="rounded-sm border border-subtle bg-solid px-2.5 py-1.5 font-mono text-mono-md tabular-nums text-ink"
          >
            {formatElapsed(session.elapsedMs)}
          </div>
        ) : null}
        <button
          type="button"
          // §5.1: the Record button is always primary, always 48px; fixed
          // width across states so the loading swap never shifts layout.
          // Disabled while a command is in flight, or when nothing live
          // can be recorded — during a take the button is Stop.
          disabled={busy || (!recording && source.status !== "live")}
          onClick={() =>
            recording
              ? void stopRecording()
              : void startRecording()
          }
          className={
            idle && fault
              ? // retry after a failure is still the primary action
                "h-12 flex-1 rounded-sm bg-accent text-body-sm font-medium text-accent-text hover:bg-accent-hover active:scale-[0.985] active:bg-accent-active disabled:border disabled:border-subtle disabled:bg-subtle disabled:text-ink-disabled"
              : busy
                ? "h-12 flex-1 rounded-sm bg-accent text-body-sm font-medium text-accent-text disabled:border disabled:border-subtle disabled:bg-subtle disabled:text-ink-disabled"
                : recording
                  ? "h-12 flex-1 rounded-sm bg-accent text-body-sm font-medium text-accent-text hover:bg-accent-hover active:scale-[0.985] active:bg-accent-active"
                  : "h-12 flex-1 rounded-sm border border-subtle bg-subtle text-body-sm font-medium text-ink-disabled"
          }
        >
          {label}
        </button>
      </div>

      {faultVisible && fault ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-body-sm text-error"
        >
          <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
          {fault.userMessage}
        </p>
      ) : null}
    </section>
  );
}
