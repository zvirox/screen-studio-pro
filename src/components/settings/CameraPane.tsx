import { useState } from "react";
import { VideoOff } from "lucide-react";
import { useSspStore } from "../../lib/store";

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
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <h1 className="text-display-md">Camera</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Add a webcam from the Record tab, then choose whether its PiP frame
        is baked into the recording.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <VideoOff size={18} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p className="text-body-sm font-medium text-ink">Self-insert camera in recording</p>
            <p className="text-xs text-ink-secondary">
              When on, the camera PiP is composited into the recorded file at
              its frame position. Preview-only when off.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Self-insert camera in recording"
          aria-checked={selfInsert}
          disabled={toggling || camera.status === "idle"}
          onClick={() => {
            setToggling(true);
            void setCameraSelfInsert(!selfInsert).finally(() => setToggling(false));
          }}
          className={`
            inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
            ${selfInsert ? "bg-accent" : "bg-solid"}
            ${toggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
          `}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white transition-transform
              ${selfInsert ? "translate-x-8" : "translate-x-2"}`}
            aria-hidden="true"
          />
        </button>
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
