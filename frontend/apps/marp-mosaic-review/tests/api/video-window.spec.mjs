/** #181: the source video opens in its own window, and that window is reused. */
import { test, expect } from '@playwright/test';
import { seedPage } from './seed.mjs';
import { expectRealBacking, ready } from './support.mjs';

/* Open one tile's details and press its Open video button. */
async function openVideo(page, id) {
  const tile = page.locator(`.tile[data-id="${id}"]`);
  await tile.click();
  await tile.locator('[data-badge]').click();
  await page.locator('.pick').getByRole('button', { name: 'Open video' }).click();
}

test('#181 Open video shows the observation in its own window, and reuses that window',
  async ({ page, context }) => {
    const seeded = await seedPage({ count: 2, thumbnail: 'ready' });
    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);
      const [first, second] = seeded.ids;

      const opened = context.waitForEvent('page');
      await openVideo(page, first);
      const inspector = await opened;
      await inspector.waitForLoadState();

      // Its own page, answered by the real video-context read.
      await expect(inspector).toHaveURL(/\/inspect\.html/);
      await expect(inspector.locator('#inspectTitle')).toContainText(String(first));
      // The seeded rows have no real video, and the page says so rather than guessing.
      await expect(inspector.locator('#inspectStatus')).not.toBeEmpty();

      // The Mosaic is where it was.
      await expect(page.locator(`.tile[data-id="${first}"]`)).toBeVisible();

      // A second observation is sent to the same window, not a new one. The first
      // panel closes first: a click that dismisses a panel deliberately does nothing else.
      await page.keyboard.press('Escape');
      await expect(page.locator('.pick')).toHaveCount(0);
      const pagesBefore = context.pages().length;
      await openVideo(page, second);
      await expect(inspector.locator('#inspectTitle')).toContainText(String(second));
      expect(context.pages()).toHaveLength(pagesBefore);
    } finally {
      await seeded.remove();
    }
  });
