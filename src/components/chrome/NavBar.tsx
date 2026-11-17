import { useRef, useState, type KeyboardEvent } from "react";
import {
  Circle,
  Library,
  Radio,
  Settings,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { asIpcError, windowHide } from "../../lib/ipc";
import { useSspStore, type ViewId } from "../../lib/store";

/* DESIGN.md v2.0 §5.8 NavBar — window chrome law:
   52px Pane recipe, r.lg top corners only · flat rectangular tab row (r.sm,
   32px, 16px lucide icon + label, active = accent.muted + 2px bottom accent
   indicator) · Stream always disabled with V2 badge · custom CSD (native
   decorations off) — the bar is the drag region.
   §7.3: tabs use arrow-key roving; the universal focus ring comes from
   tailwind.css base. */

type NavItem = {
  id: ViewId | "stream";
  label: string;
  icon: LucideIcon;
  disabled?: true;
  badge?: string;
};

const NAV_ITEMS: readonly NavItem[] = [
  { id: "record", label: "Record", icon: Circle },
  { id: "library", label: "Library", icon: Library },
  { id: "stream", label: "Stream", icon: Radio, disabled: true, badge: "V2" },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function NavBar() {
  const view = useSspStore((s) => s.view);
  const setView = useSspStore((s) => s.setView);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hiding, setHiding] = useState(false);

  async function hide() {
    setHiding(true);
    try {
      await windowHide();
    } catch (err) {
      useSspStore.getState().showError(asIpcError(err));
    } finally {
      setHiding(false);
    }
  }

  function select(id: NavItem["id"], el?: HTMLButtonElement | null) {
    if (id === "stream") return; // always disabled (§5.8)
    setView(id);
    el?.focus();
  }

  // §7.3 — arrow-key roving across the tab row (disabled tabs skipped)
  function onKeyDown(e: KeyboardEvent) {
    const focusable = NAV_ITEMS.filter((i) => !i.disabled);
    const current = focusable.findIndex((i) => i.id === view);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (current + 1) % focusable.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (current - 1 + focusable.length) % focusable.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = focusable.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const target = focusable[next];
    select(target.id, tabRefs.current[NAV_ITEMS.indexOf(target)]);
  }

  return (
    <header
      data-tauri-drag-region
      className="pane flex h-13 shrink-0 items-center rounded-t-lg border-b border-subtle px-4"
    >
      {/* left zone — mirrored with the right zone (flex-1) so the tab row
          is always exactly centered; the name yields below the compact band (§6) */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        <span className="app-mark" aria-hidden="true" />
        <span
          data-tauri-drag-region
          className="hidden truncate text-body-sm font-medium min-[720px]:inline"
        >
          ScreenStudio Pro
        </span>
      </div>

      {/* center zone — flat rectangular tabs (§5.8) */}
      <nav className="flex flex-none justify-center" aria-label="Primary">
        <div
          role="tablist"
          aria-label="Views"
          onKeyDown={onKeyDown}
          className="flex h-9 items-center gap-1 rounded-sm border border-subtle bg-glass p-1"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.id === view && !item.disabled;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[NAV_ITEMS.indexOf(item)] = el;
                }}
                role="tab"
                aria-selected={active}
                disabled={item.disabled}
                title={item.disabled ? "Streaming arrives in V2" : undefined}
                tabIndex={active || (item.id === view && item.disabled) ? 0 : -1}
                onClick={() => select(item.id)}
                className={`relative flex h-8 items-center gap-2 rounded-sm px-3 text-body-sm font-medium
                  ${
                    active
                      ? "bg-accent-muted text-accent"
                      : "text-ink-secondary hover:bg-accent-muted hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled"
                  }`}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                {item.label}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-0.5 bg-accent"
                  />
                ) : null}
                {item.badge ? (
                  <span className="rounded-xs border border-subtle px-1 py-0.5 font-mono text-label leading-none text-ink-disabled">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {/* right zone — quick settings + guarded minimize to tray (§5.8) */}
      <div className="flex flex-1 items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Settings tray"
          title="Quick settings (arrives Phase 6)"
          onClick={() => setView("settings")}
          className="flex h-10 w-10 items-center justify-center rounded-sm text-ink-secondary transition-colors duration-fast ease-fast hover:bg-accent-muted hover:text-ink"
        >
          <SlidersHorizontal size={20} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize to tray"
          disabled={hiding}
          aria-busy={hiding}
          onClick={() => void hide()}
          className="flex h-10 w-10 items-center justify-center rounded-sm text-ink-secondary transition-colors duration-fast ease-fast hover:bg-accent-muted hover:text-ink"
        >
          <X size={20} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
