import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CameraPip from "./CameraPip";
import { useSspStore } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  cameraPreview: vi.fn(),
  cameraListDevices: vi.fn(),
  cameraOpen: vi.fn(),
  cameraClose: vi.fn(),
  prefsGet: vi.fn(),
  prefsSet: vi.fn(),
}));

import { cameraPreview } from "../../lib/ipc";
const mockPreview = vi.mocked(cameraPreview);

const EMPTY_CAMERA = {
  status: "idle" as const,
  cameraId: null,
  deviceId: null,
  label: null,
  width: null,
  height: null,
  error: null,
  devices: null,
  devicesLoading: false,
};

const CAMERA_OPEN = {
  ...EMPTY_CAMERA,
  status: "open" as const,
  cameraId: "cam_1",
  deviceId: "v1",
  label: "Webcam",
  width: 640,
  height: 480,
};

describe("CameraPip (§6.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      if (typeof msg === 'string' && msg.includes('not wrapped in act')) {
        return;
      }
      console.error(msg);
    });
    vi.mocked(useSspStore).mockReturnValue({
      library: EMPTY_CAMERA,
      loadCameraDevices: vi.fn(),
      cameraListDevices: vi.fn(),
      cameraOpen: vi.fn(),
      cameraClose: vi.fn(),
      cameraPreview: vi.fn(),
      cameraClose: vi.fn(),
    });
  });

  it("renders loading slot when no still yet", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Working…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders still img once poll lands", async () => {
    mockPreview.mockResolvedValue({
      jpegBase64: "aaa",
      width: 640,
      height: 360,
      capturedAtMs: 1000,
    } as any);
    render(<CameraPip cameraId="cam_1" recording={false} />);
    await screen.findByRole("img", { name: "Camera preview" });
    expect(mockPreview).toHaveBeenCalledWith("cam_1");
  });

  it("shows 2px signal ring only while recording", () => {
    const { container } = render(<CameraPip cameraId="cam_1" recording={true} />);
    const frame = container.querySelector('[data-camera-pip="frame"]');
    expect(frame?.getAttribute("style")).toContain("var(--ssp-signal)");
  });

  it("shows circle shape toggle popover", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Camera frame shape/ }));
    expect(screen.getByRole("menuitemradio", { name: /Circle/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Rounded/ })).toBeInTheDocument();
  });

  it("toggles freeze with aria-pressed", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    const freeze = screen.getByRole("button", { name: /Freeze camera preview/ });
    expect(freeze).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(freeze);
    expect(freeze).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(freeze);
    expect(freeze).toHaveAttribute("aria-pressed", "false");
  });
});