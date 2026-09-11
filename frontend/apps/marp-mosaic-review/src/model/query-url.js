/**
 * The question, written as an address.
 *
 * The URL is the *only* place the question is kept — no local storage, decided on
 * 2026-09-06. Two stores that can disagree about where the reviewer was is a bug waiting
 * to be written, and an address is the one form of state a person can also send to a
 * colleague.
 *
 * Read from `DIMENSIONS` and from the mode's own status dimensions, so adding a filter
 * stays one entry in the declaration and nothing else — the same test #77 imposed.
 *
 * No DOM and no `window`: this turns a question into a string and a string back into a
 * question, which is why the rules about rejecting nonsense are testable in a millisecond.
 */

import { DIMENSIONS, KIND, emptyValue, isActive, setValueOf } from './dimensions.js';
import { isMode, statusDimensions } from './modes.js';
import { DEFAULT_FILTERS, DEFAULT_SORT, isSort, sortTerms, defaultStatusFor } from './filters.js';

/* The two ends of a range, and the separator between them. A time carries colons and a
   date carries hyphens, so the separator has to be something neither of them contains. */
const SPAN = '..';

/**
 * Percent-encode, but leave the colon alone.
 *
 * `encodeURIComponent` escapes `:`, which turns a perfectly readable `22:00..02:00` into
 * `22%3A00..02%3A00`. A colon is legal in a query value, and this address is meant to be
 * read by people as well as parsed. Commas stay encoded, and that is what makes splitting
 * a multi-select on commas unambiguous even when a species name contains one.
 */
const enc = (v) => encodeURIComponent(String(v)).replace(/%3A/g, ':');

const dec = (v) => {
  try { return decodeURIComponent(v); } catch { return null; }   // a lone % is not fatal
};

/** The default question: what a bare address means, and what the reset gesture restores. */
export function defaultQuery() {
  return {
    mode: 'scientific',
    filters: { ...DEFAULT_FILTERS },
    sort: { ...DEFAULT_SORT },
    page: 1
  };
}

/* ------------------------------------------------------------------- writing */

/** One dimension's value as a query value, or null when it is not filtering. */
function writeValue(dimension, value) {
  if (!isActive(dimension, value)) return null;
  if (dimension.kind === KIND.SET) return value.map(enc).join(',');
  const from = value.from == null ? '' : enc(value.from);
  const to = value.to == null ? '' : enc(value.to);
  return `${from}${SPAN}${to}`;
}

const sameSet = (a, b) =>
  a.length === b.length && a.every((v) => b.includes(v));

/**
 * The address for a question.
 *
 * A filter that is narrowing something is always written, even when it happens to match
 * the default — because absence has to mean "not filtering". The one exception is the
 * completely default question, which produces the bare address it came from.
 */
export function toQuery({ mode, filters, sort, page }) {
  const parts = [];

  if (mode && mode !== 'scientific') parts.push(`mode=${enc(mode)}`);

  for (const dimension of DIMENSIONS) {
    const written = writeValue(dimension, filters[dimension.key]);
    if (written) parts.push(`${dimension.key}=${written}`);
  }

  /* Status filters belong to the mode rather than to the rail, so they are written against
     what *this* mode opens at: a dimension the mode owns is written only when it differs
     from that mode's default, and a borrowed one whenever it is narrowing at all, since it
     opens at nothing. That is what makes absence mean "not filtering" for a borrowed
     dimension rather than "use the other workflow's default". */
  for (const { key, defaults } of statusDimensions(mode || 'scientific')) {
    const chosen = filters[key];
    if (!chosen || !chosen.length) continue;
    if (sameSet(chosen, defaults)) continue;
    parts.push(`${key}=${chosen.map(enc).join(',')}`);
  }

  /* Both terms in the one parameter, comma-separated, because they are one question --
     `?sort=confidence.asc,keyframe_count.desc`. A comma is already the list separator for
     every multi-select here, and a sort field comes from a closed list that cannot contain
     one, so nothing has to be escaped for it. */
  const terms = sortTerms(sort || DEFAULT_SORT);
  const written = terms.map((t) => `${enc(t.field)}.${enc(t.dir)}`).join(',');
  if (written !== `${DEFAULT_SORT.field}.${DEFAULT_SORT.dir}`) parts.push(`sort=${written}`);
  if (page && page > 1) parts.push(`page=${page}`);

  /* Nothing is narrowing at all. That is *not* the same as the default question — the
     fixture opens on one species — so it needs an address of its own, or clearing every
     filter would produce a bare address and the next reload would hand the species filter
     straight back. `all` carries no value; its presence is the whole message. */
  if (!parts.length) return defaultBare() === '' ? '' : '?all=1';

  /* The default question and the bare address have to be the same address, or the app
     rewrites its own URL the moment it loads and a bookmark of "everything" stops
     round-tripping. */
  const bare = parts.join('&');
  return bare === defaultBare() ? '' : `?${bare}`;
}

let defaultBareCache = null;
function defaultBare() {
  if (defaultBareCache != null) return defaultBareCache;
  const d = defaultQuery();
  const parts = [];
  for (const dimension of DIMENSIONS) {
    const written = writeValue(dimension, d.filters[dimension.key]);
    if (written) parts.push(`${dimension.key}=${written}`);
  }
  defaultBareCache = parts.join('&');
  return defaultBareCache;
}

/* ------------------------------------------------------------------- reading */

/**
 * Split a raw query string without decoding it first.
 *
 * `URLSearchParams` decodes on the way out, which would turn an encoded comma inside a
 * species name back into a separator and split one value into two. Values are decoded here
 * only after they have been split.
 */
function rawParams(search) {
  const out = new Map();
  const text = String(search || '').replace(/^[?#]/, '');
  if (!text) return out;
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const key = at === -1 ? pair : pair.slice(0, at);
    const value = at === -1 ? '' : pair.slice(at + 1);
    const name = dec(key);
    if (name) out.set(name, value);
  }
  return out;
}

/**
 * One dimension's value, read back, or null when the address does not make sense for it.
 *
 * **Null means discard, never "match nothing".** R3 is the whole point of this function:
 * an address gets typed, edited, truncated by a chat client and pasted back together, so
 * everything here has to survive arriving malformed. A dimension that cannot read its own
 * value is left not filtering rather than applied half-understood.
 */
function readValue(dimension, raw) {
  if (raw == null || raw === '') return null;

  if (dimension.kind === KIND.SET) {
    /* A `numeric` dimension filters on an integer key, and an address only ever carries
       text — so `species=41` has to come back as the number 41 or the endpoint rejects it
       and the fixture matches nothing. `setValueOf` returns null for anything that is not
       a key, and a value that cannot be read is dropped rather than applied
       half-understood, exactly as every other malformed value here is (R3). */
    const values = raw.split(',').map(dec)
      .filter((v) => v != null && v !== '')
      .map((v) => setValueOf(dimension, v))
      .filter((v) => v != null);
    return values.length ? values : null;
  }

  const at = raw.indexOf(SPAN);
  if (at === -1) return null;                       // a range needs both ends, even empty
  const from = dec(raw.slice(0, at));
  const to = dec(raw.slice(at + SPAN.length));
  if (from == null || to == null) return null;
  if (from === '' && to === '') return null;        // not narrowing, so not a filter

  if (dimension.kind === KIND.WINDOW) {
    const clock = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (from !== '' && !clock.test(from)) return null;
    if (to !== '' && !clock.test(to)) return null;
    /* No ordering check here, deliberately: from later than to is a window that wraps
       past midnight, which is the whole point of #77's R4. */
    return { from: from || null, to: to || null };
  }

  /* A `clock` range carries times, not dates (A17). The pattern is the same one the
     window above uses; what differs is that an out-of-order pair is discarded here rather
     than read as a wrap, because a range does not wrap. */
  if (dimension.clock) {
    const clock = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (from !== '' && !clock.test(from)) return null;
    if (to !== '' && !clock.test(to)) return null;
    if (from && to && from > to) return null;
    return { from: from || null, to: to || null };
  }

  /* A number range with declared bounds. A value outside them was never reachable from
     the rail, so it is discarded rather than clamped — clamping would silently answer a
     question nobody asked. */
  const num = (t) => {
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return undefined;
    if (dimension.bounds && (n < dimension.bounds[0] || n > dimension.bounds[1])) return undefined;
    return n;
  };
  const lo = num(from);
  const hi = num(to);
  if (lo === undefined || hi === undefined) return null;
  if (lo != null && hi != null && lo > hi) return null;
  return { from: lo, to: hi };
}

/**
 * Read an address back into a question.
 *
 * Always returns something usable. Every part is read independently, so a broken
 * confidence range does not cost the reviewer their dive selection.
 *
 * **A bare address is the default question; anything else is read literally.** That
 * distinction is load-bearing. The fixture opens on one species, and if a missing
 * parameter meant "use the default" then a reviewer who deliberately cleared the species
 * filter would find it back on the next reload.
 */
export function fromQuery(search) {
  const params = rawParams(search);
  if (params.size === 0) return defaultQuery();

  const modeRaw = params.has('mode') ? dec(params.get('mode')) : null;
  const mode = modeRaw && isMode(modeRaw) ? modeRaw : 'scientific';

  /* Start from nothing narrowing, then apply what the address actually says. */
  let filters = { ...DEFAULT_FILTERS };
  for (const dimension of DIMENSIONS) filters[dimension.key] = emptyValue(dimension);
  filters = defaultStatusFor(mode, filters);

  for (const dimension of DIMENSIONS) {
    if (!params.has(dimension.key)) continue;
    const value = readValue(dimension, params.get(dimension.key));
    if (value != null) filters[dimension.key] = value;
  }

  /* Every status dimension the mode filters on, which is now both of them (#89). An
     address carrying the other workflow's dimension used to be ignored, because
     `queryFilters` dropped it and a filter shown in the rail that narrows nothing is a lie.
     It narrows something now, so it is applied — a link into Training carrying
     `reviewStatus=flagged` means what it says. */
  for (const { key, statuses } of statusDimensions(mode)) {
    if (!params.has(key)) continue;
    const allowed = new Set(statuses.map(([k]) => k));
    const kept = String(params.get(key)).split(',').map(dec)
      .filter((v) => v != null && allowed.has(v));
    /* Nothing recognisable leaves the mode's own default in place: no status filter at
       all is a different question from the one the address was trying to ask. */
    if (kept.length) filters[key] = kept;
  }

  let sort = { ...DEFAULT_SORT };
  if (params.has('sort')) {
    /* Each term read on its own, so a malformed secondary does not cost the reviewer the
       primary they could otherwise have had -- the same rule every dimension above uses. */
    const read = (text) => {
      const dot = String(text).lastIndexOf('.');
      const field = dot === -1 ? String(text) : String(text).slice(0, dot);
      const dir = dot === -1 ? '' : String(text).slice(dot + 1);
      const name = dec(field);
      return name != null && isSort(name, dir) ? { field: name, dir } : null;
    };

    const [first, second] = String(params.get('sort')).split(',');
    const primary = read(first);
    if (primary) {
      const then = second == null ? null : read(second);
      sort = { ...primary, then: then && then.field !== primary.field ? then : null };
    }
  }

  let page = 1;
  if (params.has('page')) {
    const n = Number(dec(params.get('page')));
    if (Number.isInteger(n) && n >= 1) page = n;
  }

  return { mode, filters, sort, page };
}

/** Is this address asking the default question? What the reset gesture checks against. */
export const isDefaultQuery = (search) => toQuery(fromQuery(search)) === '';
