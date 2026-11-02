import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SourceDeck from "./SourceDeck";
import {
  useSspStore,
  INITIAL_SESSION,
  INITIAL_SOURCE,
  type SessionSlice,
} from "../../lib/store";
import type { SourceCapabilities } from "../../types/ipc";

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
    expect(
      screen.getByText(/Click Monitor to allow capture through your compositor/),
    ).toBeInTheDocument();
  });

  it("clicking the chip starts the portal selection (§2.1)", () => {
    const selectMonitor = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ selectMonitor });
    render(<SourceDeck />);
    fireEvent.click(screen.getByRole("button", { name: /Monitor/ }));
    expect(selectMonitor).toHaveBeenCalledTimes(1);
  });

  it("selecting: chip shows the §5.1 loading state and is disabled", () => {
    setState({ ...INITIAL_SOURCE, status: "selecting" });
    render(<SourceDeck />);
    const chip = screen.getByRole("button", { name: /Working…/ });
    expect(chip).toBeDisabled();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("live: chip is selected with the mono capability line and the slot is gone", () => {
    setState({
      ...INITIAL_SOURCE,
      status: "live",
      sourceId: "src_1",
      label: "Monitor 1 (2560×1440)",
      capabilities: CAPS,
    });
    render(<SourceDeck />);
    const chip = screen.getByRole("button", { name: /Monitor/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2560×1440 · 60fps")).toHaveClass("font-mono");
    expect(
      screen.queryByText(/Click Monitor to allow capture/),
    ).not.toBeInTheDocument();
  });

  it("live: selecting again is not offered while a take could be running — chip stays clickable for re-consent when idle only", () => {
    setState(
      { ...INITIAL_SOURCE, status: "live", sourceId: "src_1", capabilities: CAPS },
      { ...INITIAL_SESSION, status: "recording", recordingId: "rec_1" },
    );
    const selectMonitor = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({ selectMonitor });
    render(<SourceDeck />);
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
    expect(
      screen.getByText(/Click Monitor to allow capture/),
    ).toBeInTheDocument();
    // No second telling of the denial (§6.5): the toast already carries it.
    expect(
      screen.queryByText("Screen capture permission was denied."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The chip remains available to retry.
    expect(screen.getByRole("button", { name: /Monitor/ })).toBeEnabled();
  });
});
