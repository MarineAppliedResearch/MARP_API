import { test, expect } from '@playwright/test';

/**
 * The shell: the rail, the top bar, and the router.
 *
 * These are the assertions that cover R2 and R7 in `.marp/task.md`, and they are
 * written at the tier that can actually observe what they claim. A store-level
 * check cannot see whether the rail is on screen; only a browser can. That
 * distinction has cost this platform three re-reported defects.
 */

const TABS = ['dashboard', 'jobs', 'inference', 'training', 'datasets', 'models', 'workers', 'history'];

const settled = async (page) => {
  await page.waitForSelector('#content > *', { state: 'attached' });
};

test.describe('the shell', () => {
  test('every destination in the rail renders something', async ({ page }) => {
    for (const id of TABS) {
      await page.goto('#/' + id);
      await settled(page);
      /* Not "the link was clicked" -- that a tab actually drew. A router that
         silently renders nothing looks identical to one that works, until you
         look. */
      const kids = await page.locator('#content > *').count();
      expect(kids, `${id} rendered nothing`).toBeGreaterThan(0);
    }
  });

  test('the rail marks exactly one destination current, and it is the open one', async ({ page }) => {
    await page.goto('#/models');
    await settled(page);
    const current = page.locator('.rail-nav a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('data-nav', 'models');
  });

  test('an unknown route falls back to the dashboard rather than an empty page', async ({ page }) => {
    await page.goto('#/no-such-tab');
    await settled(page);
    await expect(page.locator('.rail-nav a[aria-current="page"]')).toHaveAttribute('data-nav', 'dashboard');
  });

  test('the document title follows the tab', async ({ page }) => {
    await page.goto('#/workers');
    await settled(page);
    await expect(page).toHaveTitle(/MARP Machine Learning/);
    const withWorkers = await page.title();
    await page.goto('#/datasets');
    await settled(page);
    expect(await page.title()).not.toBe(withWorkers);
  });

  test('the back button returns to the previous tab', async ({ page }) => {
    await page.goto('#/dashboard');
    await settled(page);
    await page.goto('#/jobs');
    await settled(page);
    await page.goBack();
    await settled(page);
    await expect(page.locator('.rail-nav a[aria-current="page"]')).toHaveAttribute('data-nav', 'dashboard');
  });

  test('the two primary actions reach the two creation flows', async ({ page }) => {
    await page.goto('#/dashboard');
    await settled(page);
    await page.getByRole('button', { name: 'New Inference Job' }).click();
    await settled(page);
    await expect(page.locator('.rail-nav a[aria-current="page"]')).toHaveAttribute('data-nav', 'inference');

    await page.getByRole('button', { name: 'New Training Job' }).click();
    await settled(page);
    await expect(page.locator('.rail-nav a[aria-current="page"]')).toHaveAttribute('data-nav', 'training');
  });

  test('the marine ground is painted, so the page never shows the host background',
    async ({ page }) => {
      await page.goto('#/dashboard');
      await settled(page);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    });

  test('nothing is clipped at the right edge', async ({ page }) => {
    /* The same measurement tools/shots.mjs makes, kept here so it is part of a
       suite rather than only part of a screenshot run. `overflow-x: hidden`
       makes scrollWidth read clean while content is cut off, so this looks for
       the cut-off itself. */
    for (const id of TABS) {
      await page.goto('#/' + id);
      await settled(page);
      const over = await page.evaluate(() => {
        const w = window.innerWidth;
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          let fixed = false;
          for (let p = el; p && p !== document.body; p = p.parentElement) {
            if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
          }
          if (fixed) continue;
          if (r.right > w + 1) out.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
        }
        return out.slice(0, 4);
      });
      expect(over, `${id} has content past the right edge`).toEqual([]);
    }
  });
});

test.describe('the phone layout', () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 759, 'phone widths only');

  test('the rail is a sheet that opens and closes', async ({ page }) => {
    await page.goto('#/dashboard');
    await settled(page);

    /* Off-canvas, not absent: the rail is still in the document, parked. A test
       that asserted it was hidden would pass against a rail that had been
       deleted. */
    const rail = page.locator('.rail');
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Sections' }).click();
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().right))
      .toBeGreaterThan(100);

    /* Clicked away from the centre on purpose: the scrim covers the viewport and
       the sheet sits on top of its left half, so a centre click lands on the
       sheet at phone width. */
    await page.locator('.rail-scrim').click({ position: { x: 330, y: 400 } });
    await expect.poll(() => rail.evaluate((el) => el.getBoundingClientRect().right))
      .toBeLessThanOrEqual(1);
  });

  test('choosing a destination from the sheet navigates and closes it', async ({ page }) => {
    await page.goto('#/dashboard');
    await settled(page);
    await page.getByRole('button', { name: 'Sections' }).click();
    await page.locator('.rail-nav a[data-nav="workers"]').click();
    await settled(page);
    await expect(page.locator('.rail-nav a[aria-current="page"]')).toHaveAttribute('data-nav', 'workers');
    expect(await page.locator('.rail').evaluate((el) => el.getBoundingClientRect().right))
      .toBeLessThanOrEqual(1);
  });

  test('both primary actions keep their labels rather than becoming bare icons', async ({ page }) => {
    await page.goto('#/dashboard');
    await settled(page);
    await expect(page.getByRole('button', { name: 'New Inference Job' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Training Job' })).toBeVisible();
  });
});
