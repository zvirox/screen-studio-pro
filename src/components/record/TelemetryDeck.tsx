import { Activity, Cpu, Film, Gauge } from "lucide-react";
import { useSspStore } from "../../lib/store";
import { LinearCard, ProgressRow, StatCard, StatusPill } from "../linear";

/* DESIGN.md v6.1 — Linear Telemetry Strip.
   Feeds strictly from live session.stats samples + capabilities (zero fabricated data).
   Charts were removed (SSP needs no dashboard charts): metrics render as stat cards,
   a status pill and a single encode-budget progress bar. */

export default function TelemetryDeck() {
  const session = useSspStore((s) => s.session);
  const capabilities = useSspStore((s) => s.capabilities);

  const activeEncoder = (
    session.encoderBackend ??
    capabilities?.encoders[0]?.backend ??
    "x264"
  ).toUpperCase();
  const isHw = activeEncoder !== "X264" && activeEncoder !== "AUTO";

  const fpsVal = session.stats ? Math.round(session.stats.fps) : "—";
  const bitrateVal = session.stats ? session.stats.bitrateKbps : "—";
  const droppedVal = session.stats ? session.stats.droppedFrames : 0;
  const encodeMs = session.stats ? `${session.stats.encodeTimeMs.toFixed(1)} ms` : "Ready";
  const encodeLoad = session.stats
    ? Math.min(100, Math.round((session.stats.encodeTimeMs / 16.6) * 100))
    : 0;

  return (
    <section aria-label="Capture telemetry" className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-3">
        <StatCard
          title="Frame Rate"
          value={fpsVal}
          unit={session.stats ? "fps" : undefined}
          icon={<Gauge size={16} aria-hidden="true" />}
          iconBgColor="bg-[var(--chip-sky)]"
          iconColor="text-[var(--sky-text)]"
        />
        <StatCard
          title="Bitrate"
          value={bitrateVal}
          unit={session.stats ? "kbps" : undefined}
          icon={<Activity size={16} aria-hidden="true" />}
          iconBgColor="bg-[var(--primary-tint)]"
          iconColor="text-[var(--primary-text)]"
        />
        <StatCard
          title="Dropped"
          value={droppedVal}
          unit="frames"
          icon={<Film size={16} aria-hidden="true" />}
          iconBgColor={droppedVal > 0 ? "bg-[var(--chip-red)]" : "bg-[var(--bg-surface-2)]"}
          iconColor={droppedVal > 0 ? "text-[var(--red-text)]" : "text-[var(--text-muted)]"}
        />
      </div>

      <LinearCard level={1} className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-body-sm font-semibold text-[var(--text)]">Encoder Budget</h3>
            <StatusPill
              label={session.status === "recording" ? "Live" : "Idle"}
              status={session.status === "recording" ? "online" : "idle"}
              monoValue={encodeMs}
            />
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Cpu size={14} aria-hidden="true" />
            {isHw ? activeEncoder : "CPU x264"}
          </span>
        </div>
        <ProgressRow
          label="Frame time (16.6 ms budget)"
          value={encodeLoad}
          displayValue={encodeMs}
          color={encodeLoad > 85 ? "var(--red)" : "var(--primary)"}
        />
      </LinearCard>
    </section>
  );
}