/**
 * The two commit buttons, taking a promotion back, the pages-done tally, where
 * progress lives, and a destroyed tile -- against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it, and
 * the three consequences of that change live in `support.mjs` rather than being repeated
 * per file: the page size follows the viewport, a bare address is not `filters: {}`, and
 * a tile is never chosen by position.
 *
 * **Two things in this file are not a straight copy, and both are the endpoint being
 * real rather than a fixture.**
 *
 * - *"While it saves"* was observable on the fixture because the fixture had a built-in
 *   140 ms latency. A localhost round trip does not, so an assertion about the in-flight
 *   state would poll once and find the commit already finished. `holdCommitOpen` at the
 *   bottom of this file holds the **real** request open after it has landed -- the
 *   `slowNextCommit` replacement `affordances.spec.mjs` already uses -- so what is
 *   observed during the delay is the application genuinely waiting for a server.
 * - **A delete is permanent here.** `a tile whose row has been destroyed` gets its doomed
 *   tile by deleting two observations, which on the fixture was an in-memory edit and here
 *   destroys corpus rows this test did not create. `journal.mjs` refuses exactly that, and
 *   rightly -- so those five checks build the four observations they destroy two of,
 *   with `seedPage`, and name them with `allowDeletes`. A row a test may destroy is a row
 *   it made; `allowDeletes` is never called on a corpus row, because saying one may be
 *   destroyed does not make it replaceable.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import {
  expectRealBacking,
  freshTile,
  isPhone,
  ready,
  undecided
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

/**
 * Seeded pages a check made, taken away after it whatever happened.
 *
 * The five destroyed-tile checks each build their own four observations to destroy two
 * of, so the removal is a `finally` that would be written five times. `after(seeded)`
 * registers it once instead, and the hook below is the only place that knows the order:
 * **forget, restore, remove**. The journal re-reads every row it wrote to, and a row
 * `remove()` has already deleted cannot be read back -- so the seeded ids come off its
 * books first.
 */
let planted = [];
const after = (seeded) => planted.push(seeded);

test.beforeEach(({ page, request }) => { ledger = journal(page, request); planted = []; });
test.afterEach(async ({ request }) => {
  for (const seeded of planted) ledger.forget(seeded.ids);
  await ledger.restore(request);
  for (const seeded of planted) await seeded.remove();
});

test.describe('each commit button reports only on itself', () => {
  /* #131. `state.commit` was one `{ busy, status }` serving two controls, so committing
     only the marked tiles also turned the page sweep green with a tick -- the one
     interaction #126 exists to keep apart, saying the whole page had been accepted. The
     store was correct throughout, which is why no store-level check could see this. */

  test('committing the marked tiles leaves the sweep untouched', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    const sweep = page.locator('#commit');
    const main = page.locator('#commitMarked');
    const sweepLabel = (await sweep.innerText()).split('·')[0].trim();

    await tile.click({ button: 'right' });

    /* Held open only after the page has loaded, so every read that got us here was real
       and only the commit waits. The write itself has already landed. */
    await holdCommitOpen(page);
    await main.click();

    /* While it saves, the idle button keeps its own default -- not spun, not blanked,
       not disabled (A4). "Saving..." on a button that is saving nothing is the same lie
       as "Saved", one step earlier. */
    await expect(main).toContainText('Saving');
    await expect(sweep.locator('.spin')).toHaveCount(0);
    await expect(sweep).toContainText(sweepLabel);
    await expect(sweep).toBeEnabled();

    await expect(main).toContainText('Saved');
    await expect(main).toHaveClass(/ok/);
    /* The fill is what made this read as "the whole page was accepted": `.commit.sweep.ok`
       turns the outlined secondary button solid green, indistinguishable from the primary.
       Classes alone would pass if the fill came back through another selector. */
    await expect(sweep).not.toHaveClass(/ok/);
    await expect(sweep).not.toContainText('Saved');
    await expect(sweep).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await page.unroute(COMMIT_ROUTE);
  });

  test('sweeping the page leaves the marked button untouched', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const sweep = page.locator('#commit');
    const main = page.locator('#commitMarked');
    const mainLabel = (await main.innerText()).split('·')[0].trim();

    /* This one sweeps a whole page of real observations. The journal recorded every row
       the application was served, so all of them go back in `afterEach`. */
    await holdCommitOpen(page);
    await sweep.click();

    await expect(sweep).toContainText('Saving');
    await expect(main.locator('.spin')).toHaveCount(0);
    await expect(main).toContainText(mainLabel);

    await expect(sweep).toContainText('Saved');
    await expect(sweep).toHaveClass(/ok/);
    await expect(main).not.toHaveClass(/ok/);
    await expect(main).not.toContainText('Saved');

    await page.unroute(COMMIT_ROUTE);
  });

  test('a committed accept mark stops claiming it is uncommitted', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    const badge = tile.locator('.badge');

    await tile.click({ button: 'right' });
    await expect(badge).toHaveAttribute('title', /Not committed yet/);

    await page.locator('#commitMarked').click();
    await expect(page.locator('#commitMarked')).toContainText('Saved');

    /* The mark survives its own commit by design (#126) and a mark outranks an outcome --
       both load-bearing, neither changed here. So the tile keeps the mark badge, and the
       badge has to stop saying something that is no longer true. */
    await expect(badge).toHaveAttribute('title', /^Recorded as reviewed/);
    await expect(badge).toHaveAttribute('title', /click to flag it instead/);
    await expect(badge).toHaveText(/REVIEWED/);
  });
});

test.describe('taking a promotion back (#135)', () => {
  /**
   * The three steps of the report, drawn rather than derived.
   *
   * The store was right about step 1 the whole time and the tile was what the reviewer
   * read, so this is the tier that can see what was actually wrong -- a badge. Steps 2 and
   * 3 were never built: un-marking a committed promotion left the tile still reading
   * PROMOTED, so the click looked as though it had done nothing, and the main button had
   * nothing to commit because a take-back is not a mark.
   */
  async function promotableTile(page) {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    /* Pinned by id, because a locator describing a *state* slides onto another tile the
       moment the state changes. `freshTile` is the real-corpus half of that: a tile
       already carrying a training decision takes it *back* when clicked, so choosing by
       position would test the opposite gesture. */
    return freshTile(page);
  }

  test('step 1: promoting and committing leaves the tile reading PROMOTED', async ({ page }) => {
    const tile = await promotableTile(page);
    const badge = tile.locator('.badge');

    await tile.click({ button: 'right' });
    await page.locator('#commitMarked').click();
    await expect(page.locator('#commitMarked')).toContainText('Saved');

    await expect(badge).toContainText('PROMOTED');
    await expect(badge).not.toContainText('TAKING BACK');
    await expect(badge).not.toContainText('TAKEN BACK');
    await expect(tile).not.toHaveClass(/out-reverted/);
  });

  test('step 2: clicking it again says the promotion is being taken back', async ({ page }) => {
    const tile = await promotableTile(page);
    const badge = tile.locator('.badge');

    await tile.click({ button: 'right' });
    await page.locator('#commitMarked').click();
    await expect(page.locator('#commitMarked')).toContainText('Saved');

    await tile.click({ button: 'right' });                 // take it back
    await expect(badge).toContainText('TAKING BACK');
    await expect(tile).toHaveClass(/out-reverted/);
    /* Which decision, so a reviewer cannot read it as taking back an exclusion. */
    await expect(badge).toHaveAttribute('title', /Taking back promoted/);
    /* And the button is enabled and says it will act, or step 3 is unreachable. */
    await expect(page.locator('#commitMarked')).toBeEnabled();
    await expect(page.locator('#commitMarked')).toHaveAttribute('title', /takes back 1/);
  });

  test('step 3: committing the take-back clears the label and the decision',
    async ({ page }) => {
      const tile = await promotableTile(page);
      const id = await tile.getAttribute('data-id');

      await tile.click({ button: 'right' });
      await page.locator('#commitMarked').click();
      await expect(page.locator('#commitMarked')).toContainText('Saved');

      await tile.click({ button: 'right' });
      await expect(tile.locator('.badge')).toContainText('TAKING BACK');

      await page.locator('#commitMarked').click();
      await expect(page.locator('#commitMarked')).toContainText('Saved');

      /* Nothing is claimed about it any more: no badge at all, which is what "undecided"
         looks like. Not a MOVED badge either -- the second commit of a tile is not a
         conflict, because a commit does not move the observation's version (R6). */
      await expect(tile.locator('.badge')).toHaveCount(0);
      await expect(tile).not.toHaveClass(/out-reverted/);
      await expect(page.locator('.tile .badge', { hasText: 'MOVED' })).toHaveCount(0);

      /* And in the data behind the page, read from the store rather than off the screen.
         `src/store.js` is the application, not the retired fixture -- and on a real server
         the row's own column is the one the endpoint never writes back after a commit in
         this sitting (#131), which is why the outcome is asserted beside it. */
      const decision = await page.evaluate(async (target) => {
        const { state } = await import('./src/store.js');
        const row = state.rows.find((r) => String(r.observation_id) === String(target));
        return { decision: row.training_decision, outcome: state.outcomes.get(row.observation_id) };
      }, id);
      expect(decision.outcome).toBe('withdrawn');
      expect(decision.decision).toBe(null);
    });
});

test.describe('how many pages are done', () => {
  test('the count rises with each committed page, beside the swatch', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const done = page.locator('#pagesDone');
    await expect(done).toContainText('0 of');

    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    await expect(done).toContainText('1 of');

    await page.locator('[data-page="next"]').click();
    await ready(page);
    await page.locator('#commit').click();
    await expect(done).toContainText('2 of');

    /* It counts pages, not visits: going back to one already committed adds nothing. */
    await page.locator('[data-page="prev"]').click();
    await ready(page);
    await expect(done).toContainText('2 of');
  });

  test('it resets when the question changes', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('#commit').click();
    await expect(page.locator('#pagesDone')).toContainText('1 of');

    /* A different mode is a different set of decisions, so the tally starts again. */
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await expect(page.locator('#pagesDone')).toContainText('0 of');
  });

  test('it survives on a phone, where the trailing words do not', async ({ page }, info) => {
    test.skip(!isPhone(info), 'about the phone layout');
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await expect(page.locator('#pagesDone')).toBeVisible();
    await expect(page.locator('#pagesDone .lw')).toBeHidden();
    /* The footer must still not wrap, which is what hid the legend in the first place. */
    const bar = await page.locator('.foot').boundingBox();
    expect(bar.height).toBeLessThan(80);

    /* And it must fit across, which nothing asserted until #126.
       `.app` clips rather than scrolls, so a footer wider than the viewport is not a
       scrollbar -- it is a control silently cut off the right-hand edge, and the commit
       button is the rightmost thing there. It was **already overflowing before #126**, at
       524px of content in a 412px viewport with only one button; two buttons made it
       obvious rather than causing it. Measured on the row that holds them, because `.foot`
       itself is the clipping box and cannot report its own overflow. */
    const fits = await page.evaluate(() => {
      const foot = document.querySelector('.foot');
      const kids = [...foot.children];
      const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
      const left = Math.min(...kids.map((k) => k.getBoundingClientRect().left));
      return { content: Math.ceil(right - left), available: foot.clientWidth };
    });
    expect(fits.content,
      `the footer needs ${fits.content}px in ${fits.available}px; the commit button is what gets cut`)
      .toBeLessThanOrEqual(fits.available);
  });
});

/* ------------------------------------------- where progress lives (#91) */

test.describe('progress is not in the rail', () => {
  /* The header row, said precisely. A second status dimension draws its heading as
     `.lbl sub` inside the rail, so a bare `.sub` locator resolves two elements and
     every strict-mode call on it throws -- and since #89 that heading is in every
     mode, not just Delete. */
  const HEADER = '.app > .sub';

  test('it rides the sub bar, on the sort control\'s row', async ({ page }, info) => {
    test.skip(isPhone(info), 'the phone drops progress; see the phone test below');
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    /* The rail collapses, resets and scrolls, and progress belongs to the whole review
       rather than to the filters — so none of those three may be able to take it off
       screen. Since #89 gave every mode six status boxes the rail scrolls in all of
       them, which is what made this the wrong home rather than an unlucky one.
       The ancestry is the assertion: a coordinate check would still pass with the bar
       back inside the rail on a tall enough window. */
    await expect(page.locator(HEADER + ' .prog')).toBeVisible();
    await expect(page.locator('.rail .prog')).toHaveCount(0);

    /* Same row as the sort, and in front of it. The sort is still the end of the row. */
    const prog = await page.locator(HEADER + ' .prog').boundingBox();
    const sort = await page.locator('#sortBtn').boundingBox();
    expect(Math.abs((prog.y + prog.height / 2) - (sort.y + sort.height / 2)),
      'progress and the sort share a row').toBeLessThan(2);
    expect(prog.x + prog.width, 'the sort stays at the end').toBeLessThanOrEqual(sort.x + 1);

    /* `.sub` is a fixed-height band, so a second line is clipped rather than shown:
       three stacked divs moved into it wholesale would have been invisible. */
    const sub = await page.locator(HEADER).boundingBox();
    expect(sub.height).toBeLessThan(40);
  });

  test('the updater still reaches all three ids', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await expect(page.locator('#progPct')).toHaveText('0%');

    /* Progress is `round(committedPages * pageSize / total * 100)`, so on a corpus large
       enough that one page is under half a percent it stays at 0% however correct the
       updater is. Said out loud rather than left to read as the defect this check is
       about: the answer is a narrower question, not a looser assertion. */
    const scale = await page.evaluate(async () => {
      const { state } = await import('./src/store.js');
      return { total: state.total, pageSize: state.pageSize };
    });
    expect(Math.round((scale.pageSize / scale.total) * 100),
      `one page of ${scale.pageSize} in ${scale.total} matching rows rounds to 0%, so `
      + 'committing a page cannot move the percentage. Narrow the question this check '
      + 'opens on rather than loosening what it asserts.').toBeGreaterThan(0);

    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    /* The move kept `progPct`, `progBar` and `progText` precisely so the `subscribe`
       block in index.html did not have to change. This is what proves it did not. */
    await expect(page.locator('#progPct')).not.toHaveText('0%');
    await expect(page.locator('#progText')).toContainText(' of ');
    expect(await page.locator('#progBar').evaluate((el) => el.style.width)).not.toBe('0%');
  });

  test('a phone drops progress rather than pushing the sort off the row',
    async ({ page }, info) => {
      test.skip(!isPhone(info), 'about the phone layout');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      /* The first version of this asserted the opposite -- bar and percentage kept, only
         the wording dropped -- and it cost M3, which requires the whole sort control to
         sit inside the viewport. This row scrolls sideways here, so anything progress
         spends on width is not a smaller sort but a sort past the end of the row. Between
         the two, progress is the item this row can do without. */
      await expect(page.locator(HEADER + ' .prog')).toBeHidden();

      const sort = await page.locator('#sortBtn').boundingBox();
      const width = await page.evaluate(() => window.innerWidth);
      expect(sort.x, 'the sort starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect(sort.x + sort.width, 'and ends inside it, unscrolled')
        .toBeLessThanOrEqual(width + 1);

      /* Desktop still has it, so this is a width concession and not a removal. */
      await page.setViewportSize({ width: 1600, height: 900 });
      await ready(page);
      await expect(page.locator(HEADER + ' .prog')).toBeVisible();
      await expect(page.locator('#progPct')).toBeVisible();
    });
});

/* ------------------------------ a committed delete is not interactive (#138) */

test.describe('a tile whose row has been destroyed', () => {
  /**
   * Delete two tiles in Delete Mode and hand back the first one's id.
   *
   * The tile is pinned by the same id throughout: a locator describing a *state* -- and
   * `.tile:not(.marked)` is one -- slides onto a different tile the moment the state
   * changes, which is how three tests here were wrong before they were right.
   *
   * **What it destroys, it made** (#157). On the fixture a delete was an in-memory edit;
   * here it is permanent, and `journal.mjs` refuses a delete of any row the test did not
   * create -- `allowDeletes` says *these are mine*, and is never called on a corpus row.
   * So the page is four seeded observations in a session of their own: two are destroyed
   * and two remain, which is what these checks need to be able to say that everything
   * *else* on the page still works.
   *
   * @param {import('@playwright/test').Page} page - The page to drive.
   * @returns {Promise<Object>} `{id, seeded}` -- the doomed tile, and what to remove.
   */
  async function destroyTwo(page) {
    const seeded = await seedPage({ count: 4, thumbnail: 'ready' });
    ledger.allowDeletes(seeded.ids);

    await page.goto(seeded.address);
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);

    /* Both tiles are chosen before either is clicked: marking one gives it a badge, so
       asking for the next undecided tile afterwards would step past a row rather than
       return the one beside it. */
    const doomed = [await freshTile(page), await freshTile(page, { at: 1 })];
    const ids = [];
    for (const tile of doomed) {
      ids.push(await tile.getAttribute('data-id'));
      await tile.click();
    }
    await page.locator('#commit').click();
    await page.locator('[data-confirm="go"]').click();
    await expect(page.locator('.tile.out-deleted')).toHaveCount(2);
    return { id: ids[0], seeded };
  }

  test('R2/R8 (#138): clicking it does nothing, and it says it is not a target',
    async ({ page }) => {
      const { id, seeded } = await destroyTwo(page);
      after(seeded);
      const tile = page.locator(`.tile[data-id="${id}"]`);

      /* The reported defect, at the tier that can see it: the store was correct about
         everything else on this page, and the click still marked a row that no longer
         existed. */
      /* `force`, and it is the point rather than a workaround: Playwright reads
         `aria-disabled` as *not enabled* and would wait the tile out, which would prove
         the attribute and not the behaviour. The browser dispatches the click regardless
         -- `aria-disabled` is advisory -- so this is the dead click a reviewer makes, and
         the store is what refuses it. */
      await tile.click({ force: true });
      await expect(tile).not.toHaveClass(/marked/);
      await expect(tile).toHaveClass(/out-deleted/);
      await expect(tile.locator('.badge')).toHaveText(/DELETED/);
      /* Exactly one badge, still: a mark badge appearing beside DELETED is what the
         click used to draw. */
      await expect(tile.locator('.badge')).toHaveCount(1);
      await expect(tile).toHaveAttribute('aria-disabled', 'true');
    });

  test('R6 (#138): the tooltip says why nothing happens', async ({ page }) => {
    const { id, seeded } = await destroyTwo(page);
    after(seeded);
    /* DELETED states the fact. The reviewer's actual question is why their clicks do
       nothing, and that is what the title answers. */
    await expect(page.locator(`.tile[data-id="${id}"]`))
      .toHaveAttribute('title', /removed from the database/i);
  });

  test('R3/R4 (#138): neither the accept gesture nor the badge reaches it',
    async ({ page }) => {
      const { id, seeded } = await destroyTwo(page);
      after(seeded);
      const tile = page.locator(`.tile[data-id="${id}"]`);

      await tile.click({ button: 'right', force: true });     // see the note above
      await expect(tile).not.toHaveClass(/marked|accept/);
      await expect(tile.locator('.refusal')).toHaveCount(0);

      /* The badge is not a target either: `outcomeBadge` gives the deleted case no
         `data-badge`, and the store refuses the panel by both routes anyway. */
      await tile.locator('.badge').click({ force: true });
      await expect(page.locator('.pick')).toHaveCount(0);
      await expect(tile).not.toHaveClass(/marked/);
    });

  test('R7 (#138): it stays on screen with its picture', async ({ page }) => {
    const { id, seeded } = await destroyTwo(page);
    after(seeded);
    /* Still there to be looked at -- the cascade takes database rows, not the JPEG --
       which is the point of leaving it up for the rest of the sitting. It goes on the
       next query, which is existing behaviour and correct. */
    await expect(page.locator(`.tile[data-id="${id}"]`).locator('img')).toHaveCount(1);
  });

  test('R5 (#138): "flag all on page" steps over it', async ({ page }, info) => {
    /* Desktop only, and not for convenience: `.markall` is `display: none` under the
       phone media query, so the page-level mark is not a gesture that exists there. */
    test.skip(isPhone(info), 'the page-level mark is hidden on a phone');
    const { id, seeded } = await destroyTwo(page);
    after(seeded);
    const tile = page.locator(`.tile[data-id="${id}"]`);

    await page.locator('#markAll').click();
    await expect(page.locator('.tile.marked').first()).toBeVisible();
    await expect(tile).not.toHaveClass(/marked/);
    await expect(page.locator('.tile.out-deleted')).toHaveCount(2);
  });
});

/* ------------------------------------------------------------------ local helpers */

/** The route a scientific page commit goes to. What `holdCommitOpen` intercepts. */
const COMMIT_ROUTE = '**/api/v2/mosaic/observations/review';

/**
 * Hold the real commit open long enough for its in-flight state to be read.
 *
 * **Defined here rather than in `support.mjs`**, which other agents are editing in
 * parallel (#157). It is the `slowNextCommit` replacement `affordances.spec.mjs` already
 * uses, and the two checks about what the *idle* button does while the other one saves
 * cannot be written without it: the fixture had a built-in 140 ms latency to observe, and
 * a localhost round trip has none, so `expect(button).toContainText('Saving')` polls once
 * and finds the commit already finished.
 *
 * `route.fetch()` first, so the write lands for real and the journal has something to put
 * back; the delay is on the *answer*, which is the half the button is waiting for.
 *
 * @param {import('@playwright/test').Page} page - The page whose commit to hold.
 * @param {number} [ms] - How long to hold the answer back.
 * @returns {Promise<void>} Resolves once the route is installed.
 */
async function holdCommitOpen(page, ms = 1500) {
  await page.route(COMMIT_ROUTE, async (route) => {
    const response = await route.fetch();
    await new Promise((settle) => setTimeout(settle, ms));
    await route.fulfill({ response });
  });
}
