import { motion } from "framer-motion";
import NavBar from "./components/chrome/NavBar";
import { useUiStore, type ViewId } from "./lib/store";

/* App shell — NavBar + view router (ARCHITECTURE §2).
   The panels below are 0.4 skeletons; the real views land feature-by-feature
   (SourceDeck in M1, LibraryGrid in M5+, SettingsView in Phase 5). */

// §4.6 m.base: enter is y +6→0, opacity 0→1; reduced-motion drops to opacity-only via tailwind.css
const enter = {
  initial: { y: 6, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: 0.18, ease: [0.34, 1.56, 0.64, 1] as const },
};

function ViewStub({ title, note }: { title: string; note: string }) {
  return (
    <motion.section {...enter} className="pane rounded-md p-5">
      <h1 className="text-display-md">{title}</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">{note}</p>
    </motion.section>
  );
}

const STUB_NOTES: Record<ViewId, string> = {
  record: "Source deck, audio strip, camera slab and the record action arrive with F-M1 (monitor capture).",
  library: "The recordings grid lands with the library feature — seeded from the SQLite index (task 0.8).",
  settings: "Settings panes (capture, audio, camera, files, shortcuts, about) arrive with the settings store (task 0.7).",
};

export default function App() {
  const view = useUiStore((s) => s.view);

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <NavBar />
      <main role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-6">
        <motion.div key={view} {...enter}>
          <ViewStub
            title={view.charAt(0).toUpperCase() + view.slice(1)}
            note={STUB_NOTES[view]}
          />
        </motion.div>
      </main>
    </div>
  );
}
