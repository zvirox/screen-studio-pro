import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShortcutsPane from "./ShortcutsPane";
import { useSspStore } from "../../lib/store";
import { shortcutsApply } from "../../lib/ipc";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  shortcutsApply: vi.fn().mockResolvedValue({ granted: [], denied: [] }),
}));

const mockedShortcutsApply = vi.mocked(shortcutsApply);

function setShortcutsSettings(shortcuts: { quickRecord: string; pause: string; stop: string }) {
  useSspStore.setState({
    settings: {
      capture: null,
      captureLoading: false,
      files: null,
      filesLoading: false,
      shortcuts,
      shortcutsLoading: false,
    },
  });
}

/* §6.4 Settings — Shortcuts pane: bindings + shortcuts_apply. */

describe("ShortcutsPane (§6.4 / 6.1)", () => {
  beforeEach(() => {
    setShortcutsSettings({
      quickRecord: "Super+Shift+R",
      pause: "Super+Shift+P",
      stop: "Super+Shift+S",
    });
    vi.clearAllMocks();
  });

  it("renders three binding rows with default values", () => {
    render(<ShortcutsPane />);
    expect(screen.getByText("Toggle record")).toBeInTheDocument();
    expect(screen.getByText("Pause / resume")).toBeInTheDocument();
    expect(screen.getByText("Stop & save")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Super+Shift+R")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Super+Shift+P")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Super+Shift+S")).toBeInTheDocument();
  });

  it("calls shortcutsApply with all bindings on Apply", async () => {
    render(<ShortcutsPane />);
    fireEvent.click(screen.getByRole("button", { name: /Apply shortcuts/ }));
    await waitFor(() =>
      expect(mockedShortcutsApply).toHaveBeenCalledWith([
        { action: "toggle_record", combo: "Super+Shift+R" },
        { action: "pause", combo: "Super+Shift+P" },
        { action: "stop", combo: "Super+Shift+S" },
      ]),
    );
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });

  it("records error toast when shortcuts are denied", async () => {
    mockedShortcutsApply.mockResolvedValue({
      granted: ["toggle_record"],
      denied: ["pause", "stop"],
    });
    render(<ShortcutsPane />);
    fireEvent.click(screen.getByRole("button", { name: /Apply shortcuts/ }));
    await waitFor(() =>
      expect(useSspStore.getState().toasts.some(
        (t) => t.kind === "error" && t.code === "portal.unavailable",
      )).toBe(true),
    );
  });
});
