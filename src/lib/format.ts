/* lib/format.ts — shared presentation formatters (§3 type law: values
   render through the mono face with tabular figures where they tick). */

import type { RecordingStatsEvt } from "../types/ipc";

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

/** §6.1 #6 stats line — "59.8 fps · 0 dropped · 12.1 Mbps · 5.2 ms".
    kbps→Mbps keeps the line human-scale (DESIGN §7.9 plain language). */
export function formatStats(stats: RecordingStatsEvt): string {
  const mbps = (stats.bitrateKbps / 1000).toFixed(1);
  const parts = [
    `${stats.fps.toFixed(1)} fps`,
    `${stats.droppedFrames} dropped`,
    `${mbps} Mbps`,
    `${stats.encodeTimeMs.toFixed(1)} ms`,
  ];
  // 11.4: loudness + true-peak (dBFS) when the meter has gated.
  if (stats.lufs != null) parts.push(`${stats.lufs.toFixed(1)} LUFS`);
  if (stats.truePeak > 0) {
    parts.push(`${(20 * Math.log10(stats.truePeak)).toFixed(1)} dBFS TP`);
  }
  return parts.join(" · ");
}
