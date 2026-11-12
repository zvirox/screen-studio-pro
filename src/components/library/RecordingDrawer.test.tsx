import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecordingDrawer from "./RecordingDrawer";
import { useSspStore } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  libraryGet: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import { revealItemInDir } from "@tauri-apps/plugin-opener";
const mockReveal = vi.mocked(revealItemInDir);

function setLibraryState(library: any) {
  useSspStore.setState({ library });
}

function setRecording(rec: any) {
  useSspStore.setState({ library: { ...useSspStore.getState().library, selectedRecording: rec } });
}

const RECORDING = {
  id: 17,
  path: "/home/z/Videos/SSP/screen-2026-11-01-1412.mp4",
  fileName: "screen-2026-11-01-1412.mp4",
  kind: "recording",
  container: "mp4",
  status: "ready",
  durationMs: 102550,
  width: 2560,
  height: 1440,
  fps: 60,
  sizeBytes: 147174400,
  encoder: "vaapi",
  isHwEncoder: true,
  audioJson: null,
  chapterJson: null,
  thumbPath: "/home/z/.local/share/screen-studio-pro/thumbs/screen-2026-11-01-1412.png",
  deletedAt: null,
  createdAt: "2026-11-01T14:05:00Z",
  updatedAt: "2026-11-01T14:05:00Z",
};

/* §5.7 Drawer: detail drawer with large thumb, full meta table (mono
   values), Reveal in file manager secondary action, Trim later disabled
   with tooltip "Planned for V2". Focus trap via <dialog>, Esc closes,
   scrim click closes. */
describe("RecordingDrawer (§5.7)", () => {
  beforeEach(() => {
    setLibraryState({
      status: "ready",
      error: null,
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      filter: {},
      sort: { field: "created_at", direction: "desc" },
      selectedRecording: null,
      drawerOpen: false,
    });
    vi.clearAllMocks();
  });

  it("renders drawer when open with recording details", () => {
    setRecording(RECORDING);
    render(<RecordingDrawer open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("screen-2026-11-01-1412.mp4")).toBeInTheDocument();
    expect(screen.getByText("1:42")).toBeInTheDocument();
    expect(screen.getByText("MP4")).toBeInTheDocument();
    expect(screen.getByText("60 fps")).toBeInTheDocument();
    expect(screen.getByText("vaapi · HW")).toBeInTheDocument();
    expect(screen.getByText("147.2 MB")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    setRecording(RECORDING);
    const { container } = render(<RecordingDrawer open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[role=dialog]")).not.toBeInTheDocument();
  });

  it("calls revealItemInDir on Reveal", async () => {
    setRecording(RECORDING);
    render(<RecordingDrawer open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Reveal in file manager"));
    await waitFor(() => expect(mockReveal).toHaveBeenCalledWith("/home/z/Videos/SSP/screen-2026-11-01-1412.mp4"));
  });

  it("Trim later is disabled with tooltip", () => {
    setRecording(RECORDING);
    render(<RecordingDrawer open={true} onClose={vi.fn()} />);
    const trim = screen.getByRole("button", { name: /Trim later/ });
    expect(trim).toBeDisabled();
    expect(trim).toHaveAttribute("title", "Planned for V2");
  });

  it("closes via close button", () => {
    const onClose = vi.fn();
    setRecording(RECORDING);
    render(<RecordingDrawer open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Close details/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders empty values when fields are null", () => {
    setRecording({ ...RECORDING, width: null, height: null, fps: null });
    render(<RecordingDrawer open={true} onClose={vi.fn()} />);
    expect(screen.getByText("—×—")).toBeInTheDocument();
    expect(screen.getByText("— fps")).toBeInTheDocument();
  });
});
