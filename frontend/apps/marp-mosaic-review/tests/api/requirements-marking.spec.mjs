/**
 * Requirement checks: marking, reasons, and what a page commit acts on.
 *
 * Migrated from `tests/requirements.js` when #157 retired the fixture. Each check still
 * names the requirement from MARP_API#68 that it holds the prototype to, and still drives
 * the same named actions the interface drives -- so it tests behaviour rather than markup,
 * which is what it was always for.
 *
 * **The body of each check is unchanged apart from its first line.** It runs in the page,
 * because that is where the store runs, and `check-kit.mjs` is what it opens with. What
 * went is the bespoke runner in `tests.html` and the `reset()` that called
 * `MarpData.reload()`: there is no reload against a real server, and a fresh page load per
 * check -- which Playwright gives every test anyway -- is the only reset that resets.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { expectRealBacking, ready, undecided } from './support.mjs';

let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/** Open the application and wait for it to settle, before a check drives the store. */
async function open(page) {
  await page.goto(undecided());
  await expectRealBacking(page);
  await ready(page);
}

test('One gesture, meaning set by the active mode: a tap marks the tile, a second tap unmarks it',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const id = state.rows[0].observation_id;
      actions.toggleMark(id);
      ok(state.marks.has(id), 'first tap should mark');
      actions.toggleMark(id);
      ok(!state.marks.has(id), 'second tap should unmark');
    });
  });

test('One gesture, meaning set by the active mode: the mark means different things per mode',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { MODES, eq } = await import('./tests/api/check-kit.mjs');
      eq(MODES.scientific.mark, 'Flagged');
      eq(MODES.training.mark, 'Excluded');
      eq(MODES.delete.mark, 'Delete');
    });
  });

test('Review states: a reason is optional — a bare mark is valid', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    eq(state.marks.get(id).reason, null, 'a fresh mark carries no reason');
  });
});

test('Review states: choosing the same reason twice clears it', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Wrong species');
    eq(state.marks.get(id).reason, 'Wrong species');
    actions.setReason(id, 'Wrong species');
    eq(state.marks.get(id).reason, null, 'second press should clear');
  });
});

test('Exception marking and the page commit: scientific commit acts on the UNMARKED tiles',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, ok, prepare, commitRows } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const marked = state.rows[0].observation_id;
      actions.toggleMark(marked);
      const res = await commitRows('scientific', state.rows,
        new Map([[marked, { reason: null }]]));
      ok(!res.reviewed.some((r) => r.observation_id === marked),
        'the marked tile must not be accepted');
      ok(res.flagged.some((f) => f.observation_id === marked && f.outcome === 'flagged'),
        'it should be reported as flagged, which is a decision rather than a skip');
    });
  });

test('Marking a whole page at once: the scope is the page, never the whole query',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      actions.markAllOnPage();
      eq(state.marks.size, state.rows.length, 'every tile on the page');
      ok(state.total > state.rows.length, 'the query is larger than the page');
      ok(state.marks.size < state.total, 'the query must not be marked');
    });
  });

test('Navigating pages: page navigation clamps to the available range', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { state, actions, eq, prepare, wait } = await import('./tests/api/check-kit.mjs');
    await prepare();
    actions.goToPage(99999);
    await wait(400);
    eq(state.page, state.pageCount, 'should clamp to the last page');
    actions.goToPage(-4);
    await wait(400);
    eq(state.page, 1, 'should clamp to the first page');
  });
});

test('Filter and sort dimensions: confidence sorting is applied by the query, not the client',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, eq, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const c = state.rows.map((r) => r.confidence);
      const sorted = c.slice().sort((a, b) => a - b);
      eq(c, sorted, 'page 1 should be ascending by confidence');
    });
  });

test('Moving through pages: committing does not clear the page or advance', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare();
    const before = state.page;
    const ids = state.rows.map((r) => r.observation_id);
    await actions.commitPage();
    eq(state.page, before, 'the page must not advance');
    eq(state.rows.map((r) => r.observation_id), ids, 'the page must stay loaded');
    ok(state.committedPages.has(before), 'the page should be recorded as committed');
  });
});

/* A named export so the file is not mistaken for a place to add a helper: everything
   shared lives in `check-kit.mjs`, which the page imports, or in `support.mjs`, which
   Node does. */
export { };
