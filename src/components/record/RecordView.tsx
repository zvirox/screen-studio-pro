import SourceDeck from "./SourceDeck";
import AudioStrip from "./AudioStrip";
import CameraSlab from "./CameraSlab";
import ActionRow from "./ActionRow";

/* DESIGN.md v2.0 §6.1 — the Record workspace: source deck + square preview
   in the main column, audio strip and camera slab in a 320px side rail on
   standard/wide; compact stacks the rail below the preview. The action row
   stays full width at the bottom. Session events flow through
   hooks/useRecordingState, mounted once at the App root. */

export default function RecordView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 min-[720px]:grid-cols-[minmax(0,1fr)_320px]">
        <SourceDeck />
        <div className="flex flex-col gap-6">
          <AudioStrip />
          <CameraSlab />
        </div>
      </div>
      <ActionRow />
    </div>
  );
}
