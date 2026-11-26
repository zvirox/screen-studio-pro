import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AudioMixerDeck from "./AudioMixerDeck";
import { INITIAL_SESSION, useSspStore } from "../../lib/store";
import type { AudioListDevicesReply } from "../../types/ipc";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  audioSetChannel: vi.fn(),
  audioListDevices: vi.fn(),
  settingsGet: vi.fn(),
}));

import { audioListDevices, audioSetChannel, settingsGet } from "../../lib/ipc";
import type { AudioSettings } from "../../types/ipc";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.ResizeObserver =
    window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

const DEVICES: AudioListDevicesReply = {
  mics: [
    { id: "alsa:yeti", label: "Blue Yeti Pro", isDefault: true },
    { id: "alsa:cam", label: "Webcam mic", isDefault: false },
  ],
  desktop: [{ id: "pwp:speakers", label: "Speakers (monitor)", isDefault: false }],
};

function setupStore(meters?: { rms: number; peak: number } | null) {
  useSspStore.setState({
    session: INITIAL_SESSION,
    audio: {
      status: "ready",
      error: null,
      mic: { enabled: true, muted: false, deviceId: null, level: 80 },
      desktop: { enabled: true, muted: false, deviceId: null, level: 70 },
      meters: meters
        ? { mic: meters, desktop: { rms: 0.1, peak: 0.1 } }
        : null,
      devices: null,
      noiseSuppression: true,
  ducking: true,
      devicesLoading: false,
    },
  });
}

describe("AudioMixerDeck (Stage v3.5 Sub-Canvas Floating Audio Mixer Deck)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudioSettings: AudioSettings = {
      micDeviceId: null,
      desktopAudio: true,
      echoCancel: false,
  noiseSuppression: true,
  ducking: true,
      micEnabled: true,
      micMuted: false,
      micLevel: 80,
      desktopDeviceId: null,
      desktopMuted: false,
      desktopLevel: 70,
    };
    vi.mocked(settingsGet).mockResolvedValue(mockAudioSettings as unknown as Awaited<ReturnType<typeof settingsGet>>);
  });

  it("renders both Mic and Desktop channel cards with DSP badges and meters", async () => {
    setupStore({ rms: 0.3, peak: 0.7 });
    render(<AudioMixerDeck />);
    await flushEffects();

    expect(screen.getByRole("region", { name: "Audio Mixer Deck" })).toBeInTheDocument();
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("Desktop Audio")).toBeInTheDocument();

    // DSP Badges
    expect(screen.getByText("RNNoise")).toBeInTheDocument();
    expect(screen.getByText("Gate")).toBeInTheDocument();
    expect(screen.getByText("Auto-Ducking")).toBeInTheDocument();

    // Live meter reading in dBFS
    expect(screen.getByTestId("mic-meter-fill")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-meter-fill")).toBeInTheDocument();
  });

  it("toggles microphone mute state when clicking mute button", async () => {
    setupStore();
    vi.mocked(audioSetChannel).mockResolvedValue({ ok: true });

    render(<AudioMixerDeck />);
    await flushEffects();

    const micGroup = screen.getByRole("group", { name: "Mic" });
    const muteBtn = within(micGroup).getByRole("button", { name: /mute microphone/i });
    fireEvent.click(muteBtn);

    expect(vi.mocked(audioSetChannel)).toHaveBeenCalledWith({
      channel: "mic",
      muted: true,
    });
  });

  it("adjusts microphone gain slider and emits audioSetChannel", async () => {
    setupStore();
    vi.mocked(audioSetChannel).mockResolvedValue({ ok: true });

    render(<AudioMixerDeck />);
    await flushEffects();

    const micGroup = screen.getByRole("group", { name: "Mic" });
    const slider = within(micGroup).getByRole("slider", { name: "Mic input gain" });
    fireEvent.change(slider, { target: { value: "95" } });

    expect(vi.mocked(audioSetChannel)).toHaveBeenCalledWith({
      channel: "mic",
      level: 95,
    });
  });

  it("toggles desktop audio mute state when clicking mute button", async () => {
    setupStore();
    vi.mocked(audioSetChannel).mockResolvedValue({ ok: true });

    render(<AudioMixerDeck />);
    await flushEffects();

    const desktopGroup = screen.getByRole("group", { name: "Desktop" });
    const muteBtn = within(desktopGroup).getByRole("button", { name: /mute desktop audio/i });
    fireEvent.click(muteBtn);

    expect(vi.mocked(audioSetChannel)).toHaveBeenCalledWith({
      channel: "desktop",
      muted: true,
    });
  });

  it("displays silent hint when microphone is silent", async () => {
    setupStore({ rms: 0, peak: 0 }); // peak < 0.01

    render(<AudioMixerDeck />);
    await flushEffects();

    expect(screen.getByText("Speak to test your mic level")).toBeInTheDocument();
  });

  it("opens device popover and selects an audio device", async () => {
    setupStore();
    vi.mocked(audioListDevices).mockResolvedValue(DEVICES);
    vi.mocked(audioSetChannel).mockResolvedValue({ ok: true });

    render(<AudioMixerDeck />);
    await flushEffects();

    const micGroup = screen.getByRole("group", { name: "Mic" });
    const popoverTrigger = within(micGroup).getByRole("button", { name: /System default/ });
    fireEvent.click(popoverTrigger);
    await flushEffects();

    const options = await screen.findAllByRole("option");
    fireEvent.click(options[1]!); // Blue Yeti Pro

    expect(vi.mocked(audioSetChannel)).toHaveBeenCalledWith({
      channel: "mic",
      deviceId: "alsa:yeti",
    });
  });

  it("renders inline error message when audio has error", async () => {
    vi.mocked(settingsGet).mockRejectedValueOnce({
      code: "audio_init_failed",
      userMessage: "Audio device unavailable",
    });

    render(<AudioMixerDeck />);
    await flushEffects();

    expect(screen.getByRole("alert")).toHaveTextContent("Audio device unavailable");
  });
});
