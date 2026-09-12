/**
 * The top bar's behaviour, checked in a real browser (#151).
 *
 *   node tools/scroll-check.mjs
 *
 * Whether a bar is on screen, how tall the content is and whether a small movement flaps
 * it are rendering facts: nothing outside a browser can observe any of them, and a
 * screenshot cannot observe a *sequence*. So this is a script in the same shape as
 * `mock-shots.mjs` -- it collects problems and exits 1 -- rather than a picture to look at.
 *
 * It drives the scroller directly where a number has to be exact (the six-pixel
 * threshold), and the wheel where the point is that a real gesture works.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.SCROLL_PORT || 8131);
const BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/mockups/`;
const DESKTOP = { width: 1672, height: 941 };
/* The screen the behaviour checks are driven on, and it is chosen for one reason: it has
   the most room to scroll of the eight, 1069px at this height.

   **Not `dashboard`.** It fits inside 941px and does not scroll at all, so every check
   here passed against it while proving nothing -- which the first run of this file said
   out loud, and is why the `room > 200` guard below is an assertion rather than a skip.
   `models` was the second wrong answer: 368px of room means a scroll to 400 lands at the
   bottom, and the bar's own height then clamps it back up the page in a cascade, so the
   pixel-exact checks below were measuring the clamp rather than the threshold. */
const WORKHORSE = 'workers';

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch();
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

/** The bar's own state, plus the two numbers its behaviour is about. */
const readBar = (page) => page.evaluate(() => {
  const content = document.querySelector('.content');
  return {
    state: document.body.dataset.topbar || 'shown',
    barBottom: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom),
    room: content.scrollHeight - content.clientHeight,
    clientHeight: content.clientHeight,
    top: content.scrollTop,
  };
});

/* Setting `scrollTop` raises a real scroll event, which is what the bar listens to -- and
   it is the only way to move an exact number of pixels. */
const scrollTo = async (page, y) => {
  await page.evaluate((to) => { document.querySelector('.content').scrollTop = to; }, y);
  await page.waitForTimeout(60);
};
const settle = (page) => page.waitForTimeout(260);      // longer than the 180ms window

async function open(name, options = {}) {
  const page = await browser.newPage({ viewport: DESKTOP, ...options });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`${BASE}${name}.html`, { waitUntil: 'networkidle' });
  return { page, errors };
}

/* ---------------------------------------------------- R9, R11, R13: the gesture itself */
{
  const { page, errors } = await open(WORKHORSE);
  const start = await readBar(page);
  check(start.room > 200, `${WORKHORSE} does not scroll at ${DESKTOP.height}px, so this check would prove nothing`);
  check(start.state === 'shown', 'R9: the bar should start on screen');

  /* Down with the wheel, because the point here is that the reader's own gesture works. */
  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(320);
  const down = await readBar(page);
  check(down.state === 'hidden', `R9: scrolling down should hide the bar, got "${down.state}"`);
  check(down.barBottom <= 0, `R9: the bar should be off the top, its bottom edge is at ${down.barBottom}px`);
  /* R13: the space it gave up is the content's now, and that is the whole point. */
  check(down.clientHeight > start.clientHeight,
    `R13: the content should gain the bar's height, ${start.clientHeight} -> ${down.clientHeight}`);

  await settle(page);
  await page.mouse.wheel(0, -160);
  await page.waitForTimeout(320);
  const up = await readBar(page);
  check(up.state === 'shown', `R9: scrolling up should bring it back, got "${up.state}"`);

  /* R11: back at the top it is on screen, whatever happened on the way there. */
  await settle(page);
  await scrollTo(page, 600);
  await settle(page);
  check((await readBar(page)).state === 'hidden', 'R9: a jump down should hide it');
  await scrollTo(page, 0);
  const top = await readBar(page);
  check(top.state === 'shown', `R11: at the top of the content the bar is on screen, got "${top.state}"`);

  for (const e of errors) problems.push(`${WORKHORSE}: console error: ${e}`);
  await page.close();
}

/* ------------------------------------------------------------ R10: noise does nothing */
{
  const { page } = await open(WORKHORSE);
  await scrollTo(page, 400);
  await settle(page);
  check((await readBar(page)).state === 'hidden', 'R10: setup -- the bar should be hidden at 400px');

  /* Where the scroller *actually* came to rest, which is not always where it was put:
     hiding the bar hands its height to the content and shrinks the maximum scroll
     position, so near the bottom the browser clamps and the number moves under you. */
  const from = (await readBar(page)).top;

  /* Three pixels back up is a trackpad twitch, not a decision. */
  await scrollTo(page, from - 3);
  check((await readBar(page)).state === 'hidden',
    'R10: three pixels of movement should not bring the bar back');

  /* But the mark is not reset by a movement under the threshold, so a slow drag adds up:
     five pixels is still nothing, and the seventh is heard. */
  await scrollTo(page, from - 5);
  check((await readBar(page)).state === 'hidden', 'R10: five pixels is still noise');
  await scrollTo(page, from - 7);
  check((await readBar(page)).state === 'shown',
    'R10: seven pixels of deliberate movement should be heard -- a slow drag must still work');
  await page.close();
}

/* ------------------------------- R12: it can never be stuck hidden with nothing to scroll */
{
  const { page } = await open(WORKHORSE);
  await scrollTo(page, 500);
  await settle(page);
  check((await readBar(page)).state === 'hidden', 'R12: setup -- the bar should be hidden');

  /* The content stops being scrollable underneath it -- a filter, a tab, a drawer closing.
     No scroll event will ever come to put this right, so something else has to notice. */
  await page.evaluate(() => {
    const content = document.querySelector('.content');
    [...content.children].slice(1).forEach((el) => el.remove());
  });
  await page.waitForTimeout(260);
  const after = await readBar(page);
  check(after.room <= 6, `R12: setup -- the content should no longer scroll, room is ${after.room}px`);
  check(after.state === 'shown',
    `R12: with nothing left to scroll the bar must come back, got "${after.state}"`);
  await page.close();
}

/* --------------------------------------------------------------- R14: reduced motion */
{
  /* Both halves, because only the pair can fail. `0s` on its own is also what a stylesheet
     that never animated anything reports, so asserting it alone passes against the code
     before #151 -- it did, on this file's first run. */
  const moving = await open(WORKHORSE);
  const animated = await moving.page.evaluate(() =>
    getComputedStyle(document.querySelector('.topbar')).transitionDuration);
  check(parseFloat(animated) > 0,
    `R14: the bar should animate ordinarily, duration is "${animated}"`);
  await moving.page.close();

  const { page } = await open(WORKHORSE, { reducedMotion: 'reduce' });
  const transition = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.topbar')).transitionDuration);
  check(parseFloat(transition) === 0,
    `R14: the bar should not animate under prefers-reduced-motion, duration is "${transition}"`);

  await scrollTo(page, 500);
  await settle(page);
  check((await readBar(page)).state === 'hidden',
    'R14: reduced motion removes the animation, not the behaviour');
  await page.close();
}

/* ------------------------------------ R15: the shell authors it, so every screen has it */
{
  const screens = (await readdir(join(APP, 'mockups')))
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => f.replace(/\.html$/, ''));
  let scrollable = 0;

  for (const name of screens) {
    const { page } = await open(name);
    const start = await readBar(page);
    if (start.room > 200) {
      scrollable += 1;
      await scrollTo(page, 500);
      await settle(page);
      const now = await readBar(page);
      check(now.state === 'hidden', `R15: ${name} scrolls but its bar does not hide`);
    }
    await page.close();
  }

  /* A check that skipped every screen would report green having proved nothing. */
  check(scrollable >= 4,
    `R15: only ${scrollable} of ${screens.length} screens scrolled at this height, so this proves too little`);
  console.log(`    ${scrollable} of ${screens.length} screens scroll at ${DESKTOP.height}px, and each hides its bar`);
}

await browser.close();
stop();

if (problems.length) {
  console.error('');
  for (const p of problems) console.error('[x] ' + p);
  process.exit(1);
}
console.log('ok  the top bar hides on the way down, comes back on the way up, and cannot get stuck');
