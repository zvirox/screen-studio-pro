import { Check, LoaderCircle, Monitor, AppWindow, Crop } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { cn } from "../../lib/cn";
import { useSspStore } from "../../lib/store";
import { useSourcePreview } from "../../hooks/useSourcePreview";
import CameraPip from "../huds/CameraPip";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";

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
        <LoaderCircle
          size={16}
          strokeWidth={1.5}
          className="shrink-0 animate-spin-slow"
          aria-hidden="true"
        />
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
            <span className="font-mono text-mono-sm text-ink-secondary">{capsText}</span>
          ) : null}
        </>
      )}
      {isActive ? (
        <Check size={16} strokeWidth={1.5} className="text-accent" aria-hidden="true" />
      ) : null}
    </button>
  );
}

/** Percentage geometry of an object-contain source inside the 16:9 canvas. */
function containedSourceStyle(width: number, height: number): React.CSSProperties {
  const sourceAspect = width / height;
  const previewAspect = 16 / 9;
  if (sourceAspect > previewAspect) {
    const contentHeight = (previewAspect / sourceAspect) * 100;
    return {
      left: "0%",
      top: `${(100 - contentHeight) / 2}%`,
      width: "100%",
      height: `${contentHeight}%`,
    };
  }
  const contentWidth = (sourceAspect / previewAspect) * 100;
  return {
    left: `${(100 - contentWidth) / 2}%`,
    top: "0%",
    width: `${contentWidth}%`,
    height: "100%",
  };
}

/** Drag handle for the region rect — keyboard + pointer accessible. */
function RegionDragHandle({
  rect,
  onDragEnd,
  previewWidth,
  previewHeight,
  previewElement,
}: {
  rect: { x: number; y: number; w: number; h: number };
  onDragEnd: (rect: { x: number; y: number; w: number; h: number }) => void;
  previewWidth: number;
  previewHeight: number;
  previewElement: React.RefObject<HTMLDivElement | null>;
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
    // RegionRect uses native-source geometry. Pointer CSS pixels need the
    // rendered content scale; keyboard steps are already native pixels.
    const keyboardDrag = event.activatorEvent instanceof KeyboardEvent;
    const bounds = previewElement.current?.getBoundingClientRect();
    const scaleX = keyboardDrag ? 1 : previewWidth / (bounds?.width || previewWidth);
    const scaleY = keyboardDrag ? 1 : previewHeight / (bounds?.height || previewHeight);
    const newX = Math.max(0, Math.min(previewWidth - rect.w, rect.x + delta.x * scaleX));
    const newY = Math.max(0, Math.min(previewHeight - rect.h, rect.y + delta.y * scaleY));
    onDragEnd({ ...rect, x: Math.round(newX), y: Math.round(newY) });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <RegionDragRect rect={rect} previewWidth={previewWidth} previewHeight={previewHeight} />
    </DndContext>
  );
}

/** Kept below DndContext so useDraggable registers with the active provider. */
function RegionDragRect({
  rect,
  previewWidth,
  previewHeight,
}: {
  rect: { x: number; y: number; w: number; h: number };
  previewWidth: number;
  previewHeight: number;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: "source-region-selection",
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        position: "absolute",
        left: `${(rect.x / previewWidth) * 100}%`,
        top: `${(rect.y / previewHeight) * 100}%`,
        width: `${(rect.w / previewWidth) * 100}%`,
        height: `${(rect.h / previewHeight) * 100}%`,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        border: "2px solid",
        borderColor: "var(--ssp-accent)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--ssp-elev-1)",
        cursor: "move",
        zIndex: "var(--ssp-z-sticky)",
      }}
      role="graphics-document"
      aria-label="Region selection rectangle"
      aria-roledescription="Draggable crop rectangle"
      tabIndex={0}
    />
  );
}

export interface SourceDeckProps {
  hideHeaderChips?: boolean;
}

export default function SourceDeck({ hideHeaderChips = false }: SourceDeckProps = {}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const source = useSspStore((s) => s.source);
  const sessionStatus = useSspStore((s) => s.session.status);
  const camera = useSspStore((s) => s.camera);
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
  const isMonitorActive =
    (source.status === "live" && source.label?.startsWith("Monitor")) ?? false;
  const isMonitorSelecting = source.status === "selecting" && source.selectingKind === "monitor";
  const isWindowActive = (source.status === "live" && source.label?.startsWith("Window")) ?? false;
  const isWindowSelecting = source.status === "selecting" && source.selectingKind === "window";
  const isRegionActive = (source.status === "live" && source.label?.startsWith("Region")) ?? false;
  const isRegionSelecting = source.status === "selecting" && source.selectingKind === "region";

  // Region rect state — preview coordinates (scaled from source coordinates).
  const [regionRect, setRegionRectLocal] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(() => {
    if (source.regionRect) {
      return {
        x: source.regionRect.x,
        y: source.regionRect.y,
        w: source.regionRect.w,
        h: source.regionRect.h,
      };
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
    <section
      aria-label="Source"
      className="studio-deck min-w-0 rounded-lg border border-line-glass p-4 shadow-elev-2 min-[720px]:p-5"
    >
      {!hideHeaderChips && (
        <div className="flex flex-wrap items-center gap-2">
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
      )}

      <div
        aria-label="Source preview"
        className={cn(
          "relative mx-auto flex aspect-video w-full items-center justify-center rounded-lg hero-canvas border border-line-glass shadow-elev-float overflow-hidden",
          !hideHeaderChips && "mt-4",
        )}
      >
        {still ? (
          <img
            src={still.dataUrl}
            alt="Source preview"
            className="absolute inset-0 h-full w-full rounded-lg object-contain"
          />
        ) : null}
        {slotVisible ? (
          source.status === "live" ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-body-sm text-accent-text/80"
            >
              <LoaderCircle
                size={16}
                strokeWidth={1.5}
                className="animate-spin-slow"
                aria-hidden="true"
              />
              Working…
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {isWindowActive ? (
                <AppWindow
                  size={28}
                  strokeWidth={1.5}
                  className="text-accent-text/70"
                  aria-hidden="true"
                />
              ) : isRegionActive ? (
                <Crop
                  size={28}
                  strokeWidth={1.5}
                  className="text-accent-text/70"
                  aria-hidden="true"
                />
              ) : (
                <Monitor
                  size={28}
                  strokeWidth={1.5}
                  className="text-accent-text/70"
                  aria-hidden="true"
                />
              )}
              <p className="max-w-md text-body-md leading-relaxed text-accent-text/80">
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
          <div
            ref={previewRef}
            role="group"
            aria-label="Region source content"
            className="absolute"
            style={containedSourceStyle(source.capabilities.width, source.capabilities.height)}
          >
            <RegionDragHandle
              rect={regionRect}
              onDragEnd={handleRegionDragEnd}
              previewWidth={source.capabilities.width}
              previewHeight={source.capabilities.height}
              previewElement={previewRef}
            />
          </div>
        )}
        {/* §6.6 Camera PiP (4.2) — floats inside the preview frame so its
            corner+margin position maps 1:1 onto the 4.3 composite stage
            (the frame IS the output frame's preview). The open reply
            implies a servable still, so a brief mount spinner is the
            only non-still state. */}
        {camera.status === "open" && camera.cameraId ? (
          <CameraPip cameraId={camera.cameraId} recording={sessionStatus === "recording"} />
        ) : null}
      </div>
    </section>
  );
}
