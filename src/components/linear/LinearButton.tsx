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
      'bg-[#3355FF] hover:bg-[#2944CC] active:bg-[#1F3399] text-white font-medium border border-[#3355FF] shadow-sm',
    secondary:
      'bg-[var(--bg-surface-2)] hover:bg-[var(--bg-bar-idle)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--border-strong)] shadow-[0_1px_2px_rgb(16_24_40_/_5%)] dark:shadow-none',
    ghost:
      'bg-transparent hover:bg-[var(--bg-surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border border-transparent',
    danger:
      'bg-[#F43F5E]/10 hover:bg-[#F43F5E]/20 active:bg-[#F43F5E]/30 text-[#F43F5E] text-error border border-[#F43F5E]/30 border-error',
  }[variant];

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-sans transition-all duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3355FF]/50 disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
