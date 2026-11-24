import React from 'react';

export interface RangeTabsProps {
  options?: string[];
  active: string;
  onChange: (tab: string) => void;
  className?: string;
}

const DEFAULT_OPTIONS = ['1W', '1M', '3W', 'YTD', 'Total'];

export const RangeTabs: React.FC<RangeTabsProps> = ({
  options = DEFAULT_OPTIONS,
  active,
  onChange,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] select-none ${className}`}
    >
      {options.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all duration-150 cursor-pointer ${
              isActive
                ? 'bg-[var(--bg-surface)] text-[var(--text)] border border-[var(--border)] shadow-[0_1px_2px_rgb(16_24_40_/_5%)] dark:shadow-none'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-bar-idle)] border border-transparent'
            }`}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
};
