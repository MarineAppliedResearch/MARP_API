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
 * **The session probe is excluded on the same grounds, and only on the same grounds.**
 * The header asks `/api/v2/auth/me` who is signed in, and for a visitor the answer is
 * 401 -- that is the endpoint's designed answer, not a fault, and the page it produces
 * is the signed-out page a visitor is supposed to see. In this tier there is no API at
 * all, so the static server answers 404 to the same question. Both are the *expected*
 * outcome of asking; anything else from that URL, a 500 in particular, still fails.
 *
 * @param {import('@playwright/test').Page} page the Playwright page.
 * @param {string} path the route to open.
 * @returns {Promise<{response: import('@playwright/test').Response, bad: string[], errors: string[]}>}
 */
async function open(page, path) {
  const bad = [];
  const errors = [];

  /** The two answers that mean `no session`, from the one URL that asks. */
  const expectedFromTheProbe = (response) =>
    response.url().endsWith('/api/v2/auth/me') && [401, 404].includes(response.status());

  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (response.url().endsWith('/favicon.ico')) return;
    if (expectedFromTheProbe(response)) return;
    bad.push(`${response.status()} ${response.url()}`);
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

/**
 * The hero has to fit the screen it is opened on.
 *
 * This is the one check keyed on viewport HEIGHT rather than width, and it is
 * here because nothing keyed on width could see the failure. `.hero` carried
 * `min-height: max(760px, 100svh)`, so a floor of 760px applied however short
 * the screen was. On a phone held sideways, which is about 340px tall, the
 * entire first screen was the header and an empty photograph: the headline, the
 * paragraph and both buttons were all below the fold, and the page looked like
 * it had failed to load its content.
 *
 * It runs on every project on purpose. A desktop window dragged short is the
 * same failure, and the two phone projects differ by orientation alone.
 */
test.describe('the landing page hero', () => {
  test('puts the headline, the copy and both buttons on the first screen', async ({ page }) => {
    await open(page, '/');

    /**
     * Wait for the hero to finish revealing itself before measuring it.
     *
     * `.hero__copy` is a `data-reveal` element, so it starts 22px low and animates up over
     * 650ms once the observer fires. Measured mid-animation the buttons end at 342 of 340
     * and this fails; measured settled they end at 320, with room to spare. It was the
     * animation being caught in flight, not the layout: the page measures the same every
     * time once it has arrived.
     *
     * This was flaky before #151 -- two runs in eight -- and #151 made it likelier, four in
     * eight, by adding a script and a request to the page's load. Neither moves the hero;
     * they change which frame the measurement lands on, which is the test's own
     * assumption to fix rather than something to work around.
     */
    await page.waitForFunction(() => {
      const copy = document.querySelector('.hero__copy');
      if (!copy || !copy.classList.contains('is-visible')) return false;
      const shift = new DOMMatrix(getComputedStyle(copy).transform).m42;
      return Math.abs(shift) < 0.5;
    }, null, { timeout: 5000 });

    const offscreen = await page.evaluate(() => {
      const fold = document.documentElement.clientHeight;

      return [
        ['headline', '.hero h1'],
        ['paragraph', '.hero__copy > p'],
        ['buttons', '.hero__actions']
      ]
        .map(([label, selector]) => {
          const element = document.querySelector(selector);

          if (!element) {
            return `${label}: missing`;
          }

          const box = element.getBoundingClientRect();

          return box.top >= 0 && box.bottom <= fold
            ? null
            : `${label}: ${Math.round(box.top)}..${Math.round(box.bottom)} of ${fold}`;
        })
        .filter(Boolean);
    });

    expect(offscreen).toEqual([]);
  });
});

/**
 * The header gets out of the reader's way, and knows who is reading (#151).
 *
 * Two things that are one header. It follows the reading down the page and comes back on
 * the way up, and it carries either the invitation to sign in or the account menu,
 * depending on an answer only the server has.
 *
 * `phone-landscape` is where the first of those matters most: the header is 70px of a
 * 340px screen, a fifth of everything, and permanently there before this.
 */
test.describe('#151 the header', () => {
  /** Where the header is, and what it thinks it is doing. */
  const readHeader = (page) => page.evaluate(() => {
    const header = document.querySelector('[data-site-header]');
    const box = header.getBoundingClientRect();
    return {
      hidden: header.classList.contains('is-hidden'),
      bottom: Math.round(box.bottom),
      height: Math.round(box.height),
      y: Math.round(window.scrollY)
    };
  });

  /**
   * Scroll, and wait until the page has actually arrived.
   *
   * `html` carries `scroll-behavior: smooth`, so `scrollTo` starts an animation rather
   * than moving: asserting on a fixed timeout measured wherever the page had got to,
   * which made the pixel-exact checks below read the wrong position and fail for a reason
   * that had nothing to do with the threshold.
   */
  const scrollTo = async (page, y) => {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForFunction(
      (to) => Math.abs(Math.round(window.scrollY) - to) <= 1,
      y,
      { timeout: 5000 }
    ).catch(() => { /* a page too short to reach it is the caller's business */ });
    await page.waitForTimeout(160);
  };

  /**
   * Put the header's own controls where they can be reached.
   *
   * Below 1100px the whole primary navigation folds behind the hamburger, and the Login
   * button and the account menu fold with it -- they are inside that nav, which is exactly
   * where this page has always kept the Login button. So on a phone these are reached the
   * way a person reaches them: by opening the sheet.
   */
  const revealNav = async (page) => {
    const toggle = page.locator('[data-menu-toggle]');
    if (await toggle.isVisible()) await toggle.click();
  };

  /** A session, so the header can be asked to draw its signed-in half. */
  const signedIn = (page, user = { user_id: 4, name: 'Ada Lovelace', username: 'ada', permissions: [] }) =>
    page.route('**/api/v2/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user })
    }));

  test('R16: it leaves on the way down the page and comes back on the way up',
    async ({ page }) => {
      await page.goto('/');
      const start = await readHeader(page);
      expect(start.hidden, 'the header is there to begin with').toBe(false);
      expect(start.height).toBeGreaterThan(40);

      await scrollTo(page, 700);
      const down = await readHeader(page);
      expect(down.hidden, 'scrolling down should move it out of the way').toBe(true);
      /* Off the screen, not merely marked: a class that draws nothing is the failure this
         tier exists to catch. */
      expect(down.bottom).toBeLessThanOrEqual(0);

      await scrollTo(page, 560);
      const up = await readHeader(page);
      expect(up.hidden, 'turning round should bring it straight back').toBe(false);
      expect(up.bottom).toBeGreaterThan(0);
    });

  test('R16: a few pixels of noise does not flap it', async ({ page }) => {
    /**
     * Reduced motion, so that a scroll is one event at a known position.
     *
     * `html` carries `scroll-behavior: smooth`, so an ordinary `scrollTo` arrives as a
     * decelerating sequence -- and the header's reference point is the last position at
     * which it made a decision, which during that deceleration sits a few pixels short of
     * where the page comes to rest. That is correct behaviour and it makes an exact
     * threshold untestable: the first version of this test believed the reference was 700
     * when it was 696, and failed against an implementation doing exactly what it should.
     * Section 14 turns smooth scrolling off under reduced motion, which makes each move
     * below a single event from a position this test knows.
     */
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await scrollTo(page, 700);
    expect((await readHeader(page)).hidden).toBe(true);

    /* A trackpad twitch and the bounce at the end of a momentum scroll are not
       instructions. Three pixels, then five, are still noise. */
    await scrollTo(page, 697);
    expect((await readHeader(page)).hidden, 'three pixels is noise').toBe(true);
    await scrollTo(page, 695);
    expect((await readHeader(page)).hidden, 'five pixels is still noise').toBe(true);

    /* But the mark is not reset by movement that small, so a slow deliberate scroll
       accumulates and is heard. */
    await scrollTo(page, 693);
    expect((await readHeader(page)).hidden, 'seven pixels is a decision').toBe(false);
  });

  test('R17: at the top of the page the header is always there', async ({ page }) => {
    await page.goto('/');
    await scrollTo(page, 900);
    expect((await readHeader(page)).hidden).toBe(true);

    await scrollTo(page, 0);
    const top = await readHeader(page);
    expect(top.hidden, 'the first screen is the whole first impression').toBe(false);
    expect(top.bottom).toBe(top.height);
  });

  test('R17: it does not slide out from under an open navigation sheet',
    async ({ page }, info) => {
      test.skip(info.project.name === 'desktop', 'the sheet is a phone control');
      await page.goto('/');

      /* The same scroll, with the sheet shut, to show that this test is watching a header
         that does move. Without it the check passes against any page whose header never
         hides at all, which is every version of this page before #151. */
      await scrollTo(page, 700);
      expect((await readHeader(page)).hidden, 'the header does move when nothing is open')
        .toBe(true);
      await scrollTo(page, 0);

      await page.locator('[data-menu-toggle]').click();
      await expect(page.locator('[data-menu-toggle]')).toHaveAttribute('aria-expanded', 'true');

      /* The navigation lives inside the header, so hiding the header here takes the menu
         away mid-tap. */
      await scrollTo(page, 700);
      expect((await readHeader(page)).hidden).toBe(false);
    });

  test('R18: signed out, the header keeps the invitation to sign in', async ({ page }) => {
    await page.goto('/');
    await revealNav(page);
    /* No session and, in this tier, no API to ask -- which must read as `not signed in`
       rather than as an error on the page.

       Present and hidden, asserted as two things: `toBeHidden` is also true of an element
       that does not exist, so on its own this passes against the page before #151. */
    await expect(page.locator('[data-account]')).toHaveCount(1);
    await expect(page.locator('[data-account]')).toBeHidden();
    await expect(page.locator('.site-header [data-login-open]')).toBeVisible();
  });

  test('R21: a probe that fails outright still draws the signed-out header',
    async ({ page }) => {
      await page.route('**/api/v2/auth/me', (route) => route.fulfill({ status: 500, body: '' }));
      await page.goto('/');
      await page.waitForTimeout(300);
      await revealNav(page);
      await expect(page.locator('[data-account]')).toHaveCount(1);
      await expect(page.locator('[data-account]')).toBeHidden();
      await expect(page.locator('.site-header [data-login-open]')).toBeVisible();
    });

  test('R19: signed in, the header carries the account menu instead', async ({ page }) => {
    await signedIn(page);
    await page.goto('/');
    await revealNav(page);

    const account = page.locator('[data-account]');
    await expect(account).toBeVisible();
    /* The initials the Mosaic Reviewer draws, from the same two name parts. */
    await expect(page.locator('[data-account-button]')).toHaveText('AL');
    /* And the invitation is gone: a person already in MARP is not asked to sign in again. */
    await expect(page.locator('.site-header [data-login-open]')).toBeHidden();

    await expect(page.locator('[data-account-menu]')).toBeHidden();
    await page.locator('[data-account-button]').click();
    await expect(page.locator('[data-account-menu]')).toBeVisible();
    await expect(page.locator('[data-account-who]')).toHaveText('Signed in as Ada Lovelace');

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-account-menu]')).toBeHidden();
  });

  test('R19: signing out tells the server rather than only closing the menu',
    async ({ page }) => {
      await signedIn(page);
      let askedToSignOut = false;
      await page.route('**/api/v2/auth/logout', (route) => {
        askedToSignOut = true;
        return route.fulfill({ status: 204, body: '' });
      });

      await page.goto('/');
      await revealNav(page);
      await page.locator('[data-account-button]').click();
      await page.locator('[data-account-signout]').click();
      await page.waitForTimeout(400);

      expect(askedToSignOut, 'a menu that forgets the session has not signed anybody out')
        .toBe(true);
    });

  test('R22: reduced motion keeps the behaviour and drops the animation',
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');

      const duration = await page.evaluate(() =>
        getComputedStyle(document.querySelector('[data-site-header]')).transitionDuration);
      /* Section 14 of landing.css answers this for the whole page with
         `transition-duration: 0.001ms !important`, so the honest assertion is that nothing
         animates perceptibly rather than that the number is exactly zero. */
      expect(parseFloat(duration), 'no animation under reduced motion').toBeLessThan(0.01);

      /* The animation is what goes, not the behaviour. */
      await scrollTo(page, 700);
      expect((await readHeader(page)).hidden, 'the behaviour stays').toBe(true);
    });
});
