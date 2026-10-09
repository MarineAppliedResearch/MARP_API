/**
 * The account menus, checked in a real browser (#151, #166).
 *
 *   node tools/account-check.mjs
 *
 * This app used to draw its own copy of this control, with `IT` and `Isaac Travers` typed
 * into it. It now uses `frontend/shared/assets/js/account-menu.js`, the same component the
 * Picture Mosaic Reviewer and the public landing page use, and the point of that change is
 * that **no application here hard-codes a person**. The Mosaic Reviewer's own notes record
 * that exact literal shipping once and telling everybody they were one developer.
 *
 * Each application owns its rows now. This check holds the shared session behavior, the
 * ML menu's contents and stacking at the three layouts from #166, and the legacy dashboard's
 * separate application links. Same shape as the other tools: collect problems, exit 1.
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
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/apps/marp-ml-dashboard/mockups/`;
const VIEWPORTS = {
  desktop: { width: 1672, height: 941 },
  'phone portrait': { width: 412, height: 915 },
  'phone landscape': { width: 915, height: 412 }
};

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
  const signIn = root.querySelector('[data-account-signin]');
  const signOut = root.querySelector('[data-account-signout]');
  return {
    controls: document.querySelectorAll('[data-account]').length,
    initials: button.textContent.trim(),
    nobody: button.hasAttribute('data-account-nobody'),
    label: button.getAttribute('aria-label'),
    who: root.querySelector('[data-account-who]').textContent.trim(),
    menuOpen: !root.querySelector('[data-account-menu]').hidden,
    signInOffered: Boolean(signIn) && !signIn.hidden,
    signOutOffered: Boolean(signOut) && !signOut.hidden,
    /* Everything the top bar actually says, so a name cannot hide in it. */
    barText: (document.querySelector('.topbar, .navbar, .marp-header') || root).textContent
  };
});

async function open(name, route, viewport = VIEWPORTS.desktop) {
  const page = await browser.newPage({ viewport });
  if (route) await route(page);
  await page.goto(`${BASE}${name}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  return page;
}

async function openPath(path, route, viewport = VIEWPORTS.desktop) {
  const page = await browser.newPage({ viewport });
  if (route) await route(page);
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  return page;
}

/** Read clipping and coverage from the pixels where the menu is supposed to be. */
const menuGeometry = (page) => page.locator('[data-account-menu]').evaluate((menu) => {
  const box = menu.getBoundingClientRect();
  const points = [
    [box.left + 4, box.top + 4], [box.right - 4, box.top + 4],
    [box.left + 4, box.bottom - 4], [box.right - 4, box.bottom - 4]
  ];
  return {
    left: box.left, top: box.top, right: box.right, bottom: box.bottom,
    uncovered: points.every(([x, y]) => menu.contains(document.elementFromPoint(x, y))),
    covers: points.map(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return top ? `${top.tagName.toLowerCase()}.${top.className}` : 'outside viewport';
    }),
    ancestors: [...function* () {
      for (let node = menu; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        yield `${node.tagName.toLowerCase()}.${node.className}`
          + `[position=${style.position},z=${style.zIndex},overflow=${style.overflow}]`;
      }
    }()]
  };
});

const session = (page) => page.route('**/api/v2/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ user: { user_id: 9, name: 'Grace Hopper', username: 'ghopper' } })
}));

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
    check(seen.signInOffered, 'signed out, the menu does not offer Sign in');
    check(!seen.signOutOffered, 'signing out is offered to somebody who is not signed in');
  }
  await page.locator('[data-account-button]').click();
  const items = await page.getByRole('menuitem').allTextContents();
  check(items.join('|') === 'Open the dashboard|Sign in',
    `signed out, the ML menu has the wrong items: ${items.join(', ')}`);
  await page.close();
}

/* ----------------------------------------------- signed in: whoever is signed in */
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const page = await open('dashboard', session, viewport);
  const seen = await readAccount(page);

  check(seen.initials === 'GH', `${name}: the avatar should draw GH, it draws "${seen.initials}"`);
  check(!seen.nobody, `${name}: signed in, the avatar must not be marked as nobody`);
  check(seen.who === 'Signed in as Grace Hopper', `${name}: the menu says "${seen.who}"`);
  check(!seen.signInOffered, `${name}: signed in, signing in is still offered`);
  check(seen.signOutOffered, `${name}: signed in, signing out should be offered`);

  /* It opens and it shuts, because a menu that only opens is half a control. */
  await page.locator('[data-account-button]').click();
  check((await readAccount(page)).menuOpen, `${name}: the menu should open on a click`);
  const items = await page.getByRole('menuitem').allTextContents();
  check(items.join('|') === 'Open the dashboard|Sign out',
    `${name}: the ML menu has the wrong items: ${items.join(', ')}`);
  const box = await menuGeometry(page);
  check(box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
    `${name}: the ML menu leaves the viewport (${JSON.stringify(box)})`);
  check(box.uncovered, `${name}: application content covers the open ML menu`);
  await page.locator('.heading').click();
  check(!(await readAccount(page)).menuOpen, `${name}: the menu should close on an outside click`);
  await page.locator('[data-account-button]').click();
  await page.keyboard.press('Escape');
  check(!(await readAccount(page)).menuOpen, `${name}: the menu should close on Escape`);

  await page.close();
}

/* ---------------- the dashboard owns the app doors; its account menu does not */
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const page = await openPath('/apps/dashboard/index.html', session, viewport);
  const accountButton = page.locator('[data-account-button]');
  if (!(await accountButton.isVisible())) {
    await page.locator('.navbar-toggler').click();
    await accountButton.waitFor({ state: 'visible' });
    await page.waitForFunction(() =>
      !document.querySelector('#navContent')?.classList.contains('collapsing'));
  }

  const appLinks = await page.locator('main a[href="/apps/marp-mosaic-review/"], '
    + 'main a[href="/apps/marp-ml-dashboard/"]').allTextContents();
  check(appLinks.length === 2,
    `${name}: the main dashboard should show both application links, found ${appLinks.length}`);

  await accountButton.click();
  const items = await page.getByRole('menuitem').allTextContents();
  check(items.join('|') === 'Open the dashboard|Sign out',
    `${name}: the dashboard account menu has the wrong items: ${items.join(', ')}`);
  const box = await menuGeometry(page);
  check(box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
    `${name}: the dashboard menu leaves the viewport (${JSON.stringify(box)})`);
  check(box.uncovered,
    `${name}: dashboard content covers the open account menu (${box.covers.join(', ')}; `
      + `${box.ancestors.join(' > ')})`);
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
  console.log(`    ${screens.length} screens, each drawing one account control`);
}

await browser.close();
stop();

if (problems.length) {
  console.error('');
  for (const p of problems) console.error('[x] ' + p);
  process.exit(1);
}
console.log('ok  the account menu is the shared one, and it names nobody it has not been told about');
