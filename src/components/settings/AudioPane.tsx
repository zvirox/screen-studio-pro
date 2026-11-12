import { useState } from "react";
import { Mic, Speaker } from "lucide-react";
import { useSspStore } from "../../lib/store";

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
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <h1 className="text-display-md">Audio</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Choose which audio channels record and their devices/levels. Levels
        are post-gain — the meter bar shows exactly what lands in the file.
      </p>

      {audio.status === "error" && audio.error && (
        <div className="mt-4 p-3 rounded-sm bg-error/10 border border-error text-error">
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
              <button
                type="button"
                role="switch"
                aria-label="Microphone enabled"
                aria-checked={mic.enabled}
                disabled={toggling}
                onClick={() => {
                  setToggling(true);
                  void setChannelEnabled("mic", !mic.enabled).finally(() =>
                    setToggling(false),
                  );
                }}
                className={`inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors
                  ${mic.enabled ? "bg-accent" : "bg-solid"}
                  ${toggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
                `}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-ink-secondary transition-transform
                    ${mic.enabled ? "translate-x-8" : "translate-x-2"}`}
                  aria-hidden="true"
                />
              </button>
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
              <button
                type="button"
                role="switch"
                aria-label="Microphone muted"
                aria-checked={mic.muted}
                disabled={toggling || !mic.enabled}
                onClick={() => {
                  setToggling(true);
                  void setChannelMuted("mic", !mic.muted).finally(() =>
                    setToggling(false),
                  );
                }}
                className={`inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors
                  ${mic.muted ? "bg-accent" : "bg-solid"}
                  ${toggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
                `}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-ink-secondary transition-transform
                    ${mic.muted ? "translate-x-8" : "translate-x-2"}`}
                  aria-hidden="true"
                />
              </button>
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
                className="w-full h-2 bg-solid rounded-full appearance-none cursor-pointer
                  disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={toggling || !mic.enabled}
              />
              <span className="text-xs text-mono-xs text-ink-secondary text-right">{mic.level}%</span>
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
              <button
                type="button"
                role="switch"
                aria-label="Desktop audio enabled"
                aria-checked={desktop.enabled}
                disabled={toggling}
                onClick={() => {
                  setToggling(true);
                  void setChannelEnabled("desktop", !desktop.enabled).finally(() =>
                    setToggling(false),
                  );
                }}
                className={`inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors
                  ${desktop.enabled ? "bg-accent" : "bg-solid"}
                  ${toggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
                `}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-ink-secondary transition-transform
                    ${desktop.enabled ? "translate-x-8" : "translate-x-2"}`}
                  aria-hidden="true"
                />
              </button>
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
              <button
                type="button"
                role="switch"
                aria-label="Desktop audio muted"
                aria-checked={desktop.muted}
                disabled={toggling || !desktop.enabled}
                onClick={() => {
                  setToggling(true);
                  void setChannelMuted("desktop", !desktop.muted).finally(() =>
                    setToggling(false),
                  );
                }}
                className={`inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors
                  ${desktop.muted ? "bg-accent" : "bg-solid"}
                  ${toggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
                `}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-ink-secondary transition-transform
                    ${desktop.muted ? "translate-x-8" : "translate-x-2"}`}
                  aria-hidden="true"
                />
              </button>
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
                className="w-full h-2 bg-solid rounded-full appearance-none cursor-pointer
                  disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={toggling || !desktop.enabled}
              />
              <span className="text-xs text-mono-xs text-ink-secondary text-right">{desktop.level}%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
