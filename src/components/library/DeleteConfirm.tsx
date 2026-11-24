import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { LinearCard } from "../linear/LinearCard";
import { LinearButton } from "../linear/LinearButton";
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
      {/* Scrim — solid opaque overlay, closes on click. */}
      <div
        className="absolute inset-0 bg-black/75"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Modal panel — centered, LinearCard modal recipe. */}
      <LinearCard
        level="modal"
        className="absolute inset-x-1/2 top-1/2 flex w-120 -translate-x-1/2 -translate-y-1/2 flex-col p-0 overflow-hidden"
      >
        {/* Header. */}
        <div className="flex items-center justify-between p-4 border-b border-subtle">
          <h2 className="text-heading font-medium text-ink">Delete recording</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-9 w-9 rounded-lg border border-subtle bg-raised flex items-center justify-center text-ink hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent cursor-pointer"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Body — confirmation copy. */}
        <div className="p-6">
          <p className="text-body-sm font-medium text-ink">Delete “{recordingName}”?</p>
          <p className="mt-1 text-body-sm text-ink-secondary">This cannot be undone.</p>
        </div>

        {/* Footer — actions. */}
        <div className="p-4 border-t border-subtle bg-raised flex items-center justify-end gap-2">
          <LinearButton
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Cancel
          </LinearButton>
          <LinearButton
            variant="danger"
            size="md"
            onClick={handleConfirm}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" className="mr-1.5" />
            <span>Delete</span>
          </LinearButton>
        </div>
      </LinearCard>
    </dialog>
  );
}
