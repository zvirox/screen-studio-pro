import { useEffect } from "react";
import { listenEvent } from "../lib/events";
import { useSspStore } from "../lib/store";

/* ARCHITECTURE §2/hooks + §4.1: the ONE subscription point routing the
   session events (API §3) into the store's reducers — components never
   subscribe on their own, and the store stays the single projection.
   tick → elapsed clock · error → fault copy · finished → teardown.
   2.2: recording/meters routes into the audio projection at its ≤30 Hz
   cadence (still coalesced in Rust, API §3). stats joins with 3.5;
   source/lost joins with M2/M3 multi-source flows. */

export function useRecordingState() {
  useEffect(() => {
    const store = useSspStore;
    let disposed = false;
    const unlistens: Array<() => void> = [];

    void Promise.all([
      listenEvent("recording/tick", store.getState().onTick),
      listenEvent("recording/meters", store.getState().onMeters),
      listenEvent("recording/error", store.getState().onSessionError),
      listenEvent("recording/finished", store.getState().onFinished),
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
