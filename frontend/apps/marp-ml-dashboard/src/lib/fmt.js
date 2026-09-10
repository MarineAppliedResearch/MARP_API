/**
 * The shared formatters.
 *
 * Every tab uses these. A tab that formats a duration its own way makes two
 * screens disagree about the same job, which reads as a data bug and is not.
 */

const INT = new Intl.NumberFormat('en-US');

/** 1842 -> "1,842". Null-safe, because plenty of these fields are legitimately null. */
export const int = (n) => (n === null || n === undefined ? '—' : INT.format(n));

/** 0.7215 -> "72%". Takes a fraction, not a percentage. */
export const pct = (f) => (f === null || f === undefined ? '—' : Math.round(f * 100) + '%');

/** A job's progress as a fraction, or null when there is no measurement yet.
 *  Null before the first heartbeat is legitimate (#104) -- a 0% bar would be
 *  claiming a measurement that does not exist. */
export function frac(progress) {
  if (!progress || !progress.total) return null;
  return Math.min(1, progress.done / progress.total);
}

/** 8784 -> "2h 26m". Seconds in, coarse and readable out. */
export function dur(s) {
  if (s === null || s === undefined) return '—';
  if (s < 60) return Math.round(s) + 's';
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h === 0) return m + 'm';
  if (h < 100) return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

/** "2026-09-08T14:32:00Z" -> "2026-09-08 14:32". The app is an operator
 *  console, so an absolute stamp beats a relative one for anything in a table. */
export function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
}

/** Just the day. */
export const date = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');

/** Just the wall clock, for rows that are all from today. */
export const clock = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : '—');

/** "4 minutes ago". Used only where recency is the point, never in a table
 *  column that is also sorted -- a relative stamp cannot be compared by eye. */
export function ago(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

/** 24576 MB -> "24 GB". VRAM and artifact sizes. */
export const gb = (mb) => (mb === null || mb === undefined ? '—' : Math.round(mb / 1024) + ' GB');

/** 412.7 -> "413 MB". */
export const mb = (n) => (n === null || n === undefined ? '—' : Math.round(n) + ' MB');

/** A sha256 as an operator reads it: first eight. */
export const hash = (s) => (s ? s.slice(0, 8) : '—');

/** 0.8431 -> "0.843". Model metrics, where three places is the convention. */
export const metric = (n) => (n === null || n === undefined ? '—' : n.toFixed(3));

/** The label a state carries on screen. The states themselves are listed in
 *  DESIGN.md; this is the one place their wording is decided. */
const LABELS = {
  running: 'Running', queued: 'Queued', succeeded: 'Completed', done: 'Completed',
  issues: 'Completed (Issues)', failed: 'Failed', cancelled: 'Cancelled',
  cancelling: 'Cancelling', paused: 'Paused',
  online: 'Online', busy: 'Busy', idle: 'Idle', offline: 'Offline', draining: 'Draining',
};
export const label = (state) => LABELS[state] || state;

export const fmt = {
  int, pct, frac, dur, when, date, clock, ago, gb, mb, hash, metric, label,
};
export default fmt;
