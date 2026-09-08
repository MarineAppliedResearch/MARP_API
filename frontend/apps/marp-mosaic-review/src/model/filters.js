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

/**
 * The default order, and the shape every sort has.
 *
 * `then` is the secondary term, applied where the primary ties, and it is null by default.
 * That is not a preference: `model/query-url.js` requires a bare address to mean the
 * default question, so a default secondary would have to be written into `defaultBare()`
 * and every link anybody has already sent would stop round-tripping.
 */
export const DEFAULT_SORT = { field: 'confidence', dir: 'asc', then: null };

/**
 * What the mosaic can be ordered by, and what each direction means on that field.
 *
 * This was five fixed pairs of a field and a direction, which is what #81 M1 called not
 * good enough: three of the four fields could only be read one way, and "Confidence (low
 * first)" told you what was applied only if you read the whole phrase. Field and direction
 * are two questions, so they are two choices, and each field names its own two directions
 * -- "longest" says something about a track length that "descending" does not.
 *
 * A sort names one of these or two of them; `sortTerms` below is what turns a sort into
 * the comparisons a query makes, and says what happens after them.
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

const dirOf = (term) =>
  (term && SORT_DIRS.includes(term.dir)) ? term.dir : DEFAULT_SORT.dir;

/**
 * The comparisons a query makes, in order, and nothing else.
 *
 * One term, or two once a secondary is chosen. **`observation_id` is not in here**: it is
 * appended by whatever does the comparing, always and unconditionally, because #68 makes
 * page membership query-derived and a comparator that can return zero for two different
 * rows means page one holds different observations on each visit. Declaring it as a term
 * would make it something a caller could reorder or drop.
 */
export function sortTerms(sort) {
  const primary = sortField(sort);
  const terms = [{ field: primary.field, dir: dirOf(sort) }];

  const then = sort && sort.then;
  /* A second term on the same field can never be reached, so it is not a term. */
  if (then && isSort(then.field, then.dir) && then.field !== primary.field) {
    terms.push({ field: then.field, dir: then.dir });
  }
  return terms;
}

/** One term, in words: `Confidence ↑ low first`. */
function termLabel(term) {
  const s = sortField(term);
  return `${s.label} ${sortArrow(term.dir)} ${s[term.dir]}`;
}

/**
 * What is applied, in words, for the sub-bar.
 *
 * Every term, always. The whole complaint was that a single label made the applied order
 * something to work out rather than something to read, and a secondary term nobody can
 * see is the same complaint one level down.
 */
export function sortLabel(sort) {
  const [primary, secondary] = sortTerms(sort);
  return secondary
    ? `${termLabel(primary)}, then ${termLabel(secondary)}`
    : termLabel(primary);
}

/**
 * Set the primary term, keeping the secondary unless it has become unreachable.
 *
 * Choosing a primary that is already the secondary clears the secondary rather than
 * swapping the two. A swap changes an order the reviewer did not ask to change, and they
 * are one click from setting it again.
 */
export function withSort(sort, field, dir) {
  const then = sort && sort.then;
  return {
    field, dir,
    then: then && then.field !== field ? { ...then } : null
  };
}

/** Set or clear the secondary term. A null field means there is no secondary. */
export function withSortThen(sort, field, dir) {
  const primary = sortField(sort);
  if (!field || field === primary.field) return { ...sort, then: null };
  return { ...sort, then: { field, dir } };
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
