import { useEffect } from "react";
import { closeHud, openHud } from "../lib/hudWindow";
import { asIpcError, windowHide } from "../lib/ipc";
import { useSspStore } from "../lib/store";

/* API §4.1: one start subscription initializes the store; this hook owns
   the child lifetime. A late spawn is destroyed instead of hiding saved
   feedback. Rust repeats the active-id check atomically with hiding. */

export function useHudWindow() {
  const id = useSspStore((s) => s.session.recordingId);
  const fault = useSspStore((s) => s.session.fault);
  useEffect(() => {
    if (!id || fault) return;
    let disposed = false;
    void openHud(id)
      .then(async () => {
        if (!disposed && useSspStore.getState().session.recordingId === id) {
          await windowHide(id);
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const error = asIpcError(err);
        useSspStore.getState().showError(
          error.code === "ipc.unknown_command"
            ? {
                kind: "ipc",
                code: "ipc.window_failed",
                retryable: true,
                userMessage:
                  "The recording toolbar could not open. Use this window or the tray to control recording.",
                details: null,
              }
            : error,
        );
      });
    return () => {
      disposed = true;
      void closeHud(id).catch(() =>
        useSspStore.getState().showError({
          kind: "ipc",
          code: "ipc.window_failed",
          retryable: true,
          userMessage:
            "The recording toolbar could not close. Use the main window or tray to continue.",
          details: null,
        }),
      );
    };
  }, [id, fault]);
}
