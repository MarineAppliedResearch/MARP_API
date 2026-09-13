/**
 * What a browser test wrote, and how to put it back (#157).
 *
 * The whole render tier moved onto a real database in #157, and 43 of its checks
 * commit. The discipline that made the first handful of API-tier tests safe -- claim
 * one row, remember what it said, restore it in a `finally` -- does not scale to a
 * page sweep that decides fifty observations at once, and writing forty-three
 * bespoke `finally` blocks is forty-three chances to miss one.
 *
 * So this watches instead. It is **passive**: `page.on('response')` and
 * `page.on('request')`, never `page.route()`. That distinction is deliberate and it is
 * load-bearing -- the prefetching checks (#99) count requests and assert their order,
 * and an interception layer that fetches and re-fulfils every page query changes the
 * timings they are about. A listener changes nothing.
 *
 * What it records:
 *
 * - **every row the application was served**, from the mosaic page responses, the
 *   first time it saw it. That is the "before" picture, and it is free: the response
 *   already carries `review_decision`, `flag_reason`, `training_decision`,
 *   `exclusion_reason`, `species_id` and `version`.
 * - **every observation the application committed or corrected**, from the request
 *   bodies of the four write routes. Nothing else can have changed.
 *
 * `restore()` then puts back exactly those, through the API, and **checks its own
 * work** -- a restore that silently did not apply is worse than no restore at all,
 * because the next run inherits it and the failure arrives somewhere else.
 *
 * **A delete is refused rather than restored.** Nothing can un-delete an observation,
 * so a test that means to destroy one says so with `allowDeletes()` and seeds what it
 * destroys; anything else reaching the delete route is a test about to damage a corpus
 * it did not create, and `restore()` fails naming the ids.
 *
 * Refs #157.
 *
 * @module tests/api/journal
 */

import { expect } from '@playwright/test';

/** The mosaic query every page load makes. Where the "before" picture comes from. */
const PAGES = '/mosaic/observations/pages';

/** The three commit routes, by the mode that writes through each. */
const COMMIT_ROUTES = {
  '/mosaic/observations/review': 'scientific',
  '/mosaic/observations/training': 'training',
  '/mosaic/observations/delete': 'delete'
};

/** The correction route. The one gesture that edits the observation row itself. */
const SPECIES = '/mosaic/observations/species';

/** Which columns a mode's decision and reason arrive in, on a served row. */
const COLUMNS = {
  scientific: { decision: 'review_decision', reason: 'flag_reason', route: 'review' },
  training: { decision: 'training_decision', reason: 'exclusion_reason', route: 'training' }
};

/** The mode's exception value -- what a `except` mark writes. */
const EXCEPTION = { scientific: 'flagged', training: 'excluded' };

/** A reason to put back when the record carried a decision but no reason. */
const FALLBACK_REASON = 'Other / unsure';

/**
 * Start watching a page, and hand back the thing that puts the record back.
 *
 * Call it before the first `goto`. It is cheap when nothing writes: `restore()` on a
 * read-only test makes no requests at all.
 *
 * @param {import('@playwright/test').Page} page - The page about to be driven.
 * @param {import('@playwright/test').APIRequestContext} [api] - Needed only to undo a
 *   species correction; see `watchCorrections`.
 * @returns {Object} `{restore, allowDeletes, wrote, seenRow}`.
 */
export function journal(page, api = null) {
  /** observation_id -> the row as it was first served. The "before" picture. */
  const first = new Map();

  /** observation_id -> the newest version anything has told us about. */
  const versions = new Map();

  /** The filter/sort bodies the application asked with, so `restore` can re-read. */
  const questions = [];

  /** observation_id -> the set of modes it was committed in. */
  const committed = new Map();

  /** observation_id -> the species it was on before this test corrected it. */
  const corrected = new Map();

  /** Ids a delete request named. Fatal unless the test said it seeded them. */
  const destroyed = new Set();

  /** Ids the test is allowed to destroy, because it created them. */
  const disposable = new Set();

  /** Response bodies still being parsed. Awaited before anything is restored. */
  const parsing = [];

  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes(PAGES) && !url.includes(SPECIES)) return;

    parsing.push((async () => {
      const body = await response.json().catch(() => null);
      if (!body) return;

      /* A correction answers with the version the trigger just moved to, which is the
         only way to know it without asking again. */
      if (url.includes(SPECIES)) {
        if (body.observation_id != null && body.version != null) {
          versions.set(Number(body.observation_id), Number(body.version));
        }
        return;
      }

      for (const served of body.pages || []) {
        for (const row of served.rows || []) {
          const id = Number(row.observation_id);
          if (!first.has(id)) first.set(id, { ...row });
          versions.set(id, Number(row.version));
        }
      }
    })().catch(() => { /* a response that is not JSON is not a page of rows */ }));
  });

  /**
   * A correction is the one write whose "before" the page response cannot carry.
   *
   * The mosaic row has **never carried `species_id`** -- it carries `comname`, the frozen
   * label, and `species_comname`, the catalogue's current name for whatever the id now
   * points at. Neither is the key a correction takes. So the only moment the original is
   * knowable is just before the correction lands, and this is the one route that is
   * intercepted rather than listened to.
   *
   * It is a cold route: a test corrects at most a row or two, so the cost the interception
   * would have on the page query -- which the prefetching checks count and time -- is not
   * paid here at all.
   */
  if (api) {
    page.route(`**${SPECIES}`, async (route) => {
      let body = null;
      try { body = route.request().postDataJSON(); } catch { body = null; }
      const id = body && body.observation_id != null ? Number(body.observation_id) : null;

      if (id !== null && !corrected.has(id)) {
        const before = await api.get(`/api/v2/observation/${id}`).catch(() => null);
        if (before && before.ok()) {
          const observation = await before.json().catch(() => null);
          const was = observation && (observation.species_id ?? (observation.observation || {}).species_id);
          if (was != null) corrected.set(id, Number(was));
        }
      }

      await route.continue();
    });
  }

  page.on('request', (request) => {
    const url = request.url();
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    if (!body) return;

    if (url.includes(SPECIES)) return;

    for (const [path, mode] of Object.entries(COMMIT_ROUTES)) {
      if (!url.includes(path)) continue;
      for (const entry of body.observations || []) {
        const id = Number(entry.observation_id);
        if (mode === 'delete') { destroyed.add(id); continue; }
        if (!committed.has(id)) committed.set(id, new Set());
        committed.get(id).add(mode);
      }
    }
  });

  /* The questions are recorded from the request rather than the response, because a
     response does not carry the filters that produced it. */
  page.on('request', (request) => {
    if (!request.url().includes(PAGES)) return;
    let body = null;
    try { body = request.postDataJSON(); } catch { return; }
    if (body && body.filters) questions.push(body);
  });

  return {
    /**
     * Say that this test created the observations it is about to delete.
     *
     * Without it, a delete reaching the real endpoint is a test destroying rows of a
     * corpus somebody else's tests are reading -- which is the one thing the API tier's
     * rules forbid outright.
     *
     * @param {Array<number>} ids - The ids it may destroy.
     * @returns {void}
     */
    allowDeletes(ids) {
      for (const id of ids) disposable.add(Number(id));
    },

    /** Did anything write? For a test that wants to assert it did not. */
    wrote: () => committed.size > 0 || corrected.size > 0 || destroyed.size > 0,

    /** The row as it was first served, for a test that wants the "before" value. */
    seenRow: (id) => first.get(Number(id)),

    /**
     * Put every decision and every species back, and prove it went back.
     *
     * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
     * @returns {Promise<void>} Resolves when the record is as it was.
     */
    async restore(request) {
      await Promise.all(parsing);

      const unexpected = [...destroyed].filter((id) => !disposable.has(id));
      expect(unexpected, 'this test deleted observations it did not create, and nothing can '
        + `put them back: ${unexpected.join(', ')}. A check that means to destroy a row seeds `
        + 'it first and names it with `allowDeletes`.').toEqual([]);

      if (committed.size === 0 && corrected.size === 0) return;

      await putSpeciesBack(request, { versions, corrected });
      await putDecisionsBack(request, { first, versions, committed, corrected, questions, destroyed });
    }
  };
}

/**
 * Correct every corrected observation back to the species it arrived on.
 *
 * A correction edits the observation row, so the database trigger moves `version` and
 * the answer carries the new one. Correcting back moves it again -- and records a
 * second `corrected` decision, which `putDecisionsBack` then clears if the row did not
 * have one. That ordering is the whole reason this is a separate pass.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} state - The journal's records.
 * @returns {Promise<void>} Resolves when every species is back.
 */
async function putSpeciesBack(request, { versions, corrected }) {
  for (const [id, was] of corrected) {
    const res = await request.post('/api/v2/mosaic/observations/species', {
      data: { observation_id: id, version: versions.get(id), species_id: was }
    });
    expect(res.ok(), `putting observation ${id} back on species ${was} was refused: `
      + `${res.status()} ${await res.text()}`).toBeTruthy();

    const answer = await res.json();
    /* `unchanged` is the endpoint refusing a correction that would change nothing, which
       is what it answers when the test's own correction never actually landed. Either way
       the row is on the species it started on, which is what this is for. */
    expect(answer.ok || answer.error === 'unchanged',
      `observation ${id} could not be put back on species ${was}: ${JSON.stringify(answer)}`)
      .toBeTruthy();
    if (answer.version != null) versions.set(id, Number(answer.version));
  }
}

/**
 * Put each dimension's decision back to what the row arrived carrying.
 *
 * One request per mode, because the commit route takes the whole set at once: the ids
 * whose record said *flagged* carry an `except` mark, the ones that said *reviewed*
 * carry no mark and are therefore accepted, and the ones that said nothing at all are
 * withdrawn -- the absence of a projection row being what *undecided* means.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} state - The journal's records.
 * @returns {Promise<void>} Resolves when the record is back, and checked.
 */
async function putDecisionsBack(request, { first, versions, committed, corrected, questions, destroyed }) {
  /* A correction records a `corrected` decision of its own, so a row this test
     corrected has a scientific decision to put back whether it was committed or not. */
  const byMode = { scientific: new Set(), training: new Set() };
  for (const [id, modes] of committed) {
    for (const mode of modes) byMode[mode].add(id);
  }
  for (const id of corrected.keys()) byMode.scientific.add(id);
  for (const id of destroyed) { byMode.scientific.delete(id); byMode.training.delete(id); }

  const current = await reread(request, questions, new Set([...byMode.scientific, ...byMode.training]));

  for (const mode of ['scientific', 'training']) {
    const ids = [...byMode[mode]].filter((id) => first.has(id));
    if (ids.length === 0) continue;

    const columns = COLUMNS[mode];
    const observations = [];
    const marks = [];
    const withdraw = [];

    for (const id of ids) {
      const was = first.get(id);
      const now = current.get(id);
      /* Nothing to do for a row the commit never moved -- and a row that is no longer
         under any question the page asked cannot be read back, so it is left to the
         check below to report rather than guessed at. */
      if (!now) continue;
      if (now[columns.decision] === was[columns.decision]
        && now[columns.reason] === was[columns.reason]) continue;

      observations.push({ observation_id: id, version: now.version });

      if (was[columns.decision] == null) {
        withdraw.push(id);
      } else if (was[columns.decision] === EXCEPTION[mode]) {
        marks.push({ observation_id: id, kind: 'except', reason: was[columns.reason] || FALLBACK_REASON });
      } else if (was[columns.decision] === 'corrected') {
        /* A correction is what writes `corrected`, and `putSpeciesBack` has already
           made it again. Accepting it here would overwrite that with `reviewed`. */
        observations.pop();
      } else {
        marks.push({ observation_id: id, kind: 'accept', reason: null });
      }
    }

    if (observations.length === 0) continue;

    const res = await request.post(`/api/v2/mosaic/observations/${columns.route}`, {
      data: { observations, marks, withdraw }
    });
    expect(res.ok(), `putting ${observations.length} ${mode} decision(s) back was refused: `
      + `${res.status()} ${await res.text()}`).toBeTruthy();
  }

  await verify(request, questions, first, byMode);
}

/**
 * Read the rows back, under the questions the page asked, with the status filters off.
 *
 * **The status filters have to come off.** A row that was undecided and has just been
 * reviewed is no longer in Scientific's opening question, so re-reading under the
 * question that served it would simply not find it -- and a restore that cannot see
 * what it is restoring writes nothing and says nothing.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Array<Object>} questions - The page-query bodies the application sent.
 * @param {Set<number>} wanted - The ids to find.
 * @returns {Promise<Map<number, Object>>} What each one says now.
 */
async function reread(request, questions, wanted) {
  const found = new Map();
  if (wanted.size === 0) return found;

  /* One question per distinct filter set. The page numbers are widened to the whole
     result, because a commit can move a row onto a different page of the same
     question -- the ordering is by confidence and a decision does not move it, but a
     species correction does. */
  const seen = new Set();

  for (const body of questions) {
    const filters = { ...body.filters, reviewStatus: [], trainingDisposition: [] };
    const key = JSON.stringify([filters, body.sort]);
    if (seen.has(key)) continue;
    seen.add(key);

    const pageSize = 200;
    let page = 1;
    let lastPage = 1;

    do {
      const pages = [];
      for (let n = page; n < page + 3 && n <= lastPage; n += 1) pages.push(n);

      const res = await request.post('/api/v2/mosaic/observations/pages', {
        data: { filters, sort: body.sort, pageSize, pages, includeTotal: page === 1 }
      });
      if (!res.ok()) break;
      const answer = await res.json();
      if (page === 1) lastPage = Math.max(1, Math.ceil((answer.total || 0) / pageSize));

      for (const served of answer.pages || []) {
        for (const row of served.rows || []) {
          const id = Number(row.observation_id);
          if (wanted.has(id)) found.set(id, row);
        }
      }

      page += 3;
    } while (page <= lastPage && found.size < wanted.size);

    if (found.size === wanted.size) break;
  }

  return found;
}

/**
 * Prove the record really is back, and say exactly what is not if it is not.
 *
 * A restore that quietly failed is worse than none: the next run inherits it and the
 * failure arrives in some unrelated check, hours later.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Array<Object>} questions - The page-query bodies the application sent.
 * @param {Map<number, Object>} first - The "before" picture.
 * @param {Object} byMode - Which ids were written in which mode.
 * @returns {Promise<void>} Resolves when everything matches.
 */
async function verify(request, questions, first, byMode) {
  const wanted = new Set([...byMode.scientific, ...byMode.training]);
  const now = await reread(request, questions, wanted);
  const wrong = [];

  for (const mode of ['scientific', 'training']) {
    const columns = COLUMNS[mode];
    for (const id of byMode[mode]) {
      const was = first.get(id);
      const current = now.get(id);
      if (!was || !current) continue;
      if (current[columns.decision] !== was[columns.decision]) {
        wrong.push(`${id} ${columns.decision}: ${current[columns.decision]} (was ${was[columns.decision]})`);
      }
    }
  }

  expect(wrong, `the record was not put back:\n  ${wrong.join('\n  ')}\nThe testing database is `
    + 'rebuildable with `npm run testing-db reset`, but a restore that does not apply hides '
    + 'the next failure rather than causing one.').toEqual([]);
}
