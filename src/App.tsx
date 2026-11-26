import { motion, MotionConfig } from "framer-motion";
import { useEffect } from "react";
import tauriConf from "../src-tauri/tauri.conf.json";
import NavBar from "./components/chrome/NavBar";
import ToastHost from "./components/chrome/ToastHost";
import RecordView from "./components/record/RecordView";
import LibraryGrid from "./components/library/LibraryGrid";
import SettingsView from "./components/settings/SettingsView";
import { TitleBar } from "./components/linear/TitleBar";
import { useHudWindow } from "./hooks/useHudWindow";
import { useRecordingState } from "./hooks/useRecordingState";
import { formatElapsed } from "./lib/format";
import { MOTION } from "./lib/motion";
import { useSspStore, type ViewId } from "./lib/store";

/* App shell — TitleBar + NavBar + view router (ARCHITECTURE §2; DESIGN.md v6.0).
   One scroll owner per surface: Record owns its scroll in <main>;
   Library and Settings own theirs inside their view root. */

const enter = {
  initial: { y: MOTION.revealY, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: MOTION.base, ease: MOTION.easeBase },
};

const SELF_SCROLLING_VIEWS: ViewId[] = ["library", "settings"];

function RecordingTitleIndicator() {
  const status = useSspStore((s) => s.session.status);
  const paused = useSspStore((s) => s.session.paused);
  const elapsedMs = useSspStore((s) => s.session.elapsedMs);

  if (status !== "recording") return null;

  return (
    <span
      role="status"
      aria-label={paused ? "Recording paused" : "Recording live"}
      className="inline-flex items-center gap-1.5 rounded-xs border border-[var(--border)] bg-raised px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-signal"
    >
      <span
        className={`size-1.5 rounded-full bg-signal ${paused ? "" : "animate-pulse-rec motion-reduce:animate-none"}`} /* linear-exception: dot */
        aria-hidden="true"
      />
      <span>{paused ? "PAUSED" : "REC"}</span>
      <span>{formatElapsed(elapsedMs)}</span>
    </span>
  );
}

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
          title={tauriConf.productName ?? "Screen Studio Pro"}
          version={`v${tauriConf.version ?? "0.1.0-beta.1"}`}
          icon={<img src="/logo.png" alt="SSP" className="size-4 object-contain" />}
          recordingIndicator={<RecordingTitleIndicator />}
        />
        <NavBar showWindowControls={false} />
        <main
          id="main-workspace"
          role="tabpanel"
          aria-labelledby={`view-tab-${view}`}
          className={`min-h-0 min-w-0 flex-1 ${
            selfScrolling ? "overflow-hidden" : "overflow-y-auto p-3 min-[720px]:p-4"
          }`}
        >
          <motion.div key={view} {...enter} className={selfScrolling ? "h-full" : undefined}>
            {view === "record" ? (
              <RecordView />
            ) : view === "library" ? (
              <LibraryGrid />
            ) : (
              <SettingsView />
            )}
          </motion.div>
        </main>
        <ToastHost />
      </div>
    </MotionConfig>
  );
}
