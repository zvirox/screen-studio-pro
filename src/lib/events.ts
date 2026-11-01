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

export type EventTopic = keyof EventMap & string;

export function listenEvent<K extends EventTopic>(
  topic: K,
  handler: (payload: EventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventMap[K]>(topic, (event) => handler(event.payload));
}

// Re-exported so feature code never imports the raw error type from Tauri.
export type { IpcError };
