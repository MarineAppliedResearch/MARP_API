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

test('#136 mouse rectangle marking is batched and direct; touch taps remain intact', async ({ page }, info) => {
  const seeded = await seedPage({ count: 4, thumbnail: 'ready' });
  try {
    await page.goto(`${seeded.address}&reviewStatus=unreviewed,flagged,reviewed`);
    await expectRealBacking(page);
    await ready(page);

    const tiles = seeded.ids.map((id) => page.locator(`.tile[data-id="${id}"]`));

    if (isPhone(info)) {
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
    await expect.poll(() => page.evaluate(() => window.MARP.state.commit.status)).toBe('ok');
    await ready(page);
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

test('#136 rectangles mark exactly their 2x2 and 3x2 intersections', async ({ page }, info) => {
  const seeded = await seedPage({ count: isPhone(info) ? 9 : 40, thumbnail: 'ready' });
  try {
    await page.goto(seeded.address);
    await ready(page);
    await expectRealBacking(page);
    await expect.poll(() => page.locator('.tile img').evaluateAll((images) =>
      images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)))
      .toBe(true);
    await page.evaluate(() => {
      window.__nativeImageDrags = 0;
      document.querySelector('#grid').addEventListener('dragstart', () => {
        window.__nativeImageDrags += 1;
      });
    });
    const rows = await page.locator('.tile[data-id]').evaluateAll((tiles) => {
      const field = document.querySelector('#field').getBoundingClientRect();
      const rows = [];
      for (const tile of tiles) {
        const box = tile.getBoundingClientRect();
        if (box.top < field.top || box.bottom > field.bottom) continue;
        let row = rows.find((r) => Math.abs(r.top - box.top) < 1);
        if (!row) { row = { top: box.top, tiles: [] }; rows.push(row); }
        row.tiles.push({ id: Number(tile.dataset.id), x: box.x, y: box.y,
          width: box.width, height: box.height });
      }
      const columns = rows[0].tiles.length;
      return rows.filter((row) => row.tiles.length === columns).map((row) => row.tiles);
    });
    expect(rows.length, 'at least two complete visible rows').toBeGreaterThanOrEqual(2);
    expect(rows[0].length, 'at least three columns').toBeGreaterThanOrEqual(3);

    const select = async (group, button) => {
      const upperLeft = group[0][0];
      const lowerRight = group.at(-1).at(-1);
      await page.mouse.move(lowerRight.x + lowerRight.width / 2,
        lowerRight.y + lowerRight.height / 2);
      await page.mouse.down({ button });
      await page.mouse.move(upperLeft.x + upperLeft.width / 2,
        upperLeft.y + upperLeft.height / 2, { steps: 12 });
      await expect(page.locator('.drag-select-band')).toBeVisible();
      await page.mouse.up({ button });
      const ids = group.flat().map(({ id }) => id).sort((a, b) => a - b);
      expect(await page.locator('.tile.marked').evaluateAll((tiles) =>
        tiles.map((tile) => Number(tile.dataset.id)).sort((a, b) => a - b))).toEqual(ids);
      await expect(page.locator('.drag-preview')).toHaveCount(0);
      await expect(page.locator('.drag-select-band')).toHaveCount(0);
      for (const id of ids) {
        await expect(page.locator(`.tile[data-id="${id}"] .badge`))
          .toContainText(button === 'left' ? 'FLAGGED' : 'REVIEWED');
      }
    };

    await select(rows.slice(-2).map((row) => row.slice(-2)), 'left');
    await page.evaluate(() => window.MARP.actions.clearMarks());
    const middle = Math.max(0, Math.floor((rows[0].length - 3) / 2));
    await select(rows.slice(0, 2).map((row) => row.slice(middle, middle + 3)), 'right');
    expect(await page.evaluate(() => window.__nativeImageDrags)).toBe(0);
  } finally {
    await seeded.remove();
  }
});

test('#136 real touch swipes scroll and hold-drag offers both workflow decisions', async ({ page }) => {
  const seeded = await seedPage({ count: 9, thumbnail: 'ready' });
  try {
    await page.setViewportSize({ width: 393, height: 240 });
    const touch = await page.context().newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.goto(seeded.address);
    await ready(page);
    await expectRealBacking(page);
    const field = page.locator('#field');
    expect(await field.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    const point = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const send = (type, p) => touch.send('Input.dispatchTouchEvent', {
      type, touchPoints: p ? [{ ...p, id: 1, radiusX: 1, radiusY: 1 }] : []
    });
    const tap = async (locator) => {
      await send('touchStart', point(await locator.boundingBox()));
      await send('touchEnd');
    };
    const first = point(await page.locator('.tile').first().boundingBox());
    await send('touchStart', first);
    for (let step = 1; step <= 6; step += 1) {
      await send('touchMove', { x: first.x, y: first.y - step * 10 });
    }
    await send('touchEnd');
    await expect.poll(() => field.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('.touch-selection-choice')).toHaveCount(0);
    await expect(page.locator('.tile.marked')).toHaveCount(0);
    await page.waitForTimeout(250);
    await field.evaluate((el) => { el.scrollTop = 0; });

    const holdSelect = async () => {
      await field.evaluate((el) => { el.scrollTop = 0; });
      const selected = await page.locator('.tile').evaluateAll((tiles) =>
        tiles.slice(0, 2).map((tile) => Number(tile.dataset.id)));
      const a = point(await page.locator('.tile').nth(0).boundingBox());
      const b = point(await page.locator('.tile').nth(1).boundingBox());
      await send('touchStart', a);
      await page.waitForTimeout(500);
      for (let step = 1; step <= 6; step += 1) {
        await send('touchMove', { x: a.x + (b.x - a.x) * step / 6, y: a.y });
      }
      await expect(page.locator('.drag-select-band')).toBeVisible();
      await send('touchEnd');
      await expect(page.locator('.touch-selection-choice')).toBeVisible();
      await expect(page.locator('.touch-selection-choice p')).toHaveText('2 selected');
      expect(await field.evaluate((el) => el.scrollTop)).toBe(0);
      await expect(page.locator('.tile.marked')).toHaveCount(0);
      return selected.sort((a, b) => a - b);
    };
    const markedIds = () => page.locator('.tile.marked').evaluateAll((tiles) =>
      tiles.map((tile) => Number(tile.dataset.id)).sort((a, b) => a - b));

    for (const mode of ['scientific', 'training']) {
      await page.evaluate((mode) => window.MARP.actions.setMode(mode), mode);
      await ready(page);
      for (const kind of ['except', 'accept']) {
        const ids = await holdSelect();
        const choice = page.locator('.touch-selection-choice');
        await expect(choice.locator('[data-selection-kind="except"]'))
          .toHaveText(mode === 'scientific' ? 'Flag' : 'Exclude');
        await expect(choice.locator('[data-selection-kind="accept"]'))
          .toHaveText(mode === 'scientific' ? 'Mark Reviewed' : 'Promote');
        await tap(choice.locator(`[data-selection-kind="${kind}"]`));
        expect(await markedIds()).toEqual(ids);
        await expect(page.locator('.tile.marked.accept')).toHaveCount(kind === 'accept' ? 2 : 0);
        await expect(choice).toHaveCount(0);
        await page.evaluate(() => window.MARP.actions.clearMarks());
      }
    }
    await holdSelect();
    await tap(page.locator('[data-selection-cancel]'));
    await expect(page.locator('.touch-selection-choice')).toHaveCount(0);
    await expect(page.locator('.tile.marked')).toHaveCount(0);
    await touch.detach();
  } finally {
    await seeded.remove();
  }
});
