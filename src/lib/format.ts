/* lib/format.ts — shared presentation formatters (§3 type law: values
   render through the mono face with tabular figures where they tick). */

/** m:ss below an hour, h:mm:ss above — tabular figures on the mono face.
   Used by the take timer (ActionRow) and the Saved toast's duration
   line (ToastHost, §5.6). */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
