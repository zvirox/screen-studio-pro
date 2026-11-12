import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CameraPane from "./CameraPane";
import { useSspStore, type CameraSlice, INITIAL_CAMERA } from "../../lib/store";
import type { CaptureSettings } from "../../types/ipc";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
}));

import { settingsSet } from "../../lib/ipc";
const mockedSettingsSet = vi.mocked(settingsSet);

function setCameraState(camera: Partial<CameraSlice>) {
  useSspStore.setState({ camera: { ...INITIAL_CAMERA, ...camera } as CameraSlice });
}
function setCaptureSettings(capture: Partial<CaptureSettings>) {
  useSspStore.setState({ settings: { capture: capture as CaptureSettings, captureLoading: false } });
}

/* §6.4 Camera pane — self-insert toggle reads/writes
   settings.capture.camera_self_insert; shows camera status. */
describe("CameraPane (§6.4 / 4.4)", () => {
  beforeEach(() => {
    setCameraState({ status: "idle", cameraId: null });
    setCaptureSettings({ cameraSelfInsert: false });
    vi.clearAllMocks();
  });

  it("renders self-insert toggle off by default", () => {
    render(<CameraPane />);
    expect(screen.getByRole("switch", { name: /Self-insert camera in recording/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows no-camera education when idle", () => {
    render(<CameraPane />);
    expect(screen.getByText(/No camera open/)).toBeInTheDocument();
    // Toggle disabled while no camera is open.
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("toggles self-insert and persists via settingsSet", async () => {
    setCameraState({
      status: "open",
      cameraId: "cam_1",
      deviceId: "v1",
      label: "Webcam",
      width: 640,
      height: 480,
    });

    render(<CameraPane />);
    expect(screen.getByRole("switch")).not.toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: /Self-insert camera in recording/ }));
    await waitFor(() =>
      expect(mockedSettingsSet).toHaveBeenCalledWith({ capture: { cameraSelfInsert: true } }),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back toggle on settingsSet rejection", async () => {
    mockedSettingsSet.mockRejectedValue({
      kind: "ipc",
      code: "settings.invalid_value",
      userMessage: "Bad value.",
      details: null,
    });
    setCameraState({
      status: "open",
      cameraId: "cam_1",
      deviceId: "v1",
      label: "Webcam",
      width: 640,
      height: 480,
    });

    render(<CameraPane />);
    fireEvent.click(screen.getByRole("switch", { name: /Self-insert camera in recording/ }));
    await waitFor(() =>
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"),
    );
  });
});
