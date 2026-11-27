import { useState } from "react";
import { Keyboard } from "lucide-react";
import { useSspStore } from "../../lib/store";
import { shortcutsApply } from "../../lib/ipc";
import type { IpcError } from "../../types/ipc";

/* §6.4 Settings — Shortcuts pane. Global shortcut bindings via the portal
   (cmd://shortcuts_apply). Toggle-record / pause / stop combos. Compositors
   without GlobalShortcuts fall back to tray controls (PRD risk note). */

export default function ShortcutsPane() {
  const shortcuts = useSspStore((s) => s.settings.shortcuts);
  const [toggling, setToggling] = useState(false);
  const [applied, setApplied] = useState(false);

  const bindings = [
    {
      action: "toggle_record",
      label: "Toggle record",
      value: shortcuts?.quickRecord ?? "Super+Shift+R",
    },
    { action: "pause", label: "Pause / resume", value: shortcuts?.pause ?? "Super+Shift+P" },
    { action: "stop", label: "Stop & save", value: shortcuts?.stop ?? "Super+Shift+S" },
  ];

  return (
    <section>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        Global keyboard shortcuts are registered through the portal. On compositors without
        GlobalShortcuts support, use the tray menu instead (see docs/portal-support.md).
      </p>

      <div className="mt-6 space-y-4">
        {bindings.map((b) => (
          <div
            key={b.action}
            className="flex flex-col items-stretch gap-3 rounded-sm border border-subtle bg-solid p-3 min-[520px]:flex-row min-[520px]:items-center"
          >
            <div className="flex items-center gap-3">
              <Keyboard size={16} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p className="text-body-sm font-medium text-ink">{b.label}</p>
                <p className="text-xs text-ink-secondary">{b.action}</p>
              </div>
            </div>
            <div className="flex min-w-0 gap-2 min-[520px]:ml-auto">
              <input
                type="text"
                value={b.value}
                onChange={() => {
                  // optimistic local edit; applied on Apply
                }}
                readOnly
                className="h-9 min-w-0 flex-1 rounded-sm border border-subtle bg-solid p-1 font-mono text-mono-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent min-[520px]:w-40 min-[520px]:flex-none"
                disabled
              />
              <button
                type="button"
                onClick={() => {
                  // click to edit — placeholder for future combo capture UI
                }}
                disabled={toggling}
                className="h-9 rounded-sm border border-subtle bg-solid px-3 text-body-sm text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={async () => {
            setToggling(true);
            try {
              const { denied } = await shortcutsApply(
                bindings.map((b) => ({ action: b.action, combo: b.value })),
              );
              setApplied(true);
              setTimeout(() => setApplied(false), 2000);
              if (denied.length > 0) {
                void useSspStore.getState().showError({
                  kind: "ipc",
                  code: "portal.unavailable",
                  retryable: false,
                  userMessage: `Global shortcuts denied for: ${denied.join(", ")}`,
                  details: null,
                });
              }
            } catch (err) {
              void useSspStore.getState().showError(err as IpcError);
            } finally {
              setToggling(false);
            }
          }}
          disabled={toggling}
          className={`flex items-center gap-2 rounded-sm border border-subtle bg-solid px-4 py-2 text-body-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
            ${toggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-surface-hover"}`}
        >
          {toggling ? "Applying…" : "Apply shortcuts"}
        </button>
        {applied && (
          <span className="ml-2 h-9 flex items-center px-2.5 rounded-xs bg-chip-sky text-sky-text text-xs font-medium">
            Applied
          </span>
        )}
      </div>
    </section>
  );
}
