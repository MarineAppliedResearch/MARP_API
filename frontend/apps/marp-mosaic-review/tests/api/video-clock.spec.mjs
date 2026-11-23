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
import { seedHabitat } from './habitat-seed.mjs';
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

/* #367, Isaac 2026-11-20: "while the video runs the real time clock up here is never updating".
   It was written only on a redraw, which a frame the video paints does not make. */
test('#367: the frame\'s clock time follows the video, frame by frame', async ({ page, request }) => {
  test.setTimeout(240_000);
  const id = await editableObservation(request);
  const read = await (await request.post('/api/v2/mosaic/video/observations', {
    data: { observation_id: id, filters: {} }
  })).json();
  const held = await holdVideoClock(read.video.video_source);
  try {
    await openAndPlay(page, id);
    await page.locator('#setClock').click();
    await page.locator('#clockReading').fill('2021-06-14T16:45:39.123');
    const put = page.waitForResponse(isClockPut);
    await page.locator('#clockForm button[type=submit]').click();
    expect((await put).ok()).toBeTruthy();
    // In the player's controls now, the time alone, the day on hover (#367).
    await expect(page.locator('#clockNow')).toContainText('UTC');
    await expect(page.locator('#clockNow')).toHaveAttribute('title', /^This frame: /);
    expect(await page.locator('#clockNow').evaluate((e) => Boolean(e.closest('.marp-controls-row')))).toBe(true);

    // Each step forward is a new frame 40 ms on, and the readout says so.
    for (let step = 0; step < 3; step += 1) {
      const before = await page.locator('#clockNow').textContent();
      const time = await page.evaluate(() => window.MARP_VIDEO.time);
      await page.locator('.marp-step-forward').click();
      await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.time)).toBeGreaterThan(time);
      await expect(page.locator('#clockNow')).not.toHaveText(before);
    }
  } finally {
    await held.restore();
  }
});

/* Found filming the trial fixes, 2026-11-21: setting a clock rewrites every observation in the
   video, and the page went on holding the versions from before. So the open panel still listed
   keyframes as positions, and the next drag or cut was refused as changed until a reopen. */
test('a clock set with a stretch open: its keyframes turn to clock time, and a drag and a cut go through without reopening',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const opened = await editableObservation(request);
    const read = await (await request.post('/api/v2/mosaic/video/observations', {
      data: { observation_id: opened, filters: {} }
    })).json();
    const at = read.opened.moment_s;
    // Held before the seed, and put back after it is gone: the cut adds a row the hold never read.
    const held = await holdVideoClock(read.video.video_source);
    const seeded = await seedHabitat({
      videoSource: read.video.video_source,
      stretches: [{ start: at, end: at + 120, substrate: 'Rock' }, { start: at + 40, end: at + 60, substrate: 'Sand' }]
    });
    const [rock, sand] = seeded.ids;
    const bar = (id) => page.locator(`.hstrip-bar[data-id="${id}"]`);
    try {
      await openAndPlay(page, rock);
      // Zoomed in on the Sand, so its end and the Rock's lane are both under the pointer.
      // Only until it is wide enough to grab: further, and its end leaves the screen.
      const strip = await page.locator('#habitatStrip .hstrip-lanes').boundingBox();
      for (let n = 0; n < 6; n += 1) {
        const box = await bar(sand).boundingBox();
        if (box.width > strip.width / 8) break;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -600);
      }
      await bar(sand).click();
      // Its keyframes load once the video is there, and the panel is drawn on a selection, so
      // selected again once they have: what is under test is the clock, not that load.
      await expect.poll(() => page.evaluate((id) => window.MARP_VIDEO.drawn.some((d) => d.observation_id === id), sand),
        { timeout: 60_000 }).toBe(true);
      await bar(sand).click();
      const first = page.locator('#obsPanel .panel-keyframes button').first();
      await expect(first).toBeVisible();
      const before = await first.textContent();

      await page.locator('#setClock').click();
      await page.locator('#clockReading').fill('2021-06-14T16:45:39.123');
      const put = page.waitForResponse(isClockPut);
      await page.locator('#clockForm button[type=submit]').click();
      expect((await put).ok()).toBeTruthy();
      await expect(page.locator('#inspectStatus')).toContainText('Clock set.');

      // The panel, redrawn on the clock just set.
      await expect(first).toContainText(/\d\d:\d\d:\d\d\.\d{3} UTC/);
      await expect(first).not.toHaveText(before);

      // The Sand's end dragged in a little: saved, not refused as changed.
      const box = await bar(sand).boundingBox();
      const from = { x: box.x + box.width - 2, y: box.y + box.height / 2 };
      const times = page.waitForResponse((r) => r.url().endsWith('/times') && r.request().method() === 'PUT');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let n = 1; n <= 10; n += 1) await page.mouse.move(from.x - (Math.min(20, box.width / 3) * n) / 10, from.y);
      await page.mouse.up();
      const dragged = await times;
      expect(dragged.ok(), `the drag was refused: ${dragged.status()} ${await dragged.text()}`).toBe(true);

      // And the Rock cut with the Sand: the Rock's version moved with the clock too.
      const rockBox = await bar(rock).boundingBox();
      const lanes = await page.locator('#habitatStrip .hstrip-lanes').boundingBox();
      const onRock = { x: Math.max(rockBox.x, lanes.x) + 12, y: rockBox.y + rockBox.height / 2 };
      await bar(sand).click();
      await page.mouse.move(onRock.x, onRock.y);
      await page.keyboard.down('Control');
      await page.mouse.click(onRock.x, onRock.y);
      await page.keyboard.up('Control');
      await expect(bar(rock)).toHaveClass(/second/);
      await page.mouse.click(onRock.x, onRock.y, { button: 'right' });
      const item = page.locator('.hstrip-menu button', { hasText: /^Cut / });
      const cut = page.waitForResponse((r) => r.url().endsWith('/cut'));
      await item.click();
      const answer = await cut;
      expect(answer.ok(), `the cut was refused: ${answer.status()} ${await answer.text()}`).toBe(true);
    } finally {
      try {
        await seeded.remove();
      } finally {
        await held.restore();
      }
    }
  });
