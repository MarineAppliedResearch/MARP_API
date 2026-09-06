/**
 * Building the query a mode asks for.
 *
 * No DOM, no network. Each mode filters on its own status dimension and only that
 * one, so switching modes must not leave the other mode's status filter applied.
 */
import { MODES, statusDimensions } from './modes.js';
import { DIMENSIONS, DIMENSION, KIND, isActive, emptyValue } from './dimensions.js';
export { applyDimension, toggleValue } from './match.js';

/**
 * The rail's keys, in rail order.
 *
 * Read from the declaration rather than listed here: a dimension that existed in
 * `DIMENSIONS` and was forgotten from this array would filter but not count towards the
 * collapsed rail's badge, which is the kind of half-wired dimension the refactor removed.
 */
export const FILTER_KEYS = DIMENSIONS.map((d) => d.key);

/** Nothing selected anywhere: every dimension starts not filtering. */
export const DEFAULT_FILTERS = {
  ...Object.fromEntries(DIMENSIONS.map((d) => [d.key, emptyValue(d)])),
  /* One exception, and it is the fixture's rather than the rail's: opening on every
     species at once is a wall of unrelated animals, and the mosaic's whole premise is
     that a page holds one predicted species. */
  species: ['Bat Star'],
  reviewStatus: MODES.scientific.defaultStatus.slice(),
  trainingDisposition: MODES.training.defaultStatus.slice()
};

export const DEFAULT_SORT = { field: 'confidence', dir: 'asc' };

export const SORTS = [
  { field: 'confidence', dir: 'asc', label: 'Confidence (low first)' },
  { field: 'confidence', dir: 'desc', label: 'Confidence (high first)' },
  { field: 'keyframe_count', dir: 'desc', label: 'Track length (longest)' },
  { field: 'updatedAt', dir: 'desc', label: 'Recently updated' },
  { field: 'obsID', dir: 'asc', label: 'Observation number' }
];

export const sortLabel = (sort) =>
  (SORTS.find((s) => s.field === sort.field && s.dir === sort.dir) || SORTS[0]).label;

/**
 * The filters actually sent for a mode: the reviewer's choices, with the other
 * mode's status dimension dropped so it cannot silently narrow the results.
 */
export function queryFilters(mode, filters, { excludeIds } = {}) {
  const out = { ...filters };
  /* Drop every status dimension this mode does not filter on, so the other mode's
     selection cannot silently narrow the results. Delete keeps both. */
  const mine = new Set(statusDimensions(mode).map((d) => d.key));
  for (const key of ['reviewStatus', 'trainingDisposition']) {
    if (!mine.has(key)) out[key] = null;
  }
  if (excludeIds && excludeIds.size) out.excludeIds = excludeIds;
  return out;
}

/**
 * Set one filter, and drop anything it invalidates.
 *
 * Delegates to `match.applyDimension`, which drops only what no longer applies rather
 * than clearing every narrower dimension outright -- see the note there. Kept as a name
 * because callers outside the model use it.
 */
export { applyDimension as applyFilter } from './match.js';

/** Toggle one value of a multi-select status filter. */
export function toggleStatus(filters, key, value) {
  const cur = filters[key] || [];
  return {
    ...filters,
    [key]: cur.includes(value) ? cur.filter((v) => v !== value) : cur.concat(value)
  };
}

/** Entering a mode with nothing selected on a dimension falls back to its default. */
export function ensureStatusFor(mode, filters) {
  let out = filters;
  for (const { key, defaults } of statusDimensions(mode)) {
    if ((out[key] || []).length) continue;
    out = { ...out, [key]: defaults.slice() };
  }
  return out;
}

/**
 * Entering a mode puts every dimension it owns back to that mode's default.
 *
 * Carrying a selection across is worse than it sounds, because the modes do not mean
 * the same thing by a dimension. Training narrows training disposition to *undecided*
 * so finished work leaves the view; Delete shows all three, because there it is
 * context rather than a filter. Arriving in Delete straight from Training inherited
 * the narrowing and hid every observation the reviewer had just promoted — exactly the
 * rows most worth seeing before deleting something.
 *
 * `setMode` already discards marks, outcomes and pins, so a mode opening at its own
 * default is the consistent behaviour rather than a new one.
 */
export function defaultStatusFor(mode, filters) {
  let out = filters;
  for (const { key, defaults } of statusDimensions(mode)) {
    out = { ...out, [key]: defaults.slice() };
  }
  return out;
}

/** How many filters are narrowing the results, for the collapsed rail's badge. */
export const activeFilterCount = (mode, filters) =>
  DIMENSIONS.filter((d) => isActive(d, filters[d.key])).length
  + statusDimensions(mode).filter((d) => (filters[d.key] || []).length).length;
