import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NavBar from "./NavBar";
import navBarSource from "./NavBar.tsx?raw";
import { useSspStore } from "../../lib/store";

// Mock Tauri window API
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockMinimize = vi.fn().mockResolvedValue(undefined);
const mockToggleMaximize = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mockClose,
    minimize: mockMinimize,
    toggleMaximize: mockToggleMaximize,
  }),
}));

/* Feature 3: Integrated Custom CSD Titlebar (NavBar CSD)
   Provenance: DESIGN.md v3.1 §5.1, ORIGINAL_REQUEST.md §R2, PROJECT.md M2 / Stage v3.2
   Verifies:
   - CSD Window control dots (Close, Minimize, Maximize) with accessible names and Tauri API dispatch
   - Centered 3-tab view capsule (Record | Library | Settings) with keyboard roving and state transitions
   - Telemetry pill badge with mono typography, hardware encoder status, and green indicator
   - 40px Primary Record pill CTA button with idle/recording state reflection and start/stop actions
   - data-tauri-drag-region metadata */

describe("Integrated Studio Titlebar (NavBar CSD)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSspStore.setState({
      view: "record",
      toasts: [],
      session: {
        status: "idle",
        recordingId: null,
        encoderBackend: "vaapi",
        startedAt: null,
        elapsedMs: 0,
        paused: false,
        fault: null,
        stats: null,
      },
      presets: {
        status: "ready",
        error: null,
        presets: [
          {
            id: "youtube",
            label: "For YouTube",
            description: "1080p60, ~12 Mbps",
            fps: 60,
            height: 1080,
            container: "mp4",
          },
          {
            id: "discord",
            label: "For Discord",
            description: "720p30, ~6 Mbps",
            fps: 30,
            height: 720,
            container: "mp4",
          },
        ],
        presetId: "youtube",
      },
      source: {
        status: "idle",
        sourceId: null,
        label: null,
        capabilities: null,
        error: null,
        selectingKind: null,
        regionRect: null,
      },
    });
  });

  describe("Window Control Dots (CSD)", () => {
    it("renders close, minimize, and maximize buttons with accessible labels", () => {
      render(<NavBar />);
      expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    });

    it("triggers window minimize when minimize button is clicked", async () => {
      render(<NavBar />);
      const minBtn = screen.getByRole("button", { name: "Minimize window" });
      fireEvent.click(minBtn);
      await waitFor(() => {
        expect(mockMinimize).toHaveBeenCalledTimes(1);
      });
    });

    it("triggers window toggleMaximize when maximize button is clicked", async () => {
      render(<NavBar />);
      const maxBtn = screen.getByRole("button", { name: "Maximize window" });
      fireEvent.click(maxBtn);
      await waitFor(() => {
        expect(mockToggleMaximize).toHaveBeenCalledTimes(1);
      });
    });

    it("triggers window close when close button is clicked", async () => {
      render(<NavBar />);
      const closeBtn = screen.getByRole("button", { name: "Close window" });
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(mockClose).toHaveBeenCalledTimes(1);
      });
    });

    it("handles window API exceptions gracefully without crashing", async () => {
      mockClose.mockRejectedValueOnce(new Error("Tauri IPC bridge disconnected"));
      render(<NavBar />);
      const closeBtn = screen.getByRole("button", { name: "Close window" });
      expect(() => fireEvent.click(closeBtn)).not.toThrow();
    });

    it("satisfies hit target ergonomics and keyboard focus visibility law", () => {
      render(<NavBar />);
      const buttons = [
        screen.getByRole("button", { name: "Close window" }),
        screen.getByRole("button", { name: "Minimize window" }),
        screen.getByRole("button", { name: "Maximize window" }),
      ];

      for (const btn of buttons) {
        expect(btn).toHaveClass("h-9", "w-9");
        expect(btn).toHaveClass("focus-visible:outline-2");
        expect(btn).toHaveClass("focus-visible:outline-focus");
      }
    });

    it("enforces Linear square icons without legacy macOS CSD traffic-light dots", () => {
      render(<NavBar />);
      const closeBtn = screen.getByRole("button", { name: "Close window" });
      const minBtn = screen.getByRole("button", { name: "Minimize window" });
      const maxBtn = screen.getByRole("button", { name: "Maximize window" });

      expect(closeBtn.querySelector(".csd-dot-close")).toBeNull();
      expect(minBtn.querySelector(".csd-dot-min")).toBeNull();
      expect(maxBtn.querySelector(".csd-dot-max")).toBeNull();
    });
  });

  describe("Centered 3-Tab View Capsule", () => {
    it("renders the 3 primary tabs: Record, Library, Settings", () => {
      render(<NavBar />);
      expect(screen.getByRole("tab", { name: /Record/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Library/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Settings/i })).toBeInTheDocument();
    });

    it("links every tab to the shared workspace panel", () => {
      render(<NavBar />);
      for (const name of ["Record", "Library", "Settings"]) {
        expect(screen.getByRole("tab", { name })).toHaveAttribute(
          "aria-controls",
          "main-workspace",
        );
      }
    });

    it("marks Record as active by default", () => {
      render(<NavBar />);
      const recordTab = screen.getByRole("tab", { name: /Record/i });
      const libraryTab = screen.getByRole("tab", { name: /Library/i });
      expect(recordTab).toHaveAttribute("aria-selected", "true");
      expect(libraryTab).toHaveAttribute("aria-selected", "false");
    });

    it("switches views when a tab is clicked", () => {
      render(<NavBar />);
      const libraryTab = screen.getByRole("tab", { name: /Library/i });
      fireEvent.click(libraryTab);
      expect(useSspStore.getState().view).toBe("library");

      const settingsTab = screen.getByRole("tab", { name: /Settings/i });
      fireEvent.click(settingsTab);
      expect(useSspStore.getState().view).toBe("settings");
    });

    it("roves focus and selection with arrow keys across the 3 tabs", () => {
      render(<NavBar />);
      const recordTab = screen.getByRole("tab", { name: /Record/i });
      recordTab.focus();

      // Right arrow moves from Record to Library
      fireEvent.keyDown(recordTab, { key: "ArrowRight" });
      expect(useSspStore.getState().view).toBe("library");

      // Right arrow moves from Library to Settings
      const libraryTab = screen.getByRole("tab", { name: /Library/i });
      fireEvent.keyDown(libraryTab, { key: "ArrowRight" });
      expect(useSspStore.getState().view).toBe("settings");

      // Right arrow on Settings wraps around to Record
      const settingsTab = screen.getByRole("tab", { name: /Settings/i });
      fireEvent.keyDown(settingsTab, { key: "ArrowRight" });
      expect(useSspStore.getState().view).toBe("record");
    });

    it("supports Home and End keyboard shortcuts", () => {
      render(<NavBar />);
      const recordTab = screen.getByRole("tab", { name: /Record/i });
      recordTab.focus();

      // End moves directly to Settings
      fireEvent.keyDown(recordTab, { key: "End" });
      expect(useSspStore.getState().view).toBe("settings");

      // Home moves directly back to Record
      const settingsTab = screen.getByRole("tab", { name: /Settings/i });
      fireEvent.keyDown(settingsTab, { key: "Home" });
      expect(useSspStore.getState().view).toBe("record");
    });
  });

  describe("Telemetry Pill Badge", () => {
    it("renders telemetry specs with mono font and green status indicator", () => {
      render(<NavBar />);
      const badge = screen.getByLabelText(/Telemetry: 1080p60 VAAPI/i);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("1080p60 VAAPI");
    });

    it("dynamically reflects updated preset and encoder from store", () => {
      useSspStore.setState({
        presets: {
          status: "ready",
          error: null,
          presets: [
            {
              id: "discord",
              label: "For Discord",
              description: "720p30, ~6 Mbps",
              fps: 30,
              height: 720,
              container: "mp4",
            },
          ],
          presetId: "discord",
        },
        session: {
          status: "idle",
          recordingId: null,
          encoderBackend: "nvenc",
          startedAt: null,
          elapsedMs: 0,
          paused: false,
          fault: null,
          stats: null,
        },
      });

      render(<NavBar />);
      const badge = screen.getByLabelText(/Telemetry: 720p30 NVENC/i);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("720p30 NVENC");
    });

    it("uses design token bg-success for telemetry status indicator", () => {
      render(<NavBar />);
      const badge = screen.getByLabelText(/Telemetry: 1080p60 VAAPI/i);
      const dot = badge.querySelector("span[aria-hidden='true']");
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveClass("bg-success");
      expect(dot?.className).not.toMatch(/\bbg-(?:emerald|green|teal)-\d{2,3}\b/);
    });
  });

  describe("40px Primary Record CTA Button", () => {
    it("renders in idle state with 40px height styling, 6px Linear radius, and Record label", () => {
      render(<NavBar />);
      const ctaBtn = screen.getByRole("button", { name: "Record" });
      expect(ctaBtn).toBeInTheDocument();
      expect(ctaBtn).toHaveClass("min-h-10");
      expect(ctaBtn).toHaveClass("rounded-sm");
      expect(ctaBtn).not.toHaveClass("rounded-full");
      expect(ctaBtn).toHaveClass("bg-primary");
    });

    it("triggers startRecording when clicked in idle state", async () => {
      const startSpy = vi.fn().mockResolvedValue(undefined);
      useSspStore.setState({ startRecording: startSpy });

      render(<NavBar />);
      const ctaBtn = screen.getByRole("button", { name: "Record" });
      fireEvent.click(ctaBtn);

      await waitFor(() => {
        expect(startSpy).toHaveBeenCalledTimes(1);
      });
    });

    it("reflects live recording state with signal styling, pulse, and duration timer", () => {
      useSspStore.setState({
        session: {
          status: "recording",
          recordingId: "rec_123",
          encoderBackend: "vaapi",
          startedAt: new Date().toISOString(),
          elapsedMs: 75000, // 1m 15s
          paused: false,
          fault: null,
          stats: null,
        },
      });

      render(<NavBar />);
      const stopBtn = screen.getByRole("button", { name: "Stop recording" });
      expect(stopBtn).toBeInTheDocument();
      expect(stopBtn).toHaveClass("bg-primary");
      const pulse = stopBtn.querySelector(".animate-pulse-rec");
      expect(pulse).toBeInTheDocument();
      expect(pulse).toHaveClass("motion-reduce:animate-none");
      expect(stopBtn).toHaveTextContent("1:15");
      expect(stopBtn).toHaveTextContent("Stop");
    });

    it("triggers stopRecording when clicked in live recording state", async () => {
      const stopSpy = vi.fn().mockResolvedValue(undefined);
      useSspStore.setState({
        stopRecording: stopSpy,
        session: {
          status: "recording",
          recordingId: "rec_123",
          encoderBackend: "vaapi",
          startedAt: new Date().toISOString(),
          elapsedMs: 3000,
          paused: false,
          fault: null,
          stats: null,
        },
      });

      render(<NavBar />);
      const stopBtn = screen.getByRole("button", { name: "Stop recording" });
      fireEvent.click(stopBtn);

      await waitFor(() => {
        expect(stopSpy).toHaveBeenCalledTimes(1);
      });
    });

    it("disables button while session transition is starting or stopping", () => {
      useSspStore.setState({
        session: {
          status: "starting",
          recordingId: null,
          encoderBackend: null,
          startedAt: null,
          elapsedMs: 0,
          paused: false,
          fault: null,
          stats: null,
        },
      });

      render(<NavBar />);
      const ctaBtn = screen.getByRole("button", { name: "Record" });
      expect(ctaBtn).toBeDisabled();
      expect(ctaBtn).toHaveTextContent("Starting...");
    });
  });

  describe("Window Drag Region", () => {
    it("carries data-tauri-drag-region on header element", () => {
      render(<NavBar />);
      const header = screen.getByRole("banner");
      expect(header).toHaveAttribute("data-tauri-drag-region");
    });
  });

  describe("Design System & Accessibility Compliance", () => {
    it("ensures NavBar source contains zero raw hex literals and no unsanctioned colors", () => {
      // Zero raw hex literals
      const hexMatches = navBarSource.match(/#[0-9a-fA-F]{3,8}\b/g);
      expect(hexMatches).toBeNull();

      // No unsanctioned emerald color
      expect(navBarSource).not.toContain("emerald");
    });
  });
});
