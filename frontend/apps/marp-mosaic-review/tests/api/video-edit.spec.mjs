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
      await page.mouse.click(middle.x, middle.y);
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.MARP_VIDEO.selected)).toMatch(new RegExp(`^${id}_`));
      expect(await page.evaluate(() => window.MARP_VIDEO.paused)).toBe(true);
      expect(edits).toBe(0);

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
