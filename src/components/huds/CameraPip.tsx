import { useEffect, useRef, useState } from "react";
import { Circle, LoaderCircle, RectangleHorizontal, Video, VideoOff } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useCameraPreview } from "../../hooks/useSourcePreview";
import { useSspStore } from "../../lib/store";

/* §6.6 Camera PiP — the Float recipe floating INSIDE the source preview
   frame (4.2 decision: the frame is the only video surface, §4.5, and
   PLAN 4.3 composites the PiP "exactly where the UI showed it"). Position
   model = the pre-documented `pip.position` wire shape (API §2.6):
   corner + margin — drag freely, snap to the NEAREST corner on release,
   guides mark the four targets while dragging with the winning one lit.
   Size clamps to 160–320px (§6.6); the 44px grip is §7.6's hit-area law.
   Shape is the `r.full`/`r.lg` toggle (default circle — the PRD M5
   signature), riding a popover per PRD 7.3. Camera-off freezes the
   PREVIEW only (§6.6 hover control) — the poll stops, the last still
   holds; recording itself never touches the preview tier. 2px signal
   ring while a take is live (§7.4: paired with the HUD's state text,
   never color-only). Shape/size/position stay local until 4.4 persists
   them via ui_prefs. */

/** §2.6 wire example `corner:bottom-right,margin:24` — the snap margin. */
const PIP_MARGIN = 24;
/** §6.6 size band. */
const PIP_MIN = 160;
const PIP_MAX = 320;
/** Default size — the middle of the §6.6 band. */
const PIP_DEFAULT_SIZE = 240;
/** The PiP box is 16:9 (the stills' aspect); circle crops it to a disc. */
const PIP_ASPECT = 9 / 16;

export type PipCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type PipShape = "circle" | "rounded";

export const CORNERS: PipCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Clamps a requested size into the §6.6 band. */
export function clampSize(size: number): number {
  return Math.max(PIP_MIN, Math.min(PIP_MAX, Math.round(size)));
}

/** The nearest corner to a free (dragged) position — the snap law. The
    free box is clamped inside the bounds first (RegionDragHandle law),
    then the box's center picks its corner by distance. */
export function snapCorner(
  freeLeft: number,
  freeTop: number,
  boxSize: number,
  boundsW: number,
  boundsH: number,
): PipCorner {
  const boxH = boxSize * PIP_ASPECT;
  const left = Math.max(0, Math.min(boundsW - boxSize, freeLeft));
  const top = Math.max(0, Math.min(boundsH - boxH, freeTop));
  const cx = left + boxSize / 2;
  const cy = top + boxH / 2;
  const horizontal: "left" | "right" = cx <= boundsW / 2 ? "left" : "right";
  const vertical: "top" | "bottom" = cy <= boundsH / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}`;
}

/** Absolute style for a corner — CSS anchoring tracks container resizes
    without measurements (the position model IS corner + margin). */
function cornerStyle(corner: PipCorner, size: number): React.CSSProperties {
  const height = Math.round(size * PIP_ASPECT);
  const style: React.CSSProperties = { width: size, height };
  if (corner.includes("left")) style.left = PIP_MARGIN;
  else style.right = PIP_MARGIN;
  if (corner.startsWith("top")) style.top = PIP_MARGIN;
  else style.bottom = PIP_MARGIN;
  return style;
}

/** The L-bracket guide for one corner target (inset = the snap margin),
    lit for the corner currently winning the snap. */
function guideClass(corner: PipCorner, winner: PipCorner | null): string {
  const bars =
    corner === "top-left"
      ? "left-6 top-6 border-l-2 border-t-2"
      : corner === "top-right"
        ? "right-6 top-6 border-r-2 border-t-2"
        : corner === "bottom-left"
          ? "left-6 bottom-6 border-l-2 border-b-2"
          : "right-6 bottom-6 border-r-2 border-b-2";
  const strength = winner === corner ? "border-accent" : "border-accent/40";
  return `absolute h-6 w-6 ${bars} ${strength} pointer-events-none`;
}

interface CameraPipProps {
  cameraId: string;
  /** 2px signal ring while a take is live (§6.6). */
  recording: boolean;
}

export default function CameraPip({ cameraId, recording }: CameraPipProps) {
  const loadPipPrefs = useSspStore((s) => s.loadPipPrefs);
  const setPipPosition = useSspStore((s) => s.setPipPosition);
  const setPipShape = useSspStore((s) => s.setPipShape);
  const setPipSize = useSspStore((s) => s.setPipSize);
  const prefs = useSspStore((s) => s.prefs);

  const [corner, setCorner] = useState<PipCorner>("bottom-right");
  const [size, setSize] = useState(PIP_DEFAULT_SIZE);
  const [shape, setShape] = useState<PipShape>("circle");
  const [frozen, setFrozen] = useState(false);
  // The corner currently winning the snap — render-only (guides).
  const [snapWinner, setSnapWinner] = useState<PipCorner | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Base item position measured once per drag (pre-transform).
  const baseRef = useRef<{ left: number; top: number } | null>(null);

  // §6.6: camera-off freeze is preview-only — the poll stops, the last
  // still holds on screen (the hook keeps prior state when disabled).
  const still = useCameraPreview(cameraId, !frozen);

  // 4.4: load persisted pip prefs on mount; missing keys fall back to
  // defaults (bottom-right / 240px / circle). pip.position has the wire
  // shape "corner:<corner>,margin:<n>" (API §2.6).
  useEffect(() => {
    void loadPipPrefs();
    // Parse position pref once loaded.
    const pos = prefs.pipPosition;
    if (pos) {
      const m = pos.match(/corner:(top-left|top-right|bottom-left|bottom-right),margin:(\d+)/);
      if (m) {
        setCorner(m[1] as PipCorner);
      }
    }
    if (prefs.pipShape) setShape(prefs.pipShape);
    if (prefs.pipSize) setSize(prefs.pipSize);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      // §7.3 keyboard reachability, RegionDragHandle precedent: 1px /
      // shift 10px roving inside the dnd drag.
      coordinateGetter: (event) => {
        const step = event.shiftKey ? 10 : 1;
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

  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: "camera-pip" });
  const itemRef = useRef<HTMLDivElement | null>(null);
  const setItemRef = (node: HTMLDivElement | null) => {
    itemRef.current = node;
    setNodeRef(node);
  };

  const freeGeometry = (delta: { x: number; y: number }) => {
    const base = baseRef.current;
    const container = containerRef.current;
    if (!base || !container) return null;
    const boundsW = container.clientWidth;
    const boundsH = container.clientHeight;
    return { boundsW, boundsH, left: base.left + delta.x, top: base.top + delta.y };
  };

  const measureBase = () => {
    const node = itemRef.current;
    const container = containerRef.current;
    if (!node || !container) return;
    const itemRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    baseRef.current = {
      left: itemRect.left - containerRect.left,
      top: itemRect.top - containerRect.top,
    };
  };

  const handleDragMove = (e: DragMoveEvent) => {
    const geo = freeGeometry(e.delta);
    if (!geo) return;
    setSnapWinner(snapCorner(geo.left, geo.top, size, geo.boundsW, geo.boundsH));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const geo = freeGeometry(e.delta);
    setSnapWinner(null);
    baseRef.current = null;
    if (!geo) return;
    const nextCorner = snapCorner(geo.left, geo.top, size, geo.boundsW, geo.boundsH);
    setCorner(nextCorner);
    // 4.4: persist corner + margin as pip.position (API §2.6 wire shape).
    void setPipPosition(`corner:${nextCorner},margin:${PIP_MARGIN}`);
  };

  /* Pointer resize from the 44px grip — diagonal grow (max of the axes),
     clamped to the §6.6 band; the corner anchoring keeps it in frame. */
  const resizeStart = useRef<{ x: number; y: number; size: number } | null>(null);

  const onGripPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // The grip is not a drag surface — resize is its own gesture.
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart.current = { x: e.clientX, y: e.clientY, size };
  };
  const onGripPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    const nextSize = clampSize(start.size + Math.max(e.clientX - start.x, e.clientY - start.y));
    setSize(nextSize);
    // 4.4: persist size as pip.size.
    void setPipSize(nextSize);
  };
  const onGripPointerUp = () => {
    resizeStart.current = null;
  };
  const onGripKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // §7.3: keyboard resize — grow up/right, shrink down/left.
    e.stopPropagation(); // the dnd KeyboardSensor must not hijack the grip
    const step = e.shiftKey ? 16 : 4;
    const grow = e.key === "ArrowUp" || e.key === "ArrowRight";
    const shrink = e.key === "ArrowDown" || e.key === "ArrowLeft";
    if (!grow && !shrink) return;
    e.preventDefault();
    setSize((s) => {
      const next = clampSize(s + (grow ? step : -step));
      // 4.4: persist size as pip.size.
      void setPipSize(next);
      return next;
    });
  };

  // Controls stop key/pointer propagation so the dnd KeyboardSensor
  // (Space/Enter activation) can never hijack a focused button.
  const stopForDnd = (e: React.SyntheticEvent) => e.stopPropagation();

  const isDragging = transform !== null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={measureBase}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setSnapWinner(null);
        baseRef.current = null;
      }}
    >
      {/* Guides live over the preview frame; the PiP is the only
          interactive layer (the frame's own chips sit below this mount). */}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden">
        {isDragging
          ? CORNERS.map((c) => (
              <div key={c} data-pip-guide={c} className={guideClass(c, snapWinner)} aria-hidden="true" />
            ))
          : null}
        <div
          ref={setItemRef}
          data-camera-pip="frame"
          {...attributes}
          role="group"
          aria-label="Camera picture-in-picture frame"
          className="float group pointer-events-auto absolute flex items-center justify-center overflow-hidden outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{
            ...cornerStyle(corner, size),
            transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
            borderRadius: shape === "circle" ? "var(--ssp-r-full)" : "var(--ssp-r-lg)",
            ...(recording ? { boxShadow: "var(--ssp-elev-float), 0 0 0 2px var(--ssp-signal)" } : {}),
          }}
          tabIndex={0}
          {...listeners}
        >
          {still ? (
            <img
              src={still.dataUrl}
              alt="Camera preview"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            // §5.1 loading: the open reply implies a still, so this is a
            // brief state — the spinner copy matches the deck's slot.
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <LoaderCircle size={16} strokeWidth={2} className="animate-spin [animation-duration:0.8s]" aria-hidden="true" />
              Working…
            </div>
          )}

          {/* §6.6 hover controls — visible on hover and keyboard focus
              (focus-within); every control ≥44px (§7.6). */}
          <div
            onPointerDown={stopForDnd}
            onKeyDown={stopForDnd}
            className={`absolute top-0 right-0 flex gap-1 p-1 opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 group-focus-within:opacity-100 ${
              shape === "circle" ? "rounded-full" : "rounded-t-lg"
            }`}
          >
            <button
              type="button"
              aria-label={frozen ? "Unfreeze camera preview" : "Freeze camera preview"}
              aria-pressed={frozen}
              title={frozen ? "Unfreeze preview" : "Freeze preview (recording continues)"}
              onClick={() => setFrozen((f) => !f)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {frozen ? (
                <VideoOff size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Video size={16} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            <Popover>
              <PopoverTrigger
                type="button"
                aria-label="Camera frame shape"
                title="Frame shape"
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {shape === "circle" ? (
                  <Circle size={16} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <RectangleHorizontal size={16} strokeWidth={2} aria-hidden="true" />
                )}
              </PopoverTrigger>
              {/* PRD 7.3 step 4: the circle/rounded toggle rides a
                  popover; §5.3 anatomy — check/wash on the active item. */}
              <PopoverContent role="menu" aria-label="Camera frame shape" className="w-auto p-1">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={shape === "circle"}
                  onClick={() => {
                    setShape("circle");
                    // 4.4: persist shape as pip.shape.
                    void setPipShape("circle");
                  }}
                  className="flex h-9 items-center gap-2 rounded-xs px-2 text-body-sm text-ink hover:bg-accent-muted aria-checked:bg-accent-muted aria-checked:font-medium"
                >
                  <Circle size={16} strokeWidth={1.5} aria-hidden="true" />
                  Circle
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={shape === "rounded"}
                  onClick={() => {
                    setShape("rounded");
                    // 4.4: persist shape as pip.shape.
                    void setPipShape("rounded");
                  }}
                  className="flex h-9 items-center gap-2 rounded-xs px-2 text-body-sm text-ink hover:bg-accent-muted aria-checked:bg-accent-muted aria-checked:font-medium"
                >
                  <RectangleHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
                  Rounded
                </button>
              </PopoverContent>
            </Popover>
          </div>

          {/* §6.6/§7.6: the 44px resize grip — bottom-right, keyboard
              resizable, slider semantics for the band. */}
          <div
            data-pip-grip
            role="slider"
            aria-label="Resize camera frame"
            aria-valuemin={PIP_MIN}
            aria-valuemax={PIP_MAX}
            aria-valuenow={Math.round(size)}
            aria-valuetext={`${Math.round(size)} pixels wide`}
            tabIndex={0}
            onPointerDown={onGripPointerDown}
            onPointerMove={onGripPointerMove}
            onPointerUp={onGripPointerUp}
            onPointerCancel={onGripPointerUp}
            onKeyDown={onGripKeyDown}
            className="absolute right-0 bottom-0 flex h-11 w-11 cursor-nwse-resize items-end justify-end p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {/* Grip affordance: diagonal ticks (decorative). */}
            <svg viewBox="0 0 12 12" className="h-3 w-3 text-ink-secondary" aria-hidden="true">
              <path d="M11 1L1 11M11 6l-5 5M6 11l-5 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
