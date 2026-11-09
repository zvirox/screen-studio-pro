import { Dot, LoaderCircle, Square, Zap, Cpu } from "lucide-react";
import { useEffect } from "react";
import { useSspStore } from "../../lib/store";
import { formatElapsed } from "../../lib/format";
import type { PresetId } from "../../types/ipc";

/* §5.1/§6.1 #5 action row — 1.5 slice: the 48px primary Record button only
   (the preset select and encoder chip join with their features in 3.x).
   §6.5 flow: Record → loading ("Working…") → while the take runs the row
   shows the elapsed mono timer + Stop & save (the §5.9 HUD window itself
   lands in PLAN 2.4) → idle again. Fault copy surfaces once, at floatover
   level, through the store's error toasts (§5.6, ToastHost since 1.7) —
   the row renders no second telling of it. */

/* Encoder chip — shows the active backend (NVENC/VAAPI/x264) with fallback notice.
   DESIGN §6.1: x264 shows warning-state inline notice with zap-off icon:
   "Falling back to CPU encode". */
function EncoderChip({ backend, isFallback }: { backend: string; isFallback: boolean }) {
  const label = backend.toUpperCase();
  const icon = backend === "nvenc" ? <Cpu size={12} strokeWidth={2} /> : backend === "vaapi" ? <Cpu size={12} strokeWidth={2} /> : <Cpu size={12} strokeWidth={2} />;
  const fallbackNotice = isFallback ? (
    <span className="flex items-center gap-1 text-warning text-body-xs">
      <Zap size={10} strokeWidth={2} aria-hidden="true" />
      Falling back to CPU encode
    </span>
  ) : null;

  return (
    <div className="flex items-center gap-1.5 rounded-sm border border-subtle bg-solid px-2 py-1 text-body-sm font-mono text-ink">
      {icon}
      {label}
      {fallbackNotice}
    </div>
  );
}

export default function ActionRow() {
  const source = useSspStore((s) => s.source);
  const session = useSspStore((s) => s.session);
  const presets = useSspStore((s) => s.presets);
  const loadPresets = useSspStore((s) => s.loadPresets);
  const setPreset = useSspStore((s) => s.setPreset);
  const startRecording = useSspStore((s) => s.startRecording);
  const stopRecording = useSspStore((s) => s.stopRecording);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const busy = session.status === "starting" || session.status === "stopping";
  const recording = session.status === "recording";
  const idle = session.status === "idle";
  // A fault still tints the retry state (primary action after failure);
  // its copy renders once, in the error toast (§6.5 no-double-telling).
  const fault = session.fault;

  /* M11 preset select — DESIGN §6.1 #5: "quality preset select left
     (plain language: "For YouTube — 1080p60")". Native select styled
     with the closed tokens (no new Radix dep would be a §4.2 ask).
     Disabled while recording (take-snapshot law: changes apply to
     the next recording). */
  const presetSelect = (
    <label className="flex items-center gap-2 text-body-sm">
      <span className="sr-only">Quality preset</span>
      <select
        aria-label="Quality preset"
        value={presets.presetId ?? ""}
        disabled={recording || presets.status !== "ready"}
        onChange={(e) => void setPreset(e.target.value as PresetId)}
        className="h-10 max-w-[220px] truncate rounded-sm border border-subtle bg-solid px-2 text-body-sm text-ink disabled:opacity-60"
      >
        {presets.presets.length === 0 && <option value="">Quality…</option>}
        {presets.presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} — {p.description}
          </option>
        ))}
      </select>
    </label>
  );

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
        {presetSelect}
        {recording ? (
          <>
            <div
              role="timer"
              className="rounded-sm border border-subtle bg-solid px-2.5 py-1.5 font-mono text-mono-md tabular-nums text-ink"
            >
              {formatElapsed(session.elapsedMs)}
            </div>
            {/* §5.9 paused law: the timer freezes and the PAUSED `label`
                chip sits beside it — text + placement carry the phase
                (§7.8: never color-only). No pause/resume buttons here —
                §5.9 reserves them for the 2.4 HUD window. */}
            {session.paused ? (
              <div
                role="status"
                className="rounded-xs bg-signal-muted px-2 py-1.5 text-label font-medium text-signal"
              >
                PAUSED
              </div>
            ) : null}
            {/* Encoder chip — right side during recording */}
            <EncoderChip backend={session.encoderBackend || "x264"} isFallback={session.encoderBackend === "x264" && !!session.startedAt} />
          </>
        ) : (
          <>
            {/* Encoder chip — idle state shows configured encoder */}
            <EncoderChip backend={session.encoderBackend || "auto"} isFallback={false} />
          </>
        )}
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
    </section>
  );
}
