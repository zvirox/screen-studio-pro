import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";

/* §5.9 HUD float window — the main window owns its lifetime, including
   creation that finishes after Stop (API §4.1). Born with the take's id in the URL: the
   first 1 Hz tick is up to a full second away and the buttons must work
   immediately (API §2.3); from there the tick stream re-syncs everything
   (§4.1 Rust truth). */

const HUD_WIDTH = 264; // §5.9 min-width 220 + breathing room for the icon row
const HUD_HEIGHT = 46; // §5.9 float height — the bar fills its window
const SNAP_INSET = 8; // §5.9 corner-snap guides at 8px insets

/* Serialized so React's dev double-effect can't race two windows past the
   existing-window guard (StrictMode mounts the subscribing hook twice in
   dev; a take would then spawn two HUDs). */
let inFlight: Promise<void> = Promise.resolve();

export function openHud(recordingId: string): Promise<void> {
  const next = inFlight.then(() => spawn(recordingId));
  inFlight = next.catch(() => undefined);
  return next;
}

/* Module-level liveness of the hud window. The getByLabel check alone is
   not enough: window registration is asynchronous on the backend, so a
   spawn issued milliseconds ago is still invisible to getByLabel — and
   React's dev double-effect fires exactly that fast. Cleared on
   tauri://destroyed (take ended) and tauri://error (failed creation) so a
   dead or failed spawn never wedges later takes. */
let live: WebviewWindow | null = null;
let liveId: string | null = null;

/** Serialized with creation so Stop cannot leave a late orphan HUD. */
export function closeHud(recordingId: string): Promise<void> {
  const next = inFlight.then(async () => {
    if (live && liveId === recordingId) {
      await live.destroy();
      live = null;
      liveId = null;
    }
  });
  inFlight = next.catch(() => undefined);
  return next;
}

/** Test hook: `live` is module state and no destroy event fires in jsdom. */
export function _resetLiveForTests(): void {
  live = null;
  liveId = null;
  inFlight = Promise.resolve();
}

async function spawn(recordingId: string): Promise<void> {
  // A lingering window from a prior take must not wedge the next one.
  if (live && liveId === recordingId) return;
  const previous = live ?? (await WebviewWindow.getByLabel("hud"));
  if (previous) await previous.destroy();

  // Default placement: bottom-right at the snap inset (PRD 7.2 floats it
  // above the work; bottom-right is where PiP-style HUDs conventionally
  // land and out of the way of menus). A failed monitor probe leaves the
  // position to the WM rather than wedging the spawn. NOTE: Wayland has
  // no client-side positioning — the WM is free to ignore x/y (KWin
  // centers instead); they are honored on X11. On Wayland the bar's
  // compositor-driven drag (startDragging) is the placement path, so the
  // spawn position is a best-effort hint, not policy.
  let x: number | undefined;
  let y: number | undefined;
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      x = monitor.size.width - HUD_WIDTH - SNAP_INSET;
      y = monitor.size.height - HUD_HEIGHT - SNAP_INSET;
    }
  } catch {
    // WM placement fallback (§7: never block the take on chrome)
  }

  const win = new WebviewWindow("hud", {
    url: `hud.html?recordingId=${encodeURIComponent(recordingId)}`,
    title: "ScreenStudio HUD",
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    x,
    y,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // tao's Linux path clamps non-resizable windows to a 200px minimum
    // height when `resizable: false` is set (bisected against KWin 6.8),
    // which swallowed the 46px bar — pin the size with equal min/max
    // constraints instead of the non-resizable flag (2.4 gate probe).
    minWidth: HUD_WIDTH,
    minHeight: HUD_HEIGHT,
    maxWidth: HUD_WIDTH,
    maxHeight: HUD_HEIGHT,
    // The HUD floats over whatever is being RECORDED — it must never
    // take focus from that content (PRD 7.2), and no WM shadow fringe
    // on a transparent window (the bar carries elev.float itself).
    focus: false,
    shadow: false,
  });
  live = win;
  liveId = recordingId;
  // Constructor completion only submits creation. Hiding before the actual
  // created event would strand the controls on a rejected webview spawn.
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve()).catch(reject);
    void win
      .once("tauri://error", () => {
        if (live === win) {
          live = null;
          liveId = null;
        }
        reject(new Error("HUD creation failed"));
      })
      .catch(reject);
    void win
      .once("tauri://destroyed", () => {
        if (live === win) {
          live = null;
          liveId = null;
        }
        reject(new Error("HUD closed during creation"));
      })
      .catch(reject);
  });
}
