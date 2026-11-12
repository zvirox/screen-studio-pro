import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FilesPane from "./FilesPane";
import { useSspStore } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
}));

import { settingsSet } from "../../lib/ipc";
const mockedSettingsSet = vi.mocked(settingsSet);

function setFilesSettings(files: { dir: string; namingPattern: string; container: string }) {
  useSspStore.setState({
    settings: {
      capture: null,
      captureLoading: false,
      files,
      filesLoading: false,
      shortcuts: null,
      shortcutsLoading: false,
    },
  });
}

/* §6.4 Settings — Files pane: output directory, naming pattern, container. */

describe("FilesPane (§6.4 / 6.1)", () => {
  beforeEach(() => {
    setFilesSettings({
      dir: "/home/user/Videos/SSP",
      namingPattern: "screen-%Y-%m-%d-%H%M",
      container: "mkv",
    });
    vi.clearAllMocks();
  });

  it("renders directory, naming pattern, and container controls", () => {
    render(<FilesPane />);
    expect(screen.getByLabelText(/Output directory/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Naming pattern/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Container format/)).toBeInTheDocument();
  });

  it("shows default directory", () => {
    render(<FilesPane />);
    const input = screen.getByLabelText(/Output directory/) as HTMLInputElement;
    expect(input.value).toBe("/home/user/Videos/SSP");
  });

  it("updates directory via settingsSet", async () => {
    render(<FilesPane />);
    const input = screen.getByLabelText(/Output directory/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/mnt/data/recordings" } });
    await waitFor(() =>
      expect(mockedSettingsSet).toHaveBeenCalledWith({
        files: { dir: "/mnt/data/recordings" },
      }),
    );
  });

  it("updates naming pattern via settingsSet", async () => {
    render(<FilesPane />);
    const input = screen.getByLabelText(/Naming pattern/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "rec-%Y%m%d" } });
    await waitFor(() =>
      expect(mockedSettingsSet).toHaveBeenCalledWith({
        files: { namingPattern: "rec-%Y%m%d" },
      }),
    );
  });

  it("updates container via settingsSet", async () => {
    render(<FilesPane />);
    const select = screen.getByLabelText(/Container format/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "mp4" } });
    await waitFor(() =>
      expect(mockedSettingsSet).toHaveBeenCalledWith({
        files: { container: "mp4" },
      }),
    );
  });

  it("rolls back on settingsSet rejection", async () => {
    mockedSettingsSet.mockRejectedValue({
      kind: "settings",
      code: "settings.invalid_value",
      userMessage: "Invalid path.",
      details: null,
      retryable: false,
    });
    render(<FilesPane />);
    const input = screen.getByLabelText(/Output directory/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/bad/path" } });
    await waitFor(() => expect(mockedSettingsSet).toHaveBeenCalled());
    // Value should roll back to original after rejection
    await waitFor(() => expect(input.value).toBe("/home/user/Videos/SSP"));
  });
});
