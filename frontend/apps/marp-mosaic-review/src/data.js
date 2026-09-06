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
import { DIMENSIONS, DIMENSION, KIND } from './model/dimensions.js';

const LATENCY = { query: 140, commit: 260, species: 180, thumb: 900 };

/** Pretend the network exists, so loading states are real rather than theoretical. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let db = null;

/* Testing affordance: the fixture cannot fail on its own, but the API will, and the
   button has to show it. Nothing in the application calls this. */
/* Testing affordance: the fixture cannot fail on its own, but the API will, and the
   button has to show it. Nothing in the application calls this. */
let failNext = false;

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
    const wanted = new Set(ids);
    let broken = 0;
    for (const row of db.observations) {
      if (!wanted.has(row.observation_id)) continue;
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
    const row = db.observations.find((r) => r.observation_id === id);
    if (!row) return null;
    if (row.thumbnail_permanent) return row.thumbnail_status;   // nothing to be done
    row.thumbnail_status = 'ready';
    return 'ready';
  },

  async reload() {
    /* Swap, never null: work already in flight — a queued thumbnail resolving, say —
       still reads `db`, and clearing it first threw where nothing could catch it. */
    const res = await fetch('./fixtures/observations.json');
    if (!res.ok) throw new Error(`fixture failed to reload: ${res.status}`);
    db = await res.json();
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
    const index = new Map(db.observations.map((r) => [r.observation_id, r]));
    return ids.map((id) => index.get(id)).filter(Boolean);
  },

  /**
   * Status counts for the current non-status filters. The rail shows these, and
   * they must move when work is committed — a stale count is worse than none.
   */
  async counts({ filters = {} } = {}) {
    /* The same rule the query uses. This had its own copy of the filter logic, which
       compared a multi-select array with === and silently counted nothing -- the exact
       duplication the declaration was introduced to remove, surviving in the one place
       nobody looked. */
    const rows = db.observations.filter((r) => !r.deleted && matchesFilters(filters, r));
    const n = (fn) => rows.filter(fn).length;
    return {
      unreviewed: n((r) => r.review_status === 'unreviewed'),
      reviewed:   n((r) => r.review_status === 'reviewed'),
      flagged:    n((r) => r.review_status === 'flagged'),
      undecided:  n((r) => r.training_disposition === 'undecided'),
      promoted:   n((r) => r.training_disposition === 'promoted'),
      excluded:   n((r) => r.training_disposition === 'excluded'),
      total: rows.length
    };
  },

  /**
   * Filter, sort and page — all of which the real API does server-side. Doing it
   * here keeps the call signature honest about what will be sent over the wire.
   */
  async query({ filters = {}, sort = { field: 'confidence', dir: 'asc' }, page = 1, pageSize = 45 }) {
    await delay(LATENCY.query);
    let rows = db.observations.filter((r) => !r.deleted);

    /* Every rail dimension goes through one rule, declared in model/dimensions.js and
       applied by model/match.js, so the fixture and the API cannot disagree about what a
       filter means -- and so adding a dimension is one entry there and nothing here. */
    const beforeDimensions = rows.length;
    rows = rows.filter((r) => matchesFilters(filters, r));

    /* The date dimension cannot answer for a row whose `tc` never carried a date, so
       those are excluded -- and counted, because a filter that silently omits looks
       complete and is not. See #76. */
    const excludedForNoDate = unanswerable(filters, db.observations.filter((r) => !r.deleted));

    if (filters.excludeIds && filters.excludeIds.size) {
      rows = rows.filter((r) => !filters.excludeIds.has(r.observation_id));
    }
    if (filters.reviewStatus && filters.reviewStatus.length) {
      rows = rows.filter((r) => filters.reviewStatus.includes(r.review_status));
    }
    if (filters.trainingDisposition && filters.trainingDisposition.length) {
      rows = rows.filter((r) => filters.trainingDisposition.includes(r.training_disposition));
    }

    const dir = sort.dir === 'desc' ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const x = a[sort.field], y = b[sort.field];
      if (x === y) return a.observation_id - b.observation_id;
      return (x > y ? 1 : -1) * dir;
    });

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return {
      rows: rows.slice(start, start + pageSize), total, pageCount, page, pageSize,
      excludedForNoDate,
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
    await delay(LATENCY.commit);
    if (failNext) { failNext = false; throw new Error('the commit could not be saved'); }
    const reviewed = [], flagged = [], skipped = [], reverted = [];

    for (const id of observationIds) {
      const row = db.observations.find((r) => r.observation_id === id);
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
    const row = db.observations.find((r) => r.observation_id === observationId);
    const sp = db.species.find((s) => s.species_id === speciesId);
    if (!row || !sp) return { ok: false, error: 'not-found' };
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
    const row = db.observations.find((r) => r.observation_id === observationId);
    if (!row) return { ok: false };
    row.thumbnail_status = 'ready';
    return { ok: true, observation: row };
  }
};
