import { useSspStore } from "../../lib/store";

/* §6.4 Settings — Files pane. Output directory, naming pattern, and
   container format. Rolls back on rejection and toasts the §1 copy. */

export default function FilesPane() {
  const files = useSspStore((s) => s.settings.files);
  const setFilesSettings = useSspStore((s) => s.setFilesSettings);

  return (
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <h1 className="text-display-md">Files</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Choose where recordings land, how they’re named, and the final
        container format. MKV is the native container; MP4 remux joins M9.
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
    </section>
  );
}
