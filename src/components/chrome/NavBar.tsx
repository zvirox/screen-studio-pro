import { useRef, type KeyboardEvent } from "react";
import {
  Circle,
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

/* DESIGN.md v3.0 §5.1 Integrated Studio Titlebar (NavBar CSD)
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
  { id: "record", label: "Record", icon: Circle },
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

export default function NavBar() {
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
      className="pane flex h-13 shrink-0 items-center justify-between rounded-t-lg border-b border-subtle px-4 select-none"
    >
      {/* Left zone: CSD Window control dots + App Logo + Title */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3">
        {/* Window control dots */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Close window"
            title="Close"
            onClick={() => void handleClose()}
            className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-hidden"
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
            className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-hidden"
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
            className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-hidden"
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
            className="hidden truncate text-body-sm font-medium text-text-primary min-[720px]:inline"
          >
            ScreenStudio Pro
          </span>
        </div>
      </div>

      {/* Center zone: 3-tab segmented view capsule */}
      <nav className="flex flex-none justify-center" aria-label="Primary">
        <div
          role="tablist"
          aria-label="Views"
          onKeyDown={onKeyDown}
          className="flex h-9 items-center gap-1 rounded-full border border-subtle bg-surface-glass/40 p-1 backdrop-blur-md"
        >
          {NAV_ITEMS.map((item, idx) => {
            const active = item.id === view;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(item.id)}
                className={`relative flex h-7 items-center gap-2 rounded-full px-3.5 text-body-sm font-medium transition-all duration-fast ${
                  active
                    ? "bg-accent-muted text-accent font-semibold shadow-xs"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                <Icon size={14} strokeWidth={active ? 2 : 1.5} aria-hidden="true" />
                <span>{item.label}</span>
                {active ? (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Right zone: Telemetry pill badge + 40px Primary Record pill CTA */}
      <div className="flex flex-1 items-center justify-end gap-3">
        {/* Telemetry badge */}
        <div
          className="flex items-center gap-1.5 rounded-full border border-subtle bg-surface-glass px-2.5 py-1 font-mono text-xs text-text-secondary shadow-xs select-none"
          title="Active recording format and hardware encoder"
          aria-label={`Telemetry: ${telemetryText}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          <span>{telemetryText}</span>
        </div>

        {/* 40px Primary Record Pill CTA Button */}
        <button
          type="button"
          aria-label={isRecording ? "Stop recording" : "Record"}
          title={isRecording ? "Stop recording" : "Start recording"}
          disabled={isBusy}
          onClick={() => void handleRecordCta()}
          className={`flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 font-medium transition-all shadow-elev-1 select-none disabled:pointer-events-none disabled:opacity-60 ${
            isRecording
              ? "bg-signal text-white animate-pulse motion-reduce:animate-none hover:bg-signal/90"
              : "bg-accent text-accent-text hover:bg-accent-hover active:bg-accent-active"
          }`}
        >
          {isRecording ? (
            <>
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
        </button>
      </div>
    </header>
  );
}
