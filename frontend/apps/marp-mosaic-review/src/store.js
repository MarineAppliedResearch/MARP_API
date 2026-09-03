/**
 * State, and the named actions that change it.
 *
 * Every user gesture goes through an action. Actions are the contract: each one is
 * a named thing that happens, logged as it fires, so the eventual API wiring has an
 * obvious set of seams. Nothing mutates state directly.
 */
import { MarpData } from './data.js';

const listeners = new Set();
const logListeners = new Set();

export const state = {
  mode: 'scientific',                 // scientific | training | delete
  page: 1,
  pageSize: 45,
  pageCount: 1,
  total: 0,
  rows: [],
  loading: true,
  railCollapsed: false,

  filters: {
    species: 'Bat Star',
    project: null,
    dive: null,
    minConfidence: 0.5,
    reviewStatus: ['unreviewed'],
    trainingDisposition: null
  },
  sort: { field: 'confidence', dir: 'asc' },

  /** Local, uncommitted decisions for the current page, keyed by observation_id. */
  marks: new Map(),                   // id -> { reason }
  changed: new Map(),                 // id -> { from, to }
  committedPages: new Set(),
  picker: null,                       // { id } while the reason panel is open
  lastCommit: null                    // { reviewed, skipped }
};

/* ---------------------------------------------------------------- plumbing */

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onLog(fn) { logListeners.add(fn); return () => logListeners.delete(fn); }

function notify() { listeners.forEach((fn) => fn(state)); }

const logEntries = [];
export function getLog() { return logEntries; }

/** Named, observable side effect. This is what later becomes an API call. */
function fire(name, detail) {
  const entry = { at: new Date(), name, detail };
  logEntries.unshift(entry);
  if (logEntries.length > 200) logEntries.pop();
  console.log(`[marp] ${name}`, detail ?? '');
  window.dispatchEvent(new CustomEvent('marp:action', { detail: entry }));
  logListeners.forEach((fn) => fn(entry));
}

/** The mode decides what a tap means and what the commit does. */
export const MODES = {
  scientific: { label: 'Scientific Data Review', mark: 'Flagged', verb: 'Flag',
                note: 'Commit accepts unflagged tiles for scientific use',
                commit: 'Mark Page Reviewed', acts: 'unmarked' },
  training:   { label: 'Training Data Review',  mark: 'Excluded', verb: 'Exclude',
                note: 'Commit promotes unmarked tracks to training data — it does not change scientific status',
                commit: 'Promote Page', acts: 'unmarked' },
  delete:     { label: 'Delete',                mark: 'Delete', verb: 'Mark',
                note: 'Commit permanently deletes the marked tiles — unmarked tiles are untouched',
                commit: 'Delete Marked', acts: 'marked' }
};

/* ---------------------------------------------------------------- actions */

export const actions = {
  async init() {
    await MarpData.load();
    fire('init');
    await actions.refresh();
  },

  async refresh() {
    state.loading = true; notify();
    const filters = { ...state.filters };
    if (state.mode === 'training') {
      filters.reviewStatus = null;
      filters.trainingDisposition = ['undecided'];
    } else if (state.mode === 'delete') {
      filters.reviewStatus = ['flagged', 'unreviewed'];
      filters.trainingDisposition = null;
    }
    fire('query', { filters, sort: state.sort, page: state.page });
    const res = await MarpData.query({
      filters, sort: state.sort, page: state.page, pageSize: state.pageSize
    });
    state.rows = res.rows;
    state.total = res.total;
    state.pageCount = res.pageCount;
    state.loading = false;
    notify();
    actions._chaseQueuedThumbnails();
  },

  /** A queued thumbnail resolves in place, without reordering the mosaic. */
  _chaseQueuedThumbnails() {
    state.rows.filter((r) => r.thumbnail_status === 'queued').forEach(async (r) => {
      const res = await MarpData.awaitThumbnail(r.observation_id);
      if (res.ok && state.rows.some((x) => x.observation_id === r.observation_id)) {
        fire('thumbnailReady', { id: r.observation_id });
        notify();
      }
    });
  },

  setMode(mode) {
    if (!MODES[mode] || state.mode === mode) return;
    state.mode = mode;
    state.marks.clear();
    state.picker = null;
    state.page = 1;
    fire('setMode', { mode });
    actions.refresh();
  },

  toggleMark(id) {
    const row = state.rows.find((r) => r.observation_id === id);
    if (!row) return;
    if (state.marks.has(id)) {
      state.marks.delete(id);
      state.picker = null;
      fire('unmark', { id, mode: state.mode });
    } else {
      state.marks.set(id, { reason: null });
      state.picker = { id };
      fire('mark', { id, mode: state.mode, mark: MODES[state.mode].mark });
    }
    notify();
  },

  setReason(id, reason) {
    const mark = state.marks.get(id);
    if (!mark) return;
    mark.reason = mark.reason === reason ? null : reason;
    fire('setReason', { id, reason: mark.reason });
    notify();
  },

  closePicker() { if (state.picker) { state.picker = null; fire('closePicker'); notify(); } },

  async changeSpecies(id, speciesId) {
    const before = state.rows.find((r) => r.observation_id === id);
    const from = before ? before.comname : null;
    fire('changeSpecies:request', { id, speciesId, from });
    const res = await MarpData.setSpecies(id, speciesId);
    if (!res.ok) { fire('changeSpecies:failed', { id }); return; }
    state.changed.set(id, { from, to: res.observation.comname });
    fire('changeSpecies:saved', { id, from, to: res.observation.comname, version: res.observation.version });
    notify();
  },

  /** Clearing the mark is a separate decision from having made the correction. */
  resolve(id) {
    state.marks.delete(id);
    state.picker = null;
    fire('resolve', { id });
    notify();
  },

  markAllOnPage() {
    state.rows.forEach((r) => { if (!state.marks.has(r.observation_id)) state.marks.set(r.observation_id, { reason: null }); });
    fire('markAllOnPage', { count: state.rows.length, scope: 'page' });
    notify();
  },

  clearMarks() {
    const n = state.marks.size;
    state.marks.clear(); state.picker = null;
    fire('clearMarks', { count: n });
    notify();
  },

  async commitPage() {
    const ids = state.rows.map((r) => r.observation_id);
    const marked = new Set(state.marks.keys());
    fire('commitPage:request', { mode: state.mode, page: state.page, count: ids.length, marked: marked.size });
    const res = await MarpData.commitPage({ mode: state.mode, observationIds: ids, marked });
    state.committedPages.add(state.page);
    state.lastCommit = res;
    fire('commitPage:result', { reviewed: res.reviewed.length, skipped: res.skipped.length });
    notify();                                   // page stays loaded; no auto-advance
  },

  goToPage(n) {
    const page = Math.min(Math.max(1, n | 0), state.pageCount);
    if (page === state.page) return;
    state.page = page; state.picker = null;
    fire('goToPage', { page });
    actions.refresh();
  },

  toggleRail() {
    state.railCollapsed = !state.railCollapsed;
    fire('toggleRail', { collapsed: state.railCollapsed });
    notify();
  },

  setSort(field, dir) {
    state.sort = { field, dir };
    fire('setSort', state.sort);
    actions.refresh();
  },

  openVideo(id) { fire('openVideo', { id }); }   // deliberately unimplemented
};
