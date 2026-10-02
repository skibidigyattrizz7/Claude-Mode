// Real-world calendar helpers for weekly content (TOTW, Rivals weeks, events, season track). DOM-free.
const DAY = 86400000;
export const EPOCH = Date.UTC(2026, 0, 5); // a Monday
/** 1-based week number since the epoch (changes every Monday 00:00 UTC). */
export function weekNumber(t = Date.now()) { return Math.max(1, Math.floor((t - EPOCH) / (7 * DAY)) + 1); }
/** Milliseconds until the next weekly reset. */
export function msToWeekReset(t = Date.now()) { const w = weekNumber(t); return EPOCH + w * 7 * DAY - t; }
export function fmtCountdown(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
