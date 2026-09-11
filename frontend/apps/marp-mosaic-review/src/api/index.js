/**
 * The seam, backed by MARP_API.
 *
 * **The same method set `src/data.js` presents** (R2), so `src/store.js`, `src/ui/` and
 * `src/model/` go on calling the seam and never the network. That substitutability is the
 * claim Phase 8 exists to test — *"if phases 0 and 4–7 held their contracts, nothing above
 * `api/` changes"* — and it is a **measurement**, so an adapter that renamed the
 * endpoint's fields back into the client's old private vocabulary would make the claim
 * pass by destroying what it measures. A1 settled that: the client adopts the schema's
 * names, the differences get *counted*, and this file does no translation at all.
 *
 * Every method takes an optional `AbortSignal` (A16, R21). A superseded request is
 * genuinely cancelled rather than ignored on arrival: the store's sequencing token already
 * stops a late response landing on screen, but against a real endpoint each abandoned
 * prefetch is a full pass over the matching set that nobody will read.
 *
 * **There is no `byIds`, and that is A5 struck rather than A5 unfinished.** The design
 * wanted a by-ids route so a committed page could be re-read; the human pointed out that
 * the capability already exists — `model/cache.js:163` states the invariant in as many
 * words, *"a committed page is served without a request when every id it holds is here"*,
 * and `rowsFor(ids)` is there to answer it. #99 built it and the design had missed it. So
 * R14 is met by the cache and costs no request at all, and this seam is one method smaller
 * than it was going to be.
 */

import { request, thumbnailUrl } from './transport.js';
import {
  pagesBody, countsBody, commitBody, correctionBody, retryBody, facetsBody, filtersBody,
  idList
} from './requests.js';
import { sortTerms } from '../model/filters.js';

/** The three commit routes. One per mode, which is what keeps them splittable (#106 R1). */
const COMMIT_PATH = {
  scientific: '/mosaic/observations/review',
  training: '/mosaic/observations/training',
  delete: '/mosaic/observations/delete'
};

/**
 * The comparisons a query makes, from either shape the store may be holding.
 *
 * Mirrors `termsFor` in `src/data.js` deliberately: the wire carries an array of
 * `{ field, dir }`, the store holds one `{ field, dir, then }` object, and `sortTerms` is
 * the rule that turns the second into the first. Both backings reading the same rule is
 * what stops them disagreeing about what a sort means.
 */
const termsFor = (sort) =>
  (Array.isArray(sort) && sort.length)
    ? sort.map((t) => ({ field: t && t.field, dir: (t && t.dir === 'desc') ? 'desc' : 'asc' }))
    : sortTerms(Array.isArray(sort) ? null : sort);

export const MarpApi = {
  /**
   * Nothing to load, and that is the point.
   *
   * The fixture fetches 3.4 MB of JSON here. Against the API the client starts with no
   * data at all and the first `refresh()` asks the question, so this only settles **who
   * the reviewer is** (R19) — which the interface needs before it can draw "by you" or a
   * name in the header.
   */
  async load({ signal } = {}) {
    return { me: await MarpApi.whoami({ signal }) };
  },

  /**
   * The signed-in reviewer, from the server (R19).
   *
   * `src/data.js:13` and `src/ui/dom.js:24` both held the literal `'I. Travers'`, so "by
   * you" was true for one person on one machine and quietly false for everybody else.
   *
   * `/api/v2/auth/me` answers 401 with no session, which the transport turns into the
   * `expired` state — so an unauthenticated visitor meets the sign-in panel rather than an
   * application that looks broken.
   */
  async whoami({ signal } = {}) {
    const body = await request('/auth/me', { signal });
    const user = (body && body.user) || null;
    return user && {
      user_id: user.user_id,
      name: user.name,
      username: user.username
    };
  },

  /** One visible page. R3: `includeTotal`, once per question. */
  async query({ filters = {}, sort, page = 1, pageSize = 45, exclude, signal } = {}) {
    const body = pagesBody({
      filters, sort: termsFor(sort), pageSize, pages: [page], exclude, includeTotal: true
    });
    const res = await request('/mosaic/observations/pages', { method: 'POST', body, signal });
    const answer = (res.pages || []).find((p) => p.page === page) || { rows: [] };

    return {
      rows: answer.rows,
      total: res.total,
      pageCount: res.pageCount,
      page,
      pageSize: res.pageSize,
      excludedForNoDate: res.excludedForNoDate || 0
    };
  },

  /** A discontiguous set of pages, in one request. R3: no `includeTotal` on a prefetch. */
  async queryPages({
    filters = {}, sort, pageSize = 45, pages = [], exclude, includeTotal = false, signal
  } = {}) {
    const body = pagesBody({
      filters, sort: termsFor(sort), pageSize, pages, exclude, includeTotal
    });
    return request('/mosaic/observations/pages', { method: 'POST', body, signal });
  },

  /**
   * The six status counts.
   *
   * Its `total` is over a **different and larger set** than the page query's — this one
   * applies no status filter at all — and the two are never substituted for one another.
   */
  async counts({ filters = {}, signal } = {}) {
    return request('/mosaic/observations/counts', {
      method: 'POST', body: countsBody({ filters }), signal
    });
  },

  /**
   * Commit the page. `rows` rather than ids, so the version travels with what was seen.
   *
   * The signature differs from the fixture's old `{ mode, observationIds, marks }` and
   * that difference **is** F4: the endpoint requires `observations: [{ observation_id,
   * version }]` with the version mandatory, and the store was passing neither. A leak, and
   * it is counted rather than hidden inside an adapter.
   */
  async commitPage({ mode, rows = [], marks = new Map(), withdraw = [], signal } = {}) {
    const path = COMMIT_PATH[mode];
    if (!path) throw new TypeError(`no commit route for mode ${JSON.stringify(mode)}`);
    /* Delete records no decision, so it takes no withdrawal -- the endpoint refuses one. */
    const body = commitBody({ rows, marks, withdraw: mode === 'delete' ? [] : withdraw });
    return request(path, { method: 'POST', body, signal });
  },

  /** One species correction. Both applied and refused are 200; the caller branches on `ok`. */
  async setSpecies({ observationId, speciesId, version, signal } = {}) {
    return request('/mosaic/observations/species', {
      method: 'POST',
      body: correctionBody({ observationId, speciesId, version }),
      signal
    });
  },

  /**
   * Ask again for a page of thumbnails: **one request** for the whole page (A9, R11).
   *
   * It answers `queued` and never a synchronous `ready`, and refuses a permanent failure
   * rather than re-queueing it — so `permanent` is a state the client finally has data
   * for (F11, R13).
   */
  async retryThumbnails(observationIds = [], { signal } = {}) {
    return request('/observations/thumbnails/retry', {
      method: 'POST', body: retryBody(observationIds), signal
    });
  },

  /**
   * Where a tile's picture is (R10, F7). A URL, not a fetch — see `transport.js`.
   *
   * **It takes the row, not the id**, and that is what keeps R1 true. The tile used to
   * write `./fixtures/thumbs/${row.thumb}` into its own markup, which is a URL above
   * `api/`; asking the seam means the fixture can answer with its own file path and this
   * can answer with the route, and `ui/tile.js` never learns that either exists.
   */
  thumbnailUrl: (row) => thumbnailUrl(row && row.observation_id),

  /**
   * Free-text search over the taxonomy, as the correction picker needs (A11).
   *
   * **A null `list` is a search over every list, not a refusal.** It used to be
   * `if (!q || !list) return []`, which meant the picker drew "Nothing matches" having
   * sent nothing at all — and the widen action, which sets the list to null by design,
   * could never have returned anything either (#130). Both halves are the same line.
   *
   * The empty term stays answered here, without a round trip: both routes reject an empty
   * `q` with a 400, deliberately, because "an empty search returning all 224 entries reads
   * as a working search".
   */
  async searchSpecies(term, { list, signal } = {}) {
    const q = String(term || '').trim();
    if (!q) return [];
    const path = list
      ? `/species/list/${encodeURIComponent(list)}/search?q=${encodeURIComponent(q)}`
      : `/species/search?q=${encodeURIComponent(q)}`;
    return request(path, { signal });
  },

  /**
   * What each rail dimension can still offer under the filters already chosen (R15, A6).
   *
   * This replaces `MarpData.optionsFor(key, filters)` and `MarpData.reachableUnder(filters)`,
   * and it is F12 answered rather than F12 worked around. Those two scanned the whole
   * fixture **synchronously**, from a render path (`ui/menus.js:196`) and from inside two
   * actions (`store.js:890,901`) — which is not available over a network at any size, and
   * making them async would have changed `ui/menus.js` and `store.js`, a leak above `api/`.
   *
   * One call per **question** instead, held in `state.facets`, so the rail reads state
   * synchronously exactly as it always did and the leak does not happen. That is a better
   * outcome than the one A6 predicted, and it is worth saying so: the async change F12
   * warned about is avoided by asking once per question rather than once per menu.
   */
  async facets({ filters = {}, dimensions, signal } = {}) {
    const res = await request('/mosaic/observations/facets', {
      method: 'POST', body: facetsBody({ filters, dimensions }), signal
    });
    return (res && res.facets) || {};
  },

  /* The fixture's testing affordances have no counterpart against a real server, and
     saying so out loud is F17. `withoutLatency` in particular refuses to act in a browser
     precisely so that no browser tier can get an instant backend and pass a no-spinner
     assertion vacuously; there is nothing to switch off here. */
  filtersBody,
  idList
};
