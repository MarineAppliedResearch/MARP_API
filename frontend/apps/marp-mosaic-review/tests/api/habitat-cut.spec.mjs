/**
 * #360: one habitat stretch cut with another on the video page, the way Isaac does it --
 * select the cutter, Ctrl+click the stretch to cut, right-click it, Cut.
 *
 * Reported not working (2026-11-20) while the server's half passed its own tests, which is why
 * this drives the page itself. **A real video plays here**, signed in to Jellyfin with the test
 * account in `.env`, as the other video-page checks do. The habitat session and its stretches
 * are this check's own, in that video, and are removed afterwards.
 */
import { test, expect } from '@playwright/test';
import { editableObservation, openAndPlay } from './video-page.mjs';
import { seedHabitat } from './habitat-seed.mjs';

/* Rock across two minutes, and Sand in its middle to cut it with, in a video Jellyfin has. */
async function habitatInVideo(request) {
  const opened = await editableObservation(request);
  const read = await (await request.post('/api/v2/mosaic/video/observations', {
    data: { observation_id: opened, filters: {} }
  })).json();
  // From the moment that observation opens at, which the player is known to open on: a page
  // opened elsewhere in this video was seen to sit at "Opening the video..." for minutes.
  const at = read.opened.moment_s;
  return seedHabitat({
    videoSource: read.video.video_source,
    stretches: [{ start: at, end: at + 120, substrate: 'Rock' }, { start: at + 40, end: at + 60, substrate: 'Sand' }]
  });
}

const bar = (page, id) => page.locator(`.hstrip-bar[data-id="${id}"]`);

/* The session's stretches as the record has them, by name and span relative to the Rock's start. */
async function stretchesOf(request, rock) {
  const read = await (await request.post('/api/v2/mosaic/video/observations', { data: { observation_id: rock, filters: {} } })).json();
  const stretches = (read.habitat && read.habitat.stretches) || [];
  const origin = Math.min(...stretches.map((s) => s.start_s));
  return stretches.map((s) => [s.comname, Math.round(s.start_s - origin), Math.round(s.end_s - origin)])
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
}

/* The Rock cut in two around the Sand: 0-40 and 60-120, the Sand 40-60 untouched. */
const splitAround = [['Rock', 0, 40], ['Sand', 40, 60], ['Rock', 60, 120]];

/* Zoom the timeline in on a bar, so a press lands on it however long the video is. */
async function zoomOn(page, id) {
  for (let n = 0; n < 6; n += 1) {
    const box = await bar(page, id).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
  }
}

async function ctrlClick(page, at) {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Control');
}

test('#360 on the timeline: select the cutter, Ctrl+click the Rock, right-click it, Cut: it is split around the cutter',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const seeded = await habitatInVideo(request);
    const [rock, sand] = seeded.ids;
    try {
      await openAndPlay(page, rock);
      await expect(page.locator('#habitatStrip')).toBeVisible();
      await expect(bar(page, rock)).toBeVisible();
      await zoomOn(page, sand);

      // The cutter selected; then the Rock picked second, away from where the Sand covers it.
      await bar(page, sand).click();
      // On the Rock's own lane, inside the strip: zoomed in, the bar runs past both its ends.
      const rockBox = await bar(page, rock).boundingBox();
      const lanes = await page.locator('#habitatStrip .hstrip-lanes').boundingBox();
      const onRock = { x: Math.max(rockBox.x, lanes.x) + 12, y: rockBox.y + rockBox.height / 2 };
      await ctrlClick(page, onRock);
      await expect(bar(page, rock)).toHaveClass(/second/);

      // Right-click the Rock: Cut it with the Sand.
      await page.mouse.click(onRock.x, onRock.y, { button: 'right' });
      const item = page.locator('.hstrip-menu button', { hasText: /^Cut / });
      await expect(item).toBeVisible();
      await expect(item).toContainText('Rock');
      const cut = page.waitForResponse((r) => r.url().endsWith('/cut'));
      await item.click();
      const answer = await cut;
      expect(answer.ok(), `the cut was refused: ${answer.status()} ${await answer.text()}`).toBe(true);

      // Split around the Sand: the Rock before it, a new Rock after it, and the Sand.
      await expect.poll(() => stretchesOf(request, rock)).toEqual(splitAround);
    } finally {
      await seeded.remove();
    }
  });

test('#360 on the boxes: select the cutter by its label, Ctrl+click the Rock\'s label, right-click it, Cut',
  async ({ page, request }) => {
    test.setTimeout(240_000);
    const seeded = await habitatInVideo(request);
    const [rock, sand] = seeded.ids;
    const tabOf = (id) => page.evaluate((own) => {
      const drawn = window.MARP_VIDEO.drawn.find((d) => d.observation_id === own);
      return drawn && drawn.tabs[0];
    }, id);
    const centre = (tab) => ({ x: tab.left + tab.width / 2, y: tab.top + tab.height / 2 });
    try {
      await openAndPlay(page, rock);
      // The Sand's box is drawn only once the video is where the Sand is: its bar goes there.
      await zoomOn(page, sand);
      await bar(page, sand).click();
      await expect.poll(() => tabOf(sand), { timeout: 60_000 }).toBeTruthy();
      // The panel would cover the labels at phone width: closed first, as a reviewer would.
      const panel = page.locator('#obsPanel');
      if (await panel.isVisible()) await panel.getByRole('button', { name: 'Close' }).click();

      await page.mouse.click(centre(await tabOf(sand)).x, centre(await tabOf(sand)).y);
      await expect.poll(() => page.evaluate(() => window.MARP_VIDEO.selected)).toBe(`${sand}_1`);
      await ctrlClick(page, centre(await tabOf(rock)));
      await expect(bar(page, rock)).toHaveClass(/second/);

      await page.mouse.click(centre(await tabOf(rock)).x, centre(await tabOf(rock)).y, { button: 'right' });
      const item = page.locator('#boxMenu button', { hasText: /^Cut / });
      await expect(item).toBeVisible();
      const cut = page.waitForResponse((r) => r.url().endsWith('/cut'));
      await item.click();
      const answer = await cut;
      expect(answer.ok(), `the cut was refused: ${answer.status()} ${await answer.text()}`).toBe(true);
      await expect.poll(() => stretchesOf(request, rock)).toEqual(splitAround);
    } finally {
      await seeded.remove();
    }
  });
