/**
 * Whether a row satisfies the rail, and the arithmetic behind the awkward parts.
 *
 * Pure, so the midnight wrap and the nesting rule are unit-testable. Both are arithmetic
 * and a browser proves nothing about either.
 *
 * `data.js` uses this so the fixture and the API cannot disagree about what a filter
 * means. When the API arrives, the same rules go into the query it builds.
 */

import { DIMENSIONS, DIMENSION, KIND, dependentsOf, isActive, emptyValue } from './dimensions.js';

/**
 * Milliseconds into the day, from .NET TimeSpan text.
 *
 * Mirrors `db/timecode.js` deliberately, including the optional day group: a dive that
 * crosses midnight writes `1.00:15:33`, and `21:57:22` is day 0. Reading the day group as
 * part of the hour, or ignoring it, puts the same observation in two different hours
 * depending on who asked -- and that module's own comment is that getting this slightly
 * wrong is not a rounding error but a changed scientific record.
 *
 * Returns time of day only: the day component tells us the dive rolled over, not which
 * hour the observation happened in.
 */
export function timeOfDayMs(text) {
  if (text == null || text === '') return null;
  const m = /^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/.exec(String(text).trim());
  if (!m) return null;
  const [, , , hh, mm, ss, frac] = m;
  const fracMs = frac ? Math.trunc(Number(`0.${frac}`) * 1000) : 0;
  return ((Number(hh) * 3600) + (Number(mm) * 60) + Number(ss)) * 1000 + fracMs;
}

/** Minutes past midnight from `HH:MM`, for the two ends of a window. */
export function clockMs(text) {
  if (text == null || text === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  return ((Number(m[1]) * 3600) + (Number(m[2]) * 60)) * 1000;
}

/**
 * `HH:MM` from whatever somebody typed into one end of a time window, or null.
 *
 * The ends are text fields rather than `<input type="time">`, because a native time input
 * renders from the browser's locale and no attribute overrides it — `lang="en-GB"` still
 * draws `01:30 PM` in Chromium, and MARP writes 24-hour everywhere. #81 B3.
 *
 * So this is where a typed time becomes a value: `9:30` and `0930` both mean half past
 * nine. Anything that is not a time of day at all returns null, which leaves that end
 * unset — never a filter applied half-understood.
 */
export function normaliseClock(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (t === '') return null;
  const m = /^(\d{1,2}):?([0-5]\d)$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * Is this time of day inside the window?
 *
 * A window may wrap: 22:00 to 02:00 is one night, not two ranges. Inside a wrapped
 * window the test is "after the start **or** before the end" rather than "and" -- the
 * single most common way this gets written wrongly, and it returns nothing at all when
 * it is.
 */
export function withinWindow(ms, from, to) {
  if (ms == null) return false;
  if (from == null && to == null) return true;
  if (from == null) return ms <= to;
  if (to == null) return ms >= from;
  return from <= to ? (ms >= from && ms <= to) : (ms >= from || ms <= to);
}

/** Does `tc` carry a date, or only a time of day? */
export const carriesDate = (text) =>
  typeof text === 'string' && /^\s*-?\d{4}-\d{2}-\d{2}/.test(text);

/** The date part of a `tc` that has one, as `YYYY-MM-DD`. */
export function dateOf(text) {
  if (!carriesDate(text)) return null;
  return String(text).trim().slice(0, 10);
}

/** Does one row satisfy one dimension? */
export function matchesDimension(dimension, value, row) {
  if (!isActive(dimension, value)) return true;
  const raw = row[dimension.field];

  if (dimension.kind === KIND.SET) return value.includes(raw);

  if (dimension.kind === KIND.WINDOW) {
    return withinWindow(timeOfDayMs(raw), clockMs(value.from), clockMs(value.to));
  }

  /**
   * RANGE. A `clock` range compares the row's `tc` as a **point in time** (A17), and a row
   * whose `tc` carries no readable clock cannot answer -- it is excluded, and counted,
   * never guessed at.
   *
   * Inclusive at both ends and it **does not wrap**: `withinWindow` above is the wrapping
   * one, and using it here would silently turn a from-later-than-to range, which is empty,
   * into a night. That distinction is the only thing separating this dimension from
   * `timeOfDay` today.
   *
   * This compared `dateOf(raw)` against `YYYY-MM-DD` bounds, which is the reading the
   * human ruled out: no `tc` carries a date, so it answered zero rows.
   */
  if (dimension.clock) {
    const ms = timeOfDayMs(raw);
    if (ms == null) return false;
    const from = clockMs(value.from);
    const to = clockMs(value.to);
    if (from != null && ms < from) return false;
    if (to != null && ms > to) return false;
    return true;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  if (value.from != null && n < value.from) return false;
  if (value.to != null && n > value.to) return false;
  return true;
}

/** Does a row satisfy every dimension the reviewer has set? */
export function matchesFilters(filters, row) {
  return DIMENSIONS.every((d) => matchesDimension(d, filters[d.key], row));
}

/**
 * How many rows a dimension had to exclude for being unable to answer.
 *
 * Only the date dimension reports this, and it is the whole reason it may be used at all:
 * filtering to August would otherwise silently omit every observation whose clock was
 * never synced, and the result would look complete. A number the reviewer can see is the
 * difference between a filter and a lie.
 */
export function unanswerable(filters, rows) {
  const d = DIMENSION.date;
  if (!isActive(d, filters.date)) return 0;
  /* A row that cannot answer is one whose `tc` carries no readable clock (A17). It was
     one whose `tc` carried no *date*, which was every row -- so the count was the whole
     result and the note said so, which is why the filter had to be refused rather than
     served. */
  return rows.filter((r) => timeOfDayMs(r[d.field]) == null).length;
}

/**
 * Set one dimension, dropping only what no longer applies.
 *
 * The old rule cleared every narrower dimension outright: changing the project threw away
 * the dives and the lines. With several selectable that is too blunt -- a reviewer who has
 * assembled a careful multi-dive selection should not lose it because they dropped one
 * project. So a dependent keeps whatever values are still reachable, and loses the rest.
 *
 * `reachable` comes from the caller because only the data layer knows which dives belong
 * to which projects. Without it the old behaviour applies, which is safe rather than wrong.
 */
export function applyDimension(filters, key, value, reachable = null) {
  const out = { ...filters, [key]: value };

  for (const depKey of dependentsOf(key)) {
    const dep = DIMENSION[depKey];
    const current = out[depKey];
    if (!isActive(dep, current)) continue;

    if (!reachable || !reachable[depKey]) {
      out[depKey] = emptyValue(dep);              // no map: fall back to clearing
      continue;
    }
    const still = new Set(reachable[depKey]);
    const kept = current.filter((v) => still.has(v));
    out[depKey] = kept.length ? kept : emptyValue(dep);
  }
  return out;
}

/** Add or remove one value of a set dimension. */
export function toggleValue(filters, key, value) {
  const current = filters[key] || [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : current.concat(value);
  return { ...filters, [key]: next };
}
