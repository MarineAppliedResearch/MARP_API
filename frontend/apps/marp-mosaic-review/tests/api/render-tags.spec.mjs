/**
 * The filter rail, the isolation between modes, and every workflow's tags -- against a
 * real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it, and
 * two of those changes are what most of the comments below are about.
 *
 * **The fixture guaranteed its own contents and a real corpus does not.** The ancestor
 * could say "236 excluded, 179 promoted, 214 reviewed out of 3000" and page forward until
 * it found one. Here the address asks the endpoint for exactly the rows the check is
 * about -- `?trainingDisposition=excluded` -- which is the same move `openOnBrokenPicture`
 * makes in `support.mjs`, and it is deterministic rather than hopeful. Paging survives as
 * the fallback for a page whose tiles have no picture yet.
 *
 * **A mode switch resets the status filters**, so narrowing one from the address only
 * works while the mode stays put: `setMode` runs `defaultStatusFor`, which puts every
 * status dimension back to what the new mode opens at. The two checks that are about
 * another mode's view of the record therefore open *in* that mode rather than switching
 * into it; the two that are about the switch itself still switch.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  expectRealBacking,
  freshTile,
  openRail,
  ready,
  undecided,
  watchErrors
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

test.describe('the filter rail', () => {
  test('toggling it changes how much room the mosaic has', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    /* The rail starts collapsed on a phone and open on a desktop, so assert the
       direction of the change rather than assuming which way it goes. */
    const collapsed = await page.evaluate(() =>
      document.body.classList.contains('rail-collapsed'));
    const before = await page.locator('.tile').count();
    await page.locator('#railbtn').click();
    await ready(page);
    const after = await page.locator('.tile').count();
    if (collapsed) expect(after).toBeLessThanOrEqual(before);
    else expect(after).toBeGreaterThan(before);
  });

  test('a filter menu opens, is searchable, and is not clipped by the rail',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      /* the filters are behind the rail, which is collapsed by default on a phone */
      await openRail(page);
      await expect(page.locator('[data-dim="species"]')).toBeVisible();
      await page.locator('[data-dim="species"]').click();

      const menu = page.locator('.menu');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);          // the rail used to clip it off-screen

      /* The ancestor typed `rock` and expected two entries -- Rockfish and Rock Crab --
         which was a fact about the fixture's seven species and is wrong about a real
         catalogue. So the needle is taken from an entry the menu is actually showing, and
         the assertion is what searching *does*: keep the entries whose label contains it,
         drop the rest, and end up with fewer than it started with. */
      const entries = await menu.locator('[data-v]').evaluateAll((nodes) => nodes.map(
        (node) => ({ value: node.dataset.v, label: node.textContent.replace(/\s+/g, ' ').trim() })
      ));
      const needle = needleFrom(entries);
      const expected = entries.filter((e) => e.label.toLowerCase().includes(needle));

      await menu.locator('.msearch').fill(needle);
      await expect(menu.locator('[data-v]')).toHaveCount(expected.length);
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThan(entries.length);   // it narrowed something
    });
});

test.describe('the modes do not wear each other\'s answers', () => {
  /* Still true after #85, and worth being precise about what it means now: an *outcome*
     never travels between modes, because it is what the last commit did here. What the
     record carries does travel, as a borrowed `.rtag` — see the #85 block below. `.badge`
     is this mode's own answer, and that is what this checks. */
  test('a scientific commit leaves no badge behind in training or delete', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
    await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' })).toHaveCount(0);

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
  });

  test('switching modes clears the marks along with the outcomes', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await expect(page.locator('.tile.marked')).toHaveCount(1);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await expect(page.locator('.tile.marked')).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- #85
   Every mode shows every workflow's tags. These are here rather than in the unit tier
   because they are claims about what is drawn on a tile, and every rendering defect in
   this app so far passed the store-level checks. */

/**
 * A tile on screen whose record carries `value` in `column`, paging forward if this page
 * holds none.
 *
 * The fixture guaranteed these rows existed — 236 excluded, 179 promoted, 214 reviewed out
 * of 3000 — and a real corpus guarantees nothing, so the *address* asks for them instead
 * and every caller below narrows to the rows its check is about. Paging survives for the
 * one thing an address cannot ask: the mosaic has no thumbnail-status filter, so a page
 * whose tiles have no picture yet is walked past rather than skipped. A skipped check
 * looks green.
 */
async function tileCarrying(page, column, value, pages = 6) {
  for (let i = 0; i < pages; i++) {
    /* With imagery, so the claims about the picture not being dimmed have a picture. */
    const id = await page.evaluate(([c, v]) => {
      const row = (window.MARP.state.rows || [])
        .find((r) => r[c] === v && r.thumbnail_status === 'ready');
      return row ? row.observation_id : null;
    }, [column, value]);
    /* Pinned by id, because a locator describing a state stops matching once it changes. */
    if (id !== null) return page.locator(`.tile[data-id="${id}"]`);
    const next = page.locator('[data-page="next"]');
    if (!(await next.count())) break;                 // one page of results, so nowhere to go
    await next.click();
    await ready(page);
  }
  throw new Error(
    `no observation with ${column}=${value} and a picture in the first ${pages} pages. `
    + 'The address this check opens on narrows to exactly those rows, so this means the '
    + 'corpus behind the testing database holds none of them — not that the tag is '
    + 'undrawn. It fails rather than skipping, because a skipped check looks green.'
  );
}

/** Page forward until the tile for one known observation is on screen. */
async function tileById(page, id, pages = 12) {
  for (let i = 0; i < pages; i++) {
    const tile = page.locator(`.tile[data-id="${id}"]`);
    if (await tile.count()) return tile;
    const next = page.locator('[data-page="next"]');
    if (!(await next.count())) break;
    await next.click();
    await ready(page);
  }
  throw new Error(
    `observation ${id} is not in the first ${pages} pages of this mode's question. `
    + 'The check narrows to one line before committing so that this walk is short; if it '
    + 'is still too far, that line holds more decided rows than it did.'
  );
}

test.describe('every workflow\'s tags are visible from every mode', () => {
  test('R1: a training exclusion is drawn while reviewing science', async ({ page }) => {
    const errors = watchErrors(page);
    /* Narrowed to the rows this is about. `trainingDisposition` is *borrowed* in
       Scientific, so the address is the only thing that sets it and nothing resets it. */
    await page.goto(undecided('trainingDisposition=excluded'));
    await expectRealBacking(page);
    await ready(page);

    const tile = await tileCarrying(page, 'training_decision', 'excluded');
    const tag = tile.locator('.rtag');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('EXCLUDED');
    /* R6: another workflow's opinion must not grey out the picture being judged. */
    await expect(tile).not.toHaveClass(/has-excluded/);
    await expect(tile.locator('img')).toHaveCSS('filter', 'none');
    expect(errors).toEqual([]);
  });

  test('R1: a training promotion is drawn while reviewing science', async ({ page }) => {
    await page.goto(undecided('trainingDisposition=promoted'));
    await expectRealBacking(page);
    await ready(page);
    const tile = await tileCarrying(page, 'training_decision', 'promoted');
    await expect(tile.locator('.rtag')).toContainText('PROMOTED');
    await expect(tile).not.toHaveClass(/has-promoted/);
  });

  test('R1: a scientific review is drawn while reviewing training data', async ({ page }) => {
    /* Opened *in* Training rather than switched into it, and that is not a shortcut:
       `setMode` runs `defaultStatusFor`, which would throw away exactly the narrowing that
       makes a reviewed row certain to be on the page. Training's own dimension is widened
       to all three values for the same reason — the check is about the scientific tag, and
       a reviewed row is no less reviewed for having been promoted. */
    await page.goto('./?mode=training&reviewStatus=reviewed'
      + '&trainingDisposition=undecided,promoted,excluded');
    await expectRealBacking(page);
    await ready(page);

    const tile = await tileCarrying(page, 'review_decision', 'reviewed');
    const tag = tile.locator('.rtag');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('REVIEWED');
    /* The borrowed tag says what happened, not who: the name is in the tooltip. */
    await expect(tag).toHaveAttribute('title', /Scientific data review: reviewed/);
  });

  test('R1: Delete Mode shows the training tags it used to hide', async ({ page }) => {
    const errors = watchErrors(page);
    /* In Delete from the address, for the same reason as the check above: Delete *owns*
       both status dimensions, so switching into it resets both to its own defaults. */
    await page.goto('./?mode=delete&trainingDisposition=excluded'
      + '&reviewStatus=unreviewed,flagged,reviewed');
    await expectRealBacking(page);
    await ready(page);

    /* Delete always read the scientific dimension — the training one is what was missing,
       and it is the sharpest case in #85: an observation already excluded from training
       looked untouched at the moment somebody was deciding whether to destroy it. */
    const tile = await tileCarrying(page, 'training_decision', 'excluded');
    await expect(tile.locator('.rtag')).toContainText('EXCLUDED');
    expect(errors).toEqual([]);
  });

  test('R1/R5: a committed flag reaches training as the record, not as an outcome',
    async ({ page }) => {
      /**
       * **Undecided in *both* dimensions, and the address is what guarantees it.**
       *
       * This asked for `undecided()` alone and said that a tile with no badge carries no
       * decision in any dimension. That is not true and it cost a run: a training decision
       * draws an `.rtag`, not a `.badge` (#85) -- they are deliberately different elements --
       * so `freshTile` will happily return a row that is already promoted. Training then
       * opens on its own default of `undecided` and filters that very row out, and the walk
       * at the end reports the tile missing.
       *
       * Narrowing the borrowed dimension in the address is the fix. A borrowed dimension
       * arrives not filtering at all, by design, so nothing else was going to do it.
       */
      await page.goto(undecided('trainingDisposition=undecided'));
      await expectRealBacking(page);
      await ready(page);

      const first = await freshTile(page);
      const line = await first.evaluate((el) => {
        const row = (window.MARP.state.rows || [])
          .find((r) => String(r.observation_id) === el.dataset.id);
        return row ? row.line : null;
      });
      expect(line, 'the served row carries a line, which is what narrows the page').toBeTruthy();

      /* Re-asked narrowed to that line, because the mode switch at the end has to find the
         row again by paging: Training opens on its own question and there is no address
         left to put the row on screen without reloading, which would discard the very
         outcomes R5 is about. Narrowing can only move a row *earlier* in the order, so the
         tile that was on page 1 of the wider question is still on page 1 of this one. */
      await page.goto(undecided(`trainingDisposition=undecided&line=${encodeURIComponent(line)}`));
      await ready(page);

      const tile = await freshTile(page);
      const id = await tile.getAttribute('data-id');
      await tile.click();
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
      await page.locator('#commit').click();

      /* Wait for the commit to *land*, not for the badge on our own tile: that already
         said FLAGGED as a mark, so waiting on it proves nothing and leaves the page
         mid-commit. `commitPage` is async and writes `state.outcomes` when it resolves,
         so switching mode first has the outcomes arrive after `setMode` cleared them --
         which paints this commit's answers across Training. That is a real race in
         `store.js`, found by this test on 2026-09-08 and not fixed here. */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      const moved = await tileById(page, id);

      await expect(moved.locator('.rtag')).toContainText('FLAGGED');
      /* R5: `setMode` cleared the outcomes, so the only thing that could have drawn this
         is the record read back. Training's own answer — the primary badge — is silent. */
      await expect(moved.locator('.badge')).toHaveCount(0);
    });

  test('R2/R3: a mark still outranks the record, and the tag does not swallow the click',
    async ({ page }) => {
      /* Unreviewed as well as excluded: a tile carrying a scientific decision arrives with
         its mark already seeded, so the click below would be a *take-back* rather than the
         mark this check is about. That is the one thing the fixture could not have shown. */
      await page.goto(undecided('trainingDisposition=excluded'));
      await expectRealBacking(page);
      await ready(page);
      const tile = await tileCarrying(page, 'training_decision', 'excluded');

      /* Clicking the tag itself, which is the click most likely to be swallowed. */
      await tile.locator('.rtag').click();
      await expect(tile).toHaveClass(/marked/);
      /* R2: the primary badge is this mode's mark. If a record tag could reach that slot,
         clicking a tile would appear to do nothing. */
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
      /* R1 still holds while marked: the exclusion is on the record either way. */
      await expect(tile.locator('.rtag')).toContainText('EXCLUDED');
    });

  test('R7: the tag stays inside the tile and clear of the caption', async ({ page }) => {
    await page.goto(undecided('trainingDisposition=excluded'));
    await expectRealBacking(page);
    await ready(page);
    const tile = await tileCarrying(page, 'training_decision', 'excluded');

    const tileBox = await tile.boundingBox();
    const tagBox = await tile.locator('.rtag').boundingBox();
    const capBox = await tile.locator('.cap').boundingBox();

    expect(tagBox.x).toBeGreaterThanOrEqual(tileBox.x - 1);
    expect(tagBox.x + tagBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width + 1);
    expect(tagBox.y).toBeGreaterThanOrEqual(tileBox.y - 1);
    /* Above the caption, not through it — the species name is what names the tile. */
    expect(tagBox.y + tagBox.height).toBeLessThanOrEqual(capBox.y + 1);
    /* And the image field stays mostly a quiet zone: the tag is in its bottom strip. */
    expect(tagBox.y).toBeGreaterThan(tileBox.y + tileBox.height / 2);

    /* The page must not scroll sideways because a tile grew a second label. */
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * A search term the species menu is actually showing, and that narrows it.
 *
 * Local to this file because it is the whole of what replaced one fixture literal:
 * `fill('rock')` expecting two entries. The needle has to come out of the menu rather than
 * out of somebody's database — a species name written here is true on one computer, which
 * is the mistake `support.mjs` was written to stop repeating.
 *
 * Four characters, lower case, so it also proves the search is a case-insensitive
 * substring rather than a prefix match on the label as drawn.
 *
 * @param {Array<Object>} entries - `{value, label}` for every `[data-v]` in the menu.
 * @returns {string} The needle to type.
 */
function needleFrom(entries) {
  /* The "All species" entry carries an empty value and is not a species, so it is not
     where a needle comes from -- but it does count as an entry the search must drop. */
  const options = entries.filter((e) => e.value !== '' && e.label.length >= 4);
  expect(options.length, 'the species menu offered nothing to search for, so the rail is '
    + 'drawing no facets at all').toBeGreaterThan(0);

  for (const option of options) {
    const needle = option.label.toLowerCase().slice(0, 4);
    const hits = entries.filter((e) => e.label.toLowerCase().includes(needle));
    if (hits.length > 0 && hits.length < entries.length) return needle;
  }

  throw new Error(
    'every entry in the species menu shares a four-character fragment with every other, '
    + 'so no search term can narrow it and this check cannot say anything about searching.'
  );
}
