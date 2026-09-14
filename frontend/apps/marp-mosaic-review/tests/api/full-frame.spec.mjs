/** #176/#178: inspection stays outside the scientific commit workflow. */
import { test, expect } from '@playwright/test';
import { seedPage } from './seed.mjs';
import { expectRealBacking, ready } from './support.mjs';

test('#176/#178 details identify the observation and open its cached full frame',
  async ({ page }) => {
    const seeded = await seedPage({ count: 1, thumbnail: 'ready', fullFrame: true });
    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);
      const id = seeded.ids[0];
      const tile = page.locator(`.tile[data-id="${id}"]`);

      await tile.click();
      await tile.locator('[data-badge]').click();
      const panel = page.locator('.pick');
      await expect(panel.locator('[data-observation-id]')).toHaveText(String(id));
      await expect(panel.locator('.observation-identity')).toBeVisible();
      await expect(panel.locator('[data-act="copy-observation-id"]')).toHaveCount(0);
      await expect(panel).not.toContainText('removes this observation from accepted scientific results');
      await expect(panel).not.toContainText('a deliberate decision, not the absence of one');
      await expect(panel.getByLabel('Full frame loaded')).toBeChecked();
      await panel.getByRole('button', { name: 'View full frame' }).click();

      const viewer = page.locator('.frame-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('img')).toBeVisible();
      const box = viewer.locator('.frame-viewer__box');
      const speciesLabel = viewer.locator('.frame-viewer__box-label--species');
      const observationLabel = viewer.locator('.frame-viewer__box-label--observation');
      await expect(box).toBeVisible();
      await expect(speciesLabel).not.toBeEmpty();
      await expect(observationLabel).toHaveText(String(id));
      await expect.poll(async () => {
        const [boxWidth, labelWidth] = await Promise.all([
          box.evaluate((node) => node.getBoundingClientRect().width),
          speciesLabel.evaluate((node) => node.getBoundingClientRect().width)
        ]);
        return Math.abs(boxWidth - labelWidth);
      }).toBeLessThan(1);
      const fittedLabelWidth = await speciesLabel.evaluate((node) => node.getBoundingClientRect().width);
      await viewer.getByRole('button', { name: 'Zoom in' }).click();
      await expect(viewer.locator('output')).toHaveText('150%');
      await expect.poll(() => speciesLabel.evaluate((node) => node.getBoundingClientRect().width))
        .toBeCloseTo(fittedLabelWidth * 1.5, 0);
      await viewer.getByRole('button', { name: 'Zoom to box' }).click();
      await expect.poll(async () => Number((await viewer.locator('output').textContent()).replace('%', '')))
        .toBeGreaterThan(150);
      await viewer.getByRole('button', { name: 'Hide box' }).click();
      await expect(viewer.locator('.frame-viewer__box')).toHaveCount(0);
      await expect(viewer.locator('.frame-viewer__box-label')).toHaveCount(0);

      const mosaicAddress = page.url();
      await page.goBack();
      await expect(viewer).toHaveCount(0);
      await expect(page).toHaveURL(mosaicAddress);
      await expect(panel).toBeVisible();
      await expect(tile).toHaveClass(/marked/);
    } finally {
      await seeded.remove();
    }
  });

test('#176 full-frame keyboard focus is trapped and the frame can be panned', async ({ page }) => {
  const seeded = await seedPage({ count: 1, thumbnail: 'ready', fullFrame: true });
  try {
    await page.goto(seeded.address);
    await ready(page);
    const tile = page.locator(`.tile[data-id="${seeded.ids[0]}"]`);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.getByRole('button', { name: 'View full frame' }).click();
    const viewer = page.locator('.frame-viewer');

    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    const viewport = viewer.locator('.frame-viewer__viewport');
    await viewport.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

    await page.keyboard.press('Tab');
    await expect(viewer.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Shift+Tab');
    await expect(viewport).toBeFocused();
  } finally {
    await seeded.remove();
  }
});

test('#176 requesting a full frame is asynchronous and leaves the loaded state false', async ({ page }) => {
  const seeded = await seedPage({ count: 1, thumbnail: 'ready' });
  try {
    await page.goto(seeded.address);
    await ready(page);
    const id = seeded.ids[0];
    const tile = page.locator(`.tile[data-id="${id}"]`);
    await tile.click();
    await tile.locator('[data-badge]').click();
    const panel = page.locator('.pick');
    const accepted = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && response.url().endsWith(`/api/v2/observations/${id}/full-frame`));

    await panel.getByRole('button', { name: 'Request full frame' }).click();
    const response = await accepted;
    expect(response.status()).toBe(200);
    expect((await response.json()).fullFrame).toMatchObject({
      observation_id: id, status: 'queued', available: false
    });
    await expect(panel.getByLabel('Full frame loaded')).not.toBeChecked();
  } finally {
    await seeded.remove();
  }
});
