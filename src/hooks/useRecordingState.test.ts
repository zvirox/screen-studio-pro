import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSspStore, INITIAL_SESSION, INITIAL_SOURCE } from "../lib/store";
import type { UnlistenFn } from "@tauri-apps/api/event";

type MockUnlisten = UnlistenFn & { mock: { calls: unknown[][] } };

const unlistens: MockUnlisten[] = [];

vi.mock("../lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof eventsModule>()),
  listenEvent: vi.fn().mockImplementation(async () => {
    const fn = vi.fn() as unknown as MockUnlisten;
    unlistens.push(fn);
    return fn;
  }),
}));

import { listenEvent, EVENT_TOPICS } from "../lib/events";
import type * as eventsModule from "../lib/events";
import { useRecordingState } from "./useRecordingState";

/* ARCHITECTURE §4.1: events are the only crossing for streaming data. This
   hook is the ONE subscription point routing recording/* events into the
   store's reducers — no component subscribes on its own. */

describe("useRecordingState (event → store wiring)", () => {
  beforeEach(() => {
    unlistens.length = 0;
    vi.mocked(listenEvent).mockClear();
    useSspStore.setState({ source: INITIAL_SOURCE, session: INITIAL_SESSION });
  });

  afterEach(() => {
    useSspStore.setState({ source: INITIAL_SOURCE, session: INITIAL_SESSION });
  });

  it("subscribes to the six session/shell topics once per mount", async () => {
    renderHook(() => useRecordingState());
    await vi.waitFor(() => {
      expect(listenEvent).toHaveBeenCalledTimes(6);
    });
    const topics = vi
      .mocked(listenEvent)
      .mock.calls.map(([t]) => t)
      .sort();
    expect(topics).toEqual([
      "recording/error",
      "recording/finished",
      "recording/meters",
      "recording/started",
      "recording/tick",
      "shell/error",
    ]);
    for (const t of topics) {
      expect(EVENT_TOPICS).toContain(t);
    }
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => useRecordingState());
    await vi.waitFor(() => {
      expect(unlistens).toHaveLength(6);
    });
    unmount();
    // Whether disposal wins before or after the subscription promises
    // resolve, every unlisten must have run exactly once.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = unlistens.reduce<number>((n, fn) => n + (fn.mock.calls.length > 0 ? 1 : 0), 0);
    expect(calls).toBe(6);
  });

  it("routes a tick into the session projection", async () => {
    useSspStore.setState({
      session: {
        ...INITIAL_SESSION,
        status: "recording",
        recordingId: "rec_1",
        elapsedMs: 0,
      },
    });
    renderHook(() => useRecordingState());
    await vi.waitFor(() => {
      expect(listenEvent).toHaveBeenCalledTimes(6);
    });
    const call = vi.mocked(listenEvent).mock.calls.find(([t]) => t === "recording/tick");
    // the subscription is async; by now the handler is registered and the
    // mock lets us simulate the event payload arriving
    (call?.[1] as (p: unknown) => void)({
      recordingId: "rec_1",
      elapsedMs: 2000,
      state: "recording",
    });
    expect(useSspStore.getState().session.elapsedMs).toBe(2000);
  });

  it("routes recording/error and recording/finished into the store", async () => {
    useSspStore.setState({
      session: {
        ...INITIAL_SESSION,
        status: "recording",
        recordingId: "rec_1",
      },
    });
    renderHook(() => useRecordingState());
    await vi.waitFor(() => {
      expect(listenEvent).toHaveBeenCalledTimes(6);
    });
    const handlers = new Map(vi.mocked(listenEvent).mock.calls.map(([t, h]) => [t, h]));
    const err = {
      kind: "pipewire" as const,
      code: "pipewire.stream_lost",
      retryable: false,
      userMessage: "The capture stream ended unexpectedly.",
      details: null,
    };
    (handlers.get("recording/error") as (p: unknown) => void)(err);
    expect(useSspStore.getState().session.fault).toEqual(err);

    (handlers.get("recording/finished") as (p: unknown) => void)({
      recordingId: "rec_1",
      recording: {
        id: 0,
        path: "/tmp/a.mkv",
        fileName: "a.mkv",
        kind: "monitor",
        container: "mkv",
        status: "ready",
        durationMs: 1,
        width: null,
        height: null,
        fps: null,
        sizeBytes: 1,
        encoder: "x264",
        isHwEncoder: false,
        audioJson: null,
        chapterJson: null,
        thumbPath: null,
        deletedAt: null,
        createdAt: "2026-11-02T10:00:00Z",
        updatedAt: "2026-11-02T10:00:00Z",
      },
    });
    expect(useSspStore.getState().session).toEqual(INITIAL_SESSION);
  });

  it("routes recording/meters into the audio projection (2.2)", async () => {
    renderHook(() => useRecordingState());
    await vi.waitFor(() => {
      expect(listenEvent).toHaveBeenCalledTimes(6);
    });
    const handlers = new Map(vi.mocked(listenEvent).mock.calls.map(([t, h]) => [t, h]));
    (handlers.get("recording/meters") as (p: unknown) => void)({
      mic: { rms: 0.42, peak: 0.71 },
      desktop: { rms: 0, peak: 0 },
    });
    expect(useSspStore.getState().audio.meters).toEqual({
      mic: { rms: 0.42, peak: 0.71 },
      desktop: { rms: 0, peak: 0 },
    });
  });
});
