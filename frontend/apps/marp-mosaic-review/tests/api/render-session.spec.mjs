/**
 * A page reset, a mode's own session work, "Marked this page", and what the commit
 * button says about itself -- against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Thirteen
 * checks, each asserting exactly what its ancestor asserted; what changed is the thing
 * underneath them. Four of those changes decide whether a check is about the
 * application or about the corpus, and they are worth naming once here rather than
 * thirteen times below:
 *
 * - **`slowNextCommit` and `failNextCommit` are `page.route()`.** The fixture delayed
 *   and threw inside its own `commitPage`, so what it proved was that the simulation
 *   worked. An abort makes the browser's real request fail, and a route that fetches,
 *   waits, and then fulfils with the real response makes the application genuinely wait
 *   for a server. `affordances.spec.mjs` is where the technique comes from.
 * - **`setMode` puts the app back on the mode's default status filters** --
 *   `state.filters = filters.defaultStatusFor(mode, state.filters)` -- so a reviewer who
 *   opened on a narrowed question returns to the *default* one after a trip through
 *   another mode. A check that compares an arrival count with a return count is
 *   therefore about the default question on both sides, whatever address it opened on.
 * - **An exclusion is made and then found.** On a real corpus the row just excluded is
 *   not promised a place on page one of the widened question, so where it landed is
 *   asked for rather than hoped for.
 * - **No tile is chosen by position.** `freshTile` is why: a tile carrying a decision
 *   takes that decision *back* when clicked, so `.first()` on a real corpus frequently
 *   clicks something that never gains `marked`.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  closeRail,
  expectRealBacking,
  findPageOf,
  freshTile,
  openRail,
  pageSizeOf,
  ready,
  undecided
} from './support.mjs';

/** The route a scientific page commit goes to. What the held and aborted commits take. */
const REVIEW_ROUTE = '**/api/v2/mosaic/observations/review';

/** Long enough that a mode switch lands in the middle of a commit rather than after it. */
const HELD_LONG = 4000;

/** Long enough to read the busy state off the button, and short enough not to cost a run. */
const HELD_BRIEFLY = 1500;

/** Every check here may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

test.describe('a page resets, and a commit stays in its own mode', () => {
  /**
   * Training, with an exclusion genuinely on the record and in view.
   *
   * The exclusion is *made* rather than looked for. Waiting for the fixture to happen to
   * put one on the first page worked on a desktop and skipped on a phone, where fewer
   * tiles fit — and a skipped test reports green while proving nothing.
   *
   * Two steps are new against a real corpus. The widened question holds every excluded
   * row in the database rather than the handful the fixture invented, so **which page
   * ours landed on is asked for**; and the re-read is a fresh load rather than reaching
   * into the store to empty it, which is the honest version of the same thing.
   *
   * @param {import('@playwright/test').Page} page - The page to drive.
   * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
   * @param {Object} info - Playwright's `testInfo`, for the viewport the rail depends on.
   * @returns {Promise<string>} The observation id that was excluded.
   */
  async function trainingWithExclusions(page, request, info) {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);

    /* Exclude one and commit, so the record carries it. Then it seeds as a mark on every
       later visit, which is the state both of these tests are about. */
    const tile = await freshTile(page);
    const id = await tile.getAttribute('data-id');
    await tile.click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'PROMOTED' }).first()).toBeVisible();

    await openRail(page);                       // collapsed by default on a phone
    await page.locator('#statusFilters [data-statuskey]', { hasText: 'Excluded' }).click();
    await ready(page);

    /* Re-query so the exclusion arrives from the record rather than sitting in the marks
       the commit left behind — otherwise these tests would pass on session state. A fresh
       load clears every one of them at once, and it has to name the page: the widened
       question is over the whole corpus and ours has no claim on page one. */
    const narrowed = { reviewStatus: [], trainingDisposition: ['undecided', 'excluded'] };
    const onPage = await findPageOf(request, narrowed, Number(id), await pageSizeOf(page));
    await page.goto(`./?mode=training&trainingDisposition=undecided,excluded&page=${onPage}`);
    await ready(page);

    /* Give the mosaic the screen back. On a phone the rail is an overlay, so leaving it
       open makes every tile present but covered — Playwright reports the element as
       resolved and never visible, which reads like a missing tile and is not one. */
    await closeRail(page, info);
    await expect(page.locator(`.tile[data-id="${id}"] .badge`)).toContainText('EXCLUDED');
    return id;
  }

  test('R1: Clear puts the page back as it arrived, and tags nothing taking back',
    async ({ page, request }, info) => {
      await trainingWithExclusions(page, request, info);

      const excluded = page.locator('.tile .badge', { hasText: 'EXCLUDED' });
      const before = await excluded.count();

      await page.keyboard.press('c');
      await page.waitForTimeout(600);

      /* Clearing used to empty the marks and mark every row on the page as hand-decided,
         which is never re-seeded — so the record's exceptions lost their mark, read as
         TAKING BACK, and the next commit would have promoted them. Reported 2026-09-08. */
      await expect(page.locator('.tile .badge', { hasText: 'TAKING BACK' })).toHaveCount(0);
      await expect(excluded).toHaveCount(before);
      expect(await page.evaluate(() => window.MARP.state.touched.size)).toBe(0);
    });

  test('R2: TAKING BACK still appears when the reviewer clicks an exclusion',
    async ({ page, request }, info) => {
      await trainingWithExclusions(page, request, info);
      const tagged = page.locator('.tile', { has: page.locator('.badge', { hasText: 'EXCLUDED' }) });

      /* The rule the fix must not break: one click on an excluded tile is exactly when
         taking back is meant to show. */
      const id = await tagged.first().getAttribute('data-id');
      await page.locator(`.tile[data-id="${id}"]`).click();
      await expect(page.locator(`.tile[data-id="${id}"] .badge`)).toContainText('TAKING BACK');
    });

  test('R3: a commit landing after a mode switch paints nothing in the new mode',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      /* Hold the commit open so the switch lands in the middle of it, rather than racing
         a real round trip and reporting the wrong thing one run in ten. `slowNextCommit`,
         replaced: the request is really made and its real answer is handed back late, so
         what the mode switch interrupts is the application waiting for a server. */
      await holdTheCommit(page, HELD_LONG);

      try {
        const tile = await freshTile(page);
        await tile.click();
        await page.locator('#commit').click();
        await page.waitForTimeout(300);

        await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
        await ready(page);
        await page.waitForTimeout(HELD_LONG + 1500);   // let the scientific commit land

        /* `setMode` clears the outcomes for a reason: two independent decisions must not
           wear each other's answer. The commit path wrote them back unconditionally, so a
           whole page of scientific badges appeared in Training. */
        await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
        await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' })).toHaveCount(0);
        expect(await page.evaluate(() => window.MARP.state.outcomes.size)).toBe(0);
        expect(await page.evaluate(() => window.MARP.state.committedPages.size)).toBe(0);
      } finally {
        await page.unroute(REVIEW_ROUTE);
      }
    });

  test('R4: a commit that stays in its own mode still applies', async ({ page }) => {
    /* The other half. A guard that discarded every commit would pass R3 and be useless. */
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    expect(await page.evaluate(() => window.MARP.state.committedPages.size)).toBe(1);
  });
});

test.describe('a mode keeps its own session work', () => {
  /** Commit the page we are on, and wait for it to land. */
  async function commitAndSettle(page) {
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    await ready(page);
  }

  const mode = (page) => page.evaluate(() => window.MARP.state.mode);
  const session = (page) => page.evaluate(() => ({
    pins: window.MARP.state.pageMembers.size,
    committed: window.MARP.state.committedPages.size,
    outcomes: window.MARP.state.outcomes.size,
    marks: window.MARP.state.marks.size
  }));

  test('R1: what was reviewed is still there after a trip through another mode',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await commitAndSettle(page);
      await page.locator('[data-page="next"]').click();
      await ready(page);                          // step off it, so its chip is drawn
      const before = await session(page);
      const chipsBefore = await page.locator('.pg.done').count();
      expect(before.committed).toBe(1);
      expect(chipsBefore).toBe(1);

      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
      await ready(page);

      /* `setMode` used to throw the pins, the committed pages and the outcomes away. That
         stopped one mode wearing another's answers and discarded the reviewer's session
         with it: three pages reviewed, one glance at Training, and no way back to what had
         been submitted. Reported 2026-09-08. */
      const after = await session(page);
      expect(after.pins).toBe(before.pins);
      expect(after.committed).toBe(before.committed);
      expect(after.outcomes).toBe(before.outcomes);
      /* `setMode` lands on page 1, which is the committed one, so it is already on screen.
         It is served from the pin rather than re-queried, which is what makes this true
         against an endpoint that does not write the row's own status column back. */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

      /* Step off it to see its chip: the current page is a typable input rather than a
         chip, so it carries neither `data-page` nor the committed class. */
      await page.locator('[data-page="next"]').click();
      await ready(page);
      expect(await page.locator('.pg.done').count()).toBe(chipsBefore);
    });

  test('R2: uncommitted marks do not travel', async ({ page }) => {
    /* **The default question, deliberately, and this is the one check here that opens on
       it.** `setMode` resets the status filters to the mode's own defaults, so a reviewer
       who arrives on a narrowed question comes back from Training on the default one --
       and the arrival count this compares against would then be a count of a different
       page. `freshTile` still picks a tile nobody has decided about, which is the only
       thing `undecided()` would have bought. */
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);

    const before = (await session(page)).marks;
    const tile = await freshTile(page);
    await tile.click();
    expect((await session(page)).marks).toBe(before + 1);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
    await ready(page);

    /* An uncommitted mark is a pending intention the reviewer walked away from. Only
       what reached the record comes back — and the record's own exceptions re-seed, which
       is why this compares against the arrival count rather than zero. */
    expect((await session(page)).marks).toBe(before);
  });

  test('R3: the other mode still sees none of this mode\'s outcomes', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await commitAndSettle(page);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);

    /* The isolation the clearing was protecting has to survive the parking. `.badge` is
       what this mode says; a REVIEWED tag from the record may legitimately appear as an
       `.rtag` under #85, and that is a different element on purpose. */
    expect(await mode(page)).toBe('training');
    expect((await session(page)).outcomes).toBe(0);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
  });

  test('R4: changing the question drops every mode\'s pinned pages', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await commitAndSettle(page);
    expect((await session(page)).committed).toBe(1);

    await openRail(page);                       // collapsed by default on a phone
    await page.locator('#railReset').click();
    await ready(page);

    /* A different question means a different result, so page 2 is not the same page 2.
       Parked pins would restore pages the filter no longer returns. */
    expect(await page.evaluate(() => window.MARP.state.parked.size)).toBe(0);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
    await ready(page);
    expect((await session(page)).committed).toBe(0);
  });
});

test.describe('"Marked this page" means this page', () => {
  const counter = (page) => page.locator('#markedCount');

  test('R1: a page you have not touched reads zero, and counts only its own marks',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      /* Mark two here, then walk to a page nobody has touched. `state.marks` spans the
         session by design, so the counter read the session total and only ever went up —
         a fresh page showed the marks left behind on the last one. Reported 2026-09-08. */
      const first = await freshTile(page, { at: 0 });
      const second = await freshTile(page, { at: 1 });
      await first.click();
      await second.click();
      const here = Number(await counter(page).innerText());
      expect(here).toBeGreaterThanOrEqual(2);

      await page.locator('[data-page="next"]').click();
      await ready(page);
      const fresh = Number(await counter(page).innerText());
      const seeded = await page.locator('.tile.marked').count();
      expect(fresh, 'a new page counts what is marked on it, not what was left behind')
        .toBe(seeded);
      expect(fresh).toBeLessThan(here);

      /* And marking here moves it by one, from the page's own number. */
      const onThisPage = await freshTile(page);
      await onThisPage.click();
      expect(Number(await counter(page).innerText())).toBe(fresh + 1);
    });

  test('R2: going back to a page shows its own count again', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const one = await freshTile(page, { at: 0 });
    const two = await freshTile(page, { at: 1 });
    await one.click();
    await two.click();
    const first = Number(await counter(page).innerText());

    await page.locator('[data-page="next"]').click();
    await ready(page);
    await page.locator('[data-page="prev"]').click();
    await ready(page);

    /* The marks themselves must still be there — this is a display fix, not a change to
       what a mark survives. */
    expect(Number(await counter(page).innerText())).toBe(first);
    expect(await page.locator('.tile.marked').count()).toBe(first);
  });

  test('R3: Delete Mode names the number on this page, before destroying anything',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      const marking = await freshTile(page);
      await marking.click();

      await page.locator('.seg button', { hasText: 'Delete' }).click();
      await ready(page);
      const doomed = await freshTile(page);
      await doomed.click();
      await page.locator('[data-page="next"]').click();
      await ready(page);

      /* The dangerous one. This note said "Permanently deletes the N marked tiles" with N
         being a session total, in front of an irreversible action. Nothing is committed
         here, so nothing is destroyed: a mark is not a decision. */
      const marked = await page.locator('.tile.marked').count();
      expect(Number(await counter(page).innerText())).toBe(marked);
      const note = await page.locator('#commitNote, #modeNote').first().innerText()
        .catch(() => '');
      if (/Permanently deletes the (\d+)/.test(note)) {
        expect(Number(note.match(/Permanently deletes the (\d+)/)[1])).toBe(marked);
      }
    });
});

test.describe('the commit button reports on itself', () => {
  test('it spins while saving, then confirms', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    /* Held open on purpose. The fixture answered after 260 ms of invented latency, which
       is a busy state there to be caught; a real commit can land between two polls, and a
       check that only passes when the server is slow is a flake rather than a test. The
       real request is made and the real answer handed over late, so the commit lands. */
    await holdTheCommit(page, HELD_BRIEFLY);

    const commit = page.locator('#commit');
    const before = await commit.innerText();

    try {
      await commit.click();
      await expect(commit.locator('.spin')).toBeVisible();
      await expect(commit).toContainText('Saving');
      await expect(commit).toBeDisabled();

      await expect(commit).toContainText('Saved');
      await expect(commit).toHaveClass(/ok/);
      await expect(commit).toBeEnabled();

      /* The tick is an acknowledgement, not a state: it goes away again. */
      await expect(commit).toContainText(before.split('·')[0].trim(), { timeout: 6000 });
    } finally {
      await page.unroute(REVIEW_ROUTE);
    }
  });

  test('a failed commit says so, and changes nothing', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    const id = await tile.getAttribute('data-id');
    await page.locator(`.tile[data-id="${id}"]`).click();

    /* `failNextCommit`, replaced. Installed after the page has loaded, so the reads that
       got us here were real and only the commit is refused -- and it is the browser's own
       request that fails, which is the path a real outage takes. */
    await page.route(REVIEW_ROUTE, (route) => route.abort('failed'));

    try {
      const commit = page.locator('#commit');
      await commit.click();

      await expect(commit).toContainText('Failed');
      await expect(commit).toHaveClass(/bad/);
      /* Nothing was applied, and the mark survives so the page need not be redone. */
      await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
      await expect(page.locator('.pg.done')).toHaveCount(0);
    } finally {
      await page.unroute(REVIEW_ROUTE);
    }
  });
});

/**
 * Hold the next scientific commit open for a while, then let it through.
 *
 * `slowNextCommit`, without a fixture. `route.fetch()` makes the real request and
 * `route.fulfill({ response })` hands back what the server really said, so the delay is
 * the only invention: the commit lands, the record is written, and the journal puts it
 * back. Defined here rather than in `support.mjs` because two checks in this file want
 * it and nothing else in the directory does yet -- `affordances.spec.mjs` writes the
 * same four lines inline.
 *
 * @param {import('@playwright/test').Page} page - The page whose commit to hold.
 * @param {number} ms - How long to hold the answer back.
 * @returns {Promise<void>} Resolves once the route is installed.
 */
async function holdTheCommit(page, ms) {
  await page.route(REVIEW_ROUTE, async (route) => {
    const response = await route.fetch();
    await new Promise((settle) => setTimeout(settle, ms));
    await route.fulfill({ response });
  });
}
