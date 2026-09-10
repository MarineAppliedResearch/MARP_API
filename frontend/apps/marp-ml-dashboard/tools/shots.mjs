/**
 * Screenshots the app, so whoever is drawing a tab can actually look at it.
 *
 *   node tools/shots.mjs                 every tab, both viewports
 *   node tools/shots.mjs jobs            one tab, both viewports
 *   node tools/shots.mjs jobs desktop    one tab, one viewport
 *
 * Writes shots/<tab>-<viewport>.png and prints the paths. Starts and stops its
 * own server on a port of its own, so it never adopts one another checkout left
 * running -- that has happened here, and the borrowed server graded the wrong
 * code for an hour without saying so.
 *
 * It also fails on two things a screenshot alone will not tell you: a console
 * error, and a document that scrolls sideways. Both are silent in a picture and
 * both are defects.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.SHOT_PORT || 8127);
const URL_BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/`;

const TABS = ['dashboard', 'jobs', 'inference', 'training', 'datasets', 'models', 'workers', 'history'];
const VIEWS = {
  desktop: { width: 1672, height: 941 },   // the width the mockups were drawn at
  phone: { width: 390, height: 844 },
};

const which = process.argv[2] && TABS.includes(process.argv[2]) ? [process.argv[2]] : TABS;
const views = process.argv[3] && VIEWS[process.argv[3]] ? [process.argv[3]] : Object.keys(VIEWS);

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);

await new Promise((r) => setTimeout(r, 400));
await mkdir(join(APP, 'shots'), { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const view of views) {
  const page = await browser.newPage({ viewport: VIEWS[view], deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));

  for (const tab of which) {
    errors.length = 0;
    await page.goto(URL_BASE + '#/' + tab, { waitUntil: 'load' });
    // The router imports the tab module, so the panel arrives a tick later.
    await page.waitForSelector('#content > *', { timeout: 5000 }).catch(() => {
      problems.push(`${tab}/${view}: nothing rendered into #content`);
    });
    await page.waitForTimeout(180);

    const file = join(APP, 'shots', `${tab}-${view}.png`);
    await page.screenshot({ path: file });
    console.log(file.replace(APP + '\\', '').replace(APP + '/', ''));

    /* scrollWidth alone is not enough: an `overflow-x: hidden` anywhere in the
       chain clips the overflow instead of scrolling, so the page measures clean
       while content is being cut off. This looks for the cut-off itself. */
    const over = await page.evaluate(() => {
      const w = window.innerWidth;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        /* Anything inside a fixed ancestor is off-canvas on purpose -- the phone
           rail is parked at translateX(-100%) and its rows measure negative. */
        let fixed = false;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
        }
        if (fixed) continue;
        if (r.right > w + 1) {
          out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`
            + ` right=${Math.round(r.right)}`);
        }
      }
      return { scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        over: out.slice(0, 6), w };
    });
    if (over.scrolls) problems.push(`${tab}/${view}: the page scrolls sideways`);
    for (const o of over.over) problems.push(`${tab}/${view}: past the ${over.w}px edge: ${o}`);
    for (const e of errors) problems.push(`${tab}/${view}: console error: ${e}`);
  }
  await page.close();
}

await browser.close();
stop();

if (problems.length) {
  console.error('');
  for (const p of problems) console.error('[x] ' + p);
  process.exit(1);
}
console.log(`ok  ${which.length * views.length} shots, no console errors, no sideways scroll`);
