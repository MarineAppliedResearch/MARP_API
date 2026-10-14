/** #183: the flagged-details popup moves without changing the review beneath it. */
import { test, expect } from '@playwright/test';
import { seedPage } from './seed.mjs';
import { expectRealBacking, isPhone, ready } from './support.mjs';

async function geometry(page) {
  return page.locator('.pick').evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const edge = 8;
    if (window.matchMedia('(max-width: 760px)').matches) {
      const viewport = window.visualViewport;
      const left = viewport ? viewport.offsetLeft : 0;
      const top = viewport ? viewport.offsetTop : 0;
      const width = viewport ? viewport.width : window.innerWidth;
      const height = viewport ? viewport.height : window.innerHeight;
      return {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        bounds: { left: left + edge, top: top + edge,
          right: left + width - edge, bottom: top + height - edge }
      };
    }
    const field = document.querySelector('#field').getBoundingClientRect();
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      bounds: { left: field.left + edge, top: field.top + edge,
        right: field.right - edge, bottom: field.bottom - edge }
    };
  });
}

function usefulDelta(box) {
  const right = box.bounds.right - box.right;
  const left = box.left - box.bounds.left;
  const below = box.bounds.bottom - box.bottom;
  const above = box.top - box.bounds.top;
  const choose = (positive, negative) => positive > 40
    ? Math.min(110, positive - 2)
    : -Math.min(110, Math.max(0, negative - 2));
  return { x: choose(right, left), y: choose(below, above) };
}

async function dragHandle(page, touch, delta) {
  const handle = page.locator('[data-picker-drag-handle]');
  const box = await handle.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const end = { x: start.x + delta.x, y: start.y + delta.y };

  if (!touch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    return;
  }

  await handle.dispatchEvent('pointerdown', {
    pointerId: 31, pointerType: 'touch', isPrimary: true,
    button: 0, buttons: 1, clientX: start.x, clientY: start.y
  });
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 31, pointerType: 'touch', isPrimary: true,
    button: 0, buttons: 1, clientX: x, clientY: y
  })), end);
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 31, pointerType: 'touch', isPrimary: true,
    button: 0, buttons: 0, clientX: x, clientY: y
  })), end);
}

test('#183 popup drags, persists, clamps, and leaves review controls intact',
  async ({ page }, info) => {
    const seeded = await seedPage({ count: 1, thumbnail: 'ready' });
    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);

      const id = seeded.ids[0];
      const tile = page.locator(`.tile[data-id="${id}"]`);
      await tile.click();
      await tile.locator('[data-badge]').click();

      const panel = page.locator('.pick');
      const handle = panel.locator('[data-picker-drag-handle]');
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute('title', 'Drag to move');

      const before = await geometry(page);
      const delta = usefulDelta(before);
      expect(Math.abs(delta.x) + Math.abs(delta.y)).toBeGreaterThan(20);
      const markBefore = await page.evaluate((observationId) =>
        window.MARP.state.marks.get(observationId), id);

      const note = panel.locator('#decisionNote');
      await note.focus();
      await dragHandle(page, isPhone(info), delta);
      await expect(note).toBeFocused();

      await expect.poll(async () => {
        const after = await geometry(page);
        return Math.abs(after.left - before.left) + Math.abs(after.top - before.top);
      }).toBeGreaterThan(20);
      expect(await page.evaluate((observationId) =>
        window.MARP.state.marks.get(observationId), id)).toEqual(markBefore);
      expect(await page.evaluate(() => window.MARP.state.picker.position)).toBeTruthy();

      const settled = await geometry(page);
      const reason = panel.locator('[data-reason]').first();
      await reason.click();
      await expect(reason).toHaveClass(/on/);
      await expect.poll(async () => {
        const rerendered = await geometry(page);
        return Math.abs(rerendered.left - settled.left) + Math.abs(rerendered.top - settled.top);
      }).toBeLessThan(2);

      const viewport = page.viewportSize();
      await page.setViewportSize({ width: viewport.width, height: Math.max(420, viewport.height - 140) });
      await expect.poll(async () => {
        const moved = await geometry(page);
        return moved.left >= moved.bounds.left - 1
          && moved.top >= moved.bounds.top - 1
          && moved.right <= moved.bounds.right + 1
          && moved.bottom <= moved.bounds.bottom + 1;
      }).toBe(true);

      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await tile.locator('[data-badge]').click();
      await expect(page.locator('.pick')).toBeVisible();
      expect(await page.evaluate(() => window.MARP.state.picker.position ?? null)).toBeNull();
      await page.keyboard.press('Escape');
      await expect(page.locator('.pick')).toHaveCount(0);
      await expect(tile).toHaveClass(/marked/);
    } finally {
      await seeded.remove();
    }
  });
