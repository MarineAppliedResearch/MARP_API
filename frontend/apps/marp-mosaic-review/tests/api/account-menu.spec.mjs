/**
 * Issue #166: the Mosaic account control must remain reachable and its menu must paint
 * above the application at every phone orientation. This belongs in the API tier because
 * the real route supplies the session whose identity the menu displays.
 */
import { test, expect } from '@playwright/test';

import { expectRealBacking, ready, watchErrors } from './support.mjs';

const VIEWPORTS = {
  desktop: { width: 1600, height: 900 },
  'phone portrait': { width: 412, height: 915 },
  'phone landscape': { width: 915, height: 412 }
};

/** Whether the visible face of the menu belongs to the menu rather than a covering panel. */
const menuGeometry = (page) => page.locator('[data-account-menu]').evaluate((menu) => {
  const box = menu.getBoundingClientRect();
  const points = [
    [box.left + 4, box.top + 4],
    [box.right - 4, box.top + 4],
    [box.left + 4, box.bottom - 4],
    [box.right - 4, box.bottom - 4]
  ];
  return {
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    uncovered: points.every(([x, y]) => menu.contains(document.elementFromPoint(x, y)))
  };
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`MARP_API#166 R3/R5: Mosaic account menu works at ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);

    const button = page.locator('[data-account-button]');
    await expect(button).toBeVisible();
    const buttonBox = await button.boundingBox();
    expect(buttonBox, 'the account button has no rendered box').not.toBeNull();
    expect(buttonBox.y, 'the account button is not at the top of the visible interface')
      .toBeLessThan(80);

    await button.click();
    const menu = page.locator('[data-account-menu]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-account-who]')).toContainText('Signed in as ');
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Open the dashboard',
      'Sign out'
    ]);
    await expect(menu.locator('[data-account-signin]')).toBeHidden();

    const drawn = await menuGeometry(page);
    expect(drawn.box.left).toBeGreaterThanOrEqual(0);
    expect(drawn.box.top).toBeGreaterThanOrEqual(0);
    expect(drawn.box.right).toBeLessThanOrEqual(viewport.width);
    expect(drawn.box.bottom).toBeLessThanOrEqual(viewport.height);
    expect(drawn.uncovered, 'application content covers part of the account menu').toBe(true);
    expect(errors).toEqual([]);
  });
}

test('MARP_API#166 R3: the Mosaic dashboard item reaches the main dashboard', async ({ page }) => {
  await page.goto('./');
  await expectRealBacking(page);
  await ready(page);
  await page.locator('[data-account-button]').click();
  await page.getByRole('menuitem', { name: 'Open the dashboard' }).click();
  await expect(page).toHaveURL(/\/apps\/dashboard\/index\.html$/);
});
