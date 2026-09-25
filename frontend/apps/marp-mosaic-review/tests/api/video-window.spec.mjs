/** #181: the source video opens in its own window, and that window is reused. */
import { test, expect } from '@playwright/test';
import { seedPage } from './seed.mjs';
import { expectRealBacking, ready, pageOf } from './support.mjs';

/* Open one tile's details and press its Open video button. */
async function openVideo(page, id) {
  const tile = page.locator(`.tile[data-id="${id}"]`);
  await tile.click();
  await tile.locator('[data-badge]').click();
  await page.locator('.pick').getByRole('button', { name: 'Open video' }).click();
}

test('#181 Open video shows the observation in its own window, and reuses that window',
  async ({ page, context }) => {
    const seeded = await seedPage({ count: 2, thumbnail: 'ready' });
    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);
      const [first, second] = seeded.ids;

      const opened = context.waitForEvent('page');
      await openVideo(page, first);
      const inspector = await opened;
      await inspector.waitForLoadState();

      // Its own page, answered by the real video-context read.
      await expect(inspector).toHaveURL(/\/inspect\.html/);
      await expect(inspector.locator('#inspectTitle')).toContainText(String(first));
      // The seeded rows have no real video, and the page says so rather than guessing.
      await expect(inspector.locator('#inspectStatus')).not.toBeEmpty();

      // The Mosaic is where it was.
      await expect(page.locator(`.tile[data-id="${first}"]`)).toBeVisible();

      // A second observation is sent to the same window, not a new one. The first
      // panel closes first: a click that dismisses a panel deliberately does nothing else.
      await page.keyboard.press('Escape');
      await expect(page.locator('.pick')).toHaveCount(0);
      const pagesBefore = context.pages().length;
      await openVideo(page, second);
      await expect(inspector.locator('#inspectTitle')).toContainText(String(second));
      expect(context.pages()).toHaveLength(pagesBefore);
    } finally {
      await seeded.remove();
    }
  });

/* An observation on the testing database whose video really resolves, found rather than
   pinned. Fails, never skips, when there is none. */
async function playableObservation(request) {
  const { rows } = await pageOf(request, {}, { pageSize: 50 });
  const res = await request.post('/api/v2/mosaic/observations/video-context', {
    data: { observation_ids: rows.map((row) => row.observation_id) }
  });
  expect(res.ok(), `the video-context read was refused: ${res.status()}`).toBeTruthy();
  const video = (await res.json()).videos.find((entry) => entry.jellyfin_item_id);
  expect(video, 'no observation on the first page resolves to a Jellyfin video').toBeTruthy();
  return video.observations[0].observation_id;
}

test('#181 the video page reaches the real Jellyfin through MARP\'s own address', async ({ page }) => {
  await page.goto('inspect.html');
  // Same origin as the page, so a secure page can reach it; the gate is the MARP session.
  const status = await page.evaluate(async () => (await fetch('/jellyfin/System/Info/Public')).status);
  expect(status).toBe(200);
});

test('#181 signing in to Jellyfin from the video page takes effect', async ({ page, request }) => {
  const id = await playableObservation(request);
  // Only Jellyfin's answer to the sign-in is stood in: no real account is used here.
  let signedIn = null;
  await page.route('**/jellyfin/Users/AuthenticateByName', async (route) => {
    signedIn = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ AccessToken: 'jest-token', User: { Id: 'jest-user', Name: 'jest' }, ServerId: 'jest' })
    });
  });

  const hash = encodeURIComponent(JSON.stringify({ type: 'show', observationId: id, pageIds: [id] }));
  await page.goto(`inspect.html#${hash}`);

  const form = page.locator('#signIn');
  await expect(form).toBeVisible();
  await form.getByLabel('User').fill('jest-reviewer');
  await form.getByLabel('Password').fill('jest-not-a-password');
  await form.getByRole('button', { name: 'Sign in' }).click();

  await expect(form).toBeHidden();
  await expect(page.locator('#signInError')).toBeEmpty();
  expect(signedIn && signedIn.Username).toBe('jest-reviewer');
  // The player keeps the session, so the next page load does not ask again.
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => /jellyfin/i.test(key)))).toBe(true);
});

test('#181 nothing covers the player while the video opens', async ({ page, request }) => {
  const id = await playableObservation(request);
  // Jellyfin's answer to the sign-in only, as above, so the page goes on to open the video.
  await page.route('**/jellyfin/Users/AuthenticateByName', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ AccessToken: 'jest-token', User: { Id: 'jest-user', Name: 'jest' }, ServerId: 'jest' })
  }));
  const hash = encodeURIComponent(JSON.stringify({ type: 'show', observationId: id, pageIds: [id] }));
  await page.goto(`inspect.html#${hash}`);
  const form = page.locator('#signIn');
  await form.getByLabel('User').fill('jest-reviewer');
  await form.getByLabel('Password').fill('jest-not-a-password');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form).toBeHidden();

  // The middle of the player is the player -- its picture and its spinner -- and not a
  // frame laid over it. A full-page poster used to cover it from the first request until
  // the seek landed, which on a phone read as the whole player disappearing.
  const hit = await page.evaluate(() => {
    const rect = document.getElementById('player').getBoundingClientRect();
    const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { inside: Boolean(element && element.closest('#player')), what: element && (element.id || element.className) };
  });
  expect(hit.inside, `the middle of the player is covered by ${hit.what}`).toBe(true);
});
