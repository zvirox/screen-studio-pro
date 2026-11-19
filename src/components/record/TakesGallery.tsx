import { useEffect, useState } from "react";
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

/* DESIGN.md v3.0 §5.4 — Right Takes & Presets Gallery (Camo Studio Style)
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

interface TakeCardProps {
  item: LibraryListItem;
  onOpen: (id: number) => void;
}

function TakeCard({ item, onOpen }: TakeCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard) {
      void navigator.clipboard.writeText(item.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReveal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.path) {
      void revealItemInDir(item.path);
    }
  };

  return (
    <article
      tabIndex={0}
      role="button"
      aria-label={`Recording ${item.fileName}`}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
      className={cn(
        "group relative flex flex-col gap-2 rounded-md border border-subtle bg-solid p-2.5",
        "cursor-pointer shadow-elev-1 transition-all duration-fast hover:border-accent hover:shadow-elev-2",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
      )}
    >
      {/* 16:9 Thumbnail Box */}
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-raised border border-subtle/50">
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

        {/* Duration chip (bottom-right) */}
        <span className="absolute bottom-1.5 right-1.5 rounded-xs bg-black/75 px-1.5 py-0.5 font-mono text-mono-sm font-medium text-white shadow-sm">
          {formatDuration(item.durationMs)}
        </span>

        {/* Hover Action Overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/50 opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`Play ${item.fileName}`}
            title="Open detail drawer"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(item.id);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-xs bg-white text-black shadow-sm transition-transform hover:scale-105 active:scale-95"
          >
            <Play size={13} className="fill-current ml-0.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Reveal ${item.fileName} in file manager`}
            title="Reveal in file manager"
            onClick={handleReveal}
            className="flex h-7 w-7 items-center justify-center rounded-xs bg-solid border border-subtle text-ink shadow-sm transition-transform hover:scale-105 hover:bg-accent-muted active:scale-95"
          >
            <ExternalLink size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Copy path of ${item.fileName}`}
            title="Copy file path"
            onClick={handleCopyPath}
            className="flex h-7 w-7 items-center justify-center rounded-xs bg-solid border border-subtle text-ink shadow-sm transition-transform hover:scale-105 hover:bg-accent-muted active:scale-95"
          >
            {copied ? (
              <Check size={13} className="text-accent" aria-hidden="true" />
            ) : (
              <Copy size={13} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Info Row */}
      <div className="flex flex-col">
        <span className="truncate text-body-sm font-medium text-ink group-hover:text-accent">
          {item.fileName}
        </span>
        <div className="flex items-center justify-between font-mono text-label text-ink-secondary">
          <span>{formatSize(item.sizeBytes)}</span>
          <span className="uppercase">{item.container}</span>
        </div>
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

  const [mode, setMode] = useState<"takes" | "presets">("takes");

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const recentItems = library.items.slice(0, 5);

  return (
    <aside
      aria-label="Takes and Presets Gallery"
      className="flex w-full shrink-0 flex-col gap-4 studio-deck rounded-lg p-4 border border-line-glass shadow-elev-2 min-[1120px]:w-[260px]"
    >
      {/* Header with Segmented Switcher */}
      <div className="flex items-center justify-between border-b border-subtle pb-3">
        <div
          role="tablist"
          aria-label="Gallery Mode"
          className="flex items-center gap-1 rounded-sm border border-subtle bg-solid p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "takes"}
            onClick={() => setMode("takes")}
            className={cn(
              "flex items-center gap-1 rounded-xs px-2.5 py-1 text-label font-medium transition-colors",
              mode === "takes"
                ? "bg-accent text-accent-text shadow-sm"
                : "text-ink-secondary hover:text-ink",
            )}
          >
            <Film size={12} aria-hidden="true" />
            <span>Takes</span>
            {library.items.length > 0 && (
              <span className="ml-0.5 rounded-full bg-white/20 px-1 font-mono text-[10px]">
                {library.items.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "presets"}
            onClick={() => setMode("presets")}
            className={cn(
              "flex items-center gap-1 rounded-xs px-2.5 py-1 text-label font-medium transition-colors",
              mode === "presets"
                ? "bg-accent text-accent-text shadow-sm"
                : "text-ink-secondary hover:text-ink",
            )}
          >
            <Sliders size={12} aria-hidden="true" />
            <span>Presets</span>
          </button>
        </div>
        <span className="text-label uppercase tracking-wider text-ink-secondary">Deck</span>
      </div>

      {/* Takes Content */}
      {mode === "takes" && (
        <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
          {recentItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-subtle bg-solid text-ink-disabled">
                <Film size={24} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div>
                <p className="text-body-sm font-medium text-ink">No takes recorded yet</p>
                <p className="mt-0.5 text-label text-ink-secondary max-w-[200px]">
                  Hit Record to capture your first widescreen take.
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
            className="mt-auto flex h-9 items-center justify-between rounded-sm border border-subtle bg-solid px-3 text-body-sm font-medium text-ink hover:border-accent hover:bg-accent-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex items-center gap-2">
              <FolderOpen size={14} className="text-accent" aria-hidden="true" />
              Open Library
            </span>
            <ArrowRight size={14} className="text-ink-secondary" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Presets Content */}
      {mode === "presets" && (
        <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto">
          {presets.presets.map((p, idx) => {
            const isSelected = presets.presetId === p.id;
            const hotkey = `F${idx + 1}`;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void setPreset(p.id)}
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors",
                  isSelected
                    ? "border-accent bg-accent-muted/40 shadow-sm"
                    : "border-subtle bg-solid hover:border-accent hover:bg-accent-muted",
                  "focus-visible:outline-2 focus-visible:outline-accent",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-body-sm font-semibold text-ink">{p.label}</span>
                  <span className="rounded-xs border border-subtle bg-canvas px-1.5 py-0.5 font-mono text-label text-ink-secondary">
                    {hotkey}
                  </span>
                </div>
                <span className="text-label text-ink-secondary truncate">{p.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
