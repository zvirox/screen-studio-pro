import React, { forwardRef } from 'react';

export interface LinearCardProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: 1 | 2 | 3 | 'pane' | 'raised' | 'modal' | 'overlay';
}

export const LinearCard = forwardRef<HTMLDivElement, LinearCardProps>(({
  level = 1,
  className = '',
  children,
  ...props
}, ref) => {
  const normalizedLevel: 1 | 2 | 3 =
    typeof level === 'number'
      ? level
      : level === 'raised'
      ? 2
      : level === 'modal' || level === 'overlay'
      ? 3
      : 1;

  // Solid, flat, border-only surfaces per Linear specification. No shadow in dark mode.
  const levelStyles = {
    1: 'bg-[var(--bg-surface)] border-[var(--border)] shadow-[0_1px_2px_rgb(16_24_40_/_5%)] dark:shadow-none',
    2: 'bg-[var(--bg-surface-2)] border-[var(--border)] shadow-[0_1px_2px_rgb(16_24_40_/_5%)] dark:shadow-none',
    3: 'bg-[var(--bg-surface-2)] border-[var(--border-strong)] shadow-lg dark:shadow-none',
  }[normalizedLevel];

  return (
    <div
      ref={ref}
      className={`rounded-xl border transition-colors duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:border-[var(--border-strong)] text-[var(--text)] ${levelStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
});

LinearCard.displayName = 'LinearCard';
