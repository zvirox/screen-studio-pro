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

/* DESIGN.md v6.0 — Linear Navigation Strip (flat opaque surface, 1px hairline border).
   - Center: 3-tab view switcher (Record | Library | Settings) with keyboard roving, 6px radius.
   - Right: crisp status chip (resolution/fps/encoder) + primary Record CTA button. */

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
      className="flex h-12 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 select-none min-[720px]:gap-3 min-[720px]:px-4"
    >
      {/* Left zone: optional fallback window controls for standalone preview + brand identity */}
      {showWindowControls ? (
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
          <div data-tauri-drag-region className="flex items-center gap-2">
            <span className="app-mark" aria-hidden="true" />
            <span
              data-tauri-drag-region
              className="hidden truncate text-body-sm font-medium text-[var(--text)] min-[1024px]:inline"
            >
              Screen Studio Pro
            </span>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              aria-label="Minimize window"
              title="Minimize"
              onClick={() => void handleMinimize()}
              className="flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Maximize window"
              title="Maximize"
              onClick={() => void handleMaximize()}
              className="flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Maximize2 size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Close window"
              title="Close"
              onClick={() => void handleClose()}
              className="flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-muted)] hover:bg-[var(--close-hover)] hover:text-[var(--text)] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3" />
      )}

      {/* Center zone: 3-tab flat segmented view bar */}
      <nav className="flex flex-none justify-center" aria-label="Primary">
        <div
          role="tablist"
          aria-label="Views"
          onKeyDown={onKeyDown}
          className="flex h-9 items-center gap-1 rounded-sm border border-[var(--border)] bg-[var(--bg-surface-2)] p-0.5"
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
                className={`relative flex h-8 items-center gap-1.5 rounded-xs px-2.5 text-body-sm font-medium outline-none transition-colors duration-150 ease-out min-[720px]:gap-2 min-[720px]:px-3 ${
                  active
                    ? "text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="active-view-tab"
                    aria-hidden="true"
                    className="absolute inset-0 z-base rounded-xs border border-[var(--border)] bg-[var(--bg-active)]"
                    transition={{ duration: MOTION.base, ease: MOTION.easeBase }}
                  />
                ) : null}
                <Icon
                  size={15}
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

      {/* Right zone: Status chip + Record CTA button */}
      <div className="flex flex-1 items-center justify-end gap-2.5">
        <div
          className="hidden min-w-0 items-center gap-1.5 rounded-xs border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-1 font-mono text-mono-sm text-[var(--text-muted)] select-none min-[1024px]:flex"
          title="Active recording format and encoder"
          aria-label={`Telemetry: ${telemetryText}`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-success" /* linear-exception: dot */
            aria-hidden="true"
          />
          <span>{telemetryText}</span>
        </div>

        {/* Record / Stop CTA (Studio Burgundy / Broadcast Signal Red recording-only exception) */}
        <Button
          variant="brand"
          size="md"
          aria-label={isRecording ? "Stop recording" : "Record"}
          title={isRecording ? "Stop recording" : "Start recording"}
          disabled={isBusy}
          onClick={() => void handleRecordCta()}
          className="shrink-0 rounded-sm px-3 min-[720px]:px-3.5"
        >
          {isRecording ? (
            <>
              <span
                className="h-1.5 w-1.5 animate-pulse-rec rounded-full bg-record-text motion-reduce:animate-none" /* linear-exception: dot */
                aria-hidden="true"
              />
              <Square size={13} className="fill-current" aria-hidden="true" />
              <span className="font-mono text-mono-sm tabular-nums">
                {formatElapsed(session.elapsedMs)}
              </span>
              <span className="text-body-sm font-medium">Stop</span>
            </>
          ) : (
            <>
              <Video size={15} strokeWidth={1.75} aria-hidden="true" />
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
