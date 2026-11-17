import { useState } from "react";
import { VideoOff } from "lucide-react";
import { useSspStore } from "../../lib/store";
import { Switch } from "../ui/switch";

/* §6.4 Settings — Camera pane (4.4). Toggles camera self-insert
   (4.3): when on, the open camera's PiP is composited into the encoded
   video at its UI position; when off, the PiP is preview-only. Shows the
   current camera device + status so the user knows self-insert applies. */

export default function CameraPane() {
  const capture = useSspStore((s) => s.settings.capture);
  const camera = useSspStore((s) => s.camera);
  const setCameraSelfInsert = useSspStore((s) => s.setCameraSelfInsert);

  const selfInsert = capture?.cameraSelfInsert ?? false;
  const [toggling, setToggling] = useState(false);

  return (
    <section>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Add a webcam from the Record tab, then choose whether its PiP frame is baked into the
        recording.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <VideoOff size={18} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p className="text-body-sm font-medium text-ink">Self-insert camera in recording</p>
            <p className="text-xs text-ink-secondary">
              When on, the camera PiP is composited into the recorded file at its frame position.
              Preview-only when off.
            </p>
          </div>
        </div>
        <Switch
          aria-label="Self-insert camera in recording"
          checked={selfInsert}
          disabled={toggling || camera.status === "idle"}
          onCheckedChange={() => {
            setToggling(true);
            void setCameraSelfInsert(!selfInsert).finally(() => setToggling(false));
          }}
        />
      </div>

      {camera.status === "idle" && (
        <p className="mt-4 max-w-md text-body-sm text-ink-secondary">
          No camera open — add one from the Record tab to use self-insert.
        </p>
      )}
      {camera.status === "open" && (
        <p className="mt-4 max-w-md text-body-sm text-ink-secondary">
          Camera: {camera.label ?? "Unknown"} ({camera.width}×{camera.height})
        </p>
      )}
    </section>
  );
}
