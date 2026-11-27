import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  Circle,
  Cpu,
  Crop,
  Grid2x2,
  LoaderCircle,
  Monitor,
  RectangleHorizontal,
  Video,
  VideoOff,
  Zap,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useSspStore } from "../../lib/store";
import type { PresetId } from "../../types/ipc";
import Button from "../ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { CORNERS, clampSize, type PipCorner, type PipShape } from "../huds/CameraPip";

/* DESIGN.md v3.1 §5.2/§7.4 — Left Floating Inspector (Capture & Device Deck)
   300px fixed width floating inside workspace (r.lg = 16px, Studio Deck recipe).
   Contains:
   1. Segmented Source Switcher: Monitor | Window | Region (hotkeys 1, 2, 3)
   2. Target Source Card: Resolution badge & details
   3. Camera PiP Card: Device selector, Circle/Rounded toggle, 4-corner snap, size slider, self-insert switch
   4. Quality Preset Card: Plain-language preset dropdown
   5. Encoder Status: Hardware / Software fallback badge
*/

export function CameraDevicePopover() {
  const camera = useSspStore((s) => s.camera);
  const loadCameraDevices = useSspStore((s) => s.loadCameraDevices);
  const openCamera = useSspStore((s) => s.openCamera);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typeaheadAt = useRef(0);

  const devices = camera.devices ?? [];
  const error = camera.error;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) void loadCameraDevices();
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverTrigger
        type="button"
        className={cn(
          "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-sm border px-3 text-body-sm font-medium",
          error
            ? "border-error text-error hover:bg-error-muted"
            : "border-subtle bg-solid text-ink enabled:hover:bg-surface-hover",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Video size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
          <span className="truncate">Add camera</span>
        </span>
        <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        role="listbox"
        aria-label="Camera device"
        className="w-[268px]"
        onKeyDown={(e) => {
          const items = () =>
            Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const list = items();
            const idx = list.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === "ArrowDown"
                ? list[Math.min(list.length - 1, idx + 1)]
                : list[Math.max(0, idx - 1)];
            next?.focus();
          } else if (e.key.length === 1 && /\S/.test(e.key)) {
            e.preventDefault();
            const now = Date.now();
            const nextQuery = now - typeaheadAt.current > 500 ? e.key : query + e.key;
            setQuery(nextQuery);
            typeaheadAt.current = now;
            items()
              .find((it) => it.textContent?.toLowerCase().startsWith(nextQuery.toLowerCase()))
              ?.focus();
          }
        }}
      >
        {camera.devicesLoading && devices.length === 0 ? (
          <div className="flex flex-col gap-1" aria-hidden>
            <div className="h-11 rounded-xs bg-solid" />
          </div>
        ) : error && devices.length === 0 ? (
          <p className="max-w-64 p-2 text-body-sm text-error">{error.userMessage}</p>
        ) : devices.length === 0 ? (
          <p className="max-w-64 p-2 text-body-sm text-ink-secondary">
            No camera found. Replug it and try again.
          </p>
        ) : (
          devices.map((d) => (
            <button
              key={d.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                void openCamera(d.id);
                setOpen(false);
              }}
              className={cn(
                "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xs px-3 text-left",
                "text-body-sm text-ink hover:bg-surface-hover",
                "focus-visible:bg-surface-hover focus-visible:outline-none",
              )}
            >
              <span className="min-w-0 truncate">{d.label}</span>
              {d.isDefault ? (
                <span className="shrink-0 font-mono text-mono-sm text-ink-secondary">default</span>
              ) : (
                <Check size={16} className="shrink-0 opacity-0" aria-hidden="true" />
              )}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function CaptureInspector() {
  const source = useSspStore((s) => s.source);
  const selectMonitor = useSspStore((s) => s.selectMonitor);
  const selectWindow = useSspStore((s) => s.selectWindow);
  const selectRegion = useSspStore((s) => s.selectRegion);
  const sessionStatus = useSspStore((s) => s.session.status);
  const capabilities = useSspStore((s) => s.capabilities);

  const camera = useSspStore((s) => s.camera);
  const closeCamera = useSspStore((s) => s.closeCamera);
  const settings = useSspStore((s) => s.settings);
  const loadCaptureSettings = useSspStore((s) => s.loadCaptureSettings);
  const setCameraSelfInsert = useSspStore((s) => s.setCameraSelfInsert);
  const setCaptureSettings = useSspStore((s) => s.setCaptureSettings);

  const prefs = useSspStore((s) => s.prefs);
  const loadPipPrefs = useSspStore((s) => s.loadPipPrefs);
  const setPipPosition = useSspStore((s) => s.setPipPosition);
  const setPipShape = useSspStore((s) => s.setPipShape);
  const setPipSize = useSspStore((s) => s.setPipSize);

  const presets = useSspStore((s) => s.presets);
  const loadPresets = useSspStore((s) => s.loadPresets);
  const setPreset = useSspStore((s) => s.setPreset);

  const session = useSspStore((s) => s.session);

  useEffect(() => {
    void loadPipPrefs();
    void loadCaptureSettings();
    void loadPresets();
  }, [loadPipPrefs, loadCaptureSettings, loadPresets]);

  const selectable = sessionStatus === "idle" && source.status !== "selecting";
  const recording = sessionStatus === "recording";
  const windowCaptureSupported = capabilities?.portal?.windowCapture ?? false;

  const isMonitorActive =
    (source.status === "live" && source.label?.startsWith("Monitor")) ?? false;
  const isMonitorSelecting = source.status === "selecting" && source.selectingKind === "monitor";
  const isWindowActive = (source.status === "live" && source.label?.startsWith("Window")) ?? false;
  const isWindowSelecting = source.status === "selecting" && source.selectingKind === "window";
  const isRegionActive = (source.status === "live" && source.label?.startsWith("Region")) ?? false;
  const isRegionSelecting = source.status === "selecting" && source.selectingKind === "region";

  const handleRegionSelect = useCallback(async () => {
    if (!selectable) return;
    try {
      await selectRegion();
    } catch {
      // Handled in store
    }
  }, [selectable, selectRegion]);

  // Keyboard navigation for 1, 2, 3 shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs or select elements
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectable) return;
      if (e.key === "1") {
        void selectMonitor();
      } else if (e.key === "2" && windowCaptureSupported) {
        void selectWindow();
      } else if (e.key === "3") {
        void handleRegionSelect();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectable, windowCaptureSupported, selectMonitor, selectWindow, handleRegionSelect]);

  // Parse current PiP corner
  const activeCorner: PipCorner = (() => {
    if (prefs.pipPosition) {
      const match = prefs.pipPosition.match(/corner:([a-z-]+)/);
      if (match && CORNERS.includes(match[1] as PipCorner)) {
        return match[1] as PipCorner;
      }
    }
    return "bottom-right";
  })();

  const activeShape: PipShape = prefs.pipShape ?? "circle";
  const activeSize = prefs.pipSize ? clampSize(prefs.pipSize) : 240;
  const selfInsert = settings.capture?.cameraSelfInsert ?? true;

  // Active encoder badge text
  const encoderBackend = session.encoderBackend ?? capabilities?.encoders[0]?.backend ?? "vaapi";
  const isHardwareEncoder = encoderBackend !== "x264";

  return (
    <aside
      aria-label="Capture Inspector"
      className="studio-deck flex w-full min-w-0 shrink-0 flex-col gap-5 rounded-md p-4 min-[1120px]:w-[300px]"
    >
      {/* Title */}
      <div className="flex items-center justify-between border-b border-subtle pb-3">
        <h2 className="text-heading font-semibold text-ink">Inspector</h2>
        <span className="text-label font-medium text-ink-secondary">Studio</span>
      </div>

      {/* 1. SOURCES */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-label font-medium text-ink-secondary">
            Sources
          </span>
          <span className="font-mono text-mono-sm text-ink-disabled">1 · 2 · 3</span>
        </div>

        {/* 3-way Segmented Switcher */}
        <div
          role="group"
          aria-label="Capture source switcher"
          className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1 rounded-sm border border-subtle bg-solid p-1"
        >
          {/* Monitor Button */}
          <button
            type="button"
            aria-pressed={isMonitorActive}
            disabled={!selectable}
            onClick={() => void selectMonitor()}
            className={cn(
              "flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xs border border-transparent px-1 text-body-sm font-medium transition-colors",
              isMonitorActive
                ? "border-subtle bg-active text-ink"
                : "text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:text-ink-disabled",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            )}
            title="Capture Full Monitor (Hotkey: 1)"
          >
            {isMonitorSelecting ? (
              <LoaderCircle size={14} className="animate-spin-slow" aria-hidden="true" />
            ) : (
              <Monitor size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span className="whitespace-nowrap">Monitor</span>
          </button>

          {/* Window Button */}
          <button
            type="button"
            aria-pressed={isWindowActive}
            disabled={!selectable || !windowCaptureSupported}
            onClick={() => void selectWindow()}
            className={cn(
              "flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xs border border-transparent px-1 text-body-sm font-medium transition-colors",
              isWindowActive
                ? "border-subtle bg-active text-ink"
                : "text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:text-ink-disabled",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            )}
            title={
              windowCaptureSupported
                ? "Capture App Window (Hotkey: 2)"
                : "Window capture not supported by compositor"
            }
          >
            {isWindowSelecting ? (
              <LoaderCircle size={14} className="animate-spin-slow" aria-hidden="true" />
            ) : (
              <AppWindow size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span className="whitespace-nowrap">Window</span>
          </button>

          {/* Region Button */}
          <button
            type="button"
            aria-pressed={isRegionActive}
            disabled={!selectable}
            onClick={() => void handleRegionSelect()}
            className={cn(
              "flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xs border border-transparent px-1 text-body-sm font-medium transition-colors",
              isRegionActive
                ? "border-subtle bg-active text-ink"
                : "text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:text-ink-disabled",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            )}
            title="Capture Selected Region (Hotkey: 3)"
          >
            {isRegionSelecting ? (
              <LoaderCircle size={14} className="animate-spin-slow" aria-hidden="true" />
            ) : (
              <Crop size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span className="whitespace-nowrap">Region</span>
          </button>
        </div>

        {/* 13.3 Dual output (16:9 + 9:16) */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col">
            <span className="text-body-sm font-medium text-ink">Dual output</span>
            <span className="text-label text-ink-secondary">Also save a 9:16 vertical clip</span>
          </div>
          <Switch
            aria-label="Dual 16:9 and 9:16 output"
            checked={settings.capture?.dualOutput ?? false}
            disabled={recording}
            onCheckedChange={(checked) => void setCaptureSettings({ dualOutput: checked })}
          />
        </div>

        {/* Source Status & Resolution Display */}
        {source.status === "live" && source.capabilities ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-sm border border-subtle bg-solid px-3 py-2 text-body-sm">
            <span className="min-w-0 flex-1 break-words font-medium text-ink">
              {source.label ?? "Live Source"}
            </span>
            <span className="shrink-0 font-mono text-mono-sm text-ink-secondary">
              {source.capabilities.width}×{source.capabilities.height} · {source.capabilities.fps}
              fps
            </span>
          </div>
        ) : (
          <p className="px-1 text-label text-ink-secondary">
            {isRegionActive
              ? "Drag handles on preview canvas to adjust crop rect."
              : isWindowActive
                ? "Select a window to capture through portal dialog."
                : "Select monitor to enable PipeWire screen capture."}
          </p>
        )}
      </div>

      {/* 2. CAMERA PiP */}
      <div className="flex flex-col gap-2">
        <span className="text-label font-medium text-ink-secondary">
          Camera PiP
        </span>

        {camera.status === "idle" || camera.status === "error" ? (
          <CameraDevicePopover />
        ) : camera.status === "opening" ? (
          <span
            className="flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-subtle bg-solid px-3 text-body-sm text-ink-secondary"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle
              size={16}
              strokeWidth={2}
              className="animate-spin-slow"
              aria-hidden="true"
            />
            Opening camera…
          </span>
        ) : (
          <div className="flex min-w-0 flex-col divide-y divide-subtle rounded-md border border-subtle bg-solid p-3">
            {/* Active Camera Device Row with Remove button */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Video size={16} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
                <span className="min-w-0 break-words text-body-sm font-medium text-ink">
                  {camera.label ?? "Camera"}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                title="Remove camera"
                onClick={() => void closeCamera()}
                className="shrink-0 bg-canvas px-2 text-label text-ink-secondary hover:border-error hover:text-error focus-visible:ring-error"
              >
                <VideoOff size={14} aria-hidden="true" />
                <span>Remove</span>
              </Button>
            </div>

            {/* Shape Switcher: Circle vs Rounded */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <span className="text-label font-medium text-ink-secondary">Shape</span>
              <div
                role="group"
                aria-label="Camera PiP shape"
                className="flex items-center gap-1 rounded-xs border border-subtle bg-canvas p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={activeShape === "circle"}
                  aria-label="Circle shape"
                  onClick={() => void setPipShape("circle")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xs border border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    activeShape === "circle"
                      ? "border-subtle bg-surface-hover text-ink"
                      : "text-ink-secondary hover:text-ink",
                  )}
                >
                  <Circle size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-pressed={activeShape === "rounded"}
                  aria-label="Rounded rectangle shape"
                  onClick={() => void setPipShape("rounded")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xs border border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    activeShape === "rounded"
                      ? "border-subtle bg-surface-hover text-ink"
                      : "text-ink-secondary hover:text-ink",
                  )}
                >
                  <RectangleHorizontal size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Corner Snap Grid (4 corners) */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-1.5 text-label font-medium text-ink-secondary">
                <Grid2x2 size={14} aria-hidden="true" />
                <span>Corner Snap</span>
              </div>
              <div
                role="group"
                aria-label="Camera PiP corner position"
                className="grid grid-cols-2 gap-1 rounded-xs border border-subtle bg-canvas p-1"
              >
                {CORNERS.map((c) => {
                  const active = activeCorner === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={active}
                      aria-label={`Snap to ${c}`}
                      onClick={() => void setPipPosition(`corner:${c},margin:24`)}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xs border border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                        active
                          ? "border-subtle bg-active text-ink"
                          : "bg-solid text-ink-secondary hover:bg-surface-hover",
                      )}
                    />
                  );
                })}
              </div>
            </div>

            {/* Size Slider (160 to 320 px) */}
            <div className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-label">
                <span className="font-medium text-ink-secondary">Size</span>
                <span className="font-mono text-mono-sm text-ink">
                  {activeSize}px · {Math.round((activeSize / 240) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={160}
                max={320}
                step={10}
                value={activeSize}
                aria-label="Camera PiP size"
                onChange={(e) => void setPipSize(Number(e.target.value))}
                className="h-9 w-full cursor-pointer appearance-none rounded-xs bg-transparent accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-xs [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--primary)] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-xs [&::-moz-range-track]:bg-solid [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-xs [&::-webkit-slider-runnable-track]:bg-solid [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-xs [&::-webkit-slider-thumb]:bg-[var(--primary)]"
              />
            </div>

            {/* Self-Insert Switch */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col">
                <span className="text-body-sm font-medium text-ink">Self-Insert</span>
                <span className="text-label text-ink-secondary">Composite into recording</span>
              </div>
              <Switch
                aria-label="Camera self-insert in recording"
                checked={selfInsert}
                disabled={recording}
                onCheckedChange={(checked) => void setCameraSelfInsert(checked)}
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. QUALITY PRESET */}
      <div className="flex flex-col gap-2">
        <span className="text-label font-medium text-ink-secondary">
          Quality Preset
        </span>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="sr-only">Quality preset</span>
          <select
            aria-label="Quality preset"
            value={presets.presetId ?? ""}
            disabled={recording || presets.status !== "ready"}
            onChange={(e) => void setPreset(e.target.value as PresetId)}
            className="h-10 w-full min-w-0 max-w-full truncate rounded-sm border border-subtle bg-solid px-3 pr-9 text-body-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {presets.presets.length === 0 && <option value="">Loading presets…</option>}
            {presets.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.description}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 4. HARDWARE ENCODER STATUS */}
      <div className="mt-auto flex min-w-0 flex-col gap-2 border-t border-subtle pt-4">
        <span className="text-label font-medium text-ink-secondary">
          Encoder
        </span>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-sm border border-subtle bg-solid px-3 py-2 font-mono text-body-sm">
          <div className="flex min-w-0 items-center gap-2 text-ink">
            <Cpu size={16} strokeWidth={1.5} className="shrink-0 text-ink" aria-hidden="true" />
            <span className="min-w-0 break-all">{encoderBackend.toUpperCase()}</span>
          </div>
          {isHardwareEncoder ? (
            <span className="shrink-0 rounded-xs border border-subtle bg-surface-hover px-1.5 py-0.5 font-sans text-label font-medium text-ink">
              Hardware
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1 font-sans text-label text-ink-secondary">
              <Zap size={12} strokeWidth={1.5} aria-hidden="true" />
              CPU Fallback
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
