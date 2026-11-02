import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ToastHost from "./ToastHost";
import { useSspStore, type Toast } from "../../lib/store";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import { revealItemInDir } from "@tauri-apps/plugin-opener";
const mockedReveal = vi.mocked(revealItemInDir);

/* §5.6 toast law — Float recipe, bottom-center stack, auto-dismiss timers
   live HERE (5s plain / 6s with action / errors persist); the store only
   accumulates and dedupes. */

const SAVED = {
  kind: "status" as const,
  title: "Recording saved",
  durationMs: 11_754,
  path: "/home/u/Videos/SSP/first-rec.mkv",
};

function pushToast(toast: Omit<Toast, "id">) {
  act(() => {
    useSspStore.setState((s) => ({
      toasts: [...s.toasts, { ...toast, id: s.nextToastId }],
      nextToastId: s.nextToastId + 1,
    }));
  });
}

describe("ToastHost (§5.6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useSspStore.setState({ toasts: [], nextToastId: 1 });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the saved toast with duration (mono) + path + Reveal action", () => {
    pushToast(SAVED);
    render(<ToastHost />);
    expect(screen.getByText("Recording saved")).toBeInTheDocument();
    // mono-md duration line, tabular
    expect(screen.getByText("0:11")).toBeInTheDocument();
    expect(screen.getByText(/first-rec\.mkv/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    // §7.1: icon-only controls need their aria-label
    expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("status toasts announce politely; errors assertively (§5.6 aria-live)", () => {
    pushToast(SAVED);
    pushToast({
      kind: "error",
      title: "Screen capture was blocked.",
      code: "portal.denied",
    });
    render(<ToastHost />);
    const polite = screen.getByRole("status");
    expect(polite).toHaveTextContent("Recording saved");
    expect(polite).toHaveAttribute("aria-live", "polite");
    const assertive = screen.getByRole("alert");
    expect(assertive).toHaveTextContent("Screen capture was blocked.");
    expect(assertive).toHaveAttribute("aria-live", "assertive");
  });

  it("saved toast auto-dismisses after 6s (action toast); plain status 5s", async () => {
    pushToast(SAVED);
    pushToast({ kind: "status", title: "Bare status" });
    render(<ToastHost />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // @5s exactly the plain toast is gone — the action toast's extra
    // second is real differential behavior (store-level timing truth).
    const toasts = useSspStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.title).toBe("Recording saved");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // @6s the action toast follows.
    expect(useSspStore.getState().toasts).toHaveLength(0);
    // DOM mirrors the store once the 90ms exit fade (real rAF) completes.
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.queryByText("Recording saved")).not.toBeInTheDocument(),
    );
  });

  it("error toasts never auto-dismiss — persist until Dismiss (§5.6)", async () => {
    pushToast({
      kind: "error",
      title: "Screen capture was blocked.",
      code: "portal.denied",
    });
    render(<ToastHost />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    vi.useRealTimers();
    expect(screen.getByText("Screen capture was blocked.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Screen capture was blocked."),
      ).not.toBeInTheDocument(),
    );
  });

  it("Copy path writes the toast's path to the clipboard and flashes the check", async () => {
    pushToast(SAVED);
    render(<ToastHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/home/u/Videos/SSP/first-rec.mkv",
    );
    // §7.4 feedback is not color-only: the icon swaps to a check…
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    // …and reverts after its brief flash.
    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(
      screen.queryByRole("button", { name: "Copied" }),
    ).not.toBeInTheDocument();
  });

  it("Reveal hands the path to the opener plugin (platform reveal)", async () => {
    pushToast(SAVED);
    render(<ToastHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    });
    expect(mockedReveal).toHaveBeenCalledWith("/home/u/Videos/SSP/first-rec.mkv");
  });

  it("renders one card per store toast (the store enforces the §5.6 cap)", () => {
    pushToast({ kind: "status", title: "T1" });
    pushToast({ kind: "status", title: "T2" });
    pushToast({ kind: "status", title: "T3" });
    render(<ToastHost />);
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText("T3")).toBeInTheDocument();
    expect(useSspStore.getState().toasts).toHaveLength(3);
  });
});
