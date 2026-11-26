import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { cn } from "../../lib/cn";
import { useSspStore, type AudioChannelState } from "../../lib/store";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";

/* DESIGN.md v3.1 §5.3/§7.4 — Sub-Canvas Floating Audio Mixer Deck (Meld Studio Style)
   Compact cards wrap headers, badges, and device controls before text collides.
   Horizontally aligned glass deck directly below the 16:9 canvas.
   Contains two dedicated channel cards:
   - Microphone Channel Card:
     * Title & device popover dropdown
     * DSP badges: [AI Noise Isolation] (RNNoise), [Gate]
     * Dual stereo peak/RMS meter bars (-60 dBFS to 0 dBFS with -6 dB compression zone)
     * Volume slider fader (0 to 100)
     * High-contrast Mute button
     * Mic silent education hint
   - Desktop Audio Channel Card:
     * Title & output sink monitor name
     * DSP badge: [Auto-Ducking]
     * Live system audio peak meter bars
     * Volume slider fader + Mute button
*/

const WARN_THRESHOLD = 0.35;
const MINUS_SIX_DB = 0.5;

function toDbfs(peak: number): string {
  if (peak <= 0.001) return "-∞ dB";
  const db = Math.round(20 * Math.log10(Math.min(1, peak)));
  return `${db} dB`;
}

export function MeterBar({
  channel,
  reading,
}: {
  channel: "mic" | "desktop";
  reading: { rms: number; peak: number } | null;
}) {
  const peak = Math.max(0, Math.min(1, reading?.peak ?? 0));
  const hot = Math.max(0, peak - MINUS_SIX_DB);
  const warm = Math.max(0, Math.min(peak, MINUS_SIX_DB) - WARN_THRESHOLD);
  const safe = Math.max(0, Math.min(peak, WARN_THRESHOLD));
  const dbText = toDbfs(peak);

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between font-mono text-label text-ink-secondary">
        <span>-60</span>
        <span className="text-ink-secondary">-18</span>
        <span className="text-ink-secondary">-6</span>
        <span className={cn(hot > 0 ? "font-semibold text-[var(--red-text)]" : "text-ink")}>{dbText}</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-xs border border-subtle bg-[var(--bg-track)]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(peak * 100)}
        aria-label={`${channel} input level`}
      >
        <div
          data-testid={`${channel}-meter-fill`}
          className="flex h-full transition-[width] duration-75"
          style={{ width: `${peak * 100}%` }}
        >
          <div
            className="h-full bg-[var(--green)]"
            style={{ width: `${((safe / (peak || 1)) * 100).toFixed(3)}%` }}
          />
          <div
            className="h-full bg-[var(--amber)]"
            style={{ width: `${((warm / (peak || 1)) * 100).toFixed(3)}%` }}
          />
          <div
            data-testid={`${channel}-meter-hot`}
            className="h-full bg-[var(--red)]"
            style={{ width: `${((hot / (peak || 1)) * 100).toFixed(3)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function DevicePopover({
  channel,
  state,
  disabled,
}: {
  channel: "mic" | "desktop";
  state: AudioChannelState;
  disabled: boolean;
}) {
  const audio = useSspStore((s) => s.audio);
  const loadDevices = useSspStore((s) => s.loadDevices);
  const setChannelDevice = useSspStore((s) => s.setChannelDevice);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typeaheadAt = useRef(0);

  const devices = channel === "mic" ? audio.devices?.mics : audio.devices?.desktop;
  const label = state.deviceId
    ? (devices?.find((d) => d.id === state.deviceId)?.label ?? state.deviceId)
    : "System default";

  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: "System default" },
    ...(devices ?? []).map((d) => ({ id: d.id, label: d.label })),
  ];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && !disabled) void loadDevices();
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverAnchor className="min-w-0 flex-1">
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-xs px-2 py-1 text-left",
            "border border-subtle bg-canvas text-body-sm text-ink-secondary hover:bg-surface-hover hover:text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="truncate font-medium">{label}</span>
          <ChevronDown size={14} className="shrink-0 opacity-70" aria-hidden="true" />
        </PopoverTrigger>
      </PopoverAnchor>
      <PopoverContent
        role="listbox"
        aria-label={`${channel} device`}
        className="w-64"
        onKeyDown={(e) => {
          const items = () =>
            Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const list = items();
            const idx = list.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === "ArrowDown"
                ? list[Math.min(list.length - 1, idx + 1)]
                : list[Math.max(0, idx - 1)];
            next?.focus();
          } else if (e.key.length === 1 && /\S/.test(e.key)) {
            e.preventDefault();
            const now = Date.now();
            const nextQuery = now - typeaheadAt.current > 500 ? e.key : query + e.key;
            setQuery(nextQuery);
            typeaheadAt.current = now;
            items()
              .find((it) => it.textContent?.toLowerCase().startsWith(nextQuery.toLowerCase()))
              ?.focus();
          }
        }}
      >
        {audio.devicesLoading && devices === undefined ? (
          <div className="flex flex-col gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded-xs bg-solid" />
            ))}
          </div>
        ) : (
          options.map((opt) => {
            const selected = opt.id === state.deviceId;
            return (
              <button
                key={opt.id ?? "default"}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => {
                  void setChannelDevice(channel, opt.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-10 w-full items-center justify-between gap-2 rounded-xs px-3",
                  "text-body-sm text-ink",
                  selected
                    ? "border-l-2 border-subtle bg-surface-hover font-medium"
                    : "hover:bg-surface-hover",
                  "focus-visible:bg-surface-hover focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {selected && (
                  <Check size={16} className="shrink-0 text-ink" aria-hidden="true" />
                )}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function AudioMixerDeck() {
  const audio = useSspStore((s) => s.audio);
  const sessionStatus = useSspStore((s) => s.session.status);
  const loadAudio = useSspStore((s) => s.loadAudio);
  const setChannelEnabled = useSspStore((s) => s.setChannelEnabled);
  const setChannelMuted = useSspStore((s) => s.setChannelMuted);
  const setChannelLevel = useSspStore((s) => s.setChannelLevel);

  useEffect(() => {
    void loadAudio();
  }, [loadAudio]);

  const controlsDisabled = audio.status !== "ready" || sessionStatus !== "idle";

  return (
    <section
      aria-label="Audio Mixer Deck"
      className="studio-deck rounded-md p-3.5 flex min-w-0 flex-col gap-3 w-full"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-heading font-semibold text-ink">Audio Mixer</h2>
          <span className="whitespace-nowrap rounded-xs bg-solid border border-subtle px-1.5 py-0.5 font-mono text-label text-ink-secondary">
            48 kHz · 24-bit
          </span>
        </div>
        <span className="shrink-0 text-label font-medium text-ink-secondary">
          Mixer
        </span>
      </div>

      {/* Channel Cards Grid */}
      <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2">
        {/* 1. MIC CHANNEL CARD */}
        {(() => {
          const state = audio.mic;
          const isSilent = !audio.meters || audio.meters.mic.peak < 0.01;
          const isMuted = state.muted;

          return (
            <div
              role="group"
              aria-label="Mic"
              className={cn(
                "flex min-w-0 flex-col gap-2.5 rounded-md border border-subtle bg-solid p-3 transition-opacity",
                !state.enabled && "opacity-60",
              )}
            >
              {/* Channel Title & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-sm border",
                      isMuted
                        ? "border-error bg-error-muted text-error"
                        : "border-subtle bg-canvas text-ink-secondary",
                    )}
                  >
                    {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-body-sm font-semibold text-ink">Microphone</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="whitespace-nowrap rounded-xs bg-canvas border border-subtle px-1 py-0.2 font-mono text-label text-ink-secondary">
                        Ch 1/2
                      </span>
                      {/* DSP Badges */}
                      <span className="whitespace-nowrap rounded-xs border border-subtle bg-canvas px-1.5 py-0.2 text-label font-medium text-ink-secondary">
                        RNNoise
                      </span>
                      <span className="whitespace-nowrap rounded-xs bg-canvas border border-subtle px-1 py-0.2 text-label text-ink-secondary">
                        Gate
                      </span>
                    </div>
                  </div>
                </div>

                {/* Channel Power Switch */}
                <Switch
                  aria-label="Mic channel enabled"
                  checked={state.enabled}
                  disabled={controlsDisabled}
                  onCheckedChange={(checked) => void setChannelEnabled("mic", checked)}
                />
              </div>

              {/* Device Selector & Mute */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DevicePopover channel="mic" state={state} disabled={controlsDisabled} />

                {/* Tactile Mute Button */}
                <button
                  type="button"
                  aria-pressed={isMuted}
                  aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                  disabled={!state.enabled}
                  onClick={() => void setChannelMuted("mic", !isMuted)}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-label font-medium transition-colors",
                    isMuted
                      ? "bg-error text-[var(--btn-primary-text)] hover:bg-[var(--red)]"
                      : "border border-subtle bg-canvas text-ink hover:bg-surface-hover",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {isMuted ? (
                    <MicOff size={13} aria-hidden="true" />
                  ) : (
                    <Mic size={13} aria-hidden="true" />
                  )}
                  <span>{isMuted ? "MUTED" : "MUTE"}</span>
                </button>
              </div>

              {/* Stereo Meter Bar */}
              <MeterBar channel="mic" reading={audio.meters?.mic ?? null} />

              {/* Volume Level Fader Slider */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-label text-ink-secondary font-medium">Gain</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={state.level ?? 80}
                  aria-label="Mic input gain"
                  disabled={!state.enabled}
                  onChange={(e) => void setChannelLevel("mic", Number(e.target.value))}
                  className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-xs bg-[var(--bg-track)] accent-[var(--blue)] focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                />
                <span className="w-10 text-right font-mono text-mono-sm text-ink font-medium">
                  {state.level ?? 80}%
                </span>
              </div>

              {/* Silent education hint */}
              {state.enabled && isSilent && !controlsDisabled && (
                <p className="rounded-xs bg-canvas px-2 py-1 text-label text-ink-secondary border border-subtle">
                  Speak to test your mic level
                </p>
              )}
            </div>
          );
        })()}

        {/* 2. DESKTOP AUDIO CHANNEL CARD */}
        {(() => {
          const state = audio.desktop;
          const isMuted = state.muted;

          return (
            <div
              role="group"
              aria-label="Desktop"
              className={cn(
                "flex min-w-0 flex-col gap-2.5 rounded-md border border-subtle bg-solid p-3 transition-opacity",
                !state.enabled && "opacity-60",
              )}
            >
              {/* Channel Title & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-sm border",
                      isMuted
                        ? "border-error bg-error-muted text-error"
                        : "border-subtle bg-canvas text-ink-secondary",
                    )}
                  >
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-body-sm font-semibold text-ink">Desktop Audio</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="whitespace-nowrap rounded-xs bg-canvas border border-subtle px-1 py-0.2 font-mono text-label text-ink-secondary">
                        Ch 3/4
                      </span>
                      {/* DSP Badge */}
                      <span className="whitespace-nowrap rounded-xs bg-canvas border border-subtle px-1.5 py-0.2 text-label font-medium text-ink-secondary">
                        Auto-Ducking
                      </span>
                    </div>
                  </div>
                </div>

                {/* Channel Power Switch */}
                <Switch
                  aria-label="Desktop channel enabled"
                  checked={state.enabled}
                  disabled={controlsDisabled}
                  onCheckedChange={(checked) => void setChannelEnabled("desktop", checked)}
                />
              </div>

              {/* Device Selector & Mute */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DevicePopover channel="desktop" state={state} disabled={controlsDisabled} />

                {/* Tactile Mute Button */}
                <button
                  type="button"
                  aria-pressed={isMuted}
                  aria-label={isMuted ? "Unmute desktop audio" : "Mute desktop audio"}
                  disabled={!state.enabled}
                  onClick={() => void setChannelMuted("desktop", !isMuted)}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-label font-medium transition-colors",
                    isMuted
                      ? "bg-error text-[var(--btn-primary-text)] hover:bg-[var(--red)]"
                      : "border border-subtle bg-canvas text-ink hover:bg-surface-hover",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {isMuted ? (
                    <VolumeX size={13} aria-hidden="true" />
                  ) : (
                    <Volume2 size={13} aria-hidden="true" />
                  )}
                  <span>{isMuted ? "MUTED" : "MUTE"}</span>
                </button>
              </div>

              {/* Stereo Meter Bar */}
              <MeterBar channel="desktop" reading={audio.meters?.desktop ?? null} />

              {/* Volume Level Fader Slider */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-label text-ink-secondary font-medium">Gain</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={state.level ?? 70}
                  aria-label="Desktop input gain"
                  disabled={!state.enabled}
                  onChange={(e) => void setChannelLevel("desktop", Number(e.target.value))}
                  className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-xs bg-[var(--bg-track)] accent-[var(--blue)] focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                />
                <span className="w-10 text-right font-mono text-mono-sm text-ink font-medium">
                  {state.level ?? 70}%
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Error Banner */}
      {audio.status === "error" && audio.error && (
        <p
          className="rounded-sm bg-error-muted border border-error p-2.5 text-body-sm text-error"
          role="alert"
        >
          {audio.error.userMessage}
        </p>
      )}
    </section>
  );
}
