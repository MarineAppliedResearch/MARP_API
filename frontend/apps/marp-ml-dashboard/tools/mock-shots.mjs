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
  /* The middle width, where the rail is a 56px strip. It has its own layout and
     its own logo, so it needs its own shot -- neither of the other two can see it. */
  tablet: { width: 1000, height: 1500 },
  phone: { width: 390, height: 1900 },
  'phone-fold': { width: 390, height: 844 },
};

const all = (await readdir(join(APP, 'mockups')))
  /* A leading underscore marks a template rather than a screen. One got shot as
     a page, placeholders and all, and reported four console errors. */
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .map((f) => f.replace(/\.html$/, ''));
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

    /* Anything wider than the box that holds it. The right-edge check above
       only sees content leaving the *viewport*; a child overflowing its own
       grid column lands on top of the column beside it and stays inside the
       page, which is how two headings ended up printed over each other. */
    const spill = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.panel *, .rundetail *')) {
        const par = el.parentElement;
        if (!par) continue;
        const cs = getComputedStyle(par);
        if (cs.overflowX !== 'visible' || cs.display === 'inline') continue;
        if (getComputedStyle(el).position === 'absolute') continue;
        const a = el.getBoundingClientRect();
        const b = par.getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        if (a.width - b.width > 2) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`
            + ` ${Math.round(a.width)}px inside ${Math.round(b.width)}px`
            + ` ${par.tagName.toLowerCase()}.${String(par.className).split(' ')[0]}`);
        }
      }
      return [...new Set(out)].slice(0, 5);
    });
    for (const o of spill) problems.push(`${name}/${view}: wider than its container: ${o}`);

    /* Two controls side by side in a `.fieldrow` must sit on the same line. They
       did not: a grid item stretches to its row, and a stretched `.field` puts
       the slack into its own label row, dropping the second control 7px. Easy
       to miss by eye on one screen, and it was wrong on two. */
    const rows = await page.evaluate(() => {
      const out = [];
      for (const row of document.querySelectorAll('.fieldrow')) {
        const ctrls = [...row.querySelectorAll(
          ':scope > .field > select, :scope > .field > input, :scope > .field > button')];
        if (ctrls.length < 2) continue;
        /* Only controls that are genuinely side by side. On a phone the row
           collapses to one column and the fields are *meant* to stack, so
           comparing every pair reported the layout working as a fault. */
        for (let i = 1; i < ctrls.length; i++) {
          const a = ctrls[i - 1].getBoundingClientRect();
          const b = ctrls[i].getBoundingClientRect();
          const sideBySide = Math.abs(a.left - b.left) > 2;
          if (sideBySide && Math.abs(a.top - b.top) > 1) {
            out.push((row.querySelector('label') || {}).textContent
              + ' -> ' + Math.round(a.top) + ' / ' + Math.round(b.top));
          }
        }
      }
      return out.slice(0, 4);
    });
    for (const r of rows) problems.push(`${name}/${view}: field pair off the same line: ${r}`);

    /* A tab icon that points at nothing fails silently -- the tab just shows the
       browser's default and nobody notices for months. So it is asserted. */
    const fav = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="icon"]');
      if (!link) return { missing: true };
      const res = await fetch(link.href, { method: 'GET' });
      return { href: link.getAttribute('href'), status: res.status };
    });
    if (fav.missing) problems.push(`${name}/${view}: no <link rel="icon"> -- the tab has no icon`);
    else if (fav.status !== 200) problems.push(`${name}/${view}: tab icon ${fav.href} answered ${fav.status}`);

    /* A dropdown that is only ever drawn shut cannot be judged, so a screen with
       an account button gets one extra shot with it open. */
    if (view === 'desktop' && await page.locator('#userBtn').count()) {
      await page.locator('#userBtn').click();
      await page.waitForTimeout(120);
      const f = join(APP, 'shots', `mock-${name}-menu.png`);
      await page.screenshot({ path: f, fullPage: false });
      console.log(`mock-${name}-menu.png`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }

    /* A drawer is the point of the screen it lives on, so it gets a shot of its
       own rather than only ever being photographed shut. */
    if (view === 'desktop' && await page.locator('#drawer').count()) {
      await page.locator('table tbody tr').nth(2).click();
      await page.waitForTimeout(140);
      /* Opened folded, then opened again with the diagnostics expanded -- the
         folded state is the normal view and the open one is what it hides. */
      const d = join(APP, 'shots', `mock-${name}-drawer.png`);
      await page.screenshot({ path: d, fullPage: false });
      console.log(`mock-${name}-drawer.png`);
      if (await page.locator('details.diag').count()) {
        await page.locator('details.diag summary').click();
        await page.waitForTimeout(140);
        /* The drawer body is its own scroller, so opening the fold is not enough
           -- what it revealed is below the fold until this scrolls to it. */
        await page.locator('.drawer-bd').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(120);
        const d2 = join(APP, 'shots', `mock-${name}-drawer-diag.png`);
        await page.screenshot({ path: d2, fullPage: false });
        console.log(`mock-${name}-drawer-diag.png`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

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
