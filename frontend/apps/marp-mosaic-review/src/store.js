/**
 * State, and the named actions that change it.
 *
 * Thin on purpose: the rules live in `model/`, the data in `api/`. This file holds
 * what is currently true, and orchestrates the two. Every user gesture goes through
 * a named action, which is the seam an API call will eventually sit behind.
 */
import { MarpData } from './data.js';
import { MODES, isMode, commitCount, pendingException, existingState } from './model/modes.js';
import * as page from './model/page.js';
import * as filters from './model/filters.js';

export { MODES };

let reqSeq = 0;
const listeners = new Set();
const logListeners = new Set();

export const state = {
  mode: 'scientific',
  page: 1,
  pageSize: 45,
  pageCount: 1,
  total: 0,
  rows: [],
  loading: true,
  ready: false,
  railCollapsed: window.matchMedia('(max-width: 760px)').matches,

  filters: { ...filters.DEFAULT_FILTERS },
  sort: { ...filters.DEFAULT_SORT },
  counts: { unreviewed: 0, reviewed: 0, flagged: 0, undecided: 0, promoted: 0, excluded: 0, total: 0 },

  marks: new Map(),        // the page's exception set: id -> { reason }
  touched: new Set(),      // what the reviewer decided by hand; never re-seeded
  changed: new Map(),      // id -> { from, to } for this session
  outcomes: new Map(),     // id -> what the last commit did
  committedPages: new Set(),
  pageMembers: new Map(),  // page -> the ids it was committed with
  picker: null,            // { id, correcting }
  lastCommit: null,
  /* What the commit button is doing. A page commit is the one action here that can
     take real time and can fail, and it is also the irreversible one, so it says so
     rather than leaving the reviewer wondering whether the click registered. */
  commit: { busy: false, status: null }   // status: null | 'ok' | 'failed'
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

/* The tick and the cross are an acknowledgement, not a state, so they fade rather
   than sitting there until the next commit. */
let commitStatusTimer = null;
function clearCommitStatus(after = 2400) {
  clearTimeout(commitStatusTimer);
  commitStatusTimer = setTimeout(() => {
    state.commit = { ...state.commit, status: null };
    notify();
  }, after);
}

const countFilters = () => ({
  species: state.filters.species, project: state.filters.project, dive: state.filters.dive
});

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

    const pinned = state.pageMembers.get(state.page);
    let res;

    if (pinned) {
      /* A committed page keeps its membership, so returning shows what was submitted. */
      fire('query:pinned', { page: state.page, count: pinned.length });
      const rows = await MarpData.byIds(pinned);
      if (token !== reqSeq) return;
      res = { rows, total: state.total, pageCount: state.pageCount, page: state.page };
    } else {
      const query = filters.queryFilters(state.mode, state.filters,
        { excludeIds: page.pinnedIds(state.pageMembers) });
      fire('query', { page: state.page, sort: state.sort });
      res = await MarpData.query({
        filters: query, sort: state.sort, page: state.page, pageSize: state.pageSize
      });
      if (token !== reqSeq) return;
    }

    state.counts = await MarpData.counts({ filters: countFilters() });
    if (token !== reqSeq) return;

    state.rows = res.rows;
    /* Marks are the page's exception set, so rows that already carry this mode's
       exception arrive marked. Without this, committing a page that held existing
       flags cleared them — the commit accepts everything unmarked. */
    const exception = pendingException(state.mode);
    if (exception) {
      state.marks = page.seedMarks(state.marks, state.touched, res.rows,
        (row) => existingState(state.mode, row) === exception);
    }
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
    if (!isMode(mode) || state.mode === mode) return;
    state.mode = mode;
    state.marks.clear();
    state.picker = null;
    state.page = 1;
    state.pageMembers = page.clearPins();
    state.committedPages.clear();
    /* Outcomes belong to a mode's session of work, not to the observation. Left
       standing, a scientific commit painted REVIEWED badges across Training and
       Delete — two independent decisions wearing each other's answer. Nothing is
       lost by clearing them: what was committed is on the record, and the next
       query reads it back through this mode's own status dimension. */
    state.outcomes = new Map();
    state.touched = new Set();
    state.lastCommit = null;
    state.filters = filters.defaultStatusFor(mode, state.filters);
    fire('setMode', { mode });
    actions.refresh();
  },

  toggleMark(id) {
    if (!state.rows.some((r) => r.observation_id === id)) return;
    const had = state.marks.has(id);
    state.marks = page.toggleMark(state.marks, id);
    state.touched.add(id);
    if (had) state.picker = null;
    fire(had ? 'unmark' : 'mark', { id, mode: state.mode, mark: MODES[state.mode].mark });
    notify();
  },

  setReason(id, reason) {
    state.marks = page.setReason(state.marks, id, reason);
    fire('setReason', { id, reason: (state.marks.get(id) || {}).reason });
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
    if (!state.marks.has(id)) state.marks = page.toggleMark(state.marks, id);
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
    /* The correction is what the panel was opened to do, so choosing a species
       finishes it. Leaving the panel up meant it blanked and rebuilt itself, which
       read as a flicker rather than as a result. The mark stays: correcting the
       species is not the same decision as resolving the flag. */
    if (state.picker && state.picker.id === id) state.picker = null;
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
    state.marks = page.markAll(state.marks, state.rows);
    state.rows.forEach((r) => state.touched.add(r.observation_id));
    fire('markAllOnPage', { count: state.rows.length, scope: 'page' });
    notify();
  },

  clearMarks() {
    const n = state.marks.size;
    state.marks = new Map(); state.picker = null;
    state.rows.forEach((r) => state.touched.add(r.observation_id));
    fire('clearMarks', { count: n });
    notify();
  },

  async commitPage() {
    if (state.commit.busy) return;                 // one commit at a time
    const ids = state.rows.map((r) => r.observation_id);
    const marks = new Map(state.marks);
    fire('commitPage:request', {
      mode: state.mode, page: state.page,
      willAct: commitCount({ mode: state.mode, rows: state.rows, marks })
    });

    state.commit = { busy: true, status: null };
    notify();

    let res;
    try {
      res = await MarpData.commitPage({ mode: state.mode, observationIds: ids, marks });
    } catch (err) {
      /* Nothing is applied. The marks are untouched, so the reviewer can try again
         without redoing the page. */
      state.commit = { busy: false, status: 'failed' };
      fire('commitPage:failed', { message: String(err && err.message || err) });
      clearCommitStatus();
      notify();
      return;
    }

    state.commit = { busy: false, status: 'ok' };
    clearCommitStatus();
    state.committedPages.add(state.page);
    state.pageMembers = page.pinPage(state.pageMembers, state.page, ids);
    state.outcomes = page.applyCommit(state.outcomes, res);
    state.lastCommit = res;
    /* The exceptions stay marked. A committed page is still editable — clicking a
       flag takes it back — and a mark has to keep meaning the same thing before
       and after a commit, or the same gesture reverses its meaning underneath the
       reviewer. */
    state.marks = page.marksAfterCommit(
      marks, state.outcomes, ids, pendingException(state.mode));
    state.picker = null;

    fire('commitPage:result', {
      reviewed: res.reviewed.length, flagged: (res.flagged || []).length,
      reverted: (res.reverted || []).length, skipped: res.skipped.length
    });
    state.counts = await MarpData.counts({ filters: countFilters() });
    notify();                                   // the page stays loaded; no auto-advance
  },

  goToPage(n) {
    const next = page.clampPage(n, state.pageCount);
    if (next === state.page) return;
    state.page = next; state.picker = null;
    fire('goToPage', { page: next });
    actions.refresh();
  },

  toggleRail() {
    state.railCollapsed = !state.railCollapsed;
    fire('toggleRail', { collapsed: state.railCollapsed });
    notify();
  },

  setFilter(key, value) {
    state.filters = filters.applyFilter(state.filters, key, value);
    state.page = 1;
    state.marks = new Map();
    state.touched = new Set();
    state.outcomes = new Map();
    state.pageMembers = page.clearPins();
    state.committedPages.clear();
    fire('setFilter', { key, value });
    actions.refresh();
  },

  toggleStatus(key, value) {
    state.filters = filters.toggleStatus(state.filters, key, value);
    state.page = 1;
    state.marks = new Map();
    state.touched = new Set();
    state.outcomes = new Map();
    state.pageMembers = page.clearPins();
    state.committedPages.clear();
    fire('toggleStatus', { key, value, now: state.filters[key] });
    actions.refresh();
  },

  /** Page size follows the viewport, so the grid always fills it. */
  setPageSize(n) {
    if (n === state.pageSize || !n) return;
    state.pageSize = n;
    fire('setPageSize', { pageSize: n });
    if (state.ready) actions.refresh();
  },

  setSort(field, dir) {
    state.sort = { field, dir };
    state.pageMembers = page.clearPins();
    state.committedPages.clear();
    fire('setSort', state.sort);
    actions.refresh();
  },

  openVideo(id) { fire('openVideo', { id }); }   // deliberately unimplemented
};
