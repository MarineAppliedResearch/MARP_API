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
import { editableObservation, openAndPlay, boxOf, centre, isEdit, mouseDrag } from './video-page.mjs';


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
        'Send To Back', 'Use for Mosaic picture', 'Delete Entire Observation', 'Delete Keyframe'
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

test('#181 the boxes go fullscreen with the player, in the GUI\'s style, over a clear picture that a press does not start',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await editableObservation(request);
    const held = await holdKeyframes(id);
    try {
      await openAndPlay(page, id);
      expect(await page.evaluate(() => window.MARP_VIDEO.paused)).toBe(true);

      // Paused, the picture is not darkened and nothing covers its middle (2026-10-06).
      expect(await page.evaluate(() => {
        const layer = document.querySelector('#player .marp-center-overlay');
        return layer ? getComputedStyle(layer).display : 'none';
      })).toBe('none');

      // The species tab is painted, in the species' colour, on the box's top left corner.
      const { rect } = await boxOf(page, id);
      const tabColour = await page.evaluate(({ own, at }) => {
        const canvas = document.getElementById('boxes');
        const o = canvas.getBoundingClientRect();
        const ratio = canvas.width / o.width;
        const s = window.MARP_VIDEO.scale;
        const x = Math.round((at.left - o.left + 2 * s) * ratio);
        const y = Math.round((at.top - o.top - 22 * s) * ratio);
        return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
      }, { own: id, at: rect });
      const read = await (await request.post('/api/v2/mosaic/video/observations', { data: { observation_id: id, filters: {} } })).json();
      const { speciesColour } = await import('../../src/model/video-review.js');
      const expected = speciesColour(read.observations.find((row) => row.observation_id === id).comname)
        .match(/\d+/g).map(Number);
      tabColour.forEach((channel, i) => expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(2));

      // The pointer shows what a press would do: move over a box.
      const middle = centre(rect);
      const cursorAt = (x, y) => page.evaluate(([px, py]) => getComputedStyle(document.elementFromPoint(px, py)).cursor, [x, y]);
      await page.mouse.move(middle.x, middle.y);
      await expect.poll(() => cursorAt(middle.x, middle.y)).toBe('move');

      // A click selects it, saves nothing, and does not start the video.
      let edits = 0;
      page.on('request', (r) => { if (/\/mosaic\/video\/keyframe(\/|$)/.test(new URL(r.url()).pathname)) edits += 1; });
      const before = await page.evaluate(() => window.MARP_VIDEO.time);
      await page.mouse.click(middle.x, middle.y);
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.MARP_VIDEO.selected)).toMatch(new RegExp(`^${id}_`));
      expect(edits).toBe(0);
      // The picture has not moved on. Asserted on the time rather than on `paused` alone,
      // which stayed true for a second after a click started playback and so let a real
      // defect through: clicking a box ran the video (2026-10-14).
      expect(await page.evaluate(() => window.MARP_VIDEO.time)).toBe(before);
      expect(await page.evaluate(() => window.MARP_VIDEO.paused)).toBe(true);

      // Over a grip of the selected box, a resize arrow.
      const corner = { x: rect.left + rect.width, y: rect.top + rect.height };
      await page.mouse.move(corner.x, corner.y);
      await expect.poll(() => cursorAt(corner.x, corner.y)).toBe('nwse-resize');

      // Fullscreen takes the boxes and their menu with it, laid over the picture.
      await page.locator('#player .marp-fullscreen').click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      const inFullscreen = await page.evaluate(() => {
        const full = document.fullscreenElement;
        const boxes = document.getElementById('boxes');
        return { boxes: full.contains(boxes), menu: full.contains(document.getElementById('boxMenu')) };
      });
      expect(inFullscreen).toEqual({ boxes: true, menu: true });
      await expect.poll(() => page.evaluate(() => {
        const picture = document.querySelector('#player .marp-canvas').getBoundingClientRect();
        const boxes = document.getElementById('boxes').getBoundingClientRect();
        return Math.abs(picture.width - boxes.width) < 1 && Math.abs(picture.left - boxes.left) < 1
          && window.MARP_VIDEO.drawn.length > 0 && picture.width > 0;
      }), { message: 'the boxes were not redrawn over the fullscreen picture' }).toBe(true);
      await page.evaluate(() => document.exitFullscreen());
    } finally {
      await held.restore();
    }
  });

/* #356, Isaac 2026-11-20: a box under the player's controls -- every habitat stretch's is, its
   box being the bottom half of the picture -- took the scrub bar's clicks, so the reviewer
   moved the box when they meant to move the video. The controls bar is lifted over the opened
   box here, so any observation will do and nothing on the record is touched. */
test('#356 a press on the player\'s controls is theirs, though a box is drawn beneath them',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const id = await editableObservation(request);
    await openAndPlay(page, id);
    const edits = [];
    page.on('request', (r) => { if (isEdit({ url: () => r.url(), request: () => r })) edits.push(r.url()); });

    // The opened observation's panel is closed first, as a reviewer would: at phone width it
    // covers the picture, box and all.
    const panel = page.locator('#obsPanel');
    if (await panel.isVisible()) {
      await panel.getByRole('button', { name: 'Close' }).click();
      await expect(panel).toBeHidden();
    }
    const box = (await boxOf(page, id)).rect;
    const middle = centre(box);
    await page.evaluate((y) => {
      const bar = document.querySelector('.marp-controls-bar');
      const track = bar.querySelector('.marp-scrub-track').getBoundingClientRect();
      // The scrub track's middle moved onto the box's middle; and kept on screen, as when paused.
      const top = bar.offsetTop + (y - (track.top + track.height / 2));
      bar.style.bottom = 'auto';
      bar.style.top = `${top}px`;
      bar.classList.remove('marp-faded');
    }, middle.y);
    const track = await page.locator('.marp-scrub-track').boundingBox();
    expect(Math.abs(track.y + track.height / 2 - middle.y), 'the scrub bar is not over the box').toBeLessThan(2);

    // A point that is both the box and the scrub bar: at phone width the observation's panel
    // covers part of the picture, so it is looked for along the box rather than assumed.
    const found = await page.evaluate(({ left, width, y }) => {
      const seen = [];
      for (let x = left + 4; x < left + width - 4; x += 4) {
        const element = document.elementFromPoint(x, y);
        if (element && element.closest('.marp-scrub-track')) return { x, y };
        seen.push(element ? element.className || element.tagName : 'nothing');
      }
      return { seen: [...new Set(seen)] };
    }, { left: box.left, width: box.width, y: middle.y });
    expect(found.x, `no point of the box is the scrub bar; found ${JSON.stringify(found.seen)}`).toBeDefined();
    const at = found;
    const before = await page.evaluate(() => window.MARP_VIDEO.time);
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.time), {
      message: 'the click on the scrub bar did not move the video', timeout: 30_000
    }).not.toBeCloseTo(before, 0);
    expect(edits, 'a click on the scrub bar edited the box beneath it').toEqual([]);
  });
