import { useEffect } from "react";
import { ExternalLink, X, Scissors } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useSspStore } from "../../lib/store";

/* §5.7 Modal & Drawer: right-slide drawer (420px), Modal recipe
   (`surface.glass-strong`, `blur(32px)`, `border.subtle` 1px, `elev.2`),
   scrim `rgba(0,0,0,0.4)` + `blur(4px)`, Esc closes, focus trap + restore.
   Implemented with `<dialog>` portaled to document.body so it escapes
   clipping containers. Click = detail drawer with large thumb, full meta
   table (mono values), `Reveal in file manager` secondary action,
   `Trim later` disabled with tooltip "Planned for V2". */

interface RecordingDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function RecordingDrawer({ open, onClose }: RecordingDrawerProps) {
  const recording = useSspStore((s) => s.library.selectedRecording);
  const closeDrawer = useSspStore((s) => s.closeDrawer);

  // Close drawer when the unselected state arrives (e.g. delete while open).
  useEffect(() => {
    if (!open && recording) closeDrawer();
  }, [open, recording, closeDrawer]);

  if (!open || !recording) return null;

  return (
    <dialog
      open={open}
      onClose={onClose}
      className="fixed inset-0 z-50"
      aria-modal="true"
      role="dialog"
      aria-label="Recording details"
    >
      {/* Scrim — closes on click. */}
      <div
        className="absolute inset-0 backdrop-blur-sm bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel — right-slide 420px, Modal recipe. */}
      <div
        className="absolute right-0 top-0 bottom-0 w-[420px] bg-solid border-l border-subtle shadow-[var(--shadow-elev-2)] flex flex-col"
      >
        {/* Header with close. */}
        <div className="flex items-center justify-between p-4 border-b border-subtle">
          <h2 className="text-heading font-medium text-ink">Recording details</h2>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="h-9 w-9 rounded-sm border border-subtle bg-raised flex items-center justify-center text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Body — large thumb + meta table. */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Large thumb (16:9, capped at drawer width). */}
          <div className="aspect-video w-full rounded-lg bg-raised overflow-hidden">
            {recording.thumbPath ? (
              <img
                src={recording.thumbPath}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-ink">
                <ExternalLink size={28} strokeWidth={1.5} className="opacity-50" aria-hidden="true" />
              </div>
            )}
          </div>

          {/* Meta table (mono values). */}
          <table className="w-full text-left text-body-sm divide-y divide-subtle">
            <tbody>
              <tr>
                <td className="py-2 w-1/3 text-label text-ink">File name</td>
                <td className="py-2 text-ink font-medium truncate" title={recording.fileName}>
                  {recording.fileName}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Container</td>
                <td className="py-2 text-mono-sm text-ink font-mono">{recording.container.toUpperCase()}</td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Duration</td>
                <td className="py-2 text-mono-sm text-ink font-mono tabular-nums">
                  {formatDuration(recording.durationMs)}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Resolution</td>
                <td className="py-2 text-mono-sm text-ink font-mono">
                  {recording.width ?? "—"}×{recording.height ?? "—"}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Frame rate</td>
                <td className="py-2 text-mono-sm text-ink font-mono tabular-nums">
                  {recording.fps ?? "—"} fps
                </td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Encoder</td>
                <td className="py-2 text-mono-sm text-ink font-mono">
                  {recording.encoder} {recording.isHwEncoder ? "· HW" : "· SW"}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Size</td>
                <td className="py-2 text-mono-sm text-ink font-mono tabular-nums">
                  {formatSize(recording.sizeBytes)}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-label text-ink">Created</td>
                <td className="py-2 text-mono-sm text-ink font-mono">
                  {new Date(recording.createdAt).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer — actions. */}
        <div className="p-4 border-t border-subtle bg-raised flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Reveal in file manager"
            onClick={() => {
              if (recording.path) void revealItemInDir(recording.path);
            }}
            className="flex items-center gap-2 rounded-sm border border-subtle bg-solid px-3 py-2 text-body-sm text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
            Reveal in file manager
          </button>
          <button
            type="button"
            disabled
            aria-label="Trim later"
            title="Planned for V2"
            className="flex items-center gap-2 rounded-sm border border-subtle bg-solid px-3 py-2 text-body-sm text-ink-disabled cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Scissors size={16} strokeWidth={1.5} aria-hidden="true" />
            Trim later
          </button>
        </div>
      </div>
    </dialog>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(1)} ${units[unitIdx]}`;
}
