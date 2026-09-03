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
      marked: new Set([marked])
    });
    ok(!res.reviewed.some((r) => r.id === marked), 'the marked tile must not be accepted');
    ok(res.skipped.some((s) => s.id === marked && s.reason === 'marked'),
       'the marked tile should be reported as skipped');
  });

test('Delete mode',
  'delete commit acts on the MARKED tiles, inverting the review modes', async () => {
    await reset('delete');
    const marked = state.rows[0].observation_id;
    const untouched = state.rows[1].observation_id;
    const res = await MarpData.commitPage({
      mode: 'delete',
      observationIds: state.rows.map((r) => r.observation_id),
      marked: new Set([marked])
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
      mode: 'scientific', observationIds: rows.map((r) => r.observation_id), marked: new Set()
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
