import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  Play,
  Sliders,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { cn } from "../../lib/cn";
import { useSspStore } from "../../lib/store";
import type { LibraryListItem } from "../../types/ipc";
import Button from "../ui/Button";

/* DESIGN.md v3.1 §5.4/§7.2/§7.4 — Right Takes & Presets Gallery.
   Tabs use roving keyboard focus; take actions stay visible and are native
   siblings of the card's Open control, never nested interactive elements.
   260px fixed width floating inside workspace (r.lg = 16px, Studio Deck recipe).
   Contains:
   - Header with toggle between "Takes" and "Presets"
   - Vertical stack of recent takes (16:9 cards, duration chip, size badge, quick actions)
   - Quick presets selector with hotkey chips (F1, F2, F3)
   - Responsive collapse handling
*/

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(1)} ${units[unitIdx]}`;
}

type GalleryMode = "takes" | "presets";

const GALLERY_MODES: GalleryMode[] = ["takes", "presets"];

interface TakeCardProps {
  item: LibraryListItem;
  onOpen: (id: number) => void;
}

function TakeCard({ item, onOpen }: TakeCardProps) {
  const [copied, setCopied] = useState(false);
  const titleId = `take-${item.id}-title`;

  const handleCopyPath = () => {
    if (navigator?.clipboard) {
      void navigator.clipboard.writeText(item.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReveal = () => {
    if (item.path) {
      void revealItemInDir(item.path);
    }
  };

  return (
    <article
      aria-labelledby={titleId}
      className="group relative flex min-w-0 flex-col gap-2 rounded-md border border-subtle bg-solid p-2.5 transition-colors duration-fast hover:border-border-strong"
    >
      <button
        type="button"
        aria-label={`Recording ${item.fileName}`}
        onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-col gap-2 rounded-xs text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        {/* 16:9 Thumbnail Box */}
        <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-raised border border-subtle">
          {item.thumbPath ? (
            <img
              src={item.thumbPath}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-canvas text-ink-disabled">
              <Film size={22} strokeWidth={1.5} aria-hidden="true" />
            </div>
          )}

          {/* Opaque token surfaces keep duration legible over every thumbnail. */}
          <span className="absolute bottom-1.5 right-1.5 rounded-xs border border-subtle bg-canvas px-1.5 py-0.5 font-mono text-mono-sm font-medium text-ink">
            {formatDuration(item.durationMs)}
          </span>
        </div>

        {/* Info Row */}
        <div className="flex min-w-0 flex-col">
          <span
            id={titleId}
            className="truncate text-body-sm font-medium text-ink"
          >
            {item.fileName}
          </span>
          <div className="flex items-center justify-between gap-2 font-mono text-label text-ink-secondary">
            <span>{formatSize(item.sizeBytes)}</span>
            <span>{item.container}</span>
          </div>
        </div>
      </button>

      {/* DESIGN v3.1: quick actions are persistent, 36px native controls. */}
      <div className="flex items-center gap-1.5 border-t border-subtle pt-2">
        <Button
          size="sm"
          aria-label={`Play ${item.fileName}`}
          title="Open detail drawer"
          onClick={() => onOpen(item.id)}
          className="min-w-0 flex-1"
        >
          <Play size={14} className="fill-current" aria-hidden="true" />
          Play
        </Button>
        <Button
          size="icon"
          aria-label={`Reveal ${item.fileName} in file manager`}
          title="Reveal in file manager"
          onClick={handleReveal}
        >
          <ExternalLink size={16} aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          aria-label={`Copy path of ${item.fileName}`}
          title="Copy file path"
          onClick={handleCopyPath}
        >
          {copied ? (
            <Check size={16} className="text-ink" aria-hidden="true" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
        </Button>
      </div>
    </article>
  );
}

export default function TakesGallery() {
  const library = useSspStore((s) => s.library);
  const openDrawer = useSspStore((s) => s.openDrawer);
  const setView = useSspStore((s) => s.setView);

  const presets = useSspStore((s) => s.presets);
  const loadPresets = useSspStore((s) => s.loadPresets);
  const setPreset = useSspStore((s) => s.setPreset);

  const [mode, setMode] = useState<GalleryMode>("takes");
  const tabRefs = useRef<Record<GalleryMode, HTMLButtonElement | null>>({
    takes: null,
    presets: null,
  });

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentMode: GalleryMode,
  ) => {
    const currentIndex = GALLERY_MODES.indexOf(currentMode);
    let nextIndex: number;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % GALLERY_MODES.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + GALLERY_MODES.length) % GALLERY_MODES.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = GALLERY_MODES.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextMode = GALLERY_MODES[nextIndex]!;
    setMode(nextMode);
    tabRefs.current[nextMode]?.focus();
  };

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const recentItems = library.items.slice(0, 5);

  return (
    <aside
      aria-label="Takes and Presets Gallery"
      className="flex w-full min-w-0 shrink-0 flex-col gap-4 studio-deck rounded-md p-4 min-[1120px]:w-[260px]"
    >
      {/* Header with Segmented Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-3">
        <div
          role="tablist"
          aria-label="Gallery Mode"
          className="flex min-w-0 flex-wrap items-center gap-1 rounded-sm border border-subtle bg-solid p-0.5"
        >
          <button
            ref={(node) => {
              tabRefs.current.takes = node;
            }}
            id="gallery-tab-takes"
            type="button"
            role="tab"
            aria-selected={mode === "takes"}
            aria-controls="gallery-panel-takes"
            tabIndex={mode === "takes" ? 0 : -1}
            onClick={() => setMode("takes")}
            onKeyDown={(event) => handleTabKeyDown(event, "takes")}
            className={cn(
              "flex min-h-9 items-center gap-1 rounded-xs border border-transparent px-2.5 py-1 text-body-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
              mode === "takes"
                ? "border-subtle bg-surface-hover text-ink"
                : "text-ink-secondary hover:text-ink",
            )}
          >
            <Film size={14} className="shrink-0" aria-hidden="true" />
            <span>Takes</span>
            {library.items.length > 0 && (
              <span className="ml-0.5 shrink-0 rounded-xs border border-subtle bg-solid px-1 font-mono text-label text-ink-secondary">
                {library.items.length}
              </span>
            )}
          </button>
          <button
            ref={(node) => {
              tabRefs.current.presets = node;
            }}
            id="gallery-tab-presets"
            type="button"
            role="tab"
            aria-selected={mode === "presets"}
            aria-controls="gallery-panel-presets"
            tabIndex={mode === "presets" ? 0 : -1}
            onClick={() => setMode("presets")}
            onKeyDown={(event) => handleTabKeyDown(event, "presets")}
            className={cn(
              "flex min-h-9 items-center gap-1 rounded-xs border border-transparent px-2.5 py-1 text-body-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
              mode === "presets"
                ? "border-subtle bg-surface-hover text-ink"
                : "text-ink-secondary hover:text-ink",
            )}
          >
            <Sliders size={14} className="shrink-0" aria-hidden="true" />
            <span>Presets</span>
          </button>
        </div>
        <span className="shrink-0 text-label font-medium text-ink-secondary">
          Gallery
        </span>
      </div>

      {/* Takes Content */}
      <div
        id="gallery-panel-takes"
        role="tabpanel"
        aria-labelledby="gallery-tab-takes"
        hidden={mode !== "takes"}
        tabIndex={0}
        className={cn(
          mode === "takes" ? "flex" : "hidden",
          "min-w-0 flex-col gap-3 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        )}
      >
        {recentItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-subtle bg-solid text-ink-disabled">
              <Film size={24} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <p className="text-body-sm font-medium text-ink">No takes recorded yet</p>
              <p className="mt-0.5 text-label text-ink-secondary max-w-[200px]">
                Select a source, then record
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {recentItems.map((item) => (
              <TakeCard key={item.id} item={item} onOpen={openDrawer} />
            ))}
          </div>
        )}

        {/* View Full Library Button */}
        <button
          type="button"
          onClick={() => setView("library")}
          className="mt-auto flex h-9 items-center justify-between rounded-sm border border-subtle bg-solid px-3 text-body-sm font-medium text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="flex items-center gap-2">
            <FolderOpen size={14} className="text-ink-secondary" aria-hidden="true" />
            Open Library
          </span>
          <ArrowRight size={14} className="text-ink-secondary" aria-hidden="true" />
        </button>
      </div>

      {/* Presets Content */}
      <div
        id="gallery-panel-presets"
        role="tabpanel"
        aria-labelledby="gallery-tab-presets"
        hidden={mode !== "presets"}
        tabIndex={0}
        className={cn(
          mode === "presets" ? "flex" : "hidden",
          "min-w-0 flex-col gap-2.5 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        )}
      >
        {presets.presets.map((p, idx) => {
          const isSelected = presets.presetId === p.id;
          const hotkey = `F${idx + 1}`;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => void setPreset(p.id)}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-md border p-2.5 text-left transition-colors",
                isSelected
                  ? "border-subtle bg-surface-hover"
                  : "border-subtle bg-solid hover:bg-surface-hover",
                "focus-visible:outline-2 focus-visible:outline-accent",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-body-sm font-semibold text-ink">
                  {p.label}
                </span>
                <span className="shrink-0 rounded-xs border border-subtle bg-canvas px-1.5 py-0.5 font-mono text-label text-ink-secondary">
                  {hotkey}
                </span>
              </div>
              <span className="min-w-0 break-words text-label text-ink-secondary">
                {p.description}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
