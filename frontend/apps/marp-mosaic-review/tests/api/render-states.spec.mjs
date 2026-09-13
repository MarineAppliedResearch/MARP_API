/**
 * The delete confirmation, the states never rendered, and the keyboard shortcuts --
 * against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it. The
 * three consequences of that change live in `support.mjs` rather than being restated per
 * file: the page size follows the viewport, a bare address is not `filters: {}`, and a
 * tile is never chosen by position.
 *
 * **Five checks arrived here needing data this corpus does not hold, and each is
 * `test.fixme`d rather than weakened.** They are named in one place so the seeder that
 * answers them can be written from this list rather than from the diff:
 *
 * - `R2: confirming deletes exactly the number it named` needs **four disposable
 *   observations** it may destroy. The fixture deleted for free; here the delete is real
 *   and permanent, and `journal.mjs` refuses a delete of any row the test did not create.
 * - `R3: a page with no imagery disables the commit and says why` needs **every row on one
 *   page** in thumbnail state `failed`.
 * - `R7: the banner offers to ask for the imagery again` needs the same page, and the rows
 *   must be **disposable**: it presses retry, which really queues an extraction.
 * - `R5: the button says how many will be skipped` needs **three** `failed` rows on a page
 *   that also holds rows with pictures.
 * - `R7: Ctrl+Enter on a page that cannot be committed says so` needs the same whole page
 *   of `failed` rows as `R3`.
 *
 * `openOnBrokenPicture` gives exactly **one** genuinely failed row, which is what the
 * corpus can offer: it holds fifteen of them and the mosaic has no thumbnail-status
 * filter, so a whole page of them cannot be asked for. Nothing here fakes the endpoint's
 * own answer to get around that -- a better fake is not the fix for damage done by a fake.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  expectRealBacking,
  freshTile,
  openOnBrokenPicture,
  openRail,
  ready,
  undecided
} from './support.mjs';

/** Several checks here commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/* ------------------------------------------- the delete confirmation (#71) */

test.describe('the delete confirmation', () => {
  /**
   * Into Delete Mode with `n` tiles marked, ready to commit.
   *
   * The mode is chosen by clicking the segment, not by a query parameter -- the app
   * does not read one. An earlier version of these tests used `?mode=delete`, ran the
   * whole thing in scientific review, and reported a missing dialog when what had
   * actually happened was an ordinary review commit.
   *
   * `setMode` rewrites the status filters to the new mode's own defaults, so the
   * `undecided()` narrowing does not survive the switch. That is harmless here:
   * `pendingException('delete')` is null, so nothing ever arrives marked in this mode
   * and a click on any tile is a mark rather than a take-back.
   */
  async function markForDeletion(page, n) {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    const ids = [];
    for (let i = 0; i < n; i++) {
      /* `freshTile` rather than `.first()`: a selector describing a *state* is
         re-resolved on every use, so one clicked once slides silently onto another. */
      const tile = await freshTile(page);
      ids.push(await tile.getAttribute('data-id'));
      await tile.click();
    }
    await expect(page.locator('.tile.marked')).toHaveCount(n);
    return ids;
  }

  test('R2/R3: it names the number and says the deletion is permanent', async ({ page }) => {
    await markForDeletion(page, 3);
    await page.locator('#commit').click();

    const box = page.locator('.confirm__box');
    await expect(box).toBeVisible();
    await expect(box.locator('.confirm__title')).toContainText('3 observations');
    await expect(box.locator('.confirm__warn')).toContainText('cannot be undone');
  });

  test('R5: focus starts on Cancel, and Escape cancels', async ({ page }) => {
    const ids = await markForDeletion(page, 2);
    await page.locator('#commit').click();
    await expect(page.locator('.confirm__box')).toBeVisible();

    /* Enter and Space are what somebody hits without reading, so neither may destroy
       anything: the focused control is Cancel. */
    await expect(page.locator('[data-confirm="cancel"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.confirm__box')).toHaveCount(0);

    /* Cancelled means nothing happened at all -- the marks are still there, so the
       page does not have to be redone. */
    await expect(page.locator('.tile.marked')).toHaveCount(2);
    for (const id of ids) {
      await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);
    }
    await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
  });

  test('R2: confirming deletes exactly the number it named', async ({ page }) => {
    /**
     * **The one check in this file that really destroys rows.**
     *
     * On the fixture that was free. Here `[data-confirm="go"]` reaches
     * `/mosaic/observations/delete` and four observations are gone permanently -- and
     * `journal.mjs` fails the run for any delete of a row the test did not create, which
     * is the guard working rather than an obstacle to route around.
     *
     * So it needs **four disposable seeded observations**, and then `ledger.allowDeletes`
     * naming their ids. `allowDeletes` is never called on a corpus row: saying a row may
     * be destroyed does not make it replaceable.
     */
    test.fixme(true, 'Needs four disposable seeded observations to destroy, plus '
      + 'ledger.allowDeletes on their ids. It deletes for real and nothing can undo it.');

    await markForDeletion(page, 4);
    await page.locator('#commit').click();
    await expect(page.locator('.confirm__title')).toContainText('4 observations');

    await page.locator('[data-confirm="go"]').click();
    await expect(page.locator('.confirm__box')).toHaveCount(0);
    await expect(page.locator('.tile.out-deleted')).toHaveCount(4);
  });

  test('A5: with nothing marked, there is nothing to confirm', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);

    /* #71 settled that confirming a deletion of zero records must never happen, because
       it teaches people to dismiss the dialog without reading it. #72 made that
       unreachable rather than merely handled: the button is disabled, so the click cannot
       be made at all. Asserting the stronger guarantee. */
    await expect(page.locator('#commit')).toBeDisabled();
    await expect(page.locator('.confirm__box')).toHaveCount(0);
    await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
  });

  test('R4: scientific review commits with no confirmation at all', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    /* A real page sweep, so the whole page is reviewed on the record. The `afterEach`
       restore is what puts every one of those rows back. */
    await page.locator('#commit').click();
    await expect(page.locator('#commit')).toContainText('Saved');
    await expect(page.locator('.confirm__box')).toHaveCount(0);
  });
});

/* ------------------------------------ the states never rendered (#72) */

test.describe('the states never rendered', () => {
  /** Empty the mosaic by asking for something that does not exist. */
  async function emptyIt(page) {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      /* An array: every set dimension has held one since #77. This was a bare string,
         which happened to produce an empty result for the wrong reason.
         And an id rather than a name, which is the part the move changed: the endpoint
         casts this dimension to `int[]`, so 'No Such Species' is a SQL error against a
         real server rather than an empty page. -1 is a species nothing can be on. */
      state.filters.species = [-1];
      await actions.refresh();
    });
  }

  test('R1: an empty result says so, and offers the way out', async ({ page }) => {
    await emptyIt(page);
    await expect(page.locator('#field')).toHaveAttribute('data-state', /empty|filtered-out/);
    await expect(page.locator('.pagestate--empty')).toBeVisible();
    await expect(page.locator('.pagestate--empty')).toContainText('Nothing to review here');
    await expect(page.locator('[data-act="clear-filters"]')).toBeVisible();
  });

  test('R1: clearing the filters brings the mosaic back', async ({ page }) => {
    await emptyIt(page);
    await page.locator('[data-act="clear-filters"]').click();
    await ready(page);
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.pagestate')).toHaveCount(0);
  });

  test('R3: a page with no imagery disables the commit and says why', async ({ page }) => {
    /**
     * `MarpData.breakThumbnails(state.rows.map(...))` broke **every row on the page**,
     * and that is the only arrangement in which the banner and the disabled commit
     * appear at all.
     *
     * The corpus holds fifteen genuinely failed rows scattered across it, and the mosaic
     * has no thumbnail-status filter -- the status is a field on the row rather than a
     * dimension you can ask by -- so a page made entirely of them cannot be asked for.
     * Seeding one is the answer; faking the endpoint's answer is not.
     */
    test.fixme(true, 'Needs a page where every row is in thumbnail state `failed` -- one '
      + "page's worth at the viewport's own page size. They need not be disposable: this "
      + 'check never commits. Then open on that page rather than on undecided().');

    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    await expect(page.locator('#commit')).toBeDisabled();
    await expect(page.locator('#commit')).toContainText('nothing to do');
    await expect(page.locator('.pagestate--banner')).toBeVisible();
  });

  test('R7: the banner offers to ask for the imagery again', async ({ page }) => {
    /**
     * The same whole page of `failed` rows as `R3`, and here they must also be
     * **disposable**: the click below reaches the retry endpoint, which really queues an
     * extraction against Jellyfin for every row on the page.
     */
    test.fixme(true, 'Needs a page where every row is in thumbnail state `failed`, and '
      + 'those rows must be disposable: this presses retry, which queues a real '
      + 'extraction and then waits for real pictures to arrive.');

    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    await page.locator('[data-act="retry-thumbnails"]').click();

    /**
     * **The retry asks; it does not deliver** (F10, R12, A9).
     *
     * The endpoint answers `queued` and never a synchronous `ready` — an accepted retry
     * has not happened yet, and extraction runs at three concurrent Jellyfin streams. So
     * the first thing the reviewer sees is a page of PREPARING tiles, and the commit stays
     * disabled because accepting a tile means somebody looked at it.
     *
     * This asserted `#commit` was enabled the moment the click returned, which was only
     * ever true because the fixture invented the picture on the spot.
     */
    await expect(page.locator('.tile.queued').first()).toBeVisible();
    await expect(page.locator('#commit')).toBeDisabled();

    /* And then the poll turns them into pictures: one request and one repaint per round,
       on a backoff, stopping when nothing is queued. That is what clears the banner. */
    await expect(page.locator('.pagestate--banner')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('#commit')).toBeEnabled({ timeout: 30000 });
  });

  test('R5: the button says how many will be skipped', async ({ page, request }) => {
    /**
     * `state.rows.slice(0, 3)` -- **three** broken rows on a page that still holds
     * pictures, so the button stays live and has something to say it will skip.
     *
     * The body below is the migration, written against the one genuinely failed row
     * `openOnBrokenPicture` can find: the check asserts that the note appears and what it
     * says, never the number three, so one broken row among fifty exercises the same
     * rule. It is fixme'd because it has not been run and because the seeded three are
     * what the original was about -- whoever seeds them should try it as written first.
     */
    test.fixme(true, 'Needs three rows in thumbnail state `failed` on a page that also '
      + 'holds rows with pictures. They need not be disposable: this check never commits. '
      + 'One genuinely failed row may already satisfy it -- see the comment above.');

    const { tile } = await openOnBrokenPicture(page, request);
    await expectRealBacking(page);
    await expect(tile).toHaveClass(/failed/);

    await expect(page.locator('#skipNote')).toBeVisible();
    await expect(page.locator('#skipNote')).toContainText('without imagery');
  });

  test('R9: the reason list can say nobody could see it', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();
    await expect(page.locator('.pick .chip', { hasText: 'No imagery' })).toBeVisible();
  });
});

/* ------------------------------------------- keyboard shortcuts (#74) */

test.describe('keyboard shortcuts', () => {
  test('R1: N pages forward and P comes back', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    /* Read by position deliberately: this identifies *which page* is on screen, and
       nothing here is clicked. The rule about never picking a tile by position is about
       acting on one. */
    const first = await page.locator('.tile').first().getAttribute('data-id');

    await page.keyboard.press('n');
    await ready(page);
    /* Retrying rather than a value read once: a page change is a real request here, and
       `ready` can return on a grid that has settled but not yet repainted. */
    await expect(page.locator('.tile').first()).not.toHaveAttribute('data-id', first);

    await page.keyboard.press('p');
    await ready(page);
    await expect(page.locator('.tile').first()).toHaveAttribute('data-id', first);
  });

  test('R2: C clears the marks on the page', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await expect(page.locator('.tile.marked')).toHaveCount(1);

    await page.keyboard.press('c');
    await expect(page.locator('.tile.marked')).toHaveCount(0);
  });

  test('R3: the number keys switch mode', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.keyboard.press('3');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'delete');
    await page.keyboard.press('2');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'training');
    await page.keyboard.press('1');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'scientific');
  });

  test('R4: Enter alone does not commit; Ctrl+Enter does', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    await page.keyboard.press('Enter');
    /* Long enough that a commit would have landed. The fixture answered from memory, so
       600 ms proved something there; against a real round trip it would pass by being
       early, which is the worst way round for an assertion about nothing happening. */
    await page.waitForTimeout(2000);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);

    /* The chord really commits the page, so the `afterEach` restore puts those rows
       back. */
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
  });

  /* The rule and the wiring can each be right while the pair is wrong: this proves
     mount.js actually tells resolveKey that an input has focus. */
  test('R5: typing in the species search does not page', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const before = await page.locator('.tile').first().getAttribute('data-id');

    /* The rail starts collapsed on a phone, so the species control is not reachable
       until it is opened. The shortcut rule is the same either way; getting to the
       input is what differs. It is left open on purpose: nothing below clicks a tile,
       and an attribute is readable through the overlay. */
    await openRail(page);
    await page.locator('[data-dim="species"]').click();
    await page.locator('.menu input').first().fill('no');
    await page.waitForTimeout(500);

    await expect(page.locator('.tile').first()).toHaveAttribute('data-id', before);
  });

  test('R6: the shortcuts are drawn on the controls they duplicate', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await expect(page.locator('#commit')).toHaveAttribute('data-key', 'Ctrl+Enter');
    await expect(page.locator('#clearMarks')).toHaveAttribute('data-key', 'C');
    await expect(page.locator('.seg button[data-mode="delete"]')).toHaveAttribute('data-key', '3');
  });

  test('R7: Ctrl+Enter on a page that cannot be committed says so', async ({ page }) => {
    /**
     * The same whole page of `failed` rows as `R3` in *the states never rendered*: the
     * chord has to land on a page the commit refuses, and a page refuses only when it
     * holds no imagery at all. One broken tile among fifty leaves the commit enabled,
     * which is a different check about a different rule.
     */
    test.fixme(true, 'Needs a page where every row is in thumbnail state `failed`, so the '
      + 'commit is disabled and the chord has something to be refused by. They need not '
      + 'be disposable: the whole point is that nothing is written.');

    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    await expect(page.locator('#commit')).toBeDisabled();

    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#commit')).toHaveClass(/nudge/);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
  });
});
