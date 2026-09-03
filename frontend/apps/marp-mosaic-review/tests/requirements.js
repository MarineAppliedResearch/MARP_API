/**
 * Requirement checks.
 *
 * Each test names the requirement from MARP_API#68 that it holds the prototype to.
 * These drive the same actions the UI drives, so they check behaviour rather than
 * markup — a rendering change should not break them, and a behaviour change should.
 */
import { state, actions, MODES } from '../src/store.js';
import { MarpData } from '../src/data.js';

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

/** Put the store back to a known place between tests. */
async function reset(mode = 'scientific') {
  state.mode = mode;
  state.page = 1;
  state.filters.species = 'Bat Star';
  state.filters.project = null;
  state.filters.reviewStatus = ['unreviewed', 'flagged'];
  state.filters.trainingDisposition = ['undecided'];
  state.outcomes.clear();
  state.marks.clear();
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
    const res = await MarpData.commitPage({
      mode: 'scientific',
      observationIds: state.rows.map((r) => r.observation_id),
      marks: new Map([[marked, { reason: null }]])
    });
    ok(!res.reviewed.some((r) => r.id === marked), 'the marked tile must not be accepted');
    ok(res.flagged.some((f) => f.id === marked && f.outcome === 'flagged'),
       'it should be reported as flagged, which is a decision rather than a skip');
  });

test('Delete mode',
  'delete commit acts on the MARKED tiles, inverting the review modes', async () => {
    await reset('delete');
    const marked = state.rows[0].observation_id;
    const untouched = state.rows[1].observation_id;
    const res = await MarpData.commitPage({
      mode: 'delete',
      observationIds: state.rows.map((r) => r.observation_id),
      marks: new Map([[marked, { reason: null }]])
    });
    ok(res.reviewed.some((r) => r.id === marked && r.outcome === 'deleted'),
       'the marked tile should be deleted');
    ok(!res.reviewed.some((r) => r.id === untouched), 'unmarked tiles must be untouched');
  });

test('What counts as reviewed',
  'an observation without ready imagery is skipped, and does not block the batch', async () => {
    await reset();
    const rows = state.rows;
    const bad = rows.find((r) => r.thumbnail_status !== 'ready');
    if (!bad) return 'skipped — no unavailable thumbnail on page 1';
    const res = await MarpData.commitPage({
      mode: 'scientific', observationIds: rows.map((r) => r.observation_id), marks: new Map()
    });
    ok(res.skipped.some((s) => s.id === bad.observation_id && s.reason === 'no-imagery'),
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
    const from = state.rows[0].comname;
    actions.toggleMark(id);
    await actions.changeSpecies(id, 43);            // Ochre Star
    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.comname, 'Ochre Star', 'the row should carry the new species');
    ok(state.changed.has(id), 'the change should be recorded locally');
    eq(state.changed.get(id).from, from);
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
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_status !== 'reviewed');
    ok(target, 'page 1 should contain a reviewable row');
    const id = target.observation_id;
    await actions.commitPage();
    eq(state.outcomes.get(id), 'reviewed', 'first commit accepts it');
    actions.toggleMark(id);
    await actions.commitPage();
    const row = state.rows.find((r) => r.observation_id === id);
    ok(row.review_status !== 'reviewed', 'the acceptance must be withdrawn');
    eq(row.review_status, 'flagged', 'and the observation is now flagged instead');
    eq(row.reviewed_by, null, 'the previous acceptance is cleared');
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
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_status !== 'reviewed');
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
    eq(row.training_disposition, 'promoted', 'the record itself must carry it');
    eq(row.training_approved_by, 'I. Travers', 'and who approved it');
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
    if (seen) eq(seen.training_disposition, 'promoted');
  });

test('Filter and sort dimensions',
  'filtering by a disposition returns only observations carrying it', async () => {
    for (const want of ['excluded', 'promoted', 'undecided']) {
      await reset('training');
      state.filters.trainingDisposition = [want];
      await actions.refresh();
      const wrong = state.rows.filter((r) => r.training_disposition !== want);
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
      const wrong = state.rows.filter((r) => r.review_status !== want);
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
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_status === 'unreviewed');
    ok(target, 'need an unreviewed row');
    const id = target.observation_id;
    actions.toggleMark(id);
    actions.setReason(id, 'Wrong species');
    await actions.commitPage();
    const row = state.rows.find((r) => r.observation_id === id);
    eq(row.review_status, 'flagged', 'the record must carry the flag');
    eq(row.flag_reason, 'Wrong species', 'and the reason');
    eq(row.flagged_by, 'I. Travers', 'and who flagged it');
  });

test('Review states',
  'a committed flag is still shown after leaving the page and returning', async () => {
    await reset();
    const target = state.rows.find((r) => r.thumbnail_status === 'ready' && r.review_status === 'unreviewed');
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
    eq(row.review_status, 'flagged');
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
    eq(row.training_disposition, 'excluded');
    eq(row.exclusion_reason, 'Occluded');
  });

test('Correcting an observation',
  'a species correction is still visible on the tile after returning', async () => {
    await reset();
    state.filters.species = null;            // a correction moves the row out of a species filter
    await actions.refresh();
    const id = state.rows[0].observation_id;
    const was = state.rows[0].comname;
    actions.toggleMark(id);
    await actions.changeSpecies(id, 45);            // Sunflower Star
    actions.goToPage(2);
    await new Promise((r) => setTimeout(r, 350));
    actions.goToPage(1);
    await new Promise((r) => setTimeout(r, 350));
    const row = state.rows.find((r) => r.observation_id === id);
    if (!row) return 'skipped — the corrected row left the current filter';
    eq(row.comname, 'Sunflower Star', 'the correction persists');
    eq(row.previous_comname, was, 'and what it was before is still recorded');
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
