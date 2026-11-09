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
    const id = await editableObservation(request, { withPicture: true });
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

      // The menu's choices are readable: their text is not the colour they are drawn on.
      const contrast = await panel.locator('select[data-review="flag"] option').nth(1).evaluate((option) => {
        const style = getComputedStyle(option);
        return { color: style.color, background: style.backgroundColor };
      });
      expect(contrast.color).not.toBe(contrast.background);
      expect(contrast.background).not.toBe('rgba(0, 0, 0, 0)');

      // Flag it as a false detection, from where it is being watched.
      const flagged = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
      await panel.locator('select[data-review="flag"]').selectOption('False detection');
      expect((await flagged).ok()).toBe(true);
      await expect(panel.locator('.panel-review')).toHaveAttribute('data-review', 'flagged');
      await expect(panel.locator('select[data-review="flag"]')).toHaveAttribute('title', 'Flagged: False detection');
      // The box itself turns the flag's amber, so what is done shows while the video plays.
      await expect.poll(async () => (await boxOf(page, id)).colour).toBe('#f6c453');
      // The menu names the reason, not only a flag.
      await expect(panel.locator('select[data-review="flag"] option:checked')).toHaveText('⚑ False detection');
      // The species name has its line to itself.
      await expect(panel.locator('.panel-name')).toBeVisible();
      expect(await reviewOf(request, id)).toMatchObject({ decision: 'flagged', reason: 'False detection' });
      await expect(mosaic.locator('#logList')).toContainText(`reviewedInVideo`);
      await expect(mosaic.locator('#logList')).toContainText(`id:${id},decision:flagged`);

      // Take it back, the same way.
      const taken = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
      await panel.locator('[data-review="take-back"]').click();
      expect((await taken).ok()).toBe(true);
      await expect(panel.locator('.panel-review')).toHaveAttribute('data-review', 'unreviewed');
      await expect(panel.locator('button[data-review="reviewed"]')).toHaveText('✓ Mark reviewed');
      await expect.poll(async () => (await boxOf(page, id)).colour).not.toBe('#f6c453');
      expect((await reviewOf(request, id)).decision).toBeNull();
      await expect(mosaic.locator('#logList')).toContainText(`id:${id},decision:null`);

      // Marked reviewed, the box turns the reviewed green.
      const accepted = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
      await panel.locator('button[data-review="reviewed"]').click();
      expect((await accepted).ok()).toBe(true);
      await expect(panel.locator('button[data-review="reviewed"]')).toHaveText('✓ Reviewed');
      await expect.poll(async () => (await boxOf(page, id)).colour).toBe('#a7ec35');
      expect((await reviewOf(request, id)).decision).toBe('reviewed');
      await expect(mosaic.locator('#logList')).toContainText(`id:${id},decision:reviewed`);
    } finally {
      await putBack(request, id, before);
    }
  });
