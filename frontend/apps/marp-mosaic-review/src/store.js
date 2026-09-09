/**
 * State, and the named actions that change it.
 *
 * Thin on purpose: the rules live in `model/`, the data in `api/`. This file holds
 * what is currently true, and orchestrates the two. Every user gesture goes through
 * a named action, which is the seam an API call will eventually sit behind.
 */
import { MarpData } from './data.js';
import { MODES, isMode, commitCount, pendingException, existingState, commitIsDestructive, deleteImpact, commitOutcome, pageState, markedOnPage } from './model/modes.js';
import * as page from './model/page.js';
import * as filters from './model/filters.js';
import * as dimensions from './model/dimensions.js';
import { toQuery, fromQuery } from './model/query-url.js';
import { plan } from './model/schedule.js';
import { createCache, keyFor } from './model/cache.js';

export { MODES };

let reqSeq = 0;
const listeners = new Set();
const logListeners = new Set();

/**
 * What the client already holds for the question it is asking. #99: the reviewer never
 * waits for data.
 *
 * The rules are in `model/cache.js` and `model/schedule.js`; this is the one instance and
 * the only place that fetches or evicts anything. Three properties are load-bearing and
 * each is easy to undo by accident:
 *
 * - **A hit renders without ever setting `state.loading`.** `renderGrid` draws skeletons
 *   while it is true and `computeLayout` returns early, so a cache that sets it still
 *   flashes a loading state — a cache that renders a spinner has failed the task,
 *   however correct its accounting.
 * - **A prefetch bypasses `reqSeq` entirely.** A request that can never become the
 *   visible page needs no sequencing, and giving it a token is how it comes to overwrite
 *   the visible page. What says a prefetch is still wanted is the cache *key*.
 * - **A prefetch never calls `notify()` and never asks for a count.** Nothing it fetches
 *   is on screen, and a full re-render for a page nobody is looking at is the thing
 *   yielding exists to prevent.
 */
const cache = createCache();

/* How long the prefetcher yields for after the visible page has settled, and then the
   endpoint's own cap on one page-set request: `requestedPages` in data.js rejects a
   bigger one with a 400 rather than truncating it, so the cap is respected here. */
const PREFETCH_IDLE = 250;
const MAX_PAGES = 12;
const MAX_ROWS = 600;

let prefetchBusy = false;      // at most one prefetch in flight, ever
let prefetchWait = null;       // the pending yield, recomputed on every page change
let idleWait = null;           // ...and its requestIdleCallback half
let shownPage = null;          // the page last put on screen, for the direction of travel
let travel = 1;                // the sign of the last page movement; forward after a jump

export const state = {
  mode: 'scientific',
  page: 1,
  pageSize: 45,
  pageCount: 1,
  total: 0,
  rows: [],
  excludedForNoDate: 0,          // rows a date filter could not answer for; see refresh()
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
  /**
   * The three above, parked per mode while another mode is in front.
   *
   * They are this reviewer's *session* work — which pages they committed, with which
   * observations, and what each commit did — and it belongs to the mode that did it.
   * `setMode` used to throw all of it away, which stopped one mode wearing another's
   * answers and took the session with it: review three pages, glance at Training, come
   * back, and there was no way to see what had been submitted. Parked and restored
   * instead, so the isolation holds and the work survives.
   */
  parked: new Map(),       // mode -> { pageMembers, committedPages, outcomes }
  picker: null,            // { id, correcting }
  lastCommit: null,
  /* What the commit button is doing. A page commit is the one action here that can
     take real time and can fail, and it is also the irreversible one, so it says so
     rather than leaving the reviewer wondering whether the click registered. */
  commit: { busy: false, status: null },  // status: null | 'ok' | 'failed'
  /* What a destructive commit is waiting to be told to do: null, or the impact the
     reviewer is being asked to accept. Held in the store rather than the dialog so the
     rule about what is destroyed and the thing that destroys it cannot drift apart. */
  confirm: null            // null | { count, reviewed, promoted }
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

/**
 * Rows onto the screen, plus the page's exception set.
 *
 * Shared by all three branches of `refresh()` — a cache hit, a pinned page and a query —
 * because seeding the marks is exactly the line a new branch forgets, and forgetting it
 * silently clears the exceptions the record already carried when the page is committed.
 */
function showRows(rows) {
  state.rows = rows;
  const exception = pendingException(state.mode);
  if (exception) {
    state.marks = page.seedMarks(state.marks, state.touched, rows,
      (row) => existingState(state.mode, row) === exception);
  }
}

/** The last thing every branch of `refresh()` does, in the order it has to happen. */
function settled() {
  shownPage = state.page;
  state.loading = false;
  notify();
  actions._chaseQueuedThumbnails();
  actions._schedulePrefetch();
}

/**
 * Drop the pending yield.
 *
 * A page change recomputes the prefetch from where the reviewer is *now* rather than
 * queueing a second one behind where they were.
 */
function cancelPrefetchWait() {
  clearTimeout(prefetchWait);
  prefetchWait = null;
  if (idleWait != null && typeof window !== 'undefined' && window.cancelIdleCallback) {
    window.cancelIdleCallback(idleWait);
  }
  idleWait = null;
}

/**
 * A different order means different pages, so what was pinned is no longer that page.
 *
 * Shared by both sort actions, because remembering it in one and forgetting it in the
 * other would leave a committed page showing rows the new order never put there.
 */
function reorder() {
  state.pageMembers = page.clearPins();
  state.committedPages.clear();
  /* Every mode's pinned pages were pinned under the old order, so page 2 is not the same
     page 2 any more. Parking them would restore pins that describe a result that is gone. */
  state.parked = new Map();
}

/* ---------------------------------------------------------------- actions */

/**
 * A new query means a different set of observations, so nothing about the old one holds:
 * not the marks, not what was committed, not the pins. Shared by every filter action
 * because forgetting one of these lines is how a mark from a previous filter reappears
 * on an unrelated page.
 */
function resetForNewQuery() {
  state.page = 1;
  state.marks = new Map();
  state.touched = new Set();
  state.outcomes = new Map();
  state.pageMembers = page.clearPins();
  state.committedPages.clear();
  /* A different question means the other modes' pinned pages are about a result set that
     no longer exists, so parking them would resurrect pages the filter no longer returns. */
  state.parked = new Map();
}

/**
 * Write the question into the address bar.
 *
 * `replaceState` rather than `pushState`: a slider fires a change per drag and a rail full
 * of filters would bury the reviewer's real history under dozens of entries they never
 * chose to make. The address is here so a reload lands in the same place and so a link can
 * be sent, not to be a navigation stack.
 */
function rememberQuery() {
  if (typeof window === 'undefined' || !window.history) return;
  const search = toQuery({
    mode: state.mode, filters: state.filters, sort: state.sort, page: state.page
  });
  const here = window.location.pathname + window.location.search + window.location.hash;
  const next = window.location.pathname + search + window.location.hash;
  if (next !== here) window.history.replaceState(null, '', next);
}

/**
 * Adopt a question read back from an address.
 *
 * Nothing transient comes with it. #68 is explicit that undecided items from an
 * uncommitted page may appear again, and restoring marks would be worse than losing them:
 * a flag that was never committed is indistinguishable on screen from one that was, and
 * the record would not agree with either.
 */
function adoptQuery(q) {
  resetForNewQuery();
  state.mode = q.mode;
  state.filters = q.filters;
  state.sort = q.sort;
  state.page = q.page;              // after resetForNewQuery, which sends it back to 1
}

/** This mode's session work, lifted out so another mode can have the three fields. */
function park(mode) {
  state.parked.set(mode, {
    pageMembers: state.pageMembers,
    committedPages: state.committedPages,
    outcomes: state.outcomes
  });
}

/**
 * Put a mode's session work back, or start it fresh.
 *
 * Marks and take-backs are deliberately *not* parked. An uncommitted mark is a pending
 * intention in one workflow, and carrying it across a mode switch would restore a decision
 * the reviewer had walked away from. A committed page is different: it is on the record,
 * and this is only how it is displayed.
 */
function resume(mode) {
  const held = state.parked.get(mode);
  state.pageMembers = held ? held.pageMembers : page.clearPins();
  state.committedPages = held ? held.committedPages : new Set();
  state.outcomes = held ? held.outcomes : new Map();
}

export const actions = {
  async init() {
    await MarpData.load();
    adoptQuery(fromQuery(typeof window === 'undefined' ? '' : window.location.search));
    state.ready = true;
    fire('init');

    /* Nothing here pushes history, but the reviewer can still arrive by the back button
       from somewhere else, or edit the address by hand. Read it again when that happens
       rather than showing a screen the address no longer describes. */
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => {
        adoptQuery(fromQuery(window.location.search));
        fire('restoreQuery', { page: state.page, mode: state.mode });
        notify();
        actions.refresh();
      });
    }
    await actions.refresh();
  },

  async refresh() {
    /* Every action that changes the question ends here, so this is the one place the
       address has to be kept up to date. */
    rememberQuery();

    /* The cache holds one question at a time, so adopting a different key empties it: a
       filter, the sort, the mode or the page size each produce a genuinely different
       result set, and `resetForNewQuery()` already retires the pins and the parked work
       for that reason. **A commit changes none of them and so invalidates nothing** —
       paging forward must never discard what is behind, which is the whole of #99. */
    const holding = cache.rowCount();
    if (cache.use(keyFor({
      mode: state.mode, filters: state.filters, sort: state.sort, pageSize: state.pageSize
    }))) {
      if (holding) fire('cache:invalidated', { rows: holding });
      shownPage = null;                    // a new question is travelled forward
    }

    /* The direction of travel, for the scheduler: the sign of the last page movement, and
       forward for a jump or a new question. Derived from the movement rather than recorded
       by each action, because five actions change the page and one of them forgetting
       would show only as the cache being mysteriously slow backwards. */
    travel = (shownPage != null && Math.abs(state.page - shownPage) === 1)
      ? Math.sign(state.page - shownPage) : 1;

    const pinned = state.pageMembers.get(state.page);
    const pinnedIds = page.pinnedIds(state.pageMembers);

    /**
     * Already held? Then render now.
     *
     * Nothing is awaited between here and the notify, so `state.loading` never becomes
     * true, no skeleton is drawn and `computeLayout` is not held off — which is the
     * difference between a cache and a faster spinner.
     *
     * A pinned page is served from the row index by id and a cached page from the page
     * index, and the two are disjoint by construction: this branch asks in that order,
     * exactly as the fetch below does, so a committed page is never answered by the
     * question's page 7 and vice versa. `serve` suppresses the pinned ids as it goes,
     * because the exclusion set grows on every commit and is deliberately not in the key.
     *
     * It still takes a sequencing token. A slower visible query already in flight must
     * not land on top of the page the reviewer is now looking at.
     */
    const held = pinned ? cache.rowsFor(pinned) : cache.serve(state.page, pinnedIds);
    if (held) {
      reqSeq++;
      fire(pinned ? 'cache:pinned' : 'cache:hit', { page: state.page, rows: held.length });
      showRows(held);
      settled();
      return;
    }

    /* Requests can overlap — a page change during a page-size change, say — and the
       slower one must not win. Only the newest response is allowed to land. */
    const token = ++reqSeq;
    state.loading = true; notify();

    let res;

    if (pinned) {
      /* A committed page keeps its membership, so returning shows what was submitted. */
      fire('query:pinned', { page: state.page, count: pinned.length });
      const rows = await MarpData.byIds(pinned);
      if (token !== reqSeq) return;
      res = { rows, total: state.total, pageCount: state.pageCount, page: state.page };
    } else {
      const query = filters.queryFilters(state.mode, state.filters,
        { excludeIds: pinnedIds });
      fire('query', { page: state.page, sort: state.sort });
      res = await MarpData.query({
        filters: query, sort: state.sort, page: state.page, pageSize: state.pageSize
      });
      if (token !== reqSeq) return;

      /**
       * The status counts, and the two defects this line used to carry.
       *
       * The assignment was **before** the token check, so a superseded response wrote
       * into state and only then bailed. Nothing redrew at that instant, which is why it
       * survived; the next `notify()` drew it. The value is read after the guard now, and
       * a superseded response writes nothing at all — it does not even ask.
       *
       * And it ran on **every** refresh, the pinned branch included, which against a real
       * API is a second full pass over the matching set on every page turn. A pinned page
       * and a cached page are not running the filter, so they have nothing new to say
       * about the counts — exactly as they already have nothing new to say about the
       * total, the page count or `excludedForNoDate`. `commitPage` refreshes them itself
       * after the one action that actually moves them.
       */
      const counts = await MarpData.counts({ filters: countFilters() });
      if (token !== reqSeq) return;
      state.counts = counts;
    }

    /* Marks are the page's exception set, so rows that already carry this mode's
       exception arrive marked. Without this, committing a page that held existing
       flags cleared them — the commit accepts everything unmarked. */
    showRows(res.rows);
    if (!pinned) { state.total = res.total; state.pageCount = res.pageCount; }

    /* How many observations the date filter had to exclude for having no date. The whole
       point of R5 is that the reviewer is told -- `data.js` counted it and `ui/rail.js`
       drew it, but nothing carried it between them, so the note was always hidden. A
       filter that silently omits is worse than no filter, and it looked correct at every
       tier that cannot see the screen. A pinned page keeps the last count: it is not
       running the filter, so it has nothing new to say about it. */
    if (!pinned) state.excludedForNoDate = res.excludedForNoDate || 0;

    /* An address can name a page the question no longer reaches -- a link to page seven
       of a filter that has since been reviewed down to three. Land on the last real page
       rather than on an empty grid that looks like the filter matched nothing. */
    if (!pinned && state.pageCount >= 1 && state.page > state.pageCount) {
      state.page = state.pageCount;
      return actions.refresh();
    }

    /* **The visible page goes into the cache too**, and it has to: without it the
       scheduler sees the one page it can be certain of as missing and chases it, and
       going back one page would be a fetch. It is put after the clamp, so a page the
       question no longer reaches is never cached as an empty answer. A pinned page is
       not put — it is not an answer to the question, and the two indexes are disjoint. */
    if (!pinned) cache.put(state.page, res.rows);

    settled();
  },

  /**
   * Fetch ahead — but only once the visible page has settled, and then only when the
   * browser is idle.
   *
   * The grid re-renders in full on every notify and `computeLayout` returns early while
   * loading, so a response landing mid-layout would notify again and re-render on top of
   * the layout pass the reviewer is waiting for. So the prefetcher yields: 250 ms, and
   * then the first idle moment the browser will give us. `requestIdleCallback` is
   * platform, so nothing is added to use it, and the timer is the fallback where it is
   * missing — with a timeout on the idle call so a busy tab cannot starve it forever.
   */
  _schedulePrefetch() {
    cancelPrefetchWait();
    if (!state.ready) return;
    prefetchWait = setTimeout(() => {
      prefetchWait = null;
      if (typeof window !== 'undefined' && window.requestIdleCallback) {
        idleWait = window.requestIdleCallback(
          () => { idleWait = null; actions._prefetch(); }, { timeout: PREFETCH_IDLE * 4 });
      } else actions._prefetch();
    }, PREFETCH_IDLE);
  },

  /**
   * One page-set request for the pages worth holding, and one sweep of what is not.
   *
   * **At most one in flight.** One request carrying twelve pages is strictly better than
   * twelve requests — under the contract each request pays its own pass over the matching
   * set — and one already in flight when the reviewer jumps is allowed to land: the rows
   * answer the same question and may be exactly where they go next. Cancelling would save
   * the client some bytes and the server nothing. It is never waited on.
   *
   * **It takes no sequencing token**, deliberately. The cache key is what says whether
   * these rows are still an answer to the question being asked, and a token would let a
   * prefetch land on the visible page.
   */
  async _prefetch() {
    if (prefetchBusy || state.loading || !state.ready) return;

    const pinnedIds = page.pinnedIds(state.pageMembers);
    const schedule = plan({
      page: state.page, pageCount: state.pageCount, direction: travel,
      held: cache.held(), pinnedIds
    });

    /* Eviction happens here rather than at put time because this is the one place that
       knows where the reviewer is, and distance from that is the rule. The pinned ids are
       absolute: a row a committed page needs is never given up, at any distance. */
    if (schedule.evict.length) {
      cache.evict(schedule.evict, pinnedIds);
      fire('cache:evicted', { pages: schedule.evict, rows: cache.rowCount() });
    }

    /* `fetch` is priority-ordered, so truncating it to the request cap keeps the pages
       nearest the reviewer. The row cap binds first on a wide desktop, where a page is
       far more than fifty tiles. */
    const cap = Math.min(MAX_PAGES, Math.floor(MAX_ROWS / Math.max(1, state.pageSize)));
    const wanted = schedule.fetch.slice(0, Math.max(0, cap));
    if (!wanted.length) return;

    const asked = cache.key;
    prefetchBusy = true;
    fire('prefetch', { pages: wanted, direction: travel });
    try {
      const res = await MarpData.queryPages({
        filters: filters.queryFilters(state.mode, state.filters, { excludeIds: pinnedIds }),
        sort: state.sort, pageSize: state.pageSize, pages: wanted, exclude: pinnedIds
        /* `includeTotal` is deliberately absent. A prefetch never asks for a count: the
           total is one per question, and asking again is a second pass for a number the
           client already has. */
      });

      /* The question may have changed while this was in flight. These rows answer the old
         one, and the cache holds one question at a time. */
      if (cache.key !== asked) { fire('prefetch:stale', { pages: wanted }); return; }

      const cached = [];
      for (const answer of res.pages) {
        /* An empty answer for a page inside the count means the question moved under the
           request; caching it would serve an empty page as a hit, and a hole and an empty
           result look identical on screen while meaning opposite things. */
        if (!answer.rows.length) continue;
        cache.put(answer.page, answer.rows);
        cached.push(answer.page);
      }
      /* No `notify()`: none of these pages is on screen. */
      fire('prefetch:cached', { pages: cached, rows: cache.rowCount() });
    } catch (err) {
      /* Speculative work, so a failure is a line in the log and nothing else — the page
         the reviewer is on was drawn before this started. */
      fire('prefetch:failed', {
        pages: wanted, message: String(err && err.message || err)
      });
    } finally {
      prefetchBusy = false;
    }
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

    /* Park this mode's session work before the next one takes the fields.
       Outcomes, committed pages and pins belong to the mode that made them — left
       standing, a scientific commit painted REVIEWED badges across Training and Delete,
       two independent decisions wearing each other's answer. They used to be cleared for
       that reason, which also discarded the reviewer's session: three pages reviewed, one
       glance at Training, and no way back to what had been submitted. Parking keeps both
       properties. */
    park(state.mode);
    state.mode = mode;
    resume(mode);

    /* Marks and take-backs do not travel. An uncommitted mark is a pending intention in
       one workflow, and the reviewer walked away from it. */
    state.marks.clear();
    state.picker = null;
    state.page = 1;
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

    /**
     * A correction retires every cached page. Not a commit, and not the same rule.
     *
     * A commit invalidates nothing, because a committed page is *pinned* and the ids it
     * holds are excluded from every later query — the membership is deliberately frozen
     * and the arithmetic stays honest. A species correction pins nothing: it moves the
     * row's own value out from under the species filter, so the row genuinely leaves the
     * result and every page after it shifts by one. #68 requires the corrected row to
     * leave a species-filtered page on the next query, and a cached page would go on
     * showing it.
     *
     * The pages go; **the rows a committed page needs stay**, exactly as under eviction,
     * so going back to what was submitted is still free. The cost is one page change at
     * full latency after a correction, which is what every page change cost before #99.
     *
     * Dropping only the visible page was the other candidate and is rejected: page N+1
     * was cached when this row was still in the set, so it would start with the row that
     * has just moved onto page N, and the reviewer would meet the same observation twice.
     * A duplicate tile is worse than a wait.
     */
    cache.evict(cache.held().map((entry) => entry.page), page.pinnedIds(state.pageMembers));

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
    /* Marking the page *is* a decision on every row of it, so every row is hand-decided
       now and must not be re-seeded behind the reviewer. Clear is what undoes it. */
    state.rows.forEach((r) => state.touched.add(r.observation_id));
    fire('markAllOnPage', { count: state.rows.length, scope: 'page' });
    notify();
  },

  /**
   * Put this page back the way it arrived.
   *
   * Clearing used to empty the marks outright and add every row on the page to `touched`,
   * which is never re-seeded. So one press of Clear silently staged the reversal of every
   * exception the record already carried on that page: they lost their mark, began reading
   * as TAKING BACK, and the next commit would have promoted or accepted them. Reported
   * 2026-09-08 as exclusions tagging themselves taking back without being clicked.
   *
   * "Reset this page" is the meaning worth having. It undoes the reviewer's own marks *and*
   * their own take-backs, then lets the record's exceptions seed again — so the page looks
   * exactly as it did on arrival, and TAKING BACK appears only where somebody clicked an
   * individual tile, which is the rule the user stated.
   */
  clearMarks() {
    /* What is being cleared *here*. `marks` spans the session, so its size is not the
       page's count -- see `markedOnPage`. */
    const n = markedOnPage({ rows: state.rows, marks: state.marks });
    const ids = state.rows.map((r) => r.observation_id);

    for (const id of ids) { state.marks.delete(id); state.touched.delete(id); }
    state.marks = new Map(state.marks);          // a new Map, so subscribers see the change
    state.picker = null;

    /* Seed straight away rather than waiting for a query: this page is already loaded, and
       a re-query would be a different page under a filter that has not changed. */
    const exception = pendingException(state.mode);
    if (exception) {
      state.marks = page.seedMarks(state.marks, state.touched, state.rows,
        (row) => existingState(state.mode, row) === exception);
    }
    fire('clearMarks', { count: n });
    notify();
  },

  /**
   * Ask for a thumbnail again.
   *
   * The reviewer can do this per tile; `retryFailedThumbnails` does the whole page, which
   * is the case that motivated it -- a page where every thumbnail failed is the one you
   * actually want a single button for.
   */
  async retryThumbnail(id) {
    const row = state.rows.find((r) => r.observation_id === id);
    if (!row || row.thumbnail_status === 'ready') return;
    row.thumbnail_status = 'queued';
    notify();
    const status = await MarpData.retryThumbnail(id);
    /* The row may have gone -- a filter change, a new page -- while this was in flight. */
    const still = state.rows.find((r) => r.observation_id === id);
    if (!still) return;
    still.thumbnail_status = status || 'failed';
    fire('thumbnail:retried', { id, status: still.thumbnail_status });
    notify();
  },

  /**
   * Retry every failed thumbnail on the page, in two paints rather than two per tile.
   *
   * This used to call `retryThumbnail` once per row, and each of those notifies twice — so
   * a page of fifty cost **a hundred full re-renders**, each rebuilding all fifty tiles.
   * Measured at 972 ms on an idle machine, and enough under parallel test workers to blow
   * a twenty-second timeout, which is what made two browser tests flaky.
   *
   * Rendering here is a full re-render from state by design, and that is worth keeping —
   * so the fix is to stop asking for a hundred of them, not to make rendering incremental.
   * One paint to show the page queued, one when the answers are in.
   */
  async retryFailedThumbnails() {
    const failed = state.rows.filter((r) => r.thumbnail_status === 'failed');
    if (!failed.length) return;
    fire('thumbnail:retry-page', { count: failed.length });

    for (const row of failed) row.thumbnail_status = 'queued';
    notify();

    const settled = await Promise.all(failed.map(async (r) => [
      r.observation_id, await MarpData.retryThumbnail(r.observation_id)
    ]));

    for (const [id, status] of settled) {
      /* The row may have gone -- a filter change, a new page -- while this was in flight. */
      const still = state.rows.find((r) => r.observation_id === id);
      if (!still) continue;
      still.thumbnail_status = status || 'failed';
      fire('thumbnail:retried', { id, status: still.thumbnail_status });
    }
    notify();
  },

  /**
   * Commit the page.
   *
   * In Delete Mode this stops the first time and asks, every time -- deletion is
   * permanent and there is nothing to restore from, so the friction is the point.
   * `confirmed` is passed only by `confirmDelete`, never by the button.
   */
  /** Yes: go ahead and destroy them. The only caller that may pass `confirmed`. */
  confirmDelete() {
    if (!state.confirm) return;
    return actions.commitPage(true);
  },

  /** No. Nothing is sent, and every mark is left exactly as it was. */
  cancelDelete() {
    if (!state.confirm) return;
    fire('delete:cancelled', state.confirm);
    state.confirm = null;
    notify();
  },

  async commitPage(confirmed = false) {
    if (state.commit.busy) return;                 // one commit at a time

    if (commitIsDestructive(state.mode) && !confirmed) {
      const impact = deleteImpact({ rows: state.rows, marks: state.marks });
      /* Nothing marked is not a deletion, so it is not worth a dialog. Asking somebody
         to confirm destroying zero records teaches them to dismiss the dialog without
         reading it, which is exactly what the breakdown above exists to prevent. */
      if (impact.count === 0) return;
      state.confirm = impact;
      fire('delete:confirm-requested', impact);
      notify();
      return;
    }
    state.confirm = null;

    const ids = state.rows.map((r) => r.observation_id);
    const marks = new Map(state.marks);
    /* Which mode and page this commit belongs to, read once. Everything after the await
       is checked against these rather than against whatever `state` says by then. */
    const startedIn = state.mode;
    const startedPage = state.page;
    fire('commitPage:request', {
      mode: startedIn, page: startedPage,
      willAct: commitCount({ mode: startedIn, rows: state.rows, marks })
    });

    state.commit = { busy: true, status: null };
    notify();

    let res;
    try {
      res = await MarpData.commitPage({ mode: startedIn, observationIds: ids, marks });
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

    /**
     * The mode may have moved on while this was in flight.
     *
     * Outcomes, committed pages and pins all belong to the mode that committed, and
     * `setMode` clears them for exactly that reason. Writing them here unconditionally
     * meant a commit landing after a mode switch put them straight back — a whole page of
     * scientific FLAGGED and REVIEWED badges displayed in Training Data Review, which is
     * the defect `setMode` exists to prevent, coming back through a door the fix did not
     * cover.
     *
     * The commit itself already happened and the record is written; what is dropped here is
     * only this mode's *display* of it, and the next query reads the record back. Every
     * query in this file is guarded the same way, with a token; the commit path never was.
     */
    if (state.mode !== startedIn) {
      fire('commitPage:discarded', { startedIn, now: state.mode, page: startedPage });
      notify();
      return;
    }

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

  /**
   * Back to the mode's own defaults.
   *
   * The way out of an empty result, and the only thing the empty state offers -- the rail
   * has five dimensions and working out which one emptied it is not the reviewer's job.
   */
  clearFilters() {
    const base = { ...filters.DEFAULT_FILTERS };
    state.filters = filters.defaultStatusFor(state.mode, base);
    /* One helper rather than the same six lines again. Written out inline here, it missed
       the parked per-mode work when that was added -- which is exactly the drift the
       helper exists to prevent. */
    resetForNewQuery();
    fire('clearFilters', {});
    notify();
    /* `actions.refresh`, not a bare `refresh` -- these are object methods, not closures,
       and the bare call threw ReferenceError where nothing caught it, so the button
       looked inert. */
    return actions.refresh();
  },

  /**
   * Add or remove one value of a set dimension.
   *
   * The reachable map comes from the data layer, so removing a project keeps the dives
   * that still apply instead of clearing them all -- only `data.js` knows which dives
   * belong to which project.
   */
  toggleDimension(key, value) {
    const toggled = filters.toggleValue(state.filters, key, value);
    state.filters = filters.applyFilter(
      toggled, key, toggled[key], MarpData.reachableUnder(toggled));
    resetForNewQuery();
    fire('toggleDimension', { key, value });
    notify();
    return actions.refresh();
  },

  /** Stop filtering on a dimension. Empty means "not filtering", never "match nothing". */
  clearDimension(key) {
    const cleared = { ...state.filters, [key]: dimensions.emptyValue(dimensions.DIMENSION[key]) };
    state.filters = filters.applyFilter(
      cleared, key, cleared[key], MarpData.reachableUnder(cleared));
    resetForNewQuery();
    fire('clearDimension', { key });
    notify();
    return actions.refresh();
  },

  /** Set both ends of a range or a time window. Either end may be null. */
  setSpan(key, from, to) {
    state.filters = { ...state.filters, [key]: (from == null && to == null) ? null : { from, to } };
    resetForNewQuery();
    fire('setSpan', { key, from, to });
    notify();
    return actions.refresh();
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
    state.sort = filters.withSort(state.sort, field, dir);
    reorder();
    fire('setSort', state.sort);
    actions.refresh();
  },

  /**
   * The secondary term, applied where the primary ties. A null field clears it.
   *
   * Its own action rather than an argument to `setSort`, because choosing what to break a
   * tie with is its own gesture and every gesture here is a seam that becomes a call.
   */
  setSortThen(field, dir) {
    state.sort = filters.withSortThen(state.sort, field, dir);
    reorder();
    fire('setSortThen', state.sort.then);
    actions.refresh();
  },

  openVideo(id) { fire('openVideo', { id }); }   // deliberately unimplemented
};
