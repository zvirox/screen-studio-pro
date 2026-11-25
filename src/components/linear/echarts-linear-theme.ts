function readCssToken(name: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getLinearChartColors() {
  return {
    blue: readCssToken("--accent-blue"),
    sky: readCssToken("--accent-sky"),
    green: readCssToken("--accent-green"),
    red: readCssToken("--accent-red"),
    amber: readCssToken("--accent-amber"),
    teal: readCssToken("--accent-teal"),
    pink: readCssToken("--accent-pink"),
    purple: readCssToken("--accent-purple"),
    orange: readCssToken("--accent-orange"),
    bgApp: readCssToken("--bg-app"),
    bgSurface: readCssToken("--bg-surface"),
    bgBarIdle: readCssToken("--bg-bar-idle"),
    border: readCssToken("--border"),
    text: readCssToken("--text"),
    textMuted: readCssToken("--text-muted"),
  };
}

export const getLinearEChartsOption = (isDark: boolean = true) => {
  const c = getLinearChartColors();
  const font = "Inter, system-ui, -apple-system, sans-serif";

  return {
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: font,
      color: c.textMuted,
      fontSize: 12,
    },
    grid: {
      top: 24,
      right: 16,
      bottom: 24,
      left: 44,
      borderColor: c.border,
    },
    tooltip: {
      backgroundColor: c.bgSurface,
      borderColor: c.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: {
        color: c.text,
        fontSize: 12,
        fontFamily: font,
      },
      extraCssText: isDark
        ? "border-radius: 6px;"
        : "box-shadow: 0 1px 2px rgb(16 24 40 / 5%); border-radius: 6px;",
    },
    xAxis: {
      axisLine: { lineStyle: { color: c.border } },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.textMuted, fontSize: 12, fontFamily: font },
    },
    yAxis: {
      axisLine: { show: false },
      axisLabel: { color: c.textMuted, fontSize: 12, fontFamily: font },
      splitLine: {
        lineStyle: {
          type: "dotted" as const,
          color: c.border,
        },
      },
    },
    color: [
      c.blue,
      c.sky,
      c.green,
      c.amber,
      c.teal,
      c.pink,
      c.purple,
      c.orange,
      c.red,
    ],
  };
};
