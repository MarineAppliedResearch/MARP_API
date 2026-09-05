/**
 * Unit tests for the model layer.
 *
 * These need no browser, no server and no database — that is the point of keeping
 * `model/` free of the DOM and the network. Run them with:
 *
 *   node --test frontend/apps/marp-mosaic-review/tests/unit/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODES, isMode, commitActsOnMarked, commitCount, existingState, decidedBy,
  pendingException, statusDimensions } from '../../src/model/modes.js';
import * as page from '../../src/model/page.js';
import * as filters from '../../src/model/filters.js';

const row = (id, over = {}) => ({
  observation_id: id,
  thumbnail_status: 'ready',
  review_status: 'unreviewed',
  training_disposition: 'undecided',
  ...over
});

/* ------------------------------------------------------------------ modes */

test('every mode names what a mark is and what the commit does', () => {
  for (const id of ['scientific', 'training', 'delete']) {
    assert.ok(isMode(id));
    const m = MODES[id];
    assert.ok(m.mark && m.verb && m.commit, `${id} must be fully described`);
    assert.ok(m.statusKey && m.statuses.length, `${id} must filter on a status dimension`);
  }
});

test('delete is the only mode whose commit acts on the marked tiles', () => {
  assert.equal(commitActsOnMarked('delete'), true);
  assert.equal(commitActsOnMarked('scientific'), false);
  assert.equal(commitActsOnMarked('training'), false);
});

test('the commit count follows that inversion', () => {
  const rows = [row(1), row(2), row(3), row(4)];
  const marks = new Map([[1, {}], [2, {}]]);
  assert.equal(commitCount({ mode: 'scientific', rows, marks }), 2, 'acts on the unmarked');
  assert.equal(commitCount({ mode: 'training', rows, marks }), 2);
  assert.equal(commitCount({ mode: 'delete', rows, marks }), 2, 'acts on the marked');
});

test('observations without imagery are not eligible for a commit', () => {
  const rows = [row(1), row(2, { thumbnail_status: 'failed' }), row(3, { thumbnail_status: 'queued' })];
  assert.equal(commitCount({ mode: 'scientific', rows, marks: new Map() }), 1);
});

test('the state a record carries is read per mode', () => {
  const flagged = row(1, { review_status: 'flagged' });
  assert.equal(existingState('scientific', flagged), 'flagged');
  assert.equal(existingState('training', flagged), null, 'review status is not a training state');

  const excluded = row(2, { training_disposition: 'excluded' });
  assert.equal(existingState('training', excluded), 'excluded');
  assert.equal(existingState('scientific', excluded), null);

  assert.equal(existingState('scientific', row(3)), null, 'unreviewed carries no state');
});

test('who decided is found wherever the decision was recorded', () => {
  assert.equal(decidedBy(row(1, { flagged_by: 'A' })), 'A');
  assert.equal(decidedBy(row(2, { training_approved_by: 'B' })), 'B');
  assert.equal(decidedBy(row(3)), null);
});

/* ------------------------------------------------------------------- page */

test('a tap toggles a mark, and a mark starts without a reason', () => {
  let marks = new Map();
  marks = page.toggleMark(marks, 7);
  assert.deepEqual(marks.get(7), { reason: null });
  marks = page.toggleMark(marks, 7);
  assert.equal(marks.has(7), false);
});

test('choosing the same reason twice clears it', () => {
  let marks = page.toggleMark(new Map(), 7);
  marks = page.setReason(marks, 7, 'Occluded');
  assert.equal(marks.get(7).reason, 'Occluded');
  marks = page.setReason(marks, 7, 'Occluded');
  assert.equal(marks.get(7).reason, null);
});

test('a reason cannot be set on something that is not marked', () => {
  const marks = page.setReason(new Map(), 9, 'Occluded');
  assert.equal(marks.has(9), false);
});

test('marking all is scoped to the page it was given', () => {
  const rows = [row(1), row(2)];
  const marks = page.markAll(new Map(), rows);
  assert.equal(marks.size, 2);
});

test('a committed page keeps its membership, and pins are excluded elsewhere', () => {
  let members = page.pinPage(new Map(), 1, [10, 11, 12]);
  members = page.pinPage(members, 3, [30]);
  assert.deepEqual(members.get(1), [10, 11, 12]);
  assert.deepEqual([...page.pinnedIds(members)].sort((a, b) => a - b), [10, 11, 12, 30]);
  assert.equal(page.clearPins().size, 0);
});

test('a commit result folds into the outcomes, flagged included', () => {
  const out = page.applyCommit(new Map(), {
    reviewed: [{ id: 1, outcome: 'reviewed' }],
    flagged: [{ id: 2, outcome: 'flagged' }],
    skipped: [{ id: 3, reason: 'no-imagery' }]
  });
  assert.equal(out.get(1), 'reviewed');
  assert.equal(out.get(2), 'flagged');
  assert.equal(out.has(3), false, 'a skipped observation has no outcome');
});

test('the page window pins the ends and gaps the middle', () => {
  assert.deepEqual(page.pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(page.pageWindow(10, 96), [1, 'gap', 8, 9, 10, 11, 12, 'gap', 96]);
  assert.deepEqual(page.pageWindow(2, 96), [1, 2, 3, 4, 'gap', 96], 'no gap when nothing is skipped');
});

test('page numbers clamp to the available range', () => {
  assert.equal(page.clampPage(0, 10), 1);
  assert.equal(page.clampPage(99, 10), 10);
  assert.equal(page.clampPage(NaN, 10), 1);
});

/* ---------------------------------------------------------------- filters */

test('each mode sends only its own status dimension', () => {
  const f = { reviewStatus: ['unreviewed'], trainingDisposition: ['undecided'] };
  assert.equal(filters.queryFilters('scientific', f).trainingDisposition, null);
  assert.equal(filters.queryFilters('training', f).reviewStatus, null);
});

test('pinned observations are excluded from the pages still to be done', () => {
  const out = filters.queryFilters('scientific', {}, { excludeIds: new Set([1, 2]) });
  assert.equal(out.excludeIds.size, 2);
  assert.equal(filters.queryFilters('scientific', {}, { excludeIds: new Set() }).excludeIds, undefined);
});

test('entering a mode with nothing selected falls back to its default', () => {
  const out = filters.ensureStatusFor('training', { trainingDisposition: [] });
  assert.deepEqual(out.trainingDisposition, MODES.training.defaultStatus);
  const kept = filters.ensureStatusFor('training', { trainingDisposition: ['promoted'] });
  assert.deepEqual(kept.trainingDisposition, ['promoted'], 'an existing choice is respected');
});

test('flagged work stays in the default scientific view, because it is still open', () => {
  assert.ok(MODES.scientific.defaultStatus.includes('flagged'));
  assert.ok(!MODES.scientific.defaultStatus.includes('reviewed'));
});

test('the active filter count reflects what is narrowing the results', () => {
  assert.equal(filters.activeFilterCount('scientific',
    { species: 'Bat Star', project: null, dive: null, reviewStatus: ['unreviewed'] }), 2);
  assert.equal(filters.activeFilterCount('scientific',
    { species: null, project: null, dive: null, reviewStatus: [] }), 0);
});

/* ------------------------------- the marks are the page's exception set */

test('a page arrives with its existing exceptions already marked', () => {
  const rows = [
    row(1, { review_status: 'flagged', flag_reason: 'Duplicate' }),
    row(2, { training_disposition: 'excluded', exclusion_reason: 'Occluded' }),
    row(3, { review_status: 'reviewed' })
  ];
  const isEx = (mode) => (r) => existingState(mode, r) === pendingException(mode);

  const sci = page.seedMarks(new Map(), new Set(), rows, isEx('scientific'));
  assert.deepEqual([...sci.keys()], [1], 'only what this mode calls an exception');
  assert.equal(sci.get(1).reason, 'Duplicate', 'the reason comes with it');

  const tra = page.seedMarks(new Map(), new Set(), rows, isEx('training'));
  assert.deepEqual([...tra.keys()], [2], 'each mode seeds from its own dimension only');
});

test('committing a page must not clear a flag nobody touched', () => {
  /* The commit accepts everything unmarked, so an unseeded flag would be erased. */
  const rows = [row(1, { review_status: 'flagged' }), row(2)];
  const isEx = (r) => existingState('scientific', r) === pendingException('scientific');
  const marks = page.seedMarks(new Map(), new Set(), rows, isEx);
  assert.equal(commitCount({ mode: 'scientific', rows, marks }), 1, 'only the unflagged one');
});

test('a decision made by hand is never seeded back', () => {
  const rows = [row(1, { review_status: 'flagged' })];
  const isEx = (r) => existingState('scientific', r) === pendingException('scientific');
  assert.equal(page.seedMarks(new Map(), new Set([1]), rows, isEx).size, 0);
});

test('delete mode has no pending exception, so it seeds nothing', () => {
  assert.equal(pendingException('delete'), null);
  assert.equal(pendingException('scientific'), 'flagged');
  assert.equal(pendingException('training'), 'excluded');
});

/* --------------------------------------- a committed page stays editable */

const commitResult = {
  reviewed: [{ id: 2, outcome: 'reviewed' }, { id: 3, outcome: 'reviewed' }],
  flagged: [{ id: 1, outcome: 'flagged' }], skipped: [], reverted: []
};

test('the exceptions stay marked after a commit, so a click can take one back', () => {
  const outcomes = page.applyCommit(new Map(), commitResult);
  const marks = page.marksAfterCommit(
    new Map([[1, { reason: 'Duplicate' }]]), outcomes, [1, 2, 3], pendingException('scientific'));
  assert.deepEqual([...marks.keys()], [1]);
  assert.equal(marks.get(1).reason, 'Duplicate', 'the reason belonged to the decision');
});

test('what a commit accepted does not stay marked', () => {
  const outcomes = page.applyCommit(new Map(), commitResult);
  const marks = page.marksAfterCommit(new Map(), outcomes, [1, 2, 3], pendingException('scientific'));
  assert.ok(!marks.has(2) && !marks.has(3));
});

test('a deleted observation is not a pending intention', () => {
  const outcomes = page.applyCommit(new Map(), { reviewed: [{ id: 1, outcome: 'deleted' }] });
  assert.equal(page.marksAfterCommit(new Map(), outcomes, [1], pendingException('delete')).size, 0);
});

/* ------------------------------ Delete Mode reads both status dimensions */

test('every mode filters on its own dimension; Delete filters on both', () => {
  assert.deepEqual(statusDimensions('scientific').map((d) => d.key), ['reviewStatus']);
  assert.deepEqual(statusDimensions('training').map((d) => d.key), ['trainingDisposition']);
  /* Deleting is irreversible, so anything already on the record is a reason to stop. */
  assert.deepEqual(statusDimensions('delete').map((d) => d.key),
    ['reviewStatus', 'trainingDisposition']);
});

test('the query keeps every dimension the mode filters on, and drops the rest', () => {
  const f = {
    ...filters.DEFAULT_FILTERS,
    reviewStatus: ['flagged'],
    trainingDisposition: ['promoted']
  };
  const sci = filters.queryFilters('scientific', f);
  assert.deepEqual(sci.reviewStatus, ['flagged']);
  assert.equal(sci.trainingDisposition, null, 'training must not narrow scientific review');

  const tra = filters.queryFilters('training', f);
  assert.equal(tra.reviewStatus, null);
  assert.deepEqual(tra.trainingDisposition, ['promoted']);

  const del = filters.queryFilters('delete', f);
  assert.deepEqual(del.reviewStatus, ['flagged'], 'Delete keeps review status');
  assert.deepEqual(del.trainingDisposition, ['promoted'], 'and training disposition');
});

test('entering Delete Mode gives both dimensions a default', () => {
  const bare = { ...filters.DEFAULT_FILTERS, reviewStatus: [], trainingDisposition: [] };
  const out = filters.ensureStatusFor('delete', bare);
  assert.ok(out.reviewStatus.length, 'review status falls back');
  assert.ok(out.trainingDisposition.length, 'and so does training disposition');
  /* Its training default shows everything: it is there to inform, not to hide rows. */
  assert.deepEqual(out.trainingDisposition, ['undecided', 'promoted', 'excluded']);
});

test('both dimensions count towards the collapsed rail badge in Delete Mode', () => {
  const f = { species: 'Bat Star', project: null, dive: null,
    reviewStatus: ['flagged'], trainingDisposition: ['promoted'] };
  assert.equal(filters.activeFilterCount('delete', f), 3, 'species plus two dimensions');
  assert.equal(filters.activeFilterCount('scientific', f), 2, 'species plus one');
});

/* ------------------------------- project, dive and line nest */

test('the rail narrows from where it was to what it is', () => {
  assert.deepEqual(filters.FILTER_KEYS, ['project', 'dive', 'line', 'species']);
});

test('changing the project drops the dive and the line under it', () => {
  const f = { ...filters.DEFAULT_FILTERS, project: 'A', dive: 'D04', line: '2' };
  const out = filters.applyFilter(f, 'project', 'B');
  assert.equal(out.project, 'B');
  assert.equal(out.dive, null, 'a dive belongs to a project');
  assert.equal(out.line, null, 'and a line to a dive');
});

test('changing the dive drops the line, and keeps the project', () => {
  const f = { ...filters.DEFAULT_FILTERS, project: 'A', dive: 'D04', line: '2' };
  const out = filters.applyFilter(f, 'dive', 'D06');
  assert.equal(out.project, 'A');
  assert.equal(out.dive, 'D06');
  assert.equal(out.line, null, 'line 2 of one dive is not line 2 of another');
});

test('a filter that nothing nests under leaves the rest alone', () => {
  const f = { ...filters.DEFAULT_FILTERS, project: 'A', dive: 'D04', line: '2' };
  const out = filters.applyFilter(f, 'species', 'Ochre Star');
  assert.equal(out.dive, 'D04');
  assert.equal(out.line, '2');
});

test('dive and line each count towards the collapsed rail badge', () => {
  const f = { project: 'A', dive: 'D04', line: '2', species: null,
    reviewStatus: [], trainingDisposition: [] };
  assert.equal(filters.activeFilterCount('scientific', f), 3);
});

test('entering a mode opens it at its own default, not the last mode\'s', () => {
  /* Training narrows to undecided so finished work leaves the view. Delete shows all
     three, because there the disposition is context rather than a filter — inheriting
     the narrowing hid every observation just promoted, which is the worst thing to
     hide before a permanent delete. */
  const afterTraining = { ...filters.DEFAULT_FILTERS, trainingDisposition: ['undecided'] };
  const inDelete = filters.defaultStatusFor('delete', afterTraining);
  assert.deepEqual(inDelete.trainingDisposition, ['undecided', 'promoted', 'excluded']);
  assert.deepEqual(inDelete.reviewStatus, ['unreviewed', 'flagged']);

  const back = filters.defaultStatusFor('training', inDelete);
  assert.deepEqual(back.trainingDisposition, ['undecided']);
});
