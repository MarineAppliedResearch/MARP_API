/**
 * Requirement checks: committing, correcting, counts, and what the record says afterwards.
 *
 * Migrated from `tests/requirements.js` when #157 retired the fixture, alongside
 * `requirements-marking.spec.mjs` and following its shape. Each check still names the
 * requirement from MARP_API#68 that it holds the prototype to, and still drives the same
 * named actions the interface drives.
 *
 * **The body of each check is the original one**, opened with the kit import and with
 * `reset()` replaced by `prepare()` -- the page load Playwright gives every test is the
 * only reset that resets against a real server. Four kinds of change were unavoidable, and
 * each is commented where it happens rather than only here:
 *
 * - **Fixture literals are discovered.** `[41]` (Bat Star), `43` / 'Ochre Star' and the
 *   reviewer id `5` were facts about one local database. The species to correct *to* comes
 *   from the observation's own annotation list, and the reviewer is `state.me.user_id`.
 * - **`MarpData.breakThumbnails` and `MarpData.reload` have no counterpart.** Rows without
 *   imagery are seeded (`seed.mjs`) rather than broken, so the case the check exists for is
 *   always there instead of being hunted for and skipped.
 * - **The record is read again rather than read off the page.** `commitPage` does not write
 *   the row's own status column back in this sitting (#131) and a committed page is served
 *   from the rows the reviewer saw -- `src/data.js` rewrote the column in place, which is
 *   the only reason those assertions could ever be made against `state.rows`. They go
 *   through `findRow` now, which asks the same endpoint the page asks.
 * - **A fixed wait becomes a poll.** A real query is slower than the fixture's simulated
 *   latency, so anything that waited 250-900 ms waits for the observable instead.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import { expectRealBacking, findRow, ready, undecided, whateverItsStatus } from './support.mjs';

let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/**
 * Rows a check created, taken away **after** the ledger has restored.
 *
 * Not a `finally` inside the check, and the ordering is the whole reason. A check that
 * both seeds and commits leaves the journal holding decisions to put back on rows a
 * `finally` would already have destroyed, and `restore()` fails loudly -- correctly --
 * when it cannot read one back. Playwright runs `afterEach` hooks in the order they were
 * registered, so this one, below the ledger's, is the only safe place for it.
 */
const sown = [];

test.afterEach(async () => {
  while (sown.length) await sown.pop().remove();
});

/** Open the application and wait for it to settle, before a check drives the store. */
async function open(page) {
  await page.goto(undecided());
  await expectRealBacking(page);
  await ready(page);
}

/**
 * A species the observation is **not** already on, from its own annotation list.
 *
 * `actions.changeSpecies(id, 43)` and the name 'Ochre Star' were two halves of one fixture
 * literal, and `support.mjs`'s header records what pinning an id out of a local database
 * cost the last time. The terms are derived from the name the row is carrying rather than
 * remembered, so nothing here is a fact about a corpus either; single letters are the
 * fallback, because the search is a substring match and both routes reject only an empty one.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Object} subject - `{list, from}` as the served row carries them.
 * @returns {Promise<Object>} `{id, comname}` of something else on that list.
 */
async function otherSpecies(request, { list, from }) {
  const name = String(from || '');
  const terms = [];
  for (let i = 0; i + 2 <= name.length; i += 1) terms.push(name.slice(i, i + 2));
  terms.push('a', 'e', 'i', 'o', 's', 'r');

  for (const term of terms) {
    const path = list
      ? `/api/v2/species/list/${encodeURIComponent(list)}/search?q=${encodeURIComponent(term)}`
      : `/api/v2/species/search?q=${encodeURIComponent(term)}`;
    const res = await request.get(path);
    expect(res.ok(), `the species search was refused: ${res.status()} ${await res.text()}`)
      .toBeTruthy();
    const hit = (await res.json()).find((entry) => entry.comname && entry.comname !== from);
    if (hit) return { id: hit.id, comname: hit.comname };
  }

  throw new Error(
    `Nothing on the list ${JSON.stringify(list)} is called anything but ${JSON.stringify(from)}, `
    + 'so there is no correction for this check to make. It fails rather than skipping.'
  );
}

/**
 * Put the store on page one and hand back a row that can be corrected.
 *
 * About 4% of observations legitimately carry no species at all, and `currentSpeciesName`
 * falls back to the annotator's frozen label for those -- so a check about what a
 * correction moves has to start from a row that has a current name to move.
 *
 * @param {import('@playwright/test').Page} page - A settled page.
 * @returns {Promise<Object>} `{id, list, from, label}`.
 */
function correctableRow(page) {
  return page.evaluate(async () => {
    const { state, ok, prepare } = await import('./tests/api/check-kit.mjs');
    await prepare();
    const row = state.rows.find((r) => r.species_comname != null);
    ok(row, 'page 1 should hold a row that carries a current species name');
    return {
      id: row.observation_id,
      list: row.species_list,
      /* What the tile is **showing**, which is the current species. */
      from: row.species_comname,
      /* And the annotator's frozen label, kept separately: on the fixture the two were
         the same string, and on a real corpus a renamed list makes them differ (F6). */
      label: row.comname
    };
  });
}

/* ------------------------------------------------------------------ tests */

test('Delete mode: delete commit acts on the MARKED tiles, inverting the review modes',
  async ({ page }) => {
    /* A delete is a real permanent delete and this tier may never destroy a row it did not
       create, so the check seeds its own page and narrows the mosaic to nothing else. */
    const seeded = await seedPage({ count: 4 });
    sown.push(seeded);
    ledger.allowDeletes(seeded.ids);

    await open(page);
    await page.evaluate(async (line) => {
      const { state, ok, prepare, commitRows } = await import('./tests/api/check-kit.mjs');
      await prepare('delete', { line: [line] });
      const marked = state.rows[0].observation_id;
      const untouched = state.rows[1].observation_id;
      const res = await commitRows('delete', state.rows,
        new Map([[marked, { reason: null }]]));
      ok(res.reviewed.some((r) => r.observation_id === marked && r.outcome === 'deleted'),
        'the marked tile should be deleted');
      ok(!res.reviewed.some((r) => r.observation_id === untouched), 'unmarked tiles must be untouched');
    }, seeded.line);
  });

test('What counts as reviewed: an observation without ready imagery is skipped, and does not block the batch',
  async ({ page }) => {
    /**
     * **Broken deliberately, rather than hunted for.**
     *
     * This searched page one for a tile that happened not to be ready, and returned
     * `'skipped'` when it found none -- and **a skipped check looks green**, which this
     * repository has paid for before. `MarpData.breakThumbnails` is what it used instead,
     * and there is no such thing against a real server, so the rows are seeded carrying the
     * thumbnail state they need and the page holds nothing else.
     *
     * **Two seeded lines, because `seedPage` gives every row it makes the same state** and
     * this check is about a mixture: a row with no picture *on a page of rows that have
     * one*, so `reviewed` can be non-empty beside the skip. `line` is a multi-select
     * dimension, so two lines are one page.
     */
    const good = await seedPage({ count: 3, thumbnail: 'ready' });
    sown.push(good);
    const broken = await seedPage({ count: 1, thumbnail: 'failed' });
    sown.push(broken);

    await open(page);
    await page.evaluate(async ({ lines, badId }) => {
      const { state, eq, ok, prepare, commitRows } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: lines });
      const rows = state.rows;
      eq(rows.find((r) => r.observation_id === badId).thumbnail_status, 'failed',
        'the row has to be genuinely without imagery for the rest of this to mean anything');

      const res = await commitRows('scientific', rows);
      ok(res.skipped.some((s) => s.observation_id === badId && s.reason === 'no-imagery'),
        'unavailable imagery must be skipped');
      ok(res.reviewed.length > 0, 'the rest of the page must still complete');
    }, { lines: [good.line, broken.line], badId: broken.ids[0] });
  });

test('Correcting an observation: a species change saves and records the change',
  async ({ page, request }) => {
    await open(page);
    const subject = await correctableRow(page);
    const chosen = await otherSpecies(request, subject);

    await page.evaluate(async ({ subject: was, chosen: to }) => {
      const { state, actions, eq, ok } = await import('./tests/api/check-kit.mjs');
      actions.toggleMark(was.id);
      await actions.changeSpecies(was.id, to.id);
      const row = state.rows.find((r) => r.observation_id === was.id);
      eq(row.species_comname, to.comname, 'the row should carry the new species');
      /* `comname` is the annotator's frozen label and a correction never rewrites it --
         confusing the two is F6, and it made the "was X" indicator report the new name as
         the old one. It is asserted against the label the row arrived with rather than
         against the current name, which only the fixture made the same string. */
      eq(row.comname, was.label, 'and the annotator label is untouched');
      ok(state.changed.has(was.id), 'the change should be recorded locally');
      eq(state.changed.get(was.id).from, was.from);
      eq(state.changed.get(was.id).to, to.comname,
        'from and to must differ; reading comname made them the same name');
    }, { subject, chosen });
  });

test('Annotation autosave versus review resolution: saving a correction does NOT clear the mark',
  async ({ page, request }) => {
    await open(page);
    const subject = await correctableRow(page);
    const chosen = await otherSpecies(request, subject);

    await page.evaluate(async ({ id, speciesId }) => {
      const { state, actions, ok } = await import('./tests/api/check-kit.mjs');
      actions.toggleMark(id);
      await actions.changeSpecies(id, speciesId);
      ok(state.marks.has(id), 'the flag must survive the correction');
      actions.resolve(id);
      ok(!state.marks.has(id), 'resolving is what clears it');
    }, { id: subject.id, speciesId: chosen.id });
  });

test('The review modes: switching mode clears local marks and returns to page 1',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare, wait } = await import('./tests/api/check-kit.mjs');
      await prepare();
      /* The fixture answered from memory in a fixed 250 ms; a real query does not, so each
         step waits for the thing it is waiting for rather than for a number. */
      const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };
      actions.goToPage(3);
      await wait(100);
      await settled(() => state.page === 3 && !state.loading);
      actions.toggleMark(state.rows[0].observation_id);
      actions.setMode('training');
      await wait(300);
      await settled(() => state.page === 1 && !state.loading);
      eq(state.marks.size, 0, 'marks must not carry across modes');
      eq(state.page, 1, 'mode change should return to page 1');
    });
  });

test('What counts as reviewed: an observation with no image is still markable, and keeps its species name',
  async ({ page }) => {
    /* The mosaic has no thumbnail-status filter -- the status is a field on the row rather
       than a dimension -- so a page without pictures cannot be asked for, and the original
       hunted for one and returned `'skipped'` when it found none. It seeds two of its own
       instead, and fails rather than skipping if they are not there. */
    const seeded = await seedPage({ count: 2, thumbnail: 'failed' });
    sown.push(seeded);

    await open(page);
    await page.evaluate(async (line) => {
      const { state, actions, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('scientific', { line: [line] });
      const bad = state.rows.find((r) => r.thumbnail_status !== 'ready');
      ok(bad, 'the page should hold a row whose picture never arrived');
      ok(bad.comname && bad.comname.length, 'it must still carry its name');
      actions.toggleMark(bad.observation_id);
      ok(state.marks.has(bad.observation_id), 'it must be markable');
    }, seeded.line);
  });

test('Moving through pages: a committed decision can be taken back by marking it and committing again',
  async ({ page, request }) => {
    await open(page);

    const target = await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare();
      /* pick a row the commit can actually act on: ready imagery, not already reviewed */
      /* Not merely "not reviewed": a row the record already flags arrives marked, and
         committing keeps it flagged. This check is about a row the commit accepts. */
      const found = state.rows.find((r) => r.thumbnail_status === 'ready'
        && r.review_decision == null && !state.marks.has(r.observation_id));
      ok(found, 'page 1 should contain an unreviewed, unmarked row');
      const id = found.observation_id;
      await actions.commitPage();
      eq(state.outcomes.get(id), 'reviewed', 'first commit accepts it');
      /* The reviewer, from the signed-in principal (R19). `5` was one local database's. */
      return { id, line: found.line, me: state.me.user_id };
    });

    /**
     * **A click on a committed acceptance takes it back; it does not flag it** (#135 R8).
     *
     * This check used to go straight from `reviewed` to `flagged` in one click and one
     * commit, which is exactly the defect he reported: *"something that shows as reviewed
     * and I click it, it just switches to flagged... it should go taking back."* So the
     * sequence is a step longer now, and the extra step is the point.
     */
    await page.evaluate(async (id) => {
      const { actions } = await import('./tests/api/check-kit.mjs');
      actions.toggleMark(id);
      await actions.commitPage();
    }, target.id);

    /* The record, asked for again. `commitPage` does not write the row's own status column
       back in this sitting (#131) and a committed page is served from the rows the reviewer
       saw, so `state.rows` still says what it said when the page was fetched -- this
       assertion only ever worked because `src/data.js` rewrote the column in place. */
    let row = await findRow(request, whateverItsStatus({ line: [target.line] }), target.id);
    expect(row, `observation ${target.id} could not be read back under its own line`).toBeTruthy();
    expect(row.review_decision, 'committing the take-back clears the decision').toBe(null);

    /* And *now* an ordinary click flags it, because the record carries nothing to be
       about. Two clicks and two commits, never one -- taking back is its own decision. */
    await page.evaluate(async (id) => {
      const { actions } = await import('./tests/api/check-kit.mjs');
      actions.toggleMark(id);
      await actions.commitPage();
    }, target.id);

    row = await findRow(request, whateverItsStatus({ line: [target.line] }), target.id);
    expect(row, `observation ${target.id} could not be read back under its own line`).toBeTruthy();
    expect(row.review_decision, 'and the observation can then be flagged').toBe('flagged');
    /* A reviewer **id**, and it is now the flagger's rather than null (A13, F8). The
       old assertion read `reviewed_by`, a column the endpoint's row has never carried, so
       it was asserting `undefined === null` and passing for the wrong reason. */
    expect(row.review_reviewer_id, 'the flag is attributed to whoever raised it').toBe(target.me);
  });

test('The review modes: training review offers reasons, correction and resolution like scientific review',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('training');
      const id = state.rows[0].observation_id;
      actions.toggleMark(id);
      actions.openPicker(id);
      ok(state.picker && state.picker.id === id, 'the panel opens in training mode too');
      actions.setReason(id, 'Occluded');
      eq(state.marks.get(id).reason, 'Occluded', 'a training exclusion carries its reason');
      actions.resolve(id);
      ok(!state.marks.has(id), 'resolving clears it, as in scientific review');
    });
  });

test('Moving through pages: a committed decision survives navigating away and back',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare, wait } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_decision !== 'reviewed');
      ok(target, 'page 1 should contain a reviewable row');
      const id = target.observation_id;
      await actions.commitPage();
      eq(state.outcomes.get(id), 'reviewed');
      /* Polled rather than the fixture's 300 ms: a page change against a real server is a
         round trip whenever the cache cannot answer it. */
      const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };
      actions.goToPage(2);
      await wait(100);
      await settled(() => state.page === 2 && !state.loading);
      actions.goToPage(1);
      await wait(100);
      await settled(() => state.page === 1 && !state.loading);
      eq(state.outcomes.get(id), 'reviewed',
        'the session record of what was committed must not be cleared by a re-query');
      ok(state.committedPages.has(1), 'the pager must still show the page as committed');
    });
  });

test('Filter and sort dimensions: the status counts reflect the data and move when work is committed',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, ok, prepare, wait } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const before = state.counts.unreviewed;
      ok(before > 0, 'there should be unreviewed work to start with');
      await actions.commitPage();
      /* `commitPage` asks for the counts itself before it notifies, so this waits for the
         observable rather than for the fixture's 300 ms of simulated latency. */
      for (let n = 0; n < 150 && !(state.counts.unreviewed < before); n += 1) await wait(100);
      ok(state.counts.unreviewed < before,
        `committing should reduce the unreviewed count (was ${before}, now ${state.counts.unreviewed})`);
      ok(state.counts.reviewed > 0, 'and increase the reviewed count');
    });
  });

/**
 * The two counts defects settled in #99, both found by reading and neither previously
 * tested. This is the tier that can see them: nothing is drawn differently at the moment
 * either happens, which is exactly why they survived.
 *
 * - `state.counts` was assigned **before** the token check, so a superseded response
 *   wrote into state and only then bailed. Nothing redrew at that instant; the next
 *   `notify()` drew it.
 * - `counts()` ran on **every** refresh, which against a real API is a second full pass
 *   over the matching set on every page turn.
 *
 * A slow first query is superseded by a fast second. Both ask a different question, so
 * neither can be answered from the page cache and both really go to the data layer.
 *
 * **`MarpBackend` is the seam now**, and wrapping a method on it works exactly as wrapping
 * one on the fixture did: it is a plain object whose methods delegate, and `store.js` looks
 * the property up at every call.
 */
test('Filter and sort dimensions: a superseded query writes no counts into state',
  async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { state, actions, eq, prepare, wait, MarpBackend } = await import('./tests/api/check-kit.mjs');
      await prepare();
      const realQuery = MarpBackend.query.bind(MarpBackend);
      const realCounts = MarpBackend.counts.bind(MarpBackend);
      let asked = 0;

      try {
        let holdFirst = true;
        MarpBackend.query = async (args) => {
          /* Four seconds rather than the fixture's 900 ms. A real query can take longer
             than the whole of the original timing, so the hold has to outlast one. */
          const hold = holdFirst ? 4000 : 0;
          holdFirst = false;
          const res = await realQuery(args);
          await wait(hold);
          return res;
        };
        /* Tag each answer with which call produced it, so "whose counts landed" is
           readable rather than inferred. */
        MarpBackend.counts = async (args) => ({ ...(await realCounts(args)), total: ++asked });

        /* Two different questions, so the cache is emptied by each and cannot answer. */
        actions.setSort('confidence', 'desc');          // slow, and about to be superseded
        await wait(60);
        actions.setSort('confidence', 'asc');           // fast: this is the newest request
        /* Polled rather than the fixture's 500 ms: the newest request is a real round trip. */
        for (let n = 0; n < 150 && state.counts.total !== 1; n += 1) await wait(100);

        const landed = state.counts.total;
        eq(landed, 1, 'the newest request is the only one that should have asked');

        /* Now let the superseded one land -- it is held for four seconds. */
        await wait(6000);
        eq(state.counts.total, landed,
          'a superseded response must write nothing into state after its token is spent');
        eq(asked, 1, 'and must not ask for a count at all — one refresh, one count');
      } finally {
        MarpBackend.query = realQuery;
        MarpBackend.counts = realCounts;
      }
    });
  });

test('Training data review: promoting a page records the promotion on the observations themselves',
  async ({ page, request }) => {
    await open(page);
    const target = await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare } = await import('./tests/api/check-kit.mjs');
      await prepare('training');
      state.filters.trainingDisposition = ['undecided'];
      await actions.refresh();
      const found = state.rows.find((r) => r.thumbnail_status === 'ready');
      ok(found, 'page 1 should contain a promotable track');
      const id = found.observation_id;
      await actions.commitPage();
      eq(state.outcomes.get(id), 'promoted', 'the tile should report the promotion');
      return { id, line: found.line, me: state.me.user_id };
    });

    /* The record itself, asked for again rather than read off the page: the endpoint does
       not write the row's own status column back after a commit in this sitting (#131),
       and `src/data.js` did -- which is the only reason this ever read from `state.rows`. */
    const row = await findRow(request, whateverItsStatus({ line: [target.line] }), target.id);
    expect(row, `observation ${target.id} could not be read back under its own line`).toBeTruthy();
    expect(row.training_decision, 'the record itself must carry it').toBe('promoted');
    /* A reviewer **id**, matched against the signed-in principal (A13). This read
       `training_approved_by === 'I. Travers'` -- a column the endpoint's row has never
       carried, compared against a literal name one developer's client held (F8). */
    expect(row.training_reviewer_id, 'and who approved it, as an id').toBe(target.me);
  });

test('Training data review: promotions are still visible after navigating away and back',
  async ({ page, request }) => {
    await open(page);
    const target = await page.evaluate(async () => {
      const { state, actions, eq, ok, prepare, wait } = await import('./tests/api/check-kit.mjs');
      await prepare('training');
      state.filters.trainingDisposition = ['undecided'];
      await actions.refresh();
      const found = state.rows.find((r) => r.thumbnail_status === 'ready');
      ok(found, 'page 1 should contain a promotable track');
      const id = found.observation_id;
      await actions.commitPage();
      /* Polled rather than the fixture's 300 ms, for the same reason as every other page
         change here: against a real server it is a round trip. */
      const settled = async (fn) => { for (let n = 0; n < 150 && !fn(); n += 1) await wait(100); };
      actions.goToPage(2);
      await wait(100);
      await settled(() => state.page === 2 && !state.loading);
      actions.goToPage(1);
      await wait(100);
      await settled(() => state.page === 1 && !state.loading);
      eq(state.outcomes.get(id), 'promoted', 'the session record must survive the re-query');
      return { id, line: found.line };
    });

    /* and the record is findable again by filtering on the disposition */
    /* Asked of the server rather than of the store. Page 1 is pinned to the rows that were
       committed, so re-filtering the store would have served those same rows straight back
       -- carrying the `training_decision` they were *served* with, which the endpoint never
       rewrites in a sitting (#131). And the `if (seen)` this replaces made the assertion
       vacuous whenever the row was not found, which is a skip wearing a pass. */
    const seen = await findRow(
      request,
      { ...whateverItsStatus({ line: [target.line] }), trainingDisposition: ['promoted'] },
      target.id
    );
    expect(seen, 'the promotion should be findable by filtering on the disposition').toBeTruthy();
    expect(seen.training_decision).toBe('promoted');
  });

/* A named export so the file is not mistaken for a place to add a helper: everything
   shared lives in `check-kit.mjs`, which the page imports, or in `support.mjs`, which
   Node does. `otherSpecies` and `correctableRow` are local because the two checks that
   need them are both here, and `support.mjs` is being edited by other work. */
export { };
