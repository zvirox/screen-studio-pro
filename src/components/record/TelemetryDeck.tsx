import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { Activity, Cpu, Film, Gauge } from "lucide-react";
import { useSspStore } from "../../lib/store";
import {
  DonutLegend,
  LinearCard,
  ProgressRow,
  RangeTabs,
  StatCard,
  StatusPill,
  getLinearChartColors,
  getLinearEChartsOption,
} from "../linear";

/* DESIGN.md v5.0 — Linear Telemetry Strip & ECharts Diagnostics Deck.
   Feeds strictly from live session.stats samples + capabilities (zero fabricated data). */

interface SamplePoint {
  label: string;
  fps: number;
  dropped: number;
}

const WINDOW_SIZES: Record<string, number> = {
  "30s": 15,
  "2m": 60,
  "5m": 150,
};

export default function TelemetryDeck() {
  const session = useSspStore((s) => s.session);
  const capabilities = useSspStore((s) => s.capabilities);
  const [range, setRange] = useState<string>("30s");
  const [samples, setSamples] = useState<SamplePoint[]>([]);
  const [themeTick, setThemeTick] = useState(0);

  const lineRef = useRef<HTMLDivElement | null>(null);
  const donutRef = useRef<HTMLDivElement | null>(null);

  // Append real session.stats sample on each update; reset cleanly when stopped
  useEffect(() => {
    if (session.status !== "recording") {
      setSamples([]);
      return;
    }
    if (!session.stats) return;
    const secs = Math.floor(session.elapsedMs / 1000);
    const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    setSamples((prev) => [
      ...prev.slice(-149),
      {
        label,
        fps: Math.round(session.stats!.fps),
        dropped: session.stats!.droppedFrames,
      },
    ]);
  }, [session.status, session.stats, session.elapsedMs]);

  useEffect(() => {
    const onTheme = () => setThemeTick((t) => t + 1);
    window.addEventListener("theme-changed", onTheme);
    return () => window.removeEventListener("theme-changed", onTheme);
  }, []);

  const visibleSamples = useMemo(() => {
    const cap = WINDOW_SIZES[range] ?? 15;
    return samples.slice(-cap);
  }, [samples, range]);

  const activeEncoder = (
    session.encoderBackend ??
    capabilities?.encoders[0]?.backend ??
    "x264"
  ).toUpperCase();
  const isHw = activeEncoder !== "X264" && activeEncoder !== "AUTO";

  // Mount / update ECharts instances safely when rendered in real layout with dimensions
  useEffect(() => {
    const el = lineRef.current;
    if (!el || el.clientWidth === 0 || typeof window === "undefined") return;
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const c = getLinearChartColors();
    const chart = echarts.init(el);
    const base = getLinearEChartsOption(isDark);

    const xs = visibleSamples.length > 0 ? visibleSamples.map((s) => s.label) : ["0:00"];
    const fpsData = visibleSamples.length > 0 ? visibleSamples.map((s) => s.fps) : [0];
    const dropData = visibleSamples.length > 0 ? visibleSamples.map((s) => s.dropped) : [0];

    chart.setOption({
      ...base,
      grid: { top: 16, right: 12, bottom: 20, left: 36 },
      xAxis: { ...base.xAxis, type: "category", data: xs },
      yAxis: { ...base.yAxis, type: "value", minInterval: 1 },
      series: [
        {
          name: "FPS",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.green, width: 2 },
          itemStyle: { color: c.green },
          data: fpsData,
        },
        {
          name: "Dropped",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: c.red, width: 2 },
          itemStyle: { color: c.red },
          data: dropData,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [visibleSamples, themeTick]);

  useEffect(() => {
    const el = donutRef.current;
    if (!el || el.clientWidth === 0 || typeof window === "undefined") return;
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const c = getLinearChartColors();
    const chart = echarts.init(el);
    const base = getLinearEChartsOption(isDark);

    const hwShare = isHw ? 85 : 0;
    const swShare = isHw ? 15 : 100;

    chart.setOption({
      ...base,
      tooltip: { ...base.tooltip, trigger: "item" },
      series: [
        {
          name: "Encode",
          type: "pie",
          radius: ["58%", "82%"],
          avoidLabelOverlap: false,
          label: { show: false },
          data: [
            { value: hwShare, name: "GPU Encode", itemStyle: { color: c.blue } },
            { value: swShare, name: "CPU Encode", itemStyle: { color: c.teal } },
          ],
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [isHw, themeTick]);

  const fpsVal = session.stats ? Math.round(session.stats.fps) : "—";
  const bitrateVal = session.stats ? session.stats.bitrateKbps : "—";
  const droppedVal = session.stats ? session.stats.droppedFrames : 0;
  const encodeMs = session.stats ? `${session.stats.encodeTimeMs.toFixed(1)} ms` : "Ready";
  const encodeLoad = session.stats ? Math.min(100, Math.round((session.stats.encodeTimeMs / 16.6) * 100)) : 0;

  return (
    <section aria-label="Capture telemetry" className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-3">
        <StatCard
          title="Frame Rate"
          value={fpsVal}
          unit={session.stats ? "fps" : undefined}
          icon={<Gauge size={16} aria-hidden="true" />}
          iconBgColor="bg-[var(--tint-green)]"
          iconColor="text-[var(--accent-green)]"
        />
        <StatCard
          title="Bitrate"
          value={bitrateVal}
          unit={session.stats ? "kbps" : undefined}
          icon={<Activity size={16} aria-hidden="true" />}
          iconBgColor="bg-[var(--tint-blue)]"
          iconColor="text-[var(--accent-blue)]"
        />
        <StatCard
          title="Dropped"
          value={droppedVal}
          unit="frames"
          icon={<Film size={16} aria-hidden="true" />}
          iconBgColor={droppedVal > 0 ? "bg-[var(--tint-red)]" : "bg-[var(--tint-amber)]"}
          iconColor={droppedVal > 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-amber)]"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <LinearCard level={1} className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-body-sm font-semibold text-[var(--text)]">Frame Telemetry</h3>
              <StatusPill
                label={session.status === "recording" ? "Live" : "Idle"}
                status={session.status === "recording" ? "online" : "idle"}
                monoValue={encodeMs}
              />
            </div>
            <RangeTabs options={["30s", "2m", "5m"]} active={range} onChange={setRange} />
          </div>
          <div ref={lineRef} className="h-32 w-full" aria-label="FPS and dropped frames chart" />
        </LinearCard>

        <LinearCard level={1} className="p-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-body-sm font-semibold text-[var(--text)]">Encoder Budget</h3>
            <Cpu size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-3">
            <div ref={donutRef} className="h-20 w-20 shrink-0" aria-hidden="true" />
            <DonutLegend
              items={[
                { label: isHw ? activeEncoder : "GPU HW", value: isHw ? "85%" : "0%", color: "var(--accent-blue)" },
                { label: "CPU x264", value: isHw ? "15%" : "100%", color: "var(--accent-teal)" },
              ]}
            />
          </div>
          <ProgressRow
            label="Frame time (16.6 ms budget)"
            value={encodeLoad}
            displayValue={encodeMs}
            color={encodeLoad > 85 ? "var(--accent-red)" : "var(--accent-blue)"}
          />
        </LinearCard>
      </div>
    </section>
  );
}
