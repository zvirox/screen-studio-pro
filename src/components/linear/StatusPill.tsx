import React from 'react';

export interface StatusPillProps {
  label: string;
  status: 'online' | 'active' | 'warning' | 'alert' | 'idle';
  monoValue?: string;
  className?: string;
}

// Solid flat dots without glow per Linear screenshot spec
const statusDotColor = {
  online: 'bg-[#22C55E]',
  active: 'bg-[#3355FF]',
  warning: 'bg-[#EAB308]',
  alert: 'bg-[#F43F5E]',
  idle: 'bg-[#5A5B62]',
};

export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  status,
  monoValue,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-xs select-none ${className}`}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${statusDotColor[status]}`} />
      <span className="font-sans font-medium text-[var(--text-muted)]">
        {label}
      </span>
      {monoValue && (
        <span className="font-mono font-medium text-[var(--text)] pl-1.5 border-l border-[var(--border)] tabular-nums">
          {monoValue}
        </span>
      )}
    </div>
  );
};
