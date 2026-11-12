import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { useSspStore } from "../../lib/store";

/* §5.1 Buttons: danger (destructive only — delete recording; `error`
   border + text on hover fills `error.muted`). §5.7 Modal & Drawer:
   centered `<dialog>` portaled to document.body (overlays escape clipping
   containers), Modal recipe (`surface.glass-strong`, `blur(32px)`,
   `border.subtle` 1px, `elev.2`, `r.lg`, max-width 480px), scrim
   `rgba(0,0,0,0.4)` + `blur(4px)`, Esc closes, mandatory focus trap via
   native `<dialog>` semantics, restore focus on close. */

interface DeleteConfirmProps {
  open: boolean;
  recordingName: string;
  recordingId: number;
  onConfirm: (id: number) => void;
  onClose: () => void;
}

export default function DeleteConfirm({
  open,
  recordingName,
  recordingId,
  onConfirm,
  onClose,
}: DeleteConfirmProps) {
  const deleteRecording = useSspStore((s) => s.deleteRecording);

  // Close when the unselected state arrives (e.g. another delete started).
  useEffect(() => {
    if (!open) onClose();
  }, [open, onClose]);

  const handleConfirm = async () => {
    await deleteRecording(recordingId);
    onConfirm(recordingId);
    onClose();
  };

  if (!open) return null;

  return (
    <dialog
      open={open}
      onClose={onClose}
      className="fixed inset-0 z-50"
      aria-modal="true"
      role="dialog"
      aria-label="Delete recording"
    >
      {/* Scrim — closes on click. */}
      <div
        className="absolute inset-0 backdrop-blur-sm bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Modal panel — centered, Modal recipe. */}
      <div
        className="absolute inset-x-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-solid border border-subtle rounded-lg shadow-[var(--shadow-elev-2)] flex flex-col"
      >
        {/* Header. */}
        <div className="flex items-center justify-between p-4 border-b border-subtle">
          <h2 className="text-heading font-medium text-ink">Delete recording</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-9 w-9 rounded-sm border border-subtle bg-raised flex items-center justify-center text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Body — confirmation copy. */}
        <div className="p-6">
          <p className="text-body-sm font-medium text-ink">
            Delete “{recordingName}”?
          </p>
          <p className="mt-1 text-body-sm text-ink-secondary">
            This cannot be undone.
          </p>
        </div>

        {/* Footer — actions. */}
        <div className="p-4 border-t border-subtle bg-raised flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-24 items-center justify-center rounded-sm border border-subtle bg-solid px-3 text-body-sm font-medium text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex h-10 w-24 items-center justify-center rounded-sm border border-error bg-error/5 px-3 text-body-sm font-medium text-error hover:bg-error-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-error"
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>
    </dialog>
  );
}
