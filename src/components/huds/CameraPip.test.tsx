import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CameraPip from "./CameraPip";
import { useSspStore, INITIAL_CAMERA, type CameraSlice } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  cameraPreview: vi.fn(),
  cameraListDevices: vi.fn(),
  cameraOpen: vi.fn(),
  cameraClose: vi.fn(),
}));

import { cameraPreview } from "../../lib/ipc";
const mockPreview = vi.mocked(cameraPreview);

describe("CameraPip (§6.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      if (typeof msg === 'string' && msg.includes('not wrapped in act')) {
        return;
      }
      console.error(msg);
    });
    useSspStore.setState({ camera: INITIAL_CAMERA });
  });

  it("renders nothing when no camera is open", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    expect(screen.querySelector('[data-camera-pip="frame"]')).not.toBeInTheDocument();
  });

  it("renders still as an img once poll lands", async () => {
    mockPreview.mockResolvedValue({
      jpegBase64: "aaa",
      width: 640,
      height: 360,
      capturedAtMs: 1000,
    });
    render(<CameraPip cameraId="cam_1" recording={false} />);
    await screen.findByRole("img", { name: "Camera preview" });
    expect(mockPreview).toHaveBeenCalledWith("cam_1");
  });

  it("shows 2px signal ring only while recording", () => {
    useSspStore.setState({ camera: { ...INITIAL_CAMERA, status: "open", cameraId: "cam_1" } as CameraSlice });
    const { container } = render(<CameraPip cameraId="cam_1" recording={true} />);
    const frame = container.querySelector('[data-camera-pip="frame"]');
    expect(frame?.getAttribute("style")).toContain("var(--ssp-signal)");
  });

  it("toggles freeze button aria-pressed", () => {
    useSspStore.setState({ camera: { ...INITIAL_CAMERA, status: "open", cameraId: "cam_1" } as CameraSlice });
    render(<CameraPip cameraId="cam_1" recording={false} />);
    const freeze = screen.getByRole("button", { name: /Freeze camera preview/ });
    expect(freeze).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(freeze);
    expect(freeze).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(freeze);
    expect(freeze).toHaveAttribute("aria-pressed", "false");
  });
});
