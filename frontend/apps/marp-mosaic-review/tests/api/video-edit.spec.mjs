/**
 * #181: the video page's boxes take the annotation GUI's controls, and every save reaches
 * the database.
 *
 * **A real video plays here.** A box is only drawn over a picture, so this signs in to the
 * real Jellyfin through the page's own form with the test account in `.env`
 * (`JELLYFIN_USERNAME`, `JELLYFIN_PASSWORD`), as the player's own end-to-end tests do --
 * decided 2026-10-05. Missing credentials fail the check; they never skip it.
 *
 * It edits a real observation on the testing database, so `holdKeyframes` snapshots its
 * keyframes first and puts them back exactly afterwards, and fails if it could not.
 *
 * Touch is checked on the Android emulator by real touch input; this is the mouse.
 */
import { test, expect } from '@playwright/test';
import { holdKeyframes } from './seed.mjs';
import { pageOf } from './support.mjs';

/* An observation in a video Jellyfin has, whose own box is on the picture it opens at. */
async function editableObservation(request) {
  const { rows } = await pageOf(request, {}, { pageSize: 50 });
  const res = await request.post('/api/v2/mosaic/observations/video-context', {
    data: { observation_ids: rows.map((row) => row.observation_id) }
  });
  expect(res.ok(), `the video-context read was refused: ${res.status()}`).toBeTruthy();
  for (const video of (await res.json()).videos.filter((entry) => entry.jellyfin_item_id)) {
    for (const { observation_id: id } of video.observations) {
      const read = await (await request.post('/api/v2/mosaic/video/observations', {
        data: { observation_id: id, filters: {} }
      })).json();
      const own = read.observations.find((row) => row.observation_id === id);
      const moment = read.opened.moment_s;
      if (own && moment != null && own.start_s + 0.2 < moment && moment < own.end_s - 0.2) return id;
    }
  }
  throw new Error('no observation on the first page has its moment inside its own track, '
    + 'in a video Jellyfin has. `npm run testing-db reset` rebuilds the testing database.');
}

/* Open the page on an observation and sign in to Jellyfin, then wait for its box. */
async function openAndPlay(page, id) {
  const username = process.env.JELLYFIN_USERNAME;
  const password = process.env.JELLYFIN_PASSWORD;
  expect(username && password, 'JELLYFIN_USERNAME and JELLYFIN_PASSWORD must be in .env for this check').toBeTruthy();

  const hash = encodeURIComponent(JSON.stringify({ type: 'show', observationId: id, filters: {} }));
  await page.goto(`inspect.html#${hash}`);
  const form = page.locator('#signIn');
  // A session kept from an earlier check in this browser skips the form.
  if (await form.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await form.getByLabel('User').fill(username);
    await form.getByLabel('Password').fill(password);
    await form.getByRole('button', { name: 'Sign in' }).click();
    await expect(form).toBeHidden();
  }
  await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.editing), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate((own) => window.MARP_VIDEO.drawn.some((d) => d.observation_id === own), id),
    { message: 'the opened observation\'s box was never drawn', timeout: 120_000 }).toBe(true);
}

const boxOf = (page, id) => page.evaluate((own) => window.MARP_VIDEO.drawn.find((d) => d.observation_id === own), id);
const centre = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const isEdit = (r) => /\/mosaic\/video\/keyframe(\/|$)/.test(new URL(r.url()).pathname) && r.request().method() !== 'GET';

async function mouseDrag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(from.x + (dx * step) / 6, from.y + (dy * step) / 6);
  await page.mouse.up();
}

test('#181 dragging a box saves it where it was dropped, a corner resizes it, and the menu is the GUI\'s',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await editableObservation(request);
    const held = await holdKeyframes(id);
    try {
      await openAndPlay(page, id);
      const { rect } = await boxOf(page, id);
      const from = centre(rect);

      // Drag the body: one save, and the box is drawn where it was let go.
      const saved = page.waitForResponse(isEdit);
      await mouseDrag(page, from, 24, 16);
      const answer = await (await saved).json();
      expect(answer.observation_id).toBe(id);
      expect(answer.changed).toHaveLength(1);
      const moved = await boxOf(page, id);
      expect(Math.abs(centre(moved.rect).x - (from.x + 24))).toBeLessThan(2);
      expect(Math.abs(centre(moved.rect).y - (from.y + 16))).toBeLessThan(2);

      // What was saved is the record now: the read gives the same box back.
      const keyframe = answer.changed[0];
      const reread = await (await request.post('/api/v2/mosaic/video/keyframes', {
        data: { observation_ids: [id], from_s: keyframe.t - 1, to_s: keyframe.t + 1 }
      })).json();
      const stored = reread.keyframes.find((k) => k.keyframe_id === keyframe.keyframe_id);
      expect(stored).toBeTruthy();
      expect(stored.x).toBeCloseTo(keyframe.x, 3);
      expect(stored.y).toBeCloseTo(keyframe.y, 3);

      // Selected now, so its grips are live: the bottom-right one makes it larger, and the
      // same keyframe is saved again rather than a second one made.
      expect(await page.evaluate(() => window.MARP_VIDEO.selected)).toBe(`${id}_${keyframe.subset}`);
      const grown = page.waitForResponse(isEdit);
      await mouseDrag(page, { x: moved.rect.left + moved.rect.width, y: moved.rect.top + moved.rect.height }, 20, 12);
      const resized = (await (await grown).json()).changed[0];
      expect(resized.keyframe_id).toBe(keyframe.keyframe_id);
      expect(resized.width).toBeGreaterThan(keyframe.width);
      expect(resized.height).toBeGreaterThan(keyframe.height);

      // Right click: the GUI's menu for this keyframe, and Escape shuts it. Set As End is
      // offered on a middle only -- never on the end, nor on the start (2026-10-05).
      const now = centre((await boxOf(page, id)).rect);
      await page.mouse.click(now.x, now.y, { button: 'right' });
      const menu = page.locator('#boxMenu');
      await expect(menu).toBeVisible();
      await expect(menu.locator('button')).toHaveText([
        new RegExp(`keyframe ${resized.keyframe_id} · ${resized.type}`),
        ...(resized.type === 'middle' ? ['Set As End Keyframe'] : []),
        'Send To Back', 'Delete Entire Observation', 'Delete Keyframe'
      ]);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      // A drag that starts on no box is the player's, and saves nothing.
      let stray = 0;
      page.on('request', (r) => {
        if (/\/mosaic\/video\/keyframe(\/|$)/.test(new URL(r.url()).pathname)) stray += 1;
      });
      const player = await page.locator('#player').boundingBox();
      await mouseDrag(page, { x: player.x + 8, y: player.y + 8 }, 30, 0);
      await page.waitForTimeout(500);
      expect(stray).toBe(0);
    } finally {
      await held.restore();
    }
  });
