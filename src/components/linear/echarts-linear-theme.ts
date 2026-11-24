export const getLinearEChartsOption = (isDark: boolean = true) => ({
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
    color: isDark ? '#a1a1aa' : '#52525b',
  },
  grid: {
    top: 24,
    right: 16,
    bottom: 24,
    left: 48,
    borderColor: isDark ? '#23232a' : '#e2e2e7',
  },
  tooltip: {
    backgroundColor: isDark ? '#17171c' : '#ffffff',
    borderColor: isDark ? '#33333d' : '#c8c8d0',
    borderWidth: 1,
    padding: [8, 12],
    textStyle: {
      color: isDark ? '#f4f4f5' : '#09090b',
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
    },
    extraCssText: isDark
      ? 'box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.07), 0 12px 30px -10px rgba(0,0,0,0.85); border-radius: 8px;'
      : 'box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06); border-radius: 8px;',
  },
  xAxis: {
    axisLine: { lineStyle: { color: isDark ? '#23232a' : '#e2e2e7' } },
    splitLine: { show: false },
    axisTick: { show: false },
  },
  yAxis: {
    axisLine: { show: false },
    splitLine: { lineStyle: { color: isDark ? '#17171c' : '#f2f2f4' } },
  },
  color: [
    isDark ? '#22d3ee' : '#0891b2', // accent-cyan
    isDark ? '#a855f7' : '#7c3aed', // accent-purple
    isDark ? '#10b981' : '#059669', // accent-emerald
    isDark ? '#f59e0b' : '#d97706', // accent-amber
    isDark ? '#f43f5e' : '#e11d48', // accent-rose
  ],
});
