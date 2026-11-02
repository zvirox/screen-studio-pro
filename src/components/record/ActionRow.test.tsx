import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionRow from "./ActionRow";
import {
  useSspStore,
  INITIAL_SESSION,
  INITIAL_SOURCE,
  type SessionSlice,
  type SourceSlice,
} from "../../lib/store";

/* §5.1/§6.1 #5 action row — 1.5 slice: the 48px primary Record button only
   (preset select + encoder chip join with their features). While a take
   runs, the row shows the elapsed mono timer and Stop & save — the HUD
   window itself lands in PLAN 2.4 (deviation ledgered in PLAN.md). */

function setState(source: SourceSlice, session: SessionSlice) {
  useSspStore.setState({ source, session });
}

const LIVE: SourceSlice = {
  ...INITIAL_SOURCE,
  status: "live",
  sourceId: "src_1",
  label: "Monitor 1",
  capabilities: { fps: 60, width: 2560, height: 1440, cursor: true, region: true },
};

describe("ActionRow (§5.1/§6.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setState(INITIAL_SOURCE, INITIAL_SESSION);
  });

  it("idle: the 48px Record primary is disabled until a source is live", () => {
    render(<ActionRow />);
    const btn = screen.getByRole("button", { name: /Record/ });
    expect(btn).toBeDisabled();
    // §5.1 disabled: label text.disabled via the class, no hover legible
    expect(btn.className).toContain("text-ink-disabled");
  });

  it("source live: Record enabled; clicking hands over to startRecording", () => {
    const startRecording = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ startRecording });
    setState(LIVE, INITIAL_SESSION);
    render(<ActionRow />);
    const btn = screen.getByRole("button", { name: /Record/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("starting: §5.1 loading — spinner + Working… with aria-live, width held", () => {
    setState(LIVE, { ...INITIAL_SESSION, status: "starting" });
    render(<ActionRow />);
    const btn = screen.getByRole("button", { name: /Working…/ });
    expect(btn).toBeDisabled();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("recording: Stop & save primary + mono elapsed timer; click calls stopRecording", () => {
    const stopRecording = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ stopRecording });
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "recording",
      recordingId: "rec_1",
      elapsedMs: 65_000,
    });
    render(<ActionRow />);
    const btn = screen.getByRole("button", { name: /Stop & save/ });
    expect(btn).toBeEnabled();
    const timer = screen.getByRole("timer");
    expect(timer).toHaveClass("font-mono");
    expect(timer).toHaveTextContent("1:05");
    fireEvent.click(btn);
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it("recording ≥1h switches the timer to h:mm:ss", () => {
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "recording",
      recordingId: "rec_1",
      elapsedMs: 3_661_000,
    });
    render(<ActionRow />);
    expect(screen.getByRole("timer")).toHaveTextContent("1:01:01");
  });

  it("stopping: loading again — no double clicks while the trailer writes", () => {
    const stopRecording = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ stopRecording });
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "stopping",
      recordingId: "rec_1",
    });
    render(<ActionRow />);
    expect(screen.getByRole("button", { name: /Working…/ })).toBeDisabled();
    expect(stopRecording).not.toHaveBeenCalled();
  });

  it("fault: the human copy renders once, inline, with the §5.2 error pattern", () => {
    setState(LIVE, {
      ...INITIAL_SESSION,
      fault: {
        kind: "portal",
        code: "portal.denied",
        retryable: false,
        userMessage: "Screen capture permission was denied.",
        details: null,
      },
    });
    render(<ActionRow />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Screen capture permission was denied.");
    // §5.2: error = color + icon + text, never color alone (icon present)
    expect(alert.querySelector("svg")).not.toBeNull();
  });

  it("no-double-telling: one fault copy even while a stop is in flight", () => {
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "stopping",
      recordingId: "rec_1",
      fault: {
        kind: "pipewire",
        code: "pipewire.stream_lost",
        retryable: false,
        userMessage: "The capture stream ended unexpectedly.",
        details: null,
      },
    });
    render(<ActionRow />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
