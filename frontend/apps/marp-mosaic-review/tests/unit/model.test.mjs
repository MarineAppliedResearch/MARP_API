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
import { readFileSync } from 'node:fs';

import { MODES, isMode, commitActsOnMarked, commitCount, existingState, decidedBy,
  pendingException, statusDimensions, commitIsDestructive,
  deleteImpact, commitOutcome, pageState } from '../../src/model/modes.js';
import * as page from '../../src/model/page.js';
import * as filters from '../../src/model/filters.js';
import { resolveKey, hintFor, SHORTCUTS } from '../../src/model/keys.js';
import * as dimensions from '../../src/model/dimensions.js';
import * as match from '../../src/model/match.js';

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
  /* Arrays: every set dimension has held one since #77. These read `'Bat Star'` until
     2026-09-06 and still passed, because a string has a length -- so the count was right
     for a shape the application had stopped producing. */
  assert.equal(filters.activeFilterCount('scientific',
    { species: ['Bat Star'], project: [], dive: [], reviewStatus: ['unreviewed'] }), 2);
  assert.equal(filters.activeFilterCount('scientific',
    { species: [], project: [], dive: [], reviewStatus: [] }), 0);
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
  const f = { species: ['Bat Star'], project: [], dive: [],
    reviewStatus: ['flagged'], trainingDisposition: ['promoted'] };
  assert.equal(filters.activeFilterCount('delete', f), 3, 'species plus two dimensions');
  assert.equal(filters.activeFilterCount('scientific', f), 2, 'species plus one');
});

/* ------------------------------- project, dive and line nest */

test('R6: the rail is whatever the declaration says, in its order', () => {
  /* This used to assert a literal list of four. The point of the declaration is that
     nothing keeps a second copy of that list -- a dimension present in DIMENSIONS and
     missing from FILTER_KEYS would filter but not count towards the collapsed badge. */
  assert.deepEqual(filters.FILTER_KEYS, dimensions.DIMENSIONS.map((d) => d.key));
  assert.ok(filters.FILTER_KEYS.length >= 10, 'the five new dimensions are present');

  for (const key of filters.FILTER_KEYS) {
    assert.ok(key in filters.DEFAULT_FILTERS, `${key} needs a default or it is half-wired`);
  }
});

test('R7: removing a project keeps the dives that still apply', () => {
  /* The old rule cleared every narrower dimension outright. With several selectable that
     throws away a careful selection because one project was dropped. */
  const f = {
    ...filters.DEFAULT_FILTERS,
    project: ['Deep Reef', 'Nearshore'], dive: ['D04', 'D05', 'D09'], line: ['1'],
  };
  const reachable = { dive: ['D04', 'D05'], line: ['1'] };   // D09 belonged to Nearshore

  const out = filters.applyFilter(f, 'project', ['Deep Reef'], reachable);
  assert.deepEqual(out.project, ['Deep Reef']);
  assert.deepEqual(out.dive, ['D04', 'D05'], 'the dives that still exist are kept');
  assert.deepEqual(out.line, ['1'], 'and so is anything under them');
});

test('R7: a dependent with nothing left over falls back to not filtering', () => {
  const f = { ...filters.DEFAULT_FILTERS, project: ['A'], dive: ['D04'] };
  const out = filters.applyFilter(f, 'project', ['B'], { dive: [], line: [] });
  assert.deepEqual(out.dive, [], 'empty means the dimension stops filtering, not that nothing matches');
});

test('R7: with no reachability known, the old blunt rule still applies', () => {
  /* Safe rather than wrong: only the data layer knows which dives belong to which
     project, and clearing is the answer that cannot show a combination returning nothing. */
  const f = { ...filters.DEFAULT_FILTERS, project: ['A'], dive: ['D04'], line: ['2'] };
  const out = filters.applyFilter(f, 'project', ['B']);
  assert.deepEqual(out.dive, []);
  assert.deepEqual(out.line, []);
});

test('a filter that nothing nests under leaves the rest alone', () => {
  const f = { ...filters.DEFAULT_FILTERS, project: 'A', dive: 'D04', line: '2' };
  const out = filters.applyFilter(f, 'species', 'Ochre Star');
  assert.equal(out.dive, 'D04');
  assert.equal(out.line, '2');
});

test('dive and line each count towards the collapsed rail badge', () => {
  const f = { project: ['A'], dive: ['D04'], line: ['2'], species: [],
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

/* ------------------------------------------ the delete confirmation (#71) */

test('delete is the only mode whose commit destroys something', () => {
  assert.equal(commitIsDestructive('delete'), true);
  assert.equal(commitIsDestructive('scientific'), false);
  assert.equal(commitIsDestructive('training'), false);
});

test('R2: deleteImpact counts only the marked rows a commit would act on', () => {
  /* A marked tile whose thumbnail never arrived is not deleted, so it must not be
     counted -- otherwise the dialog promises to destroy something it will not. */
  const rows = [
    row(1), row(2), row(3),
    row(4, { thumbnail_status: 'failed' }),
  ];
  const marks = new Map([[1, {}], [2, {}], [4, {}]]);

  const impact = deleteImpact({ rows, marks });
  assert.equal(impact.count, 2);
  assert.equal(impact.count, commitCount({ mode: 'delete', rows, marks }),
    'the dialog must show the number the commit acts on');
});

test('A3: the breakdown counts reviewed and promoted rows, and ignores excluded', () => {
  const rows = [
    row(1, { review_status: 'reviewed' }),
    row(2, { review_status: 'flagged' }),
    row(3, { training_disposition: 'promoted' }),
    row(4, { training_disposition: 'excluded' }),
    row(5),
  ];
  const marks = new Map([[1, {}], [2, {}], [3, {}], [4, {}], [5, {}]]);

  const impact = deleteImpact({ rows, marks });
  assert.equal(impact.count, 5);
  /* Both reviewed and flagged mean somebody looked at it and decided. */
  assert.equal(impact.reviewed, 2);
  /* Excluded is not a reason to keep an observation; promoted is. */
  assert.equal(impact.promoted, 1);
});

test('A3: nothing to warn about reports zeroes rather than guessing', () => {
  const rows = [row(1), row(2)];
  const impact = deleteImpact({ rows, marks: new Map([[1, {}], [2, {}]]) });
  assert.deepEqual(impact, { count: 2, reviewed: 0, promoted: 0 });
});

test('A5: nothing marked is not a deletion', () => {
  const impact = deleteImpact({ rows: [row(1), row(2)], marks: new Map() });
  assert.equal(impact.count, 0);
});

/* ------------------------------------- the states never rendered (#72) */

test('R5: commitOutcome splits what a commit accepts, flags and skips', () => {
  const rows = [
    row(1),                                   // untouched, has imagery -> accepted
    row(2),                                   // marked -> flagged
    row(3, { thumbnail_status: 'failed' }),   // untouched, no imagery -> skipped
    row(4, { thumbnail_status: 'failed' }),   // marked, no imagery -> still flagged
  ];
  const marks = new Map([[2, {}], [4, {}]]);

  const out = commitOutcome({ mode: 'scientific', rows, marks });
  assert.equal(out.accepts, 1);
  assert.equal(out.flags, 2, 'a flag does not need imagery');
  assert.equal(out.skips, 1, 'an unmarked row with no imagery is skipped, never accepted');
  assert.equal(out.acts, 3, 'the number on the button is accepts plus flags');
});

test('R5: the button never offers to act on rows the commit will drop', () => {
  /* The whole page is broken and nothing is marked: a commit would do nothing at all,
     and saying "12 tiles" would be a lie. */
  const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, { thumbnail_status: 'failed' }));
  const out = commitOutcome({ mode: 'scientific', rows, marks: new Map() });
  assert.equal(out.acts, 0);
  assert.equal(out.skips, 12);
});

test('R5: delete acts on what is marked, imagery or not', () => {
  const rows = [row(1), row(2, { thumbnail_status: 'failed' }), row(3)];
  const out = commitOutcome({ mode: 'delete', rows, marks: new Map([[1, {}], [2, {}]]) });
  assert.equal(out.deletes, 2);
  assert.equal(out.acts, 2);
});

test('R1: a page with no rows is empty, and knows whether anything matched', () => {
  assert.equal(pageState({ rows: [], loading: false, total: 0 }), 'empty');
  assert.equal(pageState({ rows: [], loading: false, total: 40 }), 'filtered-out');
  assert.equal(pageState({ rows: [], loading: true, total: 0 }), 'loading');
});

test('R3: a page whose thumbnails all failed is its own state', () => {
  const failed = [row(1, { thumbnail_status: 'failed' }), row(2, { thumbnail_status: 'failed' })];
  assert.equal(pageState({ rows: failed, loading: false, total: 2 }), 'no-imagery');

  const some = [row(1), row(2, { thumbnail_status: 'failed' })];
  assert.equal(pageState({ rows: some, loading: false, total: 2 }), 'partial-imagery');

  assert.equal(pageState({ rows: [row(1), row(2)], loading: false, total: 2 }), 'ready');
});

test('R9: scientific review can say the observation could not be seen', () => {
  assert.ok(MODES.scientific.reasons.includes('No imagery'),
    'a flag raised because nobody could see it must be able to say so on the record');
  assert.ok(!MODES.delete.reasons.length, 'delete still records no reason');
});

/* ------------------------------------------- keyboard shortcuts (#74) */

const press = (key, over = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

test('R1-R3: the page-level keys map to their actions', () => {
  assert.equal(resolveKey(press('ArrowRight')), 'nextPage');
  assert.equal(resolveKey(press('n')), 'nextPage');
  assert.equal(resolveKey(press('N')), 'nextPage', 'case must not matter');
  assert.equal(resolveKey(press('ArrowLeft')), 'prevPage');
  assert.equal(resolveKey(press('p')), 'prevPage');
  assert.equal(resolveKey(press('c')), 'clearMarks');
  assert.equal(resolveKey(press('1')), 'modeScientific');
  assert.equal(resolveKey(press('2')), 'modeTraining');
  assert.equal(resolveKey(press('3')), 'modeDelete');
});

test('R4: no bare key can ever commit', () => {
  assert.equal(resolveKey(press('Enter')), null, 'Enter alone must not commit a page');
  assert.equal(resolveKey(press('Enter', { shiftKey: true })), null);
  assert.equal(resolveKey(press('Enter', { altKey: true })), null);

  assert.equal(resolveKey(press('Enter', { ctrlKey: true })), 'commitPage');
  assert.equal(resolveKey(press('Enter', { metaKey: true })), 'commitPage', 'Cmd on a Mac');

  /* And the reverse: a chord must not trigger the bare shortcuts, or Ctrl+N would page
     instead of opening a window. */
  assert.equal(resolveKey(press('n', { ctrlKey: true })), null);
});

test('R5: nothing fires while somebody is typing', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
    assert.equal(resolveKey(press('n'), { tagName }), null, `${tagName} owns its keys`);
  }
  assert.equal(resolveKey(press('c'), { isEditable: true }), null,
    'contenteditable reveals itself through no tag name');
  /* The species search is the case that motivated this: typing "no imagery" would
     otherwise page forward twice and clear the page on the way. */
  assert.equal(resolveKey(press('o'), { tagName: 'INPUT' }), null);
});

test('R5: a dialog owns the keyboard while it is open', () => {
  assert.equal(resolveKey(press('n'), { modalOpen: true }), null);
  assert.equal(resolveKey(press('Enter', { ctrlKey: true }), { modalOpen: true }), null,
    'committing out from under an open confirmation must be impossible');
});

test('R6: every shortcut carries a hint to draw on its control', () => {
  for (const s of SHORTCUTS) {
    assert.ok(s.hint, `${s.action} needs a hint or it is undiscoverable`);
    assert.equal(hintFor(s.action), s.hint);
  }
  assert.equal(hintFor('commitPage'), 'Ctrl+Enter');
  assert.equal(hintFor('nothingLikeThis'), null);
});

test('unknown keys are simply not ours', () => {
  assert.equal(resolveKey(press('q')), null);
  assert.equal(resolveKey(press('F5')), null, 'refresh must still refresh');
  assert.equal(resolveKey(null), null);
});

/* --------------------------------------- the filter rail (#77) */

test('R4: tc is read with its day group, exactly as db/timecode.js reads it', () => {
  /* A dive crossing midnight writes `1.00:15:33`. Reading the day as part of the hour,
     or ignoring the group entirely, puts the same observation in a different hour
     depending on who asked -- and that module's comment is that getting this slightly
     wrong is a changed scientific record, not a rounding error. */
  assert.equal(match.timeOfDayMs('21:57:22'), ((21 * 3600) + (57 * 60) + 22) * 1000);
  assert.equal(match.timeOfDayMs('1.00:15:33'), ((0 * 3600) + (15 * 60) + 33) * 1000,
    'past midnight is 00:15 the next day, not hour 1 and not hour 24');
  assert.equal(match.timeOfDayMs('00:02:18.2800000'), 138280);
  assert.equal(match.timeOfDayMs(''), null);
  assert.equal(match.timeOfDayMs('not a timespan'), null);
});

test('R4: a time window may wrap past midnight, and both sides are one night', () => {
  const at = (t) => match.timeOfDayMs(t);
  const from = match.clockMs('22:00'), to = match.clockMs('02:00');

  assert.equal(match.withinWindow(at('22:30:00'), from, to), true, 'before midnight');
  assert.equal(match.withinWindow(at('1.00:15:33'), from, to), true, 'after midnight');
  assert.equal(match.withinWindow(at('12:00:00'), from, to), false, 'the middle of the day is not night');
  assert.equal(match.withinWindow(at('21:59:59'), from, to), false, 'just before it opens');
});

test('R4: an ordinary window does not wrap', () => {
  const from = match.clockMs('09:00'), to = match.clockMs('17:00');
  assert.equal(match.withinWindow(match.timeOfDayMs('12:00:00'), from, to), true);
  assert.equal(match.withinWindow(match.timeOfDayMs('22:00:00'), from, to), false,
    'a non-wrapping window written with OR instead of AND would let this through');
});

test('R5: a row whose tc carries no date cannot answer a date filter', () => {
  assert.equal(match.carriesDate('21:57:22'), false);
  assert.equal(match.carriesDate('2019-07-12 21:57:22'), true);
  assert.equal(match.dateOf('2019-07-12 21:57:22'), '2019-07-12');
  assert.equal(match.dateOf('21:57:22'), null);

  const d = dimensions.DIMENSION.date;
  const value = { from: '2019-01-01', to: '2019-12-31' };
  assert.equal(match.matchesDimension(d, value, { tc: '2019-07-12 21:57:22' }), true);
  assert.equal(match.matchesDimension(d, value, { tc: '21:57:22' }), false,
    'excluded rather than guessed at');
});

test('R5: the excluded rows are counted, not silently dropped', () => {
  const rows = [
    { tc: '2019-07-12 21:57:22' }, { tc: '2019-08-01 10:00:00' },
    { tc: '21:57:22' }, { tc: '1.00:15:33' }, { tc: null },
  ];
  const filtered = { date: { from: '2019-01-01', to: '2019-12-31' } };
  assert.equal(match.unanswerable(filtered, rows), 3,
    'three rows have no date and the reviewer has to be told');
  assert.equal(match.unanswerable({ date: null }, rows), 0,
    'nothing is excluded when the dimension is not filtering');
});

test('R3: time of day works on every observation, dated or not', () => {
  const d = dimensions.DIMENSION.timeOfDay;
  const night = { from: '22:00', to: '02:00' };
  assert.equal(match.matchesDimension(d, night, { tc: '22:30:00' }), true);
  assert.equal(match.matchesDimension(d, night, { tc: '1.00:15:33' }), true,
    'no date needed -- which is the whole reason this is its own dimension');
});

test('R8: an empty selection means the dimension is not filtering', () => {
  const d = dimensions.DIMENSION.project;
  assert.equal(match.matchesDimension(d, [], { project_name: 'anything' }), true);
  assert.equal(match.matchesDimension(d, null, { project_name: 'anything' }), true);
  assert.equal(match.matchesDimension(d, ['A'], { project_name: 'B' }), false);
});

test('R2: confidence filters on both ends', () => {
  const d = dimensions.DIMENSION.confidence;
  const mid = { from: 0.5, to: 0.8 };
  assert.equal(match.matchesDimension(d, mid, { confidence: 0.62 }), true);
  assert.equal(match.matchesDimension(d, mid, { confidence: 0.95 }), false,
    'the upper end is what minConfidence could never express');
  assert.equal(match.matchesDimension(d, mid, { confidence: 0.5 }), true, 'inclusive');
});

test('R6: several values of one dimension are an OR', () => {
  const d = dimensions.DIMENSION.dive;
  const chosen = ['D04', 'D06'];
  assert.equal(match.matchesDimension(d, chosen, { dive: 'D04' }), true);
  assert.equal(match.matchesDimension(d, chosen, { dive: 'D06' }), true);
  assert.equal(match.matchesDimension(d, chosen, { dive: 'D05' }), false);
});

test('the rail groups by the question each dimension answers', () => {
  const groups = dimensions.dimensionGroups();
  assert.ok(groups.length >= 3, 'ten dropdowns in one column is a list, not a rail');
  const total = groups.reduce((n, g) => n + g.dimensions.length, 0);
  assert.equal(total, dimensions.DIMENSIONS.length, 'every dimension lands in a group');
});

test('dependents are found through the whole chain', () => {
  assert.deepEqual(dimensions.dependentsOf('project').sort(), ['dive', 'line']);
  assert.deepEqual(dimensions.dependentsOf('dive'), ['line']);
  assert.deepEqual(dimensions.dependentsOf('species'), []);
});

test('every dimension records where its data really comes from', () => {
  /* The prototype exists to find out what the schema has to become, so a dimension that
     does not say where its field comes from is a finding nobody wrote down. Two of these
     currently point at nothing in the real schema, and that is the output of the work
     rather than an oversight -- see the audit on #68. */
  for (const d of dimensions.DIMENSIONS) {
    assert.ok(d.source, `${d.key} must say where its data comes from`);
  }
  assert.match(dimensions.DIMENSION.model.source, /NOTHING YET/,
    'the missing link from an observation to its model is the point, and must stay visible');
});

/* ---------------------------------------------------------------- the fixture */

const fixture = () => JSON.parse(
  readFileSync(new URL('../../fixtures/observations.json', import.meta.url), 'utf8'));

/**
 * #81 D1. The fixture invented `ROV` and `Drop Cam`, which are platforms and are not in
 * the `session_type` column at all, so the session-type filter was exercised against
 * values that do not exist. The real five are below, inconsistent casing included --
 * `Fish_GULF` beside `INVERTS_GULF` is what the database holds, and a fixture that spells
 * them more neatly tests a query nobody will ever run.
 */
test('D1: the fixture uses the session types the database really holds', () => {
  const seen = [...new Set(fixture().observations.map((r) => r.session_type))].sort();
  assert.deepEqual(seen,
    ['Fish', 'Fish_GULF', 'Habitat', 'INVERTS_GULF', 'Inverts'],
    'these are the five values, spelled the way the column spells them');
});

test('D1: a session has one type, because sessions.type is one column on one row', () => {
  const types = new Map();
  for (const r of fixture().observations) {
    const had = types.get(r.session_id);
    if (had && had !== r.session_type) {
      assert.fail(`session ${r.session_id} carries both ${had} and ${r.session_type}`);
    }
    types.set(r.session_id, r.session_type);
  }
  /* And why it matters: L2 says the type narrows which sessions are available, which is
     only true if the two are correlated at all. Rolled per observation, they were not. */
  assert.ok(new Set(types.values()).size > 1, 'more than one type across the sessions');
});
