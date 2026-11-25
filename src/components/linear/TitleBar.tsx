import React, { useEffect, useState } from "react";
import { Minus, Square, Copy, X, Sun, Moon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import tauriConf from "../../../src-tauri/tauri.conf.json";

export const UI_THEME_STORAGE_KEY = "ui-theme";

export function readDocumentTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function applyDocumentTheme(nextTheme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", nextTheme);
  document.documentElement.classList.toggle("dark", nextTheme === "dark");
  document.documentElement.classList.toggle("light", nextTheme === "light");
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, nextTheme);
  } catch {
    // ignore storage errors in restricted contexts
  }
  window.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme: nextTheme } }));
}

export interface ThemeToggleProps {
  compact?: boolean;
  onToggle?: (theme: "dark" | "light") => void;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  compact = false,
  onToggle,
  className = "",
}) => {
  const [theme, setTheme] = useState<"dark" | "light">(readDocumentTheme);

  useEffect(() => {
    setTheme(readDocumentTheme());
  }, []);

  const handleToggle = () => {
    const next: "dark" | "light" = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyDocumentTheme(next);
    onToggle?.(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="Toggle theme"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className={`${compact ? "size-6 rounded-xs" : "size-7 rounded-sm"} inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors duration-150 cursor-pointer ${className}`}
    >
      {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  );
};

export interface TitleBarProps {
  title?: string;
  version?: string;
  icon?: React.ReactNode;
  recordingIndicator?: React.ReactNode;
  compact?: boolean;
  className?: string;
  onThemeToggle?: (theme: "dark" | "light") => void;
  children?: React.ReactNode;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = tauriConf.productName ?? "Screen Studio Pro",
  version = `v${tauriConf.version ?? "0.1.0-beta.1"}`,
  icon,
  recordingIndicator,
  compact = false,
  className = "",
  onThemeToggle,
  children,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
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
      await getCurrentWindow().minimize();
    } catch {
      // fallback outside Tauri
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
      await getCurrentWindow().close();
    } catch {
      // fallback outside Tauri
    }
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
          {recordingIndicator}
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle compact onToggle={onThemeToggle} />
          <button
            type="button"
            onClick={() => void handleClose()}
            aria-label="Close window"
            className="size-6 inline-flex items-center justify-center rounded-xs text-[var(--text-muted)] hover:bg-[var(--close-hover)] hover:text-white transition-colors duration-150 cursor-pointer"
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
          <span className="px-1.5 py-0.5 text-[11px] font-mono rounded-xs bg-[var(--bg-surface-2)] border border-[var(--border)] text-[var(--text-muted)] select-none">
            {version}
          </span>
        )}
        {recordingIndicator}
      </div>

      {/* Center empty drag region */}
      <div
        data-tauri-drag-region
        onDoubleClick={() => void handleToggleMaximize()}
        className="flex-1 h-full min-w-8 flex items-center justify-center cursor-default"
      />

      {/* Right controls */}
      <div className="flex items-center gap-1 shrink-0">
        {children}
        {children && <div className="w-px h-3.5 bg-[var(--border)] mx-1" />}

        <ThemeToggle onToggle={onThemeToggle} />

        {/* Thin divider */}
        <div className="w-px h-3.5 bg-[var(--border)] mx-1" />

        {/* Minimize */}
        <button
          type="button"
          onClick={() => void handleMinimize()}
          aria-label="Minimize window"
          title="Minimize"
          className="size-7 inline-flex items-center justify-center rounded-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors duration-150 cursor-pointer"
        >
          <Minus className="size-3.5" />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={() => void handleToggleMaximize()}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
          title={isMaximized ? "Restore" : "Maximize"}
          className="size-7 inline-flex items-center justify-center rounded-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface-2)] transition-colors duration-150 cursor-pointer"
        >
          {isMaximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={() => void handleClose()}
          aria-label="Close window"
          title="Close"
          className="size-7 inline-flex items-center justify-center rounded-sm text-[var(--text-muted)] hover:bg-[var(--close-hover)] hover:text-white transition-colors duration-150 cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
};
