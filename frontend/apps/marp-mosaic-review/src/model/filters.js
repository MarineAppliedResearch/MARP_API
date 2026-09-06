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

/**
 * What the mosaic can be ordered by, and what each direction means on that field.
 *
 * This was five fixed pairs of a field and a direction, which is what #81 M1 called not
 * good enough: three of the four fields could only be read one way, and "Confidence (low
 * first)" told you what was applied only if you read the whole phrase. Field and direction
 * are two questions, so they are two choices, and each field names its own two directions
 * -- "longest" says something about a track length that "descending" does not.
 *
 * Every field keeps `observation_id` as its tie-breaker in the query, which is what makes
 * a re-query return the same page. That is not optional and not declared here.
 */
export const SORT_FIELDS = [
  { field: 'confidence', label: 'Confidence', asc: 'low first', desc: 'high first' },
  { field: 'keyframe_count', label: 'Track length', asc: 'shortest first', desc: 'longest first' },
  { field: 'updatedAt', label: 'Last updated', asc: 'oldest first', desc: 'newest first' },
  { field: 'obsID', label: 'Observation number', asc: 'lowest first', desc: 'highest first' }
];

export const SORT_DIRS = ['asc', 'desc'];

/** The declared field a sort names, or the default when it names nothing recognisable. */
export const sortField = (sort) =>
  SORT_FIELDS.find((s) => s.field === (sort && sort.field))
  || SORT_FIELDS.find((s) => s.field === DEFAULT_SORT.field);

/** Is this a sort the rail could have produced? What the address checks against. */
export const isSort = (field, dir) =>
  SORT_DIRS.includes(dir) && SORT_FIELDS.some((s) => s.field === field);

/** Which way an arrow points for a direction. Ascending is up, everywhere. */
export const sortArrow = (dir) => (dir === 'desc' ? '↓' : '↑');

/**
 * What is applied, in words, for the sub-bar.
 *
 * Both halves, always. The whole complaint was that a single label made the applied order
 * something to work out rather than something to read.
 */
export function sortLabel(sort) {
  const s = sortField(sort);
  const dir = SORT_DIRS.includes(sort && sort.dir) ? sort.dir : DEFAULT_SORT.dir;
  return `${s.label} ${sortArrow(dir)} ${s[dir]}`;
}

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
