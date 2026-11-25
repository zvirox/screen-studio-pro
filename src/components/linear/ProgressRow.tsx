import React from "react";

export interface ProgressRowProps {
  label: string;
  value: number; // 0 - 100
  displayValue?: string;
  color?: string; // CSS token e.g. 'var(--accent-blue)', 'var(--accent-green)'
  className?: string;
}

export const ProgressRow: React.FC<ProgressRowProps> = ({
  label,
  value,
  displayValue,
  color = "var(--accent-blue)",
  className = "",
}) => {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--text)] truncate">{label}</span>
        <span className="font-mono text-[var(--text-muted)] tabular-nums shrink-0">
          {displayValue ?? `${clamped}%`}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-xs bg-[var(--bg-bar-idle)] overflow-hidden">
        <div
          className="h-full rounded-xs transition-[width] duration-150 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};
