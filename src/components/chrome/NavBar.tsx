import { useRef, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import {
  Clapperboard,
  Library,
  Maximize2,
  Minus,
  Settings,
  Square,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSspStore, type ViewId } from "../../lib/store";
import { formatElapsed } from "../../lib/format";
import { MOTION } from "../../lib/motion";
import Button from "../ui/Button";

/* DESIGN.md v3.1 §5.1 Integrated Studio Titlebar (NavBar CSD)
   Height 52px (h-13), full window width, pane glass recipe, r.lg top corners.
   - Left: Window control dots (Close, Minimize, Maximize)
           + Brand mark + "ScreenStudio Pro" title.
   - Center: Sleek 3-tab view capsule (Record | Library | Settings) with keyboard roving.
   - Right: Telemetry pill badge (1080p60 VAAPI) + 40px Primary Record pill CTA.
   data-tauri-drag-region enabled on non-interactive titlebar areas. */

type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: readonly NavItem[] = [
  { id: "record", label: "Record", icon: Clapperboard },
  { id: "library", label: "Library", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
];

function safeGetWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export default function NavBar({ showWindowControls = true }: { showWindowControls?: boolean }) {
  const view = useSspStore((s) => s.view);
  const setView = useSspStore((s) => s.setView);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const session = useSspStore((s) => s.session);
  const presetId = useSspStore((s) => s.presets.presetId);
  const presetsList = useSspStore((s) => s.presets.presets);
  const sourceCaps = useSspStore((s) => s.source.capabilities);
  const startRecording = useSspStore((s) => s.startRecording);
  const stopRecording = useSspStore((s) => s.stopRecording);

  const isRecording = session.status === "recording";
  const isStarting = session.status === "starting";
  const isStopping = session.status === "stopping";
  const isBusy = isStarting || isStopping;

  // Telemetry computation: active preset / capabilities + hardware encoder
  const activePreset = presetsList.find((p) => p.id === presetId);
  const resolutionText = activePreset
    ? activePreset.height > 0
      ? `${activePreset.height}p${activePreset.fps}`
      : "Native"
    : sourceCaps
      ? `${sourceCaps.height}p${sourceCaps.fps}`
      : "1080p60";
  const encoderText = (session.encoderBackend ?? "VAAPI").toUpperCase();
  const telemetryText = `${resolutionText} ${encoderText}`;

  // Window control actions with safe Tauri API invocation and fallback
  async function handleClose() {
    try {
      const win = safeGetWindow();
      if (win && typeof win.close === "function") {
        await win.close();
      }
    } catch (err) {
      console.warn("Failed to close window:", err);
    }
  }

  async function handleMinimize() {
    try {
      const win = safeGetWindow();
      if (win && typeof win.minimize === "function") {
        await win.minimize();
      }
    } catch (err) {
      console.warn("Failed to minimize window:", err);
    }
  }

  async function handleMaximize() {
    try {
      const win = safeGetWindow();
      if (win && typeof win.toggleMaximize === "function") {
        await win.toggleMaximize();
      }
    } catch (err) {
      console.warn("Failed to toggle maximize window:", err);
    }
  }

  function selectTab(id: NavItem["id"], el?: HTMLButtonElement | null) {
    setView(id);
    el?.focus();
  }

  // Arrow-key roving across the 3-tab capsule
  function onKeyDown(e: KeyboardEvent) {
    const current = NAV_ITEMS.findIndex((i) => i.id === view);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (current + 1) % NAV_ITEMS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (current - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = NAV_ITEMS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const target = NAV_ITEMS[next];
    selectTab(target.id, tabRefs.current[next]);
  }

  async function handleRecordCta() {
    if (isBusy) return;
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (err) {
      console.error("Recording action failed:", err);
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="pane flex h-13 min-w-0 shrink-0 items-center justify-between gap-2 rounded-t-lg border-b border-subtle px-2 select-none min-[720px]:gap-3 min-[720px]:px-4"
    >
      {/* Left zone: CSD Window control dots + App Logo + Title */}
      {showWindowControls ? (
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3">
          {/* Window control dots */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Close window"
              title="Close"
              onClick={() => void handleClose()}
              className="group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-hidden"
            >
              <span className="flex h-3 w-3 items-center justify-center rounded-full csd-dot-close">
                <X
                  size={8}
                  strokeWidth={2.5}
                  className="text-black/70 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </span>
            </button>
            <button
              type="button"
              aria-label="Minimize window"
              title="Minimize"
              onClick={() => void handleMinimize()}
              className="group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-hidden"
            >
              <span className="flex h-3 w-3 items-center justify-center rounded-full csd-dot-min">
                <Minus
                  size={8}
                  strokeWidth={2.5}
                  className="text-black/70 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </span>
            </button>
            <button
              type="button"
              aria-label="Maximize window"
              title="Maximize"
              onClick={() => void handleMaximize()}
              className="group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-hidden"
            >
              <span className="flex h-3 w-3 items-center justify-center rounded-full csd-dot-max">
                <Maximize2
                  size={7}
                  strokeWidth={2.5}
                  className="text-black/70 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </span>
            </button>
          </div>

          {/* Brand identity */}
          <div data-tauri-drag-region className="ml-1 flex items-center gap-2">
            <span className="app-mark" aria-hidden="true" />
            <span
              data-tauri-drag-region
              className="hidden truncate text-body-sm font-medium text-text-primary min-[1280px]:inline"
            >
              Screen Studio Pro
            </span>
          </div>
        </div>
      ) : (
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3" />
      )}

      {/* Center zone: 3-tab segmented view capsule */}
      <nav className="flex flex-none justify-center" aria-label="Primary">
        <div
          role="tablist"
          aria-label="Views"
          onKeyDown={onKeyDown}
          className="flex h-10 items-center gap-1 rounded-full border border-subtle bg-solid/60"
        >
          {NAV_ITEMS.map((item, idx) => {
            const active = item.id === view;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                id={`view-tab-${item.id}`}
                aria-controls="main-workspace"
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(item.id)}
                className={`relative flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-body-sm font-medium outline-none transition-[color,background-color,scale] duration-fast ease-fast motion-reduce:scale-none enabled:active:scale-[0.98] min-[720px]:gap-2 min-[720px]:px-3 ${
                  active
                    ? "text-ink"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="active-view-tab"
                    aria-hidden="true"
                    className="absolute inset-0 z-base rounded-full border border-subtle bg-surface-solid shadow-xs"
                    transition={{ duration: MOTION.base, ease: MOTION.easeBase }}
                  />
                ) : null}
                <Icon
                  size={16}
                  strokeWidth={active ? 2 : 1.5}
                  className="relative z-sticky shrink-0"
                  aria-hidden="true"
                />
                <span className="relative z-sticky">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Right zone: Telemetry pill badge + 40px Primary Record pill CTA */}
      <div className="flex flex-1 items-center justify-end gap-3">
        {/* Telemetry badge */}
        <div
          className="hidden min-w-0 items-center gap-1.5 rounded-full border border-subtle bg-solid/60 px-2.5 py-1 font-mono text-mono-sm text-text-secondary shadow-xs select-none min-[1280px]:flex"
          title="Active recording format and hardware encoder"
          aria-label={`Telemetry: ${telemetryText}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          <span>{telemetryText}</span>
        </div>

        {/* 40px Primary Record Pill CTA Button */}
        <Button
          variant="primary"
          aria-label={isRecording ? "Stop recording" : "Record"}
          title={isRecording ? "Stop recording" : "Start recording"}
          disabled={isBusy}
          onClick={() => void handleRecordCta()}
          className={`shrink-0 rounded-full px-3 min-[720px]:px-4 ${
            isRecording ? "border-signal bg-signal text-white hover:bg-signal/90" : ""
          }`}
        >
          {isRecording ? (
            <>
              <span
                className="h-1.5 w-1.5 animate-pulse-rec rounded-full bg-white motion-reduce:animate-none"
                aria-hidden="true"
              />
              <Square size={14} className="fill-current" aria-hidden="true" />
              <span className="font-mono text-mono-sm tabular-nums">
                {formatElapsed(session.elapsedMs)}
              </span>
              <span className="text-body-sm font-medium">Stop</span>
            </>
          ) : (
            <>
              <Video size={16} strokeWidth={2} aria-hidden="true" />
              <span className="text-body-sm font-medium">
                {isStarting ? "Starting..." : isStopping ? "Stopping..." : "Record"}
              </span>
            </>
          )}
        </Button>
      </div>
    </header>
  );
}
