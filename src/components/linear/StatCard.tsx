import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LinearCard } from './LinearCard';

export interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  delta?: {
    value: string | number;
    positive?: boolean;
    comparison?: string;
  };
  icon?: React.ReactNode;
  iconBgColor?: string;
  iconColor?: string;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  delta,
  icon,
  iconBgColor = 'bg-[#3355FF]/10',
  iconColor = 'text-[#3355FF]',
  className = '',
}) => {
  return (
    <LinearCard level={1} className={`p-5 flex flex-col justify-between ${className}`}>
      {/* Top row: Title and Icon Chip */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] select-none">
          {title}
        </span>
        {icon && (
          <div
            className={`size-8 rounded-full flex items-center justify-center shrink-0 ${iconBgColor} ${iconColor}`}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Middle row: Big Metric + Unit */}
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold tracking-tight text-[var(--text)] tabular-nums font-sans leading-none">
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            {unit}
          </span>
        )}
      </div>

      {/* Bottom row: Delta Pill + Comparison */}
      {delta && (
        <div className="mt-4 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums ${
              delta.positive
                ? 'bg-[#22C55E]/10 text-[#22C55E]'
                : 'bg-[#F43F5E]/10 text-[#F43F5E]'
            }`}
          >
            {delta.positive ? (
              <ArrowUpRight className="size-3 shrink-0" />
            ) : (
              <ArrowDownRight className="size-3 shrink-0" />
            )}
            {delta.value}
          </span>
          {delta.comparison && (
            <span className="text-xs text-[var(--text-muted)] truncate">
              {delta.comparison}
            </span>
          )}
        </div>
      )}
    </LinearCard>
  );
};
