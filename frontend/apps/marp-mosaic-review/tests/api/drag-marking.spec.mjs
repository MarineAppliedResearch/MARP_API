/** #136: one mouse rectangle stages many tiles; touch remains the scrolling/tap surface. */
import { test, expect } from '@playwright/test';

import { seedPage } from './seed.mjs';
import { expectRealBacking, isPhone, ready } from './support.mjs';

async function drag(page, from, to, button = 'left') {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down({ button });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 6 });
  await page.mouse.up({ button });
}

test('#136 rectangle marking is batched, direct, and mouse-only', async ({ page }, info) => {
  const seeded = await seedPage({ count: 4, thumbnail: 'ready' });
  try {
    await page.goto(seeded.address);
    await expectRealBacking(page);
    await ready(page);

    const tiles = seeded.ids.map((id) => page.locator(`.tile[data-id="${id}"]`));

    if (isPhone(info)) {
      const first = await tiles[0].boundingBox();
      const second = await tiles[1].boundingBox();
      await tiles[0].dispatchEvent('pointerdown', {
        pointerId: 41, pointerType: 'touch', isPrimary: true,
        button: 0, buttons: 1, clientX: first.x + first.width / 2, clientY: first.y + first.height / 2
      });
      await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true,
        button: 0, buttons: 1, clientX: x, clientY: y
      })), { x: second.x + second.width / 2, y: second.y + second.height / 2 });
      await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 41, pointerType: 'touch', isPrimary: true,
        button: 0, buttons: 0, clientX: x, clientY: y
      })), { x: second.x + second.width / 2, y: second.y + second.height / 2 });

      await expect(page.locator('.drag-select-band')).toHaveCount(0);
      await expect(page.locator('.tile.marked')).toHaveCount(0);
      await tiles[0].tap();
      await expect(tiles[0]).toHaveClass(/marked/);
      await expect(tiles[1]).not.toHaveClass(/marked/);
      return;
    }

    /* Crossing the threshold shows both layers of feedback; Escape removes them and
       applies nothing even though the mouse button is still down. */
    const firstBox = await tiles[0].boundingBox();
    const secondBox = await tiles[1].boundingBox();
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2,
      secondBox.y + secondBox.height / 2, { steps: 4 });
    await expect(page.locator('.drag-select-band')).toBeVisible();
    await expect(page.locator('.tile.drag-preview')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.drag-select-band')).toHaveCount(0);
    await expect(page.locator('.tile.drag-preview')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.tile.marked')).toHaveCount(0);

    /* Sub-threshold gestures are still the exact established single-tile gestures. */
    await tiles[3].click();
    await expect(tiles[3].locator('.badge')).toContainText('FLAGGED');
    await tiles[3].click();
    await expect(tiles[3]).not.toHaveClass(/marked/);
    await tiles[3].click({ button: 'right' });
    await expect(tiles[3]).toHaveClass(/accept/);
    await tiles[3].click({ button: 'right' });
    await expect(tiles[3]).not.toHaveClass(/marked/);

    /* Put a committed acceptance underneath the first tile. A left drag must replace it
       directly, never stage the individual-click-only TAKING BACK state. */
    await tiles[0].click({ button: 'right' });
    await page.locator('#commitMarked').click();
    await expect(tiles[0].locator('.badge')).toContainText('REVIEWED');

    await page.evaluate(() => {
      window.__dragActions = 0;
      window.__dragNotifies = 0;
      window.addEventListener('marp:action', (event) => {
        if (event.detail.name === 'dragMark') window.__dragActions += 1;
      });
      window.MARP.subscribeForDragTest = import('./src/store.js')
        .then(({ subscribe }) => subscribe(() => { window.__dragNotifies += 1; }));
    });
    await page.evaluate(() => window.MARP.subscribeForDragTest);

    await drag(page, tiles[0], tiles[1]);
    await expect(tiles[0].locator('.badge')).toContainText('FLAGGED');
    await expect(tiles[0].locator('.badge')).not.toContainText('TAKING BACK');
    await expect(tiles[1].locator('.badge')).toContainText('FLAGGED');
    await expect(tiles[2]).not.toHaveClass(/marked/);
    expect(await page.evaluate(() => ({
      actions: window.__dragActions, notifies: window.__dragNotifies
    }))).toEqual({ actions: 1, notifies: 1 });

    /* A right drag sets acceptance. Repeating it is idempotent rather than toggling the
       marks off, and each release remains one action and one render. */
    await drag(page, tiles[1], tiles[2], 'right');
    await expect(tiles[1]).toHaveClass(/accept/);
    await expect(tiles[2]).toHaveClass(/accept/);
    await drag(page, tiles[1], tiles[2], 'right');
    await expect(tiles[1]).toHaveClass(/accept/);
    await expect(tiles[2]).toHaveClass(/accept/);
    expect(await page.evaluate(() => ({
      actions: window.__dragActions, notifies: window.__dragNotifies
    }))).toEqual({ actions: 3, notifies: 3 });
  } finally {
    await seeded.remove();
  }
});
