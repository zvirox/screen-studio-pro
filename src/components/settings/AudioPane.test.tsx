import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AudioPane from "./AudioPane";
import { useSspStore, INITIAL_AUDIO, type AudioSlice } from "../../lib/store";
import type * as ipcModule from "../../lib/ipc";

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof ipcModule>()),
  audioSetChannel: vi.fn().mockResolvedValue({ ok: true }),
}));

import { audioSetChannel } from "../../lib/ipc";
const mockedAudioSetChannel = vi.mocked(audioSetChannel);

function setAudioState(audio: Partial<AudioSlice>) {
  useSspStore.setState({ audio: { ...INITIAL_AUDIO, ...audio } });
}

/* §6.4 Settings — Audio pane: mic/desktop enabled, muted, device, level. */

describe("AudioPane (§6.4 / 6.1)", () => {
  beforeEach(() => {
    setAudioState({
      mic: { enabled: true, muted: false, deviceId: null, level: 100 },
      desktop: { enabled: true, muted: false, deviceId: null, level: 100 },
    });
    vi.clearAllMocks();
  });

  it("renders mic and desktop channel cards", () => {
    render(<AudioPane />);
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("Desktop audio")).toBeInTheDocument();
  });

  it("toggles mic enabled via audioSetChannel", async () => {
    render(<AudioPane />);
    fireEvent.click(screen.getByRole("switch", { name: /Microphone enabled/ }));
    await waitFor(() =>
      expect(mockedAudioSetChannel).toHaveBeenCalledWith({
        channel: "mic",
        enabled: false,
      }),
    );
  });

  it("sets mic level via audioSetChannel", async () => {
    render(<AudioPane />);
    const range = screen.getAllByRole("slider")[0];
    fireEvent.change(range, { target: { value: "42" } });
    await waitFor(() =>
      expect(mockedAudioSetChannel).toHaveBeenCalledWith({ channel: "mic", level: 42 }),
    );
  });

  it("sets mic muted via audioSetChannel", async () => {
    render(<AudioPane />);
    fireEvent.click(screen.getByRole("switch", { name: /Microphone muted/ }));
    await waitFor(() =>
      expect(mockedAudioSetChannel).toHaveBeenCalledWith({ channel: "mic", muted: true }),
    );
  });

  it("sets desktop device via audioSetChannel", async () => {
    // Start with a non-default device, then change to default
    setAudioState({
      mic: { enabled: true, muted: false, deviceId: null, level: 100 },
      desktop: { enabled: true, muted: false, deviceId: "sink_0", level: 100 },
    });
    render(<AudioPane />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "default" } });
    await waitFor(() =>
      expect(mockedAudioSetChannel).toHaveBeenCalledWith({
        channel: "desktop",
        deviceId: null,
      }),
    );
  });

  it("disables controls when channel disabled", () => {
    setAudioState({
      mic: { enabled: false, muted: false, deviceId: null, level: 100 },
      desktop: { enabled: true, muted: false, deviceId: null, level: 100 },
    });
    render(<AudioPane />);
    // Mic controls should be disabled when mic is not enabled
    expect(screen.getAllByRole("slider")[0]).toBeDisabled();
  });

  it("shows error state when audio load fails", () => {
    setAudioState({
      status: "error",
      error: {
        kind: "pipewire",
        code: "pipewire.audio_enum_failed",
        userMessage: "PipeWire is not running.",
        details: null,
        retryable: false,
      },
      mic: { enabled: false, muted: false, deviceId: null, level: 0 },
      desktop: { enabled: false, muted: false, deviceId: null, level: 0 },
    });
    render(<AudioPane />);
    expect(screen.getByText("PipeWire is not running.")).toBeInTheDocument();
  });
});
