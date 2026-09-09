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

const ME = 'I. Travers';

import { matchesFilters, unanswerable } from './model/match.js';
import { DIMENSIONS, DIMENSION, KIND, isActive } from './model/dimensions.js';
/* Same reason as `matchesFilters`: which comparisons a query makes, in which order, is a
   rule, and a second copy of it here is a second place for the fixture and the API to
   disagree about what a sort means. */
import { sortTerms } from './model/filters.js';

const LATENCY = { query: 140, commit: 260, species: 180, thumb: 900 };

/** Pretend the network exists, so loading states are real rather than theoretical. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* The two status dimensions are not in `DIMENSIONS`, so `matchesFilters` cannot see them.
   An empty array means **not filtering** -- never the owning mode's default. #89. */
const statusMatches = (filters, r) =>
  (!filters.reviewStatus || !filters.reviewStatus.length
    || filters.reviewStatus.includes(r.review_status))
  && (!filters.trainingDisposition || !filters.trainingDisposition.length
    || filters.trainingDisposition.includes(r.training_disposition));

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
  async load() {
    if (db) return db;
    const res = await fetch('./fixtures/observations.json');
    if (!res.ok) throw new Error(`fixture failed to load: ${res.status}`);
    db = await res.json();
    return db;
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
    return scaleFactor;
  },

  /** The scale in force. */
  scale() { return scaleFactor; },

  /**
   * Break the imagery for a set of observations, so the states a reviewer meets on a bad
   * day can be reached deliberately.
   *
   * A testing affordance, like `failNextCommit`. None of the empty-and-broken states was
   * reachable before this: the fixture is uniformly healthy, so the only way to see a page
   * of failed thumbnails was to edit the fixture by hand and forget to put it back.
   *
   * @param {number[]|'page'} ids  observation ids, or 'page' for everything currently loaded
   * @param {string} [status]      'failed' (default) or 'queued'
   */
  breakThumbnails(ids, status = 'failed') {
    let broken = 0;
    for (const id of new Set(ids)) {
      const row = editable(id);
      if (!row) continue;
      row.thumbnail_status = status;
      broken++;
    }
    return broken;
  },

  /**
   * Ask for a thumbnail again.
   *
   * The real thing is the server noticing the thumbnail is missing and fetching it; this
   * is the seam that call will go through. It fails a second time for anything the fixture
   * has marked permanently broken, so a retry that cannot help does not pretend to.
   */
  async retryThumbnail(id) {
    await delay(LATENCY.thumb);
    const base = baseFor(id);
    if (!base) return null;
    const current = served(base, replicaOf(id));
    if (current.thumbnail_permanent) return current.thumbnail_status;   // nothing to be done
    editable(id).thumbnail_status = 'ready';
    return 'ready';
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
    return db;
  },

  species() { return db.species; },
  projects() { return db.projects; },

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

    return [...new Set(rows.map((r) => r[dimension.field]))]
      .filter((v) => v != null && v !== '')
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  },

  /**
   * Which values of the dependent dimensions are still reachable after a change.
   *
   * `model/match.js` needs this to drop only what no longer applies rather than clearing
   * a whole selection -- and only the data layer knows which dives belong to which
   * project.
   */
  reachableUnder(filters) {
    const out = {};
    for (const d of DIMENSIONS) {
      if (d.kind !== KIND.SET || !d.nestsUnder) continue;
      out[d.key] = MarpData.optionsFor(d.key, filters);
    }
    return out;
  },

  /** Free-text search over the taxonomy, as the species chooser needs. */
  async searchSpecies(term) {
    await delay(60);
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
  async byIds(ids) {
    await delay(LATENCY.query);
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
  async counts({ filters = {} } = {}) {
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
    const add = (r, n) => {
      acc.total += n;
      if (r.review_status === 'unreviewed') acc.unreviewed += n;
      else if (r.review_status === 'reviewed') acc.reviewed += n;
      else if (r.review_status === 'flagged') acc.flagged += n;
      if (r.training_disposition === 'undecided') acc.undecided += n;
      else if (r.training_disposition === 'promoted') acc.promoted += n;
      else if (r.training_disposition === 'excluded') acc.excluded += n;
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
  async query({ filters = {}, sort = { field: 'confidence', dir: 'asc' }, page = 1, pageSize = 45 }) {
    await delay(LATENCY.query);

    /* Every rail dimension goes through one rule, declared in model/dimensions.js and
       applied by model/match.js, so the fixture and the API cannot disagree about what a
       filter means -- and so adding a dimension is one entry there and nothing here. */
    const plan = resolve(filters, sortTerms(sort), excludedIds(filters.excludeIds));

    const total = plan.total;
    const start = (page - 1) * pageSize;
    return {
      rows: plan.slice(start, start + pageSize), total,
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
    filters = {}, sort, pageSize = 45, pages = [], exclude, includeTotal = false
  } = {}) {
    /* Before the latency, as a `400` would be: a rejected request never reaches the wire. */
    const wanted = requestedPages(pages, pageSize);
    await delay(LATENCY.query);

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
  async commitPage({ mode, observationIds, marks }) {
    /* `slowNextCommit` holds this one open; it applies once and then forgets itself, the
       same way `failNextCommit` does. */
    const held = slowNext; slowNext = 0;
    await delay(held || LATENCY.commit);
    if (failNext) { failNext = false; throw new Error('the commit could not be saved'); }
    const reviewed = [], flagged = [], skipped = [], reverted = [];

    for (const id of observationIds) {
      /* At scale 1 this is the fixture row, written in place as it always was; deeper it
         is the replica's own overlay copy, so a committed page reads back as committed
         without the whole virtual set being materialised. */
      const row = editable(id);
      if (!row) { skipped.push({ id, reason: 'not-found' }); continue; }
      const isMarked = marks.has(id);

      /* Accepting means somebody looked at it, so it needs a picture. Flagging means
         somebody is saying something is wrong, and a thumbnail that never arrived is
         itself worth flagging -- so a marked row is written whether or not it has
         imagery. This check used to come first and dropped the row before it ever saw
         the mark, which silently threw away flags. */
      if (!isMarked && row.thumbnail_status !== 'ready') {
        skipped.push({ id, reason: 'no-imagery' });
        continue;
      }

      if (mode === 'delete') {
        if (isMarked) { row.deleted = true; reviewed.push({ id, outcome: 'deleted' }); }
        continue;                                   // unmarked rows are untouched
      }
      if (isMarked) {
        const reason = (marks.get(id) || {}).reason || null;
        const wasAccepted = mode === 'scientific'
          ? row.review_status === 'reviewed'
          : row.training_disposition === 'promoted';

        if (mode === 'scientific') {
          row.review_status = 'flagged';
          row.flag_reason = reason;
          row.flagged_by = ME;
          row.flagged_at = new Date().toISOString();
          row.reviewed_by = null;
        } else {
          row.training_disposition = 'excluded';
          row.exclusion_reason = reason;
          row.excluded_by = ME;
          row.training_approved_by = null;
        }
        row.version += 1;
        const outcome = mode === 'scientific' ? 'flagged' : 'excluded';
        flagged.push({ id, outcome });
        if (wasAccepted) reverted.push({ id, outcome });   // an acceptance was withdrawn
        continue;
      }

      if (mode === 'scientific') {
        row.review_status = 'reviewed';
        row.flag_reason = null; row.flagged_by = null;
        row.reviewed_by = 'I. Travers';
        reviewed.push({ id, outcome: 'reviewed' });
      } else if (mode === 'training') {
        row.training_disposition = 'promoted';
        row.exclusion_reason = null; row.excluded_by = null;
        row.training_approved_by = 'I. Travers';
        reviewed.push({ id, outcome: 'promoted' });
      }
      row.version += 1;
    }
    return { reviewed, flagged, skipped, reverted };
  },

  /** A single correction. Returns the authoritative row, as the API will. */
  async setSpecies(observationId, speciesId) {
    await delay(LATENCY.species);
    /* The species is checked first so a correction that cannot be made writes nothing --
       `editable` materialises a replica the moment it is asked for one. */
    const sp = db.species.find((s) => s.species_id === speciesId);
    if (!sp) return { ok: false, error: 'not-found' };
    const row = editable(observationId);
    if (!row) return { ok: false, error: 'not-found' };
    const previous = { comname: row.comname, scientific_name: row.scientific_name };
    row.previous_comname = row.comname;
    row.changed_by = ME;
    row.species_id = sp.species_id;
    row.comname = sp.comname;
    row.scientific_name = sp.species;
    row.taxserial = sp.taxserial;
    row.version += 1;
    return { ok: true, observation: row, previous };
  },

  /** Stands in for the thumbnail worker finishing a queued image. */
  async awaitThumbnail(observationId) {
    await delay(LATENCY.thumb);
    const row = editable(observationId);
    if (!row) return { ok: false };
    row.thumbnail_status = 'ready';
    return { ok: true, observation: row };
  }
};
