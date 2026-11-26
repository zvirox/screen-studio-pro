import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Copy,
  ExternalLink,
  Film,
  LoaderCircle,
  Search,
  Trash2,
} from "lucide-react";
import { useSspStore } from "../../lib/store";
import RecordingDrawer from "./RecordingDrawer";
import DeleteConfirm from "./DeleteConfirm";
import type { LibraryListItem } from "../../types/ipc";
import { cn } from "../../lib/cn";
import { Reveal } from "../ui/Reveal";
import Button from "../ui/Button";

/* DESIGN.md v6.0 — Library grid (task 5.2).
   Card: solid surface, 8px radius, 1px `--border`, tokenized `shadow-card`.
   Loading: skeleton grid — shimmer on solid shapes. Recording item: 16:9 thumbnail
   (6px radius), theme-aware duration chip bottom-right, visible quick actions. */

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
  featured = false,
}: {
  item: LibraryListItem;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
  featured?: boolean;
}) {
  const handleDelete = () => {
    onDelete(item.id);
  };

  return (
    <article
      className={cn(
        "group relative rounded-md border border-subtle bg-solid p-4 shadow-card",
        "transition-colors duration-fast ease-fast hover:border-border-strong hover:bg-surface-hover focus-within:border-border-strong",
        featured && "lg:col-span-2",
      )}
    >
      {/* 16:9 thumbnail (r.sm). The separate open button keeps the article
          non-interactive and gives keyboard users the same drawer action. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-raised">
        {item.thumbPath ? (
          <img src={item.thumbPath} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-secondary">
            <Film size={24} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
        <button
          type="button"
          aria-label={`Open recording ${item.fileName}`}
          onClick={() => onOpen(item.id)}
          className="absolute inset-0 rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        />
        {/* Duration chip bottom-right uses the canvas ground and theme text. */}
        <span className="pointer-events-none absolute bottom-1 right-1 flex items-center gap-1 rounded-xs bg-[var(--hero-canvas-bg)] px-1.5 py-0.5 font-mono text-mono-sm text-ink">
          {formatDuration(item.durationMs)}
        </span>
        {/* Missing-file overlay (§5.5): thumbnail persists + error chip. */}
        {item.status === "missing" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-canvas">
            <div className="flex items-center gap-2 rounded-sm border border-error bg-tint-red px-2.5 py-1.5">
              <span className="text-body-sm font-medium text-error">File missing</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 min-w-0">
        {/* Name body-sm 500 */}
        <h3 className="line-clamp-1 text-body-sm font-medium text-ink">{item.fileName}</h3>
        {/* Meta row (label/mono-sm): date · size · fps · encoder */}
        <p className="mt-1 truncate text-label text-ink-secondary">
          {formatDate(item.createdAt)} · {formatSize(item.sizeBytes)} · {item.fps}fps ·{" "}
          {item.encoder}
        </p>
      </div>

      {/* Quick actions stay visible: hover is enhancement, never a prerequisite. */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Open recording"
          onClick={() => onOpen(item.id)}
        >
          <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Copy path"
          onClick={() => {
            void navigator.clipboard.writeText(item.path);
          }}
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Delete recording"
          onClick={handleDelete}
          className="text-error hover:border-error hover:bg-error-muted"
        >
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="group relative cursor-default rounded-md border border-subtle bg-solid p-4 shadow-card">
      {/* §6.5 loading: skeleton grid — shimmer on surface.solid shapes, never spinners mid-page. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-solid">
        <div className="h-full w-full animate-pulse bg-solid" />
        <div className="absolute bottom-1 right-1 flex items-center gap-1 rounded-xs bg-[var(--hero-canvas-bg)] px-1.5 py-0.5">
          <div className="h-3 w-8 rounded-xs bg-ink-disabled" />
        </div>
      </div>
      <div className="mt-3">
        <div className="h-4 w-3/4 animate-pulse bg-solid" />
        <div className="mt-1 h-3 w-1/2 animate-pulse bg-solid" />
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

  const handleSort = useCallback(
    (field: "created_at" | "duration" | "size") => {
      if (sortField === field) {
        setSortDir(sortDir === "asc" ? "desc" : "asc");
      } else {
        setSortField(field);
        setSortDir("desc");
      }
    },
    [sortField, sortDir],
  );

  return (
    <section className="flex h-full min-w-0 flex-col" data-testid="library-grid">
      {/* Header with search */}
      <div className="flex shrink-0 flex-wrap px-4 py-4 min-[720px]:px-6">
        <div className="relative w-full min-w-0 max-w-md">
          <label htmlFor="library-search" className="sr-only">
            Search recordings
          </label>
          <input
            id="library-search"
            type="search"
            placeholder="Search"
            value={search}
            onChange={handleSearch}
            className="h-10 w-full min-w-0 rounded-sm border border-subtle bg-solid pl-9 pr-3 text-body-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary">
            <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Grid header */}
      <div className="shrink-0 border-b border-subtle bg-raised px-4 py-2 min-[720px]:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-label font-medium text-ink">
          <span className="flex min-h-9 items-center">Recordings</span>
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-label">
            <button
              type="button"
              onClick={() => handleSort("created_at")}
              aria-pressed={sortField === "created_at"}
              className={cn(
                "flex min-h-9 items-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                sortField === "created_at" && "border-subtle bg-active text-ink",
              )}
            >
              Date
              {sortField === "created_at" &&
                (sortDir === "desc" ? (
                  <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
                ))}
            </button>
            <button
              type="button"
              onClick={() => handleSort("duration")}
              aria-pressed={sortField === "duration"}
              className={cn(
                "flex min-h-9 items-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                sortField === "duration" && "border-subtle bg-active text-ink",
              )}
            >
              Duration
              {sortField === "duration" &&
                (sortDir === "desc" ? (
                  <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
                ))}
            </button>
            <button
              type="button"
              onClick={() => handleSort("size")}
              aria-pressed={sortField === "size"}
              className={cn(
                "flex min-h-9 items-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                sortField === "size" && "border-subtle bg-active text-ink",
              )}
            >
              Size
              {sortField === "size" &&
                (sortDir === "desc" ? (
                  <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
                ))}
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 min-[720px]:px-6">
        {library.status === "error" ? (
          // §5.5 error state — show §1 copy with retry.
          <div className="flex h-full min-w-0 max-w-full flex-col items-center justify-center py-20 text-center">
            <CircleAlert
              size={48}
              strokeWidth={1.5}
              className="mb-4 shrink-0 text-error"
              aria-hidden="true"
            />
            <h2 className="max-w-full wrap-anywhere text-heading font-medium text-ink">
              Could not load recordings
            </h2>
            <p className="mt-2 max-w-md wrap-anywhere text-body-sm text-ink-secondary">
              {library.error?.userMessage ?? "Failed to load recordings."}
            </p>
            <Button onClick={() => void loadLibrary()} className="mt-4">
              <LoaderCircle size={14} strokeWidth={1.5} aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : library.status === "loading" && library.items.length === 0 ? (
          // §6.5 loading: skeleton grid, never spinners mid-page.
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : library.items.length === 0 ? (
          // §6.3 empty: teach the interface, never say "nothing here".
          search ? (
            // Search empty.
            <div className="flex h-full min-w-0 max-w-full flex-col items-center justify-center py-20 text-center">
              <Search
                size={48}
                strokeWidth={1.5}
                className="mb-4 shrink-0 text-ink-secondary"
                aria-hidden="true"
              />
              <h2 className="max-w-full wrap-anywhere text-heading font-medium text-ink">
                No recordings match “{search}”
              </h2>
              <Button onClick={() => setSearch("")} className="mt-4">
                Clear search
              </Button>
            </div>
          ) : (
            // Library empty.
            <div className="flex h-full min-w-0 max-w-full flex-col items-center justify-center py-20 text-center">
              <Film
                size={48}
                strokeWidth={1.5}
                className="mb-4 shrink-0 text-ink-secondary"
                aria-hidden="true"
              />
              <h2 className="max-w-full wrap-anywhere text-heading font-medium text-ink">
                Nothing recorded yet
              </h2>
              <p className="mt-2 max-w-md wrap-anywhere text-body-sm text-ink-secondary">
                Choose a source on the Record tab, then hit Record. Your clips will land here.
              </p>
              <Button onClick={() => setView("record")} className="mt-4">
                Go to Record
              </Button>
            </div>
          )
        ) : (
          // Grid of recording cards.
          <Reveal>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {library.items.map((item, index) => (
                <LibraryCard
                  key={item.id}
                  item={item}
                  featured={index === 0}
                  onOpen={openDrawer}
                  onDelete={(id) => setPendingDelete({ id, name: item.fileName })}
                />
              ))}
              {library.items.length < library.total && (
                <Button
                  onClick={() => {
                    setLibraryOffset(library.offset + library.limit);
                    void loadLibrary();
                  }}
                  className="col-span-full w-full"
                >
                  <LoaderCircle size={16} strokeWidth={2} aria-hidden="true" />
                  Show more
                </Button>
              )}
            </div>
          </Reveal>
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 px-4 py-2 text-label text-ink-secondary min-[720px]:px-6">
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
