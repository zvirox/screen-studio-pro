import { useEffect, useState } from "react";
import { SlidersHorizontal, Mic, Video, FileText, Keyboard, Info } from "lucide-react";
import { useSspStore } from "../../lib/store";
import CameraPane from "./CameraPane";
import PaneStub from "./PaneStub";

/* §6.4 Settings — left rail 200px with compact pills (Capture / Audio /
   Camera / Files / Shortcuts / About), content bg.raised max-width 560px.
   Every row: label + description + control right-aligned; active pill =
   accent.muted + accent text. Only Camera is wired (4.4); the rest are
   stubs until their phases. */

const RAIL_ITEMS: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }> = [
  { id: "capture", label: "Capture", icon: SlidersHorizontal },
  { id: "audio", label: "Audio", icon: Mic },
  { id: "camera", label: "Camera", icon: Video },
  { id: "files", label: "Files", icon: FileText },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
];

export default function SettingsView() {
  const view = useSspStore((s) => s.view);
  const setView = useSspStore((s) => s.setView);
  const loadCaptureSettings = useSspStore((s) => s.loadCaptureSettings);
  const [activeTab, setActiveTab] = useState("camera");

  // 4.4: load capture settings when the settings view mounts so the Camera
  // pane reads the current camera_self_insert value.
  useEffect(() => {
    void loadCaptureSettings();
  }, [loadCaptureSettings]);

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
          {activeTab === "camera" && (
            <div className="flex justify-between items-start gap-4">
              <h1 className="text-display-md">Camera</h1>
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
          )}
          {activeTab === "camera" ? (
            <CameraPane />
          ) : (
            <PaneStub id={activeTab} />
          )}
        </section>
      </main>
    </section>
  );
}
