import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Flag, Pause, Play, Square } from "lucide-react";
import { useSspStore } from "../../lib/store";
import { formatElapsed } from "../../lib/format";
import { recordingFlag } from "../../lib/ipc";

/* §5.9 HUD (recording toolbar) — the signature component. Lives in its own
   transparent always-on-top window (lib/hudWindow); Rendered surface only:
   timer + phase come from the tick stream via the shared store (ARCHITECTURE
   §3.2 step 5 — events are the state sync), and the pause/resume/stop
   buttons call the SAME store actions the ActionRow binds (one take, one
   truth, §4.1). The flag button is now live (2.5): each tap appends a
   chapter marker and flashes a brief tick on the timer chip — DESIGN §6.5
   silent, non-blocking; the main window surfaces persistent errors. */

export default function HudBar() {
  const session = useSspStore((s) => s.session);
  const pauseRecording = useSspStore((s) => s.pauseRecording);
  const resumeRecording = useSspStore((s) => s.resumeRecording);
  const stopRecording = useSspStore((s) => s.stopRecording);
  const [pinned, setPinned] = useState(false);
  const [flagged, setFlagged] = useState(false);

  if (session.status !== "recording") {
    return null;
  }

  const interactionTarget = (e: { target: EventTarget | null }) =>
    (e.target as HTMLElement | null)?.closest("button");

  return (
    <div
      role="toolbar"
      aria-label="Recording HUD"
      onPointerDown={(e) => {
        // §5.9: draggable everywhere — except a button press is a press.
        if (interactionTarget(e)) return;
        void getCurrentWindow().startDragging();
      }}
      onDoubleClick={(e) => {
        // §5.9: double-click pins — the bar dims to 0.85 (pinned state)
        // and keeps float elevation. AGAIN unpins.
        if (interactionTarget(e)) return;
        setPinned((p) => !p);
      }}
      className={`float flex h-[46px] items-center gap-3 rounded-full px-3 ${
        pinned ? "opacity-85" : ""
      }`}
    >
      {session.paused ? (
        // §5.9 paused: the dot becomes a 22px SIGNAL SQUARE (§7.8: shape +
        // text carry the state, never color alone).
        <div data-hud="dot" className="h-[22px] w-[22px] rounded-xs bg-signal" />
      ) : (
        <div
          data-hud="dot"
          className="h-2.5 w-2.5 animate-pulse-rec rounded-full bg-signal"
        />
      )}
      <div
        role="timer"
        className="font-mono text-mono-md tabular-nums text-ink"
      >
        {formatElapsed(session.elapsedMs)}
      </div>
      {session.paused ? (
        <span className="rounded-xs bg-signal-muted px-2 py-1 text-label font-medium text-signal">
          PAUSED
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label={session.paused ? "Resume recording" : "Pause recording"}
          onClick={() => void (session.paused ? resumeRecording() : pauseRecording())}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-accent"
        >
          {session.paused ? (
            <Play size={16} strokeWidth={2} className="fill-current" aria-hidden="true" />
          ) : (
            <Pause size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label="Stop & save"
          title="Stop & save"
          onClick={() => void stopRecording()}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink transition-transform duration-(--duration-fast) hover:scale-[1.06] focus-visible:outline focus-visible:outline-accent"
        >
          <Square size={14} strokeWidth={2} className="fill-current" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Flag a chapter marker"
          disabled={!session.recordingId}
          onClick={async () => {
            if (!session.recordingId) return;
            try {
              await recordingFlag(session.recordingId, undefined);
              // DESIGN §6.5: brief tick on timer chip — silent, non-blocking.
              // HUD shows a 500ms pulse on the flag icon as local feedback.
              setFlagged(true);
              setTimeout(() => setFlagged(false), 500);
            } catch {
              // A refused flag (no live take / wrong id) is not an error —
              // §6.5: the tick phase will disagree and the main window
              // already shows the authoritative state. Other failures are
              // surfaced by the main window via tick/error events.
            }
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Flag
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className={flagged ? "text-signal" : ""}
          />
        </button>
      </div>
    </div>
  );
}
