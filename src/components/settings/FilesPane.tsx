import { Switch } from "../ui/switch";
import { useSspStore } from "../../lib/store";

/* §6.4 Settings — Files pane. Output directory, naming pattern, and
   container format. Rolls back on rejection and toasts the §1 copy. */

export default function FilesPane() {
  const files = useSspStore((s) => s.settings.files);
  const setFilesSettings = useSspStore((s) => s.setFilesSettings);

  return (
    <section>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Choose where recordings land, how they’re named, and the final container format. MKV is the
        native container; MP4 remux joins M9.
      </p>

      {/* Output directory */}
      <div className="mt-6">
        <label htmlFor="files-dir" className="block text-label text-ink mb-1.5">
          Output directory
        </label>
        <div className="flex gap-2">
          <input
            id="files-dir"
            type="text"
            value={files?.dir ?? ""}
            onChange={(e) => {
              void setFilesSettings({ dir: e.target.value });
            }}
            placeholder="/home/user/Videos/SSP"
            className="flex-1 h-10 rounded-sm border border-subtle bg-solid p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="button"
            onClick={() => {}}
            className="h-10 px-4 rounded-sm border border-subtle bg-solid px-4 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Browse…
          </button>
        </div>
      </div>

      {/* Naming pattern */}
      <div className="mt-6">
        <label htmlFor="files-naming-pattern" className="block text-label text-ink mb-1.5">
          Naming pattern
        </label>
        <p className="text-xs text-ink-secondary mb-1.5">
          strftime-style tokens expanded at recording start.
        </p>
        <input
          id="files-naming-pattern"
          type="text"
          value={files?.namingPattern ?? ""}
          onChange={(e) => {
            void setFilesSettings({ namingPattern: e.target.value });
          }}
          placeholder="screen-%Y-%m-%d-%H%M"
          className="w-full h-10 rounded-sm border border-subtle bg-solid p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {/* Container */}
      <div className="mt-6">
        <label htmlFor="files-container" className="block text-label text-ink mb-1.5">
          Container format
        </label>
        <select
          id="files-container"
          value={files?.container ?? "mkv"}
          onChange={(e) => {
            void setFilesSettings({ container: e.target.value });
          }}
          className="w-full h-10 rounded-sm border border-subtle bg-solid p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="mkv">MKV (native, no remux)</option>
          <option value="mp4">MP4 (remux after stop)</option>
        </select>
        <p className="mt-1 text-xs text-ink-secondary">
          MP4 remux requires ffmpeg; MKV is written directly by the muxer.
        </p>
      </div>

      {/* 9.3 auto-split — existing Switch + input/label classes, no new styles */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-4 max-w-md">
          <div>
            <p className="text-label text-ink">Automatic splitting</p>
            <p className="text-xs text-ink-secondary">
              Start a new gapless segment when either threshold is reached. Off by default.
            </p>
          </div>
          <Switch
            aria-label="Automatic splitting"
            checked={files?.autoSplitEnabled ?? false}
            onCheckedChange={(enabled) => {
              void setFilesSettings({ autoSplitEnabled: enabled });
            }}
          />
        </div>
        <div className="flex gap-3 max-w-md mt-3">
          <div className="flex-1">
            <label htmlFor="files-auto-split-duration" className="block text-label text-ink mb-1.5">
              Duration (minutes)
            </label>
            <input
              id="files-auto-split-duration"
              type="number"
              min={1}
              max={240}
              value={files?.autoSplitDurationMin ?? 30}
              onChange={(e) => {
                void setFilesSettings({ autoSplitDurationMin: Number(e.target.value) });
              }}
              className="w-full h-10 rounded-sm border border-subtle bg-solid p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="files-auto-split-size" className="block text-label text-ink mb-1.5">
              Size (MB)
            </label>
            <input
              id="files-auto-split-size"
              type="number"
              min={64}
              max={16384}
              value={files?.autoSplitSizeMb ?? 4096}
              onChange={(e) => {
                void setFilesSettings({ autoSplitSizeMb: Number(e.target.value) });
              }}
              className="w-full h-10 rounded-sm border border-subtle bg-solid p-2 text-body-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
