/**
 * Runs one walkthrough scenario and records it. Shared by every application.
 *
 * Extracted from marp-mosaic-review, which is where all of this was worked out. The only
 * thing that was ever application-specific is `settled` — knowing when the page has
 * stopped moving — so that is the one thing an application passes in. See ADR-0007.
 *
 * The scenario is chosen with SCENARIO. Each scene is held for as long as its narration
 * takes to speak, and those durations are measured before the run and passed in through a
 * holds file; without them, scenes fall back to a fixed hold and the video is silent.
 *
 * It asserts as it goes, so a broken application fails here rather than producing a
 * convincing film of something that does not work.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SILENT_HOLD = 1400;
const READ_LEAD = 350;      // let the caption appear a beat before the voice starts

/**
 * Draw the caption. Deliberately injected rather than styled by the application: it has
 * to be legible over whatever is behind it, in every application, at recording size.
 */
const showCaption = (page, text) => page.evaluate((t) => {
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

/**
 * Register the walkthrough test.
 *
 * `test` and `expect` are passed in rather than imported. Playwright only registers a
 * test when it is the *same* module instance the runner loaded, and each application
 * installs its own -- this file sits above them all and would resolve a different one, or
 * none. Passing them in also keeps this module free of any dependency.
 *
 * @param {object}   options
 * @param {Function} options.test       Playwright's `test`, from the application
 * @param {object}   options.expect     Playwright's `expect`, from the application
 * @param {object}   options.scenarios  every scenario, keyed by id
 * @param {Function} options.settled    async ({ page, expect }) => void. Resolves when the
 *                                      page has stopped moving. The one application-specific
 *                                      part, and the one that cannot be guessed from here.
 * @param {string}  [options.outDir]    where the timeline is written. Default `demo`.
 * @param {string}  [options.url]       what to open. Default `./`, resolved against baseURL.
 */
export function walkthrough({ test, expect, scenarios, settled, outDir = 'demo', url = './' }) {
  if (!test || !expect) throw new Error('pass Playwright test and expect in from the application');
  const id = process.env.SCENARIO || Object.keys(scenarios)[0];
  const scenario = scenarios[id];
  if (!scenario) throw new Error(`unknown scenario: ${id}`);

  /** Per-scene hold in ms, measured from the spoken audio before this run started. */
  const holds = (() => {
    const path = join(outDir, `${id}.holds.json`);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  })();

  test(`walkthrough — ${scenario.title}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    const timeline = [];
    const store = {};
    const t0 = Date.now();
    const waitSettled = () => settled({ page, expect });

    await page.goto(url);
    await waitSettled();

    for (const [i, scene] of scenario.scenes.entries()) {
      await showCaption(page, scene.caption);
      /* The voice starts here, so this is the moment the audio is placed at. */
      await page.waitForTimeout(READ_LEAD);
      timeline.push({ at: Date.now() - t0, text: scene.say });

      if (scene.act) await scene.act({ page, expect, settled: waitSettled, store });

      /* Hold out the rest of the spoken line, so the next caption never cuts in. */
      const spoken = holds ? holds[i] : null;
      const elapsed = Date.now() - t0 - timeline[timeline.length - 1].at;
      const remaining = (spoken ?? SILENT_HOLD) - elapsed;
      if (remaining > 0) await page.waitForTimeout(remaining);
      await page.waitForTimeout(450);          // a breath between lines
    }

    await page.evaluate(() => document.getElementById('__cap')?.remove());
    await page.waitForTimeout(700);

    expect(errors).toEqual([]);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${id}.timeline.json`), JSON.stringify(timeline, null, 1));
  });
}
