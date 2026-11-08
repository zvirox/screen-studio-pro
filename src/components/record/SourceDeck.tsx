import { Check, LoaderCircle, Monitor, AppWindow } from "lucide-react";
import { useSspStore } from "../../lib/store";

/* §6.1 #2 source deck — Monitor + Window (M2) chips; Region (M3) joins later.
   Dead controls never render (§6.3). The preview frame is the only place
   video frames may ever render. Whenever capture is not live, the §6.3
   education slot shows the neutral invitation copy — a denied session
   surfaces its §1 human copy once, as an error toast (§5.6); the slot
   never becomes a second telling (ARCHITECTURE §4.2.4). Stills-based
   preview content lands with PLAN 3.5. */

function capabilityLine(
  caps: { width: number; height: number; fps: number } | null,
): string | null {
  if (!caps) return null;
  return `${caps.width}×${caps.height} · ${caps.fps}fps`;
}

interface SourceChipProps {
  label: string;
  icon: React.ReactNode;
  selectAction: () => Promise<void>;
  isActive: boolean;
  isSelecting: boolean;
  disabled: boolean;
  capsText: string | null;
}

function SourceChip({
  label,
  icon,
  selectAction,
  isActive,
  isSelecting,
  disabled,
  capsText,
}: SourceChipProps) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      disabled={disabled}
      onClick={() => void selectAction()}
      className={
        isActive
          ? "flex h-10 items-center gap-2 rounded-sm border border-accent bg-accent-muted pl-2.5 pr-3 text-body-sm font-medium text-ink"
          : "flex h-10 items-center gap-2 rounded-sm border border-subtle bg-solid pl-2.5 pr-3 text-body-sm font-medium text-ink enabled:hover:border-accent enabled:hover:bg-accent-muted disabled:border-subtle disabled:bg-solid disabled:text-ink-disabled"
      }
    >
      {isSelecting ? (
        <LoaderCircle size={16} strokeWidth={2} className="animate-spin [animation-duration:0.8s]" aria-hidden="true" />
      ) : (
        icon
      )}
      {isSelecting ? (
        <span role="status" aria-live="polite">
          Working…
        </span>
      ) : (
        <>
          {label}
          {capsText ? (
            <span className="font-mono text-mono-sm text-ink-secondary">
              {capsText}
            </span>
          ) : null}
        </>
      )}
      {isActive ? (
        <Check size={16} strokeWidth={2} className="text-accent" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export default function SourceDeck() {
  const source = useSspStore((s) => s.source);
  const sessionStatus = useSspStore((s) => s.session.status);
  const selectMonitor = useSspStore((s) => s.selectMonitor);
  const selectWindow = useSspStore((s) => s.selectWindow);
  const capabilities = useSspStore((s) => s.capabilities);

  const capsText = capabilityLine(source.capabilities);
  // §5.1: a mid-take source change would kill the live take — then the
  // chip is disabled; while idle it (re)arms the portal consent flow.
  const selectable = sessionStatus === "idle" && source.status !== "selecting";
  const slotVisible = source.status !== "live";
  // M2: Window chip only when the compositor's portal offers window capture.
  const windowCaptureSupported = capabilities?.portal?.windowCapture ?? false;
  const isMonitorActive = (source.status === "live" && source.label?.startsWith("Monitor")) ?? false;
  const isMonitorSelecting = source.status === "selecting" && source.selectingKind === "monitor";
  const isWindowActive = (source.status === "live" && source.label?.startsWith("Window")) ?? false;
  const isWindowSelecting = source.status === "selecting" && source.selectingKind === "window";

  return (
    <section aria-label="Source" className="pane rounded-md p-4">
      <div className="flex items-center gap-2">
        <SourceChip
          label="Monitor"
          icon={<Monitor size={16} strokeWidth={1.5} aria-hidden="true" />}
          selectAction={selectMonitor}
          isActive={isMonitorActive}
          isSelecting={isMonitorSelecting}
          disabled={!selectable}
          capsText={isMonitorActive ? capsText : null}
        />
        {windowCaptureSupported && (
          <SourceChip
            label="Window"
            icon={<AppWindow size={16} strokeWidth={1.5} aria-hidden="true" />}
            selectAction={selectWindow}
            isActive={isWindowActive}
            isSelecting={isWindowSelecting}
            disabled={!selectable}
            capsText={isWindowActive ? capsText : null}
          />
        )}
      </div>

      <div
        aria-label="Source preview"
        className="mt-3 flex aspect-video w-full items-center justify-center rounded-sm bg-solid"
      >
        {slotVisible ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            {isWindowActive ? (
              <AppWindow size={28} strokeWidth={1.5} className="text-ink-disabled" aria-hidden="true" />
            ) : (
              <Monitor size={28} strokeWidth={1.5} className="text-ink-disabled" aria-hidden="true" />
            )}
            <p className="text-body-sm text-ink-secondary">
              {isWindowActive
                ? "Click Window to select a window to capture"
                : "Click Monitor to allow capture through your compositor"}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
