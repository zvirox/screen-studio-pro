import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HudBar from "./HudBar";
import {
  useSspStore,
  INITIAL_SESSION,
  INITIAL_SOURCE,
  type SessionSlice,
  type SourceSlice,
} from "../../lib/store";

/* §5.9 HUD (recording toolbar): float bar with the rec-dot (10px signal
   circle, pulse loop; paused = 22px square), the mono timer, and the
   pause/stop/flag icon-buttons. Drag everywhere; double-click pins.
   Pause/Resume/Stop ride the SAME store actions the ActionRow uses —
   one take, one truth (§4.1). Flag now lands a chapter marker (2.5) and
   flashes signal for 500 ms. */

const getCurrentWindow = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => getCurrentWindow(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

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

function recordingSession(paused: boolean): SessionSlice {
  return {
    ...INITIAL_SESSION,
    status: "recording",
    recordingId: "rec_1",
    elapsedMs: 65_250,
    paused,
  };
}

function recordedActions() {
  const pauseRecording = vi.fn().mockResolvedValue(undefined);
  const resumeRecording = vi.fn().mockResolvedValue(undefined);
  const stopRecording = vi.fn().mockResolvedValue(undefined);
  useSspStore.setState({ pauseRecording, resumeRecording, stopRecording });
  return { pauseRecording, resumeRecording, stopRecording };
}

beforeEach(() => {
  getCurrentWindow.mockReturnValue({ startDragging: vi.fn() });
  setState(INITIAL_SOURCE, INITIAL_SESSION);
});

describe("HudBar (§5.9)", () => {
  it("recording: pulsing 10px dot + tabular timer; no PAUSED chip", () => {
    setState(LIVE, recordingSession(false));
    const { container } = render(<HudBar />);
    const dot = container.querySelector<HTMLElement>('[data-hud="dot"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("animate-pulse-rec");
    expect(dot?.className).toContain("rounded-full");
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("1:05");
    expect(timer).toHaveClass("tabular-nums");
    expect(screen.queryByText("PAUSED")).toBeNull();
  });

  it("paused: dot becomes the 22px square (shape law), PAUSED chip beside the frozen timer, button reads Resume", () => {
    setState(LIVE, recordingSession(true));
    const { container } = render(<HudBar />);
    const dot = container.querySelector<HTMLElement>('[data-hud="dot"]');
    expect(dot?.className).not.toContain("animate-pulse-rec");
    expect(dot?.className).not.toContain("rounded-full");
    expect(screen.getByText("PAUSED")).toBeTruthy();
    expect(screen.getByRole("timer")).toHaveTextContent("1:05"); // frozen value still shown
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause recording" })).toBeNull();
  });

  it("pause click invokes the store action; resume click swaps to resumeRecording", () => {
    setState(LIVE, recordingSession(false));
    const actions = recordedActions();
    render(<HudBar />);
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(actions.pauseRecording).toHaveBeenCalledTimes(1);
    expect(actions.stopRecording).not.toHaveBeenCalled();

    act(() => {
      setState(LIVE, recordingSession(true));
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    expect(actions.resumeRecording).toHaveBeenCalledTimes(1);
  });

  it("stop click invokes stopRecording (tooltip carries the §5.9 copy)", () => {
    setState(LIVE, recordingSession(false));
    const actions = recordedActions();
    render(<HudBar />);
    const stop = screen.getByRole("button", { name: "Stop & save" });
    fireEvent.click(stop);
    expect(actions.stopRecording).toHaveBeenCalledTimes(1);
    expect(stop.getAttribute("title")).toBe("Stop & save");
  });

  it("flag button invokes recording_flag with the live recording id", async () => {
    mockInvoke.mockResolvedValue({ chapter: { offsetMs: 65250, label: "flag-1" } });
    setState(LIVE, recordingSession(false));
    render(<HudBar />);
    const flag = screen.getByRole("button", { name: "Flag a chapter marker" });
    expect(flag).toBeEnabled();
    expect(flag).not.toHaveAttribute("aria-disabled");
    await act(async () => {
      fireEvent.click(flag);
    });
    expect(mockInvoke).toHaveBeenCalledWith("recording_flag", {
      recordingId: "rec_1",
      label: undefined,
    });
  });

  it("drag: pointerdown on the bar starts dragging the window; on a button it does not", () => {
    setState(LIVE, recordingSession(false));
    recordedActions();
    render(<HudBar />);
    const bar = screen.getByRole("toolbar");
    const win = { startDragging: vi.fn() };
    getCurrentWindow.mockReturnValue(win);
    fireEvent.pointerDown(bar);
    expect(win.startDragging).toHaveBeenCalledTimes(1);

    const stop = screen.getByRole("button", { name: "Stop & save" });
    fireEvent.pointerDown(stop, { button: 0 });
    expect(win.startDragging).toHaveBeenCalledTimes(1); // unchanged
  });

  it("double-click pins: the bar dims to the §5.9 pinned opacity; again unpins", () => {
    setState(LIVE, recordingSession(false));
    recordedActions();
    render(<HudBar />);
    const bar = screen.getByRole("toolbar");
    expect(bar.className).not.toContain("opacity-85");
    fireEvent.doubleClick(bar);
    expect(bar.className).toContain("opacity-85");
    fireEvent.doubleClick(bar);
    expect(bar.className).not.toContain("opacity-85");
  });

  it("idle (no live take): renders nothing — the closed window should not linger", () => {
    setState(LIVE, INITIAL_SESSION);
    const { container } = render(<HudBar />);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });
});
