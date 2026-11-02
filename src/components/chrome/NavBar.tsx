import { useRef, type KeyboardEvent } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSspStore, type ViewId } from "../../lib/store";

/* §5.8 NavBar — window chrome law:
   52px Pane recipe, r.lg top corners only · segmented pill (r.full, 32px,
   active = surface.solid raise) · Stream pill always disabled with V2 badge ·
   custom CSD (native decorations off) — the bar is the drag region.
   §7.3: segmented nav is arrow-key roving; the universal focus ring comes
   from tailwind.css base. */

type NavItem = {
  id: ViewId | "stream";
  label: string;
  disabled?: true;
  badge?: string;
};

const NAV_ITEMS: readonly NavItem[] = [
  { id: "record", label: "Record" },
  { id: "library", label: "Library" },
  { id: "stream", label: "Stream", disabled: true, badge: "V2" },
  { id: "settings", label: "Settings" },
];

export default function NavBar() {
  const view = useSspStore((s) => s.view);
  const setView = useSspStore((s) => s.setView);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(id: NavItem["id"], el?: HTMLButtonElement | null) {
    if (id === "stream") return; // always disabled (§5.8)
    setView(id);
    el?.focus();
  }

  // §7.3 — arrow-key roving across the segmented control (disabled pills skipped)
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
      className="pane flex h-[52px] shrink-0 items-center rounded-t-lg border-b border-subtle px-4"
    >
      {/* left zone — mirrored with the right zone (flex-1) so the segmented pill
          is always exactly centered; the name yields below the compact band (§6) */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span className="app-mark" aria-hidden="true" />
        <span
          data-tauri-drag-region
          className="hidden truncate text-body-sm font-medium min-[720px]:inline"
        >
          ScreenStudio Pro
        </span>
      </div>

      {/* center zone — segmented pill */}
      <nav
        className="flex flex-none justify-center"
        aria-label="Primary"
      >
        <div
          role="tablist"
          aria-label="Views"
          onKeyDown={onKeyDown}
          className="seg flex h-8 items-center gap-3 rounded-full border border-subtle bg-glass p-[3px]"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.id === view && !item.disabled;
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
                className={
                  active
                    ? "flex h-[26px] items-center gap-2 rounded-full bg-solid px-4 text-body-sm font-medium text-ink shadow-elev-1"
                    : "flex h-[26px] items-center gap-2 rounded-full px-4 text-body-sm font-medium text-ink-secondary hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled"
                }
              >
                {item.label}
                {item.badge ? (
                  <span className="rounded-xs border border-subtle px-1 py-0.5 font-mono text-[10px] leading-none text-ink-disabled">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {/* right zone — tray gear + minimize to tray (tray lands in Phase 6; minimize to window list until then) */}
      <div className="flex flex-1 items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Settings tray"
          title="Quick settings (arrives Phase 6)"
          onClick={() => setView("settings")}
          className="icon-btn flex h-10 w-10 items-center justify-center rounded-sm text-ink-secondary hover:bg-accent-muted hover:text-ink"
        >
          <SlidersHorizontal size={20} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize to tray"
          onClick={() => void getCurrentWindow().minimize()}
          className="icon-btn flex h-10 w-10 items-center justify-center rounded-sm text-ink-secondary hover:bg-accent-muted hover:text-ink"
        >
          <X size={20} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
