import { Check, LoaderCircle, Monitor, AppWindow, Crop } from "lucide-react";
import { useState, useCallback } from "react";
import { useSspStore } from "../../lib/store";
import { useSourcePreview } from "../../hooks/useSourcePreview";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";

/* §6.1 #2 source deck — Monitor + Window (M2) + Region (M3) chips.
   Dead controls never render (§6.3). The preview frame is the only place
   video frames may ever render: since 3.5 it shows real JPEG stills
   polled at ≤8fps (API §2.1, the ARCHITECTURE §6 stills exception) —
   never a fake gradient (§4.5). Whenever capture is not live, the §6.3
   education slot shows the neutral invitation copy — a denied session
   surfaces its §1 human copy once, as an error toast (§5.6); the slot
   never becomes a second telling (ARCHITECTURE §4.2.4). */

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

/** Drag handle for the region rect — keyboard + pointer accessible. */
function RegionDragHandle({
  rect,
  onDragEnd,
  previewWidth,
  previewHeight,
}: {
  rect: { x: number; y: number; w: number; h: number };
  onDragEnd: (rect: { x: number; y: number; w: number; h: number }) => void;
  previewWidth: number;
  previewHeight: number;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event) => {
        const step = event.shiftKey ? 10 : 1; // DESIGN §7: 1px / shift 10px
        switch (event.key) {
          case "ArrowLeft":
            return { x: -step, y: 0 };
          case "ArrowRight":
            return { x: step, y: 0 };
          case "ArrowUp":
            return { x: 0, y: -step };
          case "ArrowDown":
            return { x: 0, y: step };
          default:
            return { x: 0, y: 0 };
        }
      },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { delta } = event;
    const newX = Math.max(0, Math.min(previewWidth - rect.w, rect.x + delta.x));
    const newY = Math.max(0, Math.min(previewHeight - rect.h, rect.y + delta.y));
    onDragEnd({ ...rect, x: Math.round(newX), y: Math.round(newY) });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <div
        style={{
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          border: "2px solid",
          borderColor: "var(--ssp-accent)",
          borderRadius: "var(--ssp-r-sm)",
          boxShadow: "0 0 0 1px var(--ssp-bg-canvas), 0 0 0 3px var(--ssp-accent)",
          cursor: "move",
          zIndex: 10,
        }}
        role="graphics-document"
        aria-label="Region selection rectangle"
        aria-roledescription="Draggable crop rectangle"
      />
    </DndContext>
  );
}

export default function SourceDeck() {
  const source = useSspStore((s) => s.source);
  const sessionStatus = useSspStore((s) => s.session.status);
  const selectMonitor = useSspStore((s) => s.selectMonitor);
  const selectWindow = useSspStore((s) => s.selectWindow);
  const selectRegion = useSspStore((s) => s.selectRegion);
  const setRegionRect = useSspStore((s) => s.setRegionRect);
  const capabilities = useSspStore((s) => s.capabilities);

  const capsText = capabilityLine(source.capabilities);
  // §5.1: a mid-take source change would kill the live take — then the
  // chip is disabled; while idle it (re)arms the portal consent flow.
  const selectable = sessionStatus === "idle" && source.status !== "selecting";
  // 3.5: poll stills only while a source is live; the hook stops on
  // release/unmount (API §4 rate law). Until the first still lands the
  // frame shows the §5.1 loading state, not the education copy.
  const still = useSourcePreview(source.status === "live" ? source.sourceId : null);
  const slotVisible = source.status !== "live" || !still;
  // M2: Window chip only when the compositor's portal offers window capture.
  const windowCaptureSupported = capabilities?.portal?.windowCapture ?? false;
  const isMonitorActive = (source.status === "live" && source.label?.startsWith("Monitor")) ?? false;
  const isMonitorSelecting = source.status === "selecting" && source.selectingKind === "monitor";
  const isWindowActive = (source.status === "live" && source.label?.startsWith("Window")) ?? false;
  const isWindowSelecting = source.status === "selecting" && source.selectingKind === "window";
  const isRegionActive = (source.status === "live" && source.label?.startsWith("Region")) ?? false;
  const isRegionSelecting = source.status === "selecting" && source.selectingKind === "region";

  // Region rect state — preview coordinates (scaled from source coordinates).
  const [regionRect, setRegionRectLocal] = useState<{ x: number; y: number; w: number; h: number } | null>(() => {
    if (source.regionRect) {
      return { x: source.regionRect.x, y: source.regionRect.y, w: source.regionRect.w, h: source.regionRect.h };
    }
    // Default to center 720p rect if no rect set.
    const w = 1280;
    const h = 720;
    return { x: Math.round((1920 - w) / 2), y: Math.round((1080 - h) / 2), w, h };
  });

  const handleRegionDragEnd = (newRect: { x: number; y: number; w: number; h: number }) => {
    setRegionRectLocal(newRect);
    if (source.sourceId) {
      void setRegionRect(source.sourceId, newRect);
    }
  };

  const handleRegionSelect = useCallback(async () => {
    if (!selectable) return;
    try {
      await selectRegion();
    } catch {
      // Error is handled by the selectRegion action itself (toast + state)
    }
  }, [selectable, selectRegion]);

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
        <SourceChip
          label="Region"
          icon={<Crop size={16} strokeWidth={1.5} aria-hidden="true" />}
          selectAction={handleRegionSelect}
          isActive={isRegionActive}
          isSelecting={isRegionSelecting}
          disabled={!selectable}
          capsText={isRegionActive ? capsText : null}
        />
      </div>

      <div
        aria-label="Source preview"
        className="mt-3 flex aspect-video w-full items-center justify-center rounded-sm bg-solid relative"
      >
        {still ? (
          <img
            src={still.dataUrl}
            alt="Source preview"
            className="absolute inset-0 h-full w-full rounded-sm object-contain"
          />
        ) : null}
        {slotVisible ? (
          source.status === "live" ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-body-sm text-ink-secondary"
            >
              <LoaderCircle size={16} strokeWidth={2} className="animate-spin [animation-duration:0.8s]" aria-hidden="true" />
              Working…
            </div>
          ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center w-full h-full">
            {isWindowActive ? (
              <AppWindow size={28} strokeWidth={1.5} className="text-ink-disabled" aria-hidden="true" />
            ) : isRegionActive ? (
              <Crop size={28} strokeWidth={1.5} className="text-ink-disabled" aria-hidden="true" />
            ) : (
              <Monitor size={28} strokeWidth={1.5} className="text-ink-disabled" aria-hidden="true" />
            )}
            <p className="text-body-sm text-ink-secondary">
              {isRegionActive
                ? "Drag to select region; arrow keys to nudge (Shift = 10px)"
                : isWindowActive
                ? "Click Window to select a window to capture"
                : "Click Monitor to allow capture through your compositor"}
            </p>
          </div>
          )
        ) : null}
        {isRegionActive && regionRect && source.capabilities && (
          <RegionDragHandle
            rect={regionRect}
            onDragEnd={handleRegionDragEnd}
            previewWidth={source.capabilities.width}
            previewHeight={source.capabilities.height}
          />
        )}
      </div>
    </section>
  );
}
