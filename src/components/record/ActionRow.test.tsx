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

describe("ActionRow paused (§5.9 2.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setState(INITIAL_SOURCE, INITIAL_SESSION);
  });

  it("paused: PAUSED label chip beside the frozen timer; Stop stays live", () => {
    const stopRecording = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ stopRecording });
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "recording",
      recordingId: "rec_1",
      elapsedMs: 4200,
      paused: true,
    });
    render(<ActionRow />);
    // The chip carries the phase word verbatim (§5.9: timer shows the
    // frozen value, the PAUSED `label` chip sits beside it).
    expect(screen.getByText("PAUSED")).toBeTruthy();
    expect(screen.getByRole("timer")).toHaveTextContent("0:04");
    // A paused take is still a running take — Stop & save stays enabled
    // (stop-while-paused is legal per API §2.3).
    expect(screen.getByRole("button", { name: /Stop & save/ })).toBeEnabled();
  });

  it("paused: no pause/resume buttons in the row — §5.9 reserves them for the 2.4 HUD", () => {
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "recording",
      recordingId: "rec_1",
      elapsedMs: 4200,
      paused: true,
    });
    render(<ActionRow />);
    expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
    // Exactly one button lives in the row: Stop & save.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("recording (not paused): no PAUSED chip", () => {
    setState(LIVE, {
      ...INITIAL_SESSION,
      status: "recording",
      recordingId: "rec_1",
      elapsedMs: 4200,
    });
    render(<ActionRow />);
    expect(screen.queryByText("PAUSED")).toBeNull();
  });
});

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

  it("fault copy is NOT rendered inline since 1.7 — error toasts carry it once (§5.6)", () => {
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
    // No second telling: no alert role lives in the row.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // §6.5: retry after a failure is still the primary action
    // (the store pushes the toast; the row keeps the row's one job).
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    expect(button).not.toBeDisabled();
  });
});
