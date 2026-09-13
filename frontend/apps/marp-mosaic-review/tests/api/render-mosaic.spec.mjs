/**
 * The mosaic, the marks, the flag panel and a page commit -- against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it, and
 * three consequences of that change are in `support.mjs` rather than repeated per file:
 * the page size follows the viewport, a bare address is not `filters: {}`, and a tile is
 * never chosen by position.
 *
 * **Two of those were defects the fixture could not have shown.** The default question
 * shows flagged rows beside unreviewed ones and a page arrives with its exceptions
 * already marked, so on a real corpus the first tile is frequently one carrying a
 * decision -- where a click is a *take-back* rather than a mark. `undecided()` is the
 * answer: the default question minus the rows that arrive already decided, which is the
 * page these checks were always written against.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  expectRealBacking,
  freshTile,
  openOnBrokenPicture,
  ready,
  undecided,
  watchErrors
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

test.describe('the mosaic renders and stays settled', () => {
  test('loads a page of tiles with names, and no errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    expect(await page.locator('.tile').count()).toBeGreaterThan(8);
    /* every tile carries its species name, including ones with no image */
    const captions = await page.locator('.tile .cap').allTextContents();
    expect(captions.length).toBe(await page.locator('.tile').count());
    expect(captions.every((c) => c.trim().length > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the grid settles: no further queries once a page has loaded', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    /* The layout loop re-queried forever, which is what made marks appear to vanish. */
    const count = () => page.evaluate(() =>
      window.__queries ?? (window.__queries = 0));
    await page.evaluate(() => {
      window.__queries = 0;
      window.addEventListener('marp:action', (e) => {
        if (e.detail.name === 'query') window.__queries++;
      });
    });
    await page.waitForTimeout(2500);
    expect(await count()).toBe(0);
  });

  test('an unavailable thumbnail still shows its species and stays markable', async ({ page, request }) => {
    /* `MarpData.breakThumbnails([id])`, replaced. The corpus has rows whose picture
       genuinely failed, so this is data setup rather than a simulation -- and the address
       narrows to the row rather than the row being hoped for on the page in front of us. */
    const { tile: noImage } = await openOnBrokenPicture(page, request);
    await expectRealBacking(page);

    await expect(noImage).toHaveClass(/failed/);
    await expect(noImage.locator('.cap')).not.toBeEmpty();
    await noImage.click();
    await expect(noImage).toHaveClass(/marked/);
  });
});

test.describe('marking and the flag panel', () => {
  test('a tap marks the tile and draws its badge', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');
  });

  test('the badge opens the panel, and clicking away closes it', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    await page.locator('#field').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.pick')).toHaveCount(0);
  });

  test('the panel stays inside the mosaic even on the bottom row', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page, { at: 'last' });
    await tile.click();
    await tile.locator('[data-badge]').click();

    const panel = page.locator('.pick');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const field = await page.locator('#field').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(field.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(field.y + field.height + 1);
  });

  test('dismissing the panel does not also unmark the tile', async ({ page }) => {
    /* Clicking away used to close the panel AND toggle the tile under the cursor,
       which silently undid the very mark the panel belonged to. */
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    const other = await freshTile(page, { at: 4 });
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    /* Dispatched rather than clicked: on a phone the panel physically covers the
       grid, and the regression is in the grid's own handler, not in hit-testing. */
    await other.dispatchEvent('click');
    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/marked/);
    await expect(page.locator('.tile.marked')).toHaveCount(1);
  });

  test('Escape closes the panel and leaves the mark alone', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/marked/);
  });

  test('choosing a reason shows it on the tile', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick .chip', { hasText: 'Bounding box' }).click();
    await expect(tile.locator('.reason-chip')).toContainText('Bounding box');
  });
});

test.describe('committing a page', () => {
  test('draws the outcome on every tile, and it survives leaving and returning',
    async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const flagged = await freshTile(page);
      await flagged.click();
      await page.locator('#commit').click();

      /* the committed page must show what was submitted: greens as well as ambers */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
      await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
      const reviewedBefore = await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count();
      expect(reviewedBefore).toBeGreaterThan(1);

      await page.locator('[data-page="next"]').click();
      await ready(page);
      await page.locator('[data-page="prev"]').click();
      await ready(page);

      await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
      expect(await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count())
        .toBe(reviewedBefore);
      expect(errors).toEqual([]);
    });
});

test.describe('every mode renders', () => {
  for (const [mode, label] of [['training', 'Training Data Review'], ['delete', 'Delete']]) {
    test(`${mode} mode loads tiles and its own status filter`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      await page.locator('.seg button', { hasText: label }).click();
      await ready(page);

      expect(await page.locator('.tile').count()).toBeGreaterThan(0);
      const statusLabel = await page.locator('#statusLbl').textContent();
      expect(statusLabel).toBe(mode === 'training' ? 'Training disposition' : 'Review status');

      /* A mark must survive giving it a reason and closing the panel — in every mode. */
      if (mode === 'training') {
        const tile = await freshTile(page);
        await tile.click();
        await tile.locator('[data-badge]').click();
        await page.locator('.pick .chip', { hasText: 'Occluded' }).click();
        await page.keyboard.press('Escape');
        await expect(tile).toHaveClass(/marked/);
        await expect(tile.locator('.badge')).toContainText('EXCLUDED');
        await expect(tile.locator('.reason-chip')).toHaveText('Occluded');
        await expect(page.locator('#footCount')).toContainText('1');
      }
      expect(errors).toEqual([]);
    });
  }
});

