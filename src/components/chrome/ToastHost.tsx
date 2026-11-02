import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, TriangleAlert, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useSspStore, type Toast } from "../../lib/store";
import { formatElapsed } from "../../lib/format";

/* §5.6 ToastHost — the Float recipe at floatover level: bottom-center
   stack (store caps at 3), 18px semantic icon, title body-sm 500, ghost
   action + copy icon-button on the Saved toast. Timers live HERE, not in
   the store: 5s plain status, 6s with action, errors persist until
   dismissed (§7.4 feedback is icon+text+color, never color alone).
   Enter y+12/opacity; exit fade. */

// §4.6 m.base 180ms spring / m.settle 90ms ease-in — hardcoded like
// App.tsx (the token set carries no durations; reduced-motion drops these
// to near-zero via the tailwind.css global rule).
const ENTER = {
  initial: { y: 12, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: 0.18, ease: [0.34, 1.56, 0.64, 1] as const },
  exit: { opacity: 0, transition: { duration: 0.09, ease: "easeIn" as const } },
};

const PLAIN_STATUS_MS = 5_000;
const ACTION_STATUS_MS = 6_000;

function ToastCard({ toast }: { toast: Toast }) {
  const dismissToast = useSspStore((s) => s.dismissToast);
  const [copied, setCopied] = useState(false);
  const copyReset = useRef<number | undefined>(undefined);

  const isError = toast.kind === "error";
  const hasActions = !isError && toast.path !== undefined;

  // §5.6: the auto-dismiss clock is the host's job. Errors never self-
  // dismiss; action toasts get the longer window. Copy-flash reset rides
  // a second timer — both cleaned up here.
  useEffect(() => {
    if (isError) return;
    const timer = window.setTimeout(
      () => dismissToast(toast.id),
      hasActions ? ACTION_STATUS_MS : PLAIN_STATUS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isError, hasActions, toast.id, dismissToast]);

  useEffect(() => {
    return () => window.clearTimeout(copyReset.current);
  }, []);

  async function copyPath() {
    if (toast.path === undefined) return;
    await navigator.clipboard.writeText(toast.path);
    setCopied(true);
    window.clearTimeout(copyReset.current);
    copyReset.current = window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <motion.div
      key={toast.id}
      layout
      {...ENTER}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={
        isError
          ? "float pointer-events-auto flex w-96 max-w-[calc(100vw-3rem)] items-start gap-2.5 rounded-md border-l-2 border-l-error p-3.5"
          : "float pointer-events-auto flex w-96 max-w-[calc(100vw-3rem)] items-start gap-2.5 rounded-md p-3.5"
      }
    >
      {isError ? (
        <TriangleAlert
          size={18}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-error"
          aria-hidden="true"
        />
      ) : (
        <Check
          size={18}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-accent"
          aria-hidden="true"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-ink">{toast.title}</p>
        {toast.durationMs !== undefined ? (
          <p className="mt-0.5 font-mono text-mono-md tabular-nums text-ink">
            {formatElapsed(toast.durationMs)}
          </p>
        ) : null}
        {toast.path !== undefined ? (
          <p
            className="mt-0.5 truncate font-mono text-mono-sm text-ink-secondary"
            title={toast.path}
          >
            {toast.path}
          </p>
        ) : null}
        {hasActions ? (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                toast.path !== undefined && void revealItemInDir(toast.path)
              }
              className="h-8 rounded-sm px-2.5 text-body-sm font-medium text-ink-secondary hover:bg-accent-muted hover:text-ink focus-visible:outline-accent"
            >
              Reveal
            </button>
          </div>
        ) : null}
      </div>

      {toast.path !== undefined ? (
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy path"}
          onClick={() => void copyPath()}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-secondary hover:bg-accent-muted hover:text-ink focus-visible:outline-accent"
        >
          {copied ? (
            <Check size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      ) : null}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-secondary hover:bg-accent-muted hover:text-ink focus-visible:outline-accent"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

export default function ToastHost() {
  const toasts = useSspStore((s) => s.toasts);

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
