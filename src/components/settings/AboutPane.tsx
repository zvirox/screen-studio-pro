import tauriConf from "../../../src-tauri/tauri.conf.json";
import { useSspStore } from "../../lib/store";
import logoUrl from "../../assets/screen-studio-pro-logo.png";

/* §6.4 Settings — About pane. Static app/version info. No settings to
   mutate; read-only display of the contract version and app identity. */

export default function AboutPane() {
  const capabilities = useSspStore((s) => s.capabilities);

  return (
    <section>
      <div className="flex items-center gap-4">
        <img
          src={logoUrl}
          alt="Screen Studio Pro logo"
          className="h-12 w-12 rounded-md object-contain"
        />
        <div>
          <p className="mt-1 text-body-sm text-ink-secondary">
            Screen Studio Pro — screen recording for Wayland-first Linux desktops.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-heading text-ink mb-3">Application</h2>
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Name</dt>
            <dd className="text-body-sm text-ink">{tauriConf.productName ?? "Screen Studio Pro"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink-secondary">Version</dt>
            <dd className="text-body-sm text-ink font-mono text-mono-sm">
              {capabilities?.version?.app ?? tauriConf.version ?? "0.1.0-beta.1"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink">IPC contract</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.version?.ipcContract ?? "1.8.0"}
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
            <dt className="text-body-sm text-ink">Screencast</dt>
            <dd className="text-body-sm text-ink">
              {capabilities?.portal?.screencast ? "Available" : "Unavailable"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink">Global shortcuts</dt>
            <dd className="text-body-sm text-ink">
              {capabilities?.portal?.globalShortcuts ?? "partial"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink">Compositor</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.portal?.compositor ?? "unknown"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink">Encoders</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.encoders
                ?.map((e) => `${e.backend}${e.isHardware ? " (HW)" : ""}`)
                .join(", ") ?? "unknown"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-body-sm text-ink">IPC contract</dt>
            <dd className="text-body-sm text-ink text-mono-sm">
              {capabilities?.version?.ipcContract ?? "1.8.0"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-8 pt-4 border-t border-subtle">
        <p className="text-xs text-ink-secondary">
          No servers, no cloud, no telemetry. All capture and encode happens locally on your
          machine.
        </p>
      </div>
    </section>
  );
}
