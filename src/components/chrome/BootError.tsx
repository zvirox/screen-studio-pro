/* Boot-error screen (API §5.1) — full-window fallback when the core contract
   fails the version gate or the core never answers. Human copy only (§7.9);
   both versions named explicitly, mono. Token-only styling (DESIGN §8). */

export default function BootError({
  userMessage,
  expected,
  actual,
}: {
  userMessage: string;
  expected: string;
  actual: string | null;
}) {
  return (
    <main className="pane flex h-screen flex-col items-center justify-center rounded-lg p-10 text-center">
      <span className="app-mark mb-5" aria-hidden="true" />
      <h1 className="text-display-md text-ink">ScreenStudio Pro can't start</h1>
      <p className="mt-3 max-w-md text-body-sm text-ink-secondary">
        {userMessage}
      </p>
      <dl className="mt-6 rounded-xs border border-subtle bg-solid px-4 py-3 text-left font-mono text-mono-sm">
        <div className="flex gap-3">
          <dt className="text-ink-disabled">expected</dt>
          <dd className="text-ink">{expected}</dd>
        </div>
        <div className="mt-1 flex gap-3">
          <dt className="text-ink-disabled">found</dt>
          <dd className="text-ink">{actual ?? "no answer"}</dd>
        </div>
      </dl>
      <p className="mt-6 max-w-md text-body-sm text-ink-secondary">
        Full details are in the log file. If this keeps happening, report it on
        the project's issue tracker.
      </p>
    </main>
  );
}
