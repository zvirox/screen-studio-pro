import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { useSspStore } from "../../lib/store";
import RecordingDrawer from "./RecordingDrawer";
import DeleteConfirm from "./DeleteConfirm";
import type { LibraryListItem } from "../../types/ipc";
import { cn } from "../../lib/cn";

/* §6.5 Cards & the recording library grid (task 5.2).
   Card: surface.solid, r.md, border.subtle, elev.1, padding space.4.
   Interactive hover: border → accent-tinted, y −1px on m.fast.
   Loading: skeleton grid — shimmer on surface.solid shapes, never spinners
   mid-page. Recording item: 16:9 thumbnail (r.sm), duration chip bottom-right
   (mono-sm, rgba(0,0,0,0.5) ground), name body-sm 500, meta row
   (label/mono-sm: date · size · fps · encoder). Hover reveals icon-action
   row: open, copy path, delete-danger. Click = detail drawer (§5.7).
   Nothing important hidden behind hover. */

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(1)} ${units[unitIdx]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function LibraryCard({
  item,
  onOpen,
  onDelete,
}: { item: LibraryListItem; onOpen: (id: number) => void; onDelete: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);

  const handleDelete = () => {
    onDelete(item.id);
  };

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(item.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
      className={cn(
        "relative group cursor-pointer bg-solid border border-subtle rounded-md shadow-[var(--shadow-elev-1)] p-4",
        hovered ? "border-accent -translate-y-1" : "",
        "transition-all duration-140 ease-out",
      )}
    >
      {/* 16:9 thumbnail (r.sm) */}
      <div className="relative aspect-video w-full rounded-sm bg-raised overflow-hidden">
        {item.thumbPath ? (
          <img
            src={item.thumbPath}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-ink">
            <ExternalLink size={24} strokeWidth={1.5} className="opacity-60" />
          </div>
        )}
        {/* Duration chip bottom-right (mono-sm, ground) */}
        <div className="absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-black/50 text-mono-xs text-white">
          {formatDuration(item.durationMs)}
        </div>
        {/* Missing-file overlay (§5.5): thumbnail persists + signal.muted chip. */}
        {item.status === "missing" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/40">
            <div className="flex items-center gap-2 bg-error/10 border border-error rounded-md p-2">
              <span className="text-error font-medium text-body-sm">File missing</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3">
        {/* Name body-sm 500 */}
        <h3 className="text-body-sm font-medium text-ink line-clamp-1">
          {item.fileName}
        </h3>
        {/* Meta row (label/mono-sm): date · size · fps · encoder */}
        <p className="mt-1 text-label text-ink truncate">
          {formatDate(item.createdAt)} ·
          {formatSize(item.sizeBytes)} ·
          {item.fps}fps ·
          {item.encoder}
        </p>
      </div>

      {/* Hover reveals icon-action row */}
      {hovered && (
        <div className="absolute top-4 right-4 flex gap-2">
          <button
            type="button"
            aria-label="Open recording"
            className="h-9 w-9 rounded-sm border border-subtle bg-solid flex items-center justify-center text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Copy path"
            onClick={() => {
              navigator.clipboard.writeText(item.path);
            }}
            className="h-9 w-9 rounded-sm border border-subtle bg-solid flex items-center justify-center text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Delete recording"
            onClick={handleDelete}
            className="h-9 w-9 rounded-sm border border-subtle bg-solid flex items-center justify-center text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="relative group cursor-default bg-solid border border-subtle rounded-md shadow-[var(--shadow-elev-1)] p-4">
      {/* §6.5 loading: skeleton grid — shimmer on surface.solid shapes, never spinners mid-page. */}
      <div className="relative aspect-video w-full rounded-sm bg-solid overflow-hidden">
        <div className="h-full w-full bg-solid animate-pulse" />
        <div className="absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-black/50">
          <div className="w-8 h-3 bg-white/60 rounded" />
        </div>
      </div>
      <div className="mt-3">
        <div className="h-4 bg-solid animate-pulse w-3/4" />
        <div className="mt-1 h-3 bg-solid animate-pulse w-1/2" />
      </div>
    </article>
  );
}

export default function LibraryGrid() {
  const library = useSspStore((s) => s.library);
  const loadLibrary = useSspStore((s) => s.loadLibrary);
  const setLibraryOffset = useSspStore((s) => s.setLibraryOffset);
  const openDrawer = useSspStore((s) => s.openDrawer);
  const closeDrawer = useSspStore((s) => s.closeDrawer);
  const deleteRecording = useSspStore((s) => s.deleteRecording);
  const setView = useSspStore((s) => s.setView);
  const { drawerOpen } = library;

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"created_at" | "duration" | "size">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const mountedRef = useRef(false);

  // Load library on mount and whenever filter/sort changes.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void loadLibrary();
      return;
    }
    void loadLibrary();
  }, [search, sortField, sortDir, loadLibrary]);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  const handleSort = useCallback((field: "created_at" | "duration" | "size") => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }, [sortField, sortDir]);

  return (
    <section className="flex flex-col h-full" data-testid="library-grid">
      {/* Header with search */}
      <div className="flex-shrink-0 px-6 py-4">
        <div className="relative max-w-md">
          <input
            type="text"
            placeholder="Search recordings…"
            value={search}
            onChange={handleSearch}
            className="h-10 w-full rounded-sm border border-subtle bg-solid pl-9 pr-3 text-body-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink">
            <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Grid header */}
      <div className="flex-shrink-0 px-6 py-2 border-b border-subtle bg-raised">
        <div className="flex items-center justify-between text-label font-medium text-ink">
          <span>Recordings</span>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => handleSort("created_at")}
              className={cn(
                "flex items-center gap-1 hover:text-accent",
                sortField === "created_at" && "text-accent",
              )}
            >
              Date {sortField === "created_at" ? (sortDir === "desc" ? "▼" : "▲") : ""}
            </button>
            <button
              onClick={() => handleSort("duration")}
              className={cn(
                "flex items-center gap-1 hover:text-accent",
                sortField === "duration" && "text-accent",
              )}
            >
              Duration {sortField === "duration" ? (sortDir === "desc" ? "▼" : "▲") : ""}
            </button>
            <button
              onClick={() => handleSort("size")}
              className={cn(
                "flex items-center gap-1 hover:text-accent",
                sortField === "size" && "text-accent",
              )}
            >
              Size {sortField === "size" ? (sortDir === "desc" ? "▼" : "▲") : ""}
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {library.status === "error" ? (
          // §5.5 error state — show §1 copy with retry.
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <ExternalLink size={48} strokeWidth={1.5} className="text-error mb-4" aria-hidden="true" />
            <h2 className="text-heading font-medium text-ink">Could not load recordings</h2>
            <p className="mt-2 text-body-sm text-ink max-w-md">
              {library.error?.userMessage ?? "Failed to load recordings."}
            </p>
            <button
              type="button"
              onClick={() => void loadLibrary()}
              className="mt-4 flex items-center gap-1.5 rounded-sm border border-subtle bg-solid px-3 py-2 text-body-sm font-medium text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <LoaderCircle size={14} strokeWidth={1.5} className="mr-1.5" aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : library.status === "loading" && library.items.length === 0 ? (
          // §6.5 loading: skeleton grid, never spinners mid-page.
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : library.items.length === 0 ? (
          // §6.3 empty: teach the interface, never say "nothing here".
          search ? (
            // Search empty.
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <ExternalLink size={48} strokeWidth={1.5} className="text-ink mb-4" aria-hidden="true" />
              <h2 className="text-heading font-medium text-ink">
                No recordings match “{search}”
              </h2>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="mt-4 flex items-center gap-1.5 rounded-sm border border-subtle bg-solid px-3 py-2 text-body-sm font-medium text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Clear search
              </button>
            </div>
          ) : (
            // Library empty.
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <ExternalLink size={48} strokeWidth={1.5} className="text-ink mb-4" aria-hidden="true" />
              <h2 className="text-heading font-medium text-ink">Nothing recorded yet</h2>
              <p className="mt-2 text-body-sm text-ink max-w-md">
                Choose a source on the Record tab, then hit Record. Your clips
                will land here.
              </p>
              <button
                type="button"
                onClick={() => setView("record")}
                className="mt-4 flex items-center gap-1.5 rounded-sm border border-subtle bg-solid px-3 py-2 text-body-sm font-medium text-ink hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Go to Record
              </button>
            </div>
          )
        ) : (
          // Grid of recording cards.
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {library.items.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                onOpen={openDrawer}
                onDelete={(id) => setPendingDelete({ id, name: item.fileName })}
              />
            ))}
            {library.items.length < library.total && (
              <button
                onClick={() => {
                  setLibraryOffset(library.offset + library.limit);
                  void loadLibrary();
                }}
                className="col-span-full flex w-full items-center justify-center gap-2 py-3 rounded-sm border border-subtle bg-solid text-body-sm text-accent hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <LoaderCircle size={16} strokeWidth={2} aria-hidden="true" />
                Show more
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 px-6 py-2 text-xs text-ink">
        Showing {library.items.length} of {library.total} recording
        {library.total !== 1 ? "s" : ""}.
      </div>

      {/* Detail drawer (5.3) */}
      <RecordingDrawer open={drawerOpen} onClose={closeDrawer} />

      {/* Delete confirm modal (5.4) */}
      {pendingDelete && (
        <DeleteConfirm
          open={true}
          recordingName={pendingDelete.name}
          recordingId={pendingDelete.id}
          onConfirm={(id) => {
            void deleteRecording(id);
            setPendingDelete(null);
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
