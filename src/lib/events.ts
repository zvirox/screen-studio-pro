import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DeviceChangedEvt,
  IpcError,
  LibraryUpdatedEvt,
  RecordingErrorEvt,
  RecordingFlaggedEvt,
  RecordingFinishedEvt,
  RecordingMetersEvt,
  RecordingStartedEvt,
  RecordingStatsEvt,
  RecordingTickEvt,
  SourceLostEvt,
} from "../types/ipc";

/* Typed listeners for Tauri events — the single subscription source
   (ARCHITECTURE §2; API §3: the webview subscribes through here exactly
   once per topic). Topic→payload map mirrors src-tauri/ipc/events.rs. */

/** The ten API.md §3 topics — the runtime twin of the Rust
    `src-tauri/ipc/events.rs::topic` constants (bare `domain/verb` names:
    the `evt://` prefix is documentation addressing). */
export const EVENT_TOPICS = [
  "recording/started",
  "recording/tick",
  "recording/meters",
  "recording/stats",
  "recording/flagged",
  "recording/error",
  "recording/finished",
  "library/updated",
  "source/lost",
  "device/changed",
] as const;

export interface EventMap {
  "recording/started": RecordingStartedEvt;
  "recording/tick": RecordingTickEvt;
  "recording/meters": RecordingMetersEvt;
  "recording/stats": RecordingStatsEvt;
  "recording/flagged": RecordingFlaggedEvt;
  "recording/error": RecordingErrorEvt;
  "recording/finished": RecordingFinishedEvt;
  "library/updated": LibraryUpdatedEvt;
  "source/lost": SourceLostEvt;
  "device/changed": DeviceChangedEvt;
}

/** Compile-time parity between the runtime topic list and the typed map
    (TESTING §1 P1): a topic on one side only is a SILENT breakage — the
    webview would never hear about it. The symmetric difference must be
    empty; on a mismatch this type is `never` and the guard below fails
    to compile. */
export type EventTopicsInSync = Exclude<
  (typeof EVENT_TOPICS)[number] | keyof EventMap,
  (typeof EVENT_TOPICS)[number] & keyof EventMap
> extends never
  ? true
  : never;

/** `true` when the runtime topic list and the typed map name exactly the
    same topics — see `EventTopicsInSync`. */
export const EVENT_TOPICS_IN_SYNC: EventTopicsInSync = true;

export type EventTopic = keyof EventMap & string;

export function listenEvent<K extends EventTopic>(
  topic: K,
  handler: (payload: EventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventMap[K]>(topic, (event) => handler(event.payload));
}

// Re-exported so feature code never imports the raw error type from Tauri.
export type { IpcError };
