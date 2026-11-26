function readCssToken(name: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getLinearChartColors() {
  return {
    blue: readCssToken("--blue"),
    sky: readCssToken("--sky"),
    green: readCssToken("--green"),
    greenText: readCssToken("--green-text"),
    red: readCssToken("--red"),
    redText: readCssToken("--red-text"),
    amber: readCssToken("--amber"),
    teal: readCssToken("--teal"),
    pink: readCssToken("--pink"),
    purple: readCssToken("--purple"),
    orange: readCssToken("--orange"),
    gray: readCssToken("--gray"),
    bgSurface: readCssToken("--bg-surface"),
    bgBarIdle: readCssToken("--bg-bar-idle"),
    border: readCssToken("--border"),
    chartGrid: readCssToken("--chart-grid"),
    chartFadeUp: readCssToken("--chart-fade-up"),
    chartFadeDown: readCssToken("--chart-fade-down"),
    text: readCssToken("--text"),
    textMuted: readCssToken("--text-muted"),
  };
}

export const getLinearEChartsOption = () => {
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
      borderColor: c.chartGrid,
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
      extraCssText: "box-shadow: var(--shadow-card); border-radius: 6px;",
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
          color: c.chartGrid,
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
      c.gray,
    ],
  };
};
