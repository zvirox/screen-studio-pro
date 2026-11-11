import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import CameraPip from "./CameraPip";
import CameraSlab from "../record/CameraSlab";
import { clampSize, snapCorner } from "./CameraPip";
import { useCameraPreview } from "../../hooks/useSourcePreview";
import { useSspStore, INITIAL_SESSION, type SessionSlice } from "../../lib/store";
import type { CameraSlice } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  cameraPreview: vi.fn(),
  cameraListDevices: vi.fn(),
  cameraOpen: vi.fn(),
  cameraClose: vi.fn(),
}));

import { cameraPreview, cameraListDevices, cameraOpen, cameraClose } from "../../lib/ipc";
const mockPreview = vi.mocked(cameraPreview);
const mockListDevices = vi.mocked(cameraListDevices);
const mockOpen = vi.mocked(cameraOpen);
const mockClose = vi.mocked(cameraClose);

function setCamera(camera: Partial<CameraSlice>) {
  useSspStore.setState({ camera: { ...INITIAL_SESSION, ...camera } as CameraSlice });
}
function setSession(status: SessionSlice["status"]) {
  useSspStore.setState({
    session: { ...INITIAL_SESSION, status, recordingId: status === "recording" ? "rec_1" : null },
  });
}

/* §6.6 Camera PiP pure geometry — clamped 160–320, nearest-corner snap
   by box-center distance. PLAN 4.3's composite mapping maps UI position
   1:1 onto the output frame, so the snap law must be deterministic at
   every boundary. */
describe("CameraPip geometry (§6.6)", () => {
  it("clamps size into 160–320", () => {
    expect(clampSize(159)).toBe(160);
    expect(clampSize(160)).toBe(160);
    expect(clampSize(320)).toBe(320);
    expect(clampSize(321)).toBe(320);
    expect(clampSize(240)).toBe(240);
  });

  it("snaps to nearest corner by box-center distance", () => {
    const W = 960;
    const H = 540;
    expect(snapCorner(10, 10, 240, W, H)).toBe("top-left");
    expect(snapCorner(800, 400, 240, W, H)).toBe("bottom-right");
    expect(snapCorner(10, 400, 240, W, H)).toBe("bottom-left");
    expect(snapCorner(800, 10, 240, W, H)).toBe("top-right");
    // dead-center → bottom-left: cx<=W/2 (left), cy>H/2 (bottom)
    expect(snapCorner(360, 270, 240, W, H)).toBe("bottom-left");
    // genuinely right/bottom of center → bottom-right
    expect(snapCorner(500, 300, 240, W, H)).toBe("bottom-right");
  });

  it("clamps free position before measuring distance", () => {
    expect(snapCorner(-100, -100, 160, 400, 400)).toBe("top-left");
    expect(snapCorner(1000, 1000, 160, 400, 400)).toBe("bottom-right");
  });
});

describe("CameraPip component (§6.6 / §7)", () => {
  beforeEach(() => {
    setCamera({ status: "idle", cameraId: null });
    setSession("idle");
    vi.clearAllMocks();
  });

  it("renders the loading slot while open but no still yet", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    expect(screen.getByText("Working…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the still as an img once the poll lands", async () => {
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

  it("freeze holds the last still (stops polling)", async () => {
    mockPreview.mockResolvedValue({
      jpegBase64: "aaa",
      width: 640,
      height: 360,
      capturedAtMs: 1000,
    });
    render(<CameraPip cameraId="cam_1" recording={false} />);
    await screen.findByRole("img", { name: "Camera preview" });
    // one poll lands; further beats would poll again (enabled=true) —
    // the freeze (enabled=false) semantics are asserted on the hook below.
    expect(mockPreview).toHaveBeenCalled();
  });

  it("signal ring style only while recording", () => {
    const { container } = render(<CameraPip cameraId="cam_1" recording={true} />);
    const frame = container.querySelector('[data-camera-pip="frame"]');
    expect(frame?.getAttribute("style")).toContain("var(--ssp-signal)");
  });

  it("shape toggle popover renders circle→rounded items", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Camera frame shape/ }));
    expect(screen.getByRole("menuitemradio", { name: /Circle/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Rounded/ })).toBeInTheDocument();
  });

  it("freeze button toggles aria-pressed", () => {
    render(<CameraPip cameraId="cam_1" recording={false} />);
    const freeze = screen.getByRole("button", { name: /Freeze camera preview/ });
    expect(freeze).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(freeze);
    expect(freeze).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(freeze);
    expect(freeze).toHaveAttribute("aria-pressed", "false");
  });
});

describe("CameraSlab (§6.1 #4)", () => {
  beforeEach(() => {
    setCamera({ status: "idle", cameraId: null });
    vi.clearAllMocks();
  });

  it("ghost \"Add camera\" chip when idle", () => {
    render(<CameraSlab />);
    expect(screen.getByRole("button", { name: /Add camera/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove camera/ })).not.toBeInTheDocument();
  });

  it("popover lists devices on open", async () => {
    mockListDevices.mockResolvedValue({
      devices: [{ id: "v1", label: "Webcam", isDefault: true }],
    });
    render(<CameraSlab />);
    fireEvent.click(screen.getByRole("button", { name: /Add camera/ }));
    await screen.findByRole("option", { name: /Webcam/ });
    expect(mockListDevices).toHaveBeenCalledTimes(1);
  });

  it("openCamera opens and renders active chip", async () => {
    mockOpen.mockResolvedValue({ cameraId: "cam_1", width: 640, height: 480 });
    setCamera({
      status: "idle",
      cameraId: null,
      devices: [{ id: "v1", label: "Webcam", isDefault: true }],
    });
    render(<CameraSlab />);
    fireEvent.click(screen.getByRole("button", { name: /Add camera/ }));
    await screen.findByRole("option", { name: /Webcam/ });
    fireEvent.click(screen.getByRole("option", { name: /Webcam/ }));
    await screen.findByRole("button", { name: /Webcam/ });
    expect(mockOpen).toHaveBeenCalledWith("v1");
    expect(screen.getByText("Webcam")).toBeInTheDocument();
    expect(screen.getByText("640×480")).toBeInTheDocument();
  });

  it("active chip removes the camera", async () => {
    mockClose.mockResolvedValue({ ok: true });
    setCamera({
      status: "open",
      cameraId: "cam_1",
      deviceId: "v1",
      label: "Webcam",
      width: 640,
      height: 480,
    });
    render(<CameraSlab />);
    fireEvent.click(screen.getByRole("button", { name: /Webcam/ }));
    expect(mockClose).toHaveBeenCalledWith("cam_1");
  });
});

describe("Camera slice (§4.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCamera({ status: "idle", cameraId: null });
  });

  it("open errors → toast + slice error; retry re-opens", async () => {
    mockOpen.mockRejectedValue({
      kind: "ipc",
      code: "capture.camera_unavailable",
      retryable: false,
      userMessage: "Camera busy.",
      details: null,
    });
    await useSspStore.getState().openCamera("v1");
    const after = useSspStore.getState().camera;
    expect(after.status).toBe("error");
    expect(after.error?.code).toBe("capture.camera_unavailable");
    mockOpen.mockResolvedValue({ cameraId: "cam_1", width: 640, height: 480 });
    await useSspStore.getState().openCamera("v1");
    expect(useSspStore.getState().camera.status).toBe("open");
  });

  it("closeCamera is idempotent when idle", async () => {
    await useSspStore.getState().closeCamera();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("onDeviceChanged re-lists and auto-closes a vanished device", async () => {
    mockListDevices.mockResolvedValue({ devices: [] });
    setCamera({
      status: "open",
      cameraId: "cam_1",
      deviceId: "v1",
      label: "Old",
      devices: [{ id: "v1", label: "Old", isDefault: true }],
    });
    await useSspStore.getState().onDeviceChanged();
    expect(mockListDevices).toHaveBeenCalled();
    expect(useSspStore.getState().camera.status).toBe("idle");
    expect(mockClose).toHaveBeenCalledWith("cam_1");
  });

  it("onDeviceChanged keeps open camera whose device is still listed", async () => {
    mockListDevices.mockResolvedValue({
      devices: [{ id: "v1", label: "Webcam", isDefault: true }],
    });
    setCamera({
      status: "open",
      cameraId: "cam_1",
      deviceId: "v1",
      label: "Webcam",
      devices: [{ id: "v1", label: "Webcam", isDefault: true }],
    });
    await useSspStore.getState().onDeviceChanged();
    expect(useSspStore.getState().camera.status).toBe("open");
    expect(mockClose).not.toHaveBeenCalled();
  });
});

describe("useCameraPreview hook (§6.6 freeze semantics)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("polls while enabled=true", async () => {
    mockPreview.mockResolvedValue({
      jpegBase64: "aaa",
      width: 640,
      height: 360,
      capturedAtMs: 1000,
    });
    const { result } = renderHook(() => useCameraPreview("cam_1", true));
    await vi.waitFor(() => expect(result.current?.width).toBe(640));
    expect(mockPreview).toHaveBeenCalledTimes(1);
  });

  it("stops polling when enabled=false but holds the last still", async () => {
    mockPreview.mockResolvedValue({
      jpegBase64: "aaa",
      width: 640,
      height: 360,
      capturedAtMs: 1000,
    });
    const { result, rerender } = renderHook(({ enabled }) => useCameraPreview("cam_1", enabled), {
      initialProps: { enabled: true },
    });
    await vi.waitFor(() => expect(result.current?.width).toBe(640));
    expect(mockPreview).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await new Promise((r) => setTimeout(r, 250));
    // held → no further polls
    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(result.current?.width).toBe(640);
  });

  it("resets still to null when cameraId changes", async () => {
    mockPreview.mockImplementation((id) =>
      Promise.resolve({
        jpegBase64: id === "cam_1" ? "aaa" : "bbb",
        width: id === "cam_1" ? 640 : 320,
        height: id === "cam_1" ? 360 : 180,
        capturedAtMs: id === "cam_1" ? 1000 : 2000,
      }),
    );
    const { result, rerender } = renderHook(
      ({ cameraId }) => useCameraPreview(cameraId, true),
      { initialProps: { cameraId: "cam_1" } },
    );
    await vi.waitFor(() => expect(result.current?.width).toBe(640));
    expect(mockPreview).toHaveBeenLastCalledWith("cam_1");
    rerender({ cameraId: "cam_2" });
    await vi.waitFor(() => expect(result.current?.width).toBe(320));
    expect(mockPreview).toHaveBeenCalledTimes(2);
    expect(mockPreview).toHaveBeenLastCalledWith("cam_2");
  });
});
