/**
 * State, and the named actions that change it.
 *
 * Thin on purpose: the rules live in `model/`, the data in `api/`. This file holds
 * what is currently true, and orchestrates the two. Every user gesture goes through
 * a named action, which is the seam an API call will eventually sit behind.
 */
/* The seam, not the fixture. `src/backend.js` is what decides which backing is behind
   it, and the application never points that at the fixture -- A2. */
import { MarpBackend } from './backend.js';
import { isAbort, failureKind } from './api/errors.js';
import { MODES, isMode, commitCount, commitActsOnMarked, pendingException, acceptedValue, acceptRefusal, selectedRows, takenBackRows, takesBack, selectionOutcome, existingState, commitIsDestructive, deleteImpact, commitOutcome, pageState, markedOnPage, retryablePage, MARK_EXCEPT, MARK_ACCEPT } from './model/modes.js';
import * as page from './model/page.js';
import * as filters from './model/filters.js';
import * as dimensions from './model/dimensions.js';
import { currentSpeciesName } from './model/row.js';
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

/**
 * The in-flight work, so a superseded request is **cancelled** rather than ignored (A16,
 * R21).
 *
 * The sequencing token below already stops a late response landing on screen, and that is
 * a correctness guard rather than a cost one. Against a real endpoint every abandoned
 * request is a full pass over the matching set that nobody will ever read, and #99's
 * prefetcher issues up to three of them per navigation — so the token is kept *and* the
 * work is aborted.
 *
 * Two controllers rather than one: the visible page and the prefetch are superseded by
 * different things. A page change supersedes the visible request immediately, where a
 * prefetch already in flight is allowed to land because its rows answer the same question
 * and may be exactly where the reviewer is going next. Only a new *question* aborts that.
 */
let visibleAbort = null;
let prefetchAbort = null;
let pollAbort = null;

/** Start a new controller for one slot, cancelling whatever it held. */
function supersede(current) {
  if (current) current.abort();
  return typeof AbortController === 'function' ? new AbortController() : null;
}

/** The signal to hand the seam, or undefined where the platform has no AbortController. */
const signalOf = (controller) => (controller ? controller.signal : undefined);

export const state = {
  mode: 'scientific',
  /**
   * The signed-in reviewer, from the server (R19). Null until `init` has asked.
   *
   * Nothing in this application holds a name any more: `src/data.js:13` and
   * `src/ui/dom.js:24` both carried the literal `'I. Travers'`, so "by you" was true for
   * one person on one machine and quietly false for everybody else (F8).
   */
  me: null,
  /**
   * What each rail dimension can still offer, from the server (R15, A6).
   *
   * One call per question, held here — so `ui/menus.js` and `ui/rail.js` read it
   * synchronously exactly as they read everything else. That is F12 answered rather than
   * worked around: `MarpData.optionsFor` was called synchronously from a render path and
   * scanned the whole fixture, and making it async would have been a leak above `api/`.
   */
  facets: {},
  /**
   * Why the last call failed, or null. **Three distinct states, never one** (A4, R20).
   *
   * `kind` is `expired` (the cookie lapsed — re-authenticate, in place, so the marks
   * survive), `refused` (the account lacks the permission — retrying is cruel, so the
   * permission is named), `failed` (a dropped socket or a 5xx — try again) or `request`
   * (a defect in this client). None of them discards a mark.
   */
  failure: null,
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

  marks: new Map(),        // what the reviewer marked: id -> { kind, reason }
  touched: new Set(),      // what the reviewer decided by hand; never re-seeded
  /**
   * What the reviewer has taken back and not yet committed (#135).
   *
   * **Recorded, not derived.** A tile that is unmarked, touched and carries an acceptance
   * is either a promotion whose mark has just been removed or a tile a sweep accepted
   * after a flag came off, and nothing in the marks, the touches or the outcomes tells
   * those apart -- so deriving it made the second read as a take-back for the rest of the
   * sitting. `takesBack()` is the rule for what goes in here; a commit and a new mark are
   * what take an id out.
   */
  takenBack: new Set(),
  changed: new Map(),      // id -> { from, to } for this session
  outcomes: new Map(),     // id -> what the last commit did
  /**
   * Ids the last commit refused because the row had moved underneath the page (R9).
   *
   * Their marks are kept and nothing was written, so the reviewer's intention is still
   * pending. The page-level prompt to re-read reads this.
   */
  conflicted: [],
  committedPages: new Set(),
  pageMembers: new Map(),  // page -> the ids it was committed with
  /**
   * The rows a committed page held, by id. **R14, and the reason it is here rather than
   * in the page cache.**
   *
   * The design asked for a by-ids route; the human struck it because the capability
   * already existed — `model/cache.js:163` serves a committed page from the cache with no
   * request. That is true, and it is not enough on its own: `cache.use()` **empties the
   * cache whenever the question changes**, and `pageSize` is part of the question. So a
   * layout settle after a commit — which is routine, since the grid re-measures once the
   * field stops moving — threw away the rows the pin needed, and before this phase
   * `byIds` was what fetched them back.
   *
   * Holding them here needs no endpoint and is strictly more faithful than the cache:
   * these are the very objects the reviewer was looking at when they committed, so
   * "returning to a page shows what was submitted" is exact rather than approximate. The
   * cache is still asked first for an ordinary page; this is only for a pinned one.
   */
  pinnedRows: new Map(),   // observation_id -> the row as it was committed
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
  /* Which button ran, so the acknowledgement lands on that one alone (#131). The
     status was one field serving two controls, so committing only the marked tiles
     also turned the page sweep green -- the page looked accepted when it was not. */
  commit: { busy: false, status: null, which: null },  // status: null | 'ok' | 'failed'
                                                      // which:  null | 'sweep' | 'marked'
  /* What a destructive commit is waiting to be told to do: null, or the impact the
     reviewer is being asked to accept. Held in the store rather than the dialog so the
     rule about what is destroyed and the thing that destroys it cannot drift apart. */
  confirm: null,           // null | { count, reviewed, promoted }
  /**
   * The accept mark that was just refused, and why (#126 A4).
   *
   * Accepting needs imagery and flagging does not, so an accept mark on a tile with no
   * picture is turned away **at click time with the tile saying why**, rather than taken
   * and quietly dropped at commit. The skip count explains a sweep, where the reviewer
   * never singled the tile out; it does not explain a deliberate click.
   *
   * It is an acknowledgement rather than a state, so it fades the way the commit tick
   * does. One at a time: a second refusal replaces the first.
   */
  refused: null            // null | { id, reason }
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
    state.commit = { ...state.commit, status: null, which: null };
    notify();
  }, after);
}

/* A refusal fades the same way, and for the same reason: it acknowledges a gesture that
   did not take, rather than describing a state the tile is now in. */
let refusalTimer = null;
function clearRefusal(after = 2600) {
  clearTimeout(refusalTimer);
  refusalTimer = setTimeout(() => {
    state.refused = null;
    notify();
  }, after);
}

const countFilters = () => ({
  species: state.filters.species, project: state.filters.project, dive: state.filters.dive
});

/**
 * Record why something failed, or say nothing because the reviewer superseded it.
 *
 * **An abort is not a failure** (A16). An aborted `fetch` rejects, so without this a page
 * change would report a transport error — which is exactly the confusion A4 exists to
 * remove, arriving through the fix for something else.
 *
 * Returns true when it was a real failure, so a caller can stop.
 */
function recordFailure(err, where) {
  if (isAbort(err)) { fire(`${where}:aborted`); return false; }
  state.failure = {
    kind: failureKind(err),
    message: String((err && err.message) || err),
    permission: (err && err.permission) || null
  };
  fire(`${where}:failed`, state.failure);
  return true;
}

/** A call succeeded, so whatever the last one said is no longer true. */
function clearFailure() {
  if (state.failure) state.failure = null;
}

/**
 * Which annotation list an observation may be corrected against (A11, F15; #130 A1).
 *
 * **The row says so, because the server resolved it.** This used to look the observation's
 * own `species_id` up in `state.facets.species`, and it was **always null against the
 * API** — the row has never carried `species_id`, so the lookup could not miss, and the
 * picker's search was refused before a request was sent (#130).
 *
 * The replacement is not the copy of `db/species-lists.js` that A11 rejected. A11's
 * objection stands and is satisfied rather than contradicted: **the client is not doing
 * the mapping**, the server is, and it sends the answer as `species_list`.
 *
 * The list is the **session's**, not the current species'. That is the part worth keeping:
 * scoping the picker by whatever the observation is classified as *now* means an
 * observation corrected onto the wrong list only ever offers candidates from that wrong
 * list, and the mistake can never be corrected back through the tool. The session type is
 * the invariant.
 *
 * Null where the session type names no list — `Other` genuinely does not say which was in
 * use — and that is exactly the case the "search all lists" action exists for.
 */
function speciesListFor(row) {
  return (row && row.species_list) || null;
}

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
 * The queued-thumbnail poll (A8, R12).
 *
 * `POLL_START` is the first wait and it doubles up to `POLL_MAX`, for at most
 * `POLL_ROUNDS` rounds. The numbers are named here rather than inlined because the spec
 * asks for them to be testable, and because each one is a judgement:
 *
 * - **1.5 s first** — extraction runs at three concurrent Jellyfin streams (#118's A7), so
 *   nothing useful has happened sooner than that and an earlier ask is a wasted pass over
 *   the matching set;
 * - **doubling to 12 s** — a page of 45 missing pictures takes tens of seconds, and a
 *   fixed interval either hammers the server early or crawls late;
 * - **8 rounds, then stop and say so** — roughly a minute and a half. Polling for ever
 *   against a stuck queue is a request every few seconds for the life of the tab, and the
 *   reviewer is better told "still preparing" than left watching a spinner that will never
 *   resolve.
 */
const POLL_START = 1500;
const POLL_MAX = 12000;
const POLL_ROUNDS = 8;

let pollWait = null;
let pollRound = 0;

/** Stop polling. A page change, a new question or a mode switch all mean this. */
function cancelPoll() {
  clearTimeout(pollWait);
  pollWait = null;
  if (pollAbort) { pollAbort.abort(); pollAbort = null; }
}

/** The next wait, doubling from `POLL_START` and capped. */
const pollDelay = () => Math.min(POLL_MAX, POLL_START * (2 ** pollRound));

/**
 * One round: re-read the visible page, fold the statuses in, notify **once**.
 *
 * Only `thumbnail_status` is taken from the answer. That is deliberate: the reviewer may
 * have marked, corrected or committed since the page was drawn, and replacing the rows
 * would throw that away — the poll is about pictures arriving, not about re-reading the
 * record.
 */
async function pollRoundOnce() {
  const forPage = state.page;
  const asked = cache.key;
  pollAbort = supersede(pollAbort);

  let res;
  try {
    res = await MarpBackend.query({
      filters: filters.queryFilters(state.mode, state.filters,
        { excludeIds: filters.excludeIdList(page.pinnedIds(state.pageMembers)) }),
      sort: state.sort, page: forPage, pageSize: state.pageSize,
      exclude: filters.excludeIdList(page.pinnedIds(state.pageMembers)),
      signal: signalOf(pollAbort)
    });
  } catch (err) {
    if (isAbort(err)) return;
    /* Speculative work, so a failure is a line in the log: the page the reviewer is on
       was drawn before this started and nothing about it is worse for the failure. */
    fire('thumbnail:poll-failed', { message: String((err && err.message) || err) });
    return;
  }

  /* The reviewer moved while this was in flight. */
  if (forPage !== state.page || cache.key !== asked) return;

  const byId = new Map(res.rows.map((r) => [r.observation_id, r]));
  let moved = 0;
  for (const row of state.rows) {
    const fresh = byId.get(row.observation_id);
    if (!fresh || fresh.thumbnail_status === row.thumbnail_status) continue;
    row.thumbnail_status = fresh.thumbnail_status;
    moved++;
  }

  const stillQueued = state.rows.filter((r) => r.thumbnail_status === 'queued').length;
  fire('thumbnail:polled', { round: pollRound + 1, moved, queued: stillQueued });

  /**
   * **One notify per round.** Not one per row, which is what `retryFailedThumbnails` used
   * to cost — a hundred full re-renders for one button press — and not one per *change*
   * either.
   *
   * "Only when something moved" was the first version and it is wrong against the fixture
   * for a reason worth knowing: at scale 1 the fixture serves the row object itself, so the
   * simulated extractor writes `thumbnail_status` on the very row the store is holding.
   * The poll then sees nothing to move, skips the notify, and the screen never redraws a
   * picture that has in fact arrived. One notify per round is what R12 asks for and it is
   * correct in both backings.
   */
  notify();

  if (!stillQueued) return;
  pollRound++;
  if (pollRound >= POLL_ROUNDS) {
    fire('thumbnail:poll-gave-up', { queued: stillQueued, rounds: pollRound });
    return;
  }
  schedulePoll();
}

/** Wait, then take one round. */
function schedulePoll() {
  clearTimeout(pollWait);
  pollWait = setTimeout(() => { pollWait = null; pollRoundOnce(); }, pollDelay());
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
  state.pinnedRows = new Map();
  /* Every mode's pinned pages were pinned under the old order, so page 2 is not the same
     page 2 any more. Parking them would restore pins that describe a result that is gone. */
  state.parked = new Map();
}

/**
 * Has this sitting's commit destroyed this observation? (#138)
 *
 * One question in one place, because the refusal has five callers and a condition copied
 * five times is a condition that will be right in four of them.
 */
const destroyed = (id) => page.isDestroyed(state.outcomes, id);

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
  state.takenBack = new Set();
  state.outcomes = new Map();
  /* A refused commit belonged to the page that was on screen, and this is a different
     question -- so the prompt to re-read has nothing left to re-read. */
  state.conflicted = [];
  state.pageMembers = page.clearPins();
  state.committedPages.clear();
  state.pinnedRows = new Map();
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
    outcomes: state.outcomes,
    /* Parked with the pins, because they are the pins' rows. Left shared, a page
       committed in Training would be served Scientific's copy of the same ids. */
    pinnedRows: state.pinnedRows
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
  state.pinnedRows = held ? held.pinnedRows : new Map();
}

/**
 * Remember, or forget, that this tile is taking a decision back (#135).
 *
 * Called by both mark gestures with the kind that has just come **off**, or null when one
 * has just gone on. A mark going on ends any take-back: the reviewer has said something
 * newer, and leaving the id in would send a withdrawal for a tile that is marked.
 *
 * `takesBack()` is what decides, and it is narrower than "a mark came off": the kind that
 * came off has to match what the record says, or taking a flag off a tile the sweep has
 * already accepted would read as withdrawing that acceptance.
 *
 * @param {number} id - The observation.
 * @param {string|null} removed - The kind removed, or null when a mark was added.
 * @returns {void}
 */
function recordTakeBack(id, removed) {
  if (!removed) { state.takenBack.delete(id); return; }
  const row = state.rows.find((r) => r.observation_id === id);
  const decided = state.outcomes.has(id)
    ? state.outcomes.get(id)
    : (row ? existingState(state.mode, row) : null);
  if (takesBack({ mode: state.mode, kind: removed, decided })) state.takenBack.add(id);
  else state.takenBack.delete(id);
}

/**
 * Send a commit and fold the answer back in. Shared by both buttons (#126).
 *
 * One function rather than two, because everything that made `commitPage` correct is
 * subtle and was learned the hard way -- the mode and page read once before the `await`,
 * the discard when the mode moved on, the version bump that stops the next commit seeing
 * phantom conflicts, the marks left alone on failure. A second copy would drift away from
 * all of it, one fix at a time.
 *
 * Two things differ, and they are the feature:
 *
 * - **what is sent.** The sweep sends the page; the main button sends only the rows the
 *   reviewer marked **by hand in this sitting** (`selectedRows`). The commit contract needs
 *   no new field for that: `observations` is the set the commit is about, so a request
 *   naming only the marked rows accepts nothing it was not told about, and `marks` carrying
 *   the kind says what each of them becomes (A5).
 * - **what it claims afterwards.** A sweep finishes a page, so the page is pinned and
 *   marked committed -- which also excludes its ids from later queries. A selective commit
 *   finishes nothing: pinning there would quietly remove every untouched observation on the
 *   page from the reviewer's remaining work, which is exactly the "without it affecting
 *   anything else" this feature exists to give them.
 *
 * @param {Object} options
 * @param {boolean} options.selective - True for the main button, false for the sweep.
 * @returns {Promise<void>}
 */
async function runCommit({ selective }) {
  /* What the reviewer marked by hand, **and** what they have taken back (#135 R3). Both
     go in `observations`, because the endpoint refuses a `withdraw` naming an id the
     request did not send -- and they are two different instructions about those rows, so
     they stay two lists all the way to the wire.

     **Both buttons, not only the selective one** (R7). This was `selective ? ... : []`, on
     the rule that the sweep accepts everything unmarked and a take-back was the main
     button's business alone -- so pressing the sweep after taking a promotion back
     promoted it straight again, and the reviewer's withdrawal was undone by the button
     next to the one that honours it. A take-back is an instruction about a tile, not a
     property of which button reads it: *"if you hit commit it again, it should be in the
     vanilla state for that mode"*, whichever commit that is. The sweep's own rule is
     untouched -- a merely unmarked tile is still accepted; only an explicit take-back is
     withdrawn, and `state.takenBack` is what tells those apart. */
  const takeBacks = takenBackRows({
    mode: state.mode, rows: state.rows, marks: state.marks,
    takenBack: state.takenBack, outcomes: state.outcomes
  });
  const pageRows = selective
    ? [...selectedRows({ rows: state.rows, marks: state.marks, touched: state.touched }),
      ...takeBacks]
    : state.rows;

  /* Nothing to send is not a commit. Both buttons are disabled in this state, so reaching
     here is the keyboard or the console rather than a click. */
  if (!pageRows.length) return;

  const ids = pageRows.map((r) => r.observation_id);
  /**
   * The **rows**, not the ids (A7, R7, F4).
   *
   * The commit routes require `observations: [{ observation_id, version }]` and refuse a
   * request that omits a version -- "a missing version is a 400, never an implicit
   * overwrite" -- and this passed neither. Sending the rows is what makes the version
   * travel with *the thing the reviewer looked at*.
   *
   * An `api/`-side cache of "the version I last served for each id" was the alternative
   * and it is rejected on reasoning rather than taste: a prefetch or a poll would
   * refresh that map to a version the reviewer never saw, so a stale decision would be
   * applied silently -- which is the exact failure the mandatory version prevents.
   *
   * A copy, because everything after the `await` is checked against what was sent rather
   * than against whatever `state.rows` has become by then.
   */
  const sent = pageRows.map((r) => ({ observation_id: r.observation_id, version: r.version }));
  /* Only the marks this request is about. `commitBody` drops one off the page anyway, but
     dropping it here too means the count the log reports is the count that was sent, which
     is what somebody reading the log is checking. */
  const onPage = new Set(ids);
  const marks = new Map([...state.marks].filter(([id]) => onPage.has(id)));
  /* Which mode and page this commit belongs to, read once. Everything after the await
     is checked against these rather than against whatever `state` says by then. */
  const startedIn = state.mode;
  const startedPage = state.page;
  const request = selective ? 'commitMarked' : 'commitPage';
  fire(request + ':request', {
    mode: startedIn, page: startedPage,
    willAct: selective
      ? selectionOutcome({
        mode: startedIn, rows: state.rows, marks: state.marks, touched: state.touched,
        takenBack: state.takenBack, outcomes: state.outcomes
      }).acts
      : commitCount({ mode: startedIn, rows: state.rows, marks })
  });

  state.commit = { busy: true, status: null, which: selective ? 'marked' : 'sweep' };
  notify();

  let res;
  try {
    res = await MarpBackend.commitPage({
      mode: startedIn, rows: sent, marks, withdraw: takeBacks.map((r) => r.observation_id)
    });
  } catch (err) {
    /* Nothing is applied. The marks are untouched, so the reviewer can try again
       without redoing the page -- and that holds for all three of A4's failures, which
       is R20: none of them may silently discard the reviewer's work. */
    state.commit = { busy: false, status: 'failed', which: selective ? 'marked' : 'sweep' };
    recordFailure(err, request);
    clearCommitStatus();
    notify();
    return;
  }
  clearFailure();

  state.commit = { busy: false, status: 'ok', which: selective ? 'marked' : 'sweep' };
  clearCommitStatus();

  /**
   * The mode may have moved on while this was in flight.
   *
   * Outcomes, committed pages and pins all belong to the mode that committed, and
   * `setMode` clears them for exactly that reason. Writing them here unconditionally
   * meant a commit landing after a mode switch put them straight back -- a whole page of
   * scientific FLAGGED and REVIEWED badges displayed in Training Data Review, which is
   * the defect `setMode` exists to prevent, coming back through a door the fix did not
   * cover.
   *
   * The commit itself already happened and the record is written; what is dropped here is
   * only this mode's *display* of it, and the next query reads the record back.
   */
  if (state.mode !== startedIn) {
    fire(request + ':discarded', { startedIn, now: state.mode, page: startedPage });
    notify();
    return;
  }

  /**
   * A page counts as *committed* only when the whole page was committed.
   *
   * The pin is not decoration: `page.pinnedIds` becomes the query's `exclude` set, so
   * pinning here would take every untouched tile on the page out of the reviewer's
   * remaining work without saying so. A selective commit deliberately claims nothing about
   * the tiles it did not name, so it pins nothing and the pager still shows the page as
   * outstanding -- because it is.
   */
  if (!selective) {
    state.committedPages.add(state.page);
    state.pageMembers = page.pinPage(state.pageMembers, state.page, ids);
    /* And the rows themselves, so returning to this page needs nothing from the cache and
       nothing from the network. These are the objects the reviewer was looking at. */
    state.pinnedRows = page.pinRows(state.pinnedRows, state.rows);
  }
  /* Keyed by `observation_id`. This read `r.id`, which no entry of the result has ever
     carried, so one entry landed under `undefined` and **every tile on a committed page
     showed no outcome at all** (F5, R8). */
  state.outcomes = page.applyCommit(state.outcomes, res);
  state.lastCommit = res;

  /**
   * What the commit refused for a moved version (R9).
   *
   * Not a refusal for being second -- **the last commit wins**, and nothing here is ever
   * turned away for arriving after somebody else. `conflicted` fires only where the row
   * moved *underneath the page the reviewer was looking at*, which is the one case where
   * "last write wins" would mean silently discarding a correction the reviewer never
   * saw. Nothing was written for those ids, so their marks are kept and the page can be
   * re-read and committed again.
   */
  state.conflicted = page.conflictedIds(res);
  if (state.conflicted.length) {
    fire(request + ':conflicted', { ids: state.conflicted });
  }

  /**
   * **A commit does not move the observation's version, so nothing is bumped here**
   * (#135 R6).
   *
   * This used to add one to every row the commit gave an outcome, which was true of the
   * fixture and false of the endpoint: a decision is written to `observation_reviews` and
   * `observation_review_current`, and `observations.version` moves only on its own
   * `BEFORE UPDATE` trigger -- which a review commit never fires. So the *second* commit
   * of a tile in one sitting sent a version one ahead of the live row and came back
   * `conflicted` for a conflict that had not happened, which reads exactly like somebody
   * else editing under you. `src/data.js` no longer bumps either, so the two backings
   * agree about what a commit changes.
   */
  /* The marks stay wherever the record now agrees with them. A committed page is still
     editable -- clicking a flag takes it back -- and a mark has to keep meaning the same
     thing before and after a commit, or the same gesture reverses its meaning underneath
     the reviewer. The selective form rebuilds only what it sent, because everything else
     on the page is untouched and its marks are still pending. */
  /* A commit settles every take-back it carried: the withdrawal is on the record, so the
     intention is no longer pending. A `conflicted` id keeps its take-back for the same
     reason it keeps its mark -- nothing was written for it (R9). */
  for (const id of ids) {
    if (state.outcomes.get(id) === 'conflicted') continue;
    state.takenBack.delete(id);
  }
  const exception = pendingException(state.mode);
  const accepted = acceptedValue(state.mode);
  state.marks = selective
    ? page.marksAfterSelection(state.marks, state.outcomes, ids, exception, accepted)
    : page.marksAfterCommit(marks, state.outcomes, ids, exception, accepted);
  state.picker = null;

  fire(request + ':result', {
    reviewed: res.reviewed.length, flagged: (res.flagged || []).length,
    reverted: (res.reverted || []).length, skipped: res.skipped.length,
    conflicted: (res.conflicted || []).length
  });
  try {
    state.counts = await MarpBackend.counts({ filters: countFilters() });
  } catch (err) {
    /* The commit landed; only the counts beside it did not. Saying the commit failed
       here would be a lie about the record, and the next query corrects the numbers. */
    if (!isAbort(err)) fire('counts:failed', { message: String((err && err.message) || err) });
  }
  notify();                                   // the page stays loaded; no auto-advance
}

export const actions = {
  async init() {
    /* The seam answers with the identity as well as whatever it had to load. Against the
       API there is nothing to load *but* the identity, which is R19: the reviewer's name
       comes from the server and no literal remains in the application. */
    try {
      const loaded = await MarpBackend.load();
      state.me = (loaded && loaded.me) || null;
    } catch (err) {
      /* A 401 here is the ordinary unauthenticated case, and it must read as "sign in"
         rather than as a broken application. Everything below still runs, so the panel is
         drawn over a page that is otherwise ready to work. */
      recordFailure(err, 'init');
    }
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
    const newQuestion = cache.use(keyFor({
      mode: state.mode, filters: state.filters, sort: state.sort, pageSize: state.pageSize
    }));
    if (newQuestion) {
      if (holding) fire('cache:invalidated', { rows: holding });
      shownPage = null;                    // a new question is travelled forward
      /* A prefetch for the old question can never become this one's visible page, and
         against a real endpoint it is a full pass over a matching set nobody will read
         (A16). The token would have ignored it; this stops it costing anything. */
      prefetchAbort = supersede(prefetchAbort);
      prefetchAbort = null;
      /* The rail's option lists belong to the question, so they are asked once per
         question and not once per page. */
      actions._loadFacets();
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
    /**
      * A pinned page is served from the rows it was committed with; an ordinary page from
      * the page cache. Neither costs a request (R14).
      *
      * `state.pinnedRows` first and the cache second: the cache is emptied by any change
      * of question, and a page-size change *is* one — see the field's own comment.
      */
    const held = pinned
      ? (page.rowsFrom(state.pinnedRows, pinned) || cache.rowsFor(pinned))
      : cache.serve(state.page, pinnedIds);
    if (held) {
      reqSeq++;
      fire(pinned ? 'cache:pinned' : 'cache:hit', { page: state.page, rows: held.length });
      showRows(held);
      settled();
      return;
    }

    /**
     * A pinned page the cache cannot serve. **R14, and A5 struck.**
     *
     * The design wanted a by-ids route here; the human pointed out the capability already
     * exists — `model/cache.js:163` states the invariant, and `evict` never gives up a row
     * a pinned page needs — so a committed page is shown **without a request** and this
     * branch is the one case that cannot happen by construction.
     *
     * It is still handled rather than trusted. If it ever does happen the pin is dropped
     * and the ordinary query runs, so the reviewer sees the page the filter now matches
     * instead of an empty grid — and it fires a named action, because a pin quietly
     * disappearing is exactly the kind of thing that is invisible otherwise.
     */
    if (pinned) {
      fire('pin:unservable', { page: state.page, count: pinned.length });
      state.pageMembers.delete(state.page);
      state.committedPages.delete(state.page);
      return actions.refresh();
    }


    /* Requests can overlap — a page change during a page-size change, say — and the
       slower one must not win. Only the newest response is allowed to land. */
    const token = ++reqSeq;
    /* And the one it supersedes is cancelled rather than left running (A16, R21). */
    visibleAbort = supersede(visibleAbort);
    const signal = signalOf(visibleAbort);
    state.loading = true; notify();

    let res;

    /* The pinned ids as an **array of integers**. `page.pinnedIds` returns a Set because
       the cache and the scheduler ask it `.has()` questions, and `JSON.stringify` turns a
       Set into `{}` — so committed pages came back among the pages still to do, silently
       (F2). `queryFilters` converts, and the request builder converts and rejects again. */
    const exclude = filters.excludeIdList(pinnedIds);
    const query = filters.queryFilters(state.mode, state.filters, { excludeIds: exclude });
    fire('query', { page: state.page, sort: state.sort, exclude: exclude.length });

    try {
      res = await MarpBackend.query({
        filters: query, sort: state.sort, page: state.page, pageSize: state.pageSize,
        exclude, signal
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
      const counts = await MarpBackend.counts({ filters: countFilters(), signal });
      if (token !== reqSeq) return;
      state.counts = counts;
      clearFailure();
    } catch (err) {
      if (token !== reqSeq) return;
      /* **The marks are untouched**, whichever of the three failures this was (R20). The
         reviewer's page is still on screen and still theirs; only the new one is missing. */
      if (recordFailure(err, 'query')) { state.loading = false; notify(); }
      return;
    }

    /* Marks are the page's exception set, so rows that already carry this mode's
       exception arrive marked. Without this, committing a page that held existing
       flags cleared them — the commit accepts everything unmarked. */
    showRows(res.rows);
    state.total = res.total; state.pageCount = res.pageCount;

    /* How many observations the date filter had to exclude for having no date. The whole
       point of R5 is that the reviewer is told -- `data.js` counted it and `ui/rail.js`
       drew it, but nothing carried it between them, so the note was always hidden. A
       filter that silently omits is worse than no filter, and it looked correct at every
       tier that cannot see the screen. A pinned page keeps the last count: it is not
       running the filter, so it has nothing new to say about it. */
    state.excludedForNoDate = res.excludedForNoDate || 0;

    /* An address can name a page the question no longer reaches -- a link to page seven
       of a filter that has since been reviewed down to three. Land on the last real page
       rather than on an empty grid that looks like the filter matched nothing. */
    if (state.pageCount >= 1 && state.page > state.pageCount) {
      state.page = state.pageCount;
      return actions.refresh();
    }

    /* **The visible page goes into the cache too**, and it has to: without it the
       scheduler sees the one page it can be certain of as missing and chases it, and
       going back one page would be a fetch. It is put after the clamp, so a page the
       question no longer reaches is never cached as an empty answer. A pinned page is
       not put — it is not an answer to the question, and the two indexes are disjoint. */
    cache.put(state.page, res.rows);

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
    prefetchAbort = supersede(prefetchAbort);
    fire('prefetch', { pages: wanted, direction: travel });
    try {
      /* An array, never the Set. See F2 in `refresh()` above: this call site had the same
         defect, and a prefetch silently excluding nothing is even harder to notice than a
         visible page doing it. */
      const exclude = filters.excludeIdList(pinnedIds);
      const res = await MarpBackend.queryPages({
        filters: filters.queryFilters(state.mode, state.filters, { excludeIds: exclude }),
        sort: state.sort, pageSize: state.pageSize, pages: wanted, exclude,
        signal: signalOf(prefetchAbort)
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

  /**
   * The rail's option lists, once per question (R15, A6).
   *
   * Not per page: the lists depend on the filters and not on where the reviewer is in the
   * result, so asking again on a page turn would be a pass over the matching set per
   * dimension for an answer that has not changed.
   *
   * A failure here is a line in the log and nothing else. The rail falls back to drawing
   * the keys it already holds, which is worse than labels and much better than an empty
   * control that reads as "nothing is reachable".
   */
  async _loadFacets() {
    const asked = cache.key;
    try {
      const facets = await MarpBackend.facets({
        filters: filters.queryFilters(state.mode, state.filters)
      });
      if (cache.key !== asked) { fire('facets:stale'); return; }
      state.facets = facets;
      fire('facets', { dimensions: Object.keys(facets).length });
      notify();
    } catch (err) {
      if (isAbort(err)) return;
      fire('facets:failed', { message: String((err && err.message) || err) });
    }
  },

  /**
   * Turn `queued` tiles into `ready` ones, by re-reading the visible page (A8, R12).
   *
   * This was one request **per queued row** and one `notify()` per resolution, against a
   * fixture method (`awaitThumbnail`) that had no endpoint at all — it was the fixture
   * pretending a worker had finished. A page of 45 queued tiles was 45 requests and 45
   * full re-renders, which is exactly the cost the contract check added after #118
   * forbids for the retry path.
   *
   * **One request and one `notify()` per round.** The page is re-read through the pages
   * endpoint, which is also what makes the answer truthful: serving a page enqueues the
   * thumbnails it is missing, so asking again is what the extractor's progress is
   * *visible through*. Extraction runs at three concurrent Jellyfin streams, so a page of
   * 45 takes many seconds — hence the backoff and the bound.
   *
   * It stops on any of four things: nothing is queued, the page changed, the question
   * changed, or the round bound is reached. The bound matters: polling for ever against a
   * permanently stuck queue is a request every few seconds for the life of the tab.
   */
  _chaseQueuedThumbnails() {
    cancelPoll();
    if (!state.rows.some((r) => r.thumbnail_status === 'queued')) return;
    pollRound = 0;
    schedulePoll();
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
    /* The poll belongs to the page that was on screen, and the mode switch replaces it. */
    cancelPoll();

    /* Marks and take-backs do not travel. An uncommitted mark is a pending intention in
       one workflow, and the reviewer walked away from it. */
    state.marks.clear();
    state.picker = null;
    state.refused = null;
    state.page = 1;
    state.touched = new Set();
    state.takenBack = new Set();
    state.lastCommit = null;
    state.filters = filters.defaultStatusFor(mode, state.filters);
    fire('setMode', { mode });
    actions.refresh();
  },

  /**
   * The exception gesture: left click, and what a tap has always done.
   *
   * `had` is now "was it already **this** mark", not "was it marked at all" -- a tile the
   * reviewer accepted becomes the exception rather than becoming unmarked, because the
   * later mark wins (#126 R7) and neither gesture should need the other undone first.
   */
  toggleMark(id) {
    if (!state.rows.some((r) => r.observation_id === id)) return;
    /* Nothing more can be recorded about a row the commit destroyed (#138). Silently,
       because a destroyed tile stops being a target rather than explaining itself on
       every click -- which is what separates this from A4's per-tile refusal. */
    if (destroyed(id)) return;
    const had = state.marks.has(id) && (state.marks.get(id).kind || MARK_EXCEPT) === MARK_EXCEPT;
    state.marks = page.toggleMark(state.marks, id, MARK_EXCEPT);
    state.touched.add(id);
    recordTakeBack(id, had ? MARK_EXCEPT : null);
    if (had) state.picker = null;
    fire(had ? 'unmark' : 'mark',
      { id, mode: state.mode, kind: MARK_EXCEPT, mark: MODES[state.mode].mark });
    notify();
  },

  /**
   * The accept gesture: right click on a pointer, double tap on a touch screen (#126 R2).
   *
   * Three refusals before anything happens, and each is a decision on the record:
   *
   * - **Delete Mode is inert** (A2). `MODES.delete.accepts` is null because the opposite
   *   of deleting is leaving a row alone, which needs no record — so an accept mark has
   *   nothing to mean there. Nothing is fired, because nothing happened.
   * - **A tile with no picture is refused, with the tile saying why** (A4). Accepting is
   *   the reviewer saying "I have judged this one", which they cannot have done without
   *   seeing it.
   * - A tile that is not on this page is not this page's business, as for `toggleMark`.
   */
  acceptMark(id) {
    const row = state.rows.find((r) => r.observation_id === id);
    if (!row) return;
    if (destroyed(id)) return;                     // gone from the database (#138)
    if (!acceptedValue(state.mode)) return;        // Delete: inert, and silently so

    const { ok, reason } = acceptRefusal(state.mode, row);
    if (!ok) {
      state.refused = { id, reason };
      clearRefusal();
      fire('acceptMark:refused', { id, reason });
      notify();
      return;
    }

    const had = state.marks.get(id) && state.marks.get(id).kind === MARK_ACCEPT;
    state.marks = page.toggleMark(state.marks, id, MARK_ACCEPT);
    state.touched.add(id);
    recordTakeBack(id, had ? MARK_ACCEPT : null);
    /* The panel belongs to an exception and its reason vocabulary, so it closes rather
       than sitting open over a mark it can no longer describe. */
    state.picker = null;
    state.refused = null;
    fire(had ? 'unmark' : 'mark',
      { id, mode: state.mode, kind: MARK_ACCEPT, mark: acceptedValue(state.mode) });
    notify();
  },

  setReason(id, reason) {
    state.marks = page.setReason(state.marks, id, reason);
    fire('setReason', { id, reason: (state.marks.get(id) || {}).reason });
    notify();
  },

  openPicker(id) {
    /* A destroyed row has nothing left to describe: the reason the panel would record
       lives on `observation_reviews`, which the delete cascaded away (#138). */
    if (destroyed(id)) return;
    /* An **exception** only. The panel chooses a flag or exclusion reason, and an accept
       mark has nothing in that vocabulary to say (#126) -- so its badge is not a target. */
    if (!state.marks.has(id) || (state.marks.get(id).kind || MARK_EXCEPT) !== MARK_EXCEPT) return;
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
    /* Before the mark, not after: this route *creates* an exception mark on its way in,
       so guarding only `toggleMark` would leave the chip able to mark a destroyed
       row (#138). */
    if (destroyed(id)) return;
    /* An **exception** mark, because that is what the panel describes and because saying
       the species is wrong is saying something is wrong. This already created one on an
       unmarked tile; #126 only makes it say which kind. */
    const cur = state.marks.get(id);
    if (!cur || (cur.kind || MARK_EXCEPT) !== MARK_EXCEPT) {
      state.marks = page.toggleMark(state.marks, id, MARK_EXCEPT);
    }
    state.picker = { id, correcting: true };
    fire('openCorrection', { id });
    notify();
  },

  closePicker() { if (state.picker) { state.picker = null; fire('closePicker'); notify(); } },

  async changeSpecies(id, speciesId) {
    const before = state.rows.find((r) => r.observation_id === id);
    if (!before) return;
    /* What the tile is showing now, which is the *current* species and not the annotator's
       frozen `comname`. See `model/row.js`: those are two different things. */
    const from = currentSpeciesName(before);
    fire('changeSpecies:request', { id, speciesId, from });

    let res;
    try {
      res = await MarpBackend.setSpecies({
        observationId: id, speciesId, version: before.version
      });
    } catch (err) {
      if (recordFailure(err, 'changeSpecies')) notify();
      return;
    }

    /* Applied and refused are both a 200 and the client branches on `ok` alone, so a
       refusal that has a perfectly good result to show is not a transport failure. */
    if (!res.ok) {
      fire('changeSpecies:refused', { id, error: res.error });
      /* `unchanged` means the observation already carries that species, so nothing was
         written — deliberately, because doing it anyway would destroy live review
         decisions in exchange for no change. The panel still closes: choosing a species is
         what it was opened to do, and leaving it up makes the click look like it failed. */
      if (res.error === 'unchanged' && state.picker && state.picker.id === id) {
        state.picker = null;
      }
      notify();
      return;
    }
    clearFailure();

    /**
     * The corrected name is `species_comname`, **never `comname`** (F6).
     *
     * This read `res.observation.comname`, and the contract is that `comname` is unchanged
     * by a correction, always — it is the annotator's frozen label, and keeping it frozen
     * is what makes the drift auditable. So `to:` was the *old* name, `from` and `to` came
     * out equal, and the "was X" indicator said the species had changed from X to X.
     * Nothing failed and nothing logged.
     */
    const to = res.observation.species_comname;
    state.changed.set(id, { from, to });

    /* The row on screen is the one the reviewer is looking at, and the tile draws the
       current name — so it has to carry what the correction actually did. `comname` is
       deliberately left alone here too, for the same reason the endpoint leaves it alone. */
    before.species_id = res.observation.species_id;
    before.species_comname = to;
    before.version = res.observation.version;

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
    fire('changeSpecies:saved', { id, from, to, version: res.observation.version });
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
    /* The page, less whatever this sitting destroyed (#138). Marking a destroyed row here
       is how the app manufactures the `not-found` skip against itself: the next commit
       sends a row the reviewer deleted a moment ago, and the reason the server gives back
       says somebody *else* deleted it. */
    const targets = state.rows.filter((r) => !destroyed(r.observation_id));
    state.marks = page.markAll(state.marks, targets);
    /* Marking the page *is* a decision on every row of it, so every row is hand-decided
       now and must not be re-seeded behind the reviewer. Clear is what undoes it. */
    targets.forEach((r) => state.touched.add(r.observation_id));
    fire('markAllOnPage', { count: targets.length, scope: 'page' });
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

    for (const id of ids) {
      state.marks.delete(id);
      state.touched.delete(id);
      state.takenBack.delete(id);
    }
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
    /* A permanent failure is refused by the endpoint rather than re-queued, and the tile
       does not offer the button — so reaching here means the row is retryable. */
    if (row.thumbnail_permanent) return;
    return actions._retry([id], 'thumbnail:retried');
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
    /* Which tiles a retry can help is a **rule**, and it lives in `model/` where a test can
       see it: a permanent failure is left out, because asking again for a picture that can
       never exist is a way to hammer a shared media server (F11, R13). */
    const asking = retryablePage(state.rows);
    if (!asking.length) return;
    fire('thumbnail:retry-page', { count: asking.length });
    return actions._retry(asking, 'thumbnail:retry-page');
  },

  /**
   * Ask again for a set of thumbnails: **one request, two paints** (A9, R11).
   *
   * This used to be `retryThumbnail` mapped over the failed rows, and each of those
   * notified twice — so a page of fifty cost **a hundred full re-renders**, measured at
   * 972 ms on an idle machine and enough under parallel test workers to blow a
   * twenty-second timeout. Rendering here is a full re-render from state by design and
   * that is worth keeping, so the fix is to stop asking for a hundred of them.
   *
   * The endpoint answers `queued` and **never a synchronous `ready`** — an accepted retry
   * has not happened yet, and the fixture's old shortcut of returning `ready` is what let
   * the client believe a picture existed the moment it asked. So this leaves the tile at
   * PREPARING and the poll is what clears it (A8).
   *
   * Every answer is found by `observation_id`, never by position.
   */
  async _retry(ids, event) {
    if (!ids.length) return;

    for (const id of ids) {
      const row = state.rows.find((r) => r.observation_id === id);
      if (row) row.thumbnail_status = 'queued';
    }
    notify();                                    // paint one: the page is asking

    let res;
    try {
      res = await MarpBackend.retryThumbnails(ids);
    } catch (err) {
      if (recordFailure(err, event)) notify();
      return;
    }
    clearFailure();

    for (const answer of res.thumbnails) {
      /* The row may have gone -- a filter change, a new page -- while this was in flight. */
      const row = state.rows.find((r) => r.observation_id === answer.observation_id);
      if (!row) continue;
      row.thumbnail_status = answer.status;
      /**
       * `permanent` comes from the **retry answer**, never from the row (F11, R13).
       *
       * `src/data.js:494` short-circuited a retry on `current.thumbnail_permanent` and no
       * row has ever carried the key — one grep hit, in the file reading it. The endpoint
       * does not put it on a page either; it answers `permanent: true` per retry entry and
       * refuses rather than re-queueing. So this is where the state finally gets a value,
       * and the tile can stop offering a button that cannot help.
       */
      row.thumbnail_permanent = Boolean(answer.permanent);
      row.thumbnail_reason = answer.reason || null;
    }

    fire(event, {
      asked: ids.length,
      queued: res.thumbnails.filter((t) => t.status === 'queued').length,
      permanent: res.thumbnails.filter((t) => t.permanent).length
    });
    notify();                                    // paint two: what the answers were

    /* Whatever was accepted is `queued`, and the poll is what turns it into a picture. */
    actions._chaseQueuedThumbnails();
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

    return runCommit({ selective: false });
  },

  /**
   * Commit **only what the reviewer marked**, each tile by its own kind (#126 R3).
   *
   * The new main button, and the one the human asked for after reviewing 1,062 real
   * observations: *"There are times when you just want to exclude things, or just approve
   * certain items, without it affecting anything else."* So it says nothing at all about a
   * tile nobody touched, which is the whole of the feature and most of what makes it
   * different from the sweep beside it.
   *
   * **Delete has one button, not two** (A2). Its existing button already commits only what
   * is marked, so a second control doing the identical thing would be two controls with
   * one meaning.
   */
  async commitMarked() {
    if (state.commit.busy) return;
    if (commitActsOnMarked(state.mode)) return;    // Delete: one button, and it is the other one
    return runCommit({ selective: true });
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
    /* The reachable map comes from the facets already in state, so this stays synchronous
       (F12). `MarpData.reachableUnder(toggled)` scanned the whole fixture *inside an
       action*, which is not available over a network -- and making it async would have
       changed this call site and `ui/menus.js`, which is a leak above `api/`. The map is
       for the question that was in force when the facets were fetched, which is the right
       one: it answers "does this dive still apply", and the dive list has not moved. */
    state.filters = filters.applyFilter(
      toggled, key, toggled[key], dimensions.reachableFrom(state.facets));
    resetForNewQuery();
    fire('toggleDimension', { key, value });
    notify();
    return actions.refresh();
  },

  /** Stop filtering on a dimension. Empty means "not filtering", never "match nothing". */
  clearDimension(key) {
    const cleared = { ...state.filters, [key]: dimensions.emptyValue(dimensions.DIMENSION[key]) };
    state.filters = filters.applyFilter(
      cleared, key, cleared[key], dimensions.reachableFrom(state.facets));
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
    state.takenBack = new Set();
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
    state.takenBack = new Set();
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

  /**
   * Search the taxonomy for a correction (R17, A11).
   *
   * **Scoped to the observation's own list, with an explicit action to widen.** A common
   * name identifies a species only *within* a list (F15) — taxserials below 10000 are
   * local codes invented per list and reused — so an unscoped search can offer two
   * different organisms under one label. The list is the owning session's, resolved by the
   * server and carried on the row as `species_list` (#130 A1).
   *
   * A11 was answered so that an off-list correction stays **possible but deliberate**: the
   * contract already contemplates one, and the `Other` session type maps to no list at all,
   * so widening is how those observations get a picker at all. **Widening is a real
   * request now** — `GET /api/v2/species/search` — where a null list used to be turned into
   * an empty array without anything being asked (#130 R3).
   *
   * **Nothing is sent for an empty term.** `GET /api/v2/species/list/:list/search` rejects
   * an empty `q` with a 400, deliberately — "an empty search returning all 224 entries
   * reads as a working search" — and the picker used to call `searchSpecies('')` to fill
   * itself before anything was typed (F14).
   */
  async searchSpecies(term, { widen = false } = {}) {
    const row = state.picker && state.rows.find((r) => r.observation_id === state.picker.id);
    const list = widen ? null : speciesListFor(row);
    try {
      return await MarpBackend.searchSpecies(term, { list });
    } catch (err) {
      if (!isAbort(err)) recordFailure(err, 'searchSpecies');
      return [];
    }
  },

  /** Dismiss whatever the last failure said. The reviewer has read it. */
  dismissFailure() {
    if (!state.failure) return;
    fire('dismissFailure', { kind: state.failure.kind });
    state.failure = null;
    notify();
  },

  /**
   * Re-read the visible page after a version conflict (R9).
   *
   * The pin is dropped first: the page was committed, but the rows the commit refused are
   * not what the reviewer decided about any more, so the honest thing is to ask the
   * question again rather than to keep showing a membership that is now partly stale.
   */
  rereadAfterConflict() {
    if (!state.conflicted.length) return;
    fire('rereadAfterConflict', { ids: state.conflicted });
    state.conflicted = [];
    state.pageMembers.delete(state.page);
    state.committedPages.delete(state.page);
    state.outcomes = new Map();
    return actions.refresh();
  },

  openVideo(id) { fire('openVideo', { id }); }   // deliberately unimplemented
};
