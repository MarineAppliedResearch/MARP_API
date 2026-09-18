/**
 * Requirement checks: the delete confirmation, the thumbnail states, and the keyboard.
 *
 * Migrated from `tests/requirements.js` when #157 retired the fixture -- lines 947 to
 * 1344, nineteen checks. Each still names the requirement from MARP_API#68 that it holds
 * the prototype to, and still drives the same named actions the interface drives.
 *
 * **This is the chunk the fixture affordances lived in**, so it is the chunk where the
 * "what changed" list is longest. Four things moved and nothing else did:
 *
 * - **`MarpData.breakThumbnails` is `seedPage`.** A page whose pictures failed cannot be
 *   *asked* for -- the mosaic has no thumbnail-status filter -- so these checks create
 *   observations of their own in a session of their own and destroy them afterwards.
 *   Rewriting the endpoint's answer with `page.route` was the alternative and it is
 *   rejected for the reason `seed.mjs` gives: #157 exists to stop a browser tier grading
 *   something that is not the server.
 * - **`MarpData.bumpVersion` is a real species correction** from the Node half, between
 *   the page being read and the commit being sent. That is what a second reviewer
 *   actually is, and a database trigger moves `version` on it.
 * - **`MarpData` is `MarpBackend`**, the application's own seam. It is a plain object
 *   whose methods delegate, so a check that wrapped a method to count calls wraps it in
 *   exactly the same way.
 * - **`reset()` is `prepare()` plus the page load Playwright already gives every test.**
 *   There is no `reload()` against a real server, and a fresh page is the only reset that
 *   is actually a reset.
 *
 * **Seeded rows are removed after the journal has restored, never before**, which is why
 * they are collected here rather than torn down in each check's own `finally`. The journal
 * puts a decision back *through the API*, and a row that has already been deleted cannot
 * be read back -- so removing first turns a restore into a failure about missing rows.
 * `afterEach` runs whatever the check did, so the removal is still guaranteed.
 *
 * Refs #157.
 */

import pg from 'pg';

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import {
  correctSpecies,
  expectRealBacking,
  facetsFor,
  ready,
  undecided
} from './support.mjs';

/** Every check here may write, so every one of them puts the record back. */
let ledger = null;

/** Seeded pages this check made. Removed in `afterEach`, after the restore. */
let disposable = [];

test.beforeEach(({ page, request }) => {
  ledger = journal(page);
  disposable = [];
});

test.afterEach(async ({ request }) => {
  try {
    await ledger.restore(request);
  } finally {
    for (const seeded of disposable) await seeded.remove();
  }
});

/** Seed a page and register it for removal, so no check can forget to. */
async function seedFor(options) {
  const seeded = await seedPage(options);
  disposable.push(seeded);
  return seeded;
}

/** Open the application and wait for it to settle, before a check drives the store. */
async function open(page, address = undecided()) {
  await page.goto(address);
  await expectRealBacking(page);
  await ready(page);
}

/**
 * Give a seeded thumbnail the `last_error` the retry route reports as its `reason`.
 *
 * **Defined here rather than in `seed.mjs` because that file is shared** and other agents
 * are working in it. R13 asserts the client is told *why* a permanent failure was refused,
 * and the retry route reads that from `observation_thumbnails.last_error`, which the
 * seeder does not write -- so without this the check would have to drop the one assertion
 * that is about the reason reaching the row. It writes one column, on rows the check
 * itself created; everything the check *asserts* still goes through the API.
 *
 * @param {Array<number>} ids - Seeded observations.
 * @param {string} text - The error text to record.
 * @returns {Promise<void>} Resolves when it is written.
 */
async function recordThumbnailError(ids, text) {
  const database = process.env.MARP_TESTING_DB_NAME;
  expect(database, 'MARP_TESTING_DB_NAME is not set, so this check does not know which '
    + 'database it may write to. `npm run test:app:mosaic-review:api` sets it.').toBeTruthy();

  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
  });

  await client.connect();
  try {
    await client.query(
      'UPDATE observation_thumbnails SET last_error = $2 WHERE observation_id = ANY($1)',
      [ids, text]
    );
  } finally {
    await client.end();
  }
}

/** Finish this check's queued replacement the way the extractor records success. */
async function completeThumbnailReplacement(id) {
  const database = process.env.MARP_TESTING_DB_NAME;
  expect(database, 'MARP_TESTING_DB_NAME is required for the disposable browser database')
    .toBeTruthy();
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
  });

  await client.connect();
  try {
    await client.query(
      `UPDATE observation_thumbnails
          SET status = 'ready', permanent = false, request_priority = 0,
              generation = generation + 1, claimed_at = NULL,
              completed_at = NOW(), updated_at = NOW()
        WHERE observation_id = $1`,
      [id]
    );
  } finally {
    await client.end();
  }
}

/* ------------------------------------------- the delete confirmation (#71) */

/**
 * These count what actually reaches the data seam.
 *
 * The requirement is "nothing is sent until the reviewer confirms", and the only honest
 * way to check that is to count the calls. Looking at the screen would pass whenever the
 * dialog appeared, whether or not a delete went out behind it.
 *
 * Each wraps MarpBackend.commitPage and restores it in a `finally`, so a failing check
 * cannot leave the seam stubbed for everything that runs after it.
 */
test('Delete mode: R1: committing sends nothing until the reviewer confirms',
  async ({ page }) => {
    /* Nothing is sent, so nothing is destroyed and this needs no rows of its own. */
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('delete');
      const real = MarpBackend.commitPage;
      let calls = 0;
      MarpBackend.commitPage = (...a) => { calls++; return real.apply(MarpBackend, a); };
      try {
        actions.toggleMark(state.rows[0].observation_id);
        actions.toggleMark(state.rows[1].observation_id);
        await actions.commitPage();

        eq(calls, 0, 'the first click must not send a delete');
        ok(state.confirm, 'it must be waiting on a confirmation');
        eq(state.confirm.count, 2, 'and it must know how many');
      } finally { MarpBackend.commitPage = real; }
    });
  });

test('Delete mode: R1: cancelling sends nothing and leaves every mark exactly as it was',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('delete');
      const real = MarpBackend.commitPage;
      let calls = 0;
      MarpBackend.commitPage = (...a) => { calls++; return real.apply(MarpBackend, a); };
      try {
        const ids = [state.rows[0].observation_id, state.rows[1].observation_id];
        ids.forEach((id) => actions.toggleMark(id));
        await actions.commitPage();
        actions.cancelDelete();

        eq(calls, 0, 'cancelling must not send anything');
        eq(state.confirm, null, 'the dialog must be closed');
        eq(ids.every((id) => state.marks.has(id)), true,
          'every mark must survive a cancel, or the page has to be redone');
      } finally { MarpBackend.commitPage = real; }
    });
  });

test('Delete mode: R1: confirming sends exactly one delete', async ({ page }) => {
  /* This one really destroys an observation, and nothing can un-delete one -- so it
     creates its own and names them to the journal, which refuses any other delete. */
  const seeded = await seedFor({ count: 3 });
  ledger.allowDeletes(seeded.ids);

  await open(page, seeded.address);
  await page.evaluate(async (line) => {
    const { state, actions, eq, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
    await prepare('delete', { line: [line] });
    const real = MarpBackend.commitPage;
    let calls = 0;
    MarpBackend.commitPage = (...a) => { calls++; return real.apply(MarpBackend, a); };
    try {
      actions.toggleMark(state.rows[0].observation_id);
      await actions.commitPage();
      await actions.confirmDelete();
      /* A second confirm is a no-op, so a double click cannot delete twice. */
      await actions.confirmDelete();

      eq(calls, 1, 'exactly one delete may be sent');
      eq(state.confirm, null, 'and the dialog must be closed afterwards');
    } finally { MarpBackend.commitPage = real; }
  }, seeded.line);
});

test('Delete mode: A5: with nothing marked there is no dialog and nothing is sent',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('delete');
      const real = MarpBackend.commitPage;
      let calls = 0;
      MarpBackend.commitPage = (...a) => { calls++; return real.apply(MarpBackend, a); };
      try {
        await actions.commitPage();
        eq(calls, 0, 'nothing marked is not a deletion');
        eq(state.confirm, null, 'and must not raise a dialog to confirm destroying nothing');
      } finally { MarpBackend.commitPage = real; }
    });
  });

test('Delete mode: R4: scientific and training commit immediately, with no confirmation',
  async ({ page }) => {
    /* Rows of its own, because both halves of this commit a whole page: a sweep over the
       corpus would decide fifty real observations twice to prove a dialog did not
       appear. */
    const seeded = await seedFor({ count: 3 });

    await open(page, seeded.address);
    await page.evaluate(async (line) => {
      const { state, actions, eq, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      for (const mode of ['scientific', 'training']) {
        /* The status dimensions are switched off rather than left at `prepare`'s
           defaults: the scientific pass reviews these rows, and a training pass asking
           for unreviewed work would then find an empty page and commit nothing at all --
           which would pass this check by doing none of what it is about. */
        await prepare(mode, { line: [line], reviewStatus: [], trainingDisposition: [] });
        const real = MarpBackend.commitPage;
        let calls = 0;
        MarpBackend.commitPage = (...a) => { calls++; return real.apply(MarpBackend, a); };
        try {
          await actions.commitPage();
          eq(calls, 1, `${mode} must commit on the first click`);
          eq(state.confirm, null, `${mode} must never raise a delete confirmation`);
        } finally { MarpBackend.commitPage = real; }
      }
    }, seeded.line);
  });

/* ------------------------------------ the states never rendered (#72) */

test('The states never rendered: R8: a flag on a row with no imagery reaches the record',
  async ({ page }) => {
    /* `breakThumbnails`, replaced: an observation whose thumbnail row genuinely says
       `failed`, served and paged by the real query. */
    const seeded = await seedFor({ count: 2, thumbnail: 'failed' });

    await open(page, seeded.address);
    await page.evaluate(async ({ line, broken }) => {
      const { state, actions, eq, ok, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });

      const id = broken;
      eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'failed',
        'the check needs a row nobody could see');

      actions.toggleMark(id);
      await actions.commitPage();

      /* Read it back through the seam rather than trusting the outcome map: the bug this
         covers was the write never happening, which an in-memory outcome would still
         show. Queried, so it is the record answering rather than the page. */
      const back = await MarpBackend.query({
        filters: { ...state.filters, reviewStatus: ['flagged'] }, page: 1, pageSize: 500,
      });
      ok(back.rows.some((r) => r.observation_id === id),
        'the flag must be written even though nobody could see the picture');
    }, { line: seeded.line, broken: seeded.ids[0] });
  });

test('#134 R1, R2, R9: requesting a replacement clears the pending flag and writes no review',
  async ({ page }) => {
    const seeded = await seedFor({ count: 1, thumbnail: 'ready' });
    const id = seeded.ids[0];

    await open(page, seeded.address);
    const tile = page.locator(`.tile[data-id="${id}"]`);

    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick .chip', { hasText: 'Duplicate' }).click();
    await page.locator('.pick [data-act="replace-thumbnail"]').click();

    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/queued/);

    await page.evaluate(async (observationId) => {
      const { state, ok, eq, MarpBackend } = await import('./tests/api/check-kit.mjs');
      const row = state.rows.find((candidate) => candidate.observation_id === observationId);

      eq(row.thumbnail_status, 'queued', 'the accepted replacement paints PREPARING');
      ok(!state.marks.has(observationId), 'the temporary flag and its details are gone');
      ok(!state.touched.has(observationId), 'the cleared flag cannot enter a later selective commit');

      const back = await MarpBackend.query({
        filters: { ...state.filters, reviewStatus: ['flagged'] }, page: 1, pageSize: 500,
      });
      ok(!back.rows.some((candidate) => candidate.observation_id === observationId),
        'requesting extraction must not append or project a scientific review');
    }, id);

    await completeThumbnailReplacement(id);
    await expect(tile).not.toHaveClass(/queued/, { timeout: 5000 });
    await expect(tile.locator('img')).toBeVisible();
  });

/**
 * #203 R1, R2, R4: the same ask, from training mode.
 *
 * **The tier matters here more than usual.** The defect was two gates on one rule -- the
 * button was not rendered (`picker.js`) *and* the action returned early (`store.js`) --
 * so a store-level check calling `actions.requestThumbnailReplacement` would have gone on
 * passing after only one of them came out, on a popup with no button on it.
 */
test('#203 R1, R2, R4: a replacement image can be asked for in training mode',
  async ({ page }) => {
    const seeded = await seedFor({ count: 1, thumbnail: 'ready' });
    const id = seeded.ids[0];

    await open(page, `${seeded.address}&mode=training`);
    const tile = page.locator(`.tile[data-id="${id}"]`);

    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick .chip', { hasText: 'Occluded' }).click();

    const replace = page.locator('.pick [data-act="replace-thumbnail"]');
    await expect(replace).toBeVisible();
    /* R4: it names the mark of the mode it is shown in. The title said "flag" in both. */
    await expect(replace).toHaveAttribute('title', /exclusion/i);
    await replace.click();

    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/queued/);

    await page.evaluate(async (observationId) => {
      const { state, ok, eq, MarpBackend } = await import('./tests/api/check-kit.mjs');
      const row = state.rows.find((candidate) => candidate.observation_id === observationId);

      eq(row.thumbnail_status, 'queued', 'the accepted replacement paints PREPARING');
      ok(!state.marks.has(observationId), 'the pending exclusion and its details are gone');
      ok(!state.touched.has(observationId),
        'the cleared exclusion cannot enter a later selective commit');

      /* The training counterpart of #134 R9: asking for a picture is not a decision about
         the track, so nothing may have been written to either workflow. */
      const back = await MarpBackend.query({
        filters: { ...state.filters, trainingDisposition: ['excluded'] }, page: 1, pageSize: 500,
      });
      ok(!back.rows.some((candidate) => candidate.observation_id === observationId),
        'requesting extraction must not append or project a training decision');
    }, id);

    await completeThumbnailReplacement(id);
    await expect(tile).not.toHaveClass(/queued/, { timeout: 5000 });
    await expect(tile.locator('img')).toBeVisible();
  });

/**
 * #203 R3: the refusal path, in training mode.
 *
 * A permanent failure is refused by the endpoint rather than re-queued, and the client
 * learns that from the answer. What the reviewer must get back is the state they were in:
 * the exclusion they had staged, the popup they had open, and the reason it was refused.
 */
test('#203 R3: a refused replacement in training mode restores the mark and says why',
  async ({ page }) => {
    const beyondHelp = await seedFor({ count: 1, thumbnail: 'failed', permanent: true });
    const id = beyondHelp.ids[0];
    await recordThumbnailError(beyondHelp.ids, 'no keyframes: nothing to crop');

    await open(page, `${beyondHelp.address}&mode=training`);
    const tile = page.locator(`.tile[data-id="${id}"]`);

    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick .chip', { hasText: 'Occluded' }).click();
    await page.locator('.pick [data-act="replace-thumbnail"]').click();

    /* The popup comes back rather than staying shut, because the decision it was holding
       was never recorded anywhere else. */
    await expect(page.locator('.pick')).toBeVisible();
    await expect(page.locator('.pick .chip.on', { hasText: 'Occluded' })).toBeVisible();
    await expect(tile).not.toHaveClass(/queued/);

    await page.evaluate(async (observationId) => {
      const { state, ok, eq } = await import('./tests/api/check-kit.mjs');
      const row = state.rows.find((candidate) => candidate.observation_id === observationId);

      eq(row.thumbnail_status, 'failed', 'a refusal leaves the row exactly as it was');
      eq(row.thumbnail_permanent, true, 'and the row now carries the refusal');
      ok(row.thumbnail_reason, 'with the reason the endpoint gave');
      ok(state.marks.has(observationId), 'the staged exclusion is given back');
    }, id);
  });

test('The states never rendered: R8: an unmarked row with no imagery is skipped, never silently accepted',
  async ({ page }) => {
    /**
     * **A mixture, and it takes two seeded sessions.** The original broke one row of an
     * otherwise healthy page, and that asymmetry is the check: the commit accepts the
     * rows with pictures and must skip the one without. A page seeded entirely `failed`
     * would pass while the commit acted on nothing at all.
     *
     * The mosaic's `line` filter is multi-valued -- `s.line = ANY(varchar[])` in
     * `mosaic.repository` -- so two sessions are still one mosaic question, which is what
     * makes a per-row thumbnail state expressible without a per-row seeder.
     */
    const withPictures = await seedFor({ count: 3, thumbnail: 'ready' });
    const broken = await seedFor({ count: 1, thumbnail: 'failed' });

    await open(page, withPictures.address);
    await page.evaluate(async ({ lines, id }) => {
      const { state, actions, eq, ok, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: lines });

      eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'failed',
        'the check needs a row nobody could see, on a page of rows they could');
      ok(state.rows.some((r) => r.thumbnail_status === 'ready'),
        'and it needs the rest of the page to be acceptable, or nothing is being skipped');

      await actions.commitPage();

      const reviewed = await MarpBackend.query({
        filters: { ...state.filters, reviewStatus: ['reviewed'] }, page: 1, pageSize: 500,
      });
      ok(!reviewed.rows.some((r) => r.observation_id === id),
        'accepting means somebody looked at it, and nobody could');
    }, { lines: [withPictures.line, broken.line], id: broken.ids[0] });
  });

test('The states never rendered: R7: a failed thumbnail can be asked for again',
  async ({ page }) => {
    const seeded = await seedFor({ count: 2, thumbnail: 'failed' });

    await open(page, seeded.address);
    await page.evaluate(async ({ line, id }) => {
      const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'failed');

      /**
       * F10, R12: a retry answers **`queued`**, never a synchronous `ready`.
       *
       * This asserted that the imagery came back, which was the fixture's shortcut. An
       * accepted retry has not happened yet -- extraction runs at three concurrent
       * Jellyfin streams -- so the tile stays at PREPARING and the poll (A8) is what
       * clears it. The old assertion is exactly how the client came to believe a picture
       * existed the moment it asked for one.
       */
      await actions.retryThumbnail(id);
      eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'queued',
        'a retry asks for a picture; it cannot conjure one');
    }, { line: seeded.line, id: seeded.ids[0] });
  });

test('The states never rendered: R7: retrying a page costs two renders, not two per tile',
  async ({ page }) => {
    /* Rendering here is a full re-render from state, deliberately -- so the cost of an
       action is the number of times it notifies. `retryFailedThumbnails` called
       `retryThumbnail` per row, and each of those notifies twice: a page of fifty cost a
       hundred full re-renders, each rebuilding all fifty tiles. Measured at 972 ms idle,
       and enough under parallel test workers to blow a twenty-second timeout, which is
       what made two browser tests flaky. Two paints: one to show the page queued, one when
       the answers are in. */

    /* Six rather than a whole page. The rule being measured is per-tile against per-page,
       and six tiles cost twelve renders the old way against four the new -- decisive
       already. Seeding fifty observations to widen a gap that is decisive is minutes of
       inserts for nothing. */
    const seeded = await seedFor({ count: 6, thumbnail: 'failed' });

    await open(page, seeded.address);
    await page.evaluate(async (line) => {
      const { state, actions, eq, ok, prepare, subscribe, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      const ids = state.rows.map((r) => r.observation_id);

      let renders = 0;
      let calls = 0;
      const realRetry = MarpBackend.retryThumbnails;
      MarpBackend.retryThumbnails = (...a) => { calls++; return realRetry.apply(MarpBackend, a); };
      const off = subscribe(() => { renders++; });
      try {
        await actions.retryFailedThumbnails();
      } finally {
        off();
        MarpBackend.retryThumbnails = realRetry;
      }

      ok(renders <= 4,
        `a page-level retry must not re-render per tile: ${ids.length} tiles cost ${renders} renders`);
      /**
       * A9, R11: **one request as well as two paints.**
       *
       * The check only ever counted renders, and #68's own note says why that is not
       * enough: "a regression to 45 requests would pass". So the request count is asserted
       * beside it now -- a seam method taking ids rather than `retryThumbnail` mapped over
       * the page is the honest shape, and coalescing N calls inside `api/` would hide a
       * round trip this tier cannot otherwise see.
       */
      eq(calls, 1, `a page-level retry is one request, not ${ids.length}`);
      /**
       * F10, R12: the tiles are **`queued`**, not `ready`.
       *
       * This asserted `every(r => r.thumbnail_status === 'ready')`, which was the
       * fixture's shortcut: the endpoint answers `queued` for work it accepted and
       * **never a terminal `ready` invented synchronously** -- an accepted retry has not
       * happened yet. So a retry leaves the tile at PREPARING and the poll (A8) clears it.
       */
      ok(state.rows.every((r) => r.thumbnail_status === 'queued'),
        `an accepted retry is queued work, not a picture; got ${
          JSON.stringify([...new Set(state.rows.map((r) => r.thumbnail_status))])}`);
    }, seeded.line);
  });

test('The states never rendered: R7: a whole failed page can be retried at once',
  async ({ page }) => {
    const seeded = await seedFor({ count: 4, thumbnail: 'failed' });

    await open(page, seeded.address);
    await page.evaluate(async (line) => {
      const { state, actions, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      ok(state.rows.every((r) => r.thumbnail_status === 'failed'), 'the page starts broken');

      await actions.retryFailedThumbnails();
      /* Queued, not ready -- see the check above. The case that motivated a page-level
         retry is a page where everything failed, and what it buys is one request. */
      ok(state.rows.every((r) => r.thumbnail_status === 'queued'),
        `the whole page was accepted for extraction in one request; got ${
          JSON.stringify([...new Set(state.rows.map((r) => r.thumbnail_status))])}`);
    }, seeded.line);
  });

/**
 * F11 and R13, at the store tier. **A state the client had code for and no data.**
 *
 * `src/data.js:494` short-circuited a retry on `current.thumbnail_permanent`, and no row
 * has ever carried the key -- one grep hit, in the file reading it. The endpoint does not
 * put it on a page either: it answers `permanent: true` per *retry* entry and refuses
 * rather than re-queueing, because an observation with no keyframes has no bounding box
 * and can never have a cropped picture. Without that refusal the page's "Ask again"
 * button is a way to hammer a shared media server.
 */
test('The states never rendered: R13: a permanent failure is not re-queued, and the row says why',
  async ({ page }) => {
    /* Two sessions, because the check is about the *difference* between two rows and
       `seedPage` gives one thumbnail state per page. The `line` filter is multi-valued,
       so the two are still one mosaic question. */
    const beyondHelp = await seedFor({ count: 1, thumbnail: 'failed', permanent: true });
    const retryable = await seedFor({ count: 1, thumbnail: 'failed' });

    /* The refusal's `reason` is the thumbnail row's `last_error`, which the shared seeder
       does not write. See `recordThumbnailError` above for why it is filled in here. */
    await recordThumbnailError(beyondHelp.ids, 'no keyframes: nothing to crop');

    await open(page, beyondHelp.address);
    await page.evaluate(async ({ lines, first, second }) => {
      const { state, actions, eq, ok, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: lines });

      let asked = null;
      const realRetry = MarpBackend.retryThumbnails;
      MarpBackend.retryThumbnails = (ids, opts) => {
        asked = [...ids];
        return realRetry.call(MarpBackend, ids, opts);
      };

      try {
        /**
         * The **first** ask includes both, and that is correct rather than a defect: a
         * page does not say which failures are permanent -- the endpoint answers
         * `permanent: true` per retry entry and refuses that one, which is where the
         * client learns it. That asymmetry is the whole of F11: the client had code
         * reading a row field no row has ever carried, so it never learned anything.
         */
        await actions.retryFailedThumbnails();
        ok(asked.includes(first) && asked.includes(second),
          'the page cannot know which failures are permanent until it asks');

        const permanent = state.rows.find((r) => r.observation_id === first);
        eq(permanent.thumbnail_status, 'failed', 'it stays failed, because nothing can help');
        eq(permanent.thumbnail_permanent, true, 'and the row now carries the refusal');
        ok(permanent.thumbnail_reason, 'with the reason the endpoint gave');
        eq(state.rows.find((r) => r.observation_id === second).thumbnail_status, 'queued',
          'the retryable one was accepted');

        /* And the **second** ask leaves it out, which is what stops the button becoming a
           way to hammer a shared media server for a picture that cannot exist. */

        /* `breakThumbnails([second], 'failed')` rewrote the *client's* picture of that
           row, and so does this. It is deliberately not a re-query: a fresh page would
           drop `thumbnail_permanent` from the other row, because no served row has ever
           carried it (F11) -- and that field is the whole thing under test. What a
           page-level retry asks for is decided from `state.rows`, so `state.rows` is
           what the setup has to put in the state the check is about. */
        const back = state.rows.find((r) => r.observation_id === second);
        back.thumbnail_status = 'failed';
        back.thumbnail_permanent = false;

        asked = null;
        await actions.retryFailedThumbnails();
        ok(!asked.includes(first), 'a permanent failure is never asked for twice');
        ok(asked.includes(second), 'and the retryable one still is');
      } finally { MarpBackend.retryThumbnails = realRetry; }
    }, { lines: [beyondHelp.line, retryable.line], first: beyondHelp.ids[0], second: retryable.ids[0] });
  });

/**
 * F5 and R8, at the tier that can see it. **The silent one.**
 *
 * `page.applyCommit` read `r.id`, and every entry of `MosaicCommitResult` is keyed
 * `observation_id`. So one map entry was written under the key `undefined` and **every
 * tile on a committed page showed no outcome at all** -- no error, no log, and a page that
 * looks exactly as though the commit never happened.
 */
test('Exception marking and the page commit: R8: every tile a commit acted on carries an outcome afterwards',
  async ({ page }) => {
    /* Its own rows: this sweeps a whole page, and a page of the corpus is fifty real
       observations decided to prove a map is keyed correctly. */
    const seeded = await seedFor({ count: 3, thumbnail: 'ready' });

    await open(page, seeded.address);
    await page.evaluate(async (line) => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      const withImagery = state.rows.filter((r) => r.thumbnail_status === 'ready');
      ok(withImagery.length > 1, 'the check needs a page with imagery on it');
      const flagged = withImagery[0].observation_id;
      actions.toggleMark(flagged);

      await actions.commitPage();

      /* Not "some outcome exists": an outcome for **each** row the commit acted on, found
         by its own id. A single entry under `undefined` satisfied every earlier
         assertion. */
      for (const r of withImagery) {
        ok(state.outcomes.has(r.observation_id),
          `observation ${r.observation_id} was committed and has no outcome`);
      }
      eq(state.outcomes.get(flagged), 'flagged');
      ok(!state.outcomes.has(undefined),
        'the old `r.id` read wrote exactly one entry, under the key undefined');
    }, seeded.line);
  });

/**
 * R9. A commit refused because the row moved underneath the page.
 *
 * **Not a refusal for being second** -- the last commit wins, and nothing is ever turned
 * away for arriving after somebody else. This fires only where the annotation changed
 * while the reviewer was looking at it, which is the one case where "last write wins"
 * would mean silently discarding a correction they never saw.
 */
test('Concurrent review: R9: a row that moved under the page comes back conflicted, with its mark kept',
  async ({ page, request }) => {
    /* Its own rows, so the correction that creates the conflict lands on an observation
       nobody is relying on -- and so the sweep beside it decides two rows rather than
       forty-nine. */
    const seeded = await seedFor({ count: 3, thumbnail: 'ready' });

    /* Something else in the catalogue, discovered rather than named: a correction to the
       species a row already carries is refused as `unchanged`, deliberately. The seeded
       species is read back from the facets of its own line, because a mosaic row does not
       carry `species_id` -- it carries two names, and neither is an id. */
    const mine = await facetsFor(request, { line: [seeded.line] });
    const everything = await facetsFor(request, {});
    const other = (everything.species || [])
      .find((candidate) => candidate.value !== (mine.species || [])[0].value);
    expect(other, 'the corpus holds only one species, so nothing can be corrected to '
      + 'anything else and this check has nothing to be about.').toBeTruthy();

    await open(page, seeded.address);

    const target = await page.evaluate(async (line) => {
      const { state, actions, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      const row = state.rows.find((r) => r.thumbnail_status === 'ready');
      actions.toggleMark(row.observation_id);
      actions.setReason(row.observation_id, 'Wrong species');
      return { observation_id: row.observation_id, version: row.version };
    }, seeded.line);

    /* Somebody else's write, between the page being fetched and the commit being sent.
       `bumpVersion`, replaced: a correction edits the observation row itself and a
       database trigger moves `version` on that update, which is the actual race. */
    await correctSpecies(request, target, other.value);

    await page.evaluate(async (id) => {
      const { state, actions, eq, ok } = await import('./tests/api/check-kit.mjs');

      await actions.commitPage();

      eq(state.outcomes.get(id), 'conflicted', 'the reviewer is told, rather than overwritten');
      ok(state.conflicted.includes(id), 'and the page can offer to re-read');
      ok(state.marks.has(id), 'nothing was written, so the intention is still pending');
      eq(state.marks.get(id).reason, 'Wrong species', 'reason and all');

      /* Everything else on the page still landed: outcomes are per observation, so
         forty-nine decisions land while one comes back conflicted. */
      const others = state.rows.filter((r) => r.observation_id !== id
        && r.thumbnail_status === 'ready');
      ok(others.length, 'the check needs something else on the page to have landed');
      for (const r of others) {
        ok(state.outcomes.has(r.observation_id),
          'a conflict on one row must not roll back the rest of the page');
      }
    }, target.observation_id);
  });

test('The states never rendered: R6: a queued thumbnail becomes ready, and a commit waits for it',
  async ({ page }) => {
    /**
     * **`thumbnail: 'queued'`, and it is seeded already claimed.** `seed.mjs` does that
     * part; what matters here is why a check about a queued picture needs it.
     *
     * This was `'none'` first, on the reasoning that a missing row coalesces to `queued`
     * and leaves the extraction runner nothing to take. That is half true and the wrong
     * half: the page query's own backstop inserts a real queued row, the runner claims it
     * within a second, finds a seeded observation has no keyframes, and records a
     * permanent failure -- so the row read `failed` by the time the assertion got to it.
     * It passed at one viewport and failed at the other in the same run, which is what a
     * race looks like from the outside.
     */
    const seeded = await seedFor({ count: 2, thumbnail: 'queued' });

    await open(page, seeded.address);
    await page.evaluate(async ({ line, id }) => {
      const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'queued');

      /* A retry on an already-queued row is a no-op: the picture is already asked for. */
      await actions.retryThumbnail(id);
      eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'queued');
    }, { line: seeded.line, id: seeded.ids[0] });
  });

test('The states never rendered: R1: clearing the filters from an empty result actually re-queries',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific');
      /* A combination that matches nothing. */
      state.filters.species = [-1];            // a key nothing carries (F1)
      await actions.refresh();
      eq(state.rows.length, 0, 'the filter must really empty the page');

      await actions.clearFilters();
      ok(state.rows.length > 0, 'clearing must bring the mosaic back, not just hide the message');
    });
  });

test('The states never rendered: R4: a result smaller than a page does not invent a second one',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific');
      state.filters.species = [-1];            // a key nothing carries (F1)
      await actions.refresh();
      eq(state.total, 0);
      eq(state.rows.length, 0);
      /* The pager derives from total; a phantom page two is the classic off-by-one here. */
      ok(state.total <= state.pageSize, 'nothing beyond one page can exist');
    });
  });

/* ------------------------------------------- keyboard shortcuts (#74) */

test('Keyboard shortcuts: R1: the paging shortcut moves the page, not just the key handler',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, ok, prepare, wait } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific');
      const first = state.page;
      actions.goToPage(state.page + 1);
      /* Polled rather than a flat 400 ms: a real query is a round trip over hundreds of
         thousands of rows, and a fixed wait tuned against the fixture's simulated latency
         is a flake waiting for a slow afternoon. */
      for (let attempt = 0; attempt < 60 && state.loading; attempt += 1) await wait(250);
      ok(state.page > first, 'the action behind the shortcut must really page');
    });
  });

test('Keyboard shortcuts: R2: clearing marks really empties them', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare('scientific');
    actions.toggleMark(state.rows[0].observation_id);
    actions.toggleMark(state.rows[1].observation_id);
    eq(state.marks.size, 2);

    actions.clearMarks();
    eq(state.marks.size, 0, 'C must clear the page, not just redraw it');
  });
});

test('Keyboard shortcuts: R4: the commit behind Ctrl+Enter reaches the seam exactly once',
  async ({ page }) => {
    /* Its own rows: the gesture commits the page, and what is counted is the number of
       requests rather than anything about which observations they were about. */
    const seeded = await seedFor({ count: 3, thumbnail: 'ready' });

    await open(page, seeded.address);
    await page.evaluate(async (line) => {
      const { actions, eq, prepare, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      const real = MarpBackend.commitPage;
      let calls = 0;
      MarpBackend.commitPage = (...a) => { calls++; return real.apply(MarpBackend, a); };
      try {
        await actions.commitPage();
        eq(calls, 1, 'one keypress, one commit');
      } finally { MarpBackend.commitPage = real; }
    }, seeded.line);
  });

/* A named export so the file is not mistaken for a place to add a helper: everything
   shared lives in `check-kit.mjs`, which the page imports, or in `support.mjs`, which
   Node does. */
export { };
