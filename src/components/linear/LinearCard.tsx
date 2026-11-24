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

  const levelStyles = {
    1: 'bg-[#ffffff] dark:bg-[#121215] border-[#e2e2e7] dark:border-[#23232a] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8),0_1px_3px_0_rgba(0,0,0,0.04),0_10px_25px_-5px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07),0_1px_2px_0_rgba(0,0,0,0.4),0_12px_30px_-10px_rgba(0,0,0,0.85)]',
    2: 'bg-[#f2f2f4] dark:bg-[#17171c] border-[#e2e2e7] dark:border-[#23232a]',
    3: 'bg-[#e8e8ec] dark:bg-[#202026] border-[#c8c8d0] dark:border-[#33333d]',
  }[normalizedLevel];

  return (
    <div
      ref={ref}
      className={`rounded-xl border transition-colors duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:border-[#c8c8d0] dark:hover:border-[#33333d] ${levelStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
});

LinearCard.displayName = 'LinearCard';
