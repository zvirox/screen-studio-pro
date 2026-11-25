import { act, render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SourceDeck from "./SourceDeck";
import { useSspStore, INITIAL_SESSION, INITIAL_SOURCE, type SessionSlice } from "../../lib/store";
import type { SourceCapabilities } from "../../types/ipc";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  sourcePreview: vi.fn().mockResolvedValue({
    jpegBase64: "aaa",
    width: 640,
    height: 360,
    capturedAtMs: 1000,
  }),
}));

import { sourcePreview } from "../../lib/ipc";
const mockedPreview = vi.mocked(sourcePreview);

/* §6.1 #2 source deck — 1.5 slice: the Monitor chip (Window/Region arrive
   with M2/M3; dead controls never render, §6.3) + the preview frame with
   the §6.3 education slot until capture is granted. */

const CAPS: SourceCapabilities = {
  fps: 60,
  width: 2560,
  height: 1440,
  cursor: true,
  region: true,
};

function setState(source = INITIAL_SOURCE, session: SessionSlice = INITIAL_SESSION) {
  useSspStore.setState({ source, session });
}

describe("SourceDeck (§6.1/§6.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setState();
  });

  it("idle: renders the Monitor chip unselected and the education slot", () => {
    render(<SourceDeck />);
    const chip = screen.getByRole("button", { name: /Monitor/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    const guidance = screen.getByText(/Choose a source to start portal capture/);
    expect(guidance).toBeInTheDocument();
    // Neutral secondary copy on the dark canvas; accent is reserved for
    // the primary action, live state, focus rings and meter fill.
    expect(guidance).toHaveClass("text-[var(--text-muted)]");
  });

  it("clicking the chip starts the portal selection (§2.1)", () => {
    const selectMonitor = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ selectMonitor });
    render(<SourceDeck />);
    fireEvent.click(screen.getByRole("button", { name: /Monitor/ }));
    expect(selectMonitor).toHaveBeenCalledTimes(1);
  });

  it("selecting: chip shows the §5.1 loading state and is disabled", () => {
    setState({ ...INITIAL_SOURCE, status: "selecting", selectingKind: "monitor" });
    render(<SourceDeck />);
    const chip = screen.getByRole("button", { name: /Working…/ });
    expect(chip).toBeDisabled();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("live: chip is selected with the mono capability line and the slot is gone", async () => {
    setState({
      ...INITIAL_SOURCE,
      status: "live",
      sourceId: "src_1",
      label: "Monitor 1 (2560×1440)",
      capabilities: CAPS,
    });
    render(<SourceDeck />);
    // 3.5: the still lands async — await it so the slot assertion sees
    // the settled frame (and the state update stays inside act).
    await screen.findByRole("img", { name: "Source preview" });
    const chip = screen.getByRole("button", { name: /Monitor/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2560×1440 · 60fps")).toHaveClass("font-mono");
    expect(screen.queryByText(/Choose a source to start portal capture/)).not.toBeInTheDocument();
  });

  it("live: selecting again is not offered while a take could be running — chip stays clickable for re-consent when idle only", async () => {
    setState(
      { ...INITIAL_SOURCE, status: "live", sourceId: "src_1", capabilities: CAPS },
      { ...INITIAL_SESSION, status: "recording", recordingId: "rec_1" },
    );
    const selectMonitor = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ selectMonitor });
    render(<SourceDeck />);
    await screen.findByRole("img", { name: "Source preview" });
    fireEvent.click(screen.getByRole("button", { name: /Monitor/ }));
    // §5.1: a mid-take source change would kill the take — disabled.
    expect(selectMonitor).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Monitor/ })).toBeDisabled();
  });

  it("error: the §6.3 slot keeps the neutral education copy (1.7) — the denied copy rides the error toast", () => {
    setState({
      ...INITIAL_SOURCE,
      status: "error",
      error: {
        kind: "portal",
        code: "portal.denied",
        retryable: false,
        userMessage: "Screen capture permission was denied.",
        details: null,
      },
    });
    render(<SourceDeck />);
    // §6.3: education, not an error screen — the invitation stays up.
    expect(screen.getByText(/Choose a source to start portal capture/)).toBeInTheDocument();
    // No second telling of the denial (§6.5): the toast already carries it.
    expect(screen.queryByText("Screen capture permission was denied.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The chip remains available to retry.
    expect(screen.getByRole("button", { name: /Monitor/ })).toBeEnabled();
  });

  it("scales native region coordinates to the preview canvas without changing capture geometry", () => {
    setState({
      ...INITIAL_SOURCE,
      status: "live",
      sourceId: "src_1",
      label: "Region",
      capabilities: CAPS,
      regionRect: { x: 640, y: 360, w: 1280, h: 720 },
    });
    render(<SourceDeck />);
    const rect = screen.getByRole("graphics-document", {
      name: "Region selection rectangle",
    });
    expect(rect).toHaveStyle({
      left: "25%",
      top: "25%",
      width: "50%",
      height: "50%",
    });
    expect(useSspStore.getState().source.regionRect).toEqual({
      x: 640,
      y: 360,
      w: 1280,
      h: 720,
    });
  });

  it("aligns the crop overlay with a letterboxed ultrawide source", () => {
    setState({
      ...INITIAL_SOURCE,
      status: "live",
      sourceId: "src_1",
      label: "Region",
      capabilities: { ...CAPS, width: 2560, height: 1080 },
      regionRect: { x: 640, y: 270, w: 1280, h: 540 },
    });
    render(<SourceDeck />);

    expect(screen.getByRole("group", { name: "Region source content" })).toHaveStyle({
      left: "0%",
      top: "12.5%",
      width: "100%",
      height: "75%",
    });
    expect(
      screen.getByRole("graphics-document", { name: "Region selection rectangle" }),
    ).toHaveStyle({
      left: "25%",
      top: "25%",
      width: "50%",
      height: "50%",
    });
  });

  it("keeps keyboard region nudges in native pixels", async () => {
    const setRegionRect = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ setRegionRect });
    setState({
      ...INITIAL_SOURCE,
      status: "live",
      sourceId: "src_1",
      label: "Region",
      capabilities: CAPS,
      regionRect: { x: 640, y: 360, w: 1280, h: 720 },
    });
    render(<SourceDeck />);
    const rect = screen.getByRole("graphics-document", {
      name: "Region selection rectangle",
    });

    await act(async () => {
      fireEvent.keyDown(rect, { key: "Enter", code: "Enter" });
      // KeyboardSensor attaches its move/end listener in a deferred task.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rect).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(rect, { key: "ArrowRight", code: "ArrowRight" });
    expect(rect.style.transform).toBe("translate3d(1px, 0px, 0)");
    fireEvent.keyDown(rect, { key: "Enter", code: "Enter" });

    expect(setRegionRect).toHaveBeenCalledWith("src_1", {
      x: 641,
      y: 360,
      w: 1280,
      h: 720,
    });
  });
});

describe("SourceDeck preview stills (3.5, API §2.1)", () => {
  const LIVE = {
    ...INITIAL_SOURCE,
    status: "live" as const,
    sourceId: "src_1",
    label: "Monitor 1 (2560×1440)",
    capabilities: CAPS,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    setState();
    mockedPreview.mockReset();
    mockedPreview.mockResolvedValue({
      jpegBase64: "aaa",
      width: 640,
      height: 360,
      capturedAtMs: 1000,
    });
  });

  it("live: the preview frame shows the polled jpeg still", async () => {
    setState(LIVE);
    render(<SourceDeck />);
    const img = await screen.findByRole("img", { name: "Source preview" });
    expect(img).toHaveAttribute("src", "data:image/jpeg;base64,aaa");
    expect(mockedPreview).toHaveBeenCalledWith("src_1");
    expect(screen.queryByText(/Choose a source to start portal capture/)).not.toBeInTheDocument();
  });

  it("live but no still yet: the §5.1 loading state, not the education copy", async () => {
    mockedPreview.mockRejectedValue({
      kind: "ipc",
      code: "ipc.bad_state",
      retryable: true,
      userMessage: "No preview is available for that source yet.",
      details: null,
    });
    setState(LIVE);
    render(<SourceDeck />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Working…");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose a source to start portal capture/)).not.toBeInTheDocument();
    // A polling miss never toasts (API §2.1) — no alert anywhere.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("idle: no polling and no img — the education slot stays", () => {
    render(<SourceDeck />);
    expect(mockedPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Choose a source to start portal capture/)).toBeInTheDocument();
  });
});
