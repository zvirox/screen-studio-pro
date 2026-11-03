import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSspStore, INITIAL_SOURCE, INITIAL_SESSION } from "../../lib/store";
import type { AudioListDevicesReply } from "../../types/ipc";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  audioSetChannel: vi.fn(),
  audioListDevices: vi.fn(),
  settingsGet: vi.fn(),
}));

import {
  audioSetChannel,
  audioListDevices,
  settingsGet,
} from "../../lib/ipc";
import AudioStrip from "./AudioStrip";

/* §6.1 #3 audio strip (2.2) — pane with two channel cards: device name,
   4px meter bar (accent fill, signal above −6 dB), per-channel switch,
   device-select popover (§5.10 44px rows, System default first). §6.3
   education: "Speak to test your mic level" is MIC-card only — no
   invented desktop copy. */

// jsdom lacks the two browser APIs Radix/floating-ui rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  window.ResizeObserver =
    window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);
});

/** Flush the strip's effect-driven store updates (loadAudio's async
    resolution replaces the slice) before synchronous asserts. */
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

const DEVICES: AudioListDevicesReply = {
  mics: [
    { id: "alsa:yeti", label: "Blue Yeti", isDefault: true },
    { id: "alsa:cam", label: "Webcam mic", isDefault: false },
  ],
  desktop: [{ id: "pwp:speakers", label: "Speakers (monitor)", isDefault: false }],
};

function readyStrip(meters?: { rms: number; peak: number } | null) {
  useSspStore.setState({
    audio: {
      status: "ready",
      error: null,
      mic: { enabled: true, muted: false, deviceId: null, level: 80 },
      desktop: { enabled: true, muted: false, deviceId: null, level: 70 },
      meters: meters
        ? { mic: meters, desktop: { rms: 0.1, peak: 0.1 } }
        : null,
      devices: null,
      devicesLoading: false,
    },
  });
}

describe("AudioStrip (§6.1 #3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsGet).mockResolvedValue({
      micDeviceId: null,
      desktopAudio: true,
      echoCancel: false,
      micEnabled: true,
      micMuted: false,
      micLevel: 80,
      desktopDeviceId: null,
      desktopMuted: false,
      desktopLevel: 70,
    });
    useSspStore.setState({
      source: INITIAL_SOURCE,
      session: INITIAL_SESSION,
      audio: {
        status: "idle",
        error: null,
        mic: { enabled: false, muted: false, deviceId: null, level: 100 },
        desktop: { enabled: false, muted: false, deviceId: null, level: 100 },
        meters: null,
        devices: null,
        devicesLoading: false,
      },
      toasts: [],
      nextToastId: 1,
    });
  });

  it("renders two channel cards labeled Mic and Desktop", () => {
    readyStrip();
    render(<AudioStrip />);
    expect(screen.getByRole("group", { name: "Mic" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Desktop" })).toBeDefined();
  });

  it("loads audio settings on mount (busy slice defaults otherwise)", async () => {
    render(<AudioStrip />);
    await flushEffects();
    expect(settingsGet).toHaveBeenCalledWith("audio");
  });

  it("labels each card with its device or System default", async () => {
    readyStrip();
    render(<AudioStrip />);
    await flushEffects();
    const mic = screen.getByRole("group", { name: "Mic" });
    expect(within(mic).getByText("System default")).toBeDefined();
    const desktop = screen.getByRole("group", { name: "Desktop" });
    expect(within(desktop).getByText("System default")).toBeDefined();
  });

  it("the meter bar renders peak with a signal-colored segment above −6 dB", async () => {
    readyStrip({ rms: 0.2, peak: 0.7 });
    render(<AudioStrip />);
    await flushEffects();
    const mic = screen.getByRole("group", { name: "Mic" });
    const fill = mic.querySelector('[data-testid="mic-meter-fill"]') as HTMLElement;
    // 70% peak: accent up to 50% of the TRACK, signal for the 50–70%
    // stretch (−6 dBFS). Spans are relative to the fill container.
    expect(parseFloat(fill.style.width)).toBeCloseTo(70, 3);
    const hot = mic.querySelector('[data-testid="mic-meter-hot"]') as HTMLElement;
    expect(parseFloat(hot.style.width.replace("%", ""))).toBeCloseTo(
      (0.2 / 0.7) * 100,
      1,
    );
  });

  it("a silent mic shows the §6.3 education label; a live one does not", async () => {
    readyStrip({ rms: 0, peak: 0 });
    const { rerender } = render(<AudioStrip />);
    await flushEffects();
    const mic = screen.getByRole("group", { name: "Mic" });
    expect(within(mic).getByText("Speak to test your mic level")).toBeDefined();
    // No invented desktop copy — the §6.3 audio-silent line exists only
    // where the law names it.
    const desktop = screen.getByRole("group", { name: "Desktop" });
    expect(
      within(desktop).queryByText("Speak to test your mic level"),
    ).toBeNull();

    readyStrip({ rms: 0.3, peak: 0.3 });
    await rerender(<AudioStrip />);
    await flushEffects();
    expect(
      within(screen.getByRole("group", { name: "Mic" })).queryByText(
        "Speak to test your mic level",
      ),
    ).toBeNull();
  });

  it("toggling the switch persists through audio_set_channel", async () => {
    readyStrip();
    vi.mocked(audioSetChannel).mockResolvedValue({ ok: true });
    render(<AudioStrip />);
    await flushEffects();
    const mic = screen.getByRole("group", { name: "Mic" });
    fireEvent.click(within(mic).getByRole("switch"));
    await vi.waitFor(() => {
      expect(audioSetChannel).toHaveBeenCalledWith({ channel: "mic", enabled: false });
    });
  });

  it("strip controls are disabled while a take is not idle", () => {
    readyStrip();
    useSspStore.setState({
      session: { ...INITIAL_SESSION, status: "recording", recordingId: "rec_1" },
    });
    render(<AudioStrip />);
    const mic = screen.getByRole("group", { name: "Mic" });
    expect((within(mic).getByRole("switch") as HTMLButtonElement).disabled).toBe(
      true,
    );
    // The device trigger too — the take snapshot is already taken.
    expect(
      (within(mic).getByRole("button", { name: /System default/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("the popover lists System default first, then §2.2 devices with the selected checked", async () => {
    readyStrip();
    vi.mocked(audioListDevices).mockResolvedValue(DEVICES);
    render(<AudioStrip />);
    await flushEffects();
    const mic = screen.getByRole("group", { name: "Mic" });
    fireEvent.click(within(mic).getByRole("button", { name: /System default/ }));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options[0]!.textContent).toContain("System default");
    expect(options[1]!.textContent).toContain("Blue Yeti");
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(options[1]!.getAttribute("aria-selected")).toBe("false");
  });

  it("picking a device persists it and closes the popover", async () => {
    readyStrip();
    vi.mocked(audioListDevices).mockResolvedValue(DEVICES);
    vi.mocked(audioSetChannel).mockResolvedValue({ ok: true });
    render(<AudioStrip />);
    await flushEffects();
    const mic = screen.getByRole("group", { name: "Mic" });
    fireEvent.click(within(mic).getByRole("button", { name: /System default/ }));
    const options = await screen.findAllByRole("option");
    fireEvent.click(options[1]!); // Blue Yeti
    await vi.waitFor(() => {
      expect(audioSetChannel).toHaveBeenCalledWith({
        channel: "mic",
        deviceId: "alsa:yeti",
      });
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });
});
