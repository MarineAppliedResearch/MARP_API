/**
 * State, and the named actions that change it.
 *
 * Every user gesture goes through an action. Actions are the contract: each one is
 * a named thing that happens, logged as it fires, so the eventual API wiring has an
 * obvious set of seams. Nothing mutates state directly.
 */
import { MarpData } from './data.js';

let reqSeq = 0;
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
  ready: false,                       // the fixture/API has answered at least once
  railCollapsed: window.matchMedia('(max-width: 760px)').matches,

  filters: {
    species: 'Bat Star',
    project: null,
    dive: null,
    minConfidence: 0.5,
    reviewStatus: ['unreviewed', 'flagged'],
    trainingDisposition: null
  },
  sort: { field: 'confidence', dir: 'asc' },

  /** Local, uncommitted decisions for the current page, keyed by observation_id. */
  marks: new Map(),                   // id -> { reason }
  changed: new Map(),                 // id -> { from, to }
  committedPages: new Set(),
  /* page number -> the observation ids that were on it when it was committed */
  pageMembers: new Map(),
  counts: { unreviewed: 0, reviewed: 0, undecided: 0, promoted: 0, excluded: 0, total: 0 },
  outcomes: new Map(),                // id -> 'reviewed' | 'promoted' | 'deleted'
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
    state.ready = true;
    fire('init');
    await actions.refresh();
  },

  async refresh() {
    /* Requests can overlap — a page change during a page-size change, say — and the
       slower one must not win. Only the newest response is allowed to land. */
    const token = ++reqSeq;
    state.loading = true; notify();
    /* Each mode filters on its own status dimension, and only that one. */
    const filters = { ...state.filters };
    if (state.mode === 'training') filters.reviewStatus = null;
    else filters.trainingDisposition = null;
    /* A committed page keeps the exact observations it was committed with, so the
       reviewer can see what they submitted and change it. Everything else is a
       normal query over the remaining work. */
    const pinned = state.pageMembers.get(state.page);
    let res;
    if (pinned) {
      fire('query:pinned', { page: state.page, count: pinned.length });
      const rows = await MarpData.byIds(pinned);
      if (token !== reqSeq) return;
      res = { rows, total: state.total, pageCount: state.pageCount, page: state.page };
    } else {
      const exclude = new Set();
      state.pageMembers.forEach((ids) => ids.forEach((id) => exclude.add(id)));
      filters.excludeIds = exclude;
      fire('query', { filters: { ...filters, excludeIds: exclude.size }, sort: state.sort, page: state.page });
      res = await MarpData.query({
        filters, sort: state.sort, page: state.page, pageSize: state.pageSize
      });
      if (token !== reqSeq) return;                // superseded; drop it
    }
    state.counts = await MarpData.counts({ filters: {
      species: state.filters.species, project: state.filters.project, dive: state.filters.dive
    } });
    state.rows = res.rows;
    if (!pinned) { state.total = res.total; state.pageCount = res.pageCount; }
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
    state.pageMembers.clear();
    state.committedPages.clear();
    if (mode === 'training' && !(state.filters.trainingDisposition || []).length) {
      state.filters.trainingDisposition = ['undecided'];
    }
    if (mode !== 'training' && !(state.filters.reviewStatus || []).length) {
      state.filters.reviewStatus = ['unreviewed', 'flagged'];
    }
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

  openPicker(id) {
    if (!state.marks.has(id)) return;
    state.picker = { id, correcting: false };
    fire('openPicker', { id });
    notify();
  },

  /** The species chooser is opened deliberately, not revealed by a reason. */
  toggleCorrecting(id) {
    if (!state.picker || state.picker.id !== id) return;
    state.picker.correcting = !state.picker.correcting;
    fire('toggleCorrecting', { id, correcting: state.picker.correcting });
    notify();
  },

  /** Straight back into the chooser from a tile that was already changed. */
  openCorrection(id) {
    if (!state.marks.has(id)) state.marks.set(id, { reason: null });
    state.picker = { id, correcting: true };
    fire('openCorrection', { id });
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
    const marks = new Map(state.marks);
    fire('commitPage:request', { mode: state.mode, page: state.page, count: ids.length, marked: marks.size });
    const res = await MarpData.commitPage({ mode: state.mode, observationIds: ids, marks });
    state.committedPages.add(state.page);
    state.pageMembers.set(state.page, ids);
    state.lastCommit = res;
    res.reviewed.forEach((r) => state.outcomes.set(r.id, r.outcome));
    (res.flagged || []).forEach((r) => state.outcomes.set(r.id, r.outcome));
    state.marks.clear();
    state.picker = null;
    fire('commitPage:result', { reviewed: res.reviewed.length,
      flagged: (res.flagged || []).length, reverted: (res.reverted || []).length,
      skipped: res.skipped.length });
    state.counts = await MarpData.counts({ filters: {
      species: state.filters.species, project: state.filters.project, dive: state.filters.dive
    } });
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

  /** 8/10: the rail controls actually drive the query now. */
  setFilter(key, value) {
    state.pageMembers.clear();
    state.committedPages.clear();
    state.filters[key] = value;
    state.page = 1;
    state.marks.clear();
    fire('setFilter', { key, value });
    actions.refresh();
  },

  toggleStatus(key, value) {
    state.pageMembers.clear();
    state.committedPages.clear();
    const cur = state.filters[key] || [];
    state.filters[key] = cur.includes(value) ? cur.filter((v) => v !== value) : cur.concat(value);
    state.page = 1;
    fire('toggleStatus', { key, value, now: state.filters[key] });
    actions.refresh();
  },

  /** Page size follows the viewport, so the grid always fills it. */
  setPageSize(n) {
    if (n === state.pageSize || !n) return;
    state.pageSize = n;
    fire('setPageSize', { pageSize: n });
    if (state.ready) actions.refresh();   // rows may not have landed yet; ready is the real guard
  },

  setSort(field, dir) {
    state.pageMembers.clear();
    state.committedPages.clear();
    state.sort = { field, dir };
    fire('setSort', state.sort);
    actions.refresh();
  },

  openVideo(id) { fire('openVideo', { id }); }   // deliberately unimplemented
};
