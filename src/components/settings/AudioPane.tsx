import { useState } from "react";
import { Mic, Speaker } from "lucide-react";
import { useSspStore } from "../../lib/store";
import { Switch } from "../ui/switch";

/* §6.4 Settings — Audio pane. Mic and desktop audio channels: enabled,
   muted, device, level. Changes roll back on rejection and toast the §1
   copy. echoCancel is not yet exposed in the settings projection; it can
   be added here when the store gains an audio settings section. */

export default function AudioPane() {
  const audio = useSspStore((s) => s.audio);
  const setChannelEnabled = useSspStore((s) => s.setChannelEnabled);
  const setChannelMuted = useSspStore((s) => s.setChannelMuted);
  const setChannelDevice = useSspStore((s) => s.setChannelDevice);
  const setChannelLevel = useSspStore((s) => s.setChannelLevel);

  const mic = audio.mic;
  const desktop = audio.desktop;
  const [toggling, setToggling] = useState(false);

  return (
    <section>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Choose which audio channels record and their devices/levels. Levels are post-gain — the
        meter bar shows exactly what lands in the file.
      </p>

      {audio.status === "error" && audio.error && (
        <div className="mt-4 p-3 rounded-sm bg-tint-red border border-error text-error">
          {audio.error.userMessage}
        </div>
      )}

      <div className="mt-6 grid gap-4">
        {/* Mic card */}
        <div className="flex flex-col gap-3 p-4 rounded-sm border border-subtle bg-solid">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mic size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium text-ink">Microphone</span>
            </div>
            <div className="flex items-center gap-1">
              <Switch
                aria-label="Microphone enabled"
                checked={mic.enabled}
                disabled={toggling}
                onCheckedChange={() => {
                  setToggling(true);
                  void setChannelEnabled("mic", !mic.enabled).finally(() => setToggling(false));
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-label text-ink-secondary mb-1.5 block">Device</label>
              <select
                value={mic.deviceId ?? "default"}
                onChange={(e) => {
                  void setChannelDevice(
                    "mic",
                    e.target.value === "default" ? null : e.target.value,
                  );
                }}
                className="w-full h-9 rounded-sm border border-subtle bg-solid p-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                disabled={toggling || !mic.enabled}
              >
                <option value="default">System default</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-label text-ink-secondary mb-1.5 block">Muted</label>
              <Switch
                aria-label="Microphone muted"
                checked={mic.muted}
                disabled={toggling || !mic.enabled}
                onCheckedChange={() => {
                  setToggling(true);
                  void setChannelMuted("mic", !mic.muted).finally(() => setToggling(false));
                }}
              />
            </div>
            <div>
              <label className="text-xs text-label text-ink-secondary mb-1.5 block">Level</label>
              <input
                type="range"
                min="0"
                max="100"
                value={mic.level}
                onChange={(e) => {
                  void setChannelLevel("mic", Number(e.target.value));
                }}
                className="w-full h-1.5 bg-[var(--bg-track)] accent-[var(--blue)] rounded-xs appearance-none cursor-pointer
                  disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={toggling || !mic.enabled}
              />
              <span className="text-mono-sm text-ink-secondary text-right">{mic.level}%</span>
            </div>
          </div>
        </div>

        {/* Desktop card */}
        <div className="flex flex-col gap-3 p-4 rounded-sm border border-subtle bg-solid">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Speaker size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium text-ink">Desktop audio</span>
            </div>
            <div className="flex items-center gap-1">
              <Switch
                aria-label="Desktop audio enabled"
                checked={desktop.enabled}
                disabled={toggling}
                onCheckedChange={() => {
                  setToggling(true);
                  void setChannelEnabled("desktop", !desktop.enabled).finally(() =>
                    setToggling(false),
                  );
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-label text-ink-secondary mb-1.5 block">Device</label>
              <select
                value={desktop.deviceId ?? "default"}
                onChange={(e) => {
                  void setChannelDevice(
                    "desktop",
                    e.target.value === "default" ? null : e.target.value,
                  );
                }}
                className="w-full h-9 rounded-sm border border-subtle bg-solid p-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                disabled={toggling || !desktop.enabled}
              >
                <option value="default">System default</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-label text-ink-secondary mb-1.5 block">Muted</label>
              <Switch
                aria-label="Desktop audio muted"
                checked={desktop.muted}
                disabled={toggling || !desktop.enabled}
                onCheckedChange={() => {
                  setToggling(true);
                  void setChannelMuted("desktop", !desktop.muted).finally(() => setToggling(false));
                }}
              />
            </div>
            <div>
              <label className="text-xs text-label text-ink-secondary mb-1.5 block">Level</label>
              <input
                type="range"
                min="0"
                max="100"
                value={desktop.level}
                onChange={(e) => {
                  void setChannelLevel("desktop", Number(e.target.value));
                }}
                className="w-full h-1.5 bg-[var(--bg-track)] accent-[var(--blue)] rounded-xs appearance-none cursor-pointer
                  disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={toggling || !desktop.enabled}
              />
              <span className="text-mono-sm text-ink-secondary text-right">{desktop.level}%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
