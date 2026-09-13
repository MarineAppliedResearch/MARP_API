/**
 * Requirement checks: two kinds of mark, two commit buttons, and Delete Mode.
 *
 * The last two groups of `tests/requirements.js`, migrated when #157 retired the fixture.
 * Each check still names the requirement from MARP_API#68 (and #126, #138) that it holds
 * the prototype to, and still drives the same named actions the interface drives.
 *
 * The body of each check runs in the page, because that is where the store runs, and
 * `check-kit.mjs` is what it opens with. Three things had to change and nothing else did:
 *
 * - **`reset()` is `prepare()`, and the reset is the page load.** There is no
 *   `MarpData.reload()` against a real server; a fresh page per check is the only reset
 *   that is actually a reset.
 * - **The record is re-read rather than read off the row.** `src/data.js` wrote the row's
 *   own status column in place when a page was committed and the endpoint never does that
 *   -- a decision is a projection row, the row is served from a cache, and a commit
 *   invalidates nothing. So every check that asserted `row.review_decision` straight after
 *   a commit asks the server again instead. That is the gap the fixture masked by
 *   construction, and it is the whole reason this tier exists.
 * - **`breakThumbnails` and `failNextCommit` are gone.** A tile with no picture is a
 *   seeded row whose thumbnail genuinely failed; a failed commit is `page.route()`
 *   aborting the real request, so the client's real error path runs.
 *
 * **Nine checks write to observations of their own** rather than to the corpus, and the
 * four Delete Mode ones destroy them for real. `seed.mjs` makes them, `?line=<its line>`
 * is a page holding nothing but them, and `ledger.allowDeletes` is what says a delete is
 * intended rather than a test about to damage a corpus it did not create.
 *
 * Refs #157.
 */

import { test } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import { expectRealBacking, ready, undecided } from './support.mjs';

/** The scientific commit route. What the aborted-commit check intercepts. */
const REVIEW_ROUTE = '**/api/v2/mosaic/observations/review';

let ledger = null;

/* A seeded check settles the journal itself, before its rows go. Restoring twice would
   re-read rows that no longer exist, so the hook is told it has already happened. */
let settled = false;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); settled = false; });
test.afterEach(async ({ request }) => { if (!settled) await ledger.restore(request); });

/** Open the application and wait for it to settle, before a check drives the store. */
async function open(page, address = undecided()) {
  await page.goto(address);
  await expectRealBacking(page);
  await ready(page);
}

/**
 * Put the record back, then take the seeded rows away. The order is the whole of it.
 *
 * `journal.restore` puts a decision back by re-reading the row it wrote to, and a row the
 * seeder has already deleted cannot be read back -- so a restore run after `remove()`
 * fails naming ids nobody can find.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} seeded - What `seedPage` handed back.
 * @returns {Promise<void>} Resolves when the record is back and the rows are gone.
 */
async function settle(request, seeded) {
  await ledger.restore(request);
  settled = true;
  await seeded.remove();
}

/**
 * Delete one seeded tile for real, and hand back its id.
 *
 * Through the store and the confirmation, not by writing an outcome by hand: what makes
 * the tile inert is what the *commit* said about it, and a check that staged that itself
 * would pass with the commit doing anything at all.
 *
 * It is an evaluate of its own so the four checks below share it rather than repeating
 * it. The module graph is cached per page, so their second evaluate imports the same
 * `check-kit.mjs` and reads the same `state`.
 *
 * @param {import('@playwright/test').Page} page - The page, already opened on the seeded line.
 * @param {string} line - The seeded session's line, which is a page holding only its rows.
 * @returns {Promise<number>} The id of the observation that was destroyed.
 */
async function destroyOne(page, line) {
  return page.evaluate(async (only) => {
    const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare('delete', { line: [only] });
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    await actions.commitPage();
    await actions.confirmDelete();
    eq(state.outcomes.get(id), 'deleted', 'the commit should have destroyed it');
    eq(state.marks.has(id), false, 'a deleted row is not a pending intention');
    return id;
  }, line);
}

/* ============================================ #126: two kinds of mark, two commits
 *
 * The store-level half. What is *drawn* is the render tier; these drive the same actions
 * the interface drives and check what reaches the record.
 */

test('Two kinds of mark: a right click marks accepted, and the main button records it',
  async ({ page, request }) => {
    /* Its own row: this reads the record back, and a page of one is a page whose every
       row was inspected before anything was committed to it. */
    const seeded = await seedPage({ count: 1, thumbnail: 'ready' });

    try {
      await open(page, seeded.address);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });

        /* The endpoint never writes a decision back onto the observation row, so what the
           record now says is asked for rather than read off the rows the page is holding.
           Both status dimensions come off: a row that has just been decided has left the
           question that served it. */
        const record = async () => new Map((await MarpBackend.query({
          filters: { ...state.filters, reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 200
        })).rows.map((r) => [r.observation_id, r]));

        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.review_decision == null);
        ok(target, 'page 1 should hold an unreviewed row with imagery');
        const id = target.observation_id;

        actions.acceptMark(id);
        eq(state.marks.get(id).kind, 'accept', 'the mark carries its kind');

        await actions.commitMarked();

        const row = (await record()).get(id);
        eq(row.review_decision, 'reviewed', 'this one is reviewed');
      }, seeded.line);
    } finally {
      await settle(request, seeded);
    }
  });

test('Two kinds of mark: the main button says nothing at all about a tile nobody touched',
  async ({ page, request }) => {
    /* Three, because this asserts that everything *else* on the page stayed where it was
       -- "a page of one would make this vacuous" is the check's own words. */
    const seeded = await seedPage({ count: 3, thumbnail: 'ready' });

    try {
      await open(page, seeded.address);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });

        const record = async () => new Map((await MarpBackend.query({
          filters: { ...state.filters, reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 200
        })).rows.map((r) => [r.observation_id, r]));

        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.review_decision == null);
        const id = target.observation_id;
        /* Everything else on the page, and what the record says about it now. */
        const before = new Map(state.rows.map((r) => [r.observation_id, r.review_decision]));
        ok(state.rows.length > 1, 'a page of one would make this vacuous');

        actions.toggleMark(id);                        // flag exactly one tile
        await actions.commitMarked();

        const now = await record();
        const moved = state.rows
          .filter((r) => now.get(r.observation_id).review_decision !== before.get(r.observation_id))
          .map((r) => r.observation_id);
        eq(moved, [id], 'only the marked tile moved');
        eq(now.get(id).review_decision, 'flagged');
      }, seeded.line);
    } finally {
      await settle(request, seeded);
    }
  });

test('Two kinds of mark: the main button ignores marks the page arrived with',
  async ({ page, request }) => {
    /**
     * A3. The page still arrives looking pre-marked, because the human asked for that --
     * but pressing this button then would re-commit flags nobody touched, under this
     * reviewer's name and today's date, and `observation_reviews` carries a reviewer per
     * row. `state.touched` is what tells them apart.
     */
    const seeded = await seedPage({ count: 2, thumbnail: 'ready' });

    try {
      await open(page, seeded.address);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.review_decision == null);
        const id = target.observation_id;

        /* Put a flag on the record, then arrive at the page again with nothing touched. */
        actions.toggleMark(id);
        await actions.commitPage();
        state.marks.clear();
        state.touched.clear();
        state.outcomes.clear();
        state.pageMembers.clear();
        state.committedPages.clear();
        /* Widening to flagged is what puts the flagged row back in the question -- and it
           is also what forces a genuine re-read. A commit retires no cached page (#99) and
           the cache is keyed by the question, so refreshing the same one would serve the
           rows as they were before the commit. The fixture never needed this: it wrote the
           row's own column in place, so its cached row was already the committed one. */
        state.filters.reviewStatus = ['unreviewed', 'flagged'];
        await actions.refresh();

        ok(state.marks.has(id), 'the page arrives with the record exception marked');
        const versions = new Map(state.rows.map((r) => [r.observation_id, r.version]));

        await actions.commitMarked();

        const moved = state.rows.filter((r) => r.version !== versions.get(r.observation_id));
        eq(moved.length, 0, 'nothing was written, because nothing was decided in this sitting');
      }, seeded.line);
    } finally {
      await settle(request, seeded);
    }
  });

test('Two kinds of mark: the page sweep is unchanged: it accepts everything that is not an exception',
  async ({ page, request }) => {
    /* Four: one flagged, one accepted by hand, and two the sweep has to accept on its own. */
    const seeded = await seedPage({ count: 4, thumbnail: 'ready' });

    try {
      await open(page, seeded.address);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });

        const record = async () => new Map((await MarpBackend.query({
          filters: { ...state.filters, reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 200
        })).rows.map((r) => [r.observation_id, r]));

        const withPictures = state.rows.filter((r) => r.thumbnail_status === 'ready');
        ok(withPictures.length > 2, 'need a few tiles with imagery');
        const flagged = withPictures[0].observation_id;
        const accepted = withPictures[1].observation_id;

        actions.toggleMark(flagged);
        actions.acceptMark(accepted);
        await actions.commitPage();

        const now = await record();
        eq(now.get(flagged).review_decision, 'flagged');
        eq(now.get(accepted).review_decision, 'reviewed');
        /* And the untouched ones were accepted too, which is the behaviour R4 preserves. */
        const untouched = withPictures.slice(2).map((r) => r.observation_id);
        ok(untouched.length, 'need an untouched tile with imagery');
        for (const id of untouched) {
          eq(now.get(id).review_decision, 'reviewed', `the sweep still accepts ${id}`);
        }
      }, seeded.line);
    } finally {
      await settle(request, seeded);
    }
  });

test('Two kinds of mark: a selective commit does not pin the page, so untouched tiles stay in the work',
  async ({ page }) => {
    /**
     * `page.pinnedIds` becomes the query's `exclude` set. Pinning here would take every
     * untouched tile on the page out of the reviewer's remaining work without saying so,
     * which is exactly the "without it affecting anything else" this feature exists to
     * give them.
     */
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const target = state.rows.find((r) => r.thumbnail_status === 'ready');
      actions.toggleMark(target.observation_id);
      await actions.commitMarked();

      eq(state.committedPages.size, 0, 'the page is not finished, so it is not marked done');
      eq(state.pageMembers.size, 0, 'and nothing is pinned out of later pages');
    });
  });

test('Two kinds of mark: a tile marked one way then the other ends with the later mark',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const id = state.rows.find((r) => r.thumbnail_status === 'ready').observation_id;

      actions.toggleMark(id);
      eq(state.marks.get(id).kind, 'except');
      actions.acceptMark(id);
      eq(state.marks.get(id).kind, 'accept', 'the right click replaces rather than stacking');
      actions.toggleMark(id);
      eq(state.marks.get(id).kind, 'except', 'and the left click replaces it back');
      actions.toggleMark(id);
      ok(!state.marks.has(id), 'the same gesture twice takes it off');
    });
  });

test('Two kinds of mark: an accept mark is refused on a tile with no picture, and the tile says why',
  async ({ page, request }) => {
    /* Seeded rather than hunted for: page 1 may hold no broken thumbnail, and a check that
       returns early when it cannot find one looks green while proving nothing. The fixture
       broke one on demand; here the row genuinely arrives with a failed picture, which is
       the state the client actually has to handle. */
    const seeded = await seedPage({ count: 1, thumbnail: 'failed' });

    try {
      await open(page, seeded.address);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });
        const blind = state.rows[0];
        eq(blind.thumbnail_status, 'failed', 'and the page can see that it is');

        actions.acceptMark(blind.observation_id);

        ok(!state.marks.has(blind.observation_id), 'the mark is refused rather than taken');
        ok(state.refused && state.refused.id === blind.observation_id,
          'and the tile is told to say why');
        /* Flagging the same tile is still allowed: a picture that never arrived is itself
           worth flagging, and that rule is older than this one. */
        actions.toggleMark(blind.observation_id);
        eq(state.marks.get(blind.observation_id).kind, 'except');
      }, seeded.line);
    } finally {
      /* Nothing was committed, so there is nothing to put back -- but the rows still go. */
      await settle(request, seeded);
    }
  });

test('Two kinds of mark: a right click is inert in Delete Mode, where there is nothing to accept',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('delete');
      const id = state.rows[0].observation_id;
      const before = state.marks.size;

      actions.acceptMark(id);

      eq(state.marks.size, before, 'nothing marked');
      ok(!state.refused, 'and nothing refused either: there was nothing wrong with the gesture');
      /* And the main button is not the one Delete uses. */
      await actions.commitMarked();
      eq(state.outcomes.size, 0, 'the main button does nothing in Delete');
    });
  });

test('Two kinds of mark: training promotes only what was marked accepted',
  async ({ page, request }) => {
    /* Its own rows again: this reads the record back, and it asserts that nothing else on
       the page was promoted -- which is a claim about every row on it. */
    const seeded = await seedPage({ count: 3, thumbnail: 'ready' });

    try {
      await open(page, seeded.address);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('training', { line: [line] });

        const record = async () => new Map((await MarpBackend.query({
          filters: { ...state.filters, reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 200
        })).rows.map((r) => [r.observation_id, r]));

        const withPictures = state.rows.filter((r) => r.thumbnail_status === 'ready');
        ok(withPictures.length > 1, 'need two tiles with imagery');
        const promoted = withPictures[0].observation_id;
        const before = new Map(state.rows.map((r) => [r.observation_id, r.training_decision]));

        actions.acceptMark(promoted);
        await actions.commitMarked();

        const now = await record();
        eq(now.get(promoted).training_decision, 'promoted');
        const moved = state.rows
          .filter((r) => now.get(r.observation_id).training_decision !== before.get(r.observation_id))
          .map((r) => r.observation_id);
        eq(moved, [promoted], 'and nothing else was promoted');
      }, seeded.line);
    } finally {
      await settle(request, seeded);
    }
  });

test('Two kinds of mark: a failed selective commit applies nothing and leaves the marks alone',
  async ({ page }) => {
    await open(page);

    /* `failNextCommit`, replaced. The fixture threw inside its own `commitPage`, so what it
       proved was that the simulation worked; aborting the request makes the browser's real
       `fetch` reject and the client's real error path run. Installed after the page has
       loaded, so the reads that got us here were real -- and nothing reaches the record,
       which is why this one commits on the corpus rather than seeding. */
    await page.route(REVIEW_ROUTE, (route) => route.abort('failed'));

    await page.evaluate(async () => {
      const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const id = state.rows.find((r) => r.thumbnail_status === 'ready').observation_id;
      actions.acceptMark(id);

      await actions.commitMarked();

      eq(state.commit.status, 'failed', 'the button says so');
      eq(state.marks.get(id).kind, 'accept', 'and the page never has to be redone');
    });
  });

/* --------------------------------- a committed delete is not interactive (#138) */

test('Delete mode: R2 (#138): a committed delete cannot be marked again',
  async ({ page }) => {
    /* Three of its own. A delete is a real permanent delete, and the API tier may never
       destroy a row it did not create -- so each of these four seeds what it destroys and
       names the ids with `allowDeletes`. The whole seeded page goes as the commit's
       `observations`, so all three are named. */
    const seeded = await seedPage({ count: 3, thumbnail: 'ready' });

    try {
      ledger.allowDeletes(seeded.ids);
      await open(page, seeded.address);
      const id = await destroyOne(page, seeded.line);

      await page.evaluate(async (dead) => {
        const { state, actions, eq } = await import('./tests/api/check-kit.mjs');
        const touched = state.touched.size;
        actions.toggleMark(dead);
        eq(state.marks.has(dead), false, 'the row is gone from the database; nothing may mark it');
        /* The id is already in `touched` -- the reviewer marked it before deleting it -- so
           what this pins is that the dead click changed nothing, rather than the id's absence. */
        eq(state.touched.size, touched, 'and the click decided nothing');

        /* The other half of why this matters: a mark here would be sent by the next commit,
           and the server would answer `not-found` -- a reason that means "somebody else
           deleted this while you were working". */
        await actions.commitPage();
        eq(state.confirm, null, 'with nothing marked there is nothing left to commit');
      }, id);
    } finally {
      await seeded.remove();
    }
  });

test('Delete mode: R3 (#138): the accept gesture does not reach a destroyed tile',
  async ({ page }) => {
    const seeded = await seedPage({ count: 3, thumbnail: 'ready' });

    try {
      ledger.allowDeletes(seeded.ids);
      await open(page, seeded.address);
      const id = await destroyOne(page, seeded.line);

      await page.evaluate(async (dead) => {
        const { state, actions, eq } = await import('./tests/api/check-kit.mjs');
        /* A pin rather than a tripwire, and worth saying so: this also holds for an
           independent reason today, because Delete Mode has no accepted value (#126 A2) and
           destroyed tiles exist only in Delete Mode. The guard is what keeps it true if
           either of those ever stops being. */
        actions.acceptMark(dead);
        eq(state.marks.has(dead), false, 'a right click or a double tap must do nothing');
        eq(state.refused, null, 'and it is not the A4 refusal: a destroyed tile is not a target');
      }, id);
    } finally {
      await seeded.remove();
    }
  });

test('Delete mode: R4 (#138): neither route into the correction panel opens on a destroyed tile',
  async ({ page }) => {
    const seeded = await seedPage({ count: 3, thumbnail: 'ready' });

    try {
      ledger.allowDeletes(seeded.ids);
      await open(page, seeded.address);
      const id = await destroyOne(page, seeded.line);

      await page.evaluate(async (dead) => {
        const { state, actions, eq } = await import('./tests/api/check-kit.mjs');
        /* The reachable one. `openCorrection` creates an exception mark on its way in, so the
           "was X" chip on a row corrected earlier in the sitting could mark a destroyed row
           even with `toggleMark` guarded. */
        actions.openCorrection(dead);
        eq(state.picker, null, 'the chip must not open the chooser');
        eq(state.marks.has(dead), false, 'and must not have marked it on the way');

        actions.openPicker(dead);
        eq(state.picker, null, 'and the badge opens nothing either');
      }, id);
    } finally {
      await seeded.remove();
    }
  });

test('Delete mode: R5 (#138): marking the page steps over what the page has already destroyed',
  async ({ page }) => {
    const seeded = await seedPage({ count: 3, thumbnail: 'ready' });

    try {
      ledger.allowDeletes(seeded.ids);
      await open(page, seeded.address);
      const id = await destroyOne(page, seeded.line);

      await page.evaluate(async (dead) => {
        const { state, actions, eq } = await import('./tests/api/check-kit.mjs');
        const others = state.rows.filter((r) => r.observation_id !== dead).length;

        actions.markAllOnPage();
        eq(state.marks.has(dead), false, 'the destroyed row must not be marked');
        eq(state.marks.size, others, 'every other row on the page is');

        /* The count in front of a permanent deletion is the number that gets deleted, so it
           has to have stepped over the destroyed row too. */
        await actions.commitPage();
        eq(state.confirm.count, others, 'the confirmation must name only rows that still exist');
        actions.cancelDelete();
      }, id);
    } finally {
      await seeded.remove();
    }
  });

/* A named export so the file is not mistaken for a place to add a helper: everything
   shared lives in `check-kit.mjs`, which the page imports, or in `support.mjs`, which Node
   does. `record()` is written out inside the four checks that re-read the record rather
   than being added to the kit -- it is four lines, and the kit is being migrated into by
   several agents at once. */
export { };
