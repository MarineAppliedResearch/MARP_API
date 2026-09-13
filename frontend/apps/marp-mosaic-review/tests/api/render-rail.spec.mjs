/**
 * The filter rail, the sort control, and both workflow statuses -- against a real server.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it.
 *
 * **Two kinds of fixture literal had to go, and they went different ways.**
 *
 * - A *name* -- a project, a dive, a line, a species -- was never written down here in the
 *   first place: the rail menus are built from `state.facets`, so a check picks the first
 *   entry the menu actually offers rather than one it was told to expect. What is new is
 *   that the offer is now checked before it is clicked, with `facetsFor` for the corpus
 *   and the menu's own option count for a nested dimension, so a corpus with nothing to
 *   choose fails saying so instead of timing out on a locator.
 * - A *count* is the harder one. `render.spec.mjs` read `./fixtures/observations.json`
 *   and counted the rows the default question is *meant* to return, deliberately: *"a
 *   test that compares the app to itself cannot see the count move"*. The fixture file is
 *   gone, so the second opinion is now the endpoint's own answer to a question **stated
 *   in full here** -- see `totalUnder` at the foot of this file. It asks with a literal
 *   filters object rather than through `question()`, because R3 is precisely a check on
 *   what the application's own defaults are, and an expectation built from
 *   `DEFAULT_FILTERS` would move whenever the bug did.
 *
 * Refs #157, #81, #89.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  expectRealBacking,
  facetsFor,
  isPhone,
  openRail,
  pageSizeOf,
  ready,
  undecided,
  watchErrors
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/**
 * #81 — the reported bugs and the crowding.
 *
 * All of these are about what is on the screen, which is why they are here rather than in
 * `tests/unit/`. Four were reported from use, and the store was right for every one of
 * them: the menus held the right values, the status filter held the right key, and the
 * rail declared every dimension it was asked to. None of that is what the reviewer saw.
 */
test.describe('the filter rail, cleaned up', () => {
  /** The entry that clears a set dimension, by the text it carries. */
  const allEntry = (page, label) => page.locator('.menu [data-v=""]', { hasText: label });

  /**
   * The menu entries that are a value, rather than the "All …" entry above them.
   *
   * `.nth(1)` on the fixture, which was the same element and said less. Named here
   * because on a real corpus the list can be empty -- a dive with no lines recorded --
   * and a `.nth(1)` that is not there times out saying nothing about the data.
   */
  const options = (page) => page.locator('.menu [data-v]:not([data-v=""])');

  test('B1: choosing a project unticks "All projects" while the menu is open',
    async ({ page, request }) => {
      /* Discovered, never pinned: the check needs a project to exist, and which one it is
         is the corpus's business. An id or a name written here is true on one computer. */
      const facets = await facetsFor(request, {});
      expect((facets.project || []).length, 'this corpus has no project to choose, so there '
        + 'is nothing for the "All projects" entry to stop claiming').toBeGreaterThan(0);

      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      await page.locator('[data-dim="project"]').click();
      await expect(page.locator('.menu')).toBeVisible();
      await expect(allEntry(page, 'All projects')).toHaveClass(/on/);

      /* The menu deliberately stays open, so the reviewer is looking at both entries at
         once. Before the fix only the clicked entry restated itself, and the menu claimed
         "All projects" and one project simultaneously. */
      await options(page).first().click();
      await expect(page.locator('.menu')).toBeVisible();
      await expect(allEntry(page, 'All projects')).not.toHaveClass(/on/);
      await expect(allEntry(page, 'All projects').locator('.tick')).toBeEmpty();

      /* And back again: taking the last specific value off means the dimension is not
         filtering, which is what "All projects" says. */
      await options(page).first().click();
      await expect(allEntry(page, 'All projects')).toHaveClass(/on/);
    });

  test('B1: the dive and line menus behave the same way', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    for (const [key, label] of [['dive', 'All dives'], ['line', 'All lines']]) {
      await page.locator(`[data-dim="${key}"]`).click();
      await expect(allEntry(page, label)).toHaveClass(/on/);
      /* A nested dimension is offered only what is reachable under the filters already
         chosen, so an empty list is a fact about the corpus rather than a broken rail. */
      expect(await options(page).count(), `the ${key} menu offers nothing under the current `
        + 'filters, so there is no value here to choose').toBeGreaterThan(0);
      await options(page).first().click();
      await expect(allEntry(page, label), `${key} still claims ${label}`)
        .not.toHaveClass(/on/);
      await page.keyboard.press('Escape');
      await ready(page);
    }
  });

  test('B2: clicking the button that opened a menu closes it', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    const project = page.locator('[data-dim="project"]');
    await project.click();
    await expect(page.locator('.menu')).toHaveCount(1);

    /* It used to close and immediately reopen, so the button read as inert. */
    await project.click();
    await expect(page.locator('.menu')).toHaveCount(0);

    /* And a click on a different button moves the menu rather than only dismissing. */
    await project.click();
    await expect(page.locator('.menu')).toHaveCount(1);
    await page.locator('[data-dim="species"]').click();
    await expect(page.locator('.menu')).toHaveCount(1);
    await expect(page.locator('.menu .mhead').first()).toContainText('species');
  });

  test('B2: it still closes after a pick has redrawn the rail underneath it',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      /* The rail is redrawn from state on every change, so the button that opened the
         menu is replaced by an identical one while the menu is still up. Holding the
         element rather than its name would make this second click open a new menu. */
      const project = page.locator('[data-dim="project"]');
      await project.click();
      expect(await options(page).count(), 'this corpus offers no project to pick, so the '
        + 'rail is never redrawn underneath the menu').toBeGreaterThan(0);
      await options(page).first().click();
      await ready(page);

      await project.click();
      await expect(page.locator('.menu')).toHaveCount(0);
    });

  test('B3: the time controls are 24-hour, with no AM or PM anywhere', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="timeOfDay"]').click();
    const from = page.locator('[data-span="timeOfDay"] [data-end="from"]');
    await expect(from).toBeVisible();

    /* A native `<input type="time">` draws 12-hour from the browser locale and there is
       no attribute that changes it -- `lang="en-GB"` was tried in this same Chromium and
       still drew `01:30 PM`. So these are text fields, and what the field holds is
       exactly what is on the screen, which is what makes this assertable at all. */
    await expect(from).toHaveAttribute('type', 'text');
    await from.fill('13:30');
    await from.press('Enter');
    await expect(from).toHaveValue('13:30');

    const panel = await page.locator('.menu--panel').innerText();
    expect(panel.toLowerCase()).not.toMatch(/\b(am|pm)\b/);
    expect(panel).toContain('24-hour');

    /* And the summary on the rail button says the same thing back, in the same clock. */
    await expect(page.locator('[data-dim="timeOfDay"]')).toContainText('13:30');

    /* A time that is not a time does not become a filter, and does not sit in the field
       looking as though it did. */
    await from.fill('noon');
    await from.press('Enter');
    await expect(from).toHaveValue('');

    /* Shorthand is read the way it is meant, and the field says what was understood. */
    await from.fill('930');
    await from.press('Enter');
    await expect(from).toHaveValue('09:30');
  });

  test('L4: confidence is one track carrying two handles', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    const from = page.locator('[data-span="confidence"] [data-end="from"]');
    const to = page.locator('[data-span="confidence"] [data-end="to"]');
    const a = await from.boundingBox();
    const b = await to.boundingBox();

    /* Two stacked sliders is what this replaced, so the assertion is that they occupy
       the same strip: same top, same left, same width. Stacked, the second sat a row
       below the first and the pair read as two independent numbers. */
    expect(Math.round(a.y)).toBe(Math.round(b.y));
    expect(Math.round(a.x)).toBe(Math.round(b.x));
    expect(Math.round(a.width)).toBe(Math.round(b.width));
    await expect(page.locator('[data-span="confidence"] .dual__track')).toHaveCount(1);

    /* And the fill between the handles follows them, which is the only thing that makes
       one track legible as a range rather than as two dots. */
    await from.evaluate((el) => {
      el.value = '0.4';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('[data-span="confidence"]'))
      .toHaveAttribute('style', /--from:\s*40%/);
    await expect(page.locator('.span-val')).toContainText('0.40');
  });

  test('L5: time and date take one rail row each', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    /* Two native inputs each did not fit side by side in the rail column, so they
       wrapped, and the pair took three rows between them. Behind a summary button they
       take one row each, and the popover has the width the controls need. */
    for (const key of ['timeOfDay', 'date']) {
      await expect(page.locator(`#railDimensions [data-span="${key}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-dim="${key}"]`)).toHaveCount(1);
    }

    const one = await page.locator('[data-dim="timeOfDay"]').boundingBox();
    const two = await page.locator('[data-dim="date"]').boundingBox();
    expect(two.y - one.y).toBeLessThan(60);      // label plus control, and nothing more

    await page.locator('[data-dim="date"]').click();
    await expect(page.locator('.menu--panel [data-span="date"] [data-end="from"]'))
      .toBeVisible();
    await expect(page.locator('.menu--panel [data-span="date"] [data-end="to"]'))
      .toBeVisible();
  });

  test('L6: the reset is the first control in the rail, and costs almost nothing',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      const reset = await page.locator('#railReset').boundingBox();
      const collapse = await page.locator('#railbtn').boundingBox();
      const firstFilter = await page.locator('#railDimensions .lbl').first().boundingBox();

      expect(reset.y).toBeLessThan(firstFilter.y);
      expect(reset.width).toBeLessThanOrEqual(collapse.width + 1);
      /* It says what it is to a screen reader and on hover; it does not spend a word on
         saying it in the rail. */
      await expect(page.locator('#railReset')).toHaveAttribute('aria-label', /reset/i);
    });

  test('L7: nothing in the rail is drawn where it cannot be reached', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    /* The rail was `overflow: hidden` over content taller than it, so the status filters
       were drawn below the fold and could not be reached at all. A rail that hides
       controls silently is worse than one that scrolls. The progress bar was the other
       thing lost that way, and #91 took it out of the rail altogether rather than
       leaving it to be rescued by the scrolling — it is asserted where it lives now, in
       `progress is not in the rail`.
       `.rail-body` is what scrolls, so *reachable* is the claim, not "fits without
       scrolling" — that proxy held only while the rail had three status boxes in it. Since
       #89 gave every mode six, Scientific's rail scrolls the way Delete's always has, and
       asserting the proxy would have meant weakening the rail rather than the test.
       Checked in every mode now, which is the gap the old version left: Delete Mode has
       had two dimensions since #71 and was never asked this question.

       **`scrollIntoView` is not the test, and that mistake was made here first.**
       `overflow: hidden` is still scrollable *programmatically*, so a version of this that
       scrolled each control into view and measured it passed with the original bug put
       back. What a person can reach is decided by the container: it has to be scrollable
       whenever its content is taller than it is. */
    for (const mode of ['Scientific Data Review', 'Training Data Review', 'Delete']) {
      await page.locator('.seg button', { hasText: mode }).click();
      await ready(page);
      await openRail(page);

      /* Measured in one evaluate, because doing it across several Playwright calls raced
         the rail's own re-render and failed once in three runs on desktop for that and
         nothing else. A flaky rail test teaches people to re-run rather than look. */
      const rail = await page.evaluate(() => {
        const body = document.querySelector('.rail-body');
        const style = getComputedStyle(body);
        return {
          overflowY: style.overflowY,
          overflows: body.scrollHeight > body.clientHeight + 1
        };
      });

      /* The bug: content taller than a container nobody can scroll. */
      if (rail.overflows) {
        expect(['auto', 'scroll'], `the rail overflows in ${mode} and must scroll`)
          .toContain(rail.overflowY);
      }

      for (const sel of ['#statusFilters [data-status="unreviewed"]',
                         '#statusFilters [data-status="reviewed"]']) {
        await expect(page.locator(sel), `${sel} is drawn in ${mode}`).toHaveCount(1);
        const box = await page.evaluate((s) => {
          const el = document.querySelector(s);
          const body = document.querySelector('.rail-body');
          if (!el) return null;
          const a = el.getBoundingClientRect();
          const b = body.getBoundingClientRect();
          /* Where it sits in the scrollable content, not on screen — so an element below
             the fold of a rail that scrolls is reachable, and one outside the content box
             of a rail that does not scroll is not. */
          return {
            height: a.height,
            top: (a.top - b.top) + body.scrollTop,
            bottom: (a.bottom - b.top) + body.scrollTop,
            reachable: body.scrollHeight
          };
        }, sel);

        expect(box, `${sel} is drawn in ${mode}`).not.toBeNull();
        expect(box.height, `${sel} has a size in ${mode}`).toBeGreaterThan(0);
        expect(box.top, `${sel} is above the rail's content in ${mode}`)
          .toBeGreaterThanOrEqual(-1);
        expect(box.bottom, `${sel} is past the end of the rail's content in ${mode}`)
          .toBeLessThanOrEqual(box.reachable + 1);
      }
    }
  });

  test('M1: the field and the direction are chosen separately, and both are on screen',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      /* The sub-bar says both halves without anything being opened. It used to carry one
         phrase from a fixed list, so which way the mosaic was ordered was something to
         work out rather than something to read. */
      await expect(page.locator('#sortLabel')).toHaveText('Confidence ↑ low first');

      await page.locator('#sortBtn').click();
      await expect(page.locator('.menu')).toBeVisible();
      await expect(page.locator('.menu .mhead').first()).toHaveText('Sort by');

      /* Change the field. The menu stays open, and its direction entries reword
         themselves for the field that is now chosen. */
      await page.locator('.menu [data-v="keyframe_count"]').click();
      await ready(page);
      await expect(page.locator('.menu')).toBeVisible();
      await expect(page.locator('.menu [data-v="keyframe_count"]')).toHaveClass(/on/);
      await expect(page.locator('.menu [data-v="desc"]')).toContainText('Longest first');
      await expect(page.locator('#sortLabel')).toHaveText('Track length ↑ shortest first');

      /* And the direction on its own, keeping the field. */
      await page.locator('.menu [data-v="desc"]').click();
      await ready(page);
      await expect(page.locator('.menu [data-v="desc"]')).toHaveClass(/on/);
      await expect(page.locator('.menu [data-v="asc"]')).not.toHaveClass(/on/);
      await expect(page.locator('#sortLabel')).toHaveText('Track length ↓ longest first');

      await page.keyboard.press('Escape');
      /* It is a real order, not just a label: the address carries it and a reload keeps it. */
      expect(page.url()).toContain('sort=keyframe_count.desc');
    });

  test('M2: a secondary sort is chosen in the same menu, and reaches the address',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);

      await page.locator('#sortBtn').click();
      await expect(page.locator('.menu [data-v="then:none"]')).toHaveClass(/on/);
      /* The primary's own field is not offered as the tie-break: a term that can never be
         reached is not a sort. */
      await expect(page.locator('.menu [data-v="then:confidence"]')).toHaveCount(0);

      await page.locator('.menu [data-v="then:keyframe_count"]').click();
      await ready(page);

      /* The menu stays open and grows a direction pair worded for the field just chosen. */
      await expect(page.locator('.menu')).toBeVisible();
      await expect(page.locator('.menu [data-v="then:keyframe_count"]')).toHaveClass(/on/);
      await expect(page.locator('.menu [data-v="then:desc"]')).toContainText('Longest first');
      await expect(page.locator('#sortLabel'))
        .toHaveText('Confidence ↑ low first, then Track length ↑ shortest first');

      await page.locator('.menu [data-v="then:desc"]').click();
      await ready(page);
      await expect(page.locator('#sortLabel'))
        .toHaveText('Confidence ↑ low first, then Track length ↓ longest first');

      await page.keyboard.press('Escape');
      expect(page.url()).toContain('sort=confidence.asc,keyframe_count.desc');

      /* And it survives the reload, which is the whole of #79's claim about this branch. */
      await page.reload();
      await ready(page);
      await expect(page.locator('#sortLabel'))
        .toHaveText('Confidence ↑ low first, then Track length ↓ longest first');
    });

  test('M2: the tie-break really breaks ties, and the primary still governs',
    async ({ page, request }) => {
      /* Confidence carries two decimal places over four hundred-odd rows, so the primary
         ties constantly and the secondary has real work to do. A menu that recorded a
         secondary and ordered nothing by it would pass every other M2 assertion. */
      const idsFor = async (sort) => {
        await page.goto(undecided(`sort=${sort}`));
        await expectRealBacking(page);
        await ready(page);
        return page.locator('.tile').evaluateAll((els) => els.map((e) => e.dataset.id));
      };

      const up = await idsFor('confidence.asc,keyframe_count.asc');

      /* The fixture's own shape guaranteed the ties; a real corpus has to be asked. This
         is the endpoint answering the same two questions the browser is about to ask, at
         the page size this viewport settled on -- so what the browser does below is
         measured against something that is not the application. A corpus whose first page
         holds no tie fails here, saying so, rather than failing the comparison and
         reading like a sort defect. */
      const question = { reviewStatus: ['unreviewed'] };
      const size = await pageSizeOf(page);
      const straight = await idsUnder(request, question, tieBreak('asc'), size);
      const reversed = await idsUnder(request, question, tieBreak('desc'), size);
      expect(reversed.join(','), 'nothing on page one of this corpus ties on confidence, so '
        + 'the tie-break has no work to do and this check cannot observe it')
        .not.toBe(straight.join(','));

      const down = await idsFor('confidence.asc,keyframe_count.desc');

      expect(up.length).toBeGreaterThan(10);
      expect(down.length).toBe(up.length);
      expect(down.join(','), 'reversing the tie-break must reorder the page')
        .not.toBe(up.join(','));

      /* The primary is still the first word: whatever the tie-break does, confidence never
         goes backwards. Read from the store, because a tile does not draw its confidence. */
      const climbing = await page.evaluate(async () => {
        const { state } = await import('./src/store.js');
        return state.rows.every((r, i) => i === 0 || r.confidence >= state.rows[i - 1].confidence);
      });
      expect(climbing, 'the secondary must only break ties, never reorder across them')
        .toBe(true);
    });

  test('M3: a phone sorts with the same control, at the same size', async ({ page }, info) => {
    test.skip(!isPhone(info), 'about the phone layout');
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    const button = page.locator('#sortBtn');
    await expect(button).toBeVisible();

    /* Reachable without hunting: the whole control is inside the viewport, rather than
       pushed off the end of a bar that happens to scroll. */
    const box = await button.boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

    /* And the same control, not a smaller one. It was hidden here once, and then given a
       smaller font and less padding, which is the same answer in a politer form. */
    const style = (el) => el.evaluate((e) => {
      const s = getComputedStyle(e);
      return `${s.fontSize} ${s.paddingTop} ${s.paddingLeft}`;
    });
    const onPhone = await style(button);
    await page.setViewportSize({ width: 1600, height: 900 });
    await ready(page);
    expect(onPhone, 'the phone gets the same control as the desktop')
      .toBe(await style(button));

    /* Usable, not merely present: the whole secondary sort is driven at phone width. */
    await page.setViewportSize({ width, height: 839 });
    await ready(page);
    await button.click();
    await page.locator('.menu [data-v="then:updatedAt"]').click();
    await ready(page);
    await page.locator('.menu [data-v="then:desc"]').click();
    await ready(page);
    await expect(page.locator('#sortLabel'))
      .toHaveText('Confidence ↑ low first, then Last updated ↓ newest first');
  });

  test('M1: the order actually applied changes when the direction does', async ({ page }) => {
    /* The one place a tile is taken by position on purpose: the check *is* about which row
       the query put first. Nothing is clicked, so neither half of the locator trap that
       `freshTile` exists for applies -- the id is read once and compared. */
    await page.goto(undecided('sort=confidence.asc'));
    await expectRealBacking(page);
    await ready(page);
    const lowest = await page.locator('.tile').first().getAttribute('data-id');

    await page.goto(undecided('sort=confidence.desc'));
    await ready(page);
    const highest = await page.locator('.tile').first().getAttribute('data-id');

    /* A menu that reorders nothing would pass every assertion above. */
    expect(highest).not.toBe(lowest);
  });

  test('B4: a status filter draws one control, not two', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    /* The second control was a keyboard-shortcut badge. `renderStatusFilters` wrote
       `data-key="reviewStatus"` to name the status dimension, and #74's
       `[data-key]::after { content: attr(data-key) }` drew that value beside the label as
       a grey pill. Two meanings for one attribute, and the pill read `reviewStatus`. */
    const unreviewed = page.locator('#statusFilters [data-status="unreviewed"]');
    await expect(unreviewed).toBeVisible();
    const badge = await unreviewed.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(badge, 'a status checkbox draws no badge of any kind').toBe('none');

    /* And the badge still works where it belongs, so this is not a fix by deletion. */
    const commit = await page.locator('#commit').evaluate(
      (el) => getComputedStyle(el, '::after').content);
    expect(commit).not.toBe('none');
  });
});

/* -------------------------------------------------------------------------- #89
   Every mode filters on both workflow statuses, the way Delete already does.

   These are here rather than in the unit tier because the rail is what the reviewer sees,
   and because the claim that matters most — that Scientific's default result set did not
   move — is only true end to end. The store has been correct every time a rendering
   defect shipped here. */

/**
 * What the store is filtering on, and how many rows the question returns.
 *
 * Called `question` before the move; renamed because `support.mjs` exports a `question`
 * of its own, and the two mean opposite things — that one is the question to *ask*, this
 * one is the question the app says it is *applying*.
 */
const appliedQuestion = (page) => page.evaluate(() => ({
  total: window.MARP.state.total,
  reviewStatus: window.MARP.state.filters.reviewStatus,
  trainingDisposition: window.MARP.state.filters.trainingDisposition
}));

/**
 * The default result count worked out independently of the app.
 *
 * Deliberately not "whatever the app said last time": a test that compares the app to
 * itself cannot tell that the borrowed dimension started narrowing. This counts the rows
 * the default question is *meant* to return — unreviewed or flagged, every training
 * disposition — and reports the promoted and excluded share, which is exactly what a
 * careless `defaultStatusFor` would silently remove.
 *
 * It was `fetch('./fixtures/observations.json')` and a filter over the rows in it; #157
 * deleted that file, so the second opinion is now the endpoint's own answer to the
 * question **spelled out here**. `question()` from `support.mjs` is deliberately *not*
 * used: it merges over `DEFAULT_FILTERS`, and `DEFAULT_FILTERS` is the thing under test.
 * A `trainingDisposition` of `[]` is the endpoint's "not filtering", the same thing an
 * absent key means — written out because absence is the whole claim.
 */
const DEFAULT_QUESTION = { reviewStatus: ['unreviewed', 'flagged'], trainingDisposition: [] };

/** The same question narrowed to the rows a training decision has been made about. */
const DECIDED_IN_TRAINING = {
  reviewStatus: ['unreviewed', 'flagged'],
  trainingDisposition: ['promoted', 'excluded']
};

test.describe('every mode filters on both workflow statuses', () => {
  test('R3: Scientific opens with no training narrowing, and its total does not move',
    async ({ page, request }) => {
      const errors = watchErrors(page);

      /* Asked before the browser is, so the number cannot be a number the app produced. */
      const want = {
        total: await totalUnder(request, DEFAULT_QUESTION),
        decided: await totalUnder(request, DECIDED_IN_TRAINING)
      };

      /* This check is *about* the default question, so it opens on the bare address. */
      await page.goto('./');
      await expectRealBacking(page);
      await ready(page);

      /* If this were zero the check below would pass while narrowing everything, so the
         corpus's own shape is asserted before it is relied on. */
      expect(want.decided,
        'the corpus must hold promoted or excluded rows in the default view, or this proves nothing')
        .toBeGreaterThan(0);

      const got = await appliedQuestion(page);
      expect(got.trainingDisposition,
        'the borrowed dimension must arrive not filtering, not at its owner\'s default')
        .toEqual([]);
      expect(got.reviewStatus).toEqual(['unreviewed', 'flagged']);
      expect(got.total,
        `the default result set must not move: ${want.decided} promoted/excluded rows are at stake`)
        .toBe(want.total);

      /* And the default question is still the bare address. */
      expect(new URL(page.url()).search).toBe('');
      expect(errors).toEqual([]);
    });

  test('R1: Scientific\'s rail draws both dimensions, its own first', async ({ page }) => {
    /* The bare address, because what is asserted below is what the rail arrives ticked
       at -- which is the default question and nothing else. */
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);

    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');

    /* Six boxes, and the borrowed three unticked. The tick is the whole claim: a group
       drawn with all three ticked is what would have hidden the rows. */
    await expect(page.locator('#statusFilters [data-status]')).toHaveCount(6);
    for (const value of ['undecided', 'promoted', 'excluded']) {
      await expect(page.locator(
        `#statusFilters [data-statuskey="trainingDisposition"][data-status="${value}"] .box`))
        .not.toHaveClass(/\bon\b/);
    }
    for (const value of ['unreviewed', 'flagged']) {
      await expect(page.locator(
        `#statusFilters [data-statuskey="reviewStatus"][data-status="${value}"] .box`))
        .toHaveClass(/\bon\b/);
    }

    /* Every box carries a count. They come from the same query Delete's do, over the
       non-status filters only, so a borrowed count can exceed the result total. */
    const counts = await page.locator('#statusFilters [data-status] .n').allTextContents();
    expect(counts).toHaveLength(6);
    expect(counts.every((c) => /^[\d,]+$/.test(c.trim()))).toBe(true);
  });

  test('R1: Training\'s rail leads on its own dimension and borrows review status',
    async ({ page }) => {
      await page.goto('./');
      await expectRealBacking(page);
      await ready(page);
      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      await openRail(page);

      await expect(page.locator('#statusLbl')).toHaveText('Training disposition');
      await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Review status');
      await expect(page.locator('#statusFilters [data-status]')).toHaveCount(6);

      const got = await appliedQuestion(page);
      expect(got.trainingDisposition).toEqual(['undecided']);
      expect(got.reviewStatus, 'borrowed, so it arrives narrowing nothing').toEqual([]);
    });

  test('R9: ticking Excluded in Scientific narrows to excluded observations',
    async ({ page, request }) => {
      const errors = watchErrors(page);

      /* The question the rail is about to ask, asked first and by something that is not
         the app. It is both the precondition -- a corpus with no excluded rows here has
         nothing for this check to be about -- and the second opinion on the total. */
      const narrowed = { reviewStatus: ['unreviewed'], trainingDisposition: ['excluded'] };
      const want = await totalUnder(request, narrowed);
      expect(want, 'no observation in this corpus is both unreviewed and excluded from '
        + 'training, so ticking Excluded has nothing to narrow to').toBeGreaterThan(0);

      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      await page.locator(
        '#statusFilters [data-statuskey="trainingDisposition"][data-status="excluded"]').click();
      await ready(page);

      await expect(page.locator(
        '#statusFilters [data-statuskey="trainingDisposition"][data-status="excluded"] .box'))
        .toHaveClass(/\bon\b/);

      /* Drawn, not merely stored: every tile on the page wears the borrowed EXCLUDED tag,
         which is the visible consequence of the filter having been applied. */
      const tiles = await page.locator('.tile').count();
      expect(tiles).toBeGreaterThan(0);
      await expect(page.locator('.tile .rtag', { hasText: 'EXCLUDED' })).toHaveCount(tiles);

      const only = await page.evaluate(() =>
        window.MARP.state.rows.every((r) => r.training_decision === 'excluded'));
      expect(only, 'the borrowed filter must actually narrow the query').toBe(true);

      /* And it narrowed to the same rows the endpoint says are there, which is the half
         the fixture's row counts used to cover. */
      const got = await appliedQuestion(page);
      expect(got.total, 'the narrowed total must be the endpoint\'s own answer').toBe(want);

      /* Still Scientific: what a tap records is the mode's own, not the borrowed one. */
      await expect(page.locator('#statusLbl')).toHaveText('Review status');
      expect(errors).toEqual([]);
    });

  test('R7: a borrowed filter arrives from the address and stays in it',
    async ({ page, request }) => {
      /* The address is read literally, so `reviewStatus` is still Scientific's own
         default. Counted here before the browser asks, for the same reason as R9. */
      const fromAddress = {
        reviewStatus: ['unreviewed', 'flagged'],
        trainingDisposition: ['excluded']
      };
      const want = await totalUnder(request, fromAddress);
      expect(want, 'no observation in this corpus is excluded from training and still in '
        + 'Scientific\'s opening question, so this address puts nothing on screen')
        .toBeGreaterThan(0);

      await page.goto('./?trainingDisposition=excluded');
      await expectRealBacking(page);
      await ready(page);

      const got = await appliedQuestion(page);
      expect(got.trainingDisposition).toEqual(['excluded']);
      expect(got.total, 'the address\'s question must be the one the endpoint answers')
        .toBe(want);
      const only = await page.evaluate(() =>
        window.MARP.state.rows.every((r) => r.training_decision === 'excluded'));
      expect(only).toBe(true);

      /* The app must not rewrite the address it was given into something else. */
      expect(new URL(page.url()).search).toContain('trainingDisposition=excluded');
    });

  test('R6: the collapsed rail badge counts a borrowed dimension only once it narrows',
    async ({ page }) => {
      await page.goto(undecided());
      await expectRealBacking(page);
      await ready(page);
      await openRail(page);

      const badge = page.locator('#fcount');
      const before = Number(await badge.textContent());

      const promoted = page.locator(
        '#statusFilters [data-statuskey="trainingDisposition"][data-status="promoted"]');
      await promoted.click();
      /* `toHaveText` rather than `ready()` and a read: this is the one check in the file
         whose filter can legitimately match nothing, and `ready()` waits for a tile. The
         badge counts filters, not rows, so it answers either way -- and a retrying
         assertion is what settles it instead of a wait. */
      await expect(badge, 'a narrowing borrowed dimension is one more active filter')
        .toHaveText(String(before + 1));

      await promoted.click();
      await expect(badge, 'and unticking puts it back, because it holds nothing again')
        .toHaveText(String(before));
    });

  test('R8: Delete Mode is unchanged — both dimensions, both defaults', async ({ page }) => {
    await page.goto('./');
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);

    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');

    /* All three training values ticked on arrival: Delete owns the dimension, and there it
       is context rather than a filter. This is what must NOT become "not filtering". */
    for (const value of ['undecided', 'promoted', 'excluded']) {
      await expect(page.locator(
        `#statusFilters [data-statuskey="trainingDisposition"][data-status="${value}"] .box`))
        .toHaveClass(/\bon\b/);
    }
    const got = await appliedQuestion(page);
    expect(got.trainingDisposition).toEqual(['undecided', 'promoted', 'excluded']);
    expect(got.reviewStatus).toEqual(['unreviewed', 'flagged']);
  });
});

/* ------------------------------------------------------- asking without the application

   Three helpers that are local to this file rather than in `support.mjs`, because they
   exist to be *independent of the app* and `support.mjs`'s own `question()` deliberately
   is not: it merges over `DEFAULT_FILTERS` so a page number means the same thing here as
   in the browser. That is right for a sweep and wrong for R3, whose whole subject is what
   `DEFAULT_FILTERS` says. A filters object with a key absent means that dimension is not
   filtering -- `setValue` in `repository/mosaic.repository.js` -- so a literal one is a
   complete question rather than a partial one. */

/** The sort the mosaic opens on, with a tie-break in the direction asked for. */
const tieBreak = (dir) => [
  { field: 'confidence', dir: 'asc' },
  { field: 'keyframe_count', dir }
];

/**
 * How many rows the endpoint returns under a question stated in full by the caller.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} filters - A literal filters object. Absent means not filtering.
 * @returns {Promise<number>} The total.
 */
async function totalUnder(request, filters) {
  const res = await request.post('/api/v2/mosaic/observations/pages', {
    data: {
      filters,
      sort: [{ field: 'confidence', dir: 'asc' }],
      pageSize: 45,
      pages: [1],
      includeTotal: true
    }
  });
  expect(res.ok(), `the count query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  return (await res.json()).total;
}

/**
 * Page one's ids, in the order the endpoint puts them, under a stated question and sort.
 *
 * The page size is the browser's own (`pageSizeOf`) rather than a number: a page of 45
 * compared against a page of 50 differs for a reason that has nothing to do with ordering.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} filters - A literal filters object.
 * @param {Array<Object>} sort - The sort terms, in order.
 * @param {number} pageSize - Rows per page, from the running application.
 * @returns {Promise<Array<string>>} The ids, as the tiles carry them.
 */
async function idsUnder(request, filters, sort, pageSize) {
  const res = await request.post('/api/v2/mosaic/observations/pages', {
    data: { filters, sort, pageSize, pages: [1], includeTotal: false }
  });
  expect(res.ok(), `the ordering query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  const body = await res.json();
  return (body.pages[0].rows || []).map((row) => String(row.observation_id));
}
