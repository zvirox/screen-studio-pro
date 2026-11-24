import React from 'react';

export interface DonutLegendItem {
  label: string;
  value: string | number;
  color: string;
  subValue?: string;
}

export interface DonutLegendProps {
  items: DonutLegendItem[];
  className?: string;
}

export const DonutLegend: React.FC<DonutLegendProps> = ({ items, className = '' }) => {
  return (
    <div className={`flex flex-col gap-2.5 w-full ${className}`}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[var(--text-muted)] truncate">{item.label}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 font-mono">
            <span className="font-semibold text-[var(--text)] tabular-nums">{item.value}</span>
            {item.subValue && (
              <span className="text-[var(--text-faint)] text-[11px] tabular-nums">
                ({item.subValue})
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
