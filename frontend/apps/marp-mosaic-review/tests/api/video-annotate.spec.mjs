/**
 * #181: annotating on the video page -- add an observation by drawing a box and picking its
 * species, rename it, count it, cut its Mosaic picture, and merge two -- over real video.
 *
 * Signed in to the real Jellyfin with the test account in `.env`, as `video-edit.spec.mjs` is.
 * Every observation a check adds is removed afterwards, and the observation the page was
 * opened on has its keyframes put back by `holdKeyframes`. The renames, counts and merges are
 * all done to observations the check added, so nothing that was there before is changed.
 */
import { test, expect } from '@playwright/test';
import { holdKeyframes, removeObservations } from './seed.mjs';
import { editableObservation, openAndPlay, boxOf, centre, mouseDrag } from './video-page.mjs';

const isPath = (suffix, method) => (r) => new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === method;

/* A place on the picture with no box under it, clear of the controls at the bottom. */
async function emptySpot(page) {
  return page.evaluate(() => {
    // The picture itself, not its element: in a phone's portrait view the element is the whole
    // player and the picture is letterboxed in its middle, with black above and below.
    const canvas = document.querySelector('#player .marp-canvas');
    const element = canvas.getBoundingClientRect();
    const aspect = canvas.width / canvas.height;
    const wide = element.width / element.height > aspect;
    const picture = wide
      ? { left: element.left + (element.width - element.height * aspect) / 2, top: element.top, width: element.height * aspect, height: element.height }
      : { left: element.left, top: element.top + (element.height - element.width / aspect) / 2, width: element.width, height: element.width / aspect };
    const boxes = window.MARP_VIDEO.drawn.map((d) => d.rect);
    const free = (x, y) => boxes.every((r) => x + 80 < r.left || x > r.left + r.width || y + 60 < r.top || y > r.top + r.height);
    for (let fy = 0.15; fy < 0.6; fy += 0.1) {
      for (let fx = 0.1; fx < 0.8; fx += 0.1) {
        const x = picture.left + picture.width * fx;
        const y = picture.top + picture.height * fy;
        if (x + 60 < picture.left + picture.width && y + 40 < picture.top + picture.height && free(x, y)
          && document.elementFromPoint(x + 10, y + 10).classList.contains('marp-canvas')) return { x, y };
      }
    }
    return null;
  });
}

/* Draw a box on empty picture and pick the first species the term finds; the new id. */
async function addByDrawing(page, term) {
  const spot = await emptySpot(page);
  expect(spot, 'no empty place on the picture to draw a box').toBeTruthy();
  const added = page.waitForResponse(isPath('/mosaic/video/observation', 'POST'));
  await mouseDrag(page, spot, 60, 40);
  const popup = page.locator('#addPopup');
  await expect(popup).toBeVisible();
  await expect(popup.locator('input[type=search]')).toBeFocused();
  await page.keyboard.type(term);
  // Every key reaches the search, none the player's shortcuts: inside the player's element they
  // did, and a species name changed the playback speed instead (2026-10-06).
  await expect(popup.locator('input[type=search]')).toHaveValue(term);
  await expect(popup.locator('.annotate-species').first()).toBeVisible();
  const name = await popup.locator('.annotate-species .name').first().textContent();
  await page.keyboard.press('Enter');
  const body = await (await added).json();
  expect(body.observation.comname).toBe(name);
  return { id: body.observation.observation_id, name, spot };
}

/* A species name the session's list has: the opened observation's own, cut short. */
async function searchTerm(request, id) {
  const read = await (await request.post('/api/v2/mosaic/video/observations', { data: { observation_id: id, filters: {} } })).json();
  return read.observations.find((row) => row.observation_id === id).comname.slice(0, 4);
}

/* The video still steps from the keyboard. `a` and `s` are the player's frame steps, the
   annotation GUI's own keys, and the player's element is what listens for them -- so anything
   of ours that takes focus and then goes away has to give it back (2026-10-14). */
async function expectKeyboardSteps(page, where) {
  const at = await page.evaluate(() => window.MARP_VIDEO.time);
  await page.keyboard.press('s');
  await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.time),
    { message: `the keyboard could not step the video ${where}` }).not.toBe(at);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.time)).toBe(at);
}

async function step(page, button) {
  const before = await page.evaluate(() => window.MARP_VIDEO.time);
  await page.locator(`#player .marp-step-${button}`).click();
  await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.time)).not.toBe(before);
}

test('#181 a drawn box and one Enter add an observation, and its panel renames, counts and pictures it',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const opened = await editableObservation(request);
    const held = await holdKeyframes(opened);
    const created = [];
    try {
      await openAndPlay(page, opened);
      const term = await searchTerm(request, opened);

      // Add (R1): one drag, one Enter. Selected and drawn where it was drawn.
      const { id, name, spot } = await addByDrawing(page, term);
      created.push(id);
      await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.selected)).toBe(`${id}_1`);
      const box = await boxOf(page, id);
      expect(Math.abs(box.rect.left - spot.x)).toBeLessThan(3);
      expect(Math.abs(box.rect.width - 60)).toBeLessThan(3);
      const panel = page.locator('#obsPanel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('.panel-name')).toHaveText(name);

      // It has only a start keyframe, so it is unfinished and its box is held forward until
      // somebody sets the end -- as the annotation GUI does. Before this it vanished on the
      // very next frame and could then be neither moved nor ended (2026-10-14).
      for (let n = 0; n < 5; n += 1) await step(page, 'forward');
      const held = await boxOf(page, id);
      expect(held, 'the box vanished a few frames after it was drawn').toBeTruthy();
      expect(Math.abs(held.rect.left - box.rect.left)).toBeLessThan(2);

      // Selecting a box leaves the video steppable from the keyboard. It is the player's
      // element that listens, and a press on a box used to leave focus on a panel button, so
      // the arrow keys went dead until the picture itself was clicked (2026-10-14).
      await page.mouse.click(centre(held.rect).x, centre(held.rect).y);
      await expectKeyboardSteps(page, 'after a box was selected');

      // And it can still be ended from there, which is what being drawn is for.
      const ended = page.waitForResponse(isPath('/mosaic/video/keyframe', 'POST'));
      await page.mouse.click(centre(held.rect).x, centre(held.rect).y, { button: 'right' });
      await page.locator('#boxMenu button[data-action="end"]').click();
      await ended;
      await expectKeyboardSteps(page, 'after a choice from the box menu');

      // Double-click pins a keyframe where there is none, and takes one off where there is --
      // the annotation GUI's gesture. It played the video instead, because the click under it
      // reached the picture (2026-10-14).
      for (let n = 0; n < 2; n += 1) await step(page, 'back');
      const between = await boxOf(page, id);
      const at = centre(between.rect);
      const pinned = page.waitForResponse(isPath('/mosaic/video/keyframe', 'POST'));
      await page.mouse.dblclick(at.x, at.y);
      expect((await (await pinned).json()).changed.some((k) => k.type === 'middle')).toBe(true);
      expect(await page.evaluate(() => window.MARP_VIDEO.paused), 'a double-click started the video').toBe(true);
      await expect(panel.locator('.panel-keyframes li')).toHaveCount(3);

      const removed = page.waitForResponse((r) => /\/mosaic\/video\/keyframe\/\d+$/.test(new URL(r.url()).pathname)
        && r.request().method() === 'DELETE');
      await page.mouse.dblclick(at.x, at.y);
      await removed;
      await expect(panel.locator('.panel-keyframes li')).toHaveCount(2);
      await expect.poll(async () => Boolean(await boxOf(page, id))).toBe(true);
      // Past the end there is nothing: the record stops there now.
      for (let n = 0; n < 3; n += 1) await step(page, 'forward');
      await expect.poll(async () => (await boxOf(page, id)) || null).toBeNull();
      for (let n = 0; n < 3; n += 1) await step(page, 'back');
      await expect.poll(async () => Boolean(await boxOf(page, id))).toBe(true);

      // Rename (R3): the whole name, on the box as in the database.
      await panel.locator('[data-action="rename"]').click();
      const popup = page.locator('#addPopup');
      await popup.locator('input[type=search]').fill(term);
      const other = popup.locator('.annotate-species').filter({ hasNot: page.locator(`.name:text-is("${name}")`) }).first();
      await expect(other).toBeVisible();
      const newName = await other.locator('.name').textContent();
      const renamed = page.waitForResponse(isPath('/mosaic/observations/species', 'POST'));
      await other.click();
      expect((await (await renamed).json()).observation.comname).toBe(newName);
      await expect.poll(async () => (await boxOf(page, id)).comname).toBe(newName);
      await expect(panel.locator('.panel-name')).toHaveText(newName);
      await expectKeyboardSteps(page, 'after changing the species');

      // Count (R5).
      const counted = page.waitForResponse(isPath(`/observation/${id}/count`, 'PUT'));
      await panel.locator('.panel-count').fill('3');
      await panel.locator('.panel-count').press('Enter');
      expect((await (await counted).json()).count).toBe(3);

      // The Mosaic picture (R6), cut now from this frame, by the real extractor.
      const pictureButton = panel.locator('[data-action="picture"]');
      const pictured = page.waitForResponse(isPath(`/observation/${id}/picture`, 'POST'), { timeout: 120_000 });
      await pictureButton.click();
      // It decodes a real frame out of the video, which takes seconds, so it says so while it
      // runs: silence there reads as a button that does nothing (2026-10-14).
      await expect(pictureButton).toHaveText(/Cutting the picture/);
      await expect(pictureButton).toBeDisabled();
      const picture = await pictured;
      await expect(pictureButton).toHaveText(/updated/);
      expect(picture.status()).toBe(200);
      expect((await picture.json()).picture.filename).toBeTruthy();

      const read = await (await request.post('/api/v2/mosaic/video/observations', { data: { observation_id: opened, filters: {} } })).json();
      expect(read.observations.find((row) => row.observation_id === id)).toMatchObject({ comname: newName, count: 3 });
    } finally {
      await removeObservations(created);
      await held.restore();
    }
  });

test('#181 merging one observation into another from the panel leaves one, with both their boxes',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const opened = await editableObservation(request);
    const held = await holdKeyframes(opened);
    const created = [];
    try {
      await openAndPlay(page, opened);
      const term = await searchTerm(request, opened);

      // A on this frame, B three frames on: two observations, each one box.
      const a = await addByDrawing(page, term);
      created.push(a.id);
      for (let n = 0; n < 3; n += 1) await step(page, 'forward');
      const b = await addByDrawing(page, term);
      created.push(b.id);

      // Select A where it is drawn, then come back to B and merge it in.
      for (let n = 0; n < 3; n += 1) await step(page, 'back');
      const aBox = await boxOf(page, a.id);
      await page.mouse.click(aBox.rect.left + aBox.rect.width / 2, aBox.rect.top + aBox.rect.height / 2);
      await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.selected)).toBe(`${a.id}_1`);
      for (let n = 0; n < 3; n += 1) await step(page, 'forward');
      await page.locator('#obsPanel [data-action="merge"]').click();
      page.once('dialog', (dialog) => dialog.accept());
      const merged = page.waitForResponse(isPath(`/observation/${a.id}/merge`, 'POST'));
      const bBox = await boxOf(page, b.id);
      await page.mouse.click(bBox.rect.left + bBox.rect.width / 2, bBox.rect.top + bBox.rect.height / 2);
      const answer = await (await merged).json();

      expect(answer.deleted_observation_id).toBe(b.id);
      // Picking B to merge is not a click on the player: the video stays where it was.
      expect(await page.evaluate(() => window.MARP_VIDEO.paused)).toBe(true);
      expect(answer.keyframes.map((k) => k.type)).toEqual(['start', 'middle']);
      // B's box is A's now, on B's frame.
      await expect.poll(async () => (await boxOf(page, b.id)) || null).toBeNull();
      await expect.poll(async () => Boolean(await boxOf(page, a.id))).toBe(true);
    } finally {
      await removeObservations(created);
      await held.restore();
    }
  });
