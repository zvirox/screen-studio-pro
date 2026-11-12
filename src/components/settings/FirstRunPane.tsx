import React, { useState, useEffect } from "react";
import { ChevronRight, Monitor, Mic, ShieldAlert } from "lucide-react";
import { useSspStore } from "../../lib/store";

/* §6.4 First-run education moments (§6.3). Three education surfaces:

   1. Preview-not-granted slot — SourceDeck education slot (§6.3 empty
      states).
   2. Mic silent hint — AudioStrip "Speak to test your mic level" (§6.3).
   3. Capability transparency panel — AboutPane "Capabilities" section
      (§6.4 About pane, PRD risk mitigation).

   This pane surfaces all three together for first-run users and lets them
   mark first run as complete. After completion, firstRunCompleted is
   persisted via prefs_set (§2.6) so the education won't reappear. */

export default function FirstRunPane() {
  const firstRunCompleted = useSspStore((s) => s.prefs.firstRunCompleted);
  const loadFirstRunCompleted = useSspStore((s) => s.loadFirstRunCompleted);
  const setFirstRunCompleted = useSspStore((s) => s.setFirstRunCompleted);
  const [completed, setCompleted] = useState<boolean | null>(null);

  // Mount-once: load the persisted flag.
  useEffect(() => {
    void loadFirstRunCompleted();
    setCompleted(firstRunCompleted);
  }, [loadFirstRunCompleted, firstRunCompleted]);

  return (
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <div className="flex items-center gap-3">
        <ShieldAlert size={20} strokeWidth={1.5} aria-hidden="true" />
        <h1 className="text-display-md">First run</h1>
      </div>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Welcome to ScreenStudio Pro. These three education moments will help
        you make your first recording in under 60 seconds.
      </p>

      {!completed && (
        <section className="mt-6 space-y-4">
          <h2 className="text-heading text-ink">Education states</h2>

          <div className="flex flex-col gap-3">
            <EducationItem
              icon={<Monitor size={16} strokeWidth={1.5} />}
              label="Choose a capture source"
              description={
                "In the Record tab, click Monitor (or Window/Region) to open a " +
                "capture session. The preview frame will show a live still once " +
                "the compositor grants permission."
              }
            />
            <EducationItem
              icon={<Mic size={16} strokeWidth={1.5} />}
              label="Test your microphone"
              description={
                "In the Audio tab, enable the microphone channel. Speak and watch " +
                "the level bar move — that's post-gain audio, exactly what " +
                "lands in the recording."
              }
            />
            <EducationItem
              icon={<ShieldAlert size={16} strokeWidth={1.5} />}
              label="Check runtime capabilities"
              description={
                "In the About tab, review what your compositor supports: " +
                "screencast capture, global shortcuts, and window capture."
              }
            />
          </div>
        </section>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setCompleted(true);
            void setFirstRunCompleted(true);
          }}
          disabled={completed === true}
          className={`flex items-center gap-2 rounded-sm border border-subtle bg-solid px-4 py-2 text-body-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            completed ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-accent-muted"
          }`}
        >
          <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          {completed ? "First run complete" : "I've reviewed these"}
        </button>
      </div>
    </section>
  );
}

function EducationItem({
  icon,
  label,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-sm border border-subtle bg-solid">
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1">
        <p className="text-body-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-secondary">{description}</p>
      </div>
    </div>
  );
}
