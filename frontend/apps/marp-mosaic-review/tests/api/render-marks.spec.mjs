/**
 * The two kinds of mark, the two commit buttons, the top chrome and the account menu --
 * against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it, and
 * three consequences of that change live in `support.mjs` rather than being repeated per
 * file: the page size follows the viewport, a bare address is not `filters: {}`, and a
 * tile is never chosen by position.
 *
 * Three things in this file are its own:
 *
 * - **A second browser context arrives with no session.** Four checks here build one --
 *   three for a real touchscreen, one for a landscape phone -- and
 *   `/apps/marp-mosaic-review` is session-gated in `app.js`, so each carries the storage
 *   state `tools/api-session.mjs` wrote or the application is not served to it at all.
 *   The fixture tier needed none of this, because its static server gated nothing.
 * - **Who is signed in is read, never named.** The account control draws the reviewer
 *   this run authenticated as, which against the fixture was an invented literal. The
 *   check compares it with `MARP_REVIEW_USERNAME` out of the test process's own
 *   environment -- the same variable `tools/api-session.mjs` signed in with.
 * - **The layout checks ask which project is running, not how wide the window is.**
 *   `isPhone(info)` is the answer; a headless viewport can be clamped and lie about its
 *   width.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { SESSION_FILE } from '../../tools/api-session.mjs';
import { journal } from './journal.mjs';
import {
  expectRealBacking,
  freshTile,
  isPhone,
  openOnBrokenPicture,
  openRail,
  ready,
  undecided,
  watchErrors
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/**
 * Who this run signed in as, from the environment `tools/api-session.mjs` read.
 *
 * Not a literal, and not a name typed here: the account control's whole point is that
 * no application hard-codes a person, so a check that named one would pass against the
 * very bug it exists to catch.
 */
const REVIEWER = process.env.MARP_REVIEW_USERNAME || '';

test.describe('two kinds of mark, and two commit buttons', () => {

  /* `firstReady(page)` is gone: it read `.tile:not(.failed):not(.queued)` and took the
     first, which on a real corpus is frequently a tile carrying a decision -- where a
     click takes that decision *back* rather than marking it. `freshTile` is the
     replacement and pins by `data-id` for the same reason the old helper did. */

  test('R2: a right click marks the tile accepted, and says so', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);

    await tile.click({ button: 'right' });

    await expect(tile).toHaveClass(/marked/);
    await expect(tile).toHaveClass(/accept/);
    await expect(tile.locator('.badge')).toContainText('REVIEWED');
    /* Still exactly one badge per tile (A6). A second element able to reach that slot is
       how a click on a committed tile comes to look like it did nothing. */
    await expect(tile.locator('.badge')).toHaveCount(1);
    /* And it is not the panel's target: an acceptance has nothing in the reason
       vocabulary to say. */
    await expect(tile.locator('[data-badge]')).toHaveCount(0);
  });

  test('R2: in training the accept mark is PROMOTED, in training’s own colour',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      const tile = await freshTile(page);

      await tile.click({ button: 'right' });

      await expect(tile.locator('.badge')).toContainText('PROMOTED');
      await expect(tile.locator('.badge')).toHaveClass(/b-pro/);
      await expect(tile.locator('.badge')).toHaveCount(1);
    });

  test('R7: the later mark wins, whichever way round', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);

    await tile.click();
    await expect(tile.locator('.badge')).toContainText('FLAGGED');

    await tile.click({ button: 'right' });
    await expect(tile.locator('.badge')).toContainText('REVIEWED');
    await expect(tile).toHaveClass(/accept/);

    await tile.click();
    await expect(tile.locator('.badge')).toContainText('FLAGGED');
    await expect(tile).not.toHaveClass(/accept/);

    /* The same gesture twice takes the mark off. */
    await tile.click();
    await expect(tile).not.toHaveClass(/marked/);
  });

  test('R7: a second right click takes the acceptance off', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);

    await tile.click({ button: 'right' });
    await expect(tile).toHaveClass(/accept/);
    await tile.click({ button: 'right' });
    await expect(tile).not.toHaveClass(/marked/);
  });

  test('A4: an accept mark on a tile with no picture is refused, and the tile says why',
    async ({ page, request }) => {
      /* Broken deliberately rather than hoped for: a check that returns early when it
         cannot find a broken tile reports green while proving nothing.

         The fixture's `breakThumbnails` is what used to do the breaking. Nothing is
         broken on purpose now -- the corpus carries rows whose extraction genuinely
         failed, which is what the fixture was imitating, and `openOnBrokenPicture`
         sweeps for one and puts it on screen. */
      const { tile } = await openOnBrokenPicture(page, request);
      await expectRealBacking(page);

      await expect(tile).toHaveClass(/failed/);
      /* It opens on that row's own line rather than on `undecided()`, so the tile can
         arrive already marked from the record -- and a refusal read against a seeded
         mark says nothing. Say so here rather than failing three assertions later. */
      await expect(tile, 'this check needs a broken picture nobody has decided about')
        .not.toHaveClass(/marked/);

      await tile.click({ button: 'right' });

      await expect(tile.locator('.refusal')).toBeVisible();
      await expect(tile.locator('.refusal')).toContainText('No picture');
      await expect(tile).not.toHaveClass(/marked/);
      /* Never the badge slot, which stays one element and belongs to the mark. */
      await expect(tile.locator('.badge')).toHaveCount(0);

      /* Flagging the same tile is still allowed: a picture that never arrived is itself
         worth flagging, and that rule is older than this one. */
      await tile.click();
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
    });

  test('A2: a right click does nothing in Delete Mode, which keeps one button',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await page.locator('.seg button', { hasText: 'Delete' }).click();
      await ready(page);
      const tile = await freshTile(page);

      await tile.click({ button: 'right' });

      await expect(tile).not.toHaveClass(/marked/);
      await expect(tile.locator('.refusal')).toHaveCount(0);
      /* One control, because the main button and today's Delete button would do the
         identical thing and two controls with one meaning is worse than one. */
      await expect(page.locator('#commitMarked')).toBeHidden();
      await expect(page.locator('#commit')).toBeVisible();
      await expect(page.locator('#commit')).not.toHaveClass(/sweep/);
    });

  test('R5: the main button is primary and the sweep is smaller, to its right',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const main = page.locator('#commitMarked');
      const sweep = page.locator('#commit');
      await expect(main).toBeVisible();
      await expect(sweep).toBeVisible();
      await expect(sweep).toHaveClass(/sweep/);

      const a = await main.boundingBox();
      const b = await sweep.boundingBox();
      expect(b.x, 'the sweep sits to the right of the main button').toBeGreaterThan(a.x);

      /* Type size and fill rather than height. Height is not the measure here: the sweep
         carries the Ctrl+Enter hint badge, which makes it the taller of the two while
         being plainly the lesser one. What makes the main button primary is that it is
         filled and set larger, and that is what this measures. */
      const size = (el) => el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
      expect(await size(main), 'the main button is set larger')
        .toBeGreaterThan(await size(sweep));
      const fill = await sweep.evaluate((n) => getComputedStyle(n).backgroundColor);
      expect(fill, 'and the sweep is outlined rather than filled')
        .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

      /* And the pair fits: `.app` clips rather than scrolls, so a footer wider than the
         viewport does not scroll to reveal the button, it cuts it off. */
      const foot = await page.locator('.foot').boundingBox();
      expect(b.x + b.width, 'both buttons are inside the footer')
        .toBeLessThanOrEqual(foot.x + foot.width + 1);
    });

  test('R6: both buttons say what they will do, and disable when they would do nothing',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const main = page.locator('#commitMarked');
      /* Nothing marked by hand yet, whatever the record put on screen (A3). */
      await expect(main).toBeDisabled();
      await expect(main).toContainText('nothing to do');
      /* The sweep has a whole page to act on, so it is live. */
      await expect(page.locator('#commit')).toBeEnabled();

      const tile = await freshTile(page);
      await tile.click({ button: 'right' });
      await expect(main).toBeEnabled();
      await expect(main).toContainText('1 tiles');
    });

  test('R3: the main button writes only what was marked', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    const tile = await freshTile(page);
    const id = await tile.getAttribute('data-id');
    const before = await page.locator('.tile .badge').count();

    await tile.click({ button: 'right' });
    await page.locator('#commitMarked').click();

    /* The committed tile carries its outcome... */
    await expect(page.locator(`.tile[data-id="${id}"] .badge`)).toContainText('REVIEWED');
    /* ...and nothing else on the page gained one. A sweep would have painted the lot. */
    await expect(page.locator('.tile .badge')).toHaveCount(before + 1);
    /* The page is not finished, so the pager does not claim it is. */
    await expect(page.locator('#pagesDone')).toContainText('0');
    expect(errors).toEqual([]);
  });

  test('R4: the sweep still paints the whole page', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);

    await tile.click();
    await page.locator('#commit').click();

    await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
    const reviewed = page.locator('.tile .badge', { hasText: 'REVIEWED' });
    await expect(reviewed.first()).toBeVisible();
    expect(await reviewed.count(), 'the sweep accepts everything unflagged')
      .toBeGreaterThan(1);
  });

  test('A1: a double tap on a touch screen marks the tile accepted', async ({ browser, page }) => {
    /**
     * A real touchscreen, in **both** projects.
     *
     * The desktop project has no touch, so the obvious shape of this test is a skip there
     * -- and a skipped check looks green. A context of its own with `hasTouch` on gives
     * the same gesture at both viewports instead, which is what R8 asks for.
     *
     * Low-level `touchscreen.tap` rather than two `locator.tap()` calls: a locator re-runs
     * its actionability checks each time, and the two taps have to land inside the
     * gesture's window to be one double tap.
     */
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    const { context, touch } = await touchContext(browser, page);
    try {
      const tile = await freshTile(touch);
      const box = await tile.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      /* One tap marks the exception at once -- the first tap is deliberately not
         deferred, because a third of a second of lag on the most repeated gesture in the
         tool is the badly tuned window A1 warned about. */
      await touch.touchscreen.tap(x, y);
      await expect(tile.locator('.badge')).toContainText('FLAGGED');

      /* A second tap inside the window turns it into an acceptance. */
      await touch.touchscreen.tap(x, y);
      await expect(tile.locator('.badge')).toContainText('REVIEWED');
      await expect(tile).toHaveClass(/accept/);
    } finally {
      await context.close();
    }
  });

  test('A1: two taps far enough apart are two separate marks, not a double tap',
    async ({ browser, page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const { context, touch } = await touchContext(browser, page);
      try {
        const tile = await freshTile(touch);
        const box = await tile.boundingBox();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;

        await touch.touchscreen.tap(x, y);
        await expect(tile).toHaveClass(/marked/);
        await touch.waitForTimeout(600);           // past the window
        await touch.touchscreen.tap(x, y);
        await expect(tile).not.toHaveClass(/marked/);
      } finally {
        await context.close();
      }
    });

  test('A1: the main button works from a touch screen too', async ({ browser, page, request }) => {
    /* There is no right click on a phone, so this is the path the human will actually
       use: double tap to accept, then the main button. */
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    const { context, touch } = await touchContext(browser, page);
    /* The commit happens on the second context, which the `beforeEach` ledger cannot
       see -- it is watching `page`. So this page gets a ledger of its own. */
    const touched = journal(touch, request);
    try {
      const tile = await freshTile(touch);
      const id = await tile.getAttribute('data-id');
      const box = await tile.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      await touch.touchscreen.tap(x, y);
      await touch.touchscreen.tap(x, y);
      await expect(tile).toHaveClass(/accept/);

      await touch.locator('#commitMarked').tap();
      await expect(touch.locator(`.tile[data-id="${id}"] .badge`)).toContainText('REVIEWED');
      await expect(touch.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(1);
    } finally {
      await touched.restore(request);
      await context.close();
    }
  });

  test('A6: an accept mark does not dim the picture the way an exception does',
    async ({ page }) => {
      /* Colour is not carrying the distinction on its own: a judgement against a tile
         makes it step back, and an acceptance is the opposite of that. */
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      const tile = await freshTile(page);
      const id = await tile.getAttribute('data-id');
      const img = page.locator(`.tile[data-id="${id}"] img`);

      await tile.click();
      const dimmed = await img.evaluate((el) => getComputedStyle(el).filter);
      expect(dimmed).not.toBe('none');

      await tile.click({ button: 'right' });
      const bright = await img.evaluate((el) => getComputedStyle(el).filter);
      expect(bright).toBe('none');
    });
});

/**
 * The top chrome, out of the way of the mosaic (#151).
 *
 * This tier and no other. Whether the header is on screen, how tall the field is and
 * whether the grid overflows it are rendering facts: the store knows the flag is set and
 * nothing else, so a check there would pass against a stylesheet that does nothing.
 *
 * **Both phone orientations, and they are not the same case.** The narrow project is a
 * Pixel 7 held upright, 412 x 915. Turned on its side it is 915 x 412 -- *wider* than the
 * 760px the app's narrow rules are keyed on -- so a landscape phone gets the desktop
 * layout, and the viewport the issue was actually reported from is invisible to every
 * width-keyed test in this file. The landscape check below builds its own context for
 * that reason, and a resize would not do instead: `topChromeHidden` is read from
 * `matchMedia('(max-height: 600px)')` when the store loads, so the short viewport has to
 * exist before the navigation rather than after it.
 *
 * Which project is running is `isPhone(info)`, never a measured width -- a headless
 * viewport can be clamped and report a number that is not what the page was laid out at.
 */
test.describe('#151 the top chrome', () => {
  /** Both bars, measured the way the reviewer experiences them: height on screen. */
  const chromeHeight = (page) => page.evaluate(() => {
    const h = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().height) : 0;
    };
    return { hdr: h('.hdr'), sub: h('.sub'), field: h('.field'), foot: h('.foot') };
  });

  /** A landscape phone: the case the issue came from, which no width-keyed rule can see. */
  async function landscape(browser, url) {
    const context = await browser.newContext({
      viewport: { width: 915, height: 412 },
      hasTouch: true,
      /* A context of its own starts with no cookies, and the app is session-gated --
         without this it meets the sign-in page and nothing else. */
      storageState: SESSION_FILE
    });
    const wide = await context.newPage();
    await wide.goto(url);
    await expectRealBacking(wide);
    await ready(wide);
    return { context, wide };
  }

  test('R1: the control takes the header and the sub-bar away, and the field gets the pixels',
    async ({ page }, info) => {
      test.skip(!isPhone(info), 'about the phone layout');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const before = await chromeHeight(page);
      expect(before.hdr, 'the header is on screen to begin with').toBeGreaterThan(0);
      expect(before.sub, 'and so is the bar under it').toBeGreaterThan(0);

      await page.locator('#chromebtn').click();

      const after = await chromeHeight(page);
      expect(after.hdr, 'the header is gone from layout, not merely invisible').toBe(0);
      expect(after.sub).toBe(0);
      /* Every pixel, not merely more of them: chrome that hides and gives the space to
         nothing is the same screen the reviewer complained about. */
      expect(after.field - before.field).toBe(before.hdr + before.sub);
    });

  test('R8: the state is on the body, the way the rail already says its own',
    async ({ page }, info) => {
      test.skip(!isPhone(info), 'about the phone layout');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await expect(page.locator('body')).not.toHaveClass(/top-hidden/);
      await page.locator('#chromebtn').click();
      await expect(page.locator('body')).toHaveClass(/top-hidden/);
    });

  test('R2: the control is still reachable once the chrome it hides is gone',
    async ({ page }, info) => {
      test.skip(!isPhone(info), 'about the phone layout');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      const before = await chromeHeight(page);

      const btn = page.locator('#chromebtn');
      await btn.click();
      /* The whole of R2: a control living inside the header cannot bring the header back,
         and a reviewer who hides the chrome on a phone has no other way to reach it. */
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');

      await btn.click();
      const back = await chromeHeight(page);
      expect(back.hdr).toBe(before.hdr);
      expect(back.sub).toBe(before.sub);
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
    });

  test('R3: the footer and both commit buttons are untouched', async ({ page }, info) => {
    test.skip(!isPhone(info), 'about the phone layout');
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const before = await chromeHeight(page);

    await page.locator('#chromebtn').click();

    /* This issue is about the *top* chrome. The footer carries the commit buttons, which
       are the point of the page, and hiding them is a separate question nobody has
       answered -- so a change that quietly took them too would be out of scope and wrong. */
    const after = await chromeHeight(page);
    expect(after.foot).toBe(before.foot);
    await expect(page.locator('#commit')).toBeVisible();
    await expect(page.locator('#commitMarked')).toBeVisible();
  });

  test('R4: a mark made before the chrome is hidden is still there after',
    async ({ page }, info) => {
      test.skip(!isPhone(info), 'about the phone layout');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      /* Hiding the chrome grows the field, and the page size follows the field -- so this
         re-queries. The marks must survive that, or the control costs the reviewer the
         work they had already done on the page. */
      const tile = await freshTile(page);
      const id = await tile.getAttribute('data-id');
      await page.locator(`.tile[data-id="${id}"]`).click();
      await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);

      await page.locator('#chromebtn').click();
      await ready(page);
      await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);
    });

  test('R5: on a landscape phone the chrome starts out of the way',
    async ({ browser, page }, info) => {
      test.skip(!isPhone(info), 'one landscape context is enough');
      /* The main page is only opened to resolve the address: a second context has no
         `baseURL` of its own, so the absolute URL has to come from this one. */
      await page.goto(undecided());
      await expectRealBacking(page);

      const { context, wide } = await landscape(browser, page.url());
      try {
        /* The reported case: 915 x 412, where the chrome was 120 of 412 pixels. It starts
           hidden here and nowhere else, because this is the viewport that cannot spare it. */
        await expect(wide.locator('body')).toHaveClass(/top-hidden/);
        const hidden = await chromeHeight(wide);
        expect(hidden.hdr).toBe(0);
        expect(hidden.sub).toBe(0);

        await wide.locator('#chromebtn').click();
        const shown = await chromeHeight(wide);
        expect(shown.hdr).toBeGreaterThan(0);
        expect(hidden.field - shown.field).toBe(shown.hdr + shown.sub);
      } finally {
        await context.close();
      }
    });

  test('R7: the rail overlay follows the chrome rather than hanging below where it was',
    async ({ page }, info) => {
      test.skip(!isPhone(info), 'the rail only overlays the mosaic here');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      await page.locator('#chromebtn').click();
      await openRail(page);

      /* The overlay is positioned against the viewport, and its top was the header and
         sub-bar measured by hand. With them gone it has to come up with them, or it floats
         70px into the mosaic with 70px of nothing above it. */
      const top = await page.locator('.rail')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top));
      expect(top).toBeLessThan(10);

      /* And `.app` still clips rather than scrolls, which is what #151 was warned about. */
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    });

  test('R6: a desktop has no such control, because it has no such problem',
    async ({ page }, info) => {
      test.skip(isPhone(info), 'about the desktop layout');
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      /* Present in the markup and not displayed, asserted as two things. `toBeHidden`
       * alone is also true of an element that does not exist, so on its own this check
       * passed against the code before #151 -- a test that cannot go red is not a test. */
      await expect(page.locator('#chromebtn')).toHaveCount(1);
      await expect(page.locator('#chromebtn')).toBeHidden();
      await expect(page.locator('body')).not.toHaveClass(/top-hidden/);
      await expect(page.locator('.hdr')).toBeVisible();
    });
});

/**
 * The account menu, which is one shared component now (#151).
 *
 * This app used to draw its own, and the ML Dashboard drew a third with a person's name
 * typed into it. They are one control in `frontend/shared/assets/js/account-menu.js`, and
 * the rule that matters is that **no application here hard-codes a person**: this app's own
 * notes record the literal `'I. Travers'` shipping once and telling everybody they were one
 * developer.
 *
 * The render tier and no other: whether the header draws the control, what it says, and
 * whether it survives a re-render are all facts about the document.
 *
 * **Against a real server the identity is real**, which is what makes R23 worth more here
 * than it was on the fixture: the name came from an invented row there, and it comes from
 * `/api/v2/auth/me` now. So the check reads `MARP_REVIEW_USERNAME` -- the variable
 * `tools/api-session.mjs` signed in with -- rather than naming anybody.
 */
test.describe('#151 the account menu', () => {
  /** What the control says, and who the application thinks is signed in. */
  const readAccount = (page) => page.evaluate(() => {
    const root = document.querySelector('[data-account]');
    const button = root && root.querySelector('[data-account-button]');
    return {
      controls: document.querySelectorAll('[data-account]').length,
      initials: button ? button.textContent.trim() : null,
      nobody: button ? button.hasAttribute('data-account-nobody') : null,
      who: root ? root.querySelector('[data-account-who]').textContent.trim() : null,
      menuOpen: root ? !root.querySelector('[data-account-menu]').hidden : null,
      /* The identity the store holds, so a test can tell "drawn from state" from
         "drawn from a literal that happens to match". */
      me: window.MARP && window.MARP.state.me
    };
  });

  test('R23: the header draws one shared account control, and it is the shared one',
    async ({ page }, info) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const seen = await readAccount(page);
      expect(seen.controls, 'exactly one, drawn by the shared component').toBe(1);
      await expect(page.locator('[data-account-menu]')).toBeHidden();

      /* **On a phone this app puts the account menu away on purpose**, and has since
         before this component existed: `.hdr .right` is hidden below 760px because the
         width belongs to the mosaic. Converting to the shared control does not change that
         decision, so the phone asserts it rather than skipping past it. */
      if (isPhone(info)) {
        await expect(page.locator('[data-account-button]')).toBeHidden();
        return;
      }
      await expect(page.locator('[data-account-button]')).toBeVisible();
    });

  test('R23: it draws whoever the backing says is signed in, not a literal',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const seen = await readAccount(page);
      expect(seen.me, 'the store knows who is signed in').toBeTruthy();

      /* And it is the reviewer *this run* signed in as, which is the half the fixture
         could not assert: its identity was invented, so any name matched it. Read from
         the environment `tools/api-session.mjs` used rather than written down here --
         a literal would pass against the very bug this check exists for. */
      expect(REVIEWER, 'MARP_REVIEW_USERNAME is how the session was made; without it '
        + 'this check cannot tell a real identity from an invented one').toBeTruthy();
      expect(seen.me.username, 'the header draws the signed-in reviewer').toBe(REVIEWER);

      /* Derived from the identity the application holds, rather than compared against a
         string written here -- a hard-coded avatar would pass any assertion that named the
         same two letters, which is exactly how the old bug survived. */
      const parts = String(seen.me.name).split(/[\s.]+/).filter(Boolean);
      const expected = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();

      expect(seen.initials).toBe(expected);
      expect(seen.nobody, 'somebody is signed in, so it is not drawn as nobody').toBe(false);
      expect(seen.who).toBe(`Signed in as ${seen.me.name}`);
    });

  test('R23: it opens, and it shuts', async ({ page }, info) => {
    test.skip(isPhone(info), 'this app puts the control away on a phone');
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    await page.locator('[data-account-button]').click();
    await expect(page.locator('[data-account-menu]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-account-menu]')).toBeHidden();
  });

  test('R24: it survives a re-render', async ({ page }, info) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const before = await readAccount(page);

    /* This app redraws its chrome from state on every notify, so a component that mounted
       itself once could be wiped by the next thing that happened. Marking a tile is the
       most ordinary thing a reviewer does and it notifies. */
    const tile = await freshTile(page);
    const id = await tile.getAttribute('data-id');
    await page.locator(`.tile[data-id="${id}"]`).click();
    await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);

    const after = await readAccount(page);
    expect(after.controls).toBe(1);
    expect(after.initials).toBe(before.initials);
    expect(after.who).toBe(before.who);

    /* And it still works afterwards, which "still painted" does not prove. Desktop only,
       because the control is deliberately not on screen at phone width here. */
    if (isPhone(info)) return;
    await page.locator('[data-account-button]').click();
    await expect(page.locator('[data-account-menu]')).toBeVisible();
  });
});

/**
 * A second browser context with a real touchscreen, carrying this run's session.
 *
 * Local to this file because `support.mjs` is shared and being edited elsewhere. Two
 * things it adds to the `browser.newContext` the fixture tier wrote inline, and both are
 * consequences of there being a real server underneath:
 *
 * - **`storageState`.** A new context starts with no cookies, and
 *   `/apps/marp-mosaic-review` is session-gated in `app.js` -- so without the state
 *   `tools/api-session.mjs` wrote, the second page is served the sign-in panel and the
 *   failure reads as the application not drawing any tiles.
 * - **The URL rather than an address.** A context built this way has no `baseURL`, so
 *   `./?...` means nothing in it; the absolute address comes from the page the project
 *   already opened.
 *
 * @param {import('@playwright/test').Browser} browser - Playwright's browser fixture.
 * @param {import('@playwright/test').Page} page - The already-open page, for its size and URL.
 * @returns {Promise<Object>} `{context, touch}`. The caller closes the context.
 */
async function touchContext(browser, page) {
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    hasTouch: true,
    storageState: SESSION_FILE
  });
  const touch = await context.newPage();
  await touch.goto(page.url());
  await expectRealBacking(touch);
  await ready(touch);
  return { context, touch };
}
