/**
 * What the API tier needs to find its way around a real corpus.
 *
 * Every helper here **discovers** what it needs and fails loudly when it is not
 * there. Nothing in this file pins a fact about the data, and that is the rule
 * rather than a style: an id read out of somebody's local database is true on one
 * computer, and this tier already learned it once -- `const LONE_SPECIES = 622`
 * was correct until seven dives landed overnight, after which the test refused to
 * run. It was right to refuse and wrong to have hard-coded the thing that moved.
 *
 * **Fail, never skip.** A skipped test looks green, and this is the only tier that
 * can see the defects the fixture masks by construction, so its absence has to be
 * loud.
 *
 * Refs #132, #157.
 *
 * @module tests/api/support
 */

import { expect } from '@playwright/test';

import { DEFAULT_FILTERS, DEFAULT_SORT, sortTerms } from '../../src/model/filters.js';

/** The reason a setup flag carries. One of Scientific's own, so the record says why. */
export const SETUP_REASON = 'Other / unsure';

/** What the endpoint will serve in one request: 12 pages, 600 rows (mosaic.repository). */
const MAX_PAGES = 12;

/** The other half of that ceiling. Whichever binds first decides a request's size. */
const MAX_ROWS = 600;

/**
 * Rows per page while sweeping for a row, where the page number does not matter.
 *
 * Anything that *does* care which page a row is on must ask the browser --
 * see `pageSizeOf`. 45 x 12 is 540, inside the endpoint's 600-row ceiling.
 */
const PAGE_SIZE = 45;

/**
 * The page size the running application is actually using.
 *
 * **It is not a constant and it cannot be one.** `store.js` declares
 * `pageSize: 45` and then `setPageSize` moves it -- *"page size follows the
 * viewport, so the grid always fills it"* -- and at this project's 1600x900 it
 * settles at 50. So a page number computed against 45 and handed to `?page=n`
 * addresses a different set of rows than the one it was derived from, and the
 * tile is simply not there. That is what this helper exists to stop; it cost a
 * failing test that read exactly like the application not drawing a row.
 *
 * Read from the app's own store, which is the same module the page is running.
 * That is not reaching into a fixture -- `src/store.js` is the application.
 *
 * @param {import('@playwright/test').Page} page - A page that has finished settling.
 * @returns {Promise<number>} Rows per page, as this viewport made it.
 */
export async function pageSizeOf(page) {
  return page.evaluate(async () => {
    const { state } = await import('./src/store.js');
    return state.pageSize;
  });
}

/**
 * The question the application itself would ask, with some dimensions narrowed.
 *
 * **Imported from the app's own model rather than restated**, and that is the whole
 * point of this function. A bare address is not `filters: {}`: `DEFAULT_FILTERS`
 * carries Scientific's opening status filter, `reviewStatus: ['unreviewed',
 * 'flagged']`, so a query with no filters at all sees rows the mosaic never shows.
 *
 * That is not a theoretical difference and it cost this file a rewrite. A page
 * number is meaningless apart from the question that produced it, so a sweep run
 * on `{}` found an observation on "page 7" of a question the browser does not ask,
 * sent the browser to `?page=7`, and the tile was not there -- which reads exactly
 * like the application failing to draw a row it was given.
 *
 * Restating the defaults here would work today and drift the first time somebody
 * changes what the mosaic opens on. `src/model/filters.js` has no DOM and no
 * network, deliberately, so it loads under Node like any other module.
 *
 * @param {Object} narrowed - Dimensions to override, e.g. `{line: ['L1']}`.
 * @returns {Object} The filter object to send.
 */
export function question(narrowed = {}) {
  return { ...DEFAULT_FILTERS, ...narrowed };
}

/**
 * The same question with both status dimensions switched off.
 *
 * **A row can leave the default question by being acted on**, and a test that then
 * goes looking for it under the default question will not find it. That is not
 * hypothetical: `reviewStatus` opens at `['unreviewed', 'flagged']`, and a species
 * correction records a `corrected` decision -- which is neither -- so an
 * observation corrected by a test drops out of the very page the test would use to
 * put it back. It passed against a database that had been written to before and
 * failed the first time one was built from a clean dump, which is the worst way
 * round for a test to be wrong.
 *
 * So anything whose job is *restoration* asks with the status filters cleared. An
 * empty array is not filtering, which is what `isActive` means by it.
 *
 * @param {Object} narrowed - Dimensions to narrow by.
 * @returns {Object} The same, with both status dimensions off.
 */
export function whateverItsStatus(narrowed = {}) {
  return { ...narrowed, reviewStatus: [], trainingDisposition: [] };
}

/** The sort the application opens on, from the application. */
const SORT = sortTerms(DEFAULT_SORT);

/**
 * Ask for the facet counts under a set of filters.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} narrowed - Dimensions to narrow by; the rest come from the default question.
 * @returns {Promise<Object>} The facets.
 */
export async function facetsFor(request, narrowed) {
  const filters = question(narrowed);
  const res = await request.post('/api/v2/mosaic/observations/facets', { data: { filters } });
  expect(res.ok(), `the facets query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  return (await res.json()).facets;
}

/**
 * A `{ species, line }` pair holding exactly one observation.
 *
 * The isolating filter every writing test uses: a page with one row on it is a
 * page whose every row was inspected before anything was committed to it.
 *
 * `species` alone no longer isolates anything, so it is paired with `line` -- and
 * **not with `dive`**, because a dive name repeats across projects (`Dive 12` is
 * in two of them and the facet count is their sum) while a line belongs to one
 * session.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @returns {Promise<Object>} `{species, line, label}`.
 */
export async function discoverLoneRow(request) {
  const { line } = await facetsFor(request, {});

  for (const candidate of line) {
    const inLine = await facetsFor(request, { line: [candidate.value] });
    const only = (inLine.species || []).find((sp) => sp.count === 1);
    if (only) return { species: only.value, line: candidate.value, label: only.label };
  }

  throw new Error(
    'No species has exactly one observation within a single line, so there is no page this '
    + 'test can sweep without writing rows it never inspected. Add an observation, or narrow '
    + 'the page another way.'
  );
}

/**
 * Ask the mosaic for a page.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} narrowed - The dimensions to narrow by, over the default question.
 * @param {Object} options - `{page, pageSize, includeTotal}`.
 * @returns {Promise<Object>} `{total, rows}`.
 */
export async function pageOf(request, narrowed, { page = 1, pageSize = PAGE_SIZE, includeTotal = true } = {}) {
  const res = await request.post('/api/v2/mosaic/observations/pages', {
    data: {
      filters: question(narrowed),
      sort: SORT,
      pageSize,
      pages: [page],
      includeTotal
    }
  });
  expect(res.ok(), `the mosaic query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  const body = await res.json();
  return { total: body.total, rows: body.pages[0].rows };
}

/** The single-row page a `{species, line}` pair produces. */
export async function lonePage(request, lone) {
  return pageOf(request, { species: [lone.species], line: [lone.line] });
}

/**
 * Walk the whole corpus, in the largest bites the endpoint serves, until a row
 * satisfies the caller.
 *
 * This exists because the mosaic has **no thumbnail-status filter** -- the status
 * is a field on the row, not a dimension you can ask by -- so the only way to find
 * a picture that genuinely failed is to look. Four requests cover two thousand
 * rows, which is cheaper than it sounds and much cheaper than being wrong about
 * which observation is broken this week.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Function} matches - Called with a row; true stops the sweep.
 * @param {string} describe - What was being looked for, for the failure message.
 * @param {Object} narrowed - Dimensions to narrow the sweep by, over the default question.
 * @returns {Promise<Object>} The first row that matched. `findPageOf` says where it is.
 */
export async function sweepForRow(request, matches, describe, narrowed = {}) {
  const found = await sweep(request, narrowed, (row) => (matches(row) ? row : null));

  if (!found) {
    throw new Error(
      `Nothing in this corpus ${describe}, so there is nothing for this test to be about. `
      + 'It fails rather than skipping: this is the only tier that can see the thing at all, '
      + 'so its absence must be loud rather than green.'
    );
  }

  return found;
}

/**
 * One observation, wherever it is under a question.
 *
 * **Not `pageOf(...).rows.find(...)`.** That looks at page one only, and a row put
 * somewhere by a test is rarely on page one of where it landed -- a correction moves
 * an observation onto another species, and that species may have hundreds of rows on
 * the same line. Looking only at the first page found it when the other species was
 * small and lost it when it was not, which is a restoration that works until the day
 * it matters.
 *
 * Pair it with `whateverItsStatus` when the row may have been acted on.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} narrowed - Dimensions to narrow the search by.
 * @param {number} observationId - The row to find.
 * @returns {Promise<?Object>} The row, or null if it is not under that question at all.
 */
export async function findRow(request, narrowed, observationId) {
  return sweep(
    request,
    narrowed,
    (row) => (row.observation_id === observationId ? row : null)
  );
}

/**
 * Which page of a given question an observation is on.
 *
 * The address the browser is sent to carries `?page=n`, and n only means something
 * alongside the filters and the sort that produced it. So this asks the same
 * question the app will ask -- same filters, same sort, same page size -- and
 * reports where the row actually falls, rather than a number computed from a
 * different query and hoped to transfer.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} narrowed - The dimensions the address narrows, over the default question.
 * @param {number} observationId - The row to find.
 * @param {number} pageSize - The browser's page size, from `pageSizeOf`. Not a guess.
 * @returns {Promise<number>} The page it is on.
 */
export async function findPageOf(request, narrowed, observationId, pageSize) {
  const found = await sweep(
    request,
    narrowed,
    (row, page) => (row.observation_id === observationId ? page : null),
    pageSize
  );

  if (found === null || found === undefined) {
    throw new Error(
      `Observation ${observationId} is not anywhere in ${JSON.stringify(narrowed)}, so there `
      + 'is no address that puts it on screen. It was there a moment ago, which means '
      + 'something wrote to this database while the test was running.'
    );
  }

  return found;
}

/**
 * Walk every page of a question, in the largest bites the endpoint serves.
 *
 * Shared by the two above. The mosaic has **no thumbnail-status filter** -- status
 * is a field on the row, not a dimension you can ask by -- so looking is the only
 * way to find a picture that genuinely failed. Four requests cover two thousand
 * rows, which is far cheaper than being wrong about which observation is broken
 * this week.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} narrowed - The dimensions to narrow by.
 * @param {Function} take - Called with (row, page); the first non-null answer wins.
 * @returns {Promise<*>} Whatever `take` returned, or null.
 */
async function sweep(request, narrowed, take, pageSize = PAGE_SIZE) {
  const first = await pageOf(request, narrowed, { page: 1, pageSize });
  const lastPage = Math.max(1, Math.ceil(first.total / pageSize));

  /* The endpoint serves 12 pages or 600 rows, whichever binds first, so a larger
     page size means fewer pages per request. Working that out here rather than
     assuming 12 is what keeps this correct when the viewport moves the size. */
  const perRequest = Math.max(1, Math.min(MAX_PAGES, Math.floor(MAX_ROWS / pageSize)));

  for (let from = 1; from <= lastPage; from += perRequest) {
    const pages = [];
    for (let page = from; page < from + perRequest && page <= lastPage; page += 1) pages.push(page);

    const res = await request.post('/api/v2/mosaic/observations/pages', {
      data: {
        filters: question(narrowed),
        sort: SORT,
        pageSize,
        pages
      }
    });
    expect(res.ok(), `the sweep was refused: ${res.status()} ${await res.text()}`).toBeTruthy();

    for (const served of (await res.json()).pages) {
      for (const row of served.rows) {
        const answer = take(row, served.page);
        if (answer !== null && answer !== undefined) return answer;
      }
    }
  }

  return null;
}

/**
 * Commit one observation through the review route, and fail loudly on a refusal.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} row - A row as the mosaic served it; its `version` is sent.
 * @param {Object} options - `{marked, withdraw, reason}`.
 * @returns {Promise<Object>} The commit report.
 */
export async function commitOne(request, row, { marked = false, withdraw = false, reason = SETUP_REASON } = {}) {
  const data = {
    observations: [{ observation_id: row.observation_id, version: row.version }],
    marks: marked
      ? [{ observation_id: row.observation_id, reason, kind: 'except' }]
      : []
  };
  if (withdraw) data.withdraw = [row.observation_id];

  const res = await request.post('/api/v2/mosaic/observations/review', { data });
  expect(res.ok(), `the commit was refused: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * Put an observation's decision back exactly as it was found.
 *
 * The discipline every writing test in this directory follows, in one place: a
 * failed assertion must still leave the record as it was, so this is what the
 * `finally` calls. `withdraw` deletes the projection row, and the absence of a row
 * is what *undecided* means -- so an observation nobody had decided about goes
 * back to exactly that rather than to a decision that says "undecided".
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} row - The row, re-read so its version is current.
 * @param {Object} original - `{decision, reason}` as first read.
 * @returns {Promise<void>} Resolves when it is back.
 */
export async function restoreDecision(request, row, original) {
  if (original.decision === null || original.decision === undefined) {
    await commitOne(request, row, { withdraw: true });
    return;
  }
  await commitOne(request, row, {
    marked: original.decision === 'flagged',
    reason: original.reason || SETUP_REASON
  });
}

/**
 * Correct an observation's species -- somebody else's write, through the API.
 *
 * This is what stands in for the fixture's `bumpVersion`. A correction is the one
 * gesture that edits the observation row itself, and a database trigger bumps
 * `version` on that update -- so after this, a page fetched a moment ago is
 * holding a version that no longer exists. That is the actual race the fixture was
 * modelling.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} row - The row, at the version the correction applies to.
 * @param {number} speciesId - What to correct it to.
 * @returns {Promise<Object>} The correction's answer, carrying the new version.
 */
export async function correctSpecies(request, row, speciesId) {
  const res = await request.post('/api/v2/mosaic/observations/species', {
    data: {
      observation_id: row.observation_id,
      version: row.version,
      species_id: speciesId
    }
  });
  expect(res.ok(), `the correction was refused: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * Assert this page really is talking to the API.
 *
 * Every test in this directory calls it. Without it a run can grade a fixture and
 * report it as the API, which is the failure this whole tier exists to make
 * impossible -- `tests/e2e/` injects `?backing=fixture` in a `beforeEach` and this
 * project's `testDir` simply does not include that file, so the only thing
 * standing between the two is saying so out loud.
 *
 * @param {import('@playwright/test').Page} page - The page.
 * @returns {Promise<void>} Resolves when it is confirmed.
 */
export async function expectRealBacking(page) {
  await expect(page.locator('html')).toHaveAttribute('data-backing', 'api');
  await expect(page.locator('#backingFlag')).toHaveCount(0);
}

/**
 * Wait for the mosaic to have drawn, and stopped redrawing.
 *
 * The same settling `tests/e2e/render.spec.mjs` does, and it matters more here:
 * against a real server the first paint is skeletons, and a count read during one
 * is a count of something that is about to change.
 *
 * @param {import('@playwright/test').Page} page - The page.
 * @returns {Promise<number>} How many tiles settled.
 */
export async function ready(page) {
  await expect(page.locator('.tile').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tile.skeleton')).toHaveCount(0, { timeout: 30_000 });

  let last = -1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const count = await page.locator('.tile').count();
    if (count === last) return count;
    last = count;
    await page.waitForTimeout(250);
  }
  return last;
}

/**
 * Collect anything the page throws or logs as an error.
 *
 * @param {import('@playwright/test').Page} page - The page.
 * @returns {Array<string>} Filled as the run proceeds.
 */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
