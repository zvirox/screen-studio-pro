import { useEffect } from "react";
import { listenEvent } from "../lib/events";
import { useSspStore } from "../lib/store";

/* ARCHITECTURE §2/hooks + §4.1: the ONE subscription point routing the
   session events (API §3) into the store's reducers — components never
   subscribe on their own, and the store stays the single projection.
   tick → elapsed clock · error → fault copy · finished → teardown.
   2.2: recording/meters routes into the audio projection at its ≤30 Hz
   cadence (still coalesced in Rust, API §3). 3.5: recording/stats feeds
   the session's stats line at 0.5 Hz; source/lost joins with M2/M3
   multi-source flows. 4.2: device/changed (camera half) re-lists camera
   devices — the reducer carries BOTH halves' routing (the audio half
   re-lists with its own popover-open law, 2.2). */

export function useRecordingState() {
  useEffect(() => {
    const store = useSspStore;
    let disposed = false;
    const unlistens: Array<() => void> = [];

    void Promise.all([
      listenEvent("recording/started", store.getState().onStarted),
      listenEvent("shell/error", store.getState().onShellError),
      listenEvent("recording/tick", store.getState().onTick),
      listenEvent("recording/meters", store.getState().onMeters),
      listenEvent("recording/stats", store.getState().onStats),
      listenEvent("recording/error", store.getState().onSessionError),
      listenEvent("recording/finished", store.getState().onFinished),
      listenEvent("device/changed", () => void store.getState().onDeviceChanged()),
      listenEvent("library/updated", (evt) => void store.getState().onLibraryUpdated(evt)),
    ]).then((fns) => {
      // A fast unmount must not leak listeners subscribed after disposal.
      if (disposed) {
        for (const fn of fns) fn();
        return;
      }
      unlistens.push(...fns);
    });

    return () => {
      disposed = true;
      for (const fn of unlistens) fn();
    };
  }, []);
}
