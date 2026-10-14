/**
 * Shared by the video page's browser checks (#181): finding an observation that can be edited,
 * opening the page on it signed in to the real Jellyfin, and driving its boxes.
 */
import { expect } from '@playwright/test';
import { pageOf } from './support.mjs';

/* An observation in a video Jellyfin has, whose own box is on the picture it opens at. */
export async function editableObservation(request) {
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
export async function openAndPlay(page, id) {
  const username = process.env.JELLYFIN_USERNAME;
  const password = process.env.JELLYFIN_PASSWORD;
  expect(username && password, 'JELLYFIN_USERNAME and JELLYFIN_PASSWORD must be in .env for this check').toBeTruthy();

  const hash = encodeURIComponent(JSON.stringify({ type: 'show', observationId: id, filters: {} }));
  await page.goto(`inspect.html#${hash}`);
  // Every check starts in a fresh browser with no Jellyfin session, so the form always comes
  // -- after the video's observations are read, which on a busy video takes a while.
  const form = page.locator('#signIn');
  await expect(form).toBeVisible({ timeout: 60_000 });
  await form.getByLabel('User').fill(username);
  await form.getByLabel('Password').fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.editing), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate((own) => window.MARP_VIDEO.drawn.some((d) => d.observation_id === own), id),
    { message: 'the opened observation\'s box was never drawn', timeout: 120_000 }).toBe(true);
}

export const boxOf = (page, id) => page.evaluate((own) => window.MARP_VIDEO.drawn.find((d) => d.observation_id === own), id);
export const centre = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
export const isEdit = (r) => /\/mosaic\/video\/keyframe(\/|$)/.test(new URL(r.url()).pathname) && r.request().method() !== 'GET';

export async function mouseDrag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(from.x + (dx * step) / 6, from.y + (dy * step) / 6);
  await page.mouse.up();
}
