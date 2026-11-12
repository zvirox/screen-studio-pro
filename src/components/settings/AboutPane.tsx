import { Info } from "lucide-react";
import { useSspStore } from "../../lib/store";

/* §6.4 Settings — About pane. Static app/version info. No settings to
   mutate; read-only display of the contract version and app identity. */

export default function AboutPane() {
  const capabilities = useSspStore((s) => s.capabilities);

  return (
    <section className="bg-raised rounded-lg p-6 max-w-[560px] mx-auto">
      <div className="flex items-center gap-3">
        <Info size={20} strokeWidth={1.5} aria-hidden="true" />
        <h1 className="text-display-md">About</h1>
      </div>
      <p className="mt-2 max-w-md text-body-sm text-ink-secondary">
        ScreenStudio Pro — screen recording for Wayland-first Linux
        desktops.
      </p>

      <div className="mt-8">
        <h2 className="text-heading text-ink mb-3">Application</h2>
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Name</dt>
            <dd className="text-body-sm text-ink">ScreenStudio Pro</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Version</dt>
            <dd className="text-body-sm text-ink text-mono-sm">0.0.1-alpha.1</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">IPC contract</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.version?.ipcContract ?? "1.6.0"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Distribution</dt>
            <dd className="text-body-sm text-ink">GitHub Releases · distro packages</dd>
          </div>
        </dl>
      </div>

      <div className="mt-8">
        <h2 className="text-heading text-ink mb-3">Capabilities</h2>
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Screencast</dt>
            <dd className="text-body-sm text-ink">
              {capabilities?.portal?.screencast ? "Available" : "Unavailable"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Global shortcuts</dt>
            <dd className="text-body-sm text-ink">
              {capabilities?.portal?.globalShortcuts ?? "partial"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Compositor</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.portal?.compositor ?? "unknown"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Encoders</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.encoders
                ?.map((e) => `${e.backend}${e.isHardware ? " (HW)" : ""}`)
                .join(", ") ?? "unknown"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">IPC contract</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.version?.ipcContract ?? "1.6.0"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-8 pt-4 border-t border-subtle">
        <p className="text-xs text-ink-secondary">
          No servers, no cloud, no telemetry. All capture and encode happens
          locally on your machine.
        </p>
      </div>
    </section>
  );
}
