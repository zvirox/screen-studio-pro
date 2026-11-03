import SourceDeck from "./SourceDeck";
import AudioStrip from "./AudioStrip";
import ActionRow from "./ActionRow";

/* §6.1 Record view — 2.2: source deck (monitor) + audio strip (two
   channel cards, meters at the §3 cadence) + action row. The camera slab
   (M5) joins when its feature lands; dead placeholder panels never render
   (§6.3 education law). Session events flow through
   hooks/useRecordingState, mounted once at the App root, so the
   projection keeps updating across views. */

export default function RecordView() {
  return (
    <div className="flex flex-col gap-4">
      <SourceDeck />
      <AudioStrip />
      <ActionRow />
    </div>
  );
}
