import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecordView from "./RecordView";
import {
  useSspStore,
  INITIAL_SESSION,
  INITIAL_SOURCE,
} from "../../lib/store";
import type {
  SourceCapabilities,
  SourceSelected,
} from "../../types/ipc";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("../../lib/ipc", () => ({
  sourceSelect: vi.fn(),
  recordingStart: vi.fn(),
  recordingStop: vi.fn(),
}));

import {
  recordingStart,
  recordingStop,
  sourceSelect,
} from "../../lib/ipc";

/* §6.1 Record view, 1.5 slice: source deck + action row (audio strip and
   camera slab arrive with M4/M5). The §6.3 education slot is the
   first-run experience; the flow smoke below walks click → consent →
   recording → stop at the component level. */

const CAPS: SourceCapabilities = {
  fps: 60,
  width: 320,
  height: 240,
  cursor: true,
  region: true,
};

const SELECTED: SourceSelected = {
  sourceId: "src_1",
  kind: "monitor",
  label: "Monitor 1 (320×240)",
  capabilities: CAPS,
  preview: { mode: "stills_jpeg", fps: 8 },
};

describe("RecordView (§6.1 slice)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({ source: INITIAL_SOURCE, session: INITIAL_SESSION });
  });

  it("composes the deck and the action row", () => {
    render(<RecordView />);
    expect(screen.getByRole("region", { name: "Source" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Recording controls" }),
    ).toBeInTheDocument();
    // first-run education slot visible (§6.3)
    expect(
      screen.getByText(/Click Monitor to allow capture through your compositor/),
    ).toBeInTheDocument();
  });

  it("flow smoke: chip → consent → Record enabled → recording → stop → idle", async () => {
    vi.mocked(sourceSelect).mockResolvedValue(SELECTED);
    vi.mocked(recordingStart).mockResolvedValue({
      recordingId: "rec_1",
      status: "recording",
      encoder: { backend: "x264", isHardware: false },
      startedAt: "2026-11-02T10:00:00Z",
    });
    vi.mocked(recordingStop).mockResolvedValue({
      recording: {
        id: 0,
        path: "/home/u/Videos/SSP/first-rec.mkv",
        container: "mkv",
        durationMs: 900,
        sizeBytes: 900,
        status: "ready",
      },
    });

    render(<RecordView />);

    // click → consent (source_select resolves the §2.1 reply)
    fireEvent.click(screen.getByRole("button", { name: /Monitor/ }));
    expect(vi.mocked(sourceSelect)).toHaveBeenCalledWith("monitor");
    await screen.findByText("320×240 · 60fps");

    // Record enabled and armed
    const record = screen.getByRole("button", { name: /Record/ });
    await waitFor(() => expect(record).toBeEnabled());
    fireEvent.click(record);
    expect(vi.mocked(recordingStart)).toHaveBeenCalledWith({
      sourceId: "src_1",
      regionRect: null,
      audio: [],
      cameraId: null,
      presetId: null,
      outputDir: null,
    });

    // recording state: Stop & save + timer
    await screen.findByRole("button", { name: /Stop & save/ });
    expect(screen.getByRole("timer")).toBeInTheDocument();

    // stop → idle, source stays live, record re-armed
    fireEvent.click(screen.getByRole("button", { name: /Stop & save/ }));
    await waitFor(() => expect(recordingStop).toHaveBeenCalledWith("rec_1"));
    await screen.findByRole("button", { name: /Record/ });
    expect(screen.getByRole("button", { name: /Record/ })).toBeEnabled();
  });
});
