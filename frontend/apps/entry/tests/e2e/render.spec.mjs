/**
 * The render tier for the two public pages: does a browser actually draw them.
 *
 * `tests/landing-copy.test.js` in the API reads the markup off disk, which is the
 * fast half and cannot see any of this. A section left at `opacity: 0`, a layout
 * that pushes the document sideways at phone width, a nav anchor pointing at a
 * section that was renamed -- all of them are green in the text tier and visible
 * only once something has laid the page out.
 *
 * Both viewports run every check, because the two failures this is really
 * guarding against belong to different ones: horizontal scroll is a phone
 * problem, and the reveal observer has been caught out on both.
 */
import { test, expect } from '@playwright/test';

/** The two public pages, and the routes they are served at. */
const PAGES = [
  { name: 'the landing page', path: '/' },
  { name: 'how it works', path: '/how-it-works' }
];

/**
 * Loads a page and collects everything that went wrong while it did.
 *
 * `/favicon.ico` is excluded deliberately. Chromium asks for it unprompted and
 * neither the API nor the static server has one, so counting it would make every
 * page fail for something no visitor sees.
 *
 * @param {import('@playwright/test').Page} page the Playwright page.
 * @param {string} path the route to open.
 * @returns {Promise<{response: import('@playwright/test').Response, bad: string[], errors: string[]}>}
 */
async function open(page, path) {
  const bad = [];
  const errors = [];

  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      bad.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  const response = await page.goto(path, { waitUntil: 'load' });

  return { response, bad, errors };
}

/**
 * Scrolls from top to bottom slowly enough that the reveal observer keeps up.
 *
 * This is the whole point of the step size. The reveals are IntersectionObserver
 * driven, and a scroll that jumps further than about a screen between frames
 * leaves whole sections behind at `opacity: 0` -- which is how the page shipped
 * broken once already. A viewport-sized step with a pause after each one is
 * slower than the observer, on purpose.
 *
 * @param {import('@playwright/test').Page} page the Playwright page.
 * @returns {Promise<void>} resolves once the page has been scrolled to the end.
 */
async function scrollWholePage(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = 300;

  for (let y = 0; y < height; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(140);
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
}

for (const { name, path } of PAGES) {

  test.describe(name, () => {

    test('serves without a bad response or a page error', async ({ page }) => {
      const { response, bad, errors } = await open(page, path);

      expect(response.status()).toBe(200);
      expect(bad).toEqual([]);
      expect(errors).toEqual([]);
    });

    /**
     * The trap. Every `data-reveal` element starts transparent and is only made
     * visible by the observer, so one that never receives its `is-visible` is a
     * section of the page a visitor simply does not see.
     */
    test('reveals every section once the page has been scrolled', async ({ page }) => {
      await open(page, path);

      const total = await page.locator('[data-reveal]').count();
      expect(total).toBeGreaterThan(0);

      await scrollWholePage(page);

      const hidden = await page.$$eval(
        '[data-reveal]:not(.is-visible)',
        (elements) => elements.map((element) => element.className || element.tagName)
      );

      expect(hidden).toEqual([]);
    });

    /** Matters most at 390px, where one over-wide child drags the whole document. */
    test('does not scroll sideways', async ({ page }) => {
      await open(page, path);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));

      expect(scrollWidth).toBe(clientWidth);
    });

    /**
     * A renamed section leaves the nav pointing at nothing, and the click does
     * nothing at all rather than failing. `href="#"` on *Forgot password?* is a
     * placeholder and is skipped.
     */
    test('every in-page anchor lands on an element that exists', async ({ page }) => {
      await open(page, path);

      const dangling = await page.$$eval('a[href^="#"]', (links) => links
        .map((link) => link.getAttribute('href'))
        .filter((href) => href.length > 1)
        .filter((href) => !document.getElementById(decodeURIComponent(href.slice(1)))));

      expect(dangling).toEqual([]);
    });

    /** The only way into MARP from these pages, at both widths. */
    test('opens and closes the login dialog', async ({ page }) => {
      await open(page, path);

      const dialog = page.locator('[data-login-dialog]');
      await expect(dialog).toBeHidden();

      // The nav's own button is folded into the burger menu at phone width, so
      // take whichever open control this viewport actually shows.
      await page.locator('[data-login-open]').locator('visible=true').first().click();
      await expect(dialog).toBeVisible();

      await page.locator('[data-login-close]').click();
      await expect(dialog).toBeHidden();
    });
  });
}
