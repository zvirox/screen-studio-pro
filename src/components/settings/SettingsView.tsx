import { useEffect, useState } from "react";
import { SlidersHorizontal, Mic, Video, FileText, Keyboard, Info, AlertTriangle } from "lucide-react";
import { useSspStore } from "../../lib/store";
import CameraPane from "./CameraPane";
import CapturePane from "./CapturePane";
import AudioPane from "./AudioPane";
import FilesPane from "./FilesPane";
import ShortcutsPane from "./ShortcutsPane";
import AboutPane from "./AboutPane";
import FirstRunPane from "./FirstRunPane";

/* §6.4 Settings — left rail 200px with compact pills (Capture / Audio /
   Camera / Files / Shortcuts / About), content bg.raised max-width 560px.
   Every row: label + description + control right-aligned; active pill =
   accent.muted + accent text. Only Camera was wired (4.4); all six panes
   are wired in 6.1. */

const RAIL_ITEMS: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }> = [
  { id: "capture", label: "Capture", icon: SlidersHorizontal },
  { id: "audio", label: "Audio", icon: Mic },
  { id: "camera", label: "Camera", icon: Video },
  { id: "files", label: "Files", icon: FileText },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
  { id: "firstRun", label: "First Run", icon: AlertTriangle },
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
  }, [activeTab, loadCaptureSettings, loadFilesSettings, loadShortcutsSettings, loadFirstRunCompleted]);

  const Pane = PANES[activeTab as keyof typeof PANES];

  return (
    <section className="flex flex-col h-full">
      <nav className="flex-shrink-0 w-52 flex flex-col gap-1 px-3 py-4 border-r border-subtle">
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
              className={`flex items-center gap-2.5 h-10 px-3 py-1.5 rounded-sm text-body-sm transition-colors
                ${active ? "bg-accent-muted text-accent font-medium" : "text-ink-secondary hover:bg-solid hover:text-ink"}
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="flex-1 overflow-y-auto bg-raised p-6">
        <section className="max-w-[560px]">
          <div className="flex justify-between items-start gap-4">
            <h1 className="text-display-md">
              {itemLabel(activeTab)}
            </h1>
            {view !== "record" && (
              <button
                type="button"
                onClick={() => setView("record")}
                className="text-xs text-accent font-medium hover:underline"
              >
                Go to Record
              </button>
            )}
          </div>
          <Pane />
        </section>
      </main>
    </section>
  );
}

function itemLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
