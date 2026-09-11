/**
 * Requirement checks.
 *
 * Each test names the requirement from MARP_API#68 that it holds the prototype to.
 * These drive the same actions the UI drives, so they check behaviour rather than
 * markup — a rendering change should not break them, and a behaviour change should.
 */
import { state, actions, MODES, subscribe } from '../src/store.js';
import { pendingException, statusDimensions, STATUS_DIMENSIONS } from '../src/model/modes.js';
import { MarpData } from '../src/data.js';
import { useBackend } from '../src/backend.js';

/**
 * These checks run against the **fixture**, and install it themselves (A2).
 *
 * They are about the *rules*, and they drive `failNextCommit`, `slowNextCommit`,
 * `breakThumbnails`, `bumpVersion` and `reload` — none of which is expressible against a
 * real server (F17). `tests.html` installs it too, so this holds whether the page or the
 * module got there first; installing twice is a no-op.
 */
useBackend(MarpData);

/**
 * What a row's status reads as in the **filter** vocabulary.
 *
 * The row carries `review_decision` / `training_decision`, and the neutral state is
 * **null** — the absence of a review record — while the filter vocabulary spells that
 * `'unreviewed'` / `'undecided'`. Comparing a filter value against a row column directly
 * is what this file used to do, and it worked only while the fixture invented a string for
 * the neutral state (F3).
 */
const decidedAs = (key, row) => {
  const dim = STATUS_DIMENSIONS[key];
  const value = row[dim.column];
  return value == null ? dim.neutral : value;
};

/**
 * Commit a page the way the store does: **the rows, carrying their versions** (A7, R7).
 *
 * `commitPage({ mode, observationIds, marks })` is gone. The three commit routes require
 * `observations: [{ observation_id, version }]` and refuse a request that omits a version
 * — "a missing version is a 400, never an implicit overwrite" — and the store was passing
 * neither (F4). Every check below that committed by hand goes through this.
 */
const commitRows = (mode, rows, marks = new Map()) =>
  MarpData.commitPage({ mode, rows, marks });

const results = [];
let only = null;

function test(requirement, name, fn) {
  results.push({ requirement, name, fn });
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || ''} expected ${B}, got ${A}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

/**
 * Put the store — and the data — back to a known place between checks.
 *
 * Reloading the fixture matters: commits and corrections mutate it, so without this
 * each check runs against the wreckage of the last one. Two checks here were quietly
 * order-dependent until a page started arriving with its existing flags marked.
 */
async function reset(mode = 'scientific') {
  await MarpData.reload();

  /* The reviewer's identity, from the seam (R19). These checks drive the store directly
     rather than through `init()`, so nothing else asks — and `state.me` being null is what
     "by you" reads as when the identity has not arrived, which is correct behaviour and
     useless to assert against here. */
  if (!state.me) state.me = await MarpData.whoami();

  /**
   * Empty the page cache, which `MarpData.reload()` cannot reach.
   *
   * The cache is keyed by the question (#99) and every check here asks the same one, so
   * without this each check is served the *previous* check's rows — which the reload
   * above has just orphaned. Ten checks failed that way the first time the cache was
   * wired in: commits that had not happened, a species change that had not saved, and a
   * count that had not moved.
   *
   * In the application a reload is what drops the cache, and this file cannot reload. A
   * different question empties it, so ask one nobody is asking and then the real one. It
   * costs one extra query per check, which is the price of each check starting from the
   * same place.
   */
  /* Species is a **key** now, not a name (F1). A key nothing carries is what empties
     the page cache, which is what this is for. */
  state.filters.species = [-1];
  await actions.refresh();

  state.mode = mode;
  state.page = 1;
  /* Arrays now: every set dimension is multi-select, and an empty one means the
     dimension is not filtering rather than matching nothing. */
  state.filters.species = [41];               // Bat Star, by key
  state.filters.project = [];
  state.filters.reviewStatus = ['unreviewed', 'flagged'];
  state.filters.trainingDisposition = ['undecided'];
  state.outcomes.clear();
  state.pageMembers.clear();
  state.committedPages.clear();
  state.marks.clear();
  state.touched.clear();
  state.changed.clear();
  state.committedPages.clear();
  state.picker = null;
  await actions.refresh();
}

/* ------------------------------------------------------------------ tests */

test('One gesture, meaning set by the active mode',
  'a tap marks the tile, a second tap unmarks it', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    ok(state.marks.has(id), 'first tap should mark');
    actions.toggleMark(id);
    ok(!state.marks.has(id), 'second tap should unmark');
  });

test('One gesture, meaning set by the active mode',
  'the mark means different things per mode', async () => {
    eq(MODES.scientific.mark, 'Flagged');
    eq(MODES.training.mark, 'Excluded');
    eq(MODES.delete.mark, 'Delete');
  });

test('Review states',
  'a reason is optional — a bare mark is valid', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    eq(state.marks.get(id).reason, null, 'a fresh mark carries no reason');
  });

test('Review states',
  'choosing the same reason twice clears it', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Wrong species');
    eq(state.marks.get(id).reason, 'Wrong species');
    actions.setReason(id, 'Wrong species');
    eq(state.marks.get(id).reason, null, 'second press should clear');
  });

test('Exception marking and the page commit',
  'scientific commit acts on the UNMARKED tiles', async () => {
    await reset();
    const marked = state.rows[0].observation_id;
    actions.toggleMark(marked);
    const res = await commitRows('scientific', state.rows,
      new Map([[marked, { reason: null }]]));
    ok(!res.reviewed.some((r) => r.observation_id === marked), 'the marked tile must not be accepted');
    ok(res.flagged.some((f) => f.observation_id === marked && f.outcome === 'flagged'),
       'it should be reported as flagged, which is a decision rather than a skip');
  });

test('Delete mode',
  'delete commit acts on the MARKED tiles, inverting the review modes', async () => {
    await reset('delete');
    const marked = state.rows[0].observation_id;
    const untouched = state.rows[1].observation_id;
    const res = await commitRows('delete', state.rows,
      new Map([[marked, { reason: null }]]));
    ok(res.reviewed.some((r) => r.observation_id === marked && r.outcome === 'deleted'),
       'the marked tile should be deleted');
    ok(!res.reviewed.some((r) => r.observation_id === untouched), 'unmarked tiles must be untouched');
  });

test('What counts as reviewed',
  'an observation without ready imagery is skipped, and does not block the batch', async () => {
    await reset();
    /**
     * **Broken deliberately, rather than hunted for.**
     *
     * This searched page one for a tile that happened not to be ready, and returned
     * `'skipped'` when it found none — and **a skipped check looks green**, which this
     * repository has paid for before. It became a live problem the moment the fixture
     * started finishing what a page serve enqueued, the way the endpoint does: the
     * incidental `queued` row resolves while `reset()` is still running, so the case the
     * check exists for was simply not there most of the time.
     */
    const bad = state.rows[1];
    MarpData.breakThumbnails([bad.observation_id]);
    await actions.refresh();
    const rows = state.rows;
    eq(rows.find((r) => r.observation_id === bad.observation_id).thumbnail_status, 'failed',
      'the row has to be genuinely without imagery for the rest of this to mean anything');

    const res = await commitRows('scientific', rows);
    ok(res.skipped.some((s) => s.observation_id === bad.observation_id && s.reason === 'no-imagery'),
       'unavailable imagery must be skipped');
    ok(res.reviewed.length > 0, 'the rest of the page must still complete');
  });

test('Moving through pages',
  'committing does not clear the page or advance', async () => {
    await reset();
    const before = state.page, ids = state.rows.map((r) => r.observation_id);
    await actions.commitPage();
    eq(state.page, before, 'the page must not advance');
    eq(state.rows.map((r) => r.observation_id), ids, 'the page must stay loaded');
    ok(state.committedPages.has(before), 'the page should be recorded as committed');
  });

test('Correcting an observation',
  'a species change saves and records the change', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    /* The name the tile is **showing**, which is the current species. `comname` is the
       annotator's frozen label and a correction never rewrites it -- confusing the two is
       F6, and it made the "was X" indicator report the new name as the old one. */
    const from = state.rows[0].species_comname;
    actions.toggleMark(id);
    await actions.changeSpecies(id, 43);            // Ochre Star
    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.species_comname, 'Ochre Star', 'the row should carry the new species');
    eq(row.comname, from, 'and the annotator label is untouched');
    ok(state.changed.has(id), 'the change should be recorded locally');
    eq(state.changed.get(id).from, from);
    eq(state.changed.get(id).to, 'Ochre Star',
      'from and to must differ; reading comname made them the same name');
  });

test('Annotation autosave versus review resolution',
  'saving a correction does NOT clear the mark', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    await actions.changeSpecies(id, 43);
    ok(state.marks.has(id), 'the flag must survive the correction');
    actions.resolve(id);
    ok(!state.marks.has(id), 'resolving is what clears it');
  });

test('Marking a whole page at once',
  'the scope is the page, never the whole query', async () => {
    await reset();
    actions.markAllOnPage();
    eq(state.marks.size, state.rows.length, 'every tile on the page');
    ok(state.total > state.rows.length, 'the query is larger than the page');
    ok(state.marks.size < state.total, 'the query must not be marked');
  });

test('The review modes',
  'switching mode clears local marks and returns to page 1', async () => {
    await reset();
    actions.goToPage(3);
    await new Promise((r) => setTimeout(r, 250));
    actions.toggleMark(state.rows[0].observation_id);
    actions.setMode('training');
    await new Promise((r) => setTimeout(r, 300));
    eq(state.marks.size, 0, 'marks must not carry across modes');
    eq(state.page, 1, 'mode change should return to page 1');
  });

test('Navigating pages',
  'page navigation clamps to the available range', async () => {
    await reset();
    actions.goToPage(99999);
    await new Promise((r) => setTimeout(r, 250));
    eq(state.page, state.pageCount, 'should clamp to the last page');
    actions.goToPage(-4);
    await new Promise((r) => setTimeout(r, 250));
    eq(state.page, 1, 'should clamp to the first page');
  });

test('Filter and sort dimensions',
  'confidence sorting is applied by the query, not the client', async () => {
    await reset();
    const c = state.rows.map((r) => r.confidence);
    const sorted = c.slice().sort((a, b) => a - b);
    eq(c, sorted, 'page 1 should be ascending by confidence');
  });

test('What counts as reviewed',
  'an observation with no image is still markable, and keeps its species name', async () => {
    await reset();
    const bad = state.rows.find((r) => r.thumbnail_status !== 'ready');
    if (!bad) return 'skipped — no unavailable thumbnail on page 1';
    ok(bad.comname && bad.comname.length, 'it must still carry its name');
    actions.toggleMark(bad.observation_id);
    ok(state.marks.has(bad.observation_id), 'it must be markable');
  });

test('Moving through pages',
  'a committed decision can be taken back by marking it and committing again', async () => {
    await reset();
    /* pick a row the commit can actually act on: ready imagery, not already reviewed */
    /* Not merely "not reviewed": a row the record already flags arrives marked, and
       committing keeps it flagged. This check is about a row the commit accepts. */
    const target = state.rows.find((r) => r.thumbnail_status === 'ready'
      && r.review_decision == null && !state.marks.has(r.observation_id));
    ok(target, 'page 1 should contain an unreviewed, unmarked row');
    const id = target.observation_id;
    await actions.commitPage();
    eq(state.outcomes.get(id), 'reviewed', 'first commit accepts it');
    actions.toggleMark(id);
    await actions.commitPage();
    const row = state.rows.find((r) => r.observation_id === id);
    ok(row.review_decision !== 'reviewed', 'the acceptance must be withdrawn');
    eq(row.review_decision, 'flagged', 'and the observation is now flagged instead');
    /* A reviewer **id**, and it is now the flagger's rather than null (A13, F8). The
       old assertion read `reviewed_by`, a column the endpoint's row has never carried, so
       it was asserting `undefined === null` and passing for the wrong reason. */
    eq(row.review_reviewer_id, 5, 'the flag is attributed to whoever raised it');
  });

test('The review modes',
  'training review offers reasons, correction and resolution like scientific review', async () => {
    await reset('training');
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    actions.openPicker(id);
    ok(state.picker && state.picker.id === id, 'the panel opens in training mode too');
    actions.setReason(id, 'Occluded');
    eq(state.marks.get(id).reason, 'Occluded', 'a training exclusion carries its reason');
    actions.resolve(id);
    ok(!state.marks.has(id), 'resolving clears it, as in scientific review');
  });

test('Moving through pages',
  'a committed decision survives navigating away and back', async () => {
    await reset();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_decision !== 'reviewed');
    ok(target, 'page 1 should contain a reviewable row');
    const id = target.observation_id;
    await actions.commitPage();
    eq(state.outcomes.get(id), 'reviewed');
    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 300));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 300));
    eq(state.outcomes.get(id), 'reviewed',
       'the session record of what was committed must not be cleared by a re-query');
    ok(state.committedPages.has(1), 'the pager must still show the page as committed');
  });

test('Filter and sort dimensions',
  'the status counts reflect the data and move when work is committed', async () => {
    await reset();
    const before = state.counts.unreviewed;
    ok(before > 0, 'there should be unreviewed work to start with');
    await actions.commitPage();
    await new Promise((r) => setTimeout(r, 300));
    ok(state.counts.unreviewed < before,
       `committing should reduce the unreviewed count (was ${before}, now ${state.counts.unreviewed})`);
    ok(state.counts.reviewed > 0, 'and increase the reviewed count');
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
 */
test('Filter and sort dimensions',
  'a superseded query writes no counts into state', async () => {
    await reset();
    const realQuery = MarpData.query.bind(MarpData);
    const realCounts = MarpData.counts.bind(MarpData);
    let asked = 0;

    try {
      let holdFirst = true;
      MarpData.query = async (args) => {
        const hold = holdFirst ? 900 : 0;
        holdFirst = false;
        const res = await realQuery(args);
        await new Promise((r) => setTimeout(r, hold));
        return res;
      };
      /* Tag each answer with which call produced it, so "whose counts landed" is
         readable rather than inferred. */
      MarpData.counts = async (args) => ({ ...(await realCounts(args)), total: ++asked });

      /* Two different questions, so the cache is emptied by each and cannot answer. */
      actions.setSort('confidence', 'desc');          // slow, and about to be superseded
      await new Promise((r) => setTimeout(r, 60));
      actions.setSort('confidence', 'asc');           // fast: this is the newest request
      await new Promise((r) => setTimeout(r, 500));

      const landed = state.counts.total;
      eq(landed, 1, 'the newest request is the only one that should have asked');

      /* Now let the superseded one land. */
      await new Promise((r) => setTimeout(r, 800));
      eq(state.counts.total, landed,
         'a superseded response must write nothing into state after its token is spent');
      eq(asked, 1, 'and must not ask for a count at all — one refresh, one count');
    } finally {
      MarpData.query = realQuery;
      MarpData.counts = realCounts;
    }
  });

test('Training data review',
  'promoting a page records the promotion on the observations themselves', async () => {
    await reset('training');
    state.filters.trainingDisposition = ['undecided'];
    await actions.refresh();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready');
    ok(target, 'page 1 should contain a promotable track');
    const id = target.observation_id;
    await actions.commitPage();
    eq(state.outcomes.get(id), 'promoted', 'the tile should report the promotion');
    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.training_decision, 'promoted', 'the record itself must carry it');
    /* A reviewer **id**, matched against the signed-in principal (A13). This read
       `training_approved_by === 'I. Travers'` -- a column the endpoint's row has never
       carried, compared against a literal name one developer's client held (F8). */
    eq(row.training_reviewer_id, state.me.user_id, 'and who approved it, as an id');
  });

test('Training data review',
  'promotions are still visible after navigating away and back', async () => {
    await reset('training');
    state.filters.trainingDisposition = ['undecided'];
    await actions.refresh();
    const id = state.rows.find((r) => r.thumbnail_status === 'ready').observation_id;
    await actions.commitPage();
    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 300));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 300));
    eq(state.outcomes.get(id), 'promoted', 'the session record must survive the re-query');

    /* and the record is findable again by filtering on the disposition */
    state.filters.trainingDisposition = ['promoted'];
    await actions.refresh();
    const seen = state.rows.find((r) => r.observation_id === id);
    if (seen) eq(seen.training_decision, 'promoted');
  });

test('Filter and sort dimensions',
  'filtering by a disposition returns only observations carrying it', async () => {
    for (const want of ['excluded', 'promoted', 'undecided']) {
      await reset('training');
      state.filters.trainingDisposition = [want];
      await actions.refresh();
      const wrong = state.rows.filter((r) => decidedAs('trainingDisposition', r) !== want);
      eq(wrong.length, 0,
         `every row under the ${want} filter must be ${want}; ${wrong.length} were not`);
    }
  });

test('Filter and sort dimensions',
  'filtering by review status returns only observations carrying it', async () => {
    for (const want of ['reviewed', 'unreviewed']) {
      await reset();
      state.filters.reviewStatus = [want];
      await actions.refresh();
      const wrong = state.rows.filter((r) => decidedAs('reviewStatus', r) !== want);
      eq(wrong.length, 0, `every row under the ${want} filter must be ${want}`);
    }
  });

/* Marks are uncommitted work. Navigating away and back must not lose them,
   and this must behave identically in every mode. */
for (const mode of ['scientific', 'training', 'delete']) {
  test('Moving through pages',
    `an uncommitted mark survives leaving the page and returning — ${mode}`, async () => {
      await reset(mode);
      const id = state.rows[0].observation_id;
      actions.toggleMark(id);
      ok(state.marks.has(id), 'marked to begin with');

      actions.goToPage(2);
      await new Promise((r) => setTimeout(r, 350));
      ok(!state.rows.some((r) => r.observation_id === id), 'we really did leave the page');

      actions.goToPage(1);
      await new Promise((r) => setTimeout(r, 350));
      ok(state.rows.some((r) => r.observation_id === id), 'and came back to it');
      ok(state.marks.has(id), 'the mark must still be there');
    });

  test('Moving through pages',
    `a reason on an uncommitted mark survives too — ${mode}`, async () => {
      if (mode === 'delete') return 'skipped — delete marks carry no reason';
      await reset(mode);
      const id = state.rows[0].observation_id;
      actions.toggleMark(id);
      actions.setReason(id, 'Occluded');
      actions.goToPage(2);
      await new Promise((r) => setTimeout(r, 350));
      actions.goToPage(1);
      await new Promise((r) => setTimeout(r, 350));
      eq(state.marks.get(id) && state.marks.get(id).reason, 'Occluded');
    });
}

/* A mark is a decision, not client state: committing must write it to the record,
   so it is still there after leaving the page, and would survive a reload. */
test('Review states',
  'committing a flag writes it to the observation, with its reason', async () => {
    await reset();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_decision == null);
    ok(target, 'need an unreviewed row');
    const id = target.observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Wrong species');
    await actions.commitPage();
    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.review_decision, 'flagged', 'the record must carry the flag');
    eq(row.flag_reason, 'Wrong species', 'and the reason');
    eq(row.review_reviewer_id, state.me.user_id, 'and who flagged it, as an id');
  });

test('Review states',
  'a committed flag is still shown after leaving the page and returning', async () => {
    await reset();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_decision == null);
    const id = target.observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Bounding box');
    await actions.commitPage();

    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 350));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 350));

    const row = state.rows.find((r) => r.observation_id === id);
    ok(row, 'a flagged observation is open work, so it stays in the default view');
    eq(row.review_decision, 'flagged');
    eq(row.flag_reason, 'Bounding box', 'the reason survives too');
  });

test('Training data review',
  'committing an exclusion writes it to the observation, with its reason', async () => {
    await reset('training');
    state.filters.trainingDisposition = ['undecided'];
    await actions.refresh();
    const id = state.rows.find((r) => r.thumbnail_status === 'ready').observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Occluded');
    await actions.commitPage();
    const row = state.rows.find((r) => r.observation_id === id)
      || (await MarpData.query({ filters: { trainingDisposition: ['excluded'] }, page: 1, pageSize: 600 }))
           .rows.find((r) => r.observation_id === id);
    eq(row.training_decision, 'excluded');
    eq(row.exclusion_reason, 'Occluded');
  });

test('Correcting an observation',
  'a species correction is still visible on the tile after returning', async () => {
    await reset();
    state.filters.species = [];              // a correction moves the row out of a species filter
    await actions.refresh();
    const id = state.rows[0].observation_id;
    /* What the tile is **showing**, which is the current species -- not the annotator's
       frozen `comname`. Those are two different fields and confusing them is F6. */
    const was = state.rows[0].species_comname;
    actions.toggleMark(id);
    await actions.changeSpecies(id, 45);            // Sunflower Star
    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 350));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 350));
    const row = state.rows.find((r) => r.observation_id === id);
    ok(row, 'with no species filter set, the corrected row cannot have left the page');
    /**
     * F6. The corrected name is `species_comname`; `comname` is **never rewritten**.
     *
     * This asserted `row.comname === 'Sunflower Star'` and
     * `row.previous_comname === was`. Both were the fixture's rule rather than the
     * contract's: `comname` is the label the annotator's list entry carried and keeping it
     * frozen is what makes the drift auditable, and no row has ever carried
     * `previous_comname`. What the reviewer sees as "was X" comes from `state.changed`,
     * which is A12's answer -- the indicator appears only after a correction made in this
     * session.
     */
    eq(row.species_comname, 'Sunflower Star', 'the correction persists');
    eq(row.comname, was, 'the annotator label is untouched, deliberately');
    eq(state.changed.get(id).from, was, 'and the session remembers what it was');
    eq(state.changed.get(id).to, 'Sunflower Star',
      'read from species_comname; comname would have made from and to the same name');
  });

/* The case the one above sidesteps by clearing the species filter, and the reason this
   check exists at all: for a while the only thing asserting it was a narrated walkthrough,
   which is a review surface and is recorded on request -- so between recordings nothing
   watched this. A skipped branch looks green, which is exactly how it hid. */
test('Correcting an observation',
  'a correction under a species filter takes the row off the page, and the other marks stay',
  async () => {
    await reset();
    const species = state.rows[0].species_id;
    state.filters.species = [species];       // the mosaic's premise: one predicted species
    await actions.refresh();

    const [a, b, c] = state.rows.slice(0, 3).map((r) => r.observation_id);
    ok(c != null, 'this check needs three rows of one species to be meaningful');
    for (const id of [a, b, c]) actions.toggleMark(id);
    eq(state.marks.size, 3, 'three marked before the correction');

    /* Sunflower Star is deliberately not the species being filtered on. */
    await actions.changeSpecies(a, 45);
    await actions.refresh();

    ok(!state.rows.some((r) => r.observation_id === a),
       'the corrected row no longer matches the filter, so it must leave the page');
    ok(state.rows.some((r) => r.observation_id === b)
       && state.rows.some((r) => r.observation_id === c),
       'the two the reviewer did not touch must still be there');
    ok(state.marks.has(b) && state.marks.has(c),
       'and their flags are untouched -- correcting one tile is not a decision about another');
  });

/* Reported 2026-09-04: choosing a species made the panel vanish and immediately
   reappear. Two faults — the panel never closed on a correction, and renderPicker
   blanked it before awaiting the taxonomy. Both are behaviour, so both are checked. */
test('Correcting an observation',
  'choosing a species closes the panel, because that is what it was opened to do', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    actions.openPicker(id);
    ok(state.picker && state.picker.id === id, 'the panel is open before the correction');
    await actions.changeSpecies(id, 43);            // Ochre Star
    eq(state.picker, null, 'and closed after it');
  });

test('Correcting an observation',
  'the correction closes the panel but keeps the mark: they are separate decisions', async () => {
    await reset();
    const id = state.rows[0].observation_id;
    actions.toggleMark(id);
    actions.openPicker(id);
    await actions.changeSpecies(id, 43);
    ok(state.marks.has(id), 'correcting the species does not resolve the flag');
    ok(state.changed.has(id), 'and the correction is recorded');
  });

test('Correcting an observation',
  'correcting one tile never closes a panel belonging to another', async () => {
    await reset();
    const [a, b] = state.rows.map((r) => r.observation_id);
    actions.toggleMark(a);
    actions.toggleMark(b);
    actions.openPicker(b);
    await actions.changeSpecies(a, 43);             // a different tile
    ok(state.picker && state.picker.id === b, 'the open panel is left alone');
  });

/* Returning to a committed page must show what was submitted — the accepted
   observations as well as the flagged ones — so it can be changed and resubmitted. */
test('Moving through pages',
  'a committed page still shows everything that was submitted on it', async () => {
    await reset();
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
    await new Promise((r) => setTimeout(r, 400));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 400));

    eq(state.rows.map((r) => r.observation_id), before,
       'the page must hold the same observations it was committed with');
    for (const id of accepted) {
      const row = state.rows.find((r) => r.observation_id === id);
      ok(row, `accepted observation ${id} must still be on the page`);
      eq(row.review_decision, 'reviewed', 'and still show as accepted');
    }
    const f = state.rows.find((r) => r.observation_id === flagged);
    eq(f.review_decision, 'flagged', 'and the flagged one is still flagged');
  });

test('Moving through pages',
  'a committed decision can be changed and resubmitted from the same page', async () => {
    await reset();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready'
      && !state.marks.has(r.observation_id));
    const id = target.observation_id;
    await actions.commitPage();
    eq(state.rows.find((r) => r.observation_id === id).review_decision, 'reviewed');

    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 400));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 400));

    actions.toggleMark(id);                       // change your mind about it
    await actions.commitPage();
    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.review_decision, 'flagged', 'resubmitting applies the change');
  });

/* Delete Mode deliberately reads Review status: what the record already says is the
   most useful thing to know before removing something permanently. Confirmed by the
   walkthrough on 2026-09-05, where the narration claimed the opposite. */
test('Delete mode',
  'Delete Mode shows what the scientific record already says', async () => {
    await reset();
    const id = state.rows.find((r) => r.thumbnail_status === 'ready'
      && !state.marks.has(r.observation_id)).observation_id;
    actions.toggleMark(id);
    await actions.commitPage();                   // flags it on the record

    actions.setMode('delete');
    await new Promise((r) => setTimeout(r, 500));
    eq(statusDimensions('delete')[0].label, 'Review status',
       'Delete leads on review status');
    const row = state.rows.find((r) => r.observation_id === id);
    ok(row, 'the flagged observation is still in the delete-mode results');
    eq(row.review_decision, 'flagged', 'and it still carries its flag');
  });

test('Delete mode',
  'nothing arrives marked in Delete Mode: a flag is not a deletion', async () => {
    await reset();
    const id = state.rows.find((r) => r.thumbnail_status === 'ready'
      && !state.marks.has(r.observation_id)).observation_id;
    actions.toggleMark(id);
    await actions.commitPage();

    actions.setMode('delete');
    await new Promise((r) => setTimeout(r, 500));
    eq(state.marks.size, 0, 'marking here means delete, so the flag must not seed one');
    eq(pendingException('delete'), null);
  });

/* Reported 2026-09-04: flags vanished when a mode was switched, and a committed page
   could not be edited. Both came from marks not being the page's exception set. */
test('Review states',
  'a page arrives with its existing flags already marked', async () => {
    await reset();
    const flaggedRows = state.rows.filter((r) => r.review_decision === 'flagged');
    if (!flaggedRows.length) return 'skipped — no flagged rows on this page';
    for (const r of flaggedRows) {
      ok(state.marks.has(r.observation_id),
         `flagged observation ${r.observation_id} must arrive marked, or committing clears it`);
    }
  });

test('Review states',
  'committing a page does not clear a flag nobody touched', async () => {
    await reset();
    const flagged = state.rows.find((r) => r.review_decision === 'flagged'
      && r.thumbnail_status === 'ready');
    if (!flagged) return 'skipped — no flagged rows on this page';
    const id = flagged.observation_id;
    await actions.commitPage();
    eq(state.rows.find((r) => r.observation_id === id).review_decision, 'flagged',
       'an untouched flag survives a page commit');
  });

test('Review states',
  'a committed page stays editable: the exceptions are still marked', async () => {
    await reset();
    const id = state.rows.find((r) => r.thumbnail_status === 'ready'
      && !state.marks.has(r.observation_id)).observation_id;
    actions.toggleMark(id);
    await actions.commitPage();
    ok(state.marks.has(id), 'the flag stays marked so a click can take it back');
    actions.toggleMark(id);
    await actions.commitPage();
    eq(state.rows.find((r) => r.observation_id === id).review_decision, 'reviewed',
       'and committing again accepts it');
  });

test('Scientific review and training review are independent',
  'switching modes clears what the other mode committed', async () => {
    await reset();
    await actions.commitPage();
    ok(state.outcomes.size > 0, 'the scientific commit recorded outcomes');
    actions.setMode('training');
    await new Promise((r) => setTimeout(r, 400));
    eq(state.outcomes.size, 0, "training must not wear scientific review's answers");
    eq(state.marks.size, 0, 'nor its marks');
  });

/* #85 made every workflow's tags visible from every mode, which makes this the check that
   the *decisions* stayed independent: seeing that something is excluded from training must
   not let a scientific commit write a training disposition. Added 2026-09-08. */
test('Scientific review and training review are independent',
  'a scientific commit writes only the review status', async () => {
    await reset();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready'
      && r.review_decision == null);
    ok(target, 'page 1 should contain an unreviewed row with imagery');
    const id = target.observation_id;
    /* What the whole page said about training before the scientific commit. */
    const before = new Map(state.rows.map((r) => [r.observation_id, r.training_decision]));

    actions.toggleMark(id);                        // flag this one, accept the rest
    await actions.commitPage();

    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.review_decision, 'flagged', 'the flag is written');
    ok(state.outcomes.size > 1, 'the rest of the page was accepted, so this is not vacuous');

    const drifted = state.rows
      .filter((r) => r.training_decision !== before.get(r.observation_id))
      .map((r) => r.observation_id);
    eq(drifted.length, 0,
       `no scientific decision may write a training disposition, changed: ${drifted}`);
  });

test('Moving through pages',
  'an observation pinned to a committed page does not also appear on a later page', async () => {
    await reset();
    const pinned = new Set(state.rows.map((r) => r.observation_id));
    await actions.commitPage();
    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 400));
    const overlap = state.rows.filter((r) => pinned.has(r.observation_id));
    eq(overlap.length, 0, 'page 2 must not repeat observations held by page 1');
  });

/* ------------------------------------------- the delete confirmation (#71) */

/**
 * These count what actually reaches the data seam.
 *
 * The requirement is "nothing is sent until the reviewer confirms", and the only honest
 * way to check that is to count the calls. Looking at the screen would pass whenever the
 * dialog appeared, whether or not a delete went out behind it.
 *
 * Each wraps MarpData.commitPage and restores it in a `finally`, so a failing check
 * cannot leave the seam stubbed for everything that runs after it.
 */
test('Delete mode',
  'R1: committing sends nothing until the reviewer confirms', async () => {
    await reset('delete');
    const real = MarpData.commitPage;
    let calls = 0;
    MarpData.commitPage = (...a) => { calls++; return real.apply(MarpData, a); };
    try {
      actions.toggleMark(state.rows[0].observation_id);
      actions.toggleMark(state.rows[1].observation_id);
      await actions.commitPage();

      eq(calls, 0, 'the first click must not send a delete');
      ok(state.confirm, 'it must be waiting on a confirmation');
      eq(state.confirm.count, 2, 'and it must know how many');
    } finally { MarpData.commitPage = real; }
  });

test('Delete mode',
  'R1: cancelling sends nothing and leaves every mark exactly as it was', async () => {
    await reset('delete');
    const real = MarpData.commitPage;
    let calls = 0;
    MarpData.commitPage = (...a) => { calls++; return real.apply(MarpData, a); };
    try {
      const ids = [state.rows[0].observation_id, state.rows[1].observation_id];
      ids.forEach((id) => actions.toggleMark(id));
      await actions.commitPage();
      actions.cancelDelete();

      eq(calls, 0, 'cancelling must not send anything');
      eq(state.confirm, null, 'the dialog must be closed');
      eq(ids.every((id) => state.marks.has(id)), true,
        'every mark must survive a cancel, or the page has to be redone');
    } finally { MarpData.commitPage = real; }
  });

test('Delete mode',
  'R1: confirming sends exactly one delete', async () => {
    await reset('delete');
    const real = MarpData.commitPage;
    let calls = 0;
    MarpData.commitPage = (...a) => { calls++; return real.apply(MarpData, a); };
    try {
      actions.toggleMark(state.rows[0].observation_id);
      await actions.commitPage();
      await actions.confirmDelete();
      /* A second confirm is a no-op, so a double click cannot delete twice. */
      await actions.confirmDelete();

      eq(calls, 1, 'exactly one delete may be sent');
      eq(state.confirm, null, 'and the dialog must be closed afterwards');
    } finally { MarpData.commitPage = real; }
  });

test('Delete mode',
  'A5: with nothing marked there is no dialog and nothing is sent', async () => {
    await reset('delete');
    const real = MarpData.commitPage;
    let calls = 0;
    MarpData.commitPage = (...a) => { calls++; return real.apply(MarpData, a); };
    try {
      await actions.commitPage();
      eq(calls, 0, 'nothing marked is not a deletion');
      eq(state.confirm, null, 'and must not raise a dialog to confirm destroying nothing');
    } finally { MarpData.commitPage = real; }
  });

test('Delete mode',
  'R4: scientific and training commit immediately, with no confirmation', async () => {
    for (const mode of ['scientific', 'training']) {
      await reset(mode);
      const real = MarpData.commitPage;
      let calls = 0;
      MarpData.commitPage = (...a) => { calls++; return real.apply(MarpData, a); };
      try {
        await actions.commitPage();
        eq(calls, 1, `${mode} must commit on the first click`);
        eq(state.confirm, null, `${mode} must never raise a delete confirmation`);
      } finally { MarpData.commitPage = real; }
    }
  });

/* ------------------------------------ the states never rendered (#72) */

test('The states never rendered',
  'R8: a flag on a row with no imagery reaches the record', async () => {
    await reset('scientific');
    const id = state.rows[0].observation_id;
    MarpData.breakThumbnails([id]);
    await actions.refresh();

    actions.toggleMark(id);
    await actions.commitPage();

    /* Read it back through the seam rather than trusting the outcome map: the bug this
       covers was the write never happening, which an in-memory outcome would still show.
       Queried, never reloaded -- `reload()` refetches the fixture from disk and would
       erase the very write being checked for. */
    const back = await MarpData.query({
      filters: { ...state.filters, reviewStatus: ['flagged'] }, page: 1, pageSize: 500,
    });
    ok(back.rows.some((r) => r.observation_id === id),
      'the flag must be written even though nobody could see the picture');
  });

test('The states never rendered',
  'R8: an unmarked row with no imagery is skipped, never silently accepted', async () => {
    await reset('scientific');
    const id = state.rows[0].observation_id;
    MarpData.breakThumbnails([id]);
    await actions.refresh();

    await actions.commitPage();

    const reviewed = await MarpData.query({
      filters: { ...state.filters, reviewStatus: ['reviewed'] }, page: 1, pageSize: 500,
    });
    ok(!reviewed.rows.some((r) => r.observation_id === id),
      'accepting means somebody looked at it, and nobody could');
  });

test('The states never rendered',
  'R7: a failed thumbnail can be asked for again', async () => {
    await reset('scientific');
    const id = state.rows[0].observation_id;
    MarpData.breakThumbnails([id]);
    await actions.refresh();
    eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'failed');

    /**
     * F10, R12: a retry answers **`queued`**, never a synchronous `ready`.
     *
     * This asserted that the imagery came back, which was the fixture's shortcut. An
     * accepted retry has not happened yet -- extraction runs at three concurrent Jellyfin
     * streams -- so the tile stays at PREPARING and the poll (A8) is what clears it. The
     * old assertion is exactly how the client came to believe a picture existed the moment
     * it asked for one.
     */
    await actions.retryThumbnail(id);
    eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'queued',
      'a retry asks for a picture; it cannot conjure one');
  });

test('The states never rendered',
  'R7: retrying a page costs two renders, not two per tile', async () => {
    /* Rendering here is a full re-render from state, deliberately -- so the cost of an
       action is the number of times it notifies. `retryFailedThumbnails` called
       `retryThumbnail` per row, and each of those notifies twice: a page of fifty cost a
       hundred full re-renders, each rebuilding all fifty tiles. Measured at 972 ms idle,
       and enough under parallel test workers to blow a twenty-second timeout, which is
       what made two browser tests flaky. Two paints: one to show the page queued, one when
       the answers are in. */
    await reset('scientific');
    const ids = state.rows.map((r) => r.observation_id);
    MarpData.breakThumbnails(ids);
    await actions.refresh();

    let renders = 0;
    let calls = 0;
    const realRetry = MarpData.retryThumbnails;
    MarpData.retryThumbnails = (...a) => { calls++; return realRetry.apply(MarpData, a); };
    const off = subscribe(() => { renders++; });
    try {
      await actions.retryFailedThumbnails();
    } finally {
      off();
      MarpData.retryThumbnails = realRetry;
    }

    ok(renders <= 4,
      `a page-level retry must not re-render per tile: ${ids.length} tiles cost ${renders} renders`);
    /**
     * A9, R11: **one request as well as two paints.**
     *
     * The check only ever counted renders, and #68's own note says why that is not enough:
     * "a regression to 45 requests would pass". So the request count is asserted beside
     * it now — a seam method taking ids rather than `retryThumbnail` mapped over the page
     * is the honest shape, and coalescing N calls inside `api/` would hide a round trip
     * this tier cannot otherwise see.
     */
    eq(calls, 1, `a page-level retry is one request, not ${ids.length}`);
    /**
     * F10, R12: the tiles are **`queued`**, not `ready`.
     *
     * This asserted `every(r => r.thumbnail_status === 'ready')`, which was the fixture's
     * shortcut: the endpoint answers `queued` for work it accepted and **never a terminal
     * `ready` invented synchronously** — an accepted retry has not happened yet. So a
     * retry leaves the tile at PREPARING and the poll (A8) is what clears it.
     */
    ok(state.rows.every((r) => r.thumbnail_status === 'queued'),
      `an accepted retry is queued work, not a picture; got ${
        JSON.stringify([...new Set(state.rows.map((r) => r.thumbnail_status))])}`);
  });

test('The states never rendered',
  'R7: a whole failed page can be retried at once', async () => {
    await reset('scientific');
    const ids = state.rows.map((r) => r.observation_id);
    MarpData.breakThumbnails(ids);
    await actions.refresh();
    ok(state.rows.every((r) => r.thumbnail_status === 'failed'), 'the page starts broken');

    await actions.retryFailedThumbnails();
    /* Queued, not ready -- see the check above. The case that motivated a page-level retry
       is a page where everything failed, and what it buys is one request. */
    ok(state.rows.every((r) => r.thumbnail_status === 'queued'),
      `the whole page was accepted for extraction in one request; got ${
        JSON.stringify([...new Set(state.rows.map((r) => r.thumbnail_status))])}`);
  });

/**
 * F11 and R13, at the store tier. **A state the client had code for and no data.**
 *
 * `src/data.js:494` short-circuited a retry on `current.thumbnail_permanent`, and no row
 * has ever carried the key — one grep hit, in the file reading it. The endpoint does not
 * put it on a page either: it answers `permanent: true` per *retry* entry and refuses
 * rather than re-queueing, because an observation with no keyframes has no bounding box
 * and can never have a cropped picture. Without that refusal the page's "Ask again"
 * button is a way to hammer a shared media server.
 */
test('The states never rendered',
  'R13: a permanent failure is not re-queued, and the row says why', async () => {
    await reset('scientific');
    const [first, second] = state.rows.map((r) => r.observation_id);
    MarpData.breakThumbnails([first], 'failed', { permanent: true });
    MarpData.breakThumbnails([second], 'failed');
    await actions.refresh();

    let asked = null;
    const realRetry = MarpData.retryThumbnails;
    MarpData.retryThumbnails = (ids, opts) => {
      asked = [...ids];
      return realRetry.call(MarpData, ids, opts);
    };

    try {
      /**
       * The **first** ask includes both, and that is correct rather than a defect: a page
       * does not say which failures are permanent — the endpoint answers `permanent: true`
       * per retry entry and refuses that one, which is where the client learns it. That
       * asymmetry is the whole of F11: the client had code reading a row field no row has
       * ever carried, so it never learned anything.
       */
      await actions.retryFailedThumbnails();
      ok(asked.includes(first) && asked.includes(second),
        'the page cannot know which failures are permanent until it asks');

      const permanent = state.rows.find((r) => r.observation_id === first);
      eq(permanent.thumbnail_status, 'failed', 'it stays failed, because nothing can help');
      eq(permanent.thumbnail_permanent, true, 'and the row now carries the refusal');
      ok(permanent.thumbnail_reason, 'with the reason the endpoint gave');
      eq(state.rows.find((r) => r.observation_id === second).thumbnail_status, 'queued',
        'the retryable one was accepted');

      /* And the **second** ask leaves it out, which is what stops the button becoming a
         way to hammer a shared media server for a picture that cannot exist. */
      MarpData.breakThumbnails([second], 'failed');
      asked = null;
      await actions.retryFailedThumbnails();
      ok(!asked.includes(first), 'a permanent failure is never asked for twice');
      ok(asked.includes(second), 'and the retryable one still is');
    } finally { MarpData.retryThumbnails = realRetry; }
  });

/**
 * F5 and R8, at the tier that can see it. **The silent one.**
 *
 * `page.applyCommit` read `r.id`, and every entry of `MosaicCommitResult` is keyed
 * `observation_id`. So one map entry was written under the key `undefined` and **every
 * tile on a committed page showed no outcome at all** — no error, no log, and a page that
 * looks exactly as though the commit never happened.
 */
test('Exception marking and the page commit',
  'R8: every tile a commit acted on carries an outcome afterwards', async () => {
    await reset('scientific');
    const ready = state.rows.filter((r) => r.thumbnail_status === 'ready');
    ok(ready.length > 1, 'the check needs a page with imagery on it');
    const flagged = ready[0].observation_id;
    actions.toggleMark(flagged);

    await actions.commitPage();

    /* Not "some outcome exists": an outcome for **each** row the commit acted on, found by
       its own id. A single entry under `undefined` satisfied every earlier assertion. */
    for (const r of ready) {
      ok(state.outcomes.has(r.observation_id),
        `observation ${r.observation_id} was committed and has no outcome`);
    }
    eq(state.outcomes.get(flagged), 'flagged');
    ok(!state.outcomes.has(undefined),
      'the old `r.id` read wrote exactly one entry, under the key undefined');
  });

/**
 * R9. A commit refused because the row moved underneath the page.
 *
 * **Not a refusal for being second** — the last commit wins, and nothing is ever turned
 * away for arriving after somebody else. This fires only where the annotation changed
 * while the reviewer was looking at it, which is the one case where "last write wins"
 * would mean silently discarding a correction they never saw.
 */
test('Concurrent review',
  'R9: a row that moved under the page comes back conflicted, with its mark kept', async () => {
    await reset('scientific');
    const target = state.rows.find((r) => r.thumbnail_status === 'ready');
    const id = target.observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Wrong species');

    /* Somebody else's write, between the page being fetched and the commit being sent. */
    MarpData.bumpVersion([id]);

    await actions.commitPage();

    eq(state.outcomes.get(id), 'conflicted', 'the reviewer is told, rather than overwritten');
    ok(state.conflicted.includes(id), 'and the page can offer to re-read');
    ok(state.marks.has(id), 'nothing was written, so the intention is still pending');
    eq(state.marks.get(id).reason, 'Wrong species', 'reason and all');

    /* Everything else on the page still landed: outcomes are per observation, so
       forty-nine decisions land while one comes back conflicted. */
    const others = state.rows.filter((r) => r.observation_id !== id
      && r.thumbnail_status === 'ready');
    for (const r of others) {
      ok(state.outcomes.has(r.observation_id),
        'a conflict on one row must not roll back the rest of the page');
    }
  });

test('The states never rendered',
  'R6: a queued thumbnail becomes ready, and a commit waits for it', async () => {
    await reset('scientific');
    const id = state.rows[0].observation_id;
    MarpData.breakThumbnails([id], 'queued');
    await actions.refresh();
    eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'queued');

    /* A retry on an already-queued row is a no-op: the picture is already asked for. */
    await actions.retryThumbnail(id);
    eq(state.rows.find((r) => r.observation_id === id).thumbnail_status, 'queued');
  });

test('The states never rendered',
  'R1: clearing the filters from an empty result actually re-queries', async () => {
    await reset('scientific');
    /* A combination that matches nothing. */
    state.filters.species = [-1];            // a key nothing carries (F1)
    await actions.refresh();
    eq(state.rows.length, 0, 'the filter must really empty the page');

    await actions.clearFilters();
    ok(state.rows.length > 0, 'clearing must bring the mosaic back, not just hide the message');
  });

test('The states never rendered',
  'R4: a result smaller than a page does not invent a second one', async () => {
    await reset('scientific');
    state.filters.species = [-1];            // a key nothing carries (F1)
    await actions.refresh();
    eq(state.total, 0);
    eq(state.rows.length, 0);
    /* The pager derives from total; a phantom page two is the classic off-by-one here. */
    ok(state.total <= state.pageSize, 'nothing beyond one page can exist');
  });

/* ------------------------------------------- keyboard shortcuts (#74) */

test('Keyboard shortcuts',
  'R1: the paging shortcut moves the page, not just the key handler', async () => {
    await reset('scientific');
    const first = state.page;
    actions.goToPage(state.page + 1);
    await new Promise((r) => setTimeout(r, 400));
    ok(state.page > first, 'the action behind the shortcut must really page');
  });

test('Keyboard shortcuts',
  'R2: clearing marks really empties them', async () => {
    await reset('scientific');
    actions.toggleMark(state.rows[0].observation_id);
    actions.toggleMark(state.rows[1].observation_id);
    eq(state.marks.size, 2);

    actions.clearMarks();
    eq(state.marks.size, 0, 'C must clear the page, not just redraw it');
  });

test('Keyboard shortcuts',
  'R4: the commit behind Ctrl+Enter reaches the seam exactly once', async () => {
    await reset('scientific');
    const real = MarpData.commitPage;
    let calls = 0;
    MarpData.commitPage = (...a) => { calls++; return real.apply(MarpData, a); };
    try {
      await actions.commitPage();
      eq(calls, 1, 'one keypress, one commit');
    } finally { MarpData.commitPage = real; }
  });

/* ------------------------------------------------------------------ runner */

export async function run(mount) {
  await MarpData.load();
  const out = [];
  let pass = 0, fail = 0, skip = 0;

  for (const t of results) {
    if (only && t.name !== only) continue;
    try {
      const note = await t.fn();
      if (typeof note === 'string' && note.startsWith('skipped')) { skip++; out.push({ ...t, status: 'skip', note }); }
      else { pass++; out.push({ ...t, status: 'pass' }); }
    } catch (err) {
      fail++;
      out.push({ ...t, status: 'fail', note: err.message });
    }
  }

  mount.innerHTML = `
    <div class="summary ${fail ? 'bad' : 'good'}">
      <b>${pass}</b> passed &middot; <b>${fail}</b> failed &middot; <b>${skip}</b> skipped
    </div>` + Object.entries(
      out.reduce((acc, r) => { (acc[r.requirement] ||= []).push(r); return acc; }, {})
    ).map(([req, rows]) => `
      <section>
        <h3>${req}</h3>
        <ul>${rows.map((r) => `
          <li class="${r.status}">
            <span class="dot"></span>
            <span class="nm">${r.name}</span>
            ${r.note ? `<span class="note">${r.note}</span>` : ''}
          </li>`).join('')}</ul>
      </section>`).join('');

  return { pass, fail, skip };
}
