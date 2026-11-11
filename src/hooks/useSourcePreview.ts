import { useEffect, useState } from "react";
import { sourcePreview, cameraPreview } from "../lib/ipc";
import type { SourcePreviewStill } from "../types/ipc";

/* hooks/useSourcePreview — the webview half of the ARCHITECTURE §6 stills
   exception (task 3.5, API §2.1; camera twin 4.1, API §2.2): encoded JPEG
   stills are the ONLY media that may cross IPC, and they ride a polled
   command, never an event. Rate law (API §4): ≤8fps per live source,
   stopped when the source is released or the consumer unmounts. Poll
   failures (ipc.bad_state before the first frame, capture.preview_failed)
   are silent retries — the slot keeps its placeholder/last still and
   NEVER toasts (API §2.1). */

/** 125ms = the 8fps ceiling; sequential (reply → wait → poll) so a slow
    encode can never stack overlapping requests. */
const POLL_MS = 125;

export interface PreviewStillState {
  dataUrl: string;
  width: number;
  height: number;
}

/** The shared sequential poll — the §2.1/§2.2 stills law in one place.
    `stillKey` addresses the mailbox (sourceId / cameraId); the fetcher
    is the command wrapper (source_preview / camera_preview — the same
    §2.1 reply shape). `enabled` gates the poll WITHOUT resetting state
    (the freeze law, §6.6: camera-off stops the poll and holds the last
    still); `stillKey` changing is the only reset. */
function useStillsPoll(
  stillKey: string | null,
  fetchStill: (key: string) => Promise<SourcePreviewStill>,
  enabled = true,
): PreviewStillState | null {
  const [still, setStill] = useState<PreviewStillState | null>(null);

  // The reset rides its own stillKey-keyed effect so an `enabled` flip
  // (the §6.6 freeze) never clears the held frame.
  useEffect(() => {
    setStill(null);
  }, [stillKey]);

  useEffect(() => {
    if (!stillKey || !enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Wall-clock ms is always > 0; 0 means "no still seen yet".
    let lastCapturedAtMs = 0;

    const poll = async () => {
      try {
        const reply = await fetchStill(stillKey);
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

    if (enabled) void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [stillKey, fetchStill, enabled]);

  return still;
}

/** `cmd://source_preview` poll for a live capture source (API §2.1). */
export function useSourcePreview(sourceId: string | null): PreviewStillState | null {
  return useStillsPoll(sourceId, sourcePreview);
}

/** `cmd://camera_preview` poll for the open camera (API §2.2, 4.1). The
    open reply implies the mailbox already holds a still, so a fresh
    open's first poll lands a frame. `enabled=false` is the §6.6 freeze:
    the poll stops and the last still HOLDS (a stillKey change is still
    the only reset). */
export function useCameraPreview(
  cameraId: string | null,
  enabled = true,
): PreviewStillState | null {
  return useStillsPoll(cameraId, cameraPreview, enabled);
}
