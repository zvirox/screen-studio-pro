import { useSspStore } from "../../lib/store";
import type { PresetId } from "../../types/ipc";

/* §6.4 Settings — Capture pane. Frame rate / encoder / quality preset are
   capture settings (§2.6). Presets come from `presets_list` via the presets
   slice; changing one calls `setPreset` which writes
   `capture.qualityPreset` back to Rust. */

export default function CapturePane() {
  const capture = useSspStore((s) => s.settings.capture);
  const presets = useSspStore((s) => s.presets);
  const setPreset = useSspStore((s) => s.setPreset);
  const setCaptureSettings = useSspStore((s) => s.setCaptureSettings);

  return (
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <h1 className="text-display-md">Capture</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Choose frame rate, encoder backend, and quality preset. Presets
        resolve frame-rate/height caps and x264 options from the settings
        snapshot at recording start.
      </p>

      {/* Frame rate */}
      <div className="mt-6">
        <label htmlFor="capture-frame-rate" className="block text-label text-ink mb-1.5">
          Frame rate
        </label>
        <select
          id="capture-frame-rate"
          value={capture?.frameRate ?? 60}
          onChange={(e) => {
            void setCaptureSettings({ frameRate: Number(e.target.value) });
          }}
          className="w-full h-10 rounded-sm border border-subtle bg-raised p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
      </div>

      {/* Encoder */}
      <div className="mt-6">
        <label htmlFor="capture-encoder" className="block text-label text-ink mb-1.5">
          Encoder
        </label>
        <select
          id="capture-encoder"
          value={capture?.encoder ?? "auto"}
          onChange={(e) => {
            void setCaptureSettings({ encoder: e.target.value });
          }}
          className="w-full h-10 rounded-sm border border-subtle bg-raised p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="auto">Auto (hardware preferred)</option>
          <option value="vaapi">VAAPI (Intel/AMD)</option>
          <option value="nvenc">NVENC (NVIDIA)</option>
          <option value="x264">x264 (software)</option>
        </select>
      </div>

      {/* Quality preset */}
      <div className="mt-6">
        <label htmlFor="capture-preset" className="block text-label text-ink mb-1.5">
          Quality preset
        </label>
        <select
          id="capture-preset"
          value={presets.presetId ?? "youtube"}
          onChange={(e) => {
            const id = e.target.value as PresetId;
            void setPreset(id);
          }}
          className="w-full h-10 rounded-sm border border-subtle bg-raised p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          disabled={presets.status === "loading"}
        >
          {presets.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.description}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
