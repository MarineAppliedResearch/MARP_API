/**
 * A slice of the render tier, moved onto a real database (#157, R11).
 *
 * **This file is a proof, not a migration.** `tests/e2e/render.spec.mjs` holds 148
 * checks against the fixture and `tests/requirements.js` holds 80 more; moving all
 * of them is mechanical work whose cost is only knowable once one slice has
 * actually run against a server. This is that slice: five checks chosen because
 * each one is a different *kind* of thing the fixture can be right about while the
 * endpoint is wrong.
 *
 * | Check | Why this one |
 * | --- | --- |
 * | the mosaic settles | that the app reaches a resting state against a real query at all |
 * | a tile names its species | `species_comname` vs `comname` -- #124's F6 was exactly this |
 * | marking draws and counts | a gesture reaching the page's own counter, on real rows |
 * | the pager moves | server-side pagination, which the fixture does in memory |
 * | every mode renders | three questions, three real round trips, nothing thrown |
 *
 * **Nothing here writes.** A mark is not a decision -- it is client state until a
 * commit -- so this whole file is read-only against the corpus, which is why it is
 * separate from `affordances.spec.mjs` and why it needs no `finally`.
 *
 * What is deliberately *not* moved yet: anything needing a broken backing (see
 * `affordances.spec.mjs` -- those four are done), the phone viewport, and the
 * fixture-only affordances `setScale` and `withoutLatency`. `src/data.js` and
 * `?backing=fixture` are both untouched by this change.
 *
 * Refs #132, #157.
 */

import { test, expect } from '@playwright/test';

import {
  expectRealBacking,
  pageOf,
  pageSizeOf,
  ready,
  watchErrors
} from './support.mjs';

test.describe('the render tier, against the API', () => {

  test('R11: the mosaic renders and stays settled', async ({ page }) => {
    const errors = watchErrors(page);

    await page.goto('./');
    await expectRealBacking(page);

    const tiles = await ready(page);
    expect(tiles, 'the default question drew no tiles at all. Either the corpus is empty '
      + 'or the mosaic query is refusing -- the API log says which.').toBeGreaterThan(0);

    /* No skeletons left, and no second wave of them: a grid that re-queries itself
       settles and then unsettles, which is invisible to a store-level check. */
    await expect(page.locator('.tile.skeleton')).toHaveCount(0);
    expect(errors, `the page reported errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('R11: a tile names the species the row actually carries', async ({ page, request }) => {
    /* The shape of #124's F6, which shipped: the client read `comname` where the
       endpoint sends the current name as `species_comname`, so a corrected observation
       showed its old name. The fixture had both and agreed with itself, so no browser
       test could fail. Here the name is read off the endpoint's own answer. */
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);

    const pageSize = await pageSizeOf(page);
    const served = await pageOf(request, {}, { page: 1, pageSize });

    const row = served.rows.find((candidate) => candidate.species_comname);
    expect(row, 'no row on the first page carries a species name, so there is nothing to '
      + 'check that a tile draws it.').toBeTruthy();

    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(row.species_comname);
  });

  test('R11: marking a tile draws it marked and the page count moves', async ({ page, request }) => {
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);

    /* **Which tile is not a detail here.** The default question shows flagged rows as
       well as unreviewed ones, and a click on a row that already carries a decision is
       a *take-back*, not a mark -- the tile comes back `tile out-reverted` and never
       gains `marked`. Taking the first tile found exactly that, on a real corpus, and
       it is not something a fixture opening on undecided rows would ever show.
       So the row is chosen by what the endpoint says about it. */
    const pageSize = await pageSizeOf(page);
    const served = await pageOf(request, {}, { page: 1, pageSize });

    const row = served.rows.find((candidate) => candidate.review_decision === null
      && candidate.thumbnail_status === 'ready');
    expect(row, 'no row on the first page is both undecided and has a picture, so there '
      + 'is no plain mark to make. An accept gesture on a tile with no imagery is refused '
      + 'deliberately, which is a different test.').toBeTruthy();

    /* Pin the tile by id. A locator describing a *state* stops matching the moment the
       state changes, so `.tile:not(.marked)` clicked once slides onto a different tile
       -- three tests were wrong this way before they were right. */
    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);

    const before = Number(await page.locator('#markedCount').innerText());

    await tile.click();
    await expect(tile).toHaveClass(/marked/);

    /* And the mark reached the page's own count, which is the thing a reviewer reads.
       **Not `#commit`** -- that is the page-sweep button, which says how many tiles
       are on the page whether anything is marked or not ("Review page - 50 tiles").
       Asserting a mark against it passes for the wrong reason on a page of 1 and fails
       on a page of 50, which is how this was found. */
    await expect(page.locator('#markedCount')).toHaveText(String(before + 1));

    /* Nothing is committed, so nothing is written: a mark is not a decision. */
  });

  test('R11: the pager moves, and page two is not page one', async ({ page, request }) => {
    /* Pagination is server-side by design -- the mosaic runs over hundreds of
       thousands of rows and must never fetch the whole matching set to page through
       it -- so this is a real second query rather than a slice of something already
       in memory, which is what the fixture does. */
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);

    const pageSize = await pageSizeOf(page);
    const first = await pageOf(request, {}, { page: 1, pageSize });

    /* Fail rather than skip. A skipped check looks green, and a corpus too small to
       have a second page means this test proved nothing about pagination at all. */
    expect(first.total, `the corpus holds ${first.total} matching rows and a page is `
      + `${pageSize}, so there is no second page to move to and nothing to prove.`)
      .toBeGreaterThan(pageSize);

    const firstIds = first.rows.map((row) => row.observation_id);

    await page.goto('./?page=2');
    await ready(page);

    const shown = await page.locator('.tile').evaluateAll(
      (tiles) => tiles.map((tile) => Number(tile.dataset.id))
    );

    expect(shown.length, 'page two drew no tiles.').toBeGreaterThan(0);
    expect(shown.some((id) => firstIds.includes(id)),
      'page two is showing rows from page one. Page membership is query-derived, so an '
      + 'ordering without the observation_id tie-breaker makes pages overlap -- which is '
      + 'a defect in the query, not in the pager.').toBe(false);
  });

  test('R11: every mode renders against a real query', async ({ page }) => {
    const errors = watchErrors(page);

    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);

    /* Each mode asks a different question, so each is a round trip of its own. The
       thing being proved is narrow and worth having: three real queries, three
       renders, and nothing thrown -- the fixture answers all three from one object
       in memory and so can agree with itself while an endpoint disagrees. */
    for (const mode of ['training', 'delete', 'scientific']) {
      await page.locator(`.seg button[data-mode="${mode}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-mode', mode);
      const tiles = await ready(page);
      expect(tiles, `${mode} mode drew no tiles.`).toBeGreaterThan(0);
    }

    expect(errors, `switching modes reported errors: ${errors.join('; ')}`).toEqual([]);
  });
});
