import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, Sun, Moon } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface TitleBarProps {
  title?: string;
  version?: string;
  icon?: React.ReactNode;
  compact?: boolean;
  className?: string;
  onThemeToggle?: (theme: 'dark' | 'light') => void;
  children?: React.ReactNode;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Starship Control',
  version = 'v0.1.0',
  icon,
  compact = false,
  className = '',
  onThemeToggle,
  children,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    // Sync initial theme
    const currentTheme =
      (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ||
      (document.documentElement.classList.contains('light') ? 'light' : 'dark');
    setTheme(currentTheme);

    try {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        const appWindow = getCurrentWindow();
        appWindow.isMaximized().then(setIsMaximized).catch(() => {});
        const unlisten = appWindow.onResized(() => {
          appWindow.isMaximized().then(setIsMaximized).catch(() => {});
        });
        return () => {
          unlisten.then((fn) => fn()).catch(() => {});
        };
      }
    } catch {
      // Running outside Tauri runtime
    }
  }, []);

  const handleMinimize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch {
      // fallback
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    } catch {
      setIsMaximized((prev) => !prev);
    }
  };

  const handleClose = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch {
      // fallback
    }
  };

  const toggleTheme = () => {
    const nextTheme: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', nextTheme);
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: nextTheme } }));
    onThemeToggle?.(nextTheme);
  };

  if (compact) {
    return (
      <div
        role="region"
        aria-label="Window Title Bar"
        data-tauri-drag-region
        className={`h-8 w-full select-none bg-[var(--bg-app)] border-b border-[var(--border)] flex items-center justify-between px-2.5 text-[var(--text)] ${className}`}
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          {icon && <span className="size-4 shrink-0 flex items-center justify-center">{icon}</span>}
          <span className="text-xs font-semibold tracking-tight">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="size-6 inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
          <button
            onClick={handleClose}
            aria-label="Close window"
            className="size-6 inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[#F43F5E] hover:text-white transition-colors cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Window Title Bar"
      data-tauri-drag-region
      className={`h-10 w-full select-none bg-[var(--bg-app)] border-b border-[var(--border)] flex items-center justify-between px-3 text-[var(--text)] shrink-0 z-50 ${className}`}
    >
      {/* Left branding */}
      <div data-tauri-drag-region className="flex items-center gap-2 shrink-0">
        {icon && <span className="size-5 shrink-0 flex items-center justify-center">{icon}</span>}
        <span className="text-[13px] font-semibold tracking-tight text-[var(--text)]">{title}</span>
        {version && (
          <span className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-[var(--bg-surface-2)] border border-[var(--border)] text-[var(--text-muted)] select-none">
            {version}
          </span>
        )}
      </div>

      {/* Center empty drag region */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="flex-1 h-full min-w-8 flex items-center justify-center cursor-default"
      />

      {/* Right controls */}
      <div className="flex items-center gap-1 shrink-0">
        {children}
        {children && <div className="w-px h-3.5 bg-[var(--border)] mx-1" />}
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="size-7 inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>

        {/* Thin divider */}
        <div className="w-px h-3.5 bg-[var(--border)] mx-1" />

        {/* Minimize */}
        <button
          onClick={handleMinimize}
          aria-label="Minimize window"
          title="Minimize"
          className="size-7 inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer"
        >
          <Minus className="size-3.5" />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          title={isMaximized ? 'Restore' : 'Maximize'}
          className="size-7 inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer"
        >
          {isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          aria-label="Close window"
          title="Close"
          className="size-7 inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[#F43F5E] hover:text-white transition-colors cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
};
