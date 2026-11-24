import React from 'react';

export interface StatusPillProps {
  label: string;
  status: 'online' | 'active' | 'warning' | 'alert' | 'idle';
  monoValue?: string;
  className?: string;
}

const statusColorMap = {
  online: 'bg-emerald-500 shadow-[0_0_8px_#10b981]',
  active: 'bg-cyan-500 shadow-[0_0_8px_#06b6d4]',
  warning: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]',
  alert: 'bg-rose-500 shadow-[0_0_8px_#f43f5e]',
  idle: 'bg-zinc-500 shadow-[0_0_8px_#71717a]',
};

export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  status,
  monoValue,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border border-[#e2e2e7] dark:border-[#23232a] bg-[#f2f2f4] dark:bg-[#17171c] px-2.5 py-1 text-xs select-none ${className}`}
    >
      <span className={`size-1.5 rounded-full ${statusColorMap[status]}`} />
      <span className="font-sans font-medium text-zinc-600 dark:text-zinc-300">
        {label}
      </span>
      {monoValue && (
        <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 pl-1 border-l border-[#e2e2e7] dark:border-[#23232a] tabular-nums">
          {monoValue}
        </span>
      )}
    </div>
  );
};
