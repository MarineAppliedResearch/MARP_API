/**
 * A recorded walkthrough of the review workflow.
 *
 * This is a test — it asserts as it goes, so a broken app fails here rather than
 * producing a misleading video — but its purpose is the recording. Playwright
 * captures video for this project always, so `npm run demo` produces a fresh film
 * of the real application without anyone driving a browser by hand.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/* Narrated runs hold each caption long enough to be spoken over. */
const NARRATE = process.env.NARRATE === '1';
const HOLD = NARRATE ? 3600 : 1200;

/* The captions double as the narration script, so the two cannot drift apart. */
const timeline = [];
let t0 = 0;

/** A caption bar, so the recording says what is happening. Not part of the app. */
async function say(page, text) {
  await page.evaluate((t) => {
    let b = document.getElementById('__cap');
    if (!b) {
      b = document.createElement('div');
      b.id = '__cap';
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:62px;'
        + 'z-index:9999;background:rgba(3,16,31,.94);border:1px solid rgba(42,214,220,.4);'
        + 'border-radius:8px;color:#f7fbff;font:600 16px/1.4 Inter,Segoe UI,sans-serif;'
        + 'padding:10px 20px;text-align:center;pointer-events:none;'
        + 'box-shadow:0 12px 34px rgba(0,0,0,.6);max-width:76vw';
      document.body.appendChild(b);
    }
    b.textContent = t;
  }, text);
  timeline.push({ at: Date.now() - t0, text });
  await page.waitForTimeout(HOLD);
}

async function settled(page) {
  await expect(page.locator('.tile').first()).toBeVisible();
  await expect(page.locator('.tile.skeleton')).toHaveCount(0);
  await page.waitForTimeout(400);
}

test('the review workflow, end to end', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  t0 = Date.now();
  await page.goto('./');
  await settled(page);
  await say(page, 'MARP Picture Mosaic Reviewer — scanning a page of model-generated observations');

  await say(page, 'Tap a tile to flag it. The flag lands immediately.');
  const tiles = page.locator('.tile:not(.failed):not(.queued)');
  for (const i of [0, 1, 2]) {
    await tiles.nth(i).click();
    await page.waitForTimeout(320);
  }
  await expect(page.locator('.tile.marked')).toHaveCount(3);

  await say(page, 'The badge opens the panel — the reason is optional');
  await page.locator('[data-badge]').first().click();
  await expect(page.locator('.pick')).toBeVisible();
  await page.waitForTimeout(600);

  await say(page, 'Give it a reason');
  await page.locator('.pick .chip', { hasText: 'Wrong species' }).click();
  await page.waitForTimeout(700);

  await say(page, 'Or correct the species outright, without leaving the mosaic');
  await page.locator('.pick [data-act="correct"]').click();
  await expect(page.locator('.pick #spSearch')).toBeVisible();
  await page.locator('.pick #spSearch').fill('lea');
  await page.waitForTimeout(900);
  await page.locator('.pick .srow').first().click();
  await page.waitForTimeout(800);

  await say(page, 'Click away to close it');
  await page.locator('#field').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('.pick')).toHaveCount(0);

  await say(page, 'Commit the page: everything unflagged is accepted, in one action');
  await page.locator('#commit').click();
  await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
  const reviewed = await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count();
  await page.waitForTimeout(900);

  await say(page, 'Go to the next page');
  await page.locator('[data-page="next"]').click();
  await settled(page);

  await say(page, 'And back — a committed page still shows everything that was submitted');
  await page.locator('[data-page="prev"]').click();
  await settled(page);
  expect(await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count()).toBe(reviewed);
  await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
  await page.waitForTimeout(900);

  await say(page, 'Switching mode changes what a tap means and what the commit does');
  await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
  await settled(page);
  await expect(page.locator('#commit')).toContainText('Promote Page');
  await page.waitForTimeout(900);

  await say(page, 'Delete Mode inverts it: the commit acts on what you marked');
  await page.locator('.seg button', { hasText: 'Delete' }).click();
  await settled(page);
  await expect(page.locator('#commit')).toContainText('Delete Marked');
  await page.waitForTimeout(1100);

  await page.evaluate(() => document.getElementById('__cap')?.remove());
  await page.waitForTimeout(600);

  expect(errors).toEqual([]);

  /* Written for the narration step; harmless when nothing reads it. */
  mkdirSync('demo', { recursive: true });
  writeFileSync('demo/timeline.json', JSON.stringify(timeline, null, 1));
});
