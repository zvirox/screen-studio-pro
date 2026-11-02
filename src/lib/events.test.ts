import { afterEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn(async (_topic: string, _handler: unknown) => () => {});
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...(args as [string, unknown])),
}));

import { EVENT_TOPICS, listenEvent } from "./events";

/* Contract tests for the event layer (TESTING §1 P1): the lib/events.ts ↔
   src-tauri/ipc/events.rs mirror. A topic that exists on one side only is
   a SILENT breakage — the webview would simply never hear about it. The
   topic strings here are the API.md §3 names, byte-for-byte the Rust
   `topic::` constants. */

const API_MD_3_TOPICS = [
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
];

describe("lib/events", () => {
  afterEach(() => listenMock.mockReset());

  it("covers every API.md §3 topic and nothing else", () => {
    expect([...EVENT_TOPICS].sort()).toEqual([...API_MD_3_TOPICS].sort());
  });

  it("subscribes to each topic with its bare domain/verb name", async () => {
    for (const topic of EVENT_TOPICS) {
      const unlisten = await listenEvent(topic, () => {});
      expect(listenMock).toHaveBeenCalledWith(topic, expect.any(Function));
      unlisten();
    }
    expect(listenMock).toHaveBeenCalledTimes(API_MD_3_TOPICS.length);
  });

  it("forwards the event payload to the handler", async () => {
    const seen: unknown[] = [];
    await listenEvent("recording/tick", (payload) => seen.push(payload));
    const [, handler] = listenMock.mock.calls[0] as [
      string,
      (event: { payload: unknown }) => void,
    ];
    handler({
      payload: { recordingId: "rec_01hv4", elapsedMs: 1000, state: "recording" },
    });
    expect(seen).toEqual([
      { recordingId: "rec_01hv4", elapsedMs: 1000, state: "recording" },
    ]);
  });
});
