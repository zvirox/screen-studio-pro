import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibraryGrid from "./LibraryGrid";
import { useSspStore, type LibrarySlice } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  libraryList: vi.fn().mockResolvedValue({ items: [], total: 0, page: { limit: 50, offset: 0 } }),
  libraryDelete: vi.fn().mockResolvedValue({ ok: true }),
}));

import { libraryList } from "../../lib/ipc";
const mockLibraryList = vi.mocked(libraryList);

vi.mock("../../lib/store", () => ({
  useSspStore: vi.fn(() => ({
    library: EMPTY_LIBRARY,
    loadLibrary: vi.fn(),
    setLibraryOffset: vi.fn(),
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    deleteRecording: vi.fn(),
    setLibraryFilter: vi.fn(),
    setLibrarySort: vi.fn(),
  })),
}));

const EMPTY_LIBRARY = {
  status: "ready" as const,
  error: null,
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  filter: {},
  sort: { field: "created_at" as const, direction: "desc" as const },
  selectedRecording: null,
  drawerOpen: false,
};

const RECORDING = {
  id: 17,
  path: "/home/z/Videos/SSP/screen-2026-11-01-1412.mp4",
  fileName: "screen-2026-11-01-1412.mp4",
  kind: "recording",
  container: "mp4",
  status: "ready" as const,
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

const MISSING_RECORDING = {
  ...RECORDING,
  id: 18,
  fileName: "screen-2026-11-01-1413.mp4",
  status: "missing" as const,
};

describe("LibraryGrid (§5.5 / §6.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      if (typeof msg === 'string' && msg.includes('not wrapped in act')) {
        return;
      }
      console.error(msg);
    });
    vi.mocked(useSspStore).mockReturnValue({
      library: EMPTY_LIBRARY,
      loadLibrary: vi.fn(),
      setLibraryOffset: vi.fn(),
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      deleteRecording: vi.fn(),
      setLibraryFilter: vi.fn(),
      setLibrarySort: vi.fn(),
    });
  });

  it("shows empty state with Go to Record chip", () => {
    render(<LibraryGrid />);
    expect(screen.getByRole("heading", { name: "Nothing recorded yet" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose a source on the Record tab, then hit Record. Your clips will land here.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to Record/ })).toBeInTheDocument();
  });

  it("shows search empty state with Clear search chip", async () => {
    mockLibraryList.mockResolvedValue({ items: [], total: 0, page: { limit: 50, offset: 0 } });
    vi.mocked(useSspStore).mockReturnValue({
      library: { ...EMPTY_LIBRARY, items: [], total: 0, status: "idle" } as LibrarySlice,
      loadLibrary: vi.fn(),
      setLibraryOffset: vi.fn(),
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      deleteRecording: vi.fn(),
      setLibraryFilter: vi.fn(),
      setLibrarySort: vi.fn(),
    });
    render(<LibraryGrid />);
    fireEvent.change(screen.getByPlaceholderText("Search recordings…"), {
      target: { value: "demo" },
    });
    await waitFor(() => expect(mockLibraryList).toHaveBeenCalled());
    expect(
      screen.getByText('No recordings match "demo"'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear search/ })).toBeInTheDocument();
  });

  it("shows skeleton grid while loading", () => {
    vi.mocked(useSspStore).mockReturnValue({
      library: { ...EMPTY_LIBRARY, status: "loading" } as LibrarySlice,
      loadLibrary: vi.fn(),
      setLibraryOffset: vi.fn(),
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      deleteRecording: vi.fn(),
      setLibraryFilter: vi.fn(),
      setLibrarySort: vi.fn(),
    });
    render(<LibraryGrid />);
    const container = screen.getByTestId("library-grid");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(10);
  });

  it("shows error state with retry", async () => {
    const err = {
      kind: "disk" as const,
      code: "disk.write_failed" as const,
      userMessage: "Disk write failed.",
      details: null,
      retryable: true,
    };
    mockLibraryList.mockRejectedValue(err);
    vi.mocked(useSspStore).mockReturnValue({
      library: { ...EMPTY_LIBRARY, status: "error", error: err } as LibrarySlice,
      loadLibrary: vi.fn(),
      setLibraryOffset: vi.fn(),
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      deleteRecording: vi.fn(),
      setLibraryFilter: vi.fn(),
      setLibrarySort: vi.fn(),
    });
    render(<LibraryGrid />);
    expect(screen.getByRole("heading", { name: "Could not load recordings" })).toBeInTheDocument();
    expect(screen.getByText("Disk write failed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(mockLibraryList).toHaveBeenCalledTimes(1));
  });

  it("shows missing-file chip on missing recording card", () => {
    vi.mocked(useSspStore).mockReturnValue({
      library: { ...EMPTY_LIBRARY, items: [MISSING_RECORDING] } as LibrarySlice,
      loadLibrary: vi.fn(),
      setLibraryOffset: vi.fn(),
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      deleteRecording: vi.fn(),
      setLibraryFilter: vi.fn(),
      setLibrarySort: vi.fn(),
    });
    render(<LibraryGrid />);
    expect(screen.getByText("File missing")).toBeInTheDocument();
    expect(screen.getByText("screen-2026-11-01-1413.mp4")).toBeInTheDocument();
  });

  it("renders recording cards normally", () => {
    vi.mocked(useSspStore).mockReturnValue({
      library: { ...EMPTY_LIBRARY, items: [RECORDING] } as LibrarySlice,
      loadLibrary: vi.fn(),
      setLibraryOffset: vi.fn(),
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      deleteRecording: vi.fn(),
      setLibraryFilter: vi.fn(),
      setLibrarySort: vi.fn(),
    });
    render(<LibraryGrid />);
    expect(screen.getByText("screen-2026-11-01-1412.mp4")).toBeInTheDocument();
    expect(screen.getByText("1:42")).toBeInTheDocument();
    expect(screen.getByText("147.2 MB")).toBeInTheDocument();
  });
});