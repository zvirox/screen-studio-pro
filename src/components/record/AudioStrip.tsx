import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Mic, MonitorSpeaker } from "lucide-react";
import { useSspStore, type AudioChannelState } from "../../lib/store";
import { cn } from "../../lib/cn";
import { Switch } from "../ui/switch";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../ui/popover";

/* §6.1 #3 audio strip (2.2) — Pane panel, two channel cards (Mic /
   Desktop): device name `body-sm`, level meter 4px bar (`accent` fill;
   `signal` segments above −6 dB), per-channel switch, device-select
   popover (§5.10 44px rows, "System default" first, §5.3 check + wash on
   the selected row). §6.3 education: the "Speak to test your mic level"
   label is the MIC card only — the law names no desktop copy. §5.5:
   loading skeleton + inline error; compact (§6.1) breaks via the
   horizontal scroll. Event wiring lives in hooks/useRecordingState (ONE
   subscription, ≤30 Hz in from Rust); this component only reads the
   projection. */

/* −6 dBFS on the linear amplitude axis = 0.5 — the split where the bar's
   fill switches from accent to signal (DESIGN §6.1 #3 "above −6 dB"). */
const MINUS_SIX_DB = 0.5;

const CHANNELS = ["mic", "desktop"] as const;
type Channel = (typeof CHANNELS)[number];

function MeterBar({ channel, reading }: { channel: Channel; reading: { rms: number; peak: number } | null }) {
  const peak = Math.max(0, Math.min(1, reading?.peak ?? 0));
  const hot = Math.max(0, peak - MINUS_SIX_DB);
  const calm = peak - hot;
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full border border-subtle bg-raised"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(peak * 100)}
      aria-label={`${channel} input level`}
    >
      {/* Per §4.1 the 4px closed step — h-1. Both spans come from the
          payload's peak split at −6 dB: accent below, signal above. */}
      <div
        data-testid={`${channel}-meter-fill`}
        className="flex h-full"
        style={{ width: `${peak * 100}%` }}
      >
        <div className="h-full bg-accent" style={{ width: `${((calm / (peak || 1)) * 100).toFixed(3)}%` }} />
        <div
          data-testid={`${channel}-meter-hot`}
          className="h-full bg-signal"
          style={{ width: `${((hot / (peak || 1)) * 100).toFixed(3)}%` }}
        />
      </div>
    </div>
  );
}

function DevicePopover({ channel, state, disabled }: { channel: Channel; state: AudioChannelState; disabled: boolean }) {
  const audio = useSspStore((s) => s.audio);
  const loadDevices = useSspStore((s) => s.loadDevices);
  const setChannelDevice = useSspStore((s) => s.setChannelDevice);
  const [open, setOpen] = useState(false);
  // §5.3 typeahead: a keydown buffer over the option labels.
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
        // A snapshot per open (API §2.2 ⚠): devices re-list whenever the
        // popover becomes usable — plugs/unplugs show up without a page
        // reload. Re-listing happens while idle; controls disable mid-take.
        if (next && !disabled) void loadDevices();
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverAnchor>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className={cn(
            "flex max-w-44 items-center gap-1 rounded-xs px-1 py-0.5 text-left",
            "text-body-sm text-ink-secondary hover:bg-accent-muted hover:text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={16} aria-hidden />
        </PopoverTrigger>
      </PopoverAnchor>
      <PopoverContent
        role="listbox"
        aria-label={`${channel} device`}
        onKeyDown={(e) => {
          // §5.3: Radix keyboard behavior + typeahead. Radix moves focus
          // into the content; options are plain buttons, so arrow-keys and
          // letters rove/match here.
          const items = () =>
            Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
            );
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
          /* §5.5 loading: skeleton rows, never a spinner mid-surface. */
          <div className="flex flex-col gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 rounded-xs bg-solid" />
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
                  "flex h-11 w-full items-center justify-between gap-2 rounded-xs px-3",
                  "text-body-sm text-ink",
                  selected
                    ? "bg-accent-muted font-medium shadow-[inset_2px_0_0_var(--ssp-accent)]"
                    : "hover:bg-accent-muted",
                  "focus-visible:bg-accent-muted focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {selected && <Check size={16} className="shrink-0 text-accent" aria-hidden />}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function AudioStrip() {
  const audio = useSspStore((s) => s.audio);
  const sessionStatus = useSspStore((s) => s.session.status);
  const loadAudio = useSspStore((s) => s.loadAudio);
  const setChannelEnabled = useSspStore((s) => s.setChannelEnabled);

  // Mount-once: the §2.6 settings projection loads when the strip appears
  // (the slice stays a projection — the Rust store is the truth).
  useEffect(() => {
    void loadAudio();
  }, [loadAudio]);

  // §5.2 take-snapshot law: channel/device changes shape the NEXT take —
  // mid-take the controls disable (the live take cannot change audio).
  const controlsDisabled = audio.status !== "ready" || sessionStatus !== "idle";

  return (
    <section aria-label="Audio" className="pane overflow-x-auto rounded-md p-4">
      <div className="flex min-w-max gap-4">
        {CHANNELS.map((channel) => {
          const state = audio[channel];
          const silent = !audio.meters || audio.meters[channel].peak < 0.01;
          const icon =
            channel === "mic" ? <Mic size={16} aria-hidden /> : <MonitorSpeaker size={16} aria-hidden />;
          return (
            <div
              key={channel}
              role="group"
              aria-label={channel === "mic" ? "Mic" : "Desktop"}
              className="flex w-64 shrink-0 flex-col gap-2 rounded-sm border border-subtle bg-solid p-3 shadow-elev-1"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-body-sm font-medium text-ink">
                  <span className="text-ink-secondary">{icon}</span>
                  {channel === "mic" ? "Mic" : "Desktop"}
                </div>
                <Switch
                  aria-label={`${channel === "mic" ? "Mic" : "Desktop"} channel enabled`}
                  checked={state.enabled}
                  disabled={controlsDisabled}
                  onCheckedChange={(checked) => void setChannelEnabled(channel, checked)}
                />
              </div>
              <DevicePopover channel={channel} state={state} disabled={controlsDisabled} />
              <MeterBar channel={channel} reading={audio.meters?.[channel] ?? null} />
              {channel === "mic" && state.enabled && silent && !controlsDisabled && (
                /* §6.3 audio-silent education state — mic card only. */
                <p className="text-label text-ink-secondary">Speak to test your mic level</p>
              )}
            </div>
          );
        })}
      </div>
      {audio.status === "error" && audio.error && (
        /* §5.5 inline error — the §1 human copy, rendered once; the §5.6
           toast carries the floatover-level telling at load time. */
        <p className="mt-2 text-body-sm text-error" role="alert">
          {audio.error.userMessage}
        </p>
      )}
    </section>
  );
}
