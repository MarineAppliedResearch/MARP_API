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
  pendingException, statusDimensions, commitIsDestructive, borrowedTags,
  deleteImpact, commitOutcome, pageState, markedOnPage } from '../../src/model/modes.js';
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
    /* `statusKey` is the dimension the mode *acts on*; `statusDimensions` is what it may
       filter on, and since #89 that is every dimension. The label and the value list live
       on `STATUS_DIMENSIONS` now rather than being copied into each mode. */
    assert.ok(m.statusKey && m.defaultStatus.length, `${id} must act on a status dimension`);
    for (const dim of statusDimensions(id)) {
      assert.ok(dim.label && dim.statuses.length, `${id}/${dim.key} must be drawable`);
    }
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

/* This test used to encode the rule #85 reversed -- that a mode sees only its own
   dimension, on the tile as well as in the marks. What #85 changed is *visibility*, which
   is `borrowedTags` below. `existingState` itself stays mode-scoped on purpose, because
   `page.seedMarks` and `deleteImpact` also ask it: widening it would make a training
   exclusion seed a scientific mark. Rewritten with that reason on 2026-09-08 rather than
   deleted, since the property it protects is now more load-bearing, not less. */
test('the state a record carries for a mode is still read per mode', () => {
  const flagged = row(1, { review_status: 'flagged' });
  assert.equal(existingState('scientific', flagged), 'flagged');
  assert.equal(existingState('training', flagged), null,
    'review status is not what training acts on -- it is drawn as a borrowed tag instead');

  const excluded = row(2, { training_disposition: 'excluded' });
  assert.equal(existingState('training', excluded), 'excluded');
  assert.equal(existingState('scientific', excluded), null);

  assert.equal(existingState('scientific', row(3)), null, 'unreviewed carries no state');
  /* Delete acts on neither dimension, and reads the scientific one for its primary badge. */
  assert.equal(existingState('delete', flagged), 'flagged');
});

/* ---------------------------------------------- every workflow's tags, in every mode */

test('R1: a tag another workflow recorded is carried into every other mode', () => {
  const excluded = row(1, { training_disposition: 'excluded', exclusion_reason: 'Occluded' });
  assert.deepEqual(borrowedTags('scientific', excluded).map((t) => t.value), ['excluded']);
  assert.deepEqual(borrowedTags('delete', excluded).map((t) => t.value), ['excluded']);

  const flagged = row(2, { review_status: 'flagged', flag_reason: 'Duplicate' });
  assert.deepEqual(borrowedTags('training', flagged).map((t) => t.value), ['flagged']);

  const reviewed = row(3, { review_status: 'reviewed' });
  assert.deepEqual(borrowedTags('training', reviewed).map((t) => t.value), ['reviewed']);

  const promoted = row(4, { training_disposition: 'promoted' });
  assert.deepEqual(borrowedTags('scientific', promoted).map((t) => t.value), ['promoted']);
});

test('R1: a tag carries the workflow, the reason and the person for its tooltip', () => {
  const [tag] = borrowedTags('scientific', row(1, {
    training_disposition: 'excluded', exclusion_reason: 'Too small', excluded_by: 'A. Other'
  }));
  assert.equal(tag.key, 'trainingDisposition');
  assert.equal(tag.workflow, 'Training data review');
  assert.equal(tag.reason, 'Too small');
  assert.equal(tag.by, 'A. Other');
});

test('R2: a mode never borrows its own dimension, so no tag can duplicate the badge', () => {
  const flagged = row(1, { review_status: 'flagged' });
  assert.deepEqual(borrowedTags('scientific', flagged), [],
    'scientific already draws its own flag as the primary badge');

  const excluded = row(2, { training_disposition: 'excluded' });
  assert.deepEqual(borrowedTags('training', excluded), []);

  /* Delete's primary badge is the scientific dimension, so that is the one it never
     borrows -- the training one it does. */
  assert.deepEqual(borrowedTags('delete', flagged), []);
});

test('R1: a record that carries nothing lends nothing', () => {
  for (const mode of ['scientific', 'training', 'delete']) {
    assert.deepEqual(borrowedTags(mode, row(1)), [], `${mode} has nothing to borrow`);
  }
});

test('R1: both dimensions decided means the other one is still borrowed, once', () => {
  const both = row(1, { review_status: 'reviewed', training_disposition: 'excluded' });
  assert.deepEqual(borrowedTags('scientific', both).map((t) => t.value), ['excluded']);
  assert.deepEqual(borrowedTags('training', both).map((t) => t.value), ['reviewed']);
  assert.deepEqual(borrowedTags('delete', both).map((t) => t.value), ['excluded']);
});

test('R6: a borrowed tag is not this mode\'s exception, so it cannot seed a mark', () => {
  /* `seedMarks` asks whether the record carries *this mode's* exception. A training
     exclusion must not arrive marked in scientific review, or the next scientific commit
     would flag it. */
  const excluded = row(1, { training_disposition: 'excluded' });
  const isEx = (r) => existingState('scientific', r) === pendingException('scientific');
  const marks = page.seedMarks(new Map(), new Set(), [excluded], isEx);
  assert.equal(marks.size, 0, 'a training exclusion is context in scientific review');
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

test('R4: every mode sends both status dimensions, and drops neither', () => {
  /* The reverse of what this asserted until #89. `queryFilters` used to null out whichever
     dimension the mode did not own, which is what made a borrowed filter impossible: the
     rail could offer it and the query would throw it away. */
  const f = { reviewStatus: ['unreviewed'], trainingDisposition: ['excluded'] };
  assert.deepEqual(filters.queryFilters('scientific', f).trainingDisposition, ['excluded']);
  assert.deepEqual(filters.queryFilters('training', f).reviewStatus, ['unreviewed']);
});

test('R4: a borrowed dimension nobody touched sends nothing at all', () => {
  /* Empty, not `['undecided']`. `data.js` only filters on a status array with a length, so
     an untouched borrowed dimension has to hold nothing rather than hold a default. */
  const opened = filters.defaultStatusFor('scientific', { ...filters.DEFAULT_FILTERS });
  const sent = filters.queryFilters('scientific', opened);
  assert.deepEqual(sent.trainingDisposition, [], 'training must not narrow scientific review');
  assert.deepEqual(sent.reviewStatus, ['unreviewed', 'flagged'], 'its own default still applies');

  const inTraining = filters.defaultStatusFor('training', { ...filters.DEFAULT_FILTERS });
  assert.deepEqual(filters.queryFilters('training', inTraining).reviewStatus, []);
  assert.deepEqual(inTraining.trainingDisposition, ['undecided']);
});

test('R3: the default question carries no training-disposition narrowing', () => {
  /* The whole trap of #89, at the tier that can see it in a millisecond. Under the default
     question the fixture holds 1083 Bat Star observations that are unreviewed or flagged,
     of which 151 are promoted or excluded — so a borrowed dimension arriving at
     `['undecided']` would silently drop 151 rows with nothing on screen saying so. This
     asserts the rule; `render.spec.mjs` asserts the count that follows from it. */
  assert.deepEqual(filters.DEFAULT_FILTERS.trainingDisposition, [],
    'DEFAULT_FILTERS is copied straight into defaultQuery(), with no defaultStatusFor pass');
  assert.deepEqual(filters.DEFAULT_FILTERS.reviewStatus, ['unreviewed', 'flagged']);
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

/* ------------------------- every mode filters on both status dimensions (#89) */

test('R1: every mode filters on both dimensions, its own first', () => {
  assert.deepEqual(statusDimensions('scientific').map((d) => d.key),
    ['reviewStatus', 'trainingDisposition']);
  assert.deepEqual(statusDimensions('training').map((d) => d.key),
    ['trainingDisposition', 'reviewStatus'], 'the mode\'s own dimension leads');
  /* Deleting is irreversible, so anything already on the record is a reason to stop. */
  assert.deepEqual(statusDimensions('delete').map((d) => d.key),
    ['reviewStatus', 'trainingDisposition']);
});

test('R2: a borrowed dimension arrives not filtering; an owned one at its default', () => {
  /* The distinction the whole change turns on. A borrowed dimension carrying the owning
     mode's default would take every promoted and excluded row out of Scientific's view. */
  const own = (mode) => statusDimensions(mode).filter((d) => d.own).map((d) => d.key);
  const borrowed = (mode) => statusDimensions(mode).filter((d) => !d.own);

  assert.deepEqual(own('scientific'), ['reviewStatus']);
  assert.deepEqual(own('training'), ['trainingDisposition']);
  assert.deepEqual(own('delete'), ['reviewStatus', 'trainingDisposition'],
    'Delete owns both, so it has no borrowed dimension');

  assert.deepEqual(borrowed('scientific').map((d) => d.defaults), [[]]);
  assert.deepEqual(borrowed('training').map((d) => d.defaults), [[]]);
  assert.deepEqual(borrowed('delete'), []);

  for (const dim of statusDimensions('scientific')) {
    if (dim.own) assert.ok(dim.defaults.length, `${dim.key} is owned and needs a default`);
  }
});

test('R2: entering a mode gives its own dimension a default and clears the borrowed one', () => {
  const sci = filters.defaultStatusFor('scientific',
    { reviewStatus: ['reviewed'], trainingDisposition: ['promoted'] });
  assert.deepEqual(sci.reviewStatus, ['unreviewed', 'flagged']);
  assert.deepEqual(sci.trainingDisposition, [], 'never the other mode\'s default');

  const tra = filters.defaultStatusFor('training', sci);
  assert.deepEqual(tra.trainingDisposition, ['undecided']);
  assert.deepEqual(tra.reviewStatus, []);
});

test('R4/R8: the query keeps every dimension the reviewer narrowed, in every mode', () => {
  const f = {
    ...filters.DEFAULT_FILTERS,
    reviewStatus: ['flagged'],
    trainingDisposition: ['promoted']
  };
  const sci = filters.queryFilters('scientific', f);
  assert.deepEqual(sci.reviewStatus, ['flagged']);
  assert.deepEqual(sci.trainingDisposition, ['promoted'], 'borrowed, and asked for');

  const tra = filters.queryFilters('training', f);
  assert.deepEqual(tra.reviewStatus, ['flagged']);
  assert.deepEqual(tra.trainingDisposition, ['promoted']);

  const del = filters.queryFilters('delete', f);
  assert.deepEqual(del.reviewStatus, ['flagged'], 'Delete keeps review status');
  assert.deepEqual(del.trainingDisposition, ['promoted'], 'and training disposition');
});

test('R9: filtering on a borrowed dimension changes nothing about the mark or the commit', () => {
  /* The rule #85 named and #89 must not break: seeing — and now narrowing by — another
     workflow's answer must not make it markable or committable from the wrong mode. */
  assert.equal(MODES.scientific.statusKey, 'reviewStatus');
  assert.equal(MODES.training.statusKey, 'trainingDisposition');
  assert.equal(pendingException('scientific'), 'flagged');
  assert.equal(pendingException('training'), 'excluded');
  assert.equal(pendingException('delete'), null);

  /* A row excluded from training seeds no scientific mark, whatever the rail is filtering. */
  const excluded = row(1, { training_disposition: 'excluded' });
  assert.equal(existingState('scientific', excluded), null);
  assert.equal(existingState('training', excluded), 'excluded');
});

test('entering Delete Mode gives both dimensions a default', () => {
  const bare = { ...filters.DEFAULT_FILTERS, reviewStatus: [], trainingDisposition: [] };
  const out = filters.ensureStatusFor('delete', bare);
  assert.ok(out.reviewStatus.length, 'review status falls back');
  assert.ok(out.trainingDisposition.length, 'and so does training disposition');
  /* Its training default shows everything: it is there to inform, not to hide rows. */
  assert.deepEqual(out.trainingDisposition, ['undecided', 'promoted', 'excluded']);
});

test('R6: the collapsed rail badge counts a borrowed dimension only when it narrows', () => {
  const both = { species: ['Bat Star'], project: [], dive: [],
    reviewStatus: ['flagged'], trainingDisposition: ['promoted'] };
  assert.equal(filters.activeFilterCount('delete', both), 3, 'species plus two dimensions');
  assert.equal(filters.activeFilterCount('scientific', both), 3,
    'the borrowed dimension is narrowing, so it counts');

  /* Opening Scientific: the borrowed dimension holds nothing, so the badge is unchanged
     from before #89 — species plus review status. */
  const opened = filters.defaultStatusFor('scientific',
    { species: ['Bat Star'], project: [], dive: [] });
  assert.equal(filters.activeFilterCount('scientific', opened), 2, 'species plus its own');
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

test('markedOnPage counts this page, not the whole session', () => {
  /* `state.marks` spans the session on purpose: a mark made on page one survives paging
     to page four and back. So `marks.size` is never "how many are marked here", and the
     chrome used it for three labels that all said "this page" — including Delete Mode's
     note, which put a cross-page total in front of a permanent deletion. 2026-09-08. */
  const rows = [row(1), row(2), row(3)];
  const marks = new Map([[1, {}], [3, {}], [99, {}], [100, {}]]);   // 99 and 100 elsewhere

  assert.equal(markedOnPage({ rows, marks }), 2,
    'only the marks belonging to rows on this page count');
  assert.equal(markedOnPage({ rows, marks: new Map() }), 0);
  assert.equal(markedOnPage({ rows: [], marks }), 0,
    'a page with no rows has nothing marked on it, whatever the session holds');
});

test('R2: the delete confirmation counts every row the commit will destroy', () => {
  /* Reported 2026-09-06, found when new fixture imagery put a thumbnail-less row near the
     top of a delete page. `deleteImpact` filtered to `thumbnail_status === 'ready'` while
     `commitOutcome` and the commit itself act on everything marked -- so marking two rows
     where one had no picture showed "1 observation" in the dialog and then permanently
     deleted two.

     Deletion is the one irreversible action in this application, and the count on the
     dialog is the only thing standing in front of it. It has to be the number that gets
     destroyed. */
  const rows = [
    { observation_id: 1, thumbnail_status: 'ready',  review_status: 'unreviewed', training_disposition: 'undecided' },
    { observation_id: 2, thumbnail_status: 'failed', review_status: 'unreviewed', training_disposition: 'undecided' },
    { observation_id: 3, thumbnail_status: 'queued', review_status: 'unreviewed', training_disposition: 'undecided' }
  ];
  const marks = new Map([[1, {}], [2, {}]]);

  const impact = deleteImpact({ rows, marks });
  const outcome = commitOutcome({ mode: 'delete', rows, marks });

  assert.equal(impact.count, 2,
    'the dialog must count the marked row that has no imagery, because the commit deletes it');
  assert.equal(impact.count, outcome.deletes,
    'the number on the dialog and the number destroyed are the same number');
});

test('R2: deleteImpact counts every marked row, and agrees with the commit', () => {
  /* This asserted the opposite until 2026-09-06 -- that a marked tile whose thumbnail
     never arrived "is not deleted, so it must not be counted". It is deleted: `data.js`
     skips a row with no picture only when it is *unmarked*, and a marked one falls
     straight through to `row.deleted = true`. The test and `commitCount` agreed with each
     other and both disagreed with what the commit actually destroys, which is the worst
     shape a test can take around an irreversible action. */
  const rows = [
    row(1), row(2), row(3),
    row(4, { thumbnail_status: 'failed' }),
  ];
  const marks = new Map([[1, {}], [2, {}], [4, {}]]);

  const impact = deleteImpact({ rows, marks });
  assert.equal(impact.count, 3, 'the row with no imagery is marked, so it will be deleted');
  assert.equal(impact.count, commitCount({ mode: 'delete', rows, marks }),
    'the dialog must show the number the commit acts on');
  assert.equal(impact.count, commitOutcome({ mode: 'delete', rows, marks }).deletes,
    'and the same number the outcome says will be destroyed');
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

test('B3: a typed time becomes 24-hour, or nothing at all', () => {
  /* The ends of a time window are text fields, because a native time input renders from
     the browser locale and no attribute overrides it. This is where what somebody typed
     becomes a value the filter can use. */
  assert.equal(match.normaliseClock('9:30'), '09:30');
  assert.equal(match.normaliseClock('0930'), '09:30');
  assert.equal(match.normaliseClock('22:00'), '22:00');
  assert.equal(match.normaliseClock(' 07:05 '), '07:05');

  /* Not a time of day: that end is simply not set. Never a filter half-understood, and
     never a 12-hour reading of something written in 24-hour. */
  assert.equal(match.normaliseClock('9:30 PM'), null);
  assert.equal(match.normaliseClock('24:00'), null);
  assert.equal(match.normaliseClock('12:60'), null);
  assert.equal(match.normaliseClock('half nine'), null);
  assert.equal(match.normaliseClock(''), null);
  assert.equal(match.normaliseClock(null), null);
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

test('L1: the rail carries no group headings, and no field nobody reads', () => {
  /* #77 grouped the dimensions under four headings; #81 dropped them. `group` left the
     declaration with them, because a field carried and never read is a trap for whoever
     adds the next dimension and dutifully fills it in. */
  assert.equal(dimensions.dimensionGroups, undefined,
    'dimensionGroups() has no caller and should not exist');
  for (const d of dimensions.DIMENSIONS) {
    assert.equal(d.group, undefined, `${d.key} still declares a group`);
  }
});

test('L2: session type comes before session, and session nests under it', () => {
  const order = dimensions.dimensionKeys();
  assert.ok(order.indexOf('sessionType') < order.indexOf('session'),
    'the type narrows which sessions are available, so it is asked first');
  assert.equal(dimensions.DIMENSION.session.nestsUnder, 'sessionType');
  assert.deepEqual(dimensions.dependentsOf('sessionType'), ['session']);
});

test('L3: there is no processor dimension anywhere', () => {
  /* Querying by who did the annotation does not match how the work is structured. It has
     to leave the declaration rather than be hidden, because the rail, the query, the
     counts and the address all read from here -- a hidden one would still be in the URL. */
  assert.equal(dimensions.DIMENSION.processor, undefined);
  assert.ok(!dimensions.dimensionKeys().includes('processor'));
  assert.ok(!filters.FILTER_KEYS.includes('processor'));
  assert.ok(!Object.keys(filters.DEFAULT_FILTERS).includes('processor'));
});

test('Q1: the model dimension stays, until Phase 3 gives it a column', () => {
  /* #81 left this open rather than settling it. Left in place deliberately, and named
     here so removing it is a decision somebody makes rather than one that drifts in. */
  assert.ok(dimensions.DIMENSION.model, 'the Model filter stays for now');
});

/* ---------------------------------------------------------------- sorting */

test('M1: the field and the direction are independent', () => {
  /* Five fixed pairs meant three of the four fields could be read only one way. Every
     field now offers both, which is eight orders where there were five. */
  for (const s of filters.SORT_FIELDS) {
    for (const dir of filters.SORT_DIRS) {
      assert.ok(filters.isSort(s.field, dir), `${s.field} ${dir} should be offerable`);
    }
  }
  assert.equal(filters.SORT_FIELDS.length * filters.SORT_DIRS.length, 8);
});

test('M1: what is applied reads as both halves, not as one phrase', () => {
  assert.equal(filters.sortLabel({ field: 'confidence', dir: 'asc' }),
    'Confidence ↑ low first');
  assert.equal(filters.sortLabel({ field: 'keyframe_count', dir: 'desc' }),
    'Track length ↓ longest first');

  /* Each field words its own directions, because "longest" says something about a track
     length that "descending" does not. */
  assert.notEqual(filters.sortField({ field: 'keyframe_count' }).desc,
    filters.sortField({ field: 'updatedAt' }).desc);
});

test('M2: a secondary term is applied where the primary ties', () => {
  const sort = { field: 'confidence', dir: 'asc', then: { field: 'keyframe_count', dir: 'desc' } };
  assert.deepEqual(filters.sortTerms(sort), [
    { field: 'confidence', dir: 'asc' },
    { field: 'keyframe_count', dir: 'desc' }
  ]);
  assert.deepEqual(filters.sortTerms({ field: 'confidence', dir: 'asc', then: null }),
    [{ field: 'confidence', dir: 'asc' }]);
});

test('M2: observation_id is never one of the terms', () => {
  /* It is the final word in every comparison and it is appended by whatever does the
     comparing -- not declared as a term, because a term is something a caller can
     reorder or drop, and page membership is query-derived. A comparator that can return
     zero for two different rows means page one holds different observations each visit. */
  const every = [{ field: 'confidence', dir: 'asc', then: null },
                 { field: 'obsID', dir: 'desc', then: { field: 'updatedAt', dir: 'asc' } }];
  for (const sort of every) {
    for (const term of filters.sortTerms(sort)) {
      assert.notEqual(term.field, 'observation_id');
    }
  }
  assert.ok(!filters.SORT_FIELDS.some((s) => s.field === 'observation_id'));
});

test('M2: a secondary that can never be reached is not a term', () => {
  const same = { field: 'confidence', dir: 'asc', then: { field: 'confidence', dir: 'desc' } };
  assert.equal(filters.sortTerms(same).length, 1, 'the same field twice is one comparison');

  const junk = { field: 'confidence', dir: 'asc', then: { field: 'cuteness', dir: 'asc' } };
  assert.equal(filters.sortTerms(junk).length, 1);
});

test('M2: choosing a primary that is already the secondary clears the secondary', () => {
  /* Rather than swapping them. A swap changes an order the reviewer did not ask to
     change, and setting it again is one click. */
  const sort = { field: 'confidence', dir: 'asc', then: { field: 'obsID', dir: 'desc' } };
  assert.equal(filters.withSort(sort, 'obsID', 'asc').then, null);

  /* A primary change that leaves the secondary reachable keeps it. */
  const kept = filters.withSort(sort, 'updatedAt', 'desc');
  assert.deepEqual(kept.then, { field: 'obsID', dir: 'desc' });
});

test('M2: the secondary can be set and cleared on its own', () => {
  const sort = { field: 'confidence', dir: 'asc', then: null };
  const withThen = filters.withSortThen(sort, 'updatedAt', 'desc');
  assert.deepEqual(withThen, { field: 'confidence', dir: 'asc', then: { field: 'updatedAt', dir: 'desc' } });
  assert.equal(filters.withSortThen(withThen, null).then, null);
  assert.equal(filters.withSortThen(withThen, 'confidence', 'asc').then, null,
    'the primary is not offerable as the secondary');
});

test('M2: what is applied names both terms', () => {
  assert.equal(
    filters.sortLabel({ field: 'confidence', dir: 'asc', then: { field: 'keyframe_count', dir: 'desc' } }),
    'Confidence ↑ low first, then Track length ↓ longest first');
  assert.equal(filters.sortLabel({ field: 'confidence', dir: 'asc', then: null }),
    'Confidence ↑ low first');
});

test('M1: a sort nobody could have chosen falls back rather than throwing', () => {
  assert.equal(filters.isSort('cuteness', 'asc'), false);
  assert.equal(filters.isSort('confidence', 'sideways'), false);
  /* The address is edited by hand and truncated by chat clients, so the label has to
     survive nonsense rather than blanking the sub-bar. */
  assert.equal(filters.sortField({ field: 'cuteness' }).field, filters.DEFAULT_SORT.field);
  assert.match(filters.sortLabel({ field: 'cuteness', dir: 'sideways' }), /Confidence/);
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
