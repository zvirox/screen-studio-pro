import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TakesGallery from "./TakesGallery";
import { INITIAL_LIBRARY, INITIAL_PRESETS, useSspStore } from "../../lib/store";
import type { LibraryListItem, Preset } from "../../types/ipc";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import { revealItemInDir } from "@tauri-apps/plugin-opener";

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

const DUMMY_TAKES: LibraryListItem[] = [
  {
    id: 101,
    path: "/home/zvirox/Videos/screenstudio/take_001.mp4",
    fileName: "take_001.mp4",
    kind: "monitor",
    container: "mp4",
    status: "ready",
    durationMs: 74000, // 01:14
    width: 1920,
    height: 1080,
    fps: 60,
    sizeBytes: 48000000,
    encoder: "vaapi",
    isHwEncoder: true,
    audioJson: null,
    chapterJson: null,
    thumbPath: "/home/zvirox/Videos/screenstudio/take_001.jpg",
    deletedAt: null,
    createdAt: "2026-11-18T10:00:00Z",
    updatedAt: "2026-11-18T10:00:00Z",
  },
  {
    id: 102,
    path: "/home/zvirox/Videos/screenstudio/take_002.mp4",
    fileName: "take_002.mp4",
    kind: "window",
    container: "mp4",
    status: "ready",
    durationMs: 140000, // 02:20
    width: 1920,
    height: 1080,
    fps: 60,
    sizeBytes: 95000000,
    encoder: "vaapi",
    isHwEncoder: true,
    audioJson: null,
    chapterJson: null,
    thumbPath: null,
    deletedAt: null,
    createdAt: "2026-11-18T11:00:00Z",
    updatedAt: "2026-11-18T11:00:00Z",
  },
];

const DUMMY_PRESETS: Preset[] = [
  {
    id: "youtube",
    label: "For YouTube",
    description: "1080p60 (~12 Mbps)",
    fps: 60,
    height: 1080,
    container: "mp4",
  },
  {
    id: "discord",
    label: "For Discord",
    description: "720p30 (~6 Mbps)",
    fps: 30,
    height: 720,
    container: "mp4",
  },
];

describe("TakesGallery (Stage v3.6 Right Takes & Presets Gallery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      view: "record",
      library: {
        ...INITIAL_LIBRARY,
        items: DUMMY_TAKES,
        total: DUMMY_TAKES.length,
      },
      presets: {
        ...INITIAL_PRESETS,
        presets: DUMMY_PRESETS,
        presetId: "youtube",
      },
    });

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders gallery aside and displays recent take cards with duration and size", async () => {
    render(<TakesGallery />);
    await flushEffects();

    expect(
      screen.getByRole("complementary", { name: "Takes and Presets Gallery" }),
    ).toBeInTheDocument();
    expect(screen.getByText("take_001.mp4")).toBeInTheDocument();
    expect(screen.getByText("take_002.mp4")).toBeInTheDocument();

    // Formatted duration 74000ms = 1:14
    expect(screen.getByText("1:14")).toBeInTheDocument();
    // Formatted duration 140000ms = 2:20
    expect(screen.getByText("2:20")).toBeInTheDocument();
    // Duration sits on an opaque, high-contrast token surface above thumbnails.
    expect(screen.getByText("1:14")).toHaveClass("bg-canvas", "text-ink");
  });

  it("uses a native Open control with persistent sibling actions inside each article", async () => {
    render(<TakesGallery />);
    await flushEffects();

    const card = screen.getByRole("article", { name: "take_001.mp4" });
    expect(card).not.toHaveAttribute("role", "button");
    expect(card).not.toHaveAttribute("tabindex");
    expect(
      within(card).getByRole("button", { name: "Recording take_001.mp4" }),
    ).toBeInTheDocument();

    const play = within(card).getByRole("button", { name: "Play take_001.mp4" });
    const reveal = within(card).getByRole("button", {
      name: "Reveal take_001.mp4 in file manager",
    });
    const copy = within(card).getByRole("button", { name: "Copy path of take_001.mp4" });

    for (const action of [play, reveal, copy]) {
      expect(action).toBeVisible();
      expect(action).toBeEnabled();
      expect(action).not.toHaveAttribute("tabindex", "-1");
    }
    expect(play).toHaveClass("min-h-9");
    expect(reveal).toHaveClass("h-9", "w-9");
    expect(copy).toHaveClass("h-9", "w-9");
  });

  it("opens detail drawer on card click", async () => {
    const openDrawer = vi.fn();
    useSspStore.setState({ openDrawer });

    render(<TakesGallery />);
    await flushEffects();

    const card = screen.getByRole("button", { name: "Recording take_001.mp4" });
    fireEvent.click(card);

    expect(openDrawer).toHaveBeenCalledWith(101);
  });

  it("calls revealItemInDir when clicking reveal action", async () => {
    render(<TakesGallery />);
    await flushEffects();

    const revealBtn = screen.getByRole("button", { name: "Reveal take_001.mp4 in file manager" });
    fireEvent.click(revealBtn);

    expect(revealItemInDir).toHaveBeenCalledWith("/home/zvirox/Videos/screenstudio/take_001.mp4");
  });

  it("copies file path to clipboard when clicking copy action", async () => {
    render(<TakesGallery />);
    await flushEffects();

    const copyBtn = screen.getByRole("button", { name: "Copy path of take_001.mp4" });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/home/zvirox/Videos/screenstudio/take_001.mp4",
    );
  });

  it("renders empty state illustration and message when library has no takes", async () => {
    useSspStore.setState({
      library: {
        ...INITIAL_LIBRARY,
        items: [],
        total: 0,
      },
    });

    render(<TakesGallery />);
    await flushEffects();

    expect(screen.getByText("No takes recorded yet")).toBeInTheDocument();
  });

  it("connects tabs to panels and supports arrow, Home, and End navigation", async () => {
    render(<TakesGallery />);
    await flushEffects();

    const takesTab = screen.getByRole("tab", { name: /Takes/i });
    const presetsTab = screen.getByRole("tab", { name: /Presets/i });
    expect(takesTab).toHaveClass("min-h-9");
    expect(presetsTab).toHaveClass("min-h-9");
    expect(takesTab).toHaveAttribute("aria-controls", "gallery-panel-takes");
    expect(document.getElementById("gallery-panel-presets")).not.toBeNull();
    expect(document.getElementById("gallery-panel-presets")).toHaveAttribute("hidden");
    expect(screen.getByRole("tabpanel", { name: /Takes/i })).toHaveAttribute(
      "id",
      "gallery-panel-takes",
    );

    fireEvent.keyDown(takesTab, { key: "End" });
    expect(presetsTab).toHaveAttribute("aria-selected", "true");
    expect(presetsTab).toHaveFocus();
    expect(takesTab).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: /Presets/i })).toHaveAttribute(
      "id",
      "gallery-panel-presets",
    );

    fireEvent.keyDown(presetsTab, { key: "ArrowRight" });
    expect(takesTab).toHaveAttribute("aria-selected", "true");
    expect(takesTab).toHaveFocus();

    fireEvent.keyDown(takesTab, { key: "ArrowLeft" });
    expect(presetsTab).toHaveAttribute("aria-selected", "true");
    expect(presetsTab).toHaveFocus();

    fireEvent.keyDown(presetsTab, { key: "Home" });
    expect(takesTab).toHaveAttribute("aria-selected", "true");
    expect(takesTab).toHaveFocus();
  });

  it("switches to Presets tab and shows quick presets with hotkey badges", async () => {
    const setPreset = vi.fn().mockResolvedValue(undefined);
    useSspStore.setState({
      setPreset,
      loadPresets: vi.fn().mockResolvedValue(undefined),
      presets: {
        ...INITIAL_PRESETS,
        presets: DUMMY_PRESETS,
        presetId: "youtube",
      },
    });

    render(<TakesGallery />);
    await flushEffects();

    const presetsTab = screen.getByRole("tab", { name: /Presets/i });
    fireEvent.click(presetsTab);

    expect(screen.getByText("For YouTube")).toBeInTheDocument();
    expect(screen.getByText("For Discord")).toBeInTheDocument();
    expect(screen.getByText("F1")).toBeInTheDocument();
    expect(screen.getByText("F2")).toBeInTheDocument();

    const presetBtn = screen.getByRole("button", { name: /For Discord/i });
    fireEvent.click(presetBtn);

    expect(setPreset).toHaveBeenCalledWith("discord");
  });

  it("navigates to library view when clicking Open Library button", async () => {
    render(<TakesGallery />);
    await flushEffects();

    const openLibraryBtn = screen.getByRole("button", { name: /Open Library/i });
    fireEvent.click(openLibraryBtn);

    expect(useSspStore.getState().view).toBe("library");
  });
});
