import { useEffect } from "react";
import { listenEvent } from "../lib/events";
import { openHud } from "../lib/hudWindow";

/* ARCHITECTURE §3.2 step 5 + PRD 7.1: the HUD child window is born with
   the take. Main window owns the SPAWN (it is the app shell that starts
   takes); the HUD owns its own death (finished/error self-close in
   src/hud-main.tsx). Windows are app-shell, not projected state — the
   store stays untouched. */

export function useHudWindow() {
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    void listenEvent("recording/started", (evt) => {
      void openHud(evt.recordingId);
    }).then((fn) => {
      // A fast unmount must not leak the subscription (§4.1 discipline).
      if (disposed) {
        fn();
      } else {
        un = fn;
      }
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
}
