import { useEffect, useRef, useState } from "react";
import {
  SlidersHorizontal,
  Mic,
  Video,
  FileText,
  Keyboard,
  Info,
  AlertTriangle,
} from "lucide-react";
import { useSspStore } from "../../lib/store";
import CameraPane from "./CameraPane";
import CapturePane from "./CapturePane";
import AudioPane from "./AudioPane";
import FilesPane from "./FilesPane";
import ShortcutsPane from "./ShortcutsPane";
import AboutPane from "./AboutPane";
import FirstRunPane from "./FirstRunPane";

/* DESIGN.md v3.1 §6.4 / §6.0 Settings shell:
   a real 200px left rail on standard/wide (own vertical scroll), a
   horizontally scrollable pill row on compact, and ONE content scroll owner
   with a single max-w-[560px] wrapper. No nested <main>; panes never
   re-wrap themselves (their v1.0 wrappers are removed in Stage 3).
   Active tab = surface step + hairline + text.primary; icons are 16px lucide 1.5px. */

const RAIL_ITEMS: Array<{
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}> = [
  { id: "firstRun", label: "First Run", icon: AlertTriangle },
  { id: "capture", label: "Capture", icon: SlidersHorizontal },
  { id: "audio", label: "Audio", icon: Mic },
  { id: "camera", label: "Camera", icon: Video },
  { id: "files", label: "Files", icon: FileText },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
];

const PANES: Record<string, React.ComponentType> = {
  capture: CapturePane,
  audio: AudioPane,
  camera: CameraPane,
  files: FilesPane,
  shortcuts: ShortcutsPane,
  about: AboutPane,
  firstRun: FirstRunPane,
};

function tabId(id: string): string {
  return `settings-tab-${id}`;
}

function panelId(id: string): string {
  return `settings-panel-${id}`;
}

export default function SettingsView() {
  const view = useSspStore((s) => s.view);
  const setView = useSspStore((s) => s.setView);
  const loadCaptureSettings = useSspStore((s) => s.loadCaptureSettings);
  const loadFilesSettings = useSspStore((s) => s.loadFilesSettings);
  const loadShortcutsSettings = useSspStore((s) => s.loadShortcutsSettings);
  const loadFirstRunCompleted = useSspStore((s) => s.loadFirstRunCompleted);
  const [activeTab, setActiveTab] = useState("camera");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Load settings sections when their tab first becomes active.
  useEffect(() => {
    switch (activeTab) {
      case "capture":
        void loadCaptureSettings();
        break;
      case "files":
        void loadFilesSettings();
        break;
      case "shortcuts":
        void loadShortcutsSettings();
        break;
      case "firstRun":
        void loadFirstRunCompleted();
        break;
    }
  }, [
    activeTab,
    loadCaptureSettings,
    loadFilesSettings,
    loadShortcutsSettings,
    loadFirstRunCompleted,
  ]);

  const selectTab = (index: number, moveFocus = false) => {
    const nextTab = RAIL_ITEMS[index];
    if (!nextTab) return;
    setActiveTab(nextTab.id);
    if (moveFocus) tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % RAIL_ITEMS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + RAIL_ITEMS.length) % RAIL_ITEMS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = RAIL_ITEMS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(nextIndex, true);
  };

  const Pane = PANES[activeTab as keyof typeof PANES];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col min-[720px]:flex-row">
      <nav
        aria-label="Settings sections"
        role="tablist"
        className="flex min-w-0 max-w-full shrink-0 gap-1 overflow-x-auto border-b border-subtle px-3 py-2
          min-[720px]:w-52 min-[720px]:flex-col min-[720px]:overflow-y-auto min-[720px]:border-b-0 min-[720px]:border-r min-[720px]:py-4"
      >
        {RAIL_ITEMS.map((item, index) => {
          const active = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId(item.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(item.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`flex h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-sm border px-3 py-1.5 text-body-sm transition-colors duration-fast ease-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                ${
                  active
                    ? "border-subtle bg-surface-solid text-ink"
                    : "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink"
                }`}
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-raised">
        {RAIL_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <div
              key={item.id}
              id={panelId(item.id)}
              role="tabpanel"
              aria-labelledby={tabId(item.id)}
              hidden={!active}
              tabIndex={0}
              className="mx-auto flex min-h-full w-full min-w-0 max-w-[560px] flex-col justify-center p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent min-[480px]:p-5 min-[720px]:p-6"
            >
              {active ? (
                <>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <h1 className="min-w-0 max-w-full wrap-anywhere text-display-md">
                      {itemLabel(item.id)}
                    </h1>
                    {view !== "record" && (
                      <button
                        type="button"
                        onClick={() => setView("record")}
                        className="min-h-9 rounded-sm px-2 text-label font-medium text-ink-secondary hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        Go to Record
                      </button>
                    )}
                  </div>
                  <Pane />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function itemLabel(id: string): string {
  return RAIL_ITEMS.find((item) => item.id === id)?.label ?? id;
}
