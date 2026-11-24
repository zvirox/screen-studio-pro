import React from 'react';

export interface LinearButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const LinearButton: React.FC<LinearButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}) => {
  const sizeStyles = {
    sm: 'h-7 px-2.5 text-xs',
    md: 'h-8 px-3 text-xs',
    lg: 'h-10 px-4 text-sm',
  }[size];

  const variantStyles = {
    primary:
      'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-medium border border-cyan-400/50 shadow-sm active:bg-cyan-600',
    secondary:
      'bg-[#ffffff] dark:bg-[#17171c] hover:bg-[#f2f2f4] dark:hover:bg-[#202026] text-zinc-900 dark:text-zinc-100 border border-[#e2e2e7] dark:border-[#23232a] hover:border-[#c8c8d0] dark:hover:border-[#33333d] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    ghost:
      'bg-transparent hover:bg-[#f2f2f4] dark:hover:bg-[#17171c] text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 border border-transparent',
    danger:
      'bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/30',
  }[variant];

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-sans transition-all duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:opacity-50 disabled:pointer-events-none ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
