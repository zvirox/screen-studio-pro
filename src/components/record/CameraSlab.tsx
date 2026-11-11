import { useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Video, VideoOff } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/cn";
import { useSspStore } from "../../lib/store";

/* §6.1 #4 camera slab (4.2) — the camera AFFORDANCE row in the Record
   stack: the §6.3 ghost "Add camera" chip when idle, its device popover
   (the §5.3 device-popover anatomy, AudioStrip precedent), and the
   active chip acting as remove while the PiP floats over the preview
   frame. Enumeration failures render the §1 copy inline (§5.5); an
   empty system renders the §6.3 education copy, never "nothing here". */

function CameraDevicePopover() {
  const camera = useSspStore((s) => s.camera);
  const loadCameraDevices = useSspStore((s) => s.loadCameraDevices);
  const openCamera = useSspStore((s) => s.openCamera);
  const [open, setOpen] = useState(false);
  // §5.3 typeahead: a keydown buffer over the option labels.
  const [query, setQuery] = useState("");
  const typeaheadAt = useRef(0);

  const devices = camera.devices ?? [];
  const error = camera.error;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // A snapshot per open (API §2.2 ⚠): the device list re-lists
        // whenever the popover becomes usable — plugs/unplugs show up
        // without a page reload (and the device/changed hotplug reducer
        // re-lists behind the scenes too).
        if (next) void loadCameraDevices();
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverTrigger
        type="button"
        className={cn(
          "flex h-10 items-center gap-2 rounded-sm border pl-2.5 pr-3 text-body-sm font-medium",
          error
            ? "border-error text-error hover:bg-error-muted"
            : "border-subtle bg-solid text-ink enabled:hover:border-accent enabled:hover:bg-accent-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <Video size={16} strokeWidth={1.5} aria-hidden="true" />
        Add camera
        <ChevronDown size={16} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        role="listbox"
        aria-label="Camera device"
        onKeyDown={(e) => {
          // §5.3: Radix keyboard behavior + typeahead (AudioStrip law).
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
          /* §5.5 loading: skeleton rows, never a spinner mid-surface. */
          <div className="flex flex-col gap-1" aria-hidden>
            <div className="h-11 rounded-xs bg-solid" />
          </div>
        ) : error && devices.length === 0 ? (
          /* §5.5 error: the §1 human copy inline, the list untouched. */
          <p className="max-w-64 p-2 text-body-sm text-error">{error.userMessage}</p>
        ) : devices.length === 0 ? (
          /* §6.3 education: teach the interface, never say "nothing here". */
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
                "flex h-11 w-full items-center justify-between gap-2 rounded-xs px-3",
                "text-body-sm text-ink hover:bg-accent-muted",
                "focus-visible:bg-accent-muted focus-visible:outline-none",
              )}
            >
              <span className="truncate">{d.label}</span>
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

export default function CameraSlab() {
  const camera = useSspStore((s) => s.camera);
  const closeCamera = useSspStore((s) => s.closeCamera);

  return (
    <section aria-label="Camera" className="pane rounded-md p-4">
      <div className="flex items-center gap-2">
        {camera.status === "idle" || camera.status === "error" ? (
          <CameraDevicePopover />
        ) : camera.status === "opening" ? (
          // §5.1 loading: the open resolves after the first decoded frame
          // (API §2.2) — label says what's happening, width stays fixed.
          <span
            className="flex h-10 items-center gap-2 rounded-sm border border-subtle bg-solid px-3 text-body-sm text-ink-secondary"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle size={16} strokeWidth={2} className="animate-spin [animation-duration:0.8s]" aria-hidden="true" />
            Working…
          </span>
        ) : (
          // Active chip = remove affordance (the PiP's hover controls
          // carry freeze/shape/resize; the slab owns add/remove).
          <button
            type="button"
            aria-pressed="true"
            title="Remove camera"
            onClick={() => void closeCamera()}
            className="flex h-10 items-center gap-2 rounded-sm border border-accent bg-accent-muted pl-2.5 pr-3 text-body-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <VideoOff size={16} strokeWidth={1.5} aria-hidden="true" />
            {camera.label ?? "Camera"}
            {camera.width && camera.height ? (
              <span className="font-mono text-mono-sm text-ink-secondary">
                {camera.width}×{camera.height}
              </span>
            ) : null}
          </button>
        )}
      </div>
    </section>
  );
}
