export const LINEAR_COLORS = {
  blue: '#3355FF',
  sky: '#38B6F0',
  green: '#22C55E',
  red: '#F43F5E',
  amber: '#EAB308',
  teal: '#1FB5A5',
  pink: '#EC4899',
  purple: '#7C5CE6',
  orange: '#F97316',
  idleDark: '#202128',
  idleLight: '#EAF0FF',
  borderDark: '#1F2125',
  borderLight: '#E5E7EB',
  textDark: '#8A8B91',
  textLight: '#6B7280',
};

export const getLinearEChartsOption = (isDark: boolean = true) => ({
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    color: isDark ? LINEAR_COLORS.textDark : LINEAR_COLORS.textLight,
  },
  grid: {
    top: 24,
    right: 16,
    bottom: 24,
    left: 48,
    borderColor: isDark ? LINEAR_COLORS.borderDark : LINEAR_COLORS.borderLight,
  },
  tooltip: {
    backgroundColor: isDark ? '#111213' : '#FFFFFF',
    borderColor: isDark ? LINEAR_COLORS.borderDark : LINEAR_COLORS.borderLight,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: {
      color: isDark ? '#F5F5F6' : '#0F1115',
      fontSize: 12,
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    },
    extraCssText: isDark
      ? 'border-radius: 8px;'
      : 'box-shadow: 0 1px 2px rgb(16 24 40 / 5%); border-radius: 8px;',
  },
  xAxis: {
    axisLine: { lineStyle: { color: isDark ? LINEAR_COLORS.borderDark : LINEAR_COLORS.borderLight } },
    splitLine: { show: false },
    axisTick: { show: false },
  },
  yAxis: {
    axisLine: { show: false },
    splitLine: {
      lineStyle: {
        type: 'dotted' as const,
        color: isDark ? LINEAR_COLORS.borderDark : LINEAR_COLORS.borderLight,
      },
    },
  },
  color: [
    LINEAR_COLORS.blue,
    LINEAR_COLORS.sky,
    LINEAR_COLORS.green,
    LINEAR_COLORS.amber,
    LINEAR_COLORS.teal,
    LINEAR_COLORS.pink,
    LINEAR_COLORS.purple,
    LINEAR_COLORS.orange,
    LINEAR_COLORS.red,
  ],
});
