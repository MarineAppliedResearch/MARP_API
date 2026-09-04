/**
 * Render-layer tests.
 *
 * These exist because the unit and contract tiers structurally cannot see the DOM.
 * Three defects so far lived here and every store-level check passed while they were
 * live: a stale identifier crashed rendering, a committed page drew no badge, and a
 * layout feedback loop kept re-querying the grid. Each is covered below.
 */
import { test, expect } from '@playwright/test';

/** Wait for the first page of tiles, and for the grid to stop changing size. */
async function ready(page) {
  await expect(page.locator('.tile').first()).toBeVisible();
  await expect(page.locator('.tile.skeleton')).toHaveCount(0);
  let last = -1;
  for (let i = 0; i < 12; i++) {                  // settle, then confirm it stays settled
    const n = await page.locator('.tile').count();
    if (n === last && n > 0) return;
    last = n;
    await page.waitForTimeout(250);
  }
}

/** Collect console errors and page errors for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test.describe('the mosaic renders and stays settled', () => {
  test('loads a page of tiles with names, and no errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await ready(page);

    expect(await page.locator('.tile').count()).toBeGreaterThan(8);
    /* every tile carries its species name, including ones with no image */
    const captions = await page.locator('.tile .cap').allTextContents();
    expect(captions.length).toBe(await page.locator('.tile').count());
    expect(captions.every((c) => c.trim().length > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the grid settles: no further queries once a page has loaded', async ({ page }) => {
    await page.goto('./');
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

  test('an unavailable thumbnail still shows its species and stays markable', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const noImage = page.locator('.tile.failed').first();
    if (await noImage.count() === 0) test.skip(true, 'no unavailable thumbnail on this page');
    await expect(noImage.locator('.cap')).not.toBeEmpty();
    await noImage.click();
    await expect(noImage).toHaveClass(/marked/);
  });
});

test.describe('marking and the flag panel', () => {
  test('a tap marks the tile and draws its badge', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');
  });

  test('the badge opens the panel, and clicking away closes it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    await page.locator('#field').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.pick')).toHaveCount(0);
  });

  test('the panel stays inside the mosaic even on the bottom row', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').last();
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
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    /* Dispatched rather than clicked: on a phone the panel physically covers the
       grid, and the regression is in the grid's own handler, not in hit-testing. */
    await page.locator('.tile:not(.failed):not(.queued)').nth(4).dispatchEvent('click');
    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/marked/);
    await expect(page.locator('.tile.marked')).toHaveCount(1);
  });

  test('Escape closes the panel and leaves the mark alone', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/marked/);
  });

  test('choosing a reason shows it on the tile', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
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
      await page.goto('./');
      await ready(page);

      const flagged = page.locator('.tile:not(.failed):not(.queued)').first();
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
      await page.goto('./');
      await ready(page);

      await page.locator('.seg button', { hasText: label }).click();
      await ready(page);

      expect(await page.locator('.tile').count()).toBeGreaterThan(0);
      const statusLabel = await page.locator('#statusLbl').textContent();
      expect(statusLabel).toBe(mode === 'training' ? 'Training disposition' : 'Review status');

      /* A mark must survive giving it a reason and closing the panel — in every mode. */
      if (mode === 'training') {
        const tile = page.locator('.tile:not(.failed):not(.queued)').first();
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

test.describe('the filter rail', () => {
  test('toggling it changes how much room the mosaic has', async ({ page }) => {
    await page.goto('./');
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
      await page.goto('./');
      await ready(page);
      /* the filters are behind the rail, which is collapsed by default on a phone */
      if (await page.evaluate(() => document.body.classList.contains('rail-collapsed'))) {
        await page.locator('#railbtn').click();
        await expect(page.locator('#selSpeciesBtn')).toBeVisible();
      }
      await page.locator('#selSpeciesBtn').click();

      const menu = page.locator('.menu');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);          // the rail used to clip it off-screen

      await menu.locator('.msearch').fill('rock');
      await expect(menu.locator('[data-v]')).toHaveCount(2);   // Rockfish, Rock Crab
    });
});
