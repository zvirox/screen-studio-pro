import React from "react";

export interface StatusPillProps {
  label: string;
  status: "online" | "active" | "warning" | "alert" | "idle";
  monoValue?: string;
  className?: string;
}

const statusDotColor = {
  online: "bg-[var(--accent-green)]",
  active: "bg-[var(--accent-blue)]",
  warning: "bg-[var(--accent-amber)]",
  alert: "bg-[var(--accent-red)]",
  idle: "bg-[var(--text-faint)]",
};

export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  status,
  monoValue,
  className = "",
}) => {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xs border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-xs select-none ${className}`}
    >
      <span
        className={`size-1.5 rounded-full shrink-0 ${statusDotColor[status]}`} /* linear-exception: dot */
      />
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
