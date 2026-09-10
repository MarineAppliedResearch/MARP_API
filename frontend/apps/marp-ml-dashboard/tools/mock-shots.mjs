/**
 * Screenshots the static mockups in mockups/, at desktop and phone width.
 *
 *   node tools/mock-shots.mjs                 every screen, both widths
 *   node tools/mock-shots.mjs dashboard       one screen
 *   node tools/mock-shots.mjs dashboard phone
 *
 * Look-and-feel work is judged by looking, so this is the loop: change the
 * markup, take the shot, look at the shot. It fails on a console error and on
 * anything cut off at the right edge — both invisible in a picture.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.SHOT_PORT || 8129);
const BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/mockups/`;

/* The shell is a fixed-height grid whose content scrolls inside it, so
   `fullPage` sees exactly one screen and nothing below the fold. The phone
   shot therefore uses a tall viewport: same 390px width, so every width-based
   rule fires identically, but tall enough that the whole column is in the
   picture. `phone-fold` is the real 844px height, for judging what a person
   sees before scrolling. */
const VIEWS = {
  desktop: { width: 1672, height: 941 },
  phone: { width: 390, height: 1900 },
  'phone-fold': { width: 390, height: 844 },
};

const all = (await readdir(join(APP, 'mockups')))
  .filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
const which = process.argv[2] && all.includes(process.argv[2]) ? [process.argv[2]] : all;
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

  for (const name of which) {
    errors.length = 0;
    await page.goto(BASE + name + '.html', { waitUntil: 'load' });
    await page.waitForTimeout(160);

    const file = join(APP, 'shots', `mock-${name}-${view}.png`);
    /* fullPage, because the part below the fold is exactly the part that has
       not been looked at yet. */
    await page.screenshot({ path: file, fullPage: true });
    console.log(`mock-${name}-${view}.png`);

    const over = await page.evaluate(() => {
      const w = window.innerWidth;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        let fixed = false;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
        }
        if (fixed) continue;
        /* A wide table scrolling inside its own overflow-x wrapper is the
           documented answer, not a defect -- so only content that escapes every
           scroller counts. */
        let scrolls = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') { scrolls = true; break; }
        }
        if (scrolls) continue;
        if (r.right > w + 1) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`
            + ` right=${Math.round(r.right)}`);
        }
      }
      return { over: out.slice(0, 5), w,
        scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    if (over.scrolls) problems.push(`${name}/${view}: the page scrolls sideways`);
    for (const o of over.over) problems.push(`${name}/${view}: past the ${over.w}px edge: ${o}`);
    for (const e of errors) problems.push(`${name}/${view}: console error: ${e}`);
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
console.log(`ok  ${which.length * views.length} shots, nothing clipped, no console errors`);
