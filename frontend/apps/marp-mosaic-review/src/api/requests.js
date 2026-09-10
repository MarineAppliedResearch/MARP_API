/**
 * The request bodies, built from what the store is holding.
 *
 * Separate from `transport.js` because these are testable without a network: a named test
 * asserts **the serialised body** rather than the argument, which is the only way the
 * defects below can be caught. Both of them were invisible at every other tier.
 *
 * `JSON.parse(JSON.stringify(body))` is the assertion to write here, not `deepEqual` on
 * the object. That is not pedantry — it is the whole of F2.
 */

import { excludeIdList } from '../model/filters.js';

/**
 * A list of integer ids, from whatever the caller is holding, or a refusal.
 *
 * **F2, the one #68 calls the defect that costs an afternoon.** `page.pinnedIds()` returns
 * a `Set` — the cache and the scheduler ask it `.has()` questions, so it has to be one —
 * and `JSON.stringify(new Set([1, 2, 3]))` is `{}`. Not an error, not a warning, not a
 * log: the exclusion set left the client as an empty object, the endpoint excluded
 * nothing, and **every committed page came back among the pages still to do**. The
 * arithmetic on screen stays plausible throughout.
 *
 * So this converts a `Set` and **rejects** anything it cannot convert, and R4 asks for
 * exactly that: "a `Set` must be impossible to send". `model/filters.js` converts at the
 * other end too, where the Set gets in. Two guards rather than one, because one guard is a
 * guard somebody routes around six months later.
 *
 * @param {Set<number>|Array<number>|null|undefined} ids
 * @param {string} label - What to call it if it is refused.
 * @returns {Array<number>} Ascending integers. Empty for absent.
 * @throws {TypeError} If it is neither a Set, an array, nor absent.
 */
export function idList(ids, label) {
  if (ids == null) return [];
  if (!(ids instanceof Set) && !Array.isArray(ids)) {
    throw new TypeError(
      `${label} must be an array or a Set of observation ids, not ${typeof ids}. `
      + 'A Set is serialised by JSON.stringify as {}, so sending one silently excludes nothing.'
    );
  }
  const out = [...ids];
  const bad = out.find((id) => !Number.isInteger(id));
  if (bad !== undefined) {
    throw new TypeError(`${label} takes observation ids as integers, not ${JSON.stringify(bad)}`);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The filters, as `MosaicQueryFilters`.
 *
 * Three things happen here and each is a finding:
 *
 * - **`excludeIds` comes out of `filters` and becomes the top-level `exclude`** (F2). The
 *   endpoint reads either, but a `Set` nested inside a filters object is how the first one
 *   travelled unnoticed, so nothing here lets one back in.
 * - **`date` is sent, and today the endpoint refuses it** (A14, A17). It is **not** dropped
 *   here, deliberately. A14 settled that the control stays; what a `tc` range should
 *   actually compare is A17, which is open — so until it is answered the filter reaches the
 *   endpoint and comes back as a loud 400 naming #76. Dropping it silently was considered
 *   and rejected: a filter that omits rows without saying so is worse than one that fails,
 *   which is the premise #76 itself rests on.
 * - **the key-valued dimensions are sent as integers** (F1, A14). `species`, `model` and
 *   `session` are `int[]`, and the endpoint refuses a name rather than matching nothing:
 *   `filters.species takes integer ids, not "Bat Star"`.
 */
export function filtersBody(filters = {}) {
  const out = {};
  const keys = [
    'project', 'dive', 'line', 'sessionType',
    'confidence', 'timeOfDay', 'date', 'reviewStatus', 'trainingDisposition'
  ];

  for (const key of keys) {
    const value = filters[key];
    if (value == null) continue;
    if (Array.isArray(value) && !value.length) continue;
    out[key] = Array.isArray(value) ? [...value] : value;
  }

  for (const key of ['species', 'model', 'session']) {
    const value = filters[key];
    if (value == null || (Array.isArray(value) && !value.length)) continue;
    const ids = idList(value, `filters.${key}`);
    if (ids.length) out[key] = ids;
  }

  return out;
}

/**
 * `POST /api/v2/mosaic/observations/pages`.
 *
 * R3: a **visible** page is one call with `includeTotal: true`; a **prefetch** is one call
 * with `includeTotal` absent. The total is one number per question, and asking for it on
 * a prefetch is a second full pass over the matching set for something the client already
 * has.
 *
 * `sort` reaches the wire as the array of terms the contract takes, from either shape the
 * store may be holding — `sortTerms` is the rule that turns the client's one
 * `{ field, dir, then }` object into them, and `observation_id` is deliberately not among
 * them: the server appends it, always, and so does the client.
 */
export function pagesBody({ filters, sort, pageSize, pages, exclude, includeTotal }) {
  const body = {
    filters: filtersBody(filters),
    pageSize,
    pages: [...new Set(pages)].sort((a, b) => a - b)
  };

  if (sort && sort.length) body.sort = sort.map((t) => ({ field: t.field, dir: t.dir }));

  /* Read from either place the store may have put them, and out of `filters` either way. */
  const excluded = idList(
    exclude != null ? exclude : excludeIdList(filters && filters.excludeIds), 'exclude'
  );
  if (excluded.length) body.exclude = excluded;
  if (includeTotal) body.includeTotal = true;

  return body;
}

/** `POST /api/v2/mosaic/observations/counts`. The non-status filters only, server-side. */
export const countsBody = ({ filters }) => ({ filters: filtersBody(filters) });

/**
 * `MosaicCommitRequest`, from the rows the reviewer is actually looking at (A7, R7).
 *
 * **The version travels with the row, not from a cache in this file.** An `api/`-side map
 * of "the version I last served for each id" was the other candidate and it is rejected on
 * reasoning rather than taste: a prefetch or a poll would refresh that map to a version
 * the reviewer never saw, so a stale decision would be applied silently — which is the
 * exact failure the mandatory version exists to prevent. So the store hands over the rows.
 *
 * **A request with a missing version is not constructible** (R7). A row without one throws
 * here rather than reaching the endpoint, which would answer 400 — the 400 is the right
 * answer and a client that can build the request is a client with a latent bug.
 */
export function commitBody({ rows = [], marks = new Map(), withdraw = [] } = {}) {
  const observations = rows.map((row) => {
    if (!Number.isInteger(row && row.observation_id)) {
      throw new TypeError(`a commit needs an observation_id, got ${JSON.stringify(row)}`);
    }
    if (!Number.isInteger(row.version)) {
      throw new TypeError(
        `observation ${row.observation_id} has no version, so it cannot be committed. `
        + 'The version the reviewer saw is what makes a stale decision detectable; a commit '
        + 'without one would be a silent overwrite.'
      );
    }
    return { observation_id: row.observation_id, version: row.version };
  });

  const onPage = new Set(observations.map((o) => o.observation_id));

  /* An array of `{ observation_id, reason }`, never the store's Map -- the same
     serialisation trap as F2, one field over. Every id must be on the page, which the
     endpoint enforces with a 400; filtering here means a mark left over from another page
     cannot turn a commit into a failure. */
  const body = {
    observations,
    marks: [...marks.entries()]
      .filter(([id]) => onPage.has(id))
      .map(([observation_id, mark]) => ({
        observation_id,
        reason: (mark && mark.reason) || null
      }))
  };

  const taken = idList(withdraw, 'withdraw').filter((id) => onPage.has(id));
  if (taken.length) body.withdraw = taken;

  return body;
}

/** `MosaicCorrectionRequest`. `version` is required for the same reason a commit's is. */
export function correctionBody({ observationId, speciesId, version }) {
  if (!Number.isInteger(version)) {
    throw new TypeError(
      `observation ${observationId} has no version, so its species cannot be corrected. `
      + 'A correction invalidates review decisions belonging to other people, so one made '
      + 'from a stale view would invalidate decisions about a classification the corrector '
      + 'never saw.'
    );
  }
  return { observation_id: observationId, version, species_id: speciesId };
}

/** `POST /api/v2/observations/thumbnails/retry`. A page in one request (A9, R11). */
export const retryBody = (ids) => ({ observationIds: idList(ids, 'observationIds') });

/**
 * `POST /api/v2/mosaic/observations/facets`.
 *
 * The same filters object the page query takes, so one serialiser feeds three routes and
 * they cannot disagree about what the question was. `dimensions` absent means all of them.
 */
export function facetsBody({ filters, dimensions } = {}) {
  const body = { filters: filtersBody(filters) };
  if (Array.isArray(dimensions)) body.dimensions = [...dimensions];
  return body;
}
