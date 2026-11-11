import { useEffect, useState } from "react";
import { sourcePreview } from "../lib/ipc";

/* hooks/useSourcePreview — the webview half of the ARCHITECTURE §6 stills
   exception (task 3.5, API §2.1): encoded JPEG stills are the ONLY media
   that may cross IPC, and they ride a polled command, never an event.
   Rate law (API §4): ≤8fps per live source, stopped when the source is
   released or the consumer unmounts. Poll failures (ipc.bad_state before
   the first frame, capture.preview_failed) are silent retries — the slot
   keeps its placeholder/last still and NEVER toasts (API §2.1). */

/** 125ms = the 8fps ceiling; sequential (reply → wait → poll) so a slow
    encode can never stack overlapping requests. */
const POLL_MS = 125;

export interface PreviewStillState {
  dataUrl: string;
  width: number;
  height: number;
}

export function useSourcePreview(sourceId: string | null): PreviewStillState | null {
  const [still, setStill] = useState<PreviewStillState | null>(null);

  useEffect(() => {
    setStill(null);
    if (!sourceId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Wall-clock ms is always > 0; 0 means "no still seen yet".
    let lastCapturedAtMs = 0;

    const poll = async () => {
      try {
        const reply = await sourcePreview(sourceId);
        if (cancelled) return;
        // The mailbox holds the latest frame; an echo with an older (or
        // identical) stamp must not repaint the img needlessly.
        if (reply.capturedAtMs > lastCapturedAtMs) {
          lastCapturedAtMs = reply.capturedAtMs;
          setStill({
            dataUrl: `data:image/jpeg;base64,${reply.jpegBase64}`,
            width: reply.width,
            height: reply.height,
          });
        }
      } catch {
        // API §2.1: not-ready/failed stills keep the slot as-is; the next
        // beat retries. No toast — a polling miss is not a user-facing fault.
      }
      if (!cancelled) {
        timer = setTimeout(() => void poll(), POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sourceId]);

  return still;
}