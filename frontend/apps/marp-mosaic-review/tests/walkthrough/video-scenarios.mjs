/**
 * Walkthroughs of the video page's habitat work from the 2026-11-20 trial: one short film per
 * issue, saying what was wrong and then showing the fix, slowly enough to follow.
 *
 * Each opens a real video signed in to Jellyfin with the `.env` test account, on a habitat
 * session of its own seeded into the testing database, and removes that session afterwards.
 * The seeding, the sign-in and the video loading are `setup`, which the recorder cuts from
 * the film.
 *
 * These are for Isaac to watch. They are not tests, and every claim a scene makes is already
 * proved by a browser or unit check; a scene asserts what it says only so that a broken page
 * fails instead of producing a convincing film.
 */
import { expect } from '@playwright/test';
import { openAndPlay } from '../api/video-page.mjs';
import { seedHabitat } from '../api/habitat-seed.mjs';
import { connect, MARK, holdVideoClock } from '../api/seed.mjs';

/* ------------------------------------------------------------------ the camera's aids */

/* A recording shows no pointer, so one is drawn: a yellow ring that follows it and shrinks
   while a button is held. Pointer events, because the timeline cancels the mouse ones. */
function drawPointer() {
  const make = () => {
    if (document.getElementById('__pointer')) return;
    const ring = document.createElement('div');
    ring.id = '__pointer';
    ring.style.cssText = 'position:fixed;left:-60px;top:-60px;width:26px;height:26px;margin:-13px 0 0 -13px;'
      + 'border-radius:50%;border:3px solid #ffd400;background:rgba(255,212,0,.22);z-index:2147483647;'
      + 'pointer-events:none;transition:transform .12s;box-shadow:0 0 0 2px rgba(0,0,0,.55)';
    document.documentElement.appendChild(ring);
    /* The caption goes at the top: at the bottom it covers the timeline these films are about. */
    const style = document.createElement('style');
    style.textContent = '#__cap{bottom:auto!important;top:10px!important}';
    document.documentElement.appendChild(style);
    const follow = (e) => { ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`; };
    addEventListener('pointermove', follow, true);
    addEventListener('pointerdown', (e) => { follow(e); ring.style.transform = 'scale(.55)'; }, true);
    addEventListener('pointerup', () => { ring.style.transform = ''; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', make);
  else make();
}

/* A yellow outline round what the voice is talking about, with everything else dimmed, for
   `ms`. Takes a locator or a rectangle in page coordinates. */
async function ring(page, target, ms = 3500) {
  const rect = typeof target.boundingBox === 'function' ? await target.boundingBox() : target;
  if (!rect) throw new Error('nothing to ring: it is not on screen');
  await page.evaluate(({ r, ms: hold }) => {
    const box = document.createElement('div');
    box.className = '__ring';
    box.style.cssText = `position:fixed;left:${r.x - 6}px;top:${r.y - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;`
      + 'border:3px solid #ffd400;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.38);'
      + 'z-index:2147483646;pointer-events:none;transition:opacity .4s';
    document.documentElement.appendChild(box);
    setTimeout(() => { box.style.opacity = '0'; setTimeout(() => box.remove(), 450); }, hold);
  }, { r: { x: rect.x ?? rect.left, y: rect.y ?? rect.top, width: rect.width, height: rect.height }, ms });
}

/* Ring several things one after another, each for `ms`. */
async function ringEach(page, targets, ms = 2600) {
  for (const target of targets) {
    await ring(page, target, ms);
    await pause(page, ms + 400);
  }
}

const pause = (page, ms) => page.waitForTimeout(ms);

/* Move the pointer there slowly, so the viewer's eye can follow it. */
async function glide(page, to, steps = 18) {
  const from = await page.evaluate(() => {
    const p = document.getElementById('__pointer');
    return p ? { x: parseFloat(p.style.left), y: parseFloat(p.style.top) } : null;
  });
  const start = from && from.x >= 0 ? from : { x: to.x - 120, y: to.y - 80 };
  for (let n = 1; n <= steps; n += 1) {
    await page.mouse.move(start.x + ((to.x - start.x) * n) / steps, start.y + ((to.y - start.y) * n) / steps);
    await pause(page, 22);
  }
}

/* Glide there, wait a beat so the eye arrives, and click. */
async function clickAt(page, at, options = {}) {
  await glide(page, at);
  await pause(page, 350);
  await page.mouse.click(at.x, at.y, options);
}

async function clickOn(page, locator, options = {}) {
  let box = await locator.boundingBox();
  /* Only what is off screen is scrolled to: any scroll closes the timeline's menu. */
  const { height } = page.viewportSize();
  if (!box || box.y < 0 || box.y + box.height > height) {
    await locator.scrollIntoViewIfNeeded();
    box = await locator.boundingBox();
  }
  await clickAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, options);
}

/* Press, move slowly by dx, and let go. */
async function slowDrag(page, from, dx, dy = 0, steps = 30) {
  await glide(page, from);
  await page.mouse.down();
  await pause(page, 300);
  for (let n = 1; n <= steps; n += 1) {
    await page.mouse.move(from.x + (dx * n) / steps, from.y + (dy * n) / steps);
    await pause(page, 35);
  }
  await pause(page, 300);
  await page.mouse.up();
}

/* ------------------------------------------------------------------ the page */

const bar = (page, id) => page.locator(`.hstrip-bar[data-id="${id}"]`);
const strip = (page) => page.locator('#habitatStrip');
const lanes = (page) => page.locator('#habitatStrip .hstrip-lanes');
const panel = (page) => page.locator('#obsPanel');
const videoTime = (page) => page.evaluate(() => window.MARP_VIDEO.time);
const drawnOf = (page, id) => page.evaluate((own) => window.MARP_VIDEO.drawn.find((d) => d.observation_id === own), id);
const middle = (r) => ({ x: (r.x ?? r.left) + r.width / 2, y: (r.y ?? r.top) + r.height / 2 });
const asRect = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
const CLOCK_READING = '2021-06-14T16:45:39.123';
const CLOCK_TIME = /\d\d:\d\d:\d\d\.\d{3}/;

/* A film that failed never reached its teardown, and its stretches would be drawn over the
   next one's: every habitat session a film seeded is removed before another is made. */
async function sweepEarlierFilms() {
  const client = await connect();
  try {
    const { rows } = await client.query('SELECT session_id FROM sessions WHERE line LIKE $1', [`${MARK}-habitat-%`]);
    for (const { session_id: id } of rows) {
      await client.query('DELETE FROM observations WHERE session_id = $1', [id]);
      await client.query('DELETE FROM sessions WHERE session_id = $1', [id]);
    }
  } finally {
    await client.end();
  }
}

/* A quiet video to film in: one Jellyfin can play, at least ten minutes long, with only a few observations and no
   habitat session of anybody's, so nothing but the film's own stretches is drawn as a habitat.
   The film's stretches start five minutes in, so the timeline can be slid both ways. */
async function filmVideo(page) {
  const client = await connect();
  let candidates;
  try {
    candidates = (await client.query(
      `SELECT min(o.observation_id) AS id FROM observations o JOIN sessions s ON s.session_id = o.session_id
        WHERE coalesce(o.video_source, '') <> ''
        GROUP BY o.video_source
       HAVING bool_and(s.type IS DISTINCT FROM 'Habitat') AND count(*) BETWEEN 3 AND 40
          -- Long enough for a film: something was recorded past ten minutes in.
          AND max(o."mediaPosition") >= '00:10:00'
        ORDER BY count(*) LIMIT 60`)).rows.map((row) => Number(row.id));
  } finally {
    await client.end();
  }
  const res = await page.request.post('/api/v2/mosaic/observations/video-context', { data: { observation_ids: candidates } });
  expect(res.ok(), `the video-context read was refused: ${res.status()}`).toBe(true);
  const video = (await res.json()).videos.find((entry) => entry.jellyfin_item_id);
  expect(video, 'none of the quiet videos is one Jellyfin has').toBeTruthy();
  const read = await (await page.request.post('/api/v2/mosaic/video/observations', {
    data: { observation_id: video.observations[0].observation_id, filters: {} }
  })).json();
  return { videoSource: read.video.video_source, at: 300 };
}

async function closePanel(page) {
  if (await panel(page).isVisible()) {
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toBeHidden();
  }
}

/* Set the video's clock from the frame on screen, as the GUI's Sync Time does. The panel's
   foot holds the button since #367, so the panel has to be open. */
async function setClock(page) {
  await page.locator('#setClock').click();
  await page.locator('#clockReading').fill(CLOCK_READING);
  const put = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/videos/clock') && r.request().method() === 'PUT');
  await page.locator('#clockForm button[type=submit]').click();
  expect((await put).ok(), 'the clock was not saved').toBe(true);
  await expect(page.locator('#clockNow')).toContainText('UTC');
}

/* Seed a habitat session in a video Jellyfin has, around the moment an observation there
   opens at, and open the page on its first stretch. Stretches are seconds from that moment.
   `clock` holds the video's clock so the teardown puts the video back as it was, and `'set'`
   also sets it, from the frame the page opens on. */
async function openHabitat(page, store, stretches, { keepPanel = false, clock = false } = {}) {
  await page.addInitScript(drawPointer);
  await sweepEarlierFilms();
  const { videoSource, at } = await filmVideo(page);
  // Before the seeding, so what is put back is only what was there.
  if (clock) store.clock = await holdVideoClock(videoSource);
  store.seeded = await seedHabitat({
    videoSource,
    stretches: stretches.map((s) => ({ ...s, start: at + s.start, end: at + s.end }))
  });
  store.ids = store.seeded.ids;
  await openAndPlay(page, store.ids[0]);
  if (clock === 'set') await setClock(page);
  if (!keepPanel) await closePanel(page);
  await page.mouse.move(40, 40);
  if (process.env.FILM_DEBUG) {
    const fs = await import('node:fs');
    await page.waitForTimeout(3000);
    fs.writeFileSync(process.env.FILM_DEBUG, JSON.stringify(await page.evaluate(async () => ({
      bars: [...document.querySelectorAll('.hstrip-bar')].map((e) => [e.dataset.id, e.className, e.getAttribute('style')]),
      time: window.MARP_VIDEO.time, paused: window.MARP_VIDEO.paused,
      churn: await new Promise((done) => { const seen = new Set(); let n = 0; const tick = () => { const e = document.querySelector('.hstrip-bar'); seen.add(e); if (++n < 20) setTimeout(tick, 50); else done(seen.size); }; tick(); }), timeText: document.querySelector('.marp-time') && document.querySelector('.marp-time').innerText,
      strip: document.querySelector('#habitatStrip') && document.querySelector('#habitatStrip').outerHTML.slice(0, 1500)
    })), null, 1) + JSON.stringify(store.ids));
  }
}

/* Load the page again, signed in to Jellyfin again if it asks, and wait for the box. */
async function reopen(page, id) {
  await page.reload();
  const form = page.locator('#signIn');
  const asked = await form.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
  if (asked) {
    await form.getByLabel('User').fill(process.env.JELLYFIN_USERNAME);
    await form.getByLabel('Password').fill(process.env.JELLYFIN_PASSWORD);
    await form.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect.poll(() => page.evaluate((own) => window.MARP_VIDEO && window.MARP_VIDEO.drawn.some((d) => d.observation_id === own), id),
    { timeout: 120_000 }).toBe(true);
}

async function teardown({ store }) {
  if (store.seeded) await store.seeded.remove();
  if (store.clock) await store.clock.restore();
}

/* Zoom the timeline in, centred on the middle of some bars, until together they fill about
   `share` of it: far enough apart to grab, and every end still on screen. */
async function zoomOn(page, ids, share = 0.55, { slow = false } = {}) {
  const trail = [];
  for (let n = 0; n < 60; n += 1) {
    const boxes = await page.evaluate((wanted) => wanted.map((id) => {
      const element = document.querySelector(`.hstrip-bar[data-id="${id}"]`);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }), [].concat(ids));
    if (boxes.some((b) => !b)) {
      const state = await page.evaluate(() => ({
        bars: [...document.querySelectorAll('.hstrip-bar')].map((e) => `${e.dataset.id} ${e.getAttribute('style')}`),
        time: window.MARP_VIDEO.time, hidden: document.querySelector('#habitatStrip').hidden,
        readout: document.querySelector('.marp-time').innerText
      }));
      throw new Error(`zooming lost a bar after ${n} turns of the wheel: ${JSON.stringify(state)} ${JSON.stringify(trail)}`);
    }
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    if (right - left >= share * (await lanes(page).boundingBox()).width) return;
    const to = { x: (left + right) / 2, y: boxes[0].y + boxes[0].height / 2 };
    trail.push([Math.round(to.x), Math.round(to.y), boxes.map((b) => [Math.round(b.x), Math.round(b.width)])]);
    /* The wheel holds the moment under the pointer still, so stretches near an edge are pushed
       off it as they spread: slide them back to the middle first. */
    const view = await lanes(page).boundingBox();
    if (n > 0 && (left < view.x + view.width * 0.15 || right > view.x + view.width * 0.85)) {
      const from = await emptyLanePoint(page, 0.5);
      const dx = view.x + view.width / 2 - to.x;
      if (slow) await slowDrag(page, from, dx, 0, 20);
      else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let step = 1; step <= 8; step += 1) await page.mouse.move(from.x + (dx * step) / 8, from.y);
        await page.mouse.up();
      }
      await pause(page, slow ? 300 : 80);
      continue;
    }
    if (slow) await glide(page, to, 6);
    else await page.mouse.move(to.x, to.y);
    await page.mouse.wheel(0, -150);
    await pause(page, slow ? 260 : 80);
  }
}

/* A point on the timeline with no bar under it, at the given share of its width. */
async function emptyLanePoint(page, share = 0.5) {
  return page.evaluate((along) => {
    const lanesEl = document.querySelector('#habitatStrip .hstrip-lanes');
    const r = lanesEl.getBoundingClientRect();
    for (let y = r.top + 2; y < r.bottom - 1; y += 2) {
      for (const dx of [0, 40, -40, 80, -80, 120, -120]) {
        const x = r.left + r.width * along + dx;
        const hit = document.elementFromPoint(x, y);
        if (hit && lanesEl.contains(hit) && !hit.closest('.hstrip-bar')) return { x, y };
      }
    }
    return null;
  }, share);
}

/* The session's stretches as the record has them: name, start and end in whole seconds from
   the earliest one. */
async function stretchesOf(page, id) {
  const read = await (await page.request.post('/api/v2/mosaic/video/observations', { data: { observation_id: id, filters: {} } })).json();
  const stretches = (read.habitat && read.habitat.stretches) || [];
  const origin = Math.min(...stretches.map((s) => s.start_s));
  return stretches.map((s) => [s.comname, Math.round(s.start_s - origin), Math.round(s.end_s - origin)])
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
}

/* The video's length in seconds, read off the player's own time readout. */
async function videoLength(page) {
  const text = await page.locator('.marp-time').innerText();
  const parts = text.split('/')[1].trim().split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/* Where the player's controls are when shown: a pointer over them keeps them from fading. */
async function showControls(page) {
  const bar = await page.locator('.marp-controls-bar').boundingBox();
  await glide(page, { x: bar.x + bar.width * 0.5, y: bar.y + bar.height - 8 }, 10);
}

/* The colour of the overlay's pixel at a point, as #rrggbb. */
const pixelAt = (page, at) => page.evaluate(({ x, y }) => {
  const canvas = document.getElementById('boxes');
  const r = canvas.getBoundingClientRect();
  const px = canvas.getContext('2d').getImageData(Math.round((x - r.left) * (canvas.width / r.width)),
    Math.round((y - r.top) * (canvas.height / r.height)), 1, 1).data;
  return `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}, at);

const near = (a, b, within = 40) => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) <= within);
};

/* ------------------------------------------------------------------ the films */

export const videoScenarios = {
  'issue-351': {
    title: 'Issue 351: the clock to the frame',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 60, substrate: 'Rock' }], { keepPanel: true, clock: 'hold' });
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 351: the clock only showed whole seconds',
        say: `Issue three fifty-one. Each video has a clock: you set it from a frame showing the time burnt into the picture, and from then on every frame has a real time. The page only showed that time to the whole second, so you could not tell one frame from the next.`,
        async act({ page }) {
          await ring(page, page.locator('#clockState'), 7000);
        }
      },
      {
        caption: 'Setting the clock from this frame',
        say: `I set the clock from this frame. I type the time shown in the picture, with its milliseconds … and save.`,
        async act({ page }) {
          await clickOn(page, page.locator('#setClock'));
          await expect(page.locator('#clockForm')).toBeVisible();
          await pause(page, 1200);
          await page.locator('#clockReading').fill(CLOCK_READING);
          await ring(page, page.locator('#clockForm'), 2500);
          await pause(page, 2600);
          const put = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/videos/clock') && r.request().method() === 'PUT');
          await clickOn(page, page.locator('#clockForm button[type=submit]'));
          expect((await put).ok()).toBe(true);
        }
      },
      {
        caption: 'The clock time, to the millisecond',
        say: `Next to the play time, the controls now show this frame's clock time, to the millisecond: sixteen forty-five, thirty-nine point one two three.`,
        async act({ page, store }) {
          await expect(page.locator('#clockNow')).toContainText('16:45:39.123');
          store.reading = await page.locator('#clockNow').textContent();
          await showControls(page);
          await ring(page, page.locator('#clockNow'), 6000);
        }
      },
      {
        caption: 'One frame forward: 40 ms later',
        say: `Watch it as I step forward one frame … it reads forty milliseconds later. One frame, exactly.`,
        async act({ page }) {
          await clickOn(page, page.locator('.marp-step-forward'));
          await expect(page.locator('#clockNow')).toContainText('16:45:39.163');
          await ring(page, page.locator('#clockNow'), 4000);
        }
      },
      {
        caption: 'And one frame back',
        say: `And one frame back … to where it was.`,
        async act({ page }) {
          await clickOn(page, page.locator('.marp-step-back'));
          await expect(page.locator('#clockNow')).toContainText('16:45:39.123');
          await ring(page, page.locator('#clockNow'), 2500);
        }
      }
    ]
  },

  'issue-352': {
    title: 'Issue 352: overlapping habitat labels',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 60, substrate: 'Rock' },
        { start: 0, end: 60, substrate: 'Sand' },
        { start: 0, end: 60, substrate: 'Cobble' }
      ]);
      await expect.poll(async () => (await Promise.all(store.ids.map((id) => drawnOf(page, id)))).every(Boolean)).toBe(true);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 352: labels hid each other',
        say: `Issue three fifty-two. A habitat box always covers the bottom half of the picture, so when two or three habitats are recorded at the same moment their boxes are in exactly the same place. Their labels were drawn on top of one another, and only the last could be read.`,
        async act({ page, store }) {
          await ring(page, asRect((await drawnOf(page, store.ids[0])).rect), 8000);
        }
      },
      {
        caption: 'Now side by side, in a fixed order',
        say: `Now the labels sit side by side, packed together, always in the same order: cobble, then sand, then rock. Every one can be read.`,
        async act({ page, store }) {
          const tabs = await Promise.all(store.ids.map(async (id) => (await drawnOf(page, id)).tabs[0]));
          const [rock, sand, cobble] = tabs;
          expect(cobble.left + cobble.width).toBeLessThanOrEqual(sand.left + 1);
          expect(sand.left + sand.width).toBeLessThanOrEqual(rock.left + 1);
          const left = cobble.left;
          const right = rock.left + rock.width;
          await ring(page, { x: left, y: cobble.top, width: right - left, height: cobble.height }, 6000);
        }
      },
      {
        caption: 'Clicking a label picks its own box',
        say: `And each label can be clicked to pick its own box … here, the Sand.`,
        async act({ page, store }) {
          const sand = (await drawnOf(page, store.ids[1])).tabs[0];
          await clickAt(page, middle(asRect(sand)));
          await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.selected)).toBe(`${store.ids[1]}_1`);
          await expect(panel(page).locator('.panel-name')).toHaveText('Sand');
          await glide(page, { x: 600, y: 200 }, 10);
          await ring(page, panel(page).locator('.annotate-head'), 3000);
        }
      }
    ]
  },

  'issue-353': {
    title: 'Issue 353: a habitat timeline like the GUI\'s',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 40, substrate: 'Rock' },
        { start: 50, end: 90, substrate: 'Sand' }
      ], { keepPanel: true });
      await zoomOn(page, store.ids, 0.5);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 353: a habitat timeline, as in the GUI',
        say: `Issue three fifty-three. The annotation program shows a habitat session as a timeline: a lane for each kind of habitat, a bar for each stretch, and you can see which stretches have been reviewed. The video page had nothing like it. Now it does, just above the scrub bar.`,
        async act({ page }) {
          await expect(strip(page)).toBeVisible();
          await ring(page, strip(page), 9000);
        }
      },
      {
        caption: 'Not reviewed: an outline',
        say: `A stretch nobody has reviewed yet is drawn as an outline. This is the Rock stretch the page opened on.`,
        async act({ page, store }) {
          await expect(bar(page, store.ids[0])).toHaveClass(/unreviewed/);
          await ring(page, bar(page, store.ids[0]), 4000);
        }
      },
      {
        caption: 'Mark reviewed: the bar fills in',
        say: `I mark the Rock reviewed in its panel … and its bar fills in, solid.`,
        async act({ page, store }) {
          const done = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
          await clickOn(page, panel(page).locator('button[data-review="reviewed"]'));
          expect((await done).ok()).toBe(true);
          await expect(bar(page, store.ids[0])).toHaveClass(/(^|\s)reviewed(\s|$)/);
          await ring(page, bar(page, store.ids[0]), 3500);
        }
      },
      {
        caption: 'Flagged: striped',
        say: `Now I click the Sand on the timeline to pick it, and flag it as wrong … a flagged stretch is striped.`,
        async act({ page, store }) {
          await clickOn(page, bar(page, store.ids[1]));
          await expect(panel(page).locator('.panel-name')).toHaveText('Sand');
          await pause(page, 800);
          const flag = panel(page).locator('select[data-review="flag"]');
          const reason = await flag.locator('option').nth(1).getAttribute('value');
          const done = page.waitForResponse((r) => r.url().endsWith('/mosaic/observations/review'));
          await glide(page, middle(await flag.boundingBox()));
          await flag.selectOption(reason);
          expect((await done).ok()).toBe(true);
          await expect(bar(page, store.ids[1])).toHaveClass(/flagged/);
          await page.mouse.move(40, 40);
          await ring(page, bar(page, store.ids[1]), 3500);
        }
      },
      {
        caption: 'Right-click: Go to start, Go to end',
        say: `Right-clicking a bar offers Go to start and Go to end. I choose Go to end, and the video goes to the Sand stretch's last frame.`,
        async act({ page, store }) {
          const sand = await bar(page, store.ids[1]).boundingBox();
          // Near its left end: the menu opens to the right of the pointer, and the observation
          // panel is drawn over the timeline's menu where the two meet.
          await clickAt(page, { x: sand.x + 8, y: sand.y + sand.height / 2 }, { button: 'right' });
          const item = page.locator('.hstrip-menu button', { hasText: 'Go to end' });
          await expect(item).toBeVisible();
          /* The pointer rests on the item while the menu is shown: the timeline is in the
             player's controls, which fade when the pointer is still anywhere else. */
          const at = middle(await item.boundingBox());
          await glide(page, at, 10);
          await ring(page, page.locator('.hstrip-menu'), 2500);
          await pause(page, 2600);
          await expect(item).toBeVisible();
          expect(await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) || {}).textContent, at),
            'something covers the menu item').toBe('Go to end');
          await page.mouse.click(at.x, at.y);
          const read = await stretchesOf(page, store.ids[0]);
          expect(read.length).toBe(2);
          // The playhead is at the Sand's right-hand end.
          await expect.poll(async () => {
            const head = await page.locator('.hstrip-playhead').boundingBox();
            const end = await bar(page, store.ids[1]).boundingBox();
            return Math.abs(head.x - (end.x + end.width));
          }, { timeout: 30_000 }).toBeLessThan(4).catch(async (error) => {
            const sandEnd = (await (await page.request.post('/api/v2/mosaic/video/observations', { data: { observation_id: store.ids[0], filters: {} } })).json())
              .habitat.stretches.find((x) => x.observation_id === store.ids[1]);
            throw new Error(`${error.message}
video at ${await videoTime(page)}, paused ${await page.evaluate(() => window.MARP_VIDEO.paused)}; `
              + `Sand ${JSON.stringify(sandEnd && { start: sandEnd.start_s, end: sandEnd.end_s })}; `
              + `head ${JSON.stringify(await page.locator('.hstrip-playhead').boundingBox())} bar ${JSON.stringify(await bar(page, store.ids[1]).boundingBox())}; `
              + `menu ${await page.locator('.hstrip-menu').isVisible()}`);
          });
          await ring(page, page.locator('.hstrip-playhead'), 2500);
        }
      },
      {
        caption: 'Deleting a stretch takes it off the timeline',
        say: `And deleting a stretch takes its bar off the timeline at once. I delete the Sand … and its bar is gone.`,
        async act({ page, store }) {
          page.once('dialog', (dialog) => dialog.accept());
          await clickOn(page, panel(page).locator('[data-action="remove"]'));
          await expect(bar(page, store.ids[1])).toHaveCount(0);
          await expect(page.locator('#inspectStatus')).toContainText('deleted');
          await ring(page, lanes(page), 3000);
        }
      }
    ]
  },

  'issue-354': {
    title: 'Issue 354: zooming the habitat timeline',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 40, substrate: 'Rock' },
        { start: 50, end: 80, substrate: 'Sand' },
        { start: 90, end: 120, substrate: 'Cobble' }
      ]);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 354: stretches too small to grab',
        say: `Issue three fifty-four. On a long video the timeline squeezes every stretch into a sliver, much too small to see or grab. These three stretches are two minutes of a twenty-five minute video.`,
        async act({ page, store }) {
          await ring(page, bar(page, store.ids[0]), 7000);
        }
      },
      {
        caption: 'Mouse wheel over the timeline: zoom in',
        say: `Rolling the mouse wheel over the timeline zooms in, around the pointer … and the stretches spread out.`,
        async act({ page, store }) {
          store.before = (await bar(page, store.ids[0]).boundingBox()).width;
          await zoomOn(page, store.ids, 0.6, { slow: true });
          expect((await bar(page, store.ids[0]).boundingBox()).width).toBeGreaterThan(store.before * 8);
        }
      },
      {
        caption: 'The thin band: where you are in the video',
        say: `While zoomed in, a thin band across the top of the timeline shows which part of the whole video you are looking at.`,
        async act({ page }) {
          await expect(page.locator('.hstrip-overview')).toBeVisible();
          await ring(page, page.locator('.hstrip-overview'), 5000);
        }
      },
      {
        caption: 'Drag an empty part: move along',
        say: `Dragging an empty part of the timeline slides it along … like this.`,
        async act({ page, store }) {
          const before = (await bar(page, store.ids[0]).boundingBox()).x;
          const from = await emptyLanePoint(page, 0.4);
          expect(from).toBeTruthy();
          await slowDrag(page, from, 220);
          await expect.poll(async () => (await bar(page, store.ids[0]).boundingBox()).x - before).toBeGreaterThan(150);
        }
      },
      {
        caption: 'Double-click: the whole video again',
        say: `And a double-click on an empty part shows the whole video again.`,
        async act({ page }) {
          const at = await emptyLanePoint(page, 0.15);
          await glide(page, at);
          await pause(page, 400);
          await page.mouse.dblclick(at.x, at.y);
          await expect(page.locator('.hstrip-overview')).toBeHidden();
          await ring(page, strip(page), 2500);
        }
      }
    ]
  },

  'issue-355': {
    title: 'Issue 355: dragging a stretch\'s end must not move the video',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 40, substrate: 'Rock' },
        { start: 70, end: 110, substrate: 'Sand' }
      ]);
      await zoomOn(page, store.ids);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 355: dragging an end moved the video',
        say: `Issue three fifty-five. On the habitat timeline you can drag the end of a stretch to change where it stops. Before the fix, letting go of the end also jumped the video to that point, so you lost your place in the video.`,
        async act({ page, expect: check }) {
          await check(strip(page)).toBeVisible();
          await ring(page, strip(page), 7000);
        }
      },
      {
        caption: 'Note where the video is',
        say: `First, note where the video is now. The white line on the timeline is the playhead, and the time readout under the video says the same thing.`,
        async act({ page, store }) {
          store.before = await videoTime(page);
          await ringEach(page, [page.locator('.hstrip-playhead'), page.locator('.marp-time')], 3000);
        }
      },
      {
        caption: 'Dragging the end of the Rock stretch',
        say: `Now I drag the right-hand end of the Rock stretch further to the right … and let go.`,
        async act({ page, store }) {
          const rock = await bar(page, store.ids[0]).boundingBox();
          store.width = rock.width;
          const saved = page.waitForResponse((r) => r.url().endsWith('/times') && r.request().method() === 'PUT');
          await pause(page, 2200);
          await slowDrag(page, { x: rock.x + rock.width - 2, y: rock.y + rock.height / 2 }, 120);
          expect((await saved).ok(), 'the new end was not saved').toBe(true);
        }
      },
      {
        caption: 'The stretch is longer; the video has not moved',
        say: `The Rock stretch is longer, and it was saved. And look at the video: it is exactly where it was. The playhead did not follow the drag.`,
        async act({ page, store }) {
          await expect.poll(async () => (await bar(page, store.ids[0]).boundingBox()).width).toBeGreaterThan(store.width + 60);
          expect(Math.abs((await videoTime(page)) - store.before)).toBeLessThan(0.05);
          await ringEach(page, [bar(page, store.ids[0]), page.locator('.marp-time')], 3000);
        }
      }
    ]
  },

  'issue-356': {
    title: 'Issue 356: a box over the scrub bar took its clicks',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 90, substrate: 'Rock' }]);
      store.length = await videoLength(page);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 356: the scrub bar under a box',
        say: `Issue three fifty-six. A habitat box covers the whole bottom half of the picture, and the scrub bar sits on top of it. A click on the scrub bar went to the box underneath instead, so you could not move through the video by clicking.`,
        async act({ page, store }) {
          await ring(page, asRect((await drawnOf(page, store.ids[0])).rect), 4500);
          await pause(page, 4800);
          await showControls(page);
          await ring(page, page.locator('.marp-scrub-track'), 4000);
        }
      },
      {
        caption: 'Clicking the scrub bar, over the box',
        say: `Now I click the scrub bar, half a minute further on … and the video goes there.`,
        async act({ page, store }) {
          store.edits = 0;
          page.on('request', (r) => { if (/\/mosaic\/video\/keyframe(\/|$)/.test(new URL(r.url()).pathname) && r.method() !== 'GET') store.edits += 1; });
          store.before = await videoTime(page);
          const track = await page.locator('.marp-scrub-track').boundingBox();
          const target = store.before + 30;
          await clickAt(page, { x: track.x + track.width * (target / store.length), y: track.y + track.height / 2 });
          await expect.poll(() => videoTime(page), { timeout: 20_000 }).toBeGreaterThan(store.before + 20);
          await ring(page, page.locator('.marp-time'), 3000);
        }
      },
      {
        caption: 'The box was not touched',
        say: `The box underneath was not picked up or moved, and nothing was saved. The click belonged to the scrub bar.`,
        async act({ page, store }) {
          expect(store.edits).toBe(0);
          await ring(page, asRect((await drawnOf(page, store.ids[0])).rect), 4000);
        }
      }
    ]
  },

  'issue-357': {
    title: 'Issue 357: a new stretch appears on the timeline at once',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 60, substrate: 'Rock' }]);
      await zoomOn(page, store.ids, 0.35);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 357: a new stretch did not appear',
        say: `Issue three fifty-seven. A habitat added on the video page was saved, but its bar did not appear on the timeline until the page was reloaded. The lanes were also thicker than they needed to be.`,
        async act({ page }) {
          await ring(page, strip(page), 7000);
        }
      },
      {
        caption: 'Adding Sand at this frame',
        say: `I draw a box on the picture and choose Sand from the list …`,
        async act({ page, store }) {
          const added = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/mosaic/video/observation') && r.request().method() === 'POST');
          await slowDrag(page, { x: 160, y: 130 }, 120, 70, 20);
          const popup = page.locator('#addPopup');
          await expect(popup).toBeVisible();
          await pause(page, 600);
          await page.keyboard.type('Sand', { delay: 180 });
          await expect(popup.locator('.annotate-species .name').first()).toHaveText('Sand');
          await pause(page, 900);
          await page.keyboard.press('Enter');
          store.added = (await (await added).json()).observation.observation_id;
        }
      },
      {
        caption: 'Its bar is there at once',
        say: `and its bar is on the timeline straight away, in the Sand lane, starting at this frame.`,
        async act({ page, store }) {
          await expect(bar(page, store.added)).toBeVisible();
          await page.mouse.move(40, 40);
          await ring(page, bar(page, store.added), 4500);
        }
      },
      {
        caption: 'Thin lanes, in the GUI\'s order',
        say: `The lanes are thinner now, eight pixels each, and there are five, as in the annotation program: cobble, boulder, sand and mud, rock, and the stop and pull markers.`,
        async act({ page }) {
          expect(await lanes(page).evaluate((e) => getComputedStyle(e).getPropertyValue('--rows').trim())).toBe('5');
          await ring(page, lanes(page), 6000);
        }
      }
    ]
  },

  'issue-358': {
    title: 'Issue 358: the habitats on screen, listed on the left',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 60, substrate: 'Rock' },
        { start: 20, end: 60, substrate: 'Sand' }
      ]);
      await zoomOn(page, store.ids, 0.4);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 358: which habitats are on screen?',
        say: `Issue three fifty-eight. The annotation program lists the habitats of the moment down the left of the picture, each in its own colour, so you can always see what the video is in. The video page had no such list.`,
        async act({ page }) {
          await expect(page.locator('#habitatNow')).toBeVisible();
          await ring(page, page.locator('#habitatNow'), 7000);
        }
      },
      {
        caption: 'At the start: only Rock',
        say: `Here, at the start of the Rock stretch, it lists Rock alone.`,
        async act({ page }) {
          await expect(page.locator('#habitatNow .habitat-now-item')).toHaveText(['Rock']);
          await ring(page, page.locator('#habitatNow'), 3500);
        }
      },
      {
        caption: 'Into the stretch where Sand starts',
        say: `Now I click on the timeline where the Sand begins … and the list shows both habitats.`,
        async act({ page, store }) {
          const sand = await bar(page, store.ids[1]).boundingBox();
          await clickAt(page, { x: sand.x + sand.width * 0.25, y: sand.y + sand.height / 2 });
          await expect(page.locator('#habitatNow .habitat-now-item')).toHaveCount(2);
          await expect(page.locator('#habitatNow')).toContainText('Sand');
          await closePanel(page);
          await page.mouse.move(500, 200);
          await ring(page, page.locator('#habitatNow'), 4500);
        }
      }
    ]
  },

  'issue-359': {
    title: 'Issue 359: a habitat box cannot be moved or resized',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 60, substrate: 'Rock' }]);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 359: habitat boxes could be dragged',
        say: `Issue three fifty-nine. A habitat box always covers the bottom half of the picture: that is how the annotation program records a habitat. On the video page it could be dragged or resized like any other box, which only makes a mess of it.`,
        async act({ page, store }) {
          await ring(page, asRect((await drawnOf(page, store.ids[0])).rect), 8000);
        }
      },
      {
        caption: 'Selected: no resize handles',
        say: `I click it to select it. There are no resize handles on its corners.`,
        async act({ page, store }) {
          const box = (await drawnOf(page, store.ids[0])).rect;
          await clickAt(page, { x: box.left + box.width * 0.5, y: box.top + box.height * 0.3 });
          await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.selected)).toBe(`${store.ids[0]}_1`);
          await closePanel(page);
          await ring(page, asRect(box), 3500);
        }
      },
      {
        caption: 'Dragging it: nothing moves',
        say: `And when I try to drag it up and to the left … nothing moves, and nothing is saved.`,
        async act({ page, store }) {
          let edits = 0;
          page.on('request', (r) => { if (/\/mosaic\/video\/keyframe(\/|$)/.test(new URL(r.url()).pathname) && r.method() !== 'GET') edits += 1; });
          const before = (await drawnOf(page, store.ids[0])).rect;
          await slowDrag(page, { x: before.left + before.width * 0.5, y: before.top + before.height * 0.3 }, -180, -90);
          await pause(page, 600);
          const after = (await drawnOf(page, store.ids[0])).rect;
          expect(after).toEqual(before);
          expect(edits).toBe(0);
          await ring(page, asRect(after), 3500);
        }
      }
    ]
  },

  'issue-360': {
    title: 'Issue 360: cut one habitat stretch with another',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 120, substrate: 'Rock' },
        { start: 40, end: 60, substrate: 'Sand' }
      ]);
      await zoomOn(page, store.ids, 0.7);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 360: cut one stretch with another',
        say: `Issue three sixty. In the annotation program you can cut one habitat stretch with another: the part of the first one that the second covers is taken out. Here a short Sand stretch sits in the middle of a long Rock stretch.`,
        async act({ page, store }) {
          await ringEach(page, [bar(page, store.ids[0]), bar(page, store.ids[1])], 3800);
        }
      },
      {
        caption: '1. Click the Sand: the cutter',
        say: `First I click the Sand stretch, the one that does the cutting.`,
        async act({ page, store }) {
          await clickOn(page, bar(page, store.ids[1]));
          await expect(bar(page, store.ids[1])).toHaveClass(/selected/);
        }
      },
      {
        caption: '2. Control-click the Rock: the one to cut',
        say: `Then I hold Control and click the Rock, the one to be cut. It gets a dashed outline.`,
        async act({ page, store }) {
          const rock = await bar(page, store.ids[0]).boundingBox();
          const at = { x: rock.x + rock.width * 0.15, y: rock.y + rock.height / 2 };
          store.onRock = at;
          await glide(page, at);
          await pause(page, 500);
          await page.keyboard.down('Control');
          await page.mouse.click(at.x, at.y);
          await page.keyboard.up('Control');
          await expect(bar(page, store.ids[0])).toHaveClass(/second/);
          await ring(page, bar(page, store.ids[0]), 3000);
        }
      },
      {
        caption: '3. Right-click the Rock, choose Cut',
        say: `Now I right-click the Rock, and choose Cut Rock with Sand …`,
        async act({ page, store }) {
          await clickAt(page, store.onRock, { button: 'right' });
          const item = page.locator('.hstrip-menu button', { hasText: /^Cut / });
          await expect(item).toBeVisible();
          await ring(page, page.locator('.hstrip-menu'), 2500);
          await pause(page, 2600);
          const cut = page.waitForResponse((r) => r.url().endsWith('/cut'));
          await clickOn(page, item);
          expect((await cut).ok(), 'the cut was refused').toBe(true);
        }
      },
      {
        caption: 'The Rock is split around the Sand',
        say: `The Rock is now two stretches: one up to where the Sand starts, and a new one from where the Sand ends. The Sand itself is untouched.`,
        async act({ page, store }) {
          await expect.poll(() => stretchesOf(page, store.ids[0])).toEqual([['Rock', 0, 40], ['Sand', 40, 60], ['Rock', 60, 120]]);
          await expect(page.locator('.hstrip-bar')).toHaveCount(3);
          await page.mouse.move(40, 40);
          await ring(page, lanes(page), 6000);
        }
      }
    ]
  },

  'issue-361': {
    title: 'Issue 361: habitat labels in their habitat\'s colour',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 60, substrate: 'Rock' },
        { start: 0, end: 60, substrate: 'Sand' }
      ]);
      await zoomOn(page, store.ids, 0.4);
      await page.mouse.move(40, 40);
      await expect.poll(async () => Boolean(await drawnOf(page, store.ids[1]))).toBe(true);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 361: labels all one colour',
        say: `Issue three sixty-one. The labels on habitat boxes were all drawn in the same colour, so they did not match the colours used on the timeline and in the list. Now each label is drawn in its own habitat's colour.`,
        async act({ page, store }) {
          const rock = (await drawnOf(page, store.ids[0])).tabs[0];
          const sand = (await drawnOf(page, store.ids[1])).tabs[0];
          const left = Math.min(rock.left, sand.left);
          await ring(page, { x: left, y: rock.top, width: Math.max(rock.left + rock.width, sand.left + sand.width) - left, height: rock.height }, 8000);
        }
      },
      {
        caption: 'Rock: brown, everywhere',
        say: `The Rock label is brown, the same brown as the Rock bar on the timeline, and as Rock in the list on the left.`,
        async act({ page, store }) {
          const tab = (await drawnOf(page, store.ids[0])).tabs[0];
          expect(near(await pixelAt(page, { x: tab.left + 3, y: tab.top + tab.height / 2 }), '#8b5a2b')).toBe(true);
          await ringEach(page, [asRect(tab), bar(page, store.ids[0]), page.locator('#habitatNow .habitat-now-item', { hasText: 'Rock' })], 2300);
        }
      },
      {
        caption: 'Sand: yellow, everywhere',
        say: `And the Sand label is yellow, matching the Sand bar and the Sand in the list.`,
        async act({ page, store }) {
          const tab = (await drawnOf(page, store.ids[1])).tabs[0];
          expect(near(await pixelAt(page, { x: tab.left + 3, y: tab.top + tab.height / 2 }), '#f2d45c')).toBe(true);
          await ringEach(page, [asRect(tab), bar(page, store.ids[1]), page.locator('#habitatNow .habitat-now-item', { hasText: 'Sand' })], 2300);
        }
      }
    ]
  },

  'issue-362': {
    title: 'Issue 362: the timeline above the scrub bar',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 40, substrate: 'Rock' },
        { start: 60, end: 100, substrate: 'Sand' }
      ]);
      await zoomOn(page, store.ids, 0.5);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 362: the timeline was below the controls',
        say: `Issue three sixty-two. In the annotation program the habitat timeline sits just above the scrub bar. On the video page it was below the player's controls, at the very bottom of the page.`,
        async act({ page }) {
          await ring(page, strip(page), 7000);
        }
      },
      {
        caption: 'Now just above the scrub bar',
        say: `Now it sits just above the scrub bar, inside the player's controls, so the two line up, and they show and hide together.`,
        async act({ page }) {
          await showControls(page);
          const timeline = await strip(page).boundingBox();
          const track = await page.locator('.marp-scrub-track').boundingBox();
          expect(timeline.y + timeline.height).toBeLessThanOrEqual(track.y + 2);
          expect(await strip(page).evaluate((e) => Boolean(e.closest('.marp-controls-bar')))).toBe(true);
          await ringEach(page, [strip(page), page.locator('.marp-scrub-track')], 3000);
        }
      }
    ]
  },

  'issue-363': {
    title: 'Issue 363: a merge refused as changed',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 30, substrate: 'Sand' },
        { start: 60, end: 90, substrate: 'Rock' }
      ]);
      await zoomOn(page, store.ids, 0.6);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 363: a merge was refused',
        say: `Issue three sixty-three. Dragging a stretch's end into another stretch of the same habitat merges the two. But a stretch that had been added and ended on this page could not be merged: the page said it had changed since it was read, though nobody else had touched it.`,
        async act({ page }) {
          await ring(page, lanes(page), 9000);
        }
      },
      {
        caption: '1. Add a Rock stretch on the picture',
        say: `So, as you did: I add a Rock stretch here, by drawing a box and choosing Rock.`,
        async act({ page, store }) {
          const added = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/mosaic/video/observation') && r.request().method() === 'POST');
          await slowDrag(page, { x: 160, y: 130 }, 120, 70, 20);
          await expect(page.locator('#addPopup')).toBeVisible();
          await pause(page, 500);
          await page.keyboard.type('Rock', { delay: 180 });
          await expect(page.locator('#addPopup .annotate-species .name').first()).toHaveText('Rock');
          await pause(page, 700);
          await page.keyboard.press('Enter');
          store.added = (await (await added).json()).observation.observation_id;
          await expect(bar(page, store.added)).toBeVisible();
          await closePanel(page);
          await page.mouse.move(40, 40);
          await ring(page, bar(page, store.added), 2500);
        }
      },
      {
        caption: '2. Set its end on the picture',
        say: `Then I move on twenty seconds, right-click its label on the picture, and set its end there.`,
        async act({ page, store }) {
          const sand = await bar(page, store.ids[0]).boundingBox();
          await clickAt(page, { x: sand.x + sand.width * 0.66, y: sand.y + sand.height / 2 });
          await closePanel(page);
          await expect.poll(async () => Boolean(await drawnOf(page, store.added))).toBe(true);
          const tab = (await drawnOf(page, store.added)).tabs[0];
          await clickAt(page, middle(asRect(tab)), { button: 'right' });
          const end = page.locator('#boxMenu button[data-action="end"]');
          await expect(end).toBeVisible();
          await ring(page, page.locator('#boxMenu'), 2000);
          await pause(page, 2100);
          const saved = page.waitForResponse((r) => /\/mosaic\/video\/keyframe/.test(r.url()) && r.request().method() !== 'GET');
          await clickOn(page, end);
          expect((await saved).ok()).toBe(true);
          await closePanel(page);
        }
      },
      {
        caption: '3. Drag its end into the next Rock',
        say: `Now I drag its end on the timeline right into the next Rock stretch. The page asks whether to merge them, and I say yes.`,
        async act({ page, store }) {
          await page.mouse.move(40, 40);
          const first = await bar(page, store.added).boundingBox();
          const second = await bar(page, store.ids[1]).boundingBox();
          page.once('dialog', (dialog) => dialog.accept());
          const seen = [];
          const note = (r) => { if (r.request().method() !== 'GET') seen.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); };
          page.on('response', note);
          // A merge on the timeline is the end's own save, answered with what it absorbed.
          const merged = page.waitForResponse((r) => r.url().endsWith('/times') && r.request().method() === 'PUT', { timeout: 20_000 });
          await slowDrag(page, { x: first.x + first.width - 2, y: first.y + first.height / 2 },
            second.x + second.width * 0.3 - (first.x + first.width));
          store.answer = await merged.catch(async () => {
            throw new Error(`the new end was never saved. Bars: ${JSON.stringify({ first, second })}; requests: ${JSON.stringify(seen)}; `
              + `status: ${await page.locator('#inspectStatus').textContent()}`);
          });
        }
      },
      {
        caption: 'Merged: one Rock stretch',
        say: `This time it goes through. The two are one Rock stretch, from where I added it to the end of the next one.`,
        async act({ page, store }) {
          expect(store.answer.ok(), `the merge was refused: ${store.answer.status()} ${await store.answer.text()}`).toBe(true);
          await expect(page.locator('#inspectStatus')).toContainText('merged into it');
          const rocks = page.locator(`.hstrip-bar:not([data-id="${store.ids[0]}"])`);
          await expect(rocks).toHaveCount(1);
          await page.mouse.move(40, 40);
          await ring(page, rocks, 4500);
        }
      }
    ]
  },

  'issue-364': {
    title: 'Issue 364: the observation panel can be moved',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 60, substrate: 'Rock' }], { keepPanel: true });
      await page.evaluate(() => { try { localStorage.removeItem('marp-video-panel-place'); } catch { /* none */ } });
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 364: the panel was fixed in place',
        say: `Issue three sixty-four. The observation panel sat fixed in the top right corner, over the picture. It is meant to be movable, so you can put it wherever it is out of the way.`,
        async act({ page }) {
          await ring(page, panel(page), 7000);
        }
      },
      {
        caption: 'Drag it by its title',
        say: `I drag it by its title … over to the left.`,
        async act({ page, store }) {
          store.before = await panel(page).boundingBox();
          const title = await panel(page).locator('.annotate-head strong').boundingBox();
          await slowDrag(page, { x: title.x + 10, y: title.y + title.height / 2 }, -560, 30, 40);
          const after = await panel(page).boundingBox();
          expect(Math.round(store.before.x - after.x)).toBeGreaterThan(500);
        }
      },
      {
        caption: 'It stays, and opens there next time',
        say: `It stays where I put it, and the page remembers the place, so the panel opens there next time too.`,
        async act({ page }) {
          expect(await page.evaluate(() => localStorage.getItem('marp-video-panel-place'))).toBeTruthy();
          await page.mouse.move(900, 120);
          await ring(page, panel(page), 4500);
        }
      }
    ]
  },

  'issue-365': {
    title: 'Issue 365: keyframes listed by clock time',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 60, substrate: 'Rock' }], { keepPanel: true, clock: 'set' });
      /* A clock just set does not redraw the panel, so its keyframes stay positions until the
         page is opened again: reopened here, out of the film. */
      await reopen(page, store.ids[0]);
      await expect(panel(page)).toBeVisible();
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 365: keyframes were listed in seconds',
        say: `Issue three sixty-five. The panel lists the stretch's keyframes, its start and its end. Each was given as seconds into the video, such as three hundred and seventy-four seconds, which is not how anyone thinks about a dive.`,
        async act({ page }) {
          await ring(page, panel(page).locator('.panel-keyframes'), 8000);
        }
      },
      {
        caption: 'Now: the clock time of each',
        say: `With the video's clock set, each keyframe is listed by its clock time, to the millisecond. This is when the Rock starts, and this is when it ends.`,
        async act({ page }) {
          const items = panel(page).locator('.panel-keyframes li');
          await expect(items).toHaveCount(2);
          // A clock time carries its zone; a position in the video does not.
          await expect(items.nth(0)).toContainText(/\d\d:\d\d:\d\d\.\d{3} UTC/);
          await expect(items.nth(1)).toContainText(/\d\d:\d\d:\d\d\.\d{3} UTC/);
          await ringEach(page, [items.nth(0), items.nth(1)], 3000);
        }
      }
    ]
  },

  'issue-366': {
    title: 'Issue 366: messages give clock time',
    async setup({ page, store }) {
      await openHabitat(page, store, [
        { start: 0, end: 40, substrate: 'Rock' },
        { start: 70, end: 110, substrate: 'Sand' }
      ], { clock: 'set' });
      /* Setting the clock rewrites every observation in the video, and the page goes on
         holding the versions it read before, so its next save of a stretch is refused as
         changed. Reopened here, out of the film, so this film shows the message it is about. */
      await reopen(page, store.ids[0]);
      await closePanel(page);
      await zoomOn(page, store.ids);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 366: messages gave seconds into the video',
        say: `Issue three sixty-six. When you change something, the page says what it did, at the bottom left. Those messages gave times as seconds into the video. They now give the clock time.`,
        async act({ page }) {
          await ring(page, strip(page), 6000);
        }
      },
      {
        caption: 'Dragging the Rock\'s end',
        say: `I drag the end of the Rock stretch a little further …`,
        async act({ page, store }) {
          const rock = await bar(page, store.ids[0]).boundingBox();
          const saved = page.waitForResponse((r) => r.url().endsWith('/times') && r.request().method() === 'PUT');
          await slowDrag(page, { x: rock.x + rock.width - 2, y: rock.y + rock.height / 2 }, 90);
          const answer = await saved;
          expect(answer.ok(), `the new end was refused: ${answer.status()} ${await answer.text()} -- ${await page.locator('#inspectStatus').textContent()}`).toBe(true);
        }
      },
      {
        caption: 'The message, in clock time',
        say: `and the message says the Rock now runs from one clock time to another, in the real time of the dive.`,
        async act({ page }) {
          await expect(page.locator('#inspectStatus')).toContainText(/Rock now runs \d\d:\d\d:\d\d\.\d{3}.* to \d\d:\d\d:\d\d\.\d{3}/);
          await page.mouse.move(600, 200);
          await ring(page, page.locator('#inspectStatus'), 6000);
        }
      }
    ]
  },

  'issue-367': {
    title: 'Issue 367: the clock follows playback; no band above the video',
    async setup({ page, store }) {
      await openHabitat(page, store, [{ start: 0, end: 90, substrate: 'Rock' }], { keepPanel: true, clock: 'set' });
    },
    teardown,
    scenes: [
      {
        caption: 'Issue 367: two problems',
        say: `Issue three sixty-seven, which was two problems. The clock time of the frame did not change while the video played; it only caught up when you paused. And a band across the top of the page held the file name and the clock settings, taking room from the picture.`,
        async act({ page }) {
          await showControls(page);
          await ring(page, page.locator('#clockNow'), 9000);
        }
      },
      {
        caption: 'Playing: the clock follows every frame',
        say: `I press play … and watch the clock time beside the play time. It changes with every frame.`,
        async act({ page }) {
          await clickOn(page, page.locator('.marp-play-pause'));
          const seen = new Set();
          for (let n = 0; n < 16; n += 1) {
            seen.add(await page.locator('#clockNow').textContent());
            await pause(page, 250);
          }
          await clickOn(page, page.locator('.marp-play-pause'));
          expect(seen.size).toBeGreaterThan(8);
        }
      },
      {
        caption: 'No band at the top',
        say: `And the band at the top is gone: the picture starts at the very top of the page. The file name, the recording's start and the Set clock button are now at the foot of the observation panel.`,
        async act({ page }) {
          expect((await page.locator('#player').boundingBox()).y).toBeLessThan(2);
          await page.mouse.move(500, 200);
          await ring(page, page.locator('.panel-video'), 6000);
        }
      }
    ]
  },

  'player-39': {
    title: 'Player issue 39: smaller controls',
    async setup({ page, store }) {
      // The player as it was, for a picture of its controls, then as it is.
      await page.route('**/marp-video-player.standalone.js', (route) => route.fulfill({
        path: process.env.MARP_OLD_PLAYER, contentType: 'application/javascript'
      }));
      await openHabitat(page, store, [{ start: 0, end: 60, substrate: 'Rock' }]);
      await showControls(page);
      await pause(page, 600);
      const old = await page.locator('.marp-controls-bar').boundingBox();
      store.oldHeight = old.height;
      store.oldShot = (await page.screenshot({ clip: old })).toString('base64');
      store.oldBox = old;
      await page.unroute('**/marp-video-player.standalone.js');
      await reopen(page, store.ids[0]);
      await closePanel(page);
      await page.mouse.move(40, 40);
    },
    teardown,
    scenes: [
      {
        caption: 'Before: the player\'s controls',
        say: `Player issue thirty-nine. The video player's controls took a lot of the screen: a tall scrub bar and big buttons, sized for a finger on a phone. This is how they looked.`,
        async act({ page, store }) {
          await page.evaluate(({ shot, box }) => {
            const img = document.createElement('img');
            img.id = '__before';
            img.src = `data:image/png;base64,${shot}`;
            img.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:2147483645;pointer-events:none`;
            const tag = document.createElement('div');
            tag.id = '__beforeTag';
            tag.textContent = 'BEFORE';
            tag.style.cssText = `position:fixed;left:${box.x + 12}px;top:${box.y - 34}px;z-index:2147483645;background:#c0392b;color:#fff;font:700 15px Inter,Segoe UI,sans-serif;padding:4px 10px;border-radius:4px`;
            document.body.append(img, tag);
          }, { shot: store.oldShot, box: store.oldBox });
          await ring(page, store.oldBox, 7000);
        }
      },
      {
        caption: 'Now: smaller, with a mouse',
        say: `Now, with a mouse, they are smaller: a thinner scrub bar and smaller buttons, leaving more of the picture to look at.`,
        async act({ page, store }) {
          await page.evaluate(() => { document.getElementById('__before').remove(); document.getElementById('__beforeTag').remove(); });
          await showControls(page);
          const now = await page.locator('.marp-controls-bar').boundingBox();
          expect(now.height).toBeLessThan(store.oldHeight - 4);
          await ring(page, page.locator('.marp-controls-bar'), 5500);
        }
      }
    ]
  }
};
