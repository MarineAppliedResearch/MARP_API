/**
 * The rail's filters, the two-ended controls, and the question surviving a reload --
 * against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the data underneath it, and
 * this is the chunk where that change bites hardest. The originals were written against
 * `fixtures/observations.json`, so they carried its shape as literals: a dive at position
 * one that happened to narrow, `0.9` as a confidence that happened to split it, a day
 * running from midnight to just before seven, and exactly two rows with no readable `tc`.
 * **None of those is a fact about the corpus**, so each one is now discovered from the API
 * before the browser is driven, and what is asserted is the relationship -- this filter
 * narrows, the rail offers what the facets offer -- rather than the number.
 *
 * **These open on `./`, and that is deliberate rather than inherited.** Two reasons, and
 * they agree: this whole file is about *the question* -- the address, the rail and the
 * reset -- so the default question is the thing under test; and `facetsFor` and `pageOf`
 * ask with `DEFAULT_FILTERS`, which is exactly what a bare address means, so a total read
 * off the screen and a count read off the API are answers to the same question. The one
 * exception is the check that marks a tile, which opens on `undecided()` like every other
 * marking check -- see the note on that helper for why.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import {
  expectRealBacking,
  facetsFor,
  freshTile,
  openRail,
  pageOf,
  pageSizeOf,
  question,
  ready,
  undecided,
  watchErrors
} from './support.mjs';

/* The application's own clock parser. Restating the regex here would be a second place
   for it to disagree with what the endpoint extracts from `tc`. */
import { timeOfDayMs } from '../../src/model/match.js';

/** Only one check here writes, but the ledger is per-file and costs nothing when none does. */
let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

test.describe('filtering by where the observation came from', () => {
  test('L1, L2, L3: the rail is one list, in order, with no processor in it',
    async ({ page }) => {
      await page.goto('./');
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      /* The four group headings went in #81. They cost four rows of a rail that was
         already drawing its status filters below the fold. */
      await expect(page.locator('.railgroup__title')).toHaveCount(0);

      /* The order is the whole of the arrangement now, so it is worth asserting all of
         it. `session type` before `session`, because the type narrows the sessions. The
         confidence label carries its current range too, so this compares the beginning of
         each label rather than the whole of it. */
      const labels = await page.locator('#railDimensions .lbl').allInnerTexts();
      const expected = ['project', 'dive', 'line', 'session type', 'session',
                        'species', 'confidence', 'time of day', 'date', 'model'];
      expect(labels.length).toBe(expected.length);
      expected.forEach((label, i) => {
        expect(labels[i].toLowerCase().trim().startsWith(label),
          `rail row ${i} should start with "${label}", and reads "${labels[i]}"`).toBe(true);
      });

      await expect(page.locator('[data-dim="processor"], [data-span="processor"]'))
        .toHaveCount(0);
    });

  test('every declared dimension actually reaches the rail', async ({ page }) => {
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);
    const declared = await page.evaluate(async () => {
      const m = await import('./src/model/dimensions.js');
      return m.DIMENSIONS.map((d) => d.key);
    });
    for (const key of declared) {
      const control = page.locator(`[data-dim="${key}"], [data-span="${key}"]`);
      await expect(control, `${key} is declared but nothing draws it`).toHaveCount(1);
    }
  });

  test('dive is a dropdown, and choosing one narrows the mosaic', async ({ page, request }) => {
    /* `.nth(1)` was a dive that happened to narrow the fixture. On a real corpus a dive
       can hold every row the default question matches, and picking that one moves no
       total at all -- so the dive is chosen for the property the check is about. */
    const narrowing = await aNarrowingDive(request);

    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);
    const before = await total(page);

    await chooseValue(page, 'dive', narrowing.value);      // [data-v=""] is "All dives"
    await ready(page);

    /* The button says what is chosen; the label span it used to write into is gone. */
    await expect(page.locator('[data-dim="dive"]')).not.toContainText('All dives');
    expect(await total(page)).toBeLessThan(before);
  });

  test('the line list is scoped to the chosen dive', async ({ page, request }) => {
    const dive = await aDive(request);

    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="line"]').click();
    const allLines = await page.locator('.menu [data-v]').count();
    await page.keyboard.press('Escape');

    await chooseValue(page, 'dive', dive.value);
    /* A multi-select menu stays open after a pick, and it hangs over the line button
       below it. Dismiss it the way a reviewer would before reaching for the next one —
       this used to pass only because the taller rail pushed the menu upwards instead. */
    await page.keyboard.press('Escape');
    await ready(page);

    await page.locator('[data-dim="line"]').click();
    const scoped = await page.locator('.menu [data-v]').count();
    expect(scoped, 'one dive offers no more lines than every dive together')
      .toBeLessThanOrEqual(allLines);
  });

  test('R7: changing the dive drops only the lines that no longer apply', async ({ page }) => {
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    /* Position rather than a discovered value, and deliberately: this check is about what
       survives an arbitrary change of the wider dimension, so *which* line and *which*
       dive is not the point. Each menu is asserted to hold a real entry first, because
       `.nth(1)` on a list that has none reads as the application failing to draw one. */
    await page.locator('[data-dim="line"]').click();
    await expect(page.locator('.menu [data-v]').nth(1),
      'the corpus offers no line to filter by').toBeVisible();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);
    await expect(page.locator('[data-dim="line"]')).not.toContainText('All lines');

    await page.locator('[data-dim="dive"]').click();
    await expect(page.locator('.menu [data-v]').nth(1),
      'the corpus offers no dive to filter by').toBeVisible();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);

    /* This used to assert the line was cleared outright. #77 changed that deliberately:
       a line still reachable under the new dive is kept, and only one that is not gets
       dropped -- otherwise a careful multi-line selection is lost because one dive
       changed. Either outcome is correct here depending on the data, so what this
       asserts is the invariant: whatever survives must still be offered. */
    /* The first span carries the summary; the second is the chevron glyph. */
    const shown = await page.locator('[data-dim="line"] span').first().innerText();
    await page.locator('[data-dim="line"]').click();
    const offered = (await page.locator('.menu [data-v]').allInnerTexts())
      .map((t) => t.trim()).filter(Boolean);
    await page.keyboard.press('Escape');

    if (!shown.includes('All lines')) {
      const chosen = shown.replace(/\s+/g, ' ').trim();
      expect(offered.some((o) => o.trim() === chosen)).toBe(true);
    }
  });
});

test.describe('filtering by when it happened, and how sure the model was', () => {
  test('R2: the confidence slider narrows the mosaic', async ({ page, request }) => {
    /* `0.9` was a number that happened to split the fixture in two. Discovered instead:
       one step of the slider above the lowest confidence the default question holds,
       checked against the endpoint so it is known to drop some rows and keep others --
       a cut that kept none would empty the grid, which is not what this is about and
       would fail inside `ready` rather than in the assertion. */
    const cut = await aConfidenceThatNarrows(request);

    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);
    const before = await total(page);

    /* The arithmetic is unit-tested. What is not is that the slider reaches it — a
       control wired to nothing passes every check that cannot see the screen. */
    const from = page.locator('[data-span="confidence"] [data-end="from"]');
    await from.evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, cut);
    await ready(page);

    /**
     * **Polled rather than read once**, and the phone is why.
     *
     * `ready` waits for the tiles to settle, and on a narrow viewport the tiles can settle
     * before `#total` has been rewritten -- the grid re-measures, `setPageSize` re-queries,
     * and the count is the last thing to land. Read once, this took the old total and
     * failed the comparison, intermittently and only at `api-phone`. `expect.poll` is the
     * same assertion with the retry a real round trip needs.
     */
    await expect.poll(() => total(page),
      { message: 'raising the confidence floor must narrow the result' })
      .toBeLessThan(before);

    await expect(page.locator('[data-span="confidence"]')).toBeVisible();
  });

  test('R4: a time window that wraps past midnight returns both sides of it',
    async ({ page, request }) => {
      /* `05:00`, `06:59` and `01:00` were the fixture's day -- midnight to just before
         seven. A corpus runs over whatever hours its dives were shot in, so both ends
         come from the clocks it actually carries. */
      const { late, early } = await aWrappingWindow(request);

      await page.goto('./');
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      /* The late end of the day, on its own, with no wrap. One end rather than the
         original's two: a `to` of 23:59 would drop a row recorded in the last minute of
         the day, which a corpus can genuinely hold and the fixture could not. From alone
         is the same question -- everything at or after this clock. */
      await setSpan(page, 'timeOfDay', 'from', late);
      const oneSide = await total(page);
      expect(oneSide).toBeGreaterThan(0);

      /* Now wrap it past midnight. Written as an AND rather than an OR — the usual way
         this goes wrong — a wrapped window returns nothing at all.

         Polled rather than read once: both windows can return more than a page, so the
         tile count `ready()` watches is the same either side of the change and cannot say
         when the new result has landed. The number that moves is the one to wait on. */
      await setSpan(page, 'timeOfDay', 'to', early);
      await expect.poll(() => total(page)).toBeGreaterThan(oneSide);
    });

  test('R5: the date filter says how many observations it could not see',
    async ({ page, request }) => {
      /**
       * **The unreadable rows are made, because every `tc` in this corpus is readable.**
       *
       * `toBe(2)` was the fixture's two deliberately unreadable rows, put there because a
       * rule with nothing to report is a rule nothing watches. A corpus built from
       * inference derives `tc` for every row it ingests, so it has none -- and asserting
       * "the note stayed hidden" would be a check that passes while the reporting is
       * entirely broken. Two seeded rows whose `tc` is not a clock put the rule back in
       * the position it exists for; the count is still read from the endpoint rather than
       * assumed to be two, which is a stronger statement than the literal ever was.
       */
      const seeded = await seedPage({ count: 2, thumbnail: 'ready', tc: 'n/a' });

      try {
        await theDateNote(page, request, seeded);
      } finally {
        ledger.forget(seeded.ids);
        await seeded.remove();
      }
    });

  /**
   * The body of `R5`, with the seeded rows already in place.
   *
   * Split out only so the `finally` that removes them does not swallow the whole check in
   * one indent; every assertion below is its ancestor's.
   *
   * @param {import('@playwright/test').Page} page - The page.
   * @param {import('@playwright/test').APIRequestContext} request - The request fixture.
   * @param {Object} seeded - What `seedPage` made.
   * @returns {Promise<void>} Resolves when the note has been checked.
   */
  async function theDateNote(page, request, seeded) {
      const unanswerable = await unanswerableForDate(request, { date: { from: '00:00', to: null } });

      await page.goto('./');
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      const note = page.locator('[data-note="date"]');
      await expect(note).toBeHidden();          // nothing to say until a date is asked for

      /**
       * **A17 changed what this filter compares, and so what it can fail to answer.**
       *
       * It used to compare the *date component* of `tc`, which no observation carries — so
       * the filter excluded everything and the note reported the whole result. That is why
       * the endpoint refused it outright. Answered differently by the human: the range
       * compares `tc` as a **point in time**, so a row answers whenever its `tc` carries a
       * readable clock.
       *
       * Which leaves the note with something narrower and truer to say: the rows whose
       * `tc` says nothing at all. The fixture carried two, deliberately, because a rule
       * with nothing to report is a rule nothing watches — and this line is still the ONLY
       * thing standing between the reviewer and a result they cannot explain.
       *
       * The ends are times now, not dates. That is the control keeping its shape while
       * what it can discriminate grows, which is what A14 meant.
       */
      await setSpan(page, 'date', 'from', '00:00');

      /* Loud rather than green. A corpus where every `tc` is readable leaves the rule with
         nothing to report, and asserting "the note stayed hidden" would be a check that
         passes while the reporting is entirely broken -- which is the one thing this line
         exists to prevent. So it fails, and says what is missing. */
      expect(unanswerable, `the ${seeded.ids.length} rows seeded with an unreadable \`tc\` `
        + 'did not reach the endpoint\'s count of what the date filter could not answer '
        + 'for, so either the seeding or the counting is wrong. It fails rather than '
        + 'skipping: a skipped branch looks green, and this note is the only thing between '
        + 'a reviewer and a result they cannot explain.')
        .toBeGreaterThanOrEqual(seeded.ids.length);

      await expect(note).toBeVisible();
      const said = await note.innerText();
      expect(said).toMatch(/\d+/);
      expect(Number(said.replace(/\D/g, ''))).toBe(unanswerable);
      expect(said.toLowerCase()).toContain('no recorded date');
  }
});

test.describe('the question survives a reload', () => {
  test('R1: a filter is in the address, and comes back after a reload', async ({ page, request }) => {
    const dive = await aDive(request);

    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    await chooseValue(page, 'dive', dive.value);
    await page.keyboard.press('Escape');
    await ready(page);

    const chosen = await page.locator('[data-dim="dive"] span').first().innerText();
    const narrowed = await page.locator('#total').innerText();
    expect(page.url()).toContain('dive=');

    await page.reload();
    await ready(page);
    await openRail(page);

    /* The same question, not merely a page that loaded. */
    await expect(page.locator('[data-dim="dive"] span').first()).toHaveText(chosen);
    await expect(page.locator('#total')).toHaveText(narrowed);
  });

  test('R6: the address is a link — a fresh visit lands on the same question and page',
    async ({ page, request }) => {
      const { dives } = await diveFacets(request);

      await page.goto('./');
      await expectRealBacking(page);
      await ready(page);

      /* The page size follows the viewport, so it is asked for rather than assumed -- and
         the dive has to hold more than one page of it or there is no page two to land on.
         The fixture's `.nth(1)` happened to; a corpus dive need not. */
      const pageSize = await pageSizeOf(page);
      const roomy = dives.filter((d) => d.count > pageSize).at(-1);
      expect(roomy, `no dive in this corpus holds more than one page of ${pageSize} rows `
        + 'under the default question, so there is no second page for a link to address.')
        .toBeTruthy();

      await openRail(page);
      await chooseValue(page, 'dive', roomy.value);
      await page.keyboard.press('Escape');
      await ready(page);
      await page.locator('[data-page="next"]').click();
      await ready(page);

      const link = page.url();
      expect(link).toContain('page=2');
      const total = await page.locator('#total').innerText();

      /* Arriving cold at the address, the way somebody sent it would. */
      await page.goto(link);
      await ready(page);

      /* The question and the page number, not which observations are on it. How many
         tiles fit is measured from the window, so page two of the same question is
         honestly a different handful on a narrower screen -- and the page size is
         deliberately not in the address. Asserting membership here passed on a desktop and
         failed on a phone for a reason that has nothing to do with whether the link works. */
      await expect(page.locator('#total')).toHaveText(total);
      expect(page.url()).toContain('page=2');
      expect(await page.evaluate(() => window.MARP.state.page)).toBe(2);
      expect(await page.locator('.tile').count()).toBeGreaterThan(0);
    });

  test('R2: marks do not come back, because the record does not have them',
    async ({ page }) => {
      /* The one check in this file that opens on `undecided()` rather than `./`: it marks
         a tile, and the default question shows flagged rows which arrive already marked --
         where a click is a take-back and `.tile.marked` never reaches one. */
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      const tile = await freshTile(page);
      await tile.click();
      await expect(page.locator('.tile.marked')).toHaveCount(1);

      await page.reload();
      await ready(page);
      /* #68 is explicit that undecided items from an uncommitted page may appear again.
         Restoring the mark would be worse than losing it: on screen it is indistinguishable
         from one that was committed, and the record agrees with neither. */
      await expect(page.locator('.tile.marked')).toHaveCount(0);
    });

  test('R3: an address that makes no sense still opens the application', async ({ page }) => {
    const errors = watchErrors(page);
    /* Every one of these is wrong in a different way: a mode that does not exist, a
       confidence outside its own bounds, a page that is not a page, a parameter naming
       no dimension. None of them may cost the reviewer a working screen. */
    await page.goto('./?mode=archaeology&confidence=5..9&page=0&utm_source=email');
    await expectRealBacking(page);
    await ready(page);

    expect(await page.locator('.tile').count()).toBeGreaterThan(0);
    await expect(page.locator('.seg button.on')).toContainText('Scientific');
    expect(errors).toEqual([]);
  });

  test('R5: Reset restores the default question in one gesture', async ({ page, request }) => {
    const dive = await aDive(request);

    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);
    const before = await page.locator('#total').innerText();

    await chooseValue(page, 'dive', dive.value);
    await page.keyboard.press('Escape');
    await ready(page);
    expect(page.url()).toContain('dive=');

    await page.locator('#railReset').click();
    await ready(page);

    await expect(page.locator('[data-dim="dive"]')).toContainText('All dives');
    await expect(page.locator('#total')).toHaveText(before);
    /* Back to the default question is back to the bare address. */
    expect(page.url()).not.toContain('dive=');
  });

  test('R5: Reset keeps the mode the reviewer is working in', async ({ page }) => {
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await openRail(page);

    /* Training asks a different question, so its dive list is its own -- and which dive is
       picked does not matter here, only that the reset afterwards does not also leave the
       workflow. Asserted present first, so an empty list fails by saying so. */
    await page.locator('[data-dim="dive"]').click();
    await expect(page.locator('.menu [data-v]').nth(1),
      'training mode offers no dive to filter by').toBeVisible();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);

    await page.locator('#railReset').click();
    await ready(page);

    /* Clearing the filters is not leaving the workflow. */
    await expect(page.locator('#statusLbl')).toHaveText('Training disposition');
    expect(page.url()).toContain('mode=training');
  });
});

/* ---------------------------------------------------------------------------- locally.
   None of this is in `support.mjs`, which is shared with agents working in parallel and
   is not mine to edit. Everything below discovers; nothing pins a fact about the corpus. */

/** What the sub-bar says is matching, as a number. */
const total = async (page) =>
  Number((await page.locator('#total').innerText()).replace(/\D/g, ''));

/**
 * Type into one end of a two-ended control and let the rail's change handler run.
 *
 * Came across from `tests/e2e/render.spec.mjs` unchanged. It is a rail helper rather than
 * a corpus one, which is why it is here and not in `support.mjs`.
 */
async function setSpan(page, key, end, value) {
  const box = page.locator(`[data-span="${key}"] [data-end="${end}"]`);
  /* Time and date live behind a summary button since #81 L5, so the popover holding
     their ends has to be opened first. The confidence track is in the rail itself. */
  if (!(await box.count())) await page.locator(`[data-dim="${key}"]`).click();
  await box.fill(value);
  /* `fill` raises `input` and not `change`, and the rail waits for `change` — text
     sitting in a field is not a value anybody has committed to yet. Enter is what a
     person presses, and it is one of the three events the panel listens for. */
  await box.press('Enter');
  await ready(page);
}

/**
 * Open one set dimension's menu and pick a value by what it filters on.
 *
 * Never by position, for the same reason a tile is never picked by position: `.nth(1)` is
 * whichever entry the data happened to put there, and a corpus reorders itself every time
 * somebody runs an inference job. `[data-v=""]` is the dimension's "All …" entry, so a
 * value selector cannot land on it by accident.
 */
async function chooseValue(page, key, value) {
  await page.locator(`[data-dim="${key}"]`).click();
  await expect(page.locator('.menu')).toBeVisible();
  await page.locator(`.menu [data-v="${value}"]`).click();
}

/**
 * The dive facets under the default question, ascending by count, with that question's
 * own total beside them.
 *
 * A dive's facet count is the number of rows the default question matches within it --
 * the same set the mosaic's `#total` reports once that dive is chosen -- which is what
 * makes "this dive narrows" answerable before the browser is touched at all.
 */
async function diveFacets(request) {
  const [facets, firstPage] = await Promise.all([
    facetsFor(request, {}),
    pageOf(request, {}, { page: 1, pageSize: 1, includeTotal: true })
  ]);
  const dives = [...(facets.dive || [])].sort((a, b) => a.count - b.count);
  expect(dives.length, 'no observation in this corpus belongs to a session with a dive, '
    + 'so the dive filter has nothing to offer and these checks have nothing to drive.')
    .toBeGreaterThan(0);
  return { total: firstPage.total, dives };
}

/** Any dive, for a check that only needs the filter exercised. */
async function aDive(request) {
  const { dives } = await diveFacets(request);
  return dives[0];
}

/** A dive that genuinely leaves rows behind -- what "choosing one narrows" needs. */
async function aNarrowingDive(request) {
  const { total: whole, dives } = await diveFacets(request);
  const narrowing = dives.find((d) => d.count > 0 && d.count < whole);
  expect(narrowing, `every dive in this corpus holds all ${whole} rows the default `
    + 'question matches, so choosing one cannot narrow anything and there is nothing '
    + 'here for this check to see.').toBeTruthy();
  return narrowing;
}

/**
 * A confidence the slider can be set to that drops some rows and keeps others.
 *
 * One step of the slider above the lowest confidence the default question holds, then
 * checked against the endpoint rather than assumed: a cut that kept nothing would empty
 * the grid and fail inside `ready`, which reads like the application failing to draw.
 */
async function aConfidenceThatNarrows(request) {
  const first = await pageOf(request, {}, { page: 1, pageSize: 1, includeTotal: true });
  expect(first.total, 'the default question is empty, so there is nothing to narrow.')
    .toBeGreaterThan(2);

  /**
   * **The middle of the range, not one step above the floor.**
   *
   * The default sort is confidence ascending, so page *n* of size one is the *n*th row by
   * confidence -- and the middle one is a cut that drops about half the result.
   *
   * This took one slider step above the lowest row, which is the smallest cut that
   * narrows anything, and on this corpus that was **three rows out of 1,947**. The check
   * then passed alone and failed in sequence: any earlier check that decides one of three
   * particular rows takes them out of the default question, and the smallest possible cut
   * stops cutting. A margin that thin is not a discovered value, it is a coincidence.
   */
  const middle = await pageOf(request, {},
    { page: Math.max(2, Math.floor(first.total / 2)), pageSize: 1, includeTotal: false });
  const at = Number(middle.rows.length ? middle.rows[0].confidence : NaN);
  expect(Number.isFinite(at), 'the middle row of the default question carries no '
    + 'confidence, so there is no threshold to set the slider to.').toBe(true);

  const cut = Math.round(at * 100) / 100;                    // the slider's step is 0.01
  const kept = await pageOf(request, { confidence: { from: cut, to: 1 } },
    { page: 1, pageSize: 1, includeTotal: true });

  expect(kept.total, `a confidence floor of ${cut} keeps nothing, so the mosaic would be `
    + 'empty rather than narrowed.').toBeGreaterThan(0);
  expect(kept.total, `a confidence floor of ${cut} drops nothing, so this corpus does not `
    + 'span a single step of the slider and the check cannot observe narrowing.')
    .toBeLessThan(first.total);

  return cut.toFixed(2);
}

/**
 * Two ends that make a window wrap past midnight, from the clocks the corpus carries.
 *
 * `late` is the minute the last observation falls in and `early` is one minute past the
 * first, so the two are disjoint and each holds at least one row. A window from `late` to
 * `early` reads later-than-earlier, which is the wrap, and it must therefore return
 * strictly more than `late` on its own.
 */
async function aWrappingWindow(request) {
  const clocks = await clockSample(request);
  expect(clocks.length, 'no row in this corpus carries a `tc` with a readable clock, so '
    + 'there is no time of day to filter on at all.').toBeGreaterThan(0);

  const MINUTE = 60_000;
  const first = Math.floor(Math.min(...clocks) / MINUTE);
  const last = Math.floor(Math.max(...clocks) / MINUTE);

  expect(last, 'every observation sampled from this corpus was recorded within a minute '
    + `or two of ${asClock(first)}, so no window over it can wrap past midnight and still `
    + 'take in more than the one end.').toBeGreaterThan(first + 1);

  return { late: asClock(last), early: asClock(first + 1) };
}

/**
 * The clocks the corpus carries, sampled from both ends of the default question.
 *
 * The first and last page, at the endpoint's largest bite. Both ends rather than one,
 * because the default order is by confidence and a single page of that is one slice of
 * the models' certainty rather than of the day.
 */
async function clockSample(request) {
  const BITE = 600;                    // the endpoint's ceiling: 600 rows in one request
  const head = await pageOf(request, {}, { page: 1, pageSize: BITE, includeTotal: true });
  const rows = [...head.rows];

  const lastPage = Math.max(1, Math.ceil(head.total / BITE));
  if (lastPage > 1) {
    const tail = await pageOf(request, {}, { page: lastPage, pageSize: BITE, includeTotal: false });
    rows.push(...tail.rows);
  }

  return rows.map((row) => timeOfDayMs(row.tc)).filter((ms) => ms != null);
}

/** Minutes past midnight as the `HH:MM` the rail's two ends take. */
const asClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * How many rows the endpoint says a date filter could not answer for.
 *
 * `excludedForNoDate` rides on the page answer and `pageOf` does not carry it through, so
 * this asks for one row and reads the envelope. Asking the endpoint rather than counting
 * unreadable `tc` values here is what keeps the note and its source the same answer.
 */
async function unanswerableForDate(request, narrowed) {
  const res = await request.post('/api/v2/mosaic/observations/pages', {
    data: { filters: question(narrowed), pageSize: 1, pages: [1] }
  });
  expect(res.ok(), `the mosaic query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  return (await res.json()).excludedForNoDate || 0;
}
