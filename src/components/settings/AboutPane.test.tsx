import { render, screen, expect, it, describe } from "vitest";
import { beforeEach, vi } from "vitest";
import AboutPane from "./AboutPane";
import { useSspStore } from "../../lib/store";

/* §6.4 Settings — About pane: read-only app/version/capabilities info. */

describe("AboutPane (§6.4 / 6.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      capabilities: {
        encoders: [
          { backend: "vaapi", isHardware: true, available: true },
          { backend: "x264", isHardware: false, available: true },
        ],
        portal: {
          screencast: true,
          globalShortcuts: "partial",
          compositor: "kwin_wayland",
        },
        version: { app: "0.0.1-alpha.1", ipcContract: "1.6.0" },
      },
    });
  });

  it("renders app name and version", () => {
    render(<AboutPane />);
    expect(screen.getByText("ScreenStudio Pro")).toBeInTheDocument();
    expect(screen.getByText("0.0.1-alpha.1")).toBeInTheDocument();
  });

  it("renders IPC contract version", () => {
    render(<AboutPane />);
    expect(screen.getByText("1.6.0")).toBeInTheDocument();
  });

  it("renders capability matrix", () => {
    render(<AboutPane />);
    expect(screen.getByText("Screencast")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Global shortcuts")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText("Compositor")).toBeInTheDocument();
    expect(screen.getByText("kwin_wayland")).toBeInTheDocument();
  });

  it("shows no telemetry notice", () => {
    render(<AboutPane />);
    expect(screen.getByText(/No servers, no cloud, no telemetry/)).toBeInTheDocument();
  });
});
