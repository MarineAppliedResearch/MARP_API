/**
 * A tile's panel can mark it reviewed (Isaac, 2026-11-09).
 *
 * The panel offered only flag reasons; accepting one tile was a right-click, which nothing
 * on screen says. "Mark reviewed" in the panel makes the same pending accept mark, and
 * Commit Marked records it, as everything else in that panel does.
 */
import { test, expect } from '@playwright/test';
import { seedPage } from './seed.mjs';
import { expectRealBacking, ready } from './support.mjs';

/* The scientific decision the record holds for one seeded row. */
async function decisionOf(request, seeded, id) {
  const res = await request.post('/api/v2/mosaic/observations/pages', {
    data: {
      filters: { line: [seeded.line], reviewStatus: ['unreviewed', 'flagged', 'reviewed'] },
      pageSize: 45, pages: [1]
    }
  });
  expect(res.ok()).toBeTruthy();
  const row = (await res.json()).pages[0].rows.find((r) => r.observation_id === id);
  return row && row.review_decision;
}

test('a flagged tile is marked reviewed from its panel, and Commit Marked records it as reviewed',
  async ({ page, request }) => {
    const seeded = await seedPage({ count: 1, thumbnail: 'ready' });
    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);
      const [id] = seeded.ids;
      const tile = page.locator(`.tile[data-id="${id}"]`);

      // Flagged, then opened, the way a reviewer reaches the panel.
      await tile.click();
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
      await tile.locator('[data-badge]').click();
      const panel = page.locator('.pick');
      const accept = panel.locator('[data-act="accept"]');
      await expect(accept).toHaveText(/Mark reviewed/);

      // Reviewed instead: pending, like the flag it replaces.
      await accept.click();
      await expect(panel).toHaveCount(0);
      await expect(tile.locator('.badge')).toContainText('REVIEWED');
      expect(await decisionOf(request, seeded, id)).toBeNull();

      await page.locator('#commitMarked').click();
      await expect(page.locator('#commitMarked')).toContainText('Saved');
      expect(await decisionOf(request, seeded, id)).toBe('reviewed');
    } finally {
      await seeded.remove();
    }
  });
