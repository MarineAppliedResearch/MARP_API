/**
 * #76: setting a video's clock from the video page, over real video.
 *
 * Isaac, 2026-11-09: the clock is set the way the annotation GUI's Sync Time is -- pause on a
 * frame showing the clock burnt into the picture, type its date and time -- and a video with
 * no clock says so, because its times are positions rather than clock times.
 *
 * Signed in to the real Jellyfin with the test account in `.env`, as the other video checks
 * are. Setting a clock rewrites every observation in the video, so `holdVideoClock` reads
 * them first and puts them back afterwards, and checks it did.
 */
import { test, expect } from '@playwright/test';
import { holdVideoClock } from './seed.mjs';
import { editableObservation, openAndPlay } from './video-page.mjs';

const isClockPut = (r) => new URL(r.url()).pathname.endsWith('/videos/clock') && r.request().method() === 'PUT';

test('#76: a video with no clock says so, and a reading off a frame sets it', async ({ page, request }) => {
  const id = await editableObservation(request);
  const read = await (await request.post('/api/v2/mosaic/video/observations', {
    data: { observation_id: id, filters: {} }
  })).json();
  const source = read.video.video_source;
  const held = await holdVideoClock(source);

  try {
    await openAndPlay(page, id);

    // No clock, and the reviewer is told what that means for the times on screen.
    await expect(page.locator('#clockState')).toHaveText('No clock set: times are positions in the video');
    await expect(page.locator('#clockState')).toHaveClass(/unset/);

    const at = await page.evaluate(() => window.MARP_VIDEO.time);
    await page.locator('#setClock').click();
    await expect(page.locator('#clockForm')).toBeVisible();
    await expect(page.locator('#clockAt')).toContainText('in the video');

    // What is offered is the file name's time at this frame, when the name has one.
    const clock = await (await request.get('/api/v2/videos/clock', { params: { video_source: source } })).json();
    const offered = await page.locator('#clockReading').inputValue();
    if (clock.suggested_start) {
      const expected = new Date(Date.parse(clock.suggested_start) + Math.round(at * 1000)).toISOString().slice(0, 19);
      expect(offered.slice(0, 19)).toBe(expected);
    } else {
      expect(offered).toBe('');
    }

    // Three digits that stay three: Chromium writes .400 back as .4, which fill() refuses.
    await page.locator('#clockReading').fill('2021-06-14T16:45:39.123');
    const put = page.waitForResponse(isClockPut);
    await page.locator('#clockForm button[type=submit]').click();
    expect((await put).ok()).toBeTruthy();

    await expect(page.locator('#clockState')).toContainText('(read off the picture)');
    await expect(page.locator('#clockState')).not.toHaveClass(/unset/);
    await expect(page.locator('#inspectStatus')).toContainText('Clock set.');

    // Stored as the reading less the frame's position: the recording's start.
    const set = await (await request.get('/api/v2/videos/clock', { params: { video_source: source } })).json();
    expect(set.start_source).toBe('synced');
    expect(Math.abs(Date.parse(set.recorded_start) - (Date.parse('2021-06-14T16:45:39.123Z') - at * 1000))).toBeLessThanOrEqual(1);
  } finally {
    await held.restore();
  }
});
