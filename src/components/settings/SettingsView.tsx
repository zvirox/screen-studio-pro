import { useEffect, useState } from "react";
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

/* DESIGN.md v2.0 §6.4 / §6.0 Settings shell:
   a real 200px left rail on standard/wide (own vertical scroll), a
   horizontally scrollable pill row on compact, and ONE content scroll owner
   with a single max-w-[560px] wrapper. No nested <main>; panes never
   re-wrap themselves (their v1.0 wrappers are removed in Stage 3).
   Active tab = accent.muted + accent text; icons are 16px lucide 1.5px. */

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

export default function SettingsView() {
  const view = useSspStore((s) => s.view);
  const setView = useSspStore((s) => s.setView);
  const loadCaptureSettings = useSspStore((s) => s.loadCaptureSettings);
  const loadFilesSettings = useSspStore((s) => s.loadFilesSettings);
  const loadShortcutsSettings = useSspStore((s) => s.loadShortcutsSettings);
  const loadFirstRunCompleted = useSspStore((s) => s.loadFirstRunCompleted);
  const [activeTab, setActiveTab] = useState("camera");

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

  const Pane = PANES[activeTab as keyof typeof PANES];

  return (
    <section className="flex h-full min-h-0 flex-col min-[720px]:flex-row">
      <nav
        aria-label="Settings sections"
        role="tablist"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-subtle px-3 py-2
          min-[720px]:w-52 min-[720px]:flex-col min-[720px]:overflow-y-auto min-[720px]:border-b-0 min-[720px]:border-r min-[720px]:py-4"
      >
        {RAIL_ITEMS.map((item) => {
          const active = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(item.id)}
              className={`flex h-10 shrink-0 items-center gap-2.5 rounded-sm px-3 py-1.5 text-body-sm transition-colors duration-fast ease-fast
                ${
                  active
                    ? "bg-accent-muted font-medium text-accent"
                    : "text-ink-secondary hover:bg-solid hover:text-ink"
                }`}
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto bg-raised">
        <div className="mx-auto max-w-[560px] p-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-display-md">{itemLabel(activeTab)}</h1>
            {view !== "record" && (
              <button
                type="button"
                onClick={() => setView("record")}
                className="text-label font-medium text-accent hover:underline"
              >
                Go to Record
              </button>
            )}
          </div>
          <Pane />
        </div>
      </div>
    </section>
  );
}

function itemLabel(id: string): string {
  return RAIL_ITEMS.find((item) => item.id === id)?.label ?? id;
}
