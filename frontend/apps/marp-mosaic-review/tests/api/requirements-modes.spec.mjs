/**
 * Requirement checks: the modes, the filters, paging, corrections, and Delete Mode.
 *
 * Migrated from `tests/requirements.js` when #157 retired the fixture -- the block that
 * ran from source line 468 to line 930. Each check still names the requirement from
 * MARP_API#68 that it holds the prototype to, and still drives the same named actions the
 * interface drives, so it tests behaviour rather than markup.
 *
 * **The body of each check is the original one.** It runs in the page, because that is
 * where the store runs, and `check-kit.mjs` is what it opens with. What went is the
 * bespoke runner in `tests.html` and the `reset()` that called `MarpData.reload()`.
 *
 * Three things about a real backing shape this file, and each of them was a line that
 * could not survive verbatim:
 *
 * - **A commit does not write the row's status column back** (#131). The fixture did, in
 *   place, so `state.rows.find(...).review_decision` read as the record a moment after a
 *   commit. Against the endpoint a decision is a projection row and the page keeps the
 *   rows the reviewer was handed -- a committed page is served from its own pins and costs
 *   no request -- so every check that asked the row what the record says now asks the
 *   record, through `MarpBackend.query`. That is the gap this tier exists to see, and on
 *   the fixture several of these lines could not have failed.
 * - **A correction records a `corrected` decision**, which is none of `reviewStatus`'s
 *   three values, so a corrected row leaves every status-filtered question. Both checks
 *   that turn on where a corrected row ends up say what they do about it.
 * - **No fixture literal survives.** `species: [41]`, `changeSpecies(id, 43)` and
 *   `changeSpecies(id, 45)` were Bat Star, Ochre Star and Sunflower Star in one local
 *   database. The species a correction goes *to* is discovered from the catalogue and
 *   checked against the name the row already carries, because the route refuses an
 *   unchanged correction; the reviewer id is `state.me.user_id`.
 *
 * **Where a check needs a page it can be certain of, it seeds one.** A page of corpus rows
 * is the right thing to sweep, but it cannot be re-read row by row afterwards and it does
 * not survive a mode switch in one piece -- so the checks that write a decision and then
 * read it back run on `seedPage()` rows on a line of their own, and the read-only ones and
 * the ones that only look at store state stay on the corpus. A seeded check says
 * `ledger.forget()` before `remove()`, because the two ways of putting the record back
 * disagree about rows that are going away.
 *
 * The helpers at the bottom are the whole of the species discovery. They are local because
 * `support.mjs` is shared and other agents are in it.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import {
  commitOne,
  expectRealBacking,
  facetsFor,
  pageOf,
  pageSizeOf,
  ready,
  undecided
} from './support.mjs';

/** Every check here may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/** Open the application and wait for it to settle, before a check drives the store. */
async function open(page) {
  await page.goto(undecided());
  await expectRealBacking(page);
  await ready(page);
}

/* ------------------------------------------------------- training data review */

test('Training data review: promoting one tile and committing it reads as promoted, not as a take-back (#135)',
  async ({ page }) => {
    /* Four rows of this check's own. It commits and then asks the record what it says, and
       a page narrowed to a seeded line is the only page every row of which can be re-read. */
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, pendingTakeBack, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        /**
         * All three steps of #135, at the tier that drives the real store.
         *
         * Step 1 was reported as landing straight in the state that belongs to step 2. That
         * was a **server** older than #126 answering `excluded` for an accept mark: the mark
         * then does not survive its own commit, the tile is unmarked and touched, and its
         * outcome equals the mode's exception -- which is exactly what a take-back is. The
         * endpoint has answered `promoted` since, and this holds it there.
         */
        await prepare('training', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready');
        ok(target, 'page 1 should contain a promotable track');
        const id = target.observation_id;

        actions.acceptMark(id);                       // right click: promote this one
        await actions.commitMarked();
        eq(state.outcomes.get(id), 'promoted', 'step 1: the tile reads as promoted');
        ok(state.marks.has(id), 'and the accept mark survives the commit that honoured it');

        actions.acceptMark(id);                       // click it again: take it back
        ok(!state.marks.has(id), 'step 2: the mark comes off');
        const row = state.rows.find((r) => r.observation_id === id);
        eq(pendingTakeBack({
          mode: 'training', row, marks: state.marks, takenBack: state.takenBack,
          outcomes: state.outcomes
        }), 'promoted', 'and the promotion is what is being taken back');

        await actions.commitMarked();
        eq(state.outcomes.get(id), 'withdrawn', 'step 3: the withdrawal is recorded');
        eq(state.conflicted.length, 0, 'and it is not refused as a conflict');
        eq(pendingTakeBack({
          mode: 'training', row, marks: state.marks, takenBack: state.takenBack,
          outcomes: state.outcomes
        }), null, 'so the take-back label goes -- in the page');

        /* And in the record. Asked of the record rather than of `row`: a commit does not
           write the row's status column (#131), so the row on screen says null whatever the
           commit did, and the original line could not have failed. */
        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 100
        });
        const recorded = fresh.rows.find((r) => r.observation_id === id);
        ok(recorded, 'the observation is still on its own line');
        eq(recorded.training_decision, null, 'and in the record, which now carries no decision');
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Training data review: committing the same page twice is not a phantom conflict (#135 R6)',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare } = await import('./tests/api/check-kit.mjs');
      /**
       * **A commit does not move `observations.version`**, so the second commit of a tile in
       * one sitting sends the version the endpoint still holds. The client used to add one
       * itself, which was true of the fixture and false of the endpoint -- and made every
       * row of a second commit come back `conflicted` for a conflict that had not happened.
       *
       * It commits twice because committing once cannot see it. It runs on a corpus page
       * deliberately: what it is about is a real page of real versions.
       */
      await prepare('training');
      const id = state.rows.find((r) => r.thumbnail_status === 'ready').observation_id;

      await actions.commitPage();
      eq(state.conflicted.length, 0, 'the first commit lands');
      await actions.commitPage();
      eq(state.conflicted.length, 0, 'and so does the second, on the same versions');
      eq(state.outcomes.get(id), 'promoted');
    });
  });

/* --------------------------------------------------- filter and sort dimensions */

test('Filter and sort dimensions: filtering by a disposition returns only observations carrying it',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, decidedAs, eq, prepare } = await import('./tests/api/check-kit.mjs');
      for (const want of ['excluded', 'promoted', 'undecided']) {
        /* **`reviewStatus: []` is not filtering**, and it is what keeps this honest. The
           original asked under Scientific's opening status filter, which was free on the
           fixture and is not here: most of what a real corpus has excluded or promoted has
           been reviewed too, so the page would come back empty -- and a filter check with
           no rows under it is green for the wrong reason. */
        await prepare('training', { trainingDisposition: [want], reviewStatus: [] });
        const wrong = state.rows.filter((r) => decidedAs('trainingDisposition', r) !== want);
        eq(wrong.length, 0,
          `every row under the ${want} filter must be ${want}; ${wrong.length} were not`);
      }
    });
  });

test('Filter and sort dimensions: filtering by review status returns only observations carrying it',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, decidedAs, eq, prepare } = await import('./tests/api/check-kit.mjs');
      for (const want of ['reviewed', 'unreviewed']) {
        /* The borrowed dimension is switched off for the same reason as above: a reviewed
           row that training has also promoted must not be filtered out of a check about
           review status. */
        await prepare('scientific', { reviewStatus: [want], trainingDisposition: [] });
        const wrong = state.rows.filter((r) => decidedAs('reviewStatus', r) !== want);
        eq(wrong.length, 0, `every row under the ${want} filter must be ${want}`);
      }
    });
  });

/* Marks are uncommitted work. Navigating away and back must not lose them,
   and this must behave identically in every mode. */
for (const mode of ['scientific', 'training', 'delete']) {
  test(`Moving through pages: an uncommitted mark survives leaving the page and returning — ${mode}`,
    async ({ page }) => {
      await open(page);
      await page.evaluate(async (m) => {
        const { state, actions, ok, prepare, wait } = await import('./tests/api/check-kit.mjs');
        /* The original waited 350 ms, which was the fixture's simulated latency. A real
           query is slower and variable, so the wait is on the observable: `settled()` in the
           store puts the rows in and then clears `loading`. */
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

        await prepare(m);
        const id = state.rows[0].observation_id;
        actions.toggleMark(id);
        ok(state.marks.has(id), 'marked to begin with');

        actions.goToPage(2);
        await wait(100);
        await settled(() => state.page === 2 && !state.loading);
        ok(!state.rows.some((r) => r.observation_id === id), 'we really did leave the page');

        actions.goToPage(1);
        await wait(100);
        await settled(() => state.page === 1 && !state.loading);
        ok(state.rows.some((r) => r.observation_id === id), 'and came back to it');
        ok(state.marks.has(id), 'the mark must still be there');
      }, mode);
    });

  test(`Moving through pages: a reason on an uncommitted mark survives too — ${mode}`,
    async ({ page }) => {
      /* The original answered `'skipped — delete marks carry no reason'` for this mode, so
         it is skipped rather than passed: the report says what it always said, instead of
         a check that ran and asserted nothing. */
      test.skip(mode === 'delete', 'delete marks carry no reason');

      await open(page);
      await page.evaluate(async (m) => {
        const { state, actions, eq, prepare, wait } = await import('./tests/api/check-kit.mjs');
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

        await prepare(m);
        const id = state.rows[0].observation_id;
        actions.toggleMark(id);
        actions.setReason(id, 'Occluded');
        actions.goToPage(2);
        await wait(100);
        await settled(() => state.page === 2 && !state.loading);
        actions.goToPage(1);
        await wait(100);
        await settled(() => state.page === 1 && !state.loading);
        eq(state.marks.get(id) && state.marks.get(id).reason, 'Occluded');
      }, mode);
    });
}

/* ------------------------------------------------------------- review states */

/* A mark is a decision, not client state: committing must write it to the record,
   so it is still there after leaving the page, and would survive a reload. */
test('Review states: committing a flag writes it to the observation, with its reason',
  async ({ page }) => {
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.review_decision == null);
        ok(target, 'need an unreviewed row');
        const id = target.observation_id;
        actions.toggleMark(id);
        actions.setReason(id, 'Wrong species');
        await actions.commitPage();

        /* **The record, read back.** This was `state.rows.find(...)`, which is the row the
           reviewer was handed: the fixture rewrote its status column in place at commit
           time and the endpoint deliberately does not (#131), so reading the row here is
           reading what the client already believed rather than what was written. */
        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 100
        });
        const row = fresh.rows.find((r) => r.observation_id === id);
        ok(row, 'the observation is still on its own line');
        eq(row.review_decision, 'flagged', 'the record must carry the flag');
        eq(row.flag_reason, 'Wrong species', 'and the reason');
        eq(row.review_reviewer_id, state.me.user_id, 'and who flagged it, as an id');
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Review states: a committed flag is still shown after leaving the page and returning',
  async ({ page }) => {
    await open(page);
    /* Two full pages **after** the commit pins the first one, which is what the count is
       for: the pinned ids become the query's exclusion set, so a page one and two spare
       rows would leave nothing to page to. The size comes from the browser rather than
       from a number that is right at one viewport. */
    const size = await pageSizeOf(page);
    const seeded = await seedPage({ count: (size * 2) + 2 });

    try {
      await page.evaluate(async ({ line }) => {
        const { state, actions, eq, ok, prepare, wait, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.review_decision == null);
        ok(target, 'need an unreviewed row');
        const id = target.observation_id;
        actions.toggleMark(id);
        actions.setReason(id, 'Bounding box');
        await actions.commitPage();

        actions.goToPage(2);
        await wait(100);
        await settled(() => state.page === 2 && !state.loading);
        actions.goToPage(1);
        await wait(100);
        await settled(() => state.page === 1 && !state.loading);

        const row = state.rows.find((r) => r.observation_id === id);
        ok(row, 'a flagged observation is open work, so it stays in the default view');
        /* What the page shows. A committed page is served from its own pins, so this is
           the row the reviewer submitted and what the tile draws over it is the outcome. */
        eq(state.outcomes.get(id), 'flagged', 'and the page still shows it as flagged');

        /* And what the record says, which against a real server is a second question. */
        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 300
        });
        const recorded = fresh.rows.find((r) => r.observation_id === id);
        ok(recorded, 'the observation is still on its own line');
        eq(recorded.review_decision, 'flagged');
        eq(recorded.flag_reason, 'Bounding box', 'the reason survives too');
      }, { line: seeded.line });
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Training data review: committing an exclusion writes it to the observation, with its reason',
  async ({ page }) => {
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('training', { line: [line] });
        const id = state.rows.find((r) => r.thumbnail_status === 'ready').observation_id;
        actions.toggleMark(id);
        actions.setReason(id, 'Occluded');
        await actions.commitPage();

        /* The original read the row first and fell back to a query. Against the endpoint
           the row is always there and always stale (#131), so the fallback could never run
           and the assertion read what the client already believed. The query is the whole
           of it now. */
        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 100
        });
        const row = fresh.rows.find((r) => r.observation_id === id);
        ok(row, 'the observation is still on its own line');
        eq(row.training_decision, 'excluded');
        eq(row.exclusion_reason, 'Occluded');
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

/* ------------------------------------------------- correcting an observation */

test('Correcting an observation: a species correction is still visible on the tile after returning',
  async ({ page, request }) => {
    await open(page);

    /* The row first, so the species discovered for it is one it is not already on: the
       correction route refuses a change to the species the row already carries, as
       `unchanged`, and nothing is written. */
    const target = await page.evaluate(async () => {
      const { state, prepare } = await import('./tests/api/check-kit.mjs');
      /* **No status filter at all**, where the original cleared only the species one. A
         correction records a `corrected` decision, which is none of `reviewStatus`'s three
         values -- so under any status filter the corrected row would leave the page for
         that reason, and the premise below ("it cannot have left") would be false. */
      await prepare('scientific', { reviewStatus: [] });
      const row = state.rows.find((r) => r.review_decision == null && r.species_comname);
      return row && {
        id: row.observation_id,
        was: row.species_comname,
        label: row.comname
      };
    });
    expect(target, 'page 1 holds no undecided row carrying a current species name, so there '
      + 'is nothing here to correct and read back.').toBeTruthy();

    const pick = await speciesOtherThan(request, target.was);

    await page.evaluate(async ({ id, was, label, other }) => {
      const { state, actions, eq, ok, wait } = await import('./tests/api/check-kit.mjs');
      const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

      /* What the tile is **showing** is the current species -- not the annotator's frozen
         `comname`. Those are two different fields and confusing them is F6. */
      actions.toggleMark(id);
      await actions.changeSpecies(id, other.id);
      actions.goToPage(2);
      await wait(100);
      await settled(() => state.page === 2 && !state.loading);
      actions.goToPage(1);
      await wait(100);
      await settled(() => state.page === 1 && !state.loading);
      const row = state.rows.find((r) => r.observation_id === id);
      ok(row, 'with no species filter set, the corrected row cannot have left the page');
      /**
       * F6. The corrected name is `species_comname`; `comname` is **never rewritten**.
       *
       * This asserted `row.comname === 'Sunflower Star'` and `row.previous_comname === was`.
       * Both were the fixture's rule rather than the contract's: `comname` is the label the
       * annotator's list entry carried and keeping it frozen is what makes the drift
       * auditable, and no row has ever carried `previous_comname`. What the reviewer sees as
       * "was X" comes from `state.changed`, which is A12's answer -- the indicator appears
       * only after a correction made in this session.
       *
       * The annotator label is captured on its own rather than assumed equal to the species
       * name. They are equal on a row nobody has corrected, and on the fixture they were
       * always equal, which is what let the original assert one against the other.
       */
      eq(row.species_comname, other.comname, 'the correction persists');
      eq(row.comname, label, 'the annotator label is untouched, deliberately');
      eq(state.changed.get(id).from, was, 'and the session remembers what it was');
      eq(state.changed.get(id).to, other.comname,
        'read from species_comname; comname would have made from and to the same name');
    }, { id: target.id, was: target.was, label: target.label, other: pick });
  });

/* The case the one above sidesteps by clearing the species filter, and the reason this
   check exists at all: for a while the only thing asserting it was a narrated walkthrough,
   which is a review surface and is recorded on request -- so between recordings nothing
   watched this. A skipped branch looks green, which is exactly how it hid. */
test('Correcting an observation: a correction under a species filter takes the row off the page, and the other marks stay',
  async ({ page, request }) => {
    /**
     * The premise, established rather than inherited.
     *
     * `reset()` asked the mosaic's premise by pinning Bat Star as `species: [41]`, which is
     * a fact about one local database. The species is discovered here instead, under the
     * same question the page will ask, and it has to hold three observations or the check
     * cannot mean anything.
     */
    const facets = await facetsFor(request, {
      reviewStatus: ['unreviewed'], trainingDisposition: ['undecided']
    });
    const species = (facets.species || []).find((entry) => entry.count >= 3);
    expect(species, 'no species in this corpus has three undecided observations, so there is '
      + 'no page this check can be about. It fails rather than skipping.').toBeTruthy();

    await open(page);

    const target = await page.evaluate(async (speciesId) => {
      const { state, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { species: [speciesId] });
      return state.rows.slice(0, 3).map((r) => ({
        id: r.observation_id, name: r.species_comname || r.comname
      }));
    }, species.value);

    const pick = await speciesOtherThan(request, target.length ? target[0].name : '');

    await page.evaluate(async ({ ids, other }) => {
      const { state, actions, eq, ok } = await import('./tests/api/check-kit.mjs');
      /* `prepare()` already asked the mosaic's premise -- one predicted species. This line
         used to re-derive that same id from `state.rows[0].species_id`, a field **only the
         fixture's row carries**: the endpoint has never sent one (#130), so the check's
         premise could not have been set up against the real API at all, and it was reading
         a value the filter above it had just chosen. */
      ok(state.filters.species.length === 1,
        'the premise: the page is one predicted species');

      const [a, b, c] = ids;
      ok(c != null, 'this check needs three rows of one species to be meaningful');
      for (const id of ids) actions.toggleMark(id);
      eq(state.marks.size, 3, 'three marked before the correction');

      /* The species corrected **to** is deliberately not the one being filtered on. */
      await actions.changeSpecies(a, other.id);
      await actions.refresh();

      /* **Weaker than it reads against a real server**, and worth saying so: a correction
         also records a `corrected` decision, so the row now fails the status filter as well
         as the species one. Clearing the status filter to isolate the species is not the
         fix -- it puts already-decided rows on the page, they arrive with their exceptions
         marked, and the three marks above stop being three. */
      ok(!state.rows.some((r) => r.observation_id === a),
        'the corrected row no longer matches the filter, so it must leave the page');
      ok(state.rows.some((r) => r.observation_id === b)
        && state.rows.some((r) => r.observation_id === c),
        'the two the reviewer did not touch must still be there');
      ok(state.marks.has(b) && state.marks.has(c),
        'and their flags are untouched -- correcting one tile is not a decision about another');
    }, { ids: target.map((entry) => entry.id), other: pick });
  });

/* Reported 2026-09-04: choosing a species made the panel vanish and immediately
   reappear. Two faults — the panel never closed on a correction, and renderPicker
   blanked it before awaiting the taxonomy. Both are behaviour, so both are checked. */
test('Correcting an observation: choosing a species closes the panel, because that is what it was opened to do',
  async ({ page, request }) => {
    await open(page);
    const target = await firstRow(page);
    const pick = await speciesOtherThan(request, target.name);

    await page.evaluate(async ({ id, other }) => {
      const { state, actions, eq, ok } = await import('./tests/api/check-kit.mjs');
      actions.toggleMark(id);
      actions.openPicker(id);
      ok(state.picker && state.picker.id === id, 'the panel is open before the correction');
      await actions.changeSpecies(id, other.id);
      eq(state.picker, null, 'and closed after it');
    }, { id: target.id, other: pick });
  });

test('Correcting an observation: the correction closes the panel but keeps the mark: they are separate decisions',
  async ({ page, request }) => {
    await open(page);
    const target = await firstRow(page);
    const pick = await speciesOtherThan(request, target.name);

    await page.evaluate(async ({ id, other }) => {
      const { state, actions, ok } = await import('./tests/api/check-kit.mjs');
      actions.toggleMark(id);
      actions.openPicker(id);
      await actions.changeSpecies(id, other.id);
      ok(state.marks.has(id), 'correcting the species does not resolve the flag');
      ok(state.changed.has(id), 'and the correction is recorded');
    }, { id: target.id, other: pick });
  });

test('Correcting an observation: correcting one tile never closes a panel belonging to another',
  async ({ page, request }) => {
    await open(page);
    const target = await firstRow(page, { second: true });
    const pick = await speciesOtherThan(request, target.name);

    await page.evaluate(async ({ id, second, other }) => {
      const { state, actions, ok } = await import('./tests/api/check-kit.mjs');
      const a = id;
      const b = second;
      actions.toggleMark(a);
      actions.toggleMark(b);
      actions.openPicker(b);
      await actions.changeSpecies(a, other.id);     // a different tile
      ok(state.picker && state.picker.id === b, 'the open panel is left alone');
    }, { id: target.id, second: target.second, other: pick });
  });

/* ------------------------------------------------------- moving through pages */

/* Returning to a committed page must show what was submitted — the accepted
   observations as well as the flagged ones — so it can be changed and resubmitted. */
test('Moving through pages: a committed page still shows everything that was submitted on it',
  async ({ page }) => {
    await open(page);
    const size = await pageSizeOf(page);
    const seeded = await seedPage({ count: (size * 2) + 2 });

    try {
      await page.evaluate(async ({ line }) => {
        const { state, actions, eq, ok, prepare, wait, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

        await prepare('scientific', { line: [line] });
        const before = state.rows.map((r) => r.observation_id);
        const flagged = state.rows.find((r) => r.thumbnail_status === 'ready'
          && !state.marks.has(r.observation_id)).observation_id;
        actions.toggleMark(flagged);                  // toggling a seeded mark would unflag it
        ok(state.marks.has(flagged), 'the row under test is marked');
        await actions.commitPage();

        const accepted = state.rows
          .filter((r) => state.outcomes.get(r.observation_id) === 'reviewed')
          .map((r) => r.observation_id);
        ok(accepted.length > 0, 'the commit should have accepted several observations');

        actions.goToPage(2);
        await wait(100);
        await settled(() => state.page === 2 && !state.loading);
        actions.goToPage(1);
        await wait(100);
        await settled(() => state.page === 1 && !state.loading);

        eq(state.rows.map((r) => r.observation_id), before,
          'the page must hold the same observations it was committed with');

        /* "Still show as accepted" is two questions against a real server, and both are
           asked: the pinned page hands back the rows the reviewer submitted, and the
           endpoint never writes their status columns (#131), so what the record says has
           to be read from the record. */
        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 300
        });

        for (const id of accepted) {
          const row = state.rows.find((r) => r.observation_id === id);
          ok(row, `accepted observation ${id} must still be on the page`);
          const recorded = fresh.rows.find((r) => r.observation_id === id);
          ok(recorded, `accepted observation ${id} must still be readable`);
          eq(recorded.review_decision, 'reviewed', 'and still show as accepted');
        }
        const f = fresh.rows.find((r) => r.observation_id === flagged);
        eq(f.review_decision, 'flagged', 'and the flagged one is still flagged');
      }, { line: seeded.line });
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Moving through pages: a committed decision can be changed and resubmitted from the same page',
  async ({ page }) => {
    await open(page);
    const size = await pageSizeOf(page);
    const seeded = await seedPage({ count: (size * 2) + 2 });

    try {
      await page.evaluate(async ({ line }) => {
        const { state, actions, eq, ok, prepare, wait, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };
        /* Every assertion below used to read `state.rows`, which a commit does not move
           (#131) -- the middle one would have read null before the commit as well as after
           it. Each is asked of the record instead, and the seeded line comes back whole in
           one query. */
        const recordFor = async (id) => {
          const fresh = await MarpBackend.query({
            filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
            sort: state.sort, page: 1, pageSize: 300
          });
          return fresh.rows.find((r) => r.observation_id === id);
        };

        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && !state.marks.has(r.observation_id));
        ok(target, 'need a row with imagery that nobody has decided about');
        const id = target.observation_id;
        await actions.commitPage();
        eq((await recordFor(id)).review_decision, 'reviewed');

        actions.goToPage(2);
        await wait(100);
        await settled(() => state.page === 2 && !state.loading);
        actions.goToPage(1);
        await wait(100);
        await settled(() => state.page === 1 && !state.loading);

        /* Change your mind about it. On a committed acceptance the first click takes the
           acceptance back rather than flagging it (#135 R8), so reaching a flag from the
           same page is two clicks and two commits -- which is what this check now walks. */
        actions.toggleMark(id);
        await actions.commitPage();
        eq((await recordFor(id)).review_decision, null, 'the acceptance comes off first');

        actions.toggleMark(id);
        await actions.commitPage();
        const row = await recordFor(id);
        eq(row.review_decision, 'flagged', 'resubmitting applies the change');
      }, { line: seeded.line });
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

/* ----------------------------------------------------------------- delete mode */

/* Delete Mode deliberately reads Review status: what the record already says is the
   most useful thing to know before removing something permanently. Confirmed by the
   walkthrough on 2026-09-05, where the narration claimed the opposite. */
test('Delete mode: Delete Mode shows what the scientific record already says',
  async ({ page }) => {
    /* The mode switch re-asks the question with Delete's own status defaults, so the page
       is not the page it was and a corpus row that was on page one need not be. Seeded rows
       on a line of their own are the same handful of observations either side of it.
       **Nothing here commits in Delete Mode**, so nothing is destroyed. */
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, statusDimensions, wait } =
          await import('./tests/api/check-kit.mjs');
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && !state.marks.has(r.observation_id));
        ok(target, 'need a row with imagery that nobody has decided about');
        const id = target.observation_id;
        actions.toggleMark(id);
        await actions.commitPage();                   // flags it on the record

        actions.setMode('delete');
        await wait(100);
        await settled(() => state.mode === 'delete' && !state.loading);
        eq(statusDimensions('delete')[0].label, 'Review status',
          'Delete leads on review status');
        const row = state.rows.find((r) => r.observation_id === id);
        ok(row, 'the flagged observation is still in the delete-mode results');
        /* A fresh query rather than a pinned page: the mode switch is a different question,
           so this row came off the record rather than out of the commit that wrote it. */
        eq(row.review_decision, 'flagged', 'and it still carries its flag');
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Delete mode: nothing arrives marked in Delete Mode: a flag is not a deletion',
  async ({ page }) => {
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, pendingException, wait } =
          await import('./tests/api/check-kit.mjs');
        const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && !state.marks.has(r.observation_id));
        ok(target, 'need a row with imagery that nobody has decided about');
        const id = target.observation_id;
        actions.toggleMark(id);
        await actions.commitPage();

        actions.setMode('delete');
        await wait(100);
        await settled(() => state.mode === 'delete' && !state.loading);
        eq(state.marks.size, 0, 'marking here means delete, so the flag must not seed one');
        eq(pendingException('delete'), null);
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

/* ------------------------------------------------------------- review states */

/* Reported 2026-09-04: flags vanished when a mode was switched, and a committed page
   could not be edited. Both came from marks not being the page's exception set. */
test('Review states: a page arrives with its existing flags already marked',
  async ({ page, request }) => {
    /**
     * The flags are put on the record first, through the API, and that is what replaces
     * the skip.
     *
     * The original answered `'skipped — no flagged rows on this page'` when page one
     * happened to hold none. On a real corpus, under the `reviewStatus: ['unreviewed']`
     * that gives every other check an unmarked page, it would hold none **every time** --
     * a check that can only skip. Two of this check's own rows are flagged before the page
     * is opened, so the premise is arranged rather than hoped for, and an empty set is a
     * failure.
     */
    const seeded = await seedPage({ count: 4 });

    try {
      const { rows } = await pageOf(request, { line: [seeded.line] });
      expect(rows.length, 'the seeded page did not come back from the mosaic query')
        .toBeGreaterThanOrEqual(3);
      await commitOne(request, rows[0], { marked: true });
      await commitOne(request, rows[1], { marked: true });

      await open(page);
      await page.evaluate(async (line) => {
        const { state, ok, prepare } = await import('./tests/api/check-kit.mjs');
        /* `flagged` is asked for explicitly: `prepare` narrows to `unreviewed`, which is
           what gives the other checks here a page that arrives unmarked. */
        await prepare('scientific', { line: [line], reviewStatus: ['unreviewed', 'flagged'] });
        const flaggedRows = state.rows.filter((r) => r.review_decision === 'flagged');
        ok(flaggedRows.length > 0, 'the page must hold the flags this check put on the '
          + 'record, or it is asserting nothing');
        for (const r of flaggedRows) {
          ok(state.marks.has(r.observation_id),
            `flagged observation ${r.observation_id} must arrive marked, or committing clears it`);
        }
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Review states: committing a page does not clear a flag nobody touched',
  async ({ page, request }) => {
    const seeded = await seedPage({ count: 4 });

    try {
      const { rows } = await pageOf(request, { line: [seeded.line] });
      expect(rows.length, 'the seeded page did not come back from the mosaic query')
        .toBeGreaterThanOrEqual(2);
      await commitOne(request, rows[0], { marked: true });

      await open(page);
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line], reviewStatus: ['unreviewed', 'flagged'] });
        const flagged = state.rows.find((r) => r.review_decision === 'flagged'
          && r.thumbnail_status === 'ready');
        /* Arranged above rather than looked for, so its absence is a failure rather than
           the `'skipped — no flagged rows on this page'` the original answered. */
        ok(flagged, 'the flag this check put on the record is not on the page');
        const id = flagged.observation_id;
        await actions.commitPage();

        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 100
        });
        const row = fresh.rows.find((r) => r.observation_id === id);
        ok(row, 'the observation is still on its own line');
        eq(row.review_decision, 'flagged', 'an untouched flag survives a page commit');
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Review states: a committed page stays editable: the exceptions are still marked',
  async ({ page }) => {
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && !state.marks.has(r.observation_id));
        ok(target, 'need a row with imagery that nobody has decided about');
        const id = target.observation_id;
        actions.toggleMark(id);
        await actions.commitPage();
        ok(state.marks.has(id), 'the flag stays marked so a click can take it back');
        actions.toggleMark(id);
        await actions.commitPage();
        /* **Withdrawn, and this line expected `reviewed`** (#135 R7). Taking the flag off is
           a take-back, and a take-back is withdrawn by whichever button commits it -- the
           sweep included, which is the half that was wrong. The sweep's own rule is
           untouched: everything merely unmarked on this page was still accepted by the same
           commit.

           Asked of the record, because on the row it reads null before the first commit as
           well as after the second -- so against the endpoint this line could not fail. */
        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 100
        });
        const row = fresh.rows.find((r) => r.observation_id === id);
        ok(row, 'the observation is still on its own line');
        eq(row.review_decision, null,
          'and committing again withdraws it, rather than accepting it');
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

/* ------------------------------------- scientific and training are independent */

test('Scientific review and training review are independent: switching modes clears what the other mode committed',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare, wait } = await import('./tests/api/check-kit.mjs');
      const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

      await prepare();
      await actions.commitPage();
      ok(state.outcomes.size > 0, 'the scientific commit recorded outcomes');
      actions.setMode('training');
      await wait(100);
      await settled(() => state.mode === 'training' && !state.loading);
      eq(state.outcomes.size, 0, "training must not wear scientific review's answers");
      eq(state.marks.size, 0, 'nor its marks');
    });
  });

/* #85 made every workflow's tags visible from every mode, which makes this the check that
   the *decisions* stayed independent: seeing that something is excluded from training must
   not let a scientific commit write a training disposition. Added 2026-09-08. */
test('Scientific review and training review are independent: a scientific commit writes only the review status',
  async ({ page }) => {
    /* Every row on the page has to be re-read afterwards to see whether a training
       disposition moved, and only a page this check owns can be re-read whole. On a corpus
       page the "before" and the "after" would be the same stale row objects, so the drift
       check would pass without having asked the record anything (#131). */
    const seeded = await seedPage({ count: 4 });
    await open(page);

    try {
      await page.evaluate(async (line) => {
        const { state, actions, eq, ok, prepare, MarpBackend } =
          await import('./tests/api/check-kit.mjs');
        await prepare('scientific', { line: [line] });
        const target = state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.review_decision == null);
        ok(target, 'page 1 should contain an unreviewed row with imagery');
        const id = target.observation_id;
        /* What the whole page said about training before the scientific commit. */
        const before = new Map(state.rows.map((r) => [r.observation_id, r.training_decision]));

        actions.toggleMark(id);                        // flag this one, accept the rest
        await actions.commitPage();

        const fresh = await MarpBackend.query({
          filters: { line: [line], reviewStatus: [], trainingDisposition: [] },
          sort: state.sort, page: 1, pageSize: 100
        });
        const row = fresh.rows.find((r) => r.observation_id === id);
        ok(row, 'the observation is still on its own line');
        eq(row.review_decision, 'flagged', 'the flag is written');
        ok(state.outcomes.size > 1, 'the rest of the page was accepted, so this is not vacuous');

        const drifted = fresh.rows
          .filter((r) => before.has(r.observation_id)
            && r.training_decision !== before.get(r.observation_id))
          .map((r) => r.observation_id);
        eq(drifted.length, 0,
          `no scientific decision may write a training disposition, changed: ${drifted}`);
      }, seeded.line);
    } finally {
      ledger.forget(seeded.ids);
      await seeded.remove();
    }
  });

test('Moving through pages: an observation pinned to a committed page does not also appear on a later page',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare, wait } = await import('./tests/api/check-kit.mjs');
      const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };

      await prepare();
      const pinned = new Set(state.rows.map((r) => r.observation_id));
      await actions.commitPage();
      actions.goToPage(2);
      await wait(100);
      await settled(() => state.page === 2 && !state.loading);
      const overlap = state.rows.filter((r) => pinned.has(r.observation_id));
      eq(overlap.length, 0, 'page 2 must not repeat observations held by page 1');
    });
  });

/* ------------------------------------------------------------------ discovery */

/**
 * The first row of the default page, and the species name it currently carries.
 *
 * The three picker checks took `state.rows[0]` and corrected it to a pinned id. They still
 * take the first row; what they cannot do any more is name the species, so the name it is
 * on comes back with it and `speciesOtherThan` finds it something it is not.
 *
 * @param {import('@playwright/test').Page} page - A settled page.
 * @param {Object} [options] - `second` also returns the row after it.
 * @returns {Promise<Object>} `{id, name, second}`.
 */
async function firstRow(page, { second = false } = {}) {
  const found = await page.evaluate(async (wantSecond) => {
    const { state, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare();
    const [a, b] = state.rows;
    return a && {
      id: a.observation_id,
      name: a.species_comname || a.comname,
      second: wantSecond && b ? b.observation_id : null
    };
  }, second);

  expect(found, 'the default page came back empty, so there is no tile to correct.')
    .toBeTruthy();
  if (second) {
    expect(found.second, 'the default page holds one row, and this check needs two tiles so '
      + 'one of them can own the open panel.').toBeTruthy();
  }
  return found;
}

/** Answers already fetched. The catalogue does not move during a run. */
const memo = new Map();

/** Ask once, remember the answer. */
async function once(key, make) {
  if (!memo.has(key)) memo.set(key, await make());
  return memo.get(key);
}

/**
 * A species from the catalogue that is **not** the one named.
 *
 * `changeSpecies(id, 43)` and `changeSpecies(id, 45)` were Ochre Star and Sunflower Star,
 * which is a fact about one local database and exactly what #157 is removing. The
 * replacement discovers: the search terms come from names the corpus itself carries, and
 * the candidate is the first answer whose name differs from the one the row already has --
 * because the correction route refuses a change to the species already held, as
 * `unchanged`, and nothing is written. A different name is a different id, which is what
 * makes the correction a correction.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {string} avoid - The name the row already carries.
 * @returns {Promise<Object>} `{id, comname}`.
 */
async function speciesOtherThan(request, avoid) {
  const present = await once('species', async () => {
    const facets = await facetsFor(request, { reviewStatus: [], trainingDisposition: [] });
    return facets.species || [];
  });

  for (const entry of present) {
    for (const word of String(entry.label || '').toLowerCase().match(/[a-z]{4,}/g) || []) {
      const found = await once(`search:${word}`, async () => {
        const res = await request.get(`/api/v2/species/search?q=${encodeURIComponent(word)}`);
        return res.ok() ? res.json() : [];
      });

      const pick = (found || []).find((s) => s.comname && s.comname !== avoid);
      if (pick) return { id: pick.id != null ? pick.id : pick.species_id, comname: pick.comname };
    }
  }

  throw new Error(
    `Nothing in the MARP taxonomy is named anything other than "${avoid}", so a correction `
    + 'would be refused as `unchanged` and this check would prove nothing. It fails rather '
    + 'than skipping: this is the only tier that can see the thing at all.'
  );
}

/* A named export so the file is not mistaken for a place to add a shared helper:
   everything shared lives in `check-kit.mjs`, which the page imports, or in `support.mjs`,
   which Node does. */
export { };
