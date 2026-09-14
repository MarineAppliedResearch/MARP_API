/** #176/#178: inspection stays outside the scientific commit workflow. */
import { test, expect } from '@playwright/test';
import { seedPage } from './seed.mjs';
import { expectRealBacking, ready } from './support.mjs';

test('#176/#178 details identify the observation and open its cached full frame',
  async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value) => { window.__copiedObservationId = value; } }
      });
    });
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
      await panel.getByRole('button', { name: 'Copy' }).click();
      await expect(panel.locator('[data-copy-status]')).toHaveText('Copied');
      await expect.poll(() => page.evaluate(() => window.__copiedObservationId)).toBe(String(id));
      await expect(panel.getByLabel('Full frame loaded')).toBeChecked();
      await panel.getByRole('button', { name: 'View full frame' }).click();

      const viewer = page.locator('.frame-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('img')).toBeVisible();
      await expect(viewer.locator('.frame-viewer__box')).toBeVisible();
      const label = viewer.locator('.frame-viewer__box-label');
      await expect(label).toContainText(`Observation ${id}`);
      const fittedLabelSize = await label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      await viewer.getByRole('button', { name: 'Zoom in' }).click();
      await expect(viewer.locator('output')).toHaveText('150%');
      await expect.poll(() => label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)))
        .toBeCloseTo(fittedLabelSize * 1.5, 4);
      await viewer.getByRole('button', { name: 'Zoom to box' }).click();
      await expect.poll(async () => Number((await viewer.locator('output').textContent()).replace('%', '')))
        .toBeGreaterThan(150);
      await viewer.getByRole('button', { name: 'Hide box' }).click();
      await expect(viewer.locator('.frame-viewer__box')).toHaveCount(0);
      await expect(viewer.locator('.frame-viewer__box-label')).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
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

test('#178 clipboard refusal selects the exact ID for manual copying', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: null });
  });
  const seeded = await seedPage({ count: 1, thumbnail: 'ready' });
  try {
    await page.goto(seeded.address);
    await ready(page);
    const id = seeded.ids[0];
    const tile = page.locator(`.tile[data-id="${id}"]`);
    await tile.click();
    await tile.locator('[data-badge]').click();
    const panel = page.locator('.pick');
    await panel.getByRole('button', { name: 'Copy' }).click();
    await expect(panel.locator('[data-copy-status]')).toContainText('selected for manual copying');
    await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe(String(id));
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
