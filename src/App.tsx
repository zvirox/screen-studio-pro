import { motion, MotionConfig } from "framer-motion";
import { useEffect } from "react";
import NavBar from "./components/chrome/NavBar";
import ToastHost from "./components/chrome/ToastHost";
import RecordView from "./components/record/RecordView";
import LibraryGrid from "./components/library/LibraryGrid";
import SettingsView from "./components/settings/SettingsView";
import { useHudWindow } from "./hooks/useHudWindow";
import { useRecordingState } from "./hooks/useRecordingState";
import { useSspStore, type ViewId } from "./lib/store";
import { MOTION } from "./lib/motion";
import { TitleBar } from "./components/linear/TitleBar";

/* App shell — NavBar + view router (ARCHITECTURE §2; DESIGN.md v3.1).
   The session-event hook mounts once here (§4.1: the event stream is the
   state sync, so projections keep updating on any view). useHudWindow is
   the spawn side of the §5.9 HUD float: main hears recording/started and
   owns the child through Stop, including late creation. ToastHost (§5.6)
   sits above every view — faults and the saved toast are floatover-level
   surface, not view content.
   DESIGN.md v2.0 §6.0: exactly one scroll owner per surface. Record owns
   its scroll here; Library and Settings own theirs inside their surface,
   so this shell is overflow-hidden for those views (no double scroll). */

// §4.6 m.reveal (m.base): y +6→0, opacity 0→1. JS motion honors the user's
// reduced-motion preference via <MotionConfig reducedMotion="user"> below —
// the CSS media rule alone cannot neutralize framer-motion transforms.
const enter = {
  initial: { y: MOTION.revealY, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: MOTION.base, ease: MOTION.easeBase },
};

// Surfaces that bring their own scroll + padding (§6.0).
const SELF_SCROLLING_VIEWS: ViewId[] = ["library", "settings"];

function ViewStub({ title, note }: { title: string; note: string }) {
  return (
    <motion.section {...enter} className="pane rounded-md p-5">
      <h1 className="text-display-md">{title}</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">{note}</p>
    </motion.section>
  );
}

const STUB_NOTES: Record<Exclude<ViewId, "record">, string> = {
  library:
    "The recordings grid lands with the library feature — seeded from the SQLite index (task 0.8).",
  settings: "",
};

export default function App() {
  const view = useSspStore((s) => s.view);
  const loadCapabilities = useSspStore((s) => s.loadCapabilities);
  useRecordingState();
  useHudWindow();

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const selfScrolling = SELF_SCROLLING_VIEWS.includes(view);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col bg-canvas text-ink">
        <TitleBar
          title="Screen Studio Pro"
          version="v0.1.0"
          icon={<img src="/logo.png" alt="SSP" className="size-4 object-contain" />}
        />
        <NavBar showWindowControls={false} />
        <main
          id="main-workspace"
          role="tabpanel"
          aria-labelledby={`view-tab-${view}`}
          className={`min-h-0 min-w-0 flex-1 ${
            selfScrolling ? "overflow-hidden" : "overflow-y-auto p-4 min-[720px]:p-5 min-[1280px]:p-6"
          }`}
        >
          <motion.div key={view} {...enter} className={selfScrolling ? "h-full" : undefined}>
            {view === "record" ? (
              <RecordView />
            ) : view === "library" ? (
              <LibraryGrid />
            ) : view === "settings" ? (
              <SettingsView />
            ) : (
              <ViewStub
                title={
                  (view as unknown as string).charAt(0).toUpperCase() +
                  (view as unknown as string).slice(1)
                }
                note={STUB_NOTES[view as Exclude<ViewId, "record">]}
              />
            )}
          </motion.div>
        </main>
        <ToastHost />
      </div>
    </MotionConfig>
  );
}
