/**
 * The account menu, checked in a real browser (#151).
 *
 *   node tools/account-check.mjs
 *
 * This app used to draw its own copy of this control, with `IT` and `Isaac Travers` typed
 * into it. It now uses `frontend/shared/assets/js/account-menu.js`, the same component the
 * Picture Mosaic Reviewer and the public landing page use, and the point of that change is
 * that **no application here hard-codes a person**. The Mosaic Reviewer's own notes record
 * that exact literal shipping once and telling everybody they were one developer.
 *
 * So the two things worth asserting are who it draws, and that it draws nobody when it has
 * not been told. Same shape as `mock-shots.mjs` and `scroll-check.mjs`: collect problems,
 * exit 1.
 *
 * **This app is not session-gated**, unlike the other two, so signed out is a state it
 * really has -- and `DESIGN.md` calls it a mockup with real operation, which is the real
 * half. It says so plainly rather than drawing a plausible stranger.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.ACCOUNT_PORT || 8133);
const BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/mockups/`;
const DESKTOP = { width: 1672, height: 941 };

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch();
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

/** What the control is saying right now. */
const readAccount = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-account]');
  if (!root) return null;
  const button = root.querySelector('[data-account-button]');
  const signOut = root.querySelector('[data-account-signout]');
  return {
    controls: document.querySelectorAll('[data-account]').length,
    initials: button.textContent.trim(),
    nobody: button.hasAttribute('data-account-nobody'),
    label: button.getAttribute('aria-label'),
    who: root.querySelector('[data-account-who]').textContent.trim(),
    menuOpen: !root.querySelector('[data-account-menu]').hidden,
    signOutOffered: Boolean(signOut) && !signOut.hidden,
    /* Everything the top bar actually says, so a name cannot hide in it. */
    barText: document.querySelector('.topbar').textContent
  };
});

async function open(name, route) {
  const page = await browser.newPage({ viewport: DESKTOP });
  if (route) await route(page);
  await page.goto(`${BASE}${name}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  return page;
}

/* ------------------------------------------ signed out: nobody, and it says so */
{
  const page = await open('dashboard');
  const seen = await readAccount(page);

  check(Boolean(seen), 'the shell draws no account control at all');
  if (seen) {
    check(seen.controls === 1, `the shell should draw one account control, found ${seen.controls}`);
    check(seen.nobody, 'signed out, the avatar must be marked as nobody');
    check(seen.who === 'Not signed in', `signed out, the menu should say so, it says "${seen.who}"`);
    check(seen.label === 'Not signed in', `the button's label should say so, it says "${seen.label}"`);
    /* The whole point. A mockup may stand in for data; it may not stand in for a person. */
    check(!/Isaac|Travers/i.test(seen.barText),
      'a person is named in the top bar, which is the literal this change removed');
    check(seen.initials !== 'IT', 'the avatar still draws the hard-coded initials');
    check(!seen.signOutOffered, 'signing out is offered to somebody who is not signed in');
  }
  await page.close();
}

/* ----------------------------------------------- signed in: whoever is signed in */
{
  const page = await open('dashboard', (p) => p.route('**/api/v2/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { user_id: 9, name: 'Grace Hopper', username: 'ghopper' } })
  })));
  const seen = await readAccount(page);

  check(seen.initials === 'GH', `the avatar should draw the session's initials, it draws "${seen.initials}"`);
  check(!seen.nobody, 'signed in, the avatar must not be marked as nobody');
  check(seen.who === 'Signed in as Grace Hopper', `the menu says "${seen.who}"`);
  check(seen.signOutOffered, 'signed in, signing out should be offered');

  /* It opens and it shuts, because a menu that only opens is half a control. */
  await page.locator('[data-account-button]').click();
  check((await readAccount(page)).menuOpen, 'the menu should open on a click');
  await page.keyboard.press('Escape');
  check(!(await readAccount(page)).menuOpen, 'the menu should close on Escape');

  await page.close();
}

/* ------------------------------ the shell authors it, so every screen has exactly one */
{
  const screens = (await readdir(join(APP, 'mockups')))
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => f.replace(/\.html$/, ''));

  for (const name of screens) {
    const page = await open(name);
    const seen = await readAccount(page);
    check(Boolean(seen) && seen.controls === 1,
      `${name}: expected one account control, found ${seen ? seen.controls : 0}`);
    check(Boolean(seen) && !/Isaac|Travers/i.test(seen.barText), `${name}: a person is named in the top bar`);
    await page.close();
  }
  console.log(`    ${screens.length} screens, each drawing one shared account menu`);
}

await browser.close();
stop();

if (problems.length) {
  console.error('');
  for (const p of problems) console.error('[x] ' + p);
  process.exit(1);
}
console.log('ok  the account menu is the shared one, and it names nobody it has not been told about');
