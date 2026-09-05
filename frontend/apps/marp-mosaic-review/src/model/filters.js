/**
 * Building the query a mode asks for.
 *
 * No DOM, no network. Each mode filters on its own status dimension and only that
 * one, so switching modes must not leave the other mode's status filter applied.
 */
import { MODES, statusDimensions } from './modes.js';

export const DEFAULT_FILTERS = {
  species: 'Bat Star',
  project: null,
  dive: null,
  minConfidence: 0.5,
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

/** How many filters are narrowing the results, for the collapsed rail's badge. */
export const activeFilterCount = (mode, filters) =>
  ['species', 'project', 'dive'].filter((k) => filters[k]).length
  + statusDimensions(mode).filter((d) => (filters[d.key] || []).length).length;
