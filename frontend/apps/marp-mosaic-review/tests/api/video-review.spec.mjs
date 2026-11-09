/**
 * #337: an observation is reviewed on the video page, where the reviewer is watching it.
 *
 * **A real video plays here**, signed in to the real Jellyfin with the test account in
 * `.env`, as the other video-page checks do. It decides about a real observation on the
 * testing database, so the decision it found is read first and put back afterwards through
 * the same route, and the check fails if that did not take.
 */
import { test, expect } from '@playwright/test';
import { editableObservation, openAndPlay, boxOf, centre } from './video-page.mjs';
import { ready } from './support.mjs';

/* The observation's scientific review as the video page is told it. */
async function reviewOf(request, id) {
  const read = await (await request.post('/api/v2/mosaic/video/observations', {
    data: { observation_id: id, filters: {} }
  })).json();
  const own = read.observations.find((row) => row.observation_id === id);
  return { decision: own.review_decision, reason: own.flag_reason, version: own.version };
}

/* Put a review back as it was, through the Mosaic's own commit route. */
async function putBack(request, id, before) {
  const now = await reviewOf(request, id);
  if (now.decision === before.decision && now.reason === before.reason) return;
  const body = { observations: [{ observation_id: id, version: now.version }], marks: [] };
  if (before.decision === null) body.withdraw = [id];
  else body.marks.push({ observation_id: id, kind: before.decision === 'flagged' ? 'except' : 'accept', reason: before.reason, note: null });
  const res = await request.post('/api/v2/mosaic/observations/review', { data: body });
  expect(res.ok(), `putting the review back was refused: ${res.status()}`).toBeTruthy();
  expect(await reviewOf(request, id), 'the review was not put back').toMatchObject({ decision: before.decision, reason: before.reason });
}

test('#337 the video page flags an observation and takes the flag back, and the Mosaic hears both',
  async ({ page, context, request }) => {
    test.setTimeout(240_000);
    const id = await editableObservation(request);
    const before = await reviewOf(request, id);

    // The Mosaic, open beside it, as the reviewer has it.
    const mosaic = await context.newPage();
    await mosaic.goto('./');
    await ready(mosaic);

    try {
      await openAndPlay(page, id);
      await page.mouse.click(centre((await boxOf(page, id)).rect).x, centre((await boxOf(page, id)).rect).y);
      const panel = page.locator('#obsPanel');
      await expect(panel).toBeVisible();

      // Flag it as a false detection, from where it is being watched.
      const flagged = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
      await panel.locator('select[data-review="flag"]').selectOption('False detection');
      expect((await flagged).ok()).toBe(true);
      await expect(panel.locator('.panel-review')).toHaveAttribute('data-review', 'flagged');
      await expect(panel.locator('select[data-review="flag"]')).toHaveAttribute('title', 'Flagged: False detection');
      expect(await reviewOf(request, id)).toMatchObject({ decision: 'flagged', reason: 'False detection' });
      await expect(mosaic.locator('#logList')).toContainText(`reviewedInVideo`);
      await expect(mosaic.locator('#logList')).toContainText(`id:${id},decision:flagged`);

      // Take it back, the same way.
      const taken = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
      await panel.locator('[data-review="take-back"]').click();
      expect((await taken).ok()).toBe(true);
      await expect(panel.locator('.panel-review')).toHaveAttribute('data-review', 'unreviewed');
      await expect(panel.locator('button[data-review="reviewed"]')).toHaveAttribute('title', 'Mark reviewed');
      expect((await reviewOf(request, id)).decision).toBeNull();
      await expect(mosaic.locator('#logList')).toContainText(`id:${id},decision:null`);
    } finally {
      await putBack(request, id, before);
    }
  });
