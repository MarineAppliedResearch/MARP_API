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

const LATENCY = { query: 140, commit: 260, species: 180, thumb: 900 };

/** Pretend the network exists, so loading states are real rather than theoretical. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let db = null;

export const MarpData = {
  async load() {
    if (db) return db;
    const res = await fetch('./fixtures/observations.json');
    if (!res.ok) throw new Error(`fixture failed to load: ${res.status}`);
    db = await res.json();
    return db;
  },

  species() { return db.species; },
  projects() { return db.projects; },

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
   * Status counts for the current non-status filters. The rail shows these, and
   * they must move when work is committed — a stale count is worse than none.
   */
  async counts({ filters = {} } = {}) {
    let rows = db.observations.filter((r) => !r.deleted);
    if (filters.species) rows = rows.filter((r) => r.comname === filters.species);
    if (filters.project) rows = rows.filter((r) => r.project_name === filters.project);
    if (filters.dive)    rows = rows.filter((r) => r.dive === filters.dive);
    const n = (fn) => rows.filter(fn).length;
    return {
      unreviewed: n((r) => r.review_status === 'unreviewed'),
      reviewed:   n((r) => r.review_status === 'reviewed'),
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

    if (filters.species)  rows = rows.filter((r) => r.comname === filters.species);
    if (filters.project)  rows = rows.filter((r) => r.project_name === filters.project);
    if (filters.dive)     rows = rows.filter((r) => r.dive === filters.dive);
    if (filters.minConfidence != null) rows = rows.filter((r) => r.confidence >= filters.minConfidence);
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
    return { rows: rows.slice(start, start + pageSize), total, pageCount, page, pageSize };
  },

  /**
   * Commit a page. Returns per-observation outcomes rather than a single result:
   * #68 requires that unavailable imagery is skipped without blocking the batch, and
   * that an observation already handled by someone else is reported, not overwritten.
   */
  async commitPage({ mode, observationIds, marked }) {
    await delay(LATENCY.commit);
    const reviewed = [], skipped = [], reverted = [];

    for (const id of observationIds) {
      const row = db.observations.find((r) => r.observation_id === id);
      if (!row) { skipped.push({ id, reason: 'not-found' }); continue; }
      if (row.thumbnail_status !== 'ready') { skipped.push({ id, reason: 'no-imagery' }); continue; }

      const isMarked = marked.has(id);

      if (mode === 'delete') {
        if (isMarked) { row.deleted = true; reviewed.push({ id, outcome: 'deleted' }); }
        continue;                                   // unmarked rows are untouched
      }
      if (isMarked) {
        /* Undo: the reviewer marked something they had already accepted here, so the
           commit takes that acceptance back rather than silently ignoring it. */
        if (mode === 'scientific' && row.review_status === 'reviewed') {
          row.review_status = 'unreviewed'; row.reviewed_by = null; row.version += 1;
          reverted.push({ id, outcome: 'reverted' });
        } else if (mode === 'training' && row.training_disposition === 'promoted') {
          row.training_disposition = 'undecided'; row.training_approved_by = null; row.version += 1;
          reverted.push({ id, outcome: 'reverted' });
        } else {
          skipped.push({ id, reason: 'marked' });
        }
        continue;
      }

      if (mode === 'scientific') {
        row.review_status = 'reviewed';
        row.reviewed_by = 'I. Travers';
        reviewed.push({ id, outcome: 'reviewed' });
      } else if (mode === 'training') {
        row.training_disposition = 'promoted';
        row.training_approved_by = 'I. Travers';
        reviewed.push({ id, outcome: 'promoted' });
      }
      row.version += 1;
    }
    return { reviewed, skipped, reverted };
  },

  /** A single correction. Returns the authoritative row, as the API will. */
  async setSpecies(observationId, speciesId) {
    await delay(LATENCY.species);
    const row = db.observations.find((r) => r.observation_id === observationId);
    const sp = db.species.find((s) => s.species_id === speciesId);
    if (!row || !sp) return { ok: false, error: 'not-found' };
    const previous = { comname: row.comname, scientific_name: row.scientific_name };
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
