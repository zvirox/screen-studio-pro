import { useState } from "react";
import { motion } from "framer-motion";
import { Film } from "lucide-react";
import CaptureInspector from "./CaptureInspector";
import SourceDeck from "./SourceDeck";
import AudioMixerDeck from "./AudioMixerDeck";
import TelemetryDeck from "./TelemetryDeck";
import TakesGallery from "./TakesGallery";
import ActionRow from "./ActionRow";
import Button from "../ui/Button";
import { cn } from "../../lib/cn";
import { MOTION } from "../../lib/motion";

/* DESIGN.md v6.0 — canonical tri-panel Linear studio layout at 1120px;
   compact layouts stack vertically while preserving reading order. */
export default function RecordView() {
  const [showTakesOnMobile, setShowTakesOnMobile] = useState(false);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex items-center justify-end min-[1120px]:hidden">
        <Button
          size="sm"
          aria-expanded={showTakesOnMobile}
          aria-controls="takes-gallery-panel"
          aria-label="Toggle recent takes and presets gallery"
          onClick={() => setShowTakesOnMobile((value) => !value)}
        >
          <Film size={16} strokeWidth={1.5} aria-hidden="true" />
          {showTakesOnMobile ? "Hide Takes & Presets" : "Show Takes & Presets"}
        </Button>
      </div>

      <div className="grid w-full min-w-0 grid-cols-1 items-start gap-4 min-[720px]:grid-cols-[280px_minmax(0,1fr)] min-[1120px]:grid-cols-[300px_minmax(0,1fr)_260px]">
        <CaptureInspector />

        <div className="flex min-w-0 flex-col gap-4">
          <SourceDeck hideHeaderChips />
          <AudioMixerDeck />
          <ActionRow />
          <TelemetryDeck />
        </div>

        <motion.div
          id="takes-gallery-panel"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: MOTION.fast, ease: MOTION.easeBase }}
          className={cn(
            "min-w-0 min-[720px]:col-span-2 min-[1120px]:col-span-1",
            showTakesOnMobile ? "block" : "hidden",
            "min-[1120px]:block",
          )}
        >
          <TakesGallery />
        </motion.div>
      </div>
    </div>
  );
}
