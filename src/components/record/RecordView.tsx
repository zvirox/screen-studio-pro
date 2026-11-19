import { useState } from "react";
import { Film } from "lucide-react";
import CaptureInspector from "./CaptureInspector";
import SourceDeck from "./SourceDeck";
import AudioMixerDeck from "./AudioMixerDeck";
import TakesGallery from "./TakesGallery";
import ActionRow from "./ActionRow";
import { cn } from "../../lib/cn";

/* DESIGN.md v3.0 §6 — Wide-Window Tri-Panel Floating Island Studio Architecture
   Left: Capture & Device Inspector (300px fixed width on >=1120px)
   Center: Hero 16:9 Canvas (SourceDeck) + Sub-Canvas Audio Mixer Deck (AudioMixerDeck)
   Right: Recent Takes & Presets Gallery (260px fixed width, collapsible on <1120px)
   Bottom: Action Row (Recording controls region) for direct action reachability
*/

export default function RecordView() {
  const [showTakesOnMobile, setShowTakesOnMobile] = useState(false);

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Mobile/Tablet Toggle for Takes Gallery (<1120px) */}
      <div className="flex min-[1120px]:hidden items-center justify-end">
        <button
          type="button"
          aria-expanded={showTakesOnMobile}
          aria-label="Toggle recent takes and presets gallery"
          onClick={() => setShowTakesOnMobile((prev) => !prev)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-sm border px-3 text-body-sm font-medium transition-colors",
            showTakesOnMobile
              ? "border-accent bg-accent-muted text-accent"
              : "border-subtle bg-solid text-ink hover:border-accent hover:bg-accent-muted",
            "focus-visible:outline-2 focus-visible:outline-accent",
          )}
        >
          <Film size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>{showTakesOnMobile ? "Hide Takes & Presets" : "Show Takes & Presets"}</span>
        </button>
      </div>

      {/* Tri-Panel Studio Grid */}
      <div className="flex flex-col min-[1120px]:flex-row gap-5 items-start w-full">
        {/* Left: Floating Capture Inspector Deck (300px) */}
        <CaptureInspector />

        {/* Center: Hero 16:9 Canvas + Sub-Canvas Audio Mixer Deck */}
        <div className="flex flex-1 min-w-0 flex-col gap-5 w-full">
          <SourceDeck hideHeaderChips />
          <AudioMixerDeck />
        </div>

        {/* Right: Floating Takes & Presets Gallery (260px) */}
        <div
          className={cn(
            "w-full min-[1120px]:w-[260px] shrink-0",
            !showTakesOnMobile && "hidden min-[1120px]:block",
          )}
        >
          <TakesGallery />
        </div>
      </div>

      {/* Accessible Bottom Action Row */}
      <ActionRow />
    </div>
  );
}
