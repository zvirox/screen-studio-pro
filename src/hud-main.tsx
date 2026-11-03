import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import HudBar from "./components/huds/HudBar";
import { listenEvent } from "./lib/events";
import { useSspStore } from "./lib/store";
import "./tailwind.css";

/* §5.9 HUD entry — the recording toolbar's own webview. Deliberately NOT
   the app boot sequence (lib/boot is the MAIN window's contract gate):
   the HUD renders rendered surface only — timer + phase from the tick
   stream — and mounts no NavBar/views/ToastHost (§6.5's no-double-telling:
   the main window carries copy; a refused command self-heals through the
   tick phase here). */

/* The first tick is up to a full second away but the take is already live
   when this window spawns (API §2.3): pre-seed the session from the URL
   param so §5.9 renders instantly and the buttons bind to the right take.
   The tick stream re-syncs everything (§4.1 Rust truth) from t+1s. */
const recordingId = new URLSearchParams(window.location.search).get("recordingId");
if (recordingId) {
  useSspStore.setState((s) => ({
    session: { ...s.session, status: "recording", recordingId, elapsedMs: 0 },
  }));
}

/* The HUD subscribes to the tick stream itself (it is a second projection
   surface, hooks/useRecordingState's routing duplicated for a child
   window) plus its own death subscription: finished/error close the
   window — the spawn is main-side (hooks/useHudWindow), the death is
   HUD-side; windows never reach across to close each other. */
let disposed = false;
const unlistens: Array<() => void> = [];

void Promise.all([
  listenEvent("recording/tick", useSspStore.getState().onTick),
  listenEvent("recording/finished", () => void getCurrentWindow().close()),
  listenEvent("recording/error", () => void getCurrentWindow().close()),
]).then((fns) => {
  // A fast close must not leak listeners subscribed after disposal.
  if (disposed) {
    for (const fn of fns) fn();
    return;
  }
  unlistens.push(...fns);
});

void window.addEventListener("unload", () => {
  disposed = true;
  for (const fn of unlistens) fn();
});

const container = document.getElementById("root") as HTMLElement;

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <HudBar />
  </React.StrictMode>,
);
