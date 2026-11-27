import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { autoconfigRecommend } from "../../lib/ipc";
import { useSspStore } from "../../lib/store";
import type { AutoConfigRecommendation } from "../../types/ipc";
import { LinearButton } from "../linear/LinearButton";
import { LinearCard } from "../linear/LinearCard";

/* 12.3 — first-run auto-configuration wizard. A single calm card over the
   scrim: this machine's recommended encoder + preset (from the backend
   capability probe), one primary action and one quiet skip. Reuses the
   locked Linear components/tokens; no new visual language. */

const PRESET_LABEL: Record<string, string> = {
  youtube: "YouTube · 1080p60",
  discord: "Discord · 720p30",
  lossless: "Lossless local",
  smallest: "Smallest file · 720p30",
};

export default function FirstRunWizard() {
  const setPreset = useSspStore((s) => s.setPreset);
  const setFirstRunCompleted = useSspStore((s) => s.setFirstRunCompleted);
  const [rec, setRec] = useState<AutoConfigRecommendation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void autoconfigRecommend()
      .then((r) => alive && setRec(r))
      .catch(() => alive && setRec(null));
    return () => {
      alive = false;
    };
  }, []);

  const finish = async (useRecommended: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (useRecommended && rec) await setPreset(rec.presetId);
      await setFirstRunCompleted(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="firstrun-title"
    >
      <LinearCard level={2} className="w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[var(--primary-text)]">
          <Sparkles size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="text-xs text-label">First run</span>
        </div>
        <div className="flex flex-col gap-1">
          <h2 id="firstrun-title" className="text-body-lg font-semibold text-[var(--text)]">
            Set up your first recording
          </h2>
          <p className="text-body-sm text-[var(--text-secondary)]">
            {rec
              ? `We picked ${PRESET_LABEL[rec.presetId] ?? rec.presetId} with the ${rec.encoder.toUpperCase()} encoder for this machine.`
              : "Checking this machine's encoders…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LinearButton
            variant="primary"
            disabled={busy || !rec}
            onClick={() => void finish(true)}
          >
            Use recommended
          </LinearButton>
          <LinearButton variant="secondary" disabled={busy} onClick={() => void finish(false)}>
            Skip
          </LinearButton>
        </div>
      </LinearCard>
    </div>
  );
}