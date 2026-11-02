import { Check, LoaderCircle, Monitor } from "lucide-react";
import { useSspStore } from "../../lib/store";

/* §6.1 #2 source deck — 1.5 slice: the Monitor chip only (Window/Region
   chips arrive with the M2/M3 portal flavours; dead controls never render,
   §6.3) + the preview frame, the only place video frames may ever render.
   Idle/error show the §6.3 education slot ("Click Monitor to allow capture
   through your compositor"); a denied session shows the §1 human copy in
   the same slot — education, not an error screen (ARCHITECTURE §4.2.4).
   Stills-based preview content lands with PLAN 3.5. */

function capabilityLine(
  caps: { width: number; height: number; fps: number } | null,
): string | null {
  if (!caps) return null;
  return `${caps.width}×${caps.height} · ${caps.fps}fps`;
}

export default function SourceDeck() {
  const source = useSspStore((s) => s.source);
  const sessionStatus = useSspStore((s) => s.session.status);
  const selectMonitor = useSspStore((s) => s.selectMonitor);

  const capsText = capabilityLine(source.capabilities);
  // §5.1: a mid-take source change would kill the live take — then the
  // chip is disabled; while idle it (re)arms the portal consent flow.
  const selectable = sessionStatus === "idle" && source.status !== "selecting";
  const slotVisible = source.status !== "live";

  return (
    <section aria-label="Source" className="pane rounded-md p-4">
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={source.status === "live"}
          disabled={!selectable}
          onClick={() => void selectMonitor()}
          className={
            source.status === "live"
              ? "flex h-10 items-center gap-2 rounded-sm border border-accent bg-accent-muted pl-2.5 pr-3 text-body-sm font-medium text-ink"
              : "flex h-10 items-center gap-2 rounded-sm border border-subtle bg-solid pl-2.5 pr-3 text-body-sm font-medium text-ink enabled:hover:border-accent enabled:hover:bg-accent-muted disabled:border-subtle disabled:bg-solid disabled:text-ink-disabled"
          }
        >
          {source.status === "selecting" ? (
            <LoaderCircle size={16} strokeWidth={2} className="animate-spin [animation-duration:0.8s]" aria-hidden="true" />
          ) : (
            <Monitor size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
          {source.status === "selecting" ? (
            <span role="status" aria-live="polite">
              Working…
            </span>
          ) : (
            <>
              Monitor
              {capsText ? (
                <span className="font-mono text-mono-sm text-ink-secondary">
                  {capsText}
                </span>
              ) : null}
            </>
          )}
          {source.status === "live" ? (
            <Check size={16} strokeWidth={2} className="text-accent" aria-hidden="true" />
          ) : null}
        </button>
      </div>

      <div
        aria-label="Source preview"
        className="mt-3 flex aspect-video w-full items-center justify-center rounded-sm bg-solid"
      >
        {slotVisible ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <Monitor
              size={28}
              strokeWidth={1.5}
              className="text-ink-disabled"
              aria-hidden="true"
            />
            {source.status === "error" && source.error ? (
              <p
                role="alert"
                className="flex items-start gap-1.5 text-body-sm text-error"
              >
                {source.error.userMessage}
              </p>
            ) : (
              <p className="text-body-sm text-ink-secondary">
                Click Monitor to allow capture through your compositor
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
