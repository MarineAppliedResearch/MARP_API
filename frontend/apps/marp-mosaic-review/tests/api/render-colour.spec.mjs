/**
 * What a decision wears: the badges, the buttons, the pager and the dimming.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture -- the four
 * colour describes, check for check. Every assertion here is the one its ancestor made;
 * what changed is the thing underneath it.
 *
 * **Colour is read by polling for a value that parses, everywhere in this file.**
 * Rendering is a full re-render from state, so a handle taken the instant an element
 * appears can be detached before `getComputedStyle` runs -- and a detached node answers
 * with an empty string, so `''.match(/\d+/g)` is null and the check dies with "Cannot
 * read properties of null" without saying anything about colour. That trap is worse here
 * than on the fixture, because a commit against a real server takes a round trip rather
 * than a microtask.
 *
 * **Delete is the exception in this file, and it is deliberate.** Two of these checks
 * commit in Delete Mode, and a delete against the real endpoint is permanent -- nothing
 * can put an observation back, which is why `journal.mjs` refuses one outright. So the
 * delete route is answered rather than served, with exactly what the endpoint would have
 * said, derived from the request the client actually built: the whole client path runs --
 * the confirm dialog, the busy state, the outcomes, the committed page -- and no row is
 * destroyed. What these checks assert is a hue, and a hue is not a fact about whether a
 * row went away. `deleteWithoutDestroying` at the bottom is the whole of it.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  closeRail,
  expectRealBacking,
  freshTile,
  openRail,
  ready,
  undecided
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

test.describe('taking a decision back reads as heading towards accepted', () => {
  test('the TAKING BACK badge is green, not amber', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    /* `undecided()` rather than the default question, and `freshTile` rather than
       `.first()`: on a real corpus the default page arrives with its flags already
       marked, so a click on the first tile is frequently a take-back already -- and this
       check has to make the one it is about. */
    const tile = await freshTile(page);
    await tile.click();
    await page.locator('#commit').click();
    /* Wait for the commit to land: clicking before it does lets marksAfterCommit
       overwrite the toggle, and the tile comes back marked. */
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    await tile.click();

    const badge = tile.locator('.badge');
    await expect(badge).toContainText('TAKING BACK');
    /* Polled, not read once. Rendering is a full re-render from state, so a handle taken
       the moment a badge appears can be detached before it is read, and `getComputedStyle`
       on a detached node returns an empty string — which failed as "Cannot read properties
       of null" rather than saying anything about colour. `commitAndReadBadge` below already
       does this; this test never got the same treatment, and it was one of the flakes
       making full runs noisy. */
    let colour = '';
    await expect.poll(async () => {
      colour = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
        .catch(() => '');
      return /^rgba?\(/.test(colour) ? 'read' : `not a colour yet: ${JSON.stringify(colour)}`;
    }, { message: 'never got a colour off the TAKING BACK badge' }).toBe('read');
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    expect(g, `green channel should dominate, got ${colour}`).toBeGreaterThan(r + 40);
    expect(g, `and it should not be the amber it used to be, got ${colour}`).toBeGreaterThan(b);
    /* Distinct from the settled greens, which are the acid --green ramp. */
    expect(b, `a cooler green than --green-400, got ${colour}`).toBeGreaterThan(80);
  });
});

test.describe('the two workflows do not wear the same colour', () => {
  /** Commit the current page and return the rgb of the first outcome badge. */
  async function commitAndReadBadge(page, label) {
    await page.locator('#commit').click();
    const badge = page.locator('.tile .badge', { hasText: label }).first();
    await expect(badge).toBeVisible();

    /* Poll rather than read once. Rendering here is a full re-render from state, and the
       commit is async -- so a handle taken the instant the badge appears can be detached
       by the next render before it is read, and `getComputedStyle` on a detached node
       returns an empty string. `''.match(/\d+/g)` is null, and the test died with
       "Cannot read properties of null" instead of saying anything about colour. */
    let rgb = null;
    await expect.poll(async () => {
      rgb = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
        .catch(() => '');
      return /^rgba?\(/.test(rgb) ? 'read' : `not a colour yet: ${JSON.stringify(rgb)}`;
    }, { message: `never got a colour off the ${label} badge` }).toBe('read');

    return rgb.match(/\d+/g).map(Number);
  }

  test('REVIEWED is green and PROMOTED is violet, and they are far apart', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const [rr, rg, rb] = await commitAndReadBadge(page, 'REVIEWED');
    expect(rg, `REVIEWED should be green, got rgb(${rr},${rg},${rb})`).toBeGreaterThan(rr);
    expect(rg, 'and not blue').toBeGreaterThan(rb);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    const [pr, pg, pb] = await commitAndReadBadge(page, 'PROMOTED');
    /* Violet: blue leads, and red is well ahead of green. */
    expect(pb, `PROMOTED should be violet, got rgb(${pr},${pg},${pb})`).toBeGreaterThan(pg);
    expect(pr, 'and reddish rather than cyan').toBeGreaterThan(pg);

    /* The point of the change: these must not be confusable at a glance. */
    const distance = Math.hypot(rr - pr, rg - pg, rb - pb);
    expect(distance, `too close: rgb(${rr},${rg},${rb}) vs rgb(${pr},${pg},${pb})`)
      .toBeGreaterThan(120);
  });

  test('the commit button follows the mode that owns the decision', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    /**
     * **The filled button, which since #126 is the main one.**
     *
     * This read `#commit`, and that button is now the *secondary* of a pair: it wears the
     * same mode hue as an outline rather than a fill, so its background is transparent and
     * reading it returned `rgba(0,0,0,0)` in every mode. The rule being asserted has not
     * changed -- what a commit does is coloured by the mode that owns the decision -- so
     * the assertion follows the button that carries the fill rather than being loosened to
     * accept a transparent one. Delete has one button and it is `#commit`.
     */
    const read = (id) => page.locator(id)
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    const sci = (await read('#commitMarked')).match(/\d+/g).map(Number);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    const tra = (await read('#commitMarked')).match(/\d+/g).map(Number);

    expect(sci[1], 'the scientific commit is green').toBeGreaterThan(sci[2]);
    expect(tra[2], 'the training commit is violet').toBeGreaterThan(tra[1]);

    /* #93: Delete Marked is red. It always was — `body[data-mode="delete"] .commit`
       outranked the accept family — but nothing asserted it, so the family could be
       renamed out from under it without a test noticing. */
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    const del = (await read('#commit')).match(/\d+/g).map(Number);
    expect(del[0], `Delete Marked is red, got rgb(${del.join(',')})`).toBeGreaterThan(del[1] + 40);
    expect(del[0], 'and not violet').toBeGreaterThan(del[2]);

    /* And the secondary wears the same hue as an outline, so the pair reads as one
       mode's commit rather than as two unrelated controls. */
    await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
    await ready(page);
    const edge = (await page.locator('#commit')
      .evaluate((el) => getComputedStyle(el).borderTopColor)).match(/\d+/g).map(Number);
    expect(edge[1], 'the sweep is outlined in the same green').toBeGreaterThan(edge[2]);
  });
});

/* ---------------------------------- what a commit did to this page (#93) */

test.describe('a committed page wears the hue of the commit that did it', () => {
  /**
   * A computed colour, polled until it parses.
   *
   * Same trap as `commitAndReadBadge` above: rendering is a full re-render, so a handle
   * taken the instant an element appears can be detached before `getComputedStyle` runs,
   * and a detached node returns an empty string. `''.match(/\d+/g)` is null, and the test
   * then dies saying nothing about colour.
   */
  async function readColour(locator, prop) {
    let value = '';
    await expect.poll(async () => {
      value = await locator.evaluate((el, p) => getComputedStyle(el)[p], prop).catch(() => '');
      return /rgba?\(/.test(value) ? 'read' : `not a colour yet: ${JSON.stringify(value)}`;
    }, { message: `never got ${prop} off the element` }).toBe('read');
    /* The last colour in the value: the progress bar is a gradient running from cyan to
       the mode's own hue, and it is the far end that carries the meaning. */
    const colours = value.match(/rgba?\([^)]*\)/g);
    return colours[colours.length - 1].match(/[\d.]+/g).map(Number);
  }

  /** Commit the current page, whichever mode is active, and wait for it to land. */
  async function commitPage(page, mode) {
    if (mode === 'delete') {
      for (let i = 0; i < 2; i++) {
        /* `markableTile` rather than `.first()`, for the locator trap: a selector that
           describes a state slides onto another tile the moment the state changes. It is
           deliberately not `freshTile` -- see that helper's note at the bottom. */
        const tile = await markableTile(page);
        await tile.click();
      }
      await expect(page.locator('.tile.marked')).toHaveCount(2);
      await page.locator('#commit').click();
      await page.locator('[data-confirm="go"]').click();
      await expect(page.locator('.tile.out-deleted')).toHaveCount(2);
    } else {
      await page.locator('#commit').click();
      await expect(page.locator('.tile .badge',
        { hasText: mode === 'training' ? 'PROMOTED' : 'REVIEWED' }).first()).toBeVisible();
    }
    /* The page you are standing on is a text input, not a chip, so the committed chip
       only exists once you have moved off it — which is also when a reviewer sees it. */
    await page.locator('[data-page="next"]').click();
    await ready(page);
    await expect(page.locator('.pg.done').first()).toBeAttached();
  }

  /** Into `mode`, commit a page, and report the chip's and the swatch's colours. */
  async function committedIn(page, mode) {
    if (mode !== 'scientific') {
      await page.locator('.seg button', { hasText: mode === 'training' ? 'Training Data Review' : 'Delete' })
        .click();
      await ready(page);
    }
    await commitPage(page, mode);
    return {
      chip: await readColour(page.locator('.pg.done').first(), 'color'),
      swatch: await readColour(page.locator('.swatch'), 'backgroundColor')
    };
  }

  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  test('R1/R2/R5: Delete is red, and nowhere near the green or the violet',
    async ({ page }) => {
      /* Nothing is destroyed: the delete route is answered rather than served. The file
         header says why -- an observation cannot be put back, and this is about a hue. */
      await deleteWithoutDestroying(page);
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      /* One load, three modes: each mode parks its own committed pages, so the pager
         starts empty again on arrival rather than showing the previous mode's work. */
      const sci = await committedIn(page, 'scientific');
      const tra = await committedIn(page, 'training');
      const del = await committedIn(page, 'delete');

      /* The reported defect: this chip was the root green, in the mode whose commit had
         just destroyed those observations permanently. */
      expect(del.chip[0], `the chip should be red, got rgb(${del.chip.join(',')})`)
        .toBeGreaterThan(del.chip[1] + 40);
      expect(del.chip[0], 'and not violet').toBeGreaterThan(del.chip[2]);

      /* Unchanged, and asserted here so a shared variable cannot move them quietly. */
      expect(sci.chip[1], `scientific stays green, got rgb(${sci.chip.join(',')})`)
        .toBeGreaterThan(sci.chip[0]);
      expect(tra.chip[2], `training stays violet, got rgb(${tra.chip.join(',')})`)
        .toBeGreaterThan(tra.chip[1]);
      expect(tra.chip[0], 'and reddish rather than cyan').toBeGreaterThan(tra.chip[1]);

      /* Different is not enough: a person glancing at the pager has to be able to tell
         which of the three they are looking at. */
      expect(far(del.chip, sci.chip),
        `too close to green: rgb(${del.chip.join(',')}) vs rgb(${sci.chip.join(',')})`)
        .toBeGreaterThan(120);
      expect(far(del.chip, tra.chip),
        `too close to violet: rgb(${del.chip.join(',')}) vs rgb(${tra.chip.join(',')})`)
        .toBeGreaterThan(120);

      /* R2: the swatch is the legend for that chip, so it cannot disagree with it. */
      expect(del.swatch[0], `the swatch should be red, got rgb(${del.swatch.join(',')})`)
        .toBeGreaterThan(del.swatch[1] + 40);
      expect(sci.swatch[1], 'the swatch stays green in scientific').toBeGreaterThan(sci.swatch[0]);
      expect(tra.swatch[2], 'and violet in training').toBeGreaterThan(tra.swatch[1]);
    });

  test('R3: the progress bar fills with the hue of the mode filling it', async ({ page }, info) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);
    const bar = page.locator('#progBar');
    const sci = await readColour(bar, 'backgroundImage');
    expect(sci[1], `scientific progress is green, got rgb(${sci.join(',')})`)
      .toBeGreaterThan(sci[0]);

    /* The rail overlays the mosaic on a phone, so put it away before touching a tile. */
    await closeRail(page, info);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);
    const del = await readColour(bar, 'backgroundImage');
    expect(del[0], `deleting does not fill a bar with green, got rgb(${del.join(',')})`)
      .toBeGreaterThan(del[1] + 40);
  });

  test('R4: the commit button says the delete succeeded without saying it was accepted',
    async ({ page }, info) => {
      /* Again nothing is destroyed. What is asserted is the tick's hue, which is a
         question about the stylesheet rather than about the record. */
      await deleteWithoutDestroying(page);
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await page.locator('.seg button', { hasText: 'Delete' }).click();
      await ready(page);
      /* The mode selector is in the top chrome, but a rail left open on a phone still
         covers the tile this is about to click. */
      await closeRail(page, info);

      const tile = await markableTile(page);
      await tile.click();
      const commit = page.locator('#commit');
      await commit.click();
      await page.locator('[data-confirm="go"]').click();

      await expect(commit).toHaveClass(/ok/);
      const ok = await readColour(commit, 'backgroundColor');
      expect(ok[0], `the tick state should be red, got rgb(${ok.join(',')})`)
        .toBeGreaterThan(ok[1] + 40);
    });
});

test.describe('a judged tile steps back', () => {
  test('flagging dims the image, as excluding already did', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    const img = tile.locator('img');

    const before = await img.evaluate((el) => getComputedStyle(el).filter);
    await tile.click();
    const after = await img.evaluate((el) => getComputedStyle(el).filter);

    expect(before).toBe('none');
    expect(after, 'a flagged tile should be dimmed').toContain('brightness');
    /* Lighter than an exclusion: flagged work stays in view to be resolved. */
    const b = Number(after.match(/brightness\(([\d.]+)\)/)[1]);
    expect(b).toBeGreaterThan(0.55);
    expect(b).toBeLessThan(1);
  });
});

/* ---------------------------------- the two helpers this file owns (#157) */

/** The route a Delete Mode commit goes to. */
const DELETE_ROUTE = '**/api/v2/mosaic/observations/delete';

/**
 * Let a Delete Mode commit run its whole client path without destroying anything.
 *
 * **A delete is the one write this tier cannot undo.** `journal.mjs` puts a decision back
 * by writing the record again, and there is no equivalent for a row that no longer
 * exists -- which is why it refuses a delete outright rather than pretending. The two
 * checks here that commit in Delete Mode are about the *hue* of what a commit leaves
 * behind: the pager chip, the legend swatch, the button's tick. Neither asks whether a
 * row went away.
 *
 * So the request is answered instead of served, with the body the endpoint builds for it
 * -- `reviewed` carrying each marked id with outcome `deleted`, which is what
 * `repository/mosaic-commit.repository.js` returns and what `model/page.js:applyCommit`
 * folds. It is **derived from the request the client actually sent** rather than typed
 * out, so a change in what the client marks cannot leave this answering about other ids.
 *
 * Everything either side of the wire is real: the confirm dialog, the busy state, the
 * outcomes, the pinned committed page, the counts query that follows.
 *
 * The ids go to `allowDeletes` because the journal watches the **request**, not the
 * server -- nothing reached the endpoint, so there is nothing to put back, and without
 * this it would report a destruction that did not happen.
 *
 * @param {import('@playwright/test').Page} page - The page about to commit.
 * @returns {Promise<void>} Resolves once the route is installed.
 */
async function deleteWithoutDestroying(page) {
  await page.route(DELETE_ROUTE, async (route) => {
    let body = null;
    try { body = route.request().postDataJSON(); } catch { body = null; }

    /* In Delete Mode a mark *is* the selection, so the marked ids are the ones the
       endpoint would have destroyed; every other row on the page is untouched. */
    const marked = ((body && body.marks) || []).map((mark) => Number(mark.observation_id));
    ledger.allowDeletes(marked);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        atomicity: 'per-observation',
        reviewed: marked.map((observation_id) => ({ observation_id, outcome: 'deleted' })),
        flagged: [],
        reverted: [],
        skipped: [],
        conflicted: [],
        committedAt: new Date().toISOString()
      })
    });
  });
}

/**
 * A tile that can be marked, pinned by its id.
 *
 * `freshTile` is the right helper almost everywhere and this is deliberately not it: it
 * insists on a tile carrying no badge, because on a real corpus a click on a decided tile
 * is a *take-back* rather than a mark. **Delete Mode has neither half of that problem** --
 * `pendingException('delete')` is null so nothing arrives marked, there is no take-back to
 * fall into, and Delete owns both status dimensions, so entering it re-ticks every review
 * status and the page can legitimately arrive with a badge on every tile. Insisting on an
 * unbadged one there would fail for a reason that is not the defect.
 *
 * What it keeps from `freshTile` is the half that matters: the id is read first and the
 * tile pinned by it, so a selector describing a state cannot slide onto a different tile
 * between the read and the click.
 *
 * @param {import('@playwright/test').Page} page - A settled page.
 * @param {Object} [options] - `at` is the index among the markable tiles.
 * @returns {Promise<import('@playwright/test').Locator>} The tile, pinned by `data-id`.
 */
async function markableTile(page, { at = 0 } = {}) {
  const ids = await page.locator('.tile:not(.marked):not(.failed)')
    .evaluateAll((tiles) => tiles.map((tile) => tile.dataset.id));

  expect(ids[at], `this page holds ${ids.length} unmarked tile(s) with a picture and the `
    + `check wanted number ${at}. There is nothing here to mark.`).toBeTruthy();

  return page.locator(`.tile[data-id="${ids[at]}"]`);
}
