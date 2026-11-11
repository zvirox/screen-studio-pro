import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  sourcePreview: vi.fn(),
}));

import type * as ipcModule from "../lib/ipc";
import { sourcePreview } from "../lib/ipc";
import { useSourcePreview } from "./useSourcePreview";

const mockedPreview = vi.mocked(sourcePreview);

const still = (capturedAtMs: number, jpegBase64 = "aaa") => ({
  jpegBase64,
  width: 640,
  height: 360,
  capturedAtMs,
});

/* API §2.1 / §4 rate law (3.5): stills poll ≤8fps while a source is live
   and the consumer is mounted; errors are silent retries, never toasts. */

describe("useSourcePreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedPreview.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll without a live source id", async () => {
    const { result } = renderHook(() => useSourcePreview(null));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedPreview).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("first reply becomes a jpeg data URL with the still's dimensions", async () => {
    mockedPreview.mockResolvedValue(still(1000));
    const { result } = renderHook(() => useSourcePreview("src_1"));
    await act(async () => {});
    expect(mockedPreview).toHaveBeenCalledWith("src_1");
    expect(result.current).toEqual({
      dataUrl: "data:image/jpeg;base64,aaa",
      width: 640,
      height: 360,
    });
  });

  it("keeps polling at the ≤8fps cadence while mounted", async () => {
    mockedPreview.mockResolvedValue(still(1000));
    renderHook(() => useSourcePreview("src_1"));
    await act(async () => {});
    expect(mockedPreview).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(125);
    });
    expect(mockedPreview).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(124);
    });
    expect(mockedPreview).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mockedPreview).toHaveBeenCalledTimes(3);
  });

  it("stops polling on unmount — no calls, no state updates after", async () => {
    mockedPreview.mockResolvedValue(still(1000));
    const { unmount } = renderHook(() => useSourcePreview("src_1"));
    await act(async () => {});
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockedPreview).toHaveBeenCalledTimes(1);
  });

  it("discards a stale capturedAtMs — the newer still wins, an older echo never repaints", async () => {
    mockedPreview.mockResolvedValueOnce(still(2000, "new"));
    const { result } = renderHook(() => useSourcePreview("src_1"));
    await act(async () => {});
    expect(result.current?.dataUrl).toBe("data:image/jpeg;base64,new");
    mockedPreview.mockResolvedValueOnce(still(1000, "old"));
    await act(async () => {
      vi.advanceTimersByTime(125);
    });
    expect(result.current?.dataUrl).toBe("data:image/jpeg;base64,new");
  });

  it("a failed poll keeps the last still and retries on the next beat — never throws", async () => {
    mockedPreview.mockResolvedValueOnce(still(1000, "first"));
    const { result } = renderHook(() => useSourcePreview("src_1"));
    await act(async () => {});
    mockedPreview.mockRejectedValueOnce({
      kind: "ipc",
      code: "ipc.bad_state",
      retryable: true,
      userMessage: "No preview is available for that source yet.",
      details: null,
    });
    await act(async () => {
      vi.advanceTimersByTime(125);
    });
    expect(result.current?.dataUrl).toBe("data:image/jpeg;base64,first");
    mockedPreview.mockResolvedValueOnce(still(3000, "third"));
    await act(async () => {
      vi.advanceTimersByTime(125);
    });
    expect(result.current?.dataUrl).toBe("data:image/jpeg;base64,third");
    expect(mockedPreview).toHaveBeenCalledTimes(3);
  });

  it("switching sources resets the still until the new source answers", async () => {
    mockedPreview.mockResolvedValue(still(1000, "first"));
    const { result, rerender } = renderHook(({ id }) => useSourcePreview(id), {
      initialProps: { id: "src_1" as string | null },
    });
    await act(async () => {});
    expect(result.current?.dataUrl).toBe("data:image/jpeg;base64,first");
    mockedPreview.mockResolvedValue(still(5000, "second"));
    rerender({ id: "src_2" });
    expect(result.current).toBeNull();
    await act(async () => {});
    expect(mockedPreview).toHaveBeenLastCalledWith("src_2");
    expect(result.current?.dataUrl).toBe("data:image/jpeg;base64,second");
  });

  it("releasing the source (id → null) stops the poll and clears the still", async () => {
    mockedPreview.mockResolvedValue(still(1000));
    const { result, rerender } = renderHook(({ id }) => useSourcePreview(id), {
      initialProps: { id: "src_1" as string | null },
    });
    await act(async () => {});
    rerender({ id: null });
    expect(result.current).toBeNull();
    const calls = mockedPreview.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedPreview).toHaveBeenCalledTimes(calls);
  });
});