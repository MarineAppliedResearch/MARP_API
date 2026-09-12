/**
 * The four fixture affordances, done against a real server (#157, R10).
 *
 * `tests/e2e/render.spec.mjs` and `tests/requirements.js` reach past the backend
 * seam into `src/data.js` for four things a real server will not do on request:
 * `failNextCommit`, `slowNextCommit`, `breakThumbnails` and `bumpVersion`. That
 * was the stated reason the fixture had to stay. It is not a reason, and this file
 * is the demonstration -- one test per affordance, none of them needing a fake
 * backing, and each one a **better** test than the affordance it replaces:
 *
 * | Affordance | Here |
 * | --- | --- |
 * | `failNextCommit` | `page.route()` aborts the commit. The client's real error path runs. |
 * | `slowNextCommit` | the same interception, fulfilled after a delay, with the real response. |
 * | `bumpVersion` | a real correction from another request between the read and the commit. |
 * | `breakThumbnails` | a row whose picture genuinely failed. The corpus has them. |
 *
 * The first two are the interesting half. The fixture *simulated* a failing
 * commit, so what it proved was that the simulation worked; intercepting the
 * request makes the real `fetch` reject and the real error handling run. The
 * difference is not academic -- a better fake is not the fix for damage done by a
 * fake, which is why the first answer to the take-back defect was rejected.
 *
 * **Two of these write, and both put the record back in a `finally`.** They act on
 * a page discovered to hold exactly one row, so nothing is committed that was not
 * first inspected. See `support.mjs`.
 *
 * Refs #132, #157.
 */

import { test, expect } from '@playwright/test';

import {
  correctSpecies,
  discoverLoneRow,
  expectRealBacking,
  facetsFor,
  findPageOf,
  findRow,
  lonePage,
  pageOf,
  pageSizeOf,
  ready,
  restoreDecision,
  sweepForRow,
  whateverItsStatus
} from './support.mjs';

/** The route a scientific page commit goes to. What the first three tests intercept. */
const COMMIT_ROUTE = '**/api/v2/mosaic/observations/review';

test.describe('what the fixture used to fake', () => {

  test('R10: an aborted commit says Failed, changes nothing, and keeps the mark', async ({ page, request }) => {
    /* `failNextCommit`, replaced. The fixture threw inside its own commitPage; this
       makes the browser's request fail, which is the path a real outage takes. */
    const lone = await discoverLoneRow(request);
    const before = await lonePage(request, lone);

    expect(before.total, `the page for species ${lone.species} on line ${lone.line} holds `
      + `${before.total} rows, not 1. This test commits the page it is standing on, so it `
      + 'refuses to run on a page it has not inspected.').toBe(1);

    const [row] = before.rows;
    const wasDecided = row.review_decision;

    await page.goto(`./?species=${lone.species}&line=${lone.line}`);
    await expectRealBacking(page);
    await ready(page);

    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
    await tile.click();
    await expect(tile).toHaveClass(/marked/);

    /* Installed after the page has loaded, so only the commit is intercepted and the
       reads that got us here were real. */
    await page.route(COMMIT_ROUTE, (route) => route.abort('failed'));

    const commit = page.locator('#commit');
    await commit.click();

    await expect(commit).toContainText('Failed');
    await expect(commit).toHaveClass(/bad/);

    /* The mark survives, so the page need not be redone. That is the requirement --
       a failed commit that also loses the reviewer's work costs them twice. */
    await expect(tile).toHaveClass(/marked/);

    /* And nothing reached the record. Asserted against the server rather than against
       the screen: the screen saying "Failed" is what the client believes, and the
       whole point of this tier is that those are different questions. */
    const after = await lonePage(request, lone);
    expect(after.rows[0].review_decision).toBe(wasDecided);
  });

  test('R10: a commit held open paints Saving, then lands', async ({ page, request }) => {
    /* `slowNextCommit`, replaced. The fixture delayed its own fake commit; this delays
       the real one and then lets it through, so what is observed during the delay is
       the application genuinely waiting for a server. */
    const lone = await discoverLoneRow(request);
    const before = await lonePage(request, lone);

    expect(before.total, `the page holds ${before.total} rows, not 1; this test commits it.`)
      .toBe(1);

    const [row] = before.rows;
    const original = { decision: row.review_decision, reason: row.flag_reason };

    await page.goto(`./?species=${lone.species}&line=${lone.line}`);
    await expectRealBacking(page);
    await ready(page);

    /* Fetch it for real, hold the answer, then hand it over. `route.fulfill({response})`
       serves what the server actually said, so the commit lands and the reviewer's
       decision is real -- which is what makes the `finally` below necessary. */
    await page.route(COMMIT_ROUTE, async (route) => {
      const response = await route.fetch();
      await new Promise((settle) => setTimeout(settle, 2500));
      await route.fulfill({ response });
    });

    try {
      const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
      await tile.click();

      const commit = page.locator('#commit');
      await commit.click();

      /* In flight: the button says so and refuses to be pressed again. A button that
         says "Saving..." while saving nothing is the same lie as one that says nothing
         while saving, so this is asserted rather than waited out. */
      await expect(commit).toHaveClass(/busy/);
      await expect(commit).toContainText('Saving');
      await expect(commit).toBeDisabled();

      /* And it finishes. The generous timeout is the 2.5 s delay plus the round trip. */
      await expect(commit).toHaveClass(/ok/, { timeout: 15_000 });
      await expect(commit).toContainText('Saved');
    } finally {
      await page.unroute(COMMIT_ROUTE);
      const now = await lonePage(request, lone);
      await restoreDecision(request, now.rows[0], original);
    }
  });

  test('R10: a species corrected underneath the page conflicts rather than overwriting', async ({ page, request }) => {
    /* `bumpVersion`, replaced. A correction is the one gesture that edits the
       observation row itself, and a trigger bumps `version` on that update -- so the
       page the browser is holding is now at a version that no longer exists. */
    const lone = await discoverLoneRow(request);
    const before = await lonePage(request, lone);

    expect(before.total, `the page holds ${before.total} rows, not 1; this test writes to it.`)
      .toBe(1);

    const [row] = before.rows;

    /* The species id comes from the filter that isolated the row, not from the row.
       **A mosaic row does not carry `species_id`** -- it carries `comname` and
       `species_comname`, which are two different names and neither is an id. The
       filter that produced this page is `species: [lone.species]`, so that is the id,
       and it is a fact about this query rather than about the corpus. */
    const originalSpecies = lone.species;

    /* Something else in the catalogue, discovered rather than named. A correction to
       the species it already carries is refused as `unchanged`, deliberately, so this
       has to be a different one -- and it has to exist, which the facets guarantee. */
    const { species } = await facetsFor(request, {});
    const other = species.find((candidate) => candidate.value !== originalSpecies);
    expect(other, 'the corpus holds only one species, so nothing can be corrected to '
      + 'anything else and this test has nothing to be about.').toBeTruthy();

    await page.goto(`./?species=${lone.species}&line=${lone.line}`);
    await expectRealBacking(page);
    await ready(page);

    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
    await tile.click();

    let corrected = null;
    try {
      /* Somebody else's write, between the page being fetched and the commit being
         sent. Through the API rather than into the database, because that is what a
         second reviewer actually is. */
      corrected = await correctSpecies(request, row, other.value);

      await page.locator('#commit').click();

      /* The reviewer is told, rather than overwritten. The banner is the thing that
         has to appear -- the store knowing it conflicted while nothing is drawn is
         precisely the class of defect this tier exists for. */
      await expect(page.locator('.pagestate--conflict')).toBeVisible({ timeout: 15_000 });
    } finally {
      if (corrected) {
        /* Back to the species it had. Three things have to be right here, and the last
           one is the one that was wrong: it is under the *other* species now, so that is
           where it is looked for; the correction bumped the version, so the live row is
           re-read rather than assumed; and the lookup ignores review status, because
           **a correction records a `corrected` decision and that takes the row out of
           the default question entirely**. Looking under the default filters found it
           on a database that had been written to before and lost it on one built from a
           clean dump. A failure to put it back is thrown rather than swallowed. */
        const live = await findRow(
          request,
          whateverItsStatus({ species: [other.value], line: [lone.line] }),
          row.observation_id
        );
        expect(live, `observation ${row.observation_id} was corrected to species `
          + `${other.value} and cannot be found there to be put back.`).toBeTruthy();
        await correctSpecies(request, live, originalSpecies);
      }
    }
  });

  test('R10: an observation whose picture really failed still shows its species and stays markable', async ({ page, request }) => {
    /* `breakThumbnails`, replaced. Nothing is broken on purpose: the corpus carries
       observations whose extraction genuinely failed, which is what the fixture was
       imitating. Discovered by sweeping, because the mosaic has no thumbnail-status
       filter -- the status is a field on the row, not a dimension. */
    const row = await sweepForRow(
      request,
      (candidate) => candidate.thumbnail_status === 'failed',
      'has a thumbnail whose extraction failed'
    );

    /* Narrow to the line the row is on, then find which page of *that* question it falls
       on. Both halves matter: a page number taken from one question and used against
       another lands on a different tile, and so does one computed at a different page
       size -- which is why the browser is opened first and asked what size it settled on
       rather than told. It follows the viewport. */
    const line = { line: [row.line] };

    await page.goto(`./?line=${encodeURIComponent(row.line)}`);
    await expectRealBacking(page);
    await ready(page);

    const pageSize = await pageSizeOf(page);
    const onPage = await findPageOf(request, line, row.observation_id, pageSize);

    if (onPage > 1) {
      await page.goto(`./?line=${encodeURIComponent(row.line)}&page=${onPage}`);
      await ready(page);
    }

    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
    await expect(tile).toBeVisible();

    /* The two things a reviewer needs from a tile with no picture: it still says what
       the row claims to be, and it can still be acted on. A tile that vanishes or goes
       inert takes the observation out of the review without anybody deciding to. */
    await expect(tile).toContainText(row.species_comname || row.comname);

    await tile.click();
    await expect(tile).toHaveClass(/marked/);

    /* Nothing is committed, so nothing needs restoring: a mark is not a decision. */
  });
});
