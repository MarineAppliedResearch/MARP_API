/**
 * The data seam.
 *
 * Everything the prototype knows about observations comes through here. Today it is
 * backed by a JSON fixture; later the same methods become MARP_API calls. Nothing
 * else in the prototype touches the fixture directly, so swapping the backing store
 * should not require touching the UI.
 *
 * Every method is async and returns the shape the API is expected to return,
 * including the per-observation results that #68 requires for bulk operations.
 */

/**
 * The signed-in reviewer, as the fixture's own `users` entry.
 *
 * **An id and a name, not a bare name.** This was the literal `'I. Travers'`, and it was
 * compared against four row columns that do not exist (F8) — so "by you" was true for one
 * person on one machine and silently false for everybody else. `whoami()` below is the
 * seam method the interface asks instead, so nothing above `api/` holds a name at all
 * (R19).
 */
const ME = Object.freeze({ user_id: 5, name: 'I. Travers', username: 'itravers' });

import { matchesFilters, unanswerable } from './model/match.js';
import { DIMENSIONS, DIMENSION, KIND, isActive } from './model/dimensions.js';
/* The row column and the neutral *filter* value for each status dimension, declared once
   in `model/modes.js`. The fixture used to spell both out, which is how it came to filter
   and count on a column the schema does not have. */
import { STATUS_DIMENSIONS } from './model/modes.js';
import { currentSpeciesName as currentName } from './model/row.js';
/* Same reason as `matchesFilters`: which comparisons a query makes, in which order, is a
   rule, and a second copy of it here is a second place for the fixture and the API to
   disagree about what a sort means. */
import { sortTerms } from './model/filters.js';

const LATENCY = { query: 140, commit: 260, species: 180, thumb: 900 };

/** Pretend the network exists, so loading states are real rather than theoretical. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* Whether the simulated network is switched off. See `withoutLatency` for why this can
   only ever be true under `node --test`, and what would break if it were not. */
let instant = false;

/**
 * The ambient cost of a call — the part that stands in for the network.
 *
 * Distinct from `delay` deliberately: `slowNextCommit` asks for a specific hold, which is
 * an instruction rather than scenery, so it goes through `delay` and is never suppressed.
 */
const latency = (ms) => (instant ? Promise.resolve() : delay(ms));

let db = null;

/* Testing affordance: the fixture cannot fail on its own, but the API will, and the
   button has to show it. Nothing in the application calls this. */
/* Testing affordance: the fixture cannot fail on its own, but the API will, and the
   button has to show it. Nothing in the application calls this. */
let failNext = false;
let slowNext = 0;

/* ------------------------------------------------------------------ depth
 *
 * The fixture is 3,000 rows; production is ~440,000. Sixty pages is not where eviction
 * happens, so a prefetcher that looks instant against the fixture has proved nothing --
 * and growing the file is not available: 3,000 rows is 3.4 MB, so 440,000 would be about
 * 490 MB, and the `fetch` plus `JSON.parse` of that would dwarf the 140 ms
 * `LATENCY.query` this file simulates on purpose, distorting the one measurement the
 * prefetcher exists to make. So the fixture supplies the *content* and a scale factor
 * supplies the *depth*: the result set is `scale` copies of it.
 *
 * Two properties make that cheap rather than clever, and both are why there is no index
 * over the virtual set anywhere below:
 *
 * - **A replica shares every sort-field value with the row it copies.** Nothing in this
 *   file writes `confidence`, `keyframe_count`, `updatedAt` or `obsID`, so a virtual
 *   row's place in the order is settled by its base row's sort key and then by its own id.
 * - **A virtual id is `baseId * scale + k`**, which is the identity at scale 1 and is
 *   monotone in `(baseId, k)` at any scale. So ordering the whole virtual set by the sort
 *   terms and then by `observation_id` is exactly: the base rows sorted as they are
 *   today, each followed by its `scale` replicas in `k` order.
 *
 * Together those make the work per query proportional to the *fixture* rather than to the
 * virtual set -- sort at most 3,000 rows, which is what `query()` has always cost, then
 * materialise one page. Nothing 440,000 entries long is built, so nothing has to be
 * memoised, so nothing can go stale when a commit changes what a filter matches.
 */
let scaleFactor = 1;

/** Replica 0 is the fixture row itself, which is why scale 1 leaves every id alone. */
const virtualId = (baseId, k) => baseId * scaleFactor + k;
const replicaOf = (id) => id % scaleFactor;
const baseIdOf = (id) => (id - (id % scaleFactor)) / scaleFactor;

/* Built on demand and dropped by `reload`. `byIds` used to build one of these per call. */
let byId = null;
const baseIndex = () => {
  if (!byId) byId = new Map(db.observations.map((r) => [r.observation_id, r]));
  return byId;
};
const baseFor = (id) => baseIndex().get(baseIdOf(id)) || null;

/* A write to a replica lands here, keyed by virtual id, so a committed page reads back as
   committed without 440,000 rows ever being materialised. `overlaid` is the same
   information by base row, so the query below can ask once per base row rather than once
   per replica. Both are empty at scale 1, where a write goes to the fixture row. */
const overlay = new Map();            // virtual id -> a full row, copied on first write
const overlaid = new Map();           // base id -> the replicas that have an overlay

/* A version another reviewer moved, per virtual id, without touching the row this client
   is holding. `bumpVersion` is the only thing that writes it and it exists so R9 -- the
   `conflicted` outcome -- has a tier that can reach it. Empty in every other case. */
const drift = new Map();

/**
 * The row a virtual id names, as it would come back over the wire.
 *
 * **A fresh object for every replica, at any scale above 1** — including a replica that
 * has been written to, which is copied out of the overlay rather than handed over. Two
 * reasons, and the second is the one that bites:
 *
 * - A shared reference would make a cache holding 3,000 rows cost nothing, and eviction
 *   would prove nothing.
 * - The page cache hands back the row objects it holds rather than copies of them, so a
 *   caller that writes to a row it was served writes to the cache. If that row were also
 *   the fixture's own, the write would reach the source of truth for every later query.
 *   `store.js` does write to served rows — `thumbnail_status` while a retry is in flight
 *   — so this is a live path and not a hypothetical one.
 *
 * **At scale 1 the fixture row itself is served, exactly as it always has been.** That is
 * not an oversight: it is what every existing test and every shipped behaviour above this
 * seam was written against, including that same `thumbnail_status` write, which reaches
 * the record there. The consequence to know about is that at depth a row cached before a
 * commit does not show the commit — which is sound, because a committed page is pinned
 * and `refresh()` serves a pinned page by id rather than from the page cache.
 */
function served(base, k) {
  if (scaleFactor === 1) return base;             // the fixture row, as it always was
  const id = virtualId(base.observation_id, k);
  const written = overlay.get(id);
  return written ? { ...written } : { ...base, observation_id: id };
}

/**
 * Where a write to a virtual id goes.
 *
 * At scale 1 that is the fixture row itself, which is what it has always been — and what
 * keeps `optionsFor`, `counts` and every existing test seeing exactly the fixture they
 * saw before this file learned about depth.
 *
 * **At any greater scale every replica gets its own overlay copy, replica 0 included.**
 * The fixture row is then the template the replicas are cut from, so writing to it would
 * move all `scale` of them at once — and a commit on one page silently changing 147 rows
 * reads exactly like a cache defect, which is the wrong thing for this fixture to be able
 * to simulate.
 */
function editable(id) {
  const base = baseFor(id);
  if (!base) return null;
  if (scaleFactor === 1) return base;

  let row = overlay.get(id);
  if (!row) {
    row = { ...base, observation_id: id };
    overlay.set(id, row);
    let ks = overlaid.get(base.observation_id);
    if (!ks) overlaid.set(base.observation_id, ks = new Set());
    ks.add(replicaOf(id));
  }
  return row;
}

/**
 * The two status dimensions are not in `DIMENSIONS`, so `matchesFilters` cannot see them.
 * An empty array means **not filtering** -- never the owning mode's default. #89.
 *
 * The row now carries the schema's `review_decision` / `training_decision`, where the
 * neutral state is **null** -- the absence of a review record -- while the *filter*
 * vocabulary still spells that `'unreviewed'` / `'undecided'`, exactly as the endpoint's
 * `MosaicQueryFilters` does. `STATUS_DIMENSIONS` is the one place the pair is declared, so
 * this reads the mapping from there rather than spelling either word again (F3, A1).
 */
const decidedAs = (dim, r) => r[dim.column] == null ? dim.neutral : r[dim.column];

const statusMatches = (filters, r) =>
  Object.values(STATUS_DIMENSIONS).every((dim) => {
    const wanted = filters[dim.key];
    return !wanted || !wanted.length || wanted.includes(decidedAs(dim, r));
  });

/** Everything a query narrows on except the exclusion set, which is per replica. */
const member = (filters, r) =>
  !r.deleted && matchesFilters(filters, r) && statusMatches(filters, r);

/**
 * The comparisons a query makes, in order, and then `observation_id` -- always, and not
 * because anything asked for it. Page membership is query-derived, so a comparator that
 * can return zero for two different rows means page one holds different observations on
 * each visit. `sortTerms` deliberately leaves it out so it cannot be reordered away.
 */
const compare = (terms) => (a, b) => {
  for (const term of terms) {
    const x = a[term.field], y = b[term.field];
    if (x !== y) return (x > y ? 1 : -1) * (term.dir === 'desc' ? -1 : 1);
  }
  return a.observation_id - b.observation_id;
};

/**
 * What the rail draws for one value of a set dimension.
 *
 * The three key-valued dimensions — species, model, session — filter on an integer and
 * show a name, so the option list has to carry both (A10a). Where the name lives is not
 * uniform and that is a property of the schema rather than of this fixture: a species name
 * is a column on `species`, a model name a column on `ml_models`, and a session has no
 * name at all, so its own id is the honest label.
 *
 * Everything else labels itself, which is why this is a lookup rather than a declaration.
 */
function labelFor(dimension, value, row) {
  if (dimension.key === 'species') return currentName(row) || String(value);
  if (dimension.key === 'model') {
    const model = (db.models || []).find((m) => m.id === value);
    return model ? model.name : String(value);
  }
  return value;
}

/**
 * Which annotation list a row's species was chosen from, for A10(c).
 *
 * A common name identifies a species only *within* a list (F15), so a mosaic spanning
 * session types can offer two different organisms under one label. The real answer comes
 * from `species.species_list`; the fixture carries the list on the catalogue entry.
 */
function speciesListOf(row) {
  const entry = (db.species || []).find((s) => s.species_id === row.species_id);
  return (entry && entry.species_list) || null;
}

/**
 * The thumbnail extractor, as far as the fixture is concerned.
 *
 * **Serving a page enqueues the thumbnails it is missing** -- that is the endpoint's own
 * behaviour (#118's A3), and it is what makes the `queued` tile the client draws truthful.
 * So the fixture does it too: a `queued` row is handed to a timer that turns it `ready`,
 * exactly as a real extraction eventually would.
 *
 * Without this, `queued` was a **terminal** state against the fixture. That is not a
 * theoretical tidiness point: once the retry stopped inventing a synchronous `ready`
 * (F10), a broken tile stayed at PREPARING for ever, the store's poll ran its full eight
 * rounds against it, and the render tier went from under a minute to ten. A fixture that
 * cannot finish extracting is a fixture that cannot exercise the thing the poll exists for.
 *
 * `_permanent` rows are never resolved: retrying cannot help them, and neither can waiting.
 */
const EXTRACT_MS = 220;
const extracting = new Set();

function extractSoon(id) {
  if (extracting.has(id)) return;
  const base = baseFor(id);
  if (!base) return;
  const current = served(base, replicaOf(id));
  if (current._permanent || current.thumbnail_status !== 'queued') return;

  extracting.add(id);
  setTimeout(() => {
    extracting.delete(id);
    const row = editable(id);
    /* It may have moved on -- a reload, a scale change, a permanent failure recorded
       since -- in which case the extraction is simply no longer wanted. */
    if (row && row.thumbnail_status === 'queued' && !row._permanent) {
      row.thumbnail_status = 'ready';
    }
  }, instant ? 0 : EXTRACT_MS);
}

/** Every queued row a page served, handed to the simulated extractor. */
const enqueueMissing = (rows) => {
  for (const row of rows) {
    if (row.thumbnail_status === 'queued') extractSoon(row.observation_id);
  }
};

/** The ids a caller wants suppressed, from whichever of the two places they arrived in. */
function excludedIds(...sources) {
  let out = null;
  for (const src of sources) {
    if (!src || (!(src instanceof Set) && !Array.isArray(src))) continue;
    for (const id of src) (out || (out = new Set())).add(id);
  }
  return out;
}

/**
 * One question, resolved: how many rows match, and how to reach rank N of them.
 *
 * Built per call rather than memoised. It is proportional to the fixture rather than to
 * the virtual set, so memoising would save a millisecond and buy a staleness bug: every
 * write here changes what a filter matches, and nothing in this file can detect a caller
 * that mutated a row it was handed.
 */
function resolve(filters, terms, exclude) {
  const s = scaleFactor;

  /* Which replicas of which base rows the exclusion set names, grouped by base row. */
  let excludedKs = null;
  if (exclude && exclude.size) {
    excludedKs = new Map();
    for (const id of exclude) {
      const bid = baseIdOf(id);
      let ks = excludedKs.get(bid);
      if (!ks) excludedKs.set(bid, ks = new Set());
      ks.add(replicaOf(id));
    }
  }

  /* A base row is a candidate when the row itself matches -- in which case so does every
     unwritten replica of it -- or when one of its replicas has been written to and may
     therefore differ from it. Nothing else contributes a row at any depth. */
  const uniform = new Map();
  const candidates = [];
  for (const base of db.observations) {
    const ok = member(filters, base);
    uniform.set(base.observation_id, ok);
    if (ok || overlaid.has(base.observation_id)) candidates.push(base);
  }
  candidates.sort(compare(terms));

  /* How many replicas of each candidate are in the result, and -- only where that is not
     simply `scale` -- which ones. `reach` is the running total, so it doubles as the map
     from a rank to the candidate holding it. */
  const n = candidates.length;
  const reach = new Int32Array(n + 1);
  const detail = new Map();

  for (let i = 0; i < n; i++) {
    const base = candidates[i];
    const bid = base.observation_id;
    const ok = uniform.get(bid);
    const written = overlaid.get(bid);
    const dropIds = excludedKs && excludedKs.get(bid);
    let count;

    if (!written && !dropIds) {
      count = ok ? s : 0;                                  // the overwhelming majority
    } else {
      const special = new Set(written || []);
      if (dropIds) for (const k of dropIds) special.add(k);

      const dropped = [], added = [];
      for (const k of special) {
        const row = overlay.get(virtualId(bid, k)) || base;
        const inSet = !(dropIds && dropIds.has(k)) && member(filters, row);
        (inSet ? added : dropped).push(k);
      }
      if (ok) {
        /* Every replica is in but these. */
        dropped.sort((a, b) => a - b);
        count = s - dropped.length;
        if (dropped.length) detail.set(i, { dropped });
      } else {
        /* Only the written replicas that now match are in. */
        added.sort((a, b) => a - b);
        count = added.length;
        if (count) detail.set(i, { added });
      }
    }
    reach[i + 1] = reach[i] + count;
  }

  const total = reach[n];

  /** The candidate holding rank `r`. One binary search; the slice walks on from there. */
  const at = (r) => {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (reach[mid + 1] > r) hi = mid; else lo = mid + 1;
    }
    return lo;
  };

  /**
   * Ranks `[from, to)` of the ordered result, materialised.
   *
   * `from` past the end returns nothing rather than throwing: the scheduler asks for the
   * tail of a result before it knows how long the result is.
   */
  const slice = (from, to) => {
    const out = [];
    const end = Math.min(to, total);
    if (from < 0 || from >= end) return out;

    let i = at(from);
    for (let r = from; r < end; r++) {
      while (reach[i + 1] <= r) i++;
      const d = detail.get(i);
      let k = r - reach[i];
      if (d) {
        if (d.added) k = d.added[k];
        /* Skip the replicas this candidate lost, in order. */
        else for (const x of d.dropped) { if (x <= k) k++; else break; }
      }
      out.push(served(candidates[i], k));
    }
    return out;
  };

  return { total, slice };
}

/**
 * How many observations a date filter could not answer for, across the whole set.
 *
 * A filter that silently omits looks complete and is not -- see #76. Nothing here writes
 * `tc`, so a replica answers exactly as its base row does and the count simply scales;
 * only `deleted` can differ, and only for a replica that has been written to.
 */
function noDateCount(filters) {
  let n = unanswerable(filters, db.observations.filter((r) => !r.deleted)) * scaleFactor;
  if (overlay.size && isActive(DIMENSION.date, filters.date)) {
    for (const [id, row] of overlay) {
      const base = baseFor(id);
      if (!base) continue;
      if (!base.deleted) n -= unanswerable(filters, [base]);
      if (!row.deleted) n += unanswerable(filters, [row]);
    }
  }
  return n;
}

/* The cap the endpoint enforces on one page-set request: 12 pages or 600 rows, whichever
   binds first. `pageSize` follows the reviewer's viewport, so on a wide desktop the row
   cap binds well before the page cap. */
const MAX_PAGES = 12;
const MAX_ROWS = 600;

/** A rejection the endpoint would answer with `400`. */
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Refuse to answer a question the caller has already superseded (A16, R21).
 *
 * Every seam method takes an optional `AbortSignal`, and the fixture honours it for the
 * same reason `fetch` does: a request the reviewer has moved past should stop costing
 * something, and — more importantly here — the *shape* has to be the same in both
 * backings or the store's abort handling would be exercised against only one of them.
 *
 * The rejection is a `DOMException` named `AbortError` where the platform has one, which
 * is what `fetch` throws, so `isAbort()` in `src/api/transport.js` recognises both. Under
 * `node --test` `DOMException` exists from Node 17, and the plain `Error` fallback keeps
 * the name so nothing depends on the class.
 */
function throwIfAborted(signal) {
  if (!signal || !signal.aborted) return;
  if (typeof DOMException === 'function') {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  throw err;
}

/**
 * The pages a request is actually asking for: de-duplicated, ascending, inside the cap.
 *
 * **Rejected rather than silently truncated.** A scheduler that quietly gets fewer pages
 * than it asked for believes it holds a set it does not, and the reviewer meets that as a
 * spinner on a page the cache was supposed to have.
 */
function requestedPages(pages, pageSize) {
  if (!Array.isArray(pages)) throw badRequest('pages must be an array of page numbers');
  const out = [...new Set(pages)].sort((a, b) => a - b);
  for (const p of out) {
    if (!Number.isInteger(p) || p < 1) {
      throw badRequest(`${JSON.stringify(p)} is not a page number; pages are 1-based integers`);
    }
  }
  if (out.length > MAX_PAGES) {
    throw badRequest(`${out.length} pages asked for; the cap is ${MAX_PAGES}`);
  }
  if (out.length * pageSize > MAX_ROWS) {
    throw badRequest(`${out.length * pageSize} rows asked for; the cap is ${MAX_ROWS}`);
  }
  return out;
}

/**
 * The comparisons a query makes, from either shape a caller can be holding.
 *
 * The wire carries an array of `{ field, dir }` terms; the client holds one
 * `{ field, dir, then }` object, and `sortTerms` is the rule that turns the second into
 * the first. Accepting both is what lets the store pass `state.sort` straight through
 * while the request stays the shape the endpoint will serve.
 */
const termsFor = (sort) =>
  (Array.isArray(sort) && sort.length)
    ? sort.map((t) => ({ field: t && t.field, dir: (t && t.dir === 'desc') ? 'desc' : 'asc' }))
    : sortTerms(Array.isArray(sort) ? null : sort);

export const MarpData = {
  async load({ signal } = {}) {
    if (!db) {
      const res = await fetch('./fixtures/observations.json');
      if (!res.ok) throw new Error(`fixture failed to load: ${res.status}`);
      db = await res.json();
    }
    throwIfAborted(signal);
    /* `{ me }` as well as the data, so the store's `init` reads identity from the seam
       whichever backing it is on -- against the API there is nothing to load *but* the
       identity. */
    return { db, me: ME };
  },

  /**
   * Who the reviewer is (R19).
   *
   * The fixture's answer to `GET /api/v2/auth/me`. It exists so the interface can stop
   * holding a name: `src/data.js:13` and `src/ui/dom.js:24` both carried the literal
   * `'I. Travers'`, and the badge, the tooltip and `byMe` all rested on it.
   */
  async whoami({ signal } = {}) {
    await latency(20);
    throwIfAborted(signal);
    return ME;
  },

  /**
   * Throw the loaded data away and fetch it again.
   *
   * Commits, corrections and deletions mutate these rows in place, so a suite that
   * runs many checks against one fixture is running each of them against whatever
   * the last one left behind. Two contract checks were order-dependent for exactly
   * that reason. Against the real API this becomes a no-op or a seeded database.
   */
  /** Make the next commit fail, so the failed path can be exercised. */
  failNextCommit() { failNext = true; },

  /**
   * Hold the next commit open for a while, so what happens *during* one can be driven.
   *
   * A testing affordance like `failNextCommit`. Without it, anything about a commit still
   * being in flight has to be raced against a 260 ms fixture latency, and a test that
   * races is a test that reports the wrong thing about one run in ten. #86 is the case
   * that needed it: a mode switch landing between the request and the response.
   */
  slowNextCommit(ms = 3000) { slowNext = Math.max(0, ms); },

  /**
   * How many copies of the fixture the result set is. **Default 1**, so every existing
   * test sees exactly the fixture it saw before this existed; a deep test opts in.
   *
   * 147 is the production shape: 3,000 x 147 is 441,000 observations, about 9,800 pages
   * at 45 per page.
   *
   * Set it before anything queries. A virtual id is `baseId * scale + k`, so changing the
   * scale renumbers every row -- which is why any simulated edit to a replica other than
   * 0 is thrown away with it. The fixture's own rows are untouched either way.
   */
  setScale(n = 1) {
    const next = Math.max(1, Math.floor(Number(n) || 1));
    if (next === scaleFactor) return scaleFactor;
    scaleFactor = next;
    overlay.clear();
    overlaid.clear();
    drift.clear();
    return scaleFactor;
  },

  /** The scale in force. */
  scale() { return scaleFactor; },

  /**
   * Switch the simulated network off. **The unit tier only, and structurally so.**
   *
   * `LATENCY.query` is 140 ms deliberately — high enough that a real fetch is plainly
   * visible on screen — so that the interface cannot be designed against an instant
   * backend and `render.spec.mjs` can prove the reviewer does not wait. **If that latency
   * ever went away under Playwright, the render tests would pass showing a grid with no
   * spinner because there was nothing to wait for**: green, and proving nothing, and
   * invisible. That is the worst outcome available here, so this is built to make it
   * impossible rather than to make it unlikely:
   *
   * - **It refuses to do anything in a browser.** `typeof window` is undefined under
   *   `node --test` and defined in every browser tier there is — the contract checks in
   *   `tests/requirements.js` included — so no Playwright run can be subject to it however
   *   it is called.
   * - **There is no environment variable** a Playwright worker could inherit, and no
   *   default that a bare `import` turns on. The real latency is what you get unless
   *   somebody wrote this call.
   * - **It is module state, and `node --test` gives each test file its own process**, so a
   *   file that switches it off cannot leave it off for another file.
   *
   * Returns whether it took effect, so a caller cannot quietly believe it did.
   */
  withoutLatency(on = true) {
    if (typeof window !== 'undefined') return false;      // never, in a browser
    instant = Boolean(on);
    return instant;
  },

  /**
   * Break the imagery for a set of observations, so the states a reviewer meets on a bad
   * day can be reached deliberately.
   *
   * A testing affordance, like `failNextCommit`. None of the empty-and-broken states was
   * reachable before this: the fixture is uniformly healthy, so the only way to see a page
   * of failed thumbnails was to edit the fixture by hand and forget to put it back.
   *
   * `permanent` is why F11 was a finding: the client short-circuits a retry on
   * `thumbnail_permanent`, and **no row has ever carried the key** — one grep hit, in this
   * file, reading a field nothing writes. The endpoint does not put it on the row either;
   * it answers `permanent: true` per entry of a *retry*, and refuses rather than
   * re-queueing. So this marks a fixture row permanently broken and
   * {@link MarpData.retryThumbnails} reports it the way the endpoint would, which is what
   * finally makes "permanent" a state something can render.
   *
   * @param {number[]|'page'} ids  observation ids, or 'page' for everything currently loaded
   * @param {string} [status]      'failed' (default) or 'queued'
   * @param {Object} [options]
   * @param {boolean} [options.permanent=false]  retrying cannot help
   * @param {string} [options.reason]            why, as the endpoint's `last_error`
   */
  breakThumbnails(ids, status = 'failed', { permanent = false, reason = null } = {}) {
    let broken = 0;
    for (const id of new Set(ids)) {
      const row = editable(id);
      if (!row) continue;
      row.thumbnail_status = status;
      /* Fixture-internal, and deliberately **not** part of the row shape the client
         reads: the client learns `permanent` from a retry answer, never from a page. */
      row._permanent = Boolean(permanent);
      row._permanentReason = permanent
        ? (reason
          || 'The observation has no keyframes, so it has no bounding box and can never have a cropped picture.')
        : null;
      broken++;
    }
    return broken;
  },

  /**
   * Ask again for **a page** of thumbnails: one request, answering per observation.
   *
   * `retryThumbnail(id)` was the seam, and the store mapped it over the failed rows — so a
   * page of forty-five failures was forty-five round trips (F10). The endpoint takes
   * `observationIds` and answers per observation explicitly so that "a page-level retry is
   * one round trip and two paints" (A9, R11).
   *
   * Two things it will not do, both of them the endpoint's contract rather than a
   * simplification:
   *
   * - it answers **`queued`, never a synchronous `ready`**. An accepted retry has not
   *   happened yet, and the fixture's old shortcut of returning `ready` is what let the
   *   client believe a picture existed the moment it asked;
   * - a **permanent** failure is refused rather than re-queued, and says why. Without that
   *   the retry button is a way to hammer a shared media server for a picture that can
   *   never exist.
   *
   * Every entry is found by `observation_id`, never by position.
   */
  async retryThumbnails(observationIds = [], { signal } = {}) {
    const ids = [...new Set(observationIds)];
    if (ids.some((id) => !Number.isInteger(id))) {
      throw badRequest('observationIds takes observation ids as integers');
    }
    await latency(LATENCY.thumb);
    throwIfAborted(signal);

    return {
      thumbnails: ids.map((id) => {
        const base = baseFor(id);
        if (!base) {
          return {
            observation_id: id, status: 'failed', permanent: true, reason: 'not-found'
          };
        }
        const current = served(base, replicaOf(id));

        if (current._permanent) {
          /**
           * **`failed`, not whatever the row currently says.**
           *
           * The store paints the page `queued` optimistically before it asks -- that is
           * paint one of the two -- and at scale 1 the served row *is* the fixture row, so
           * echoing `current.thumbnail_status` would hand the client back its own guess.
           * The endpoint has no such problem: a permanently failed row is stored `failed`
           * and is never re-queued, so `failed` is what it answers. The client's optimistic
           * paint is a guess the answer corrects, which is the whole point of paint two.
           */
          return {
            observation_id: id,
            status: 'failed',
            permanent: true,
            reason: current._permanentReason
          };
        }
        /* Already ready is left alone: a retry asks for a picture and one exists. */
        if (current.thumbnail_status === 'ready') {
          return { observation_id: id, status: 'ready', permanent: false, reason: null };
        }

        editable(id).thumbnail_status = 'queued';
        /* Accepted work, so the simulated extractor picks it up -- which is what the
           store's poll then observes. `queued` is not a terminal state. */
        extractSoon(id);
        return { observation_id: id, status: 'queued', permanent: false, reason: null };
      })
    };
  },

  async reload() {
    /* Swap, never null: work already in flight — a queued thumbnail resolving, say —
       still reads `db`, and clearing it first threw where nothing could catch it. */
    const res = await fetch('./fixtures/observations.json');
    if (!res.ok) throw new Error(`fixture failed to reload: ${res.status}`);
    db = await res.json();
    /* The fixture's rows are new objects, so anything derived from the old ones is stale:
       the id index, and every simulated edit to a replica. */
    byId = null;
    overlay.clear();
    overlaid.clear();
    drift.clear();
    return db;
  },

  species() { return db.species; },
  projects() { return db.projects; },
  models() { return db.models; },

  /**
   * What a dimension can still offer, given everything else the reviewer has chosen.
   *
   * Derived from the observations rather than stored, because that is what the API will
   * do too: a dive is a property of a session, and the useful list is the one that
   * actually has observations under the filters already chosen. Offering a dive that
   * returns nothing is worse than not offering it.
   *
   * One function for every set dimension, because there is nothing dive-specific about
   * "which values are still reachable" -- and because a per-dimension copy is exactly
   * the tax this refactor removed.
   *
   * The base rows are the whole answer at any scale: a replica carries its base row's
   * values, so a deeper set offers the same dives and the same species. This is a list of
   * values, not a count of them.
   */
  optionsFor(key, filters = {}) {
    const dimension = DIMENSION[key];
    if (!dimension || dimension.kind !== KIND.SET) return [];

    /* Everything except this dimension: a dive list narrowed by the dives already
       chosen would only ever offer what is already selected. */
    const others = { ...filters, [key]: null };
    const rows = db.observations.filter((r) => !r.deleted && matchesFilters(others, r));

    const seen = new Map();
    for (const r of rows) {
      const value = r[dimension.field];
      if (value == null || value === '') continue;
      if (seen.has(value)) { seen.get(value).count++; continue; }
      seen.set(value, { value, label: labelFor(dimension, value, r), count: 1,
                        list: dimension.key === 'species' ? speciesListOf(r) : null });
    }

    return [...seen.values()]
      .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
  },

  /**
   * What every set dimension can still offer, for one question, in one call.
   *
   * The fixture's implementation of `POST /api/v2/mosaic/observations/facets` (A6). Written
   * to that contract rather than to what is convenient here, because the client is written
   * against the contract and not against this file:
   *
   * - each dimension is enumerated with **itself excluded** from the filters, so choosing
   *   one dive does not reduce the dive list to that dive;
   * - every entry carries `{ value, label, count, list }` — the value is what the filter
   *   takes and the label is what a reviewer reads, and for species, model and session
   *   those are genuinely different things (A10a);
   * - `count` is what A10(b) needs to open on the most numerous species rather than on a
   *   name written into the source;
   * - `list` is populated for species only, because a common name identifies a species
   *   only within its list (F15) and A10(c) qualifies a label only when the question spans
   *   more than one.
   */
  async facets({ filters = {}, dimensions, signal } = {}) {
    await latency(60);
    throwIfAborted(signal);

    const wanted = Array.isArray(dimensions)
      ? dimensions
      : DIMENSIONS.filter((d) => d.kind === KIND.SET).map((d) => d.key);

    const out = {};
    for (const key of new Set(wanted)) out[key] = MarpData.optionsFor(key, filters);
    return out;
  },

  /**
   * Where a tile's picture is, as far as the fixture is concerned.
   *
   * The other half of F7. `ui/tile.js` wrote `./fixtures/thumbs/${row.thumb}` into its own
   * markup, which is a URL above `api/` and breaks R1 — and it is a *fixture* path, so it
   * could never have worked against the endpoint. Asking the seam lets the fixture keep
   * its files and lets `src/api/` answer with the route, with the tile knowing neither.
   *
   * `thumb` is a fixture field and deliberately not part of the row shape: the endpoint's
   * row carries no `thumb`, because "the address is derivable from a key this row already
   * carries", and its tripwire asserts the absence.
   */
  thumbnailUrl(row) { return `./fixtures/thumbs/${row && row.thumb}`; },

  /**
   * Which values of the dependent dimensions are still reachable after a change.
   *
   * `model/match.js` needs this to drop only what no longer applies rather than clearing
   * a whole selection -- and only the data layer knows which dives belong to which
   * project.
   *
   * **Plain values, not the labelled options `optionsFor` returns.** `applyDimension` asks
   * "is this value still reachable", and handing it `{ value, label }` objects would make
   * every `Set.has` miss — silently, and it would read as the nesting rule having stopped
   * working. Two shapes, each named for what asks for it.
   */
  reachableUnder(filters) {
    const out = {};
    for (const d of DIMENSIONS) {
      if (d.kind !== KIND.SET || !d.nestsUnder) continue;
      out[d.key] = MarpData.optionsFor(d.key, filters).map((o) => o.value);
    }
    return out;
  },

  /** Free-text search over the taxonomy, as the species chooser needs. */
  async searchSpecies(term, { signal } = {}) {
    await latency(60);
    throwIfAborted(signal);
    const t = (term || '').trim().toLowerCase();
    if (!t) return db.species.slice(0, 6);
    return db.species.filter(
      (s) => s.comname.toLowerCase().includes(t) || s.species.toLowerCase().includes(t)
    );
  },

  /**
   * Fetch an exact set of observations, in the order given. A page that has been
   * committed keeps its membership, so returning to it shows what was submitted
   * rather than whatever the filter now matches.
   */
  async byIds(ids, { signal } = {}) {
    await latency(LATENCY.query);
    throwIfAborted(signal);
    const out = [];
    for (const id of ids) {
      const base = baseFor(id);
      if (base) out.push(served(base, replicaOf(id)));
    }
    return out;
  },

  /**
   * Status counts for the current non-status filters. The rail shows these, and
   * they must move when work is committed — a stale count is worse than none.
   */
  async counts({ filters = {}, signal } = {}) {
    /* The same rule the query uses. This had its own copy of the filter logic, which
       compared a multi-select array with === and silently counted nothing -- the exact
       duplication the declaration was introduced to remove, surviving in the one place
       nobody looked.

       **Not conditioned on either status dimension**, deliberately: `ui/chrome.js` reads
       `state.counts[value]` by value alone, so a borrowed count may exceed the result
       total, exactly as it already could in Delete Mode. */
    const acc = {
      unreviewed: 0, reviewed: 0, flagged: 0,
      undecided: 0, promoted: 0, excluded: 0,
      total: 0
    };
    /* One increment per dimension, keyed by the *filter* value the rail reads counts by --
       so a null decision counts as `unreviewed` / `undecided`, which is exactly what the
       endpoint's `count(*) FILTER (WHERE rc.decision IS NULL)` produces. */
    const add = (r, n) => {
      acc.total += n;
      for (const dim of Object.values(STATUS_DIMENSIONS)) {
        const value = decidedAs(dim, r);
        if (value in acc) acc[value] += n;
      }
    };

    /* Every replica of a base row counts as that row, and then each replica that has been
       written to is corrected: its base row's contribution comes back out and its own
       goes in. A stale count is worse than none, and the rail has to agree with the pager
       at every scale. */
    for (const base of db.observations) {
      if (!base.deleted && matchesFilters(filters, base)) add(base, scaleFactor);
    }
    for (const [id, row] of overlay) {
      const base = baseFor(id);
      if (!base) continue;
      if (!base.deleted && matchesFilters(filters, base)) add(base, -1);
      if (!row.deleted && matchesFilters(filters, row)) add(row, 1);
    }
    return acc;
  },

  /**
   * Filter, sort and page — all of which the real API does server-side. Doing it
   * here keeps the call signature honest about what will be sent over the wire.
   *
   * One page, and it stays: `refresh()` asks for the visible page through this, and it is
   * the only call that participates in the store's sequencing token. `queryPages` below
   * is the page-*set* call the scheduler uses, and both go through `resolve` so the two
   * can never disagree about what page 7 holds.
   */
  async query({
    filters = {}, sort = { field: 'confidence', dir: 'asc' }, page = 1, pageSize = 45,
    exclude, signal
  }) {
    await latency(LATENCY.query);
    throwIfAborted(signal);

    /* Every rail dimension goes through one rule, declared in model/dimensions.js and
       applied by model/match.js, so the fixture and the API cannot disagree about what a
       filter means -- and so adding a dimension is one entry there and nothing here. */
    const plan = resolve(filters, sortTerms(sort), excludedIds(exclude, filters.excludeIds));

    const total = plan.total;
    const start = (page - 1) * pageSize;
    const rows = plan.slice(start, start + pageSize);
    /* Serving a page enqueues what it is missing, the way the endpoint does. */
    enqueueMissing(rows);
    return {
      rows, total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      page, pageSize,
      excludedForNoDate: noDateCount(filters),
    };
  },

  /**
   * A set of pages, in one request, for one question.
   *
   * This is the fixture's implementation of `POST /api/v2/mosaic/observations/pages` --
   * see *The query contract* in `.marp/task.md`. It is written to the contract rather than
   * to what is convenient here, because somebody else writes the endpoint later and
   * everything above this seam is written against the contract, not against this file:
   *
   * - the set **may be discontiguous** — the head, the tail and the neighbourhood of the
   *   current page are not adjacent, and asking for them is one request;
   * - **every page asked for comes back**, de-duplicated and in ascending page order, so
   *   the caller never has to work out which ones arrived;
   * - **a page past the end is `rows: []`, not an error.** The scheduler asks for the tail
   *   speculatively, before it knows the count;
   * - the whole set costs **one** latency, not one per page. That is much of the point of
   *   asking for a set;
   * - **`total` and `pageCount` only when `includeTotal`.** The client asks once per
   *   question and never on a prefetch, so the default here is off.
   *
   * `exclude` is the ids already pinned to a committed page. It is read from either the
   * contract's own field or `filters.excludeIds`, where `queryFilters` puts it, so the
   * store can hand the same filters object to this and to `query`.
   */
  async queryPages({
    filters = {}, sort, pageSize = 45, pages = [], exclude, includeTotal = false, signal
  } = {}) {
    /* Before the latency, as a `400` would be: a rejected request never reaches the wire. */
    const wanted = requestedPages(pages, pageSize);
    await latency(LATENCY.query);
    throwIfAborted(signal);

    const plan = resolve(filters, termsFor(sort), excludedIds(exclude, filters.excludeIds));
    const total = plan.total;

    return {
      pageSize,
      ...(includeTotal
        ? { total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
        : {}),
      pages: wanted.map((page) => {
        const start = (page - 1) * pageSize;
        const rows = plan.slice(start, start + pageSize);
        enqueueMissing(rows);
        return { page, rows, rowCount: rows.length };
      }),
      excludedForNoDate: noDateCount(filters),
      /* Diagnostic. Nothing depends on it. */
      servedAt: new Date().toISOString()
    };
  },

  /**
   * Commit a page. Returns per-observation outcomes rather than a single result:
   * #68 requires that unavailable imagery is skipped without blocking the batch, and
   * that an observation already handled by someone else is reported, not overwritten.
   */
  /**
   * `marks` is a Map of observation_id -> { reason }. A mark is not a transient
   * client state: committing writes it to the record, so a flag survives the page,
   * the session, and the reviewer. #68 requires flagged observations to remain
   * available for correction rather than disappearing.
   */
  /**
   * `observations` is the page as the reviewer saw it, each entry carrying the `version`
   * it was fetched with (A7, R7); `marks` is the exception set as
   * `[{ observation_id, reason }]`; `withdraw` is ids whose decision is being taken back.
   *
   * **Every entry of the answer is keyed `observation_id`** (R8) and the five arrays are
   * not a partition -- `reverted` co-occurs with `flagged` for the same id. That is the
   * endpoint's `MosaicCommitResult`, and it is the shape this returns because the store
   * reads the answer by key: it used to read `r.id`, which blanked every outcome on a
   * committed page (F5).
   *
   * A version that has moved comes back `conflicted` **with nothing written** -- the whole
   * point of the mandatory version. The fixture can produce that: `bumpVersion(ids)` moves
   * a row under the reviewer, so R9's rendering has a tier that can reach it.
   */
  async commitPage({ mode, rows = [], marks = new Map(), withdraw = [], signal } = {}) {
    /* `slowNextCommit` holds this one open; it applies once and then forgets itself, the
       same way `failNextCommit` does. */
    const held = slowNext; slowNext = 0;
    await (held ? delay(held) : latency(LATENCY.commit));
    throwIfAborted(signal);
    if (failNext) { failNext = false; throw new Error('the commit could not be saved'); }
    const reviewed = [], flagged = [], skipped = [], reverted = [], conflicted = [];

    /**
     * **The same arguments `src/api/` takes**, which is R2 and is not a detail.
     *
     * The store hands over the rows it is holding and its marks `Map`; `src/api/` turns
     * those into `observations: [{ observation_id, version }]` and
     * `marks: [{ observation_id, reason }]` on the way to the wire. This took the *wire*
     * shape for a while, so the store's call reached the fixture with an `observations`
     * key it did not send and every commit silently wrote nothing -- forty contract checks
     * failed at once, which is exactly the substitutability the two backings exist to
     * keep honest.
     */
    const observations = rows.map((r) => ({
      observation_id: r.observation_id, version: r.version
    }));
    const marked = marks instanceof Map
      ? marks
      : new Map(marks.map((m) => [m.observation_id, m]));
    const withdrawn = new Set(withdraw);

    for (const entry of observations) {
      const id = entry && entry.observation_id;
      if (!Number.isInteger(entry && entry.version)) {
        throw badRequest(`observation ${JSON.stringify(id)} was sent without a version`);
      }

      /* At scale 1 this is the fixture row, written in place as it always was; deeper it
         is the replica's own overlay copy, so a committed page reads back as committed
         without the whole virtual set being materialised. */
      const row = editable(id);
      if (!row) { skipped.push({ observation_id: id, reason: 'not-found' }); continue; }

      /* The annotation moved since the page was fetched. Nothing is written -- not even
         partially -- and the reviewer is told, rather than their stale decision being
         applied to a classification they never saw. `drift` is `bumpVersion`'s simulated
         second writer; it is 0 for every row nothing has moved. */
      if (row.version + (drift.get(id) || 0) !== entry.version) {
        conflicted.push({ observation_id: id, reason: 'version' });
        continue;
      }

      const isMarked = marked.has(id);

      /* Accepting means somebody looked at it, so it needs a picture. Flagging means
         somebody is saying something is wrong, and a thumbnail that never arrived is
         itself worth flagging -- so a marked row is written whether or not it has
         imagery. This check used to come first and dropped the row before it ever saw
         the mark, which silently threw away flags. */
      if (!isMarked && !withdrawn.has(id) && row.thumbnail_status !== 'ready') {
        skipped.push({ observation_id: id, reason: 'no-imagery' });
        continue;
      }

      if (mode === 'delete') {
        if (isMarked) { row.deleted = true; reviewed.push({ observation_id: id, outcome: 'deleted' }); }
        continue;                                   // unmarked rows are untouched
      }

      const dim = mode === 'scientific'
        ? STATUS_DIMENSIONS.reviewStatus : STATUS_DIMENSIONS.trainingDisposition;
      const accepted = mode === 'scientific' ? 'reviewed' : 'promoted';
      const exception = mode === 'scientific' ? 'flagged' : 'excluded';
      const reasonColumn = dim.reasonColumn;
      /* One column per dimension, holding an **id** -- A13. The fixture used to write four
         name columns (`reviewed_by`, `flagged_by`, `training_approved_by`, `excluded_by`)
         that the endpoint's row has never carried, which is why the client's attribution
         silently became nothing the moment it met a real row (F8). */
      const reviewerColumn = dim.reviewerColumn;

      /* An explicit take-back: `undecided` is the absence of a record, so a withdrawal
         clears the decision rather than storing a fourth value. */
      if (withdrawn.has(id)) {
        row[dim.column] = null;
        row[reasonColumn] = null;
        row[reviewerColumn] = null;
        row.version += 1;
        reverted.push({ observation_id: id, outcome: 'withdrawn' });
        continue;
      }

      if (isMarked) {
        const reason = (marked.get(id) || {}).reason || null;
        const wasAccepted = row[dim.column] === accepted;

        row[dim.column] = exception;
        row[reasonColumn] = reason;
        row[reviewerColumn] = ME.user_id;
        if (mode === 'scientific') row.flagged_at = new Date().toISOString();

        row.version += 1;
        flagged.push({ observation_id: id, outcome: exception });
        if (wasAccepted) reverted.push({ observation_id: id, outcome: exception });
        continue;
      }

      row[dim.column] = accepted;
      row[reasonColumn] = null;
      row[reviewerColumn] = ME.user_id;
      reviewed.push({ observation_id: id, outcome: accepted });
      row.version += 1;
    }

    return {
      atomicity: 'per-observation',
      reviewed, flagged, skipped, reverted, conflicted,
      committedAt: new Date().toISOString()
    };
  },

  /**
   * A single correction, in `MosaicCorrectionResult`'s shape.
   *
   * **`comname` is not touched, ever** -- it is the label the annotator chose, and keeping
   * it frozen is what makes the drift from `species_id` auditable. The current name is
   * `species_comname`. `store.changeSpecies` read `res.observation.comname` as the
   * corrected name, so the "was X" indicator reported the new name as the old one and
   * `from` and `to` came out equal (F6).
   *
   * `version` is required for the same reason the commit requires it: a correction made
   * from a stale view would invalidate review decisions about a classification the
   * corrector never saw.
   */
  async setSpecies({ observationId, speciesId, version, signal } = {}) {
    await latency(LATENCY.species);
    throwIfAborted(signal);
    /* The species is checked first so a correction that cannot be made writes nothing --
       `editable` materialises a replica the moment it is asked for one. */
    const sp = db.species.find((s) => s.species_id === speciesId);
    if (!sp) return { ok: false, error: 'not-found' };
    const row = editable(observationId);
    if (!row) return { ok: false, error: 'not-found' };
    if (!Number.isInteger(version)) {
      throw badRequest(`observation ${JSON.stringify(observationId)} was sent without a version`);
    }
    if (row.version !== version) return { ok: false, error: 'conflicted' };
    if (row.species_id === sp.species_id) return { ok: false, error: 'unchanged' };

    const previous = { species_id: row.species_id, species_comname: currentName(row) };
    row.changed_by = ME.user_id;
    row.species_id = sp.species_id;
    row.species_comname = sp.comname;
    row.scientific_name = sp.species;
    row.version += 1;

    return {
      ok: true,
      observation: {
        observation_id: row.observation_id,
        version: row.version,
        species_id: row.species_id,
        species_comname: row.species_comname,
        /* Unchanged, both of them, and that is the contract rather than an oversight. */
        comname: row.comname,
        taxserial: row.taxserial
      },
      previous,
      correctedAt: new Date().toISOString()
    };
  },

  /**
   * Move a row's version under the reviewer, so a `conflicted` outcome is reachable.
   *
   * A testing affordance like `failNextCommit`. Without it R9 has no tier that can see it:
   * the fixture bumps the version only where the reviewer's own commit did, so nothing
   * inside one client can produce the second reviewer whose write moved the row.
   *
   * @param {number[]} ids - Observations to bump.
   * @returns {number} How many were moved.
   */
  bumpVersion(ids) {
    let moved = 0;
    for (const id of new Set(ids)) {
      if (!baseFor(id)) continue;
      /* **Not `row.version += 1`.** At scale 1 the served row *is* the fixture row, so
         bumping it would bump the very object the store is holding -- the versions would
         still agree and nothing would conflict. A second writer's change is one the
         reviewer's copy has not seen, so it is recorded beside the row rather than in it. */
      drift.set(id, (drift.get(id) || 0) + 1);
      moved++;
    }
    return moved;
  },

  /** Stands in for the thumbnail worker finishing a queued image. */
  async awaitThumbnail(observationId, { signal } = {}) {
    await latency(LATENCY.thumb);
    throwIfAborted(signal);
    const row = editable(observationId);
    if (!row) return { ok: false };
    row.thumbnail_status = 'ready';
    return { ok: true, observation: row };
  }
};
