/* §6.4 Settings pane stub — Capture / Audio / Files / Shortcuts / About
   arrive with their phases; only Camera is wired in 4.4. Dead panes never
   render (§6.3). */

export default function PaneStub({ id }: { id: string }) {
  return (
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <h1 className="text-display-md">{id.charAt(0).toUpperCase() + id.slice(1)}</h1>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        This pane arrives with its phase.
      </p>
    </section>
  );
}
