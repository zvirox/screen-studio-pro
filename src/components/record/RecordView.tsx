import SourceDeck from "./SourceDeck";
import ActionRow from "./ActionRow";

/* §6.1 Record view — 1.5 slice: source deck (monitor) + action row.
   The audio strip (M4) and camera slab (M5) sections join when their
   features land; dead placeholder panels never render (§6.3 education
   law). Session events flow through hooks/useRecordingState, mounted
   once at the App root, so the projection keeps updating across views. */

export default function RecordView() {
  return (
    <div className="flex flex-col gap-4">
      <SourceDeck />
      <ActionRow />
    </div>
  );
}
