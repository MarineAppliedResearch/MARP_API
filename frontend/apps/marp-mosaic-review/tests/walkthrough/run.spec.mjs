/**
 * Runs one walkthrough scenario and records it.
 *
 * The scenario is chosen with SCENARIO; the scripts live in scenarios.mjs. Each
 * scene is held for as long as its narration takes to speak, so lines never talk
 * over each other. Those durations are measured before the run and passed in
 * through HOLDS; without them, scenes fall back to a fixed hold and the video is
 * silent.
 *
 * It asserts as it goes, so a broken application fails here rather than producing
 * a film of something that does not work.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { scenarios } from './scenarios.mjs';

const ID = process.env.SCENARIO || 'review';
const scenario = scenarios[ID];
if (!scenario) throw new Error(`unknown scenario: ${ID}`);

/** Per-scene hold in ms, measured from the spoken audio. */
const HOLDS = (() => {
  const path = `demo/${ID}.holds.json`;
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
})();

const SILENT_HOLD = 1400;
const READ_LEAD = 350;      // let the caption appear a beat before the voice starts

test(`walkthrough — ${scenario.title}`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const timeline = [];
  const store = {};
  const t0 = Date.now();

  const settled = async () => {
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.tile.skeleton')).toHaveCount(0);
    await page.waitForTimeout(400);
  };

  const caption = (text) => page.evaluate((t) => {
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

  await page.goto('./');
  await settled();

  for (const [i, scene] of scenario.scenes.entries()) {
    await caption(scene.caption);
    /* The voice starts here, so this is the moment the audio is placed at. */
    await page.waitForTimeout(READ_LEAD);
    timeline.push({ at: Date.now() - t0, text: scene.say });

    if (scene.act) await scene.act({ page, expect, settled, store });

    /* Hold out the rest of the spoken line, so the next caption never cuts in. */
    const spoken = HOLDS ? HOLDS[i] : null;
    const elapsed = Date.now() - t0 - timeline[timeline.length - 1].at;
    const remaining = (spoken ?? SILENT_HOLD) - elapsed;
    if (remaining > 0) await page.waitForTimeout(remaining);
    await page.waitForTimeout(450);          // a breath between lines
  }

  await page.evaluate(() => document.getElementById('__cap')?.remove());
  await page.waitForTimeout(700);

  expect(errors).toEqual([]);

  mkdirSync('demo', { recursive: true });
  writeFileSync(`demo/${ID}.timeline.json`, JSON.stringify(timeline, null, 1));
});
