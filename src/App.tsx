import { useState } from "react";
import { Sun, Moon, Type } from "lucide-react";

/* Temporary token swatch page for PLAN task 0.5 verification:
   toggling .light on <html> renders the second palette; mono figures
   must be tabular. Replaced by the real NavBar skeleton in task 0.4. */

const darkSwatches: Array<[string, string]> = [
  ["bg-canvas #0B0E13", "var(--color-canvas)"],
  ["bg-raised #10151D", "var(--color-raised)"],
  ["surface-solid #151B26", "var(--color-solid)"],
  ["border-subtle", "var(--color-subtle)"],
  ["border-glass", "var(--color-line-glass)"],
  ["text-primary #ECF1F6", "var(--color-ink)"],
  ["text-secondary", "var(--color-ink-secondary)"],
  ["accent #4FE3C6", "var(--color-accent)"],
  ["accent-muted", "var(--color-accent-muted)"],
  ["signal #FF5A66", "var(--color-signal)"],
  ["warning #FFC24B", "var(--color-warning)"],
  ["error #FF7A85", "var(--color-error)"],
];

function App() {
  const [light, setLight] = useState(false);
  document.documentElement.classList.toggle("light", light);

  return (
    <div className="min-h-screen bg-canvas p-8">
      <header className="mb-8 flex items-center gap-4">
        <h1 className="text-display-lg">Token swatches</h1>
        <span className="text-label uppercase tracking-wider">DESIGN.md v1.0 — task 0.5 verify</span>
        <button
          onClick={() => setLight((v) => !v)}
          className="ml-auto flex items-center gap-2 rounded-sm bg-solid px-4 py-2 text-body-sm text-ink hover:bg-accent-muted"
        >
          {light ? <Moon size={16} /> : <Sun size={16} />}
          {light ? "Dark" : "Light"} mode
        </button>
      </header>

      <section className="mb-8">
        <h2 className="text-heading mb-3">Colors ({light ? "light" : "dark"} face)</h2>
        <div className="grid grid-cols-4 gap-3">
          {darkSwatches.map(([name, value]) => (
            <div key={name} className="rounded-md border border-subtle bg-solid p-3">
              <div className="mb-2 h-10 rounded-sm border border-subtle" style={{ background: value }} />
              <div className="text-body-sm">{name}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-heading mb-3">Type scale</h2>
        <div className="rounded-md border border-subtle pane p-5">
          <p className="text-display-lg">Display lg — Ready to record</p>
          <p className="text-display-md">Display md — Recordings</p>
          <p className="text-heading">Heading — section title</p>
          <p className="text-body-md">Body md — the quick brown fox jumps over the lazy dog</p>
          <p className="text-body-sm text-ink-secondary">Body sm secondary — descriptions and list second lines</p>
          <p className="text-label">Label — overline floor</p>
          <p className="font-mono text-mono-md">0011223344 · mono-md timer 00:12:34</p>
          <p className="font-mono text-mono-sm text-ink-secondary">~/Videos/ScreenStudio/Take 001.mp4 · mono-sm</p>
        </div>
      </section>

      <section>
        <h2 className="text-heading mb-3">Glass recipes over content</h2>
        <div className="relative h-40 rounded-md" style={{ background: "linear-gradient(120deg, #7a5af8aa, #4fe3c688, #ff5a6677)" }}>
          <div className="pane absolute top-3 left-3 rounded-md p-3 text-body-sm">Pane — blur(20px) saturate(160%)</div>
          <div className="float absolute top-3 right-3 rounded-lg p-3 text-body-sm">Float — blur(28px) saturate(190%)</div>
          <div className="modal absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md p-3 text-body-sm">Modal — blur(32px)</div>
        </div>
      </section>

      <footer className="mt-8 flex items-center gap-2 text-ink-secondary">
        <Type size={14} />
        <span className="text-body-sm">Familjen Grotesk + JetBrains Mono, self-hosted @font-face</span>
      </footer>
    </div>
  );
}

export default App;
