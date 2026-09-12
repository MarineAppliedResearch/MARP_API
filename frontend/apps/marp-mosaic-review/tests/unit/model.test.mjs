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

import { MODES, isMode, commitActsOnMarked, commitCount, existingState, reviewerIdFor,
  decidedByMe, pendingException, statusDimensions, commitIsDestructive, borrowedTags,
  deleteImpact, commitOutcome, pageState, markedOnPage,
  retryablePage, markKind, isExcepted, isAccepted, acceptedValue, acceptRefusal,
  selectedRows, selectionOutcome, pendingTakeBack, takenBackRows, takesBack,
  MARK_EXCEPT, MARK_ACCEPT } from '../../src/model/modes.js';
import * as page from '../../src/model/page.js';
import * as filters from '../../src/model/filters.js';
import { resolveKey, hintFor, SHORTCUTS } from '../../src/model/keys.js';
import * as dimensions from '../../src/model/dimensions.js';
import * as match from '../../src/model/match.js';

/**
 * A mosaic row, in the shape the **endpoint** sends.
 *
 * `review_decision` / `training_decision`, and **null for the neutral state** — the
 * absence of a review record. This said `review_status: 'unreviewed'` and
 * `training_disposition: 'undecided'`, which is a column that has not existed since #103
 * carrying a value the endpoint never sends. That is the rule that had leaked out of the
 * fixture and into every test that builds a row: the tests spelled the fixture's private
 * vocabulary, so nothing could tell them the schema disagreed.
 */
const row = (id, over = {}) => ({
  observation_id: id,
  thumbnail_status: 'ready',
  review_decision: null,
  training_decision: null,
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
  const flagged = row(1, { review_decision: 'flagged' });
  assert.equal(existingState('scientific', flagged), 'flagged');
  assert.equal(existingState('training', flagged), null,
    'review status is not what training acts on -- it is drawn as a borrowed tag instead');

  const excluded = row(2, { training_decision: 'excluded' });
  assert.equal(existingState('training', excluded), 'excluded');
  assert.equal(existingState('scientific', excluded), null);

  assert.equal(existingState('scientific', row(3)), null, 'unreviewed carries no state');
  /* Delete acts on neither dimension, and reads the scientific one for its primary badge. */
  assert.equal(existingState('delete', flagged), 'flagged');
});

/* ---------------------------------------------- every workflow's tags, in every mode */

test('R1: a tag another workflow recorded is carried into every other mode', () => {
  const excluded = row(1, { training_decision: 'excluded', exclusion_reason: 'Occluded' });
  assert.deepEqual(borrowedTags('scientific', excluded).map((t) => t.value), ['excluded']);
  assert.deepEqual(borrowedTags('delete', excluded).map((t) => t.value), ['excluded']);

  const flagged = row(2, { review_decision: 'flagged', flag_reason: 'Duplicate' });
  assert.deepEqual(borrowedTags('training', flagged).map((t) => t.value), ['flagged']);

  const reviewed = row(3, { review_decision: 'reviewed' });
  assert.deepEqual(borrowedTags('training', reviewed).map((t) => t.value), ['reviewed']);

  const promoted = row(4, { training_decision: 'promoted' });
  assert.deepEqual(borrowedTags('scientific', promoted).map((t) => t.value), ['promoted']);
});

test('R1: a tag carries the workflow, the reason and the person for its tooltip', () => {
  const [tag] = borrowedTags('scientific', row(1, {
    training_decision: 'excluded', exclusion_reason: 'Too small', training_reviewer_id: 77
  }));
  assert.equal(tag.key, 'trainingDisposition');
  assert.equal(tag.workflow, 'Training data review');
  assert.equal(tag.reason, 'Too small');
  /* An **id**, not a name (A13). This asserted `tag.by === 'A. Other'`, reading
     `excluded_by` -- one of four name columns the mosaic row has never carried, so against
     a real row the attribution was always null and nothing said so (F8). The interface may
     only say whether a decision was the reviewer's own, which is `decidedByMe`. */
  assert.equal(tag.reviewerId, 77);
  assert.equal(tag.by, undefined, 'a name is not offered, deliberately');
});

test('R2: a mode never borrows its own dimension, so no tag can duplicate the badge', () => {
  const flagged = row(1, { review_decision: 'flagged' });
  assert.deepEqual(borrowedTags('scientific', flagged), [],
    'scientific already draws its own flag as the primary badge');

  const excluded = row(2, { training_decision: 'excluded' });
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
  const both = row(1, { review_decision: 'reviewed', training_decision: 'excluded' });
  assert.deepEqual(borrowedTags('scientific', both).map((t) => t.value), ['excluded']);
  assert.deepEqual(borrowedTags('training', both).map((t) => t.value), ['reviewed']);
  assert.deepEqual(borrowedTags('delete', both).map((t) => t.value), ['excluded']);
});

test('R6: a borrowed tag is not this mode\'s exception, so it cannot seed a mark', () => {
  /* `seedMarks` asks whether the record carries *this mode's* exception. A training
     exclusion must not arrive marked in scientific review, or the next scientific commit
     would flag it. */
  const excluded = row(1, { training_decision: 'excluded' });
  const isEx = (r) => existingState('scientific', r) === pendingException('scientific');
  const marks = page.seedMarks(new Map(), new Set(), [excluded], isEx);
  assert.equal(marks.size, 0, 'a training exclusion is context in scientific review');
});

/**
 * A13, and the defect it closes is F8.
 *
 * This was `decidedBy(row)`: the first non-null of `reviewed_by`, `training_approved_by`,
 * `flagged_by` and `excluded_by`. Two things were wrong with it and the test could see
 * neither, because the test built rows carrying those columns:
 *
 * - **the row has never carried any of the four**, so against the endpoint it always
 *   returned null — the "REVIEWED by you" badge, the borrowed tag's attribution and `byMe`
 *   all silently became nothing;
 * - **it was not mode-scoped**, so a training approver could be reported as the scientific
 *   reviewer. `existingState` is mode-scoped for exactly that reason and the two have to
 *   agree about which decision they are describing.
 */
test('who decided is read per mode, as an id (A13)', () => {
  const flagged = row(1, { review_decision: 'flagged', review_reviewer_id: 42 });
  assert.equal(reviewerIdFor('scientific', flagged), 42);
  assert.equal(reviewerIdFor('training', flagged), null,
    'the scientific reviewer is not the training one');

  const excluded = row(2, { training_decision: 'excluded', training_reviewer_id: 7 });
  assert.equal(reviewerIdFor('training', excluded), 7);
  assert.equal(reviewerIdFor('scientific', excluded), null);

  assert.equal(reviewerIdFor('scientific', row(3)), null, 'no decision, nobody');
});

test('"by you" needs both ids, and a missing identity is never a match (A13)', () => {
  const mine = row(1, { review_decision: 'reviewed', review_reviewer_id: 42 });
  const theirs = row(2, { review_decision: 'reviewed', review_reviewer_id: 43 });

  assert.equal(decidedByMe('scientific', mine, { user_id: 42 }), true);
  assert.equal(decidedByMe('scientific', theirs, { user_id: 42 }), false);

  /* The identity arrives from `/api/v2/auth/me` and a page can render before it does. A
     null `me` must read as "not mine" rather than matching a row with no reviewer -- which
     is what a bare `===` between two nulls would have done. */
  assert.equal(decidedByMe('scientific', mine, null), false, 'no identity is not a match');
  assert.equal(decidedByMe('scientific', row(3), { user_id: 42 }), false,
    'and neither is a row with no decision');
});

/* ------------------------------------------------------------------- page */

test('a tap toggles a mark, and a mark starts without a reason', () => {
  let marks = new Map();
  marks = page.toggleMark(marks, 7);
  /* **`kind` moved into this assertion rather than the assertion being loosened** (#126
     R9). A mark now carries which of the two things it means, and the default is the one
     a mark has always had -- so a left click is still the exception. */
  assert.deepEqual(marks.get(7), { kind: 'except', reason: null });
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

/**
 * F5, at the tier that can see it. **A silent one, and the expensive kind.**
 *
 * `applyCommit` did `next.set(r.id, r.outcome)`, and **every entry of
 * `MosaicCommitResult` is keyed `observation_id`** — all five arrays, always. So against
 * the endpoint `r.id` was `undefined`, one map entry was written under `undefined`, and
 * **every tile on a committed page showed no outcome at all**: no error, no log, and a
 * page that looks exactly as though the commit never happened.
 *
 * The rule that leaked: the fixture also said `id`, so this test agreed with the fixture
 * and the fixture agreed with nothing. Both now speak the contract.
 */
test('R8: a commit result folds in by observation_id, never by id or position', () => {
  const out = page.applyCommit(new Map(), {
    reviewed: [{ observation_id: 1, outcome: 'reviewed' }],
    flagged: [{ observation_id: 2, outcome: 'flagged' }],
    skipped: [{ observation_id: 3, reason: 'no-imagery' }],
    conflicted: [{ observation_id: 4, reason: 'version' }]
  });
  assert.equal(out.get(1), 'reviewed');
  assert.equal(out.get(2), 'flagged');
  assert.equal(out.has(3), false, 'a skipped observation has no outcome');
  /* R9: a refused commit is its own state. It means the annotation moved and **nothing was
     written**, which is a different thing from a commit that did nothing. */
  assert.equal(out.get(4), 'conflicted');
  assert.equal(out.has(undefined), false,
    'the old `r.id` read wrote exactly one entry, under the key undefined');
});

test('R9: the ids a commit refused are reported so the page can be re-read', () => {
  assert.deepEqual(page.conflictedIds({
    conflicted: [{ observation_id: 7, reason: 'version' }, { observation_id: 9, reason: 'version' }]
  }), [7, 9]);
  assert.deepEqual(page.conflictedIds({}), []);
  assert.deepEqual(page.conflictedIds(null), []);
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

/**
 * F2, at the tier that can see it. **The one #68 calls the defect that costs an afternoon.**
 *
 * This asserted `out.excludeIds.size === 2` — that is, that a `Set` came out — and a Set is
 * exactly what cannot be sent: `JSON.stringify(new Set([1, 2]))` is `{}`. So the endpoint
 * excluded nothing, every committed page came back among the pages still to do, and
 * nothing failed or logged. The test was asserting the defect.
 *
 * The rule that leaked: `page.pinnedIds()` returns a Set because the cache and the
 * scheduler ask it `.has()` questions, and nothing said where that Set had to stop.
 */
test('R4: pinned observations leave as an array of integers, never a Set', () => {
  const out = filters.queryFilters('scientific', {}, { excludeIds: new Set([2, 1]) });
  assert.deepEqual(out.excludeIds, [1, 2], 'an array, and sorted so one body is one body');

  /* The assertion that actually matters: what reaches the wire. `deepEqual` on the object
     passes for a Set too, and that is how this went unnoticed. */
  assert.deepEqual(JSON.parse(JSON.stringify(out)).excludeIds, [1, 2]);

  assert.equal(
    filters.queryFilters('scientific', {}, { excludeIds: new Set() }).excludeIds, undefined,
    'nothing pinned sends no field at all');
});

test('R4: the exclusion list takes a Set or an array, and drops anything else', () => {
  assert.deepEqual(filters.excludeIdList(new Set([3, 1, 2])), [1, 2, 3]);
  assert.deepEqual(filters.excludeIdList([3, 1, 2]), [1, 2, 3]);
  assert.deepEqual(filters.excludeIdList(null), []);
  assert.deepEqual(filters.excludeIdList(undefined), []);
  assert.deepEqual(filters.excludeIdList('nonsense'), [],
    'a string has a length and an iterator, so it would otherwise become 8 ids');
  assert.deepEqual(filters.excludeIdList([1, 'two', 3]), [1, 3],
    'the endpoint takes integers and refuses a name');
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
    row(1, { review_decision: 'flagged', flag_reason: 'Duplicate' }),
    row(2, { training_decision: 'excluded', exclusion_reason: 'Occluded' }),
    row(3, { review_decision: 'reviewed' })
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
  const rows = [row(1, { review_decision: 'flagged' }), row(2)];
  const isEx = (r) => existingState('scientific', r) === pendingException('scientific');
  const marks = page.seedMarks(new Map(), new Set(), rows, isEx);
  assert.equal(commitCount({ mode: 'scientific', rows, marks }), 1, 'only the unflagged one');
});

test('a decision made by hand is never seeded back', () => {
  const rows = [row(1, { review_decision: 'flagged' })];
  const isEx = (r) => existingState('scientific', r) === pendingException('scientific');
  assert.equal(page.seedMarks(new Map(), new Set([1]), rows, isEx).size, 0);
});

test('delete mode has no pending exception, so it seeds nothing', () => {
  assert.equal(pendingException('delete'), null);
  assert.equal(pendingException('scientific'), 'flagged');
  assert.equal(pendingException('training'), 'excluded');
});

/* --------------------------------------- a committed page stays editable */

/* Keyed `observation_id`, which is what `MosaicCommitResult` has always used. `id` here
   was the fixture's word, and it is the whole of F5. */
const commitResult = {
  reviewed: [{ observation_id: 2, outcome: 'reviewed' }, { observation_id: 3, outcome: 'reviewed' }],
  flagged: [{ observation_id: 1, outcome: 'flagged' }],
  skipped: [], reverted: [], conflicted: []
};

test('R9: a conflicted tile keeps whatever mark it had, because nothing was written', () => {
  const outcomes = page.applyCommit(new Map(), {
    flagged: [{ observation_id: 1, outcome: 'flagged' }],
    conflicted: [{ observation_id: 2, reason: 'version' }, { observation_id: 3, reason: 'version' }]
  });
  const marks = page.marksAfterCommit(
    new Map([[1, { reason: 'Duplicate' }], [2, { reason: 'Occluded' }]]),
    outcomes, [1, 2, 3], pendingException('scientific'));

  assert.deepEqual([...marks.keys()].sort(), [1, 2]);
  assert.equal(marks.get(2).reason, 'Occluded',
    'the decision the commit refused is still pending, reason and all');
  assert.equal(marks.has(3), false,
    'an unmarked conflicted tile stays unmarked: "accept this" is not an exception');
});

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
  const outcomes = page.applyCommit(new Map(), { reviewed: [{ observation_id: 1, outcome: 'deleted' }] });
  assert.equal(page.marksAfterCommit(new Map(), outcomes, [1], pendingException('delete')).size, 0);
});

/**
 * R1 (#138): destroyed is a rule, not a condition written into a click handler.
 *
 * The outcome map is the source because it has exactly the lifetime of the DELETED badge
 * the tile already draws from it -- so "inert" and "DELETED" are one fact rather than two
 * that can disagree. Both backings put the same word there: the fixture pushes
 * `outcome: 'deleted'` and so does `commitDelete`, through `out.accept(id, mode.marks)`.
 */
test('R1: an observation a commit destroyed is destroyed, and nothing else is', () => {
  const outcomes = page.applyCommit(new Map(), {
    reviewed: [{ observation_id: 1, outcome: 'deleted' }, { observation_id: 2, outcome: 'reviewed' }],
    flagged: [{ observation_id: 3, outcome: 'flagged' }],
    conflicted: [{ observation_id: 4, reason: 'version' }]
  });
  assert.equal(page.isDestroyed(outcomes, 1), true);
  assert.equal(page.isDestroyed(outcomes, 2), false, 'accepted is not destroyed');
  assert.equal(page.isDestroyed(outcomes, 3), false, 'flagged is not destroyed');
  /* A conflicted delete destroyed nothing: the row moved underneath the reviewer and the
     statement matched no version, so the observation is still there to act on (R9). */
  assert.equal(page.isDestroyed(outcomes, 4), false);
  assert.equal(page.isDestroyed(outcomes, 99), false, 'an id no commit touched');
  assert.equal(page.isDestroyed(new Map(), 1), false, 'nothing committed yet');
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
  const excluded = row(1, { training_decision: 'excluded' });
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
    { observation_id: 1, thumbnail_status: 'ready',  review_decision: 'unreviewed', training_decision: 'undecided' },
    { observation_id: 2, thumbnail_status: 'failed', review_decision: 'unreviewed', training_decision: 'undecided' },
    { observation_id: 3, thumbnail_status: 'queued', review_decision: 'unreviewed', training_decision: 'undecided' }
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
    row(1, { review_decision: 'reviewed' }),
    row(2, { review_decision: 'flagged' }),
    row(3, { training_decision: 'promoted' }),
    row(4, { training_decision: 'excluded' }),
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

/**
 * A17: the `date` range compares `tc` as **a point in time**, not as a date.
 *
 * Answered by the human — *"if there is no date, it'll just default to the time. And if
 * there is a date, then the date will also work."* The old assertions were the other
 * reading, comparing `dateOf(tc)` against `YYYY-MM-DD` bounds: no `tc` carries a date, so
 * the filter answered zero rows always, which is why the endpoint refused it outright
 * rather than serving it.
 *
 * `carriesDate` and `dateOf` are still correct functions and are still tested below; what
 * changed is that they no longer drive this dimension.
 */
test('A17: a date range reads the recorded time, inclusive, and does not wrap', () => {
  const d = dimensions.DIMENSION.date;
  const value = { from: '09:00', to: '17:00' };

  assert.equal(match.matchesDimension(d, value, { tc: '12:00:00' }), true);
  assert.equal(match.matchesDimension(d, value, { tc: '09:00:00' }), true, 'inclusive');
  assert.equal(match.matchesDimension(d, value, { tc: '17:00:00' }), true, 'both ends');
  assert.equal(match.matchesDimension(d, value, { tc: '22:00:00' }), false);

  /* The whole difference from `timeOfDay`, which is a window and *does* wrap. A range
     written with the wrapping rule would turn an empty question into a night. */
  const backwards = { from: '22:00', to: '02:00' };
  assert.equal(match.matchesDimension(d, backwards, { tc: '23:00:00' }), false,
    'a range does not wrap, however the window beside it behaves');
  assert.equal(
    match.withinWindow(match.timeOfDayMs('23:00:00'),
      match.clockMs('22:00'), match.clockMs('02:00')),
    true, 'and the window does, which is why they are two controls');
});

test('A17: a row whose tc carries no readable clock cannot answer, and is counted', () => {
  const d = dimensions.DIMENSION.date;
  const value = { from: '09:00', to: '17:00' };
  assert.equal(match.matchesDimension(d, value, { tc: null }), false,
    'excluded rather than guessed at');
  assert.equal(match.matchesDimension(d, value, { tc: 'not a time' }), false);

  /* #76 built this reporting so a date filter could never silently omit, and until A17 it
     had nothing to report -- the filter was refused. A number the reviewer can see is the
     difference between a filter and a lie. */
  const rows = [
    { tc: '12:00:00' }, { tc: '1.10:00:00' },
    { tc: null }, { tc: '' }, { tc: 'nonsense' },
  ];
  assert.equal(match.unanswerable(value ? { date: value } : {}, rows), 3,
    'three rows carry no readable clock and the reviewer has to be told');
  assert.equal(match.unanswerable({ date: null }, rows), 0,
    'nothing is excluded when the dimension is not filtering');
});

test('the date helpers still read a date out of a tc that has one', () => {
  /* Kept, because #76 will need them the moment an observation carries a date. They just
     do not decide what the `date` dimension compares any more. */
  assert.equal(match.carriesDate('21:57:22'), false);
  assert.equal(match.carriesDate('2019-07-12 21:57:22'), true);
  assert.equal(match.dateOf('2019-07-12 21:57:22'), '2019-07-12');
  assert.equal(match.dateOf('21:57:22'), null);
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
  /**
   * A14, corrected: **`model` was never unbacked.**
   *
   * This asserted that `model.source` still said `NOTHING YET`, and that claim was true
   * when Phase 3 was written and is stale: the endpoint's filter is
   * `observations.ml_model_id` and the GPU pipeline populates the column. What the control
   * really had was the same defect as `species` — a name sent where an integer key is
   * taken — so the assertion was pinning a finding that had already been resolved, and an
   * earlier draft of Phase 8's spec read it as grounds to delete a working control.
   *
   * The property worth keeping is the one above: every dimension says where its data comes
   * from. So this now asserts that the three key-valued dimensions name a real column,
   * which is what would have caught the staleness.
   */
  for (const key of ['species', 'model', 'session']) {
    assert.match(dimensions.DIMENSION[key].source, /^observations\./,
      `${key} filters on a column of observations, as an integer key`);
    assert.equal(dimensions.DIMENSION[key].numeric, true,
      `${key} takes an integer id, and the endpoint refuses a name outright`);
  }
});

/**
 * F1, at the tier that can see it. **The field, not the source comment.**
 *
 * `field` is what `matchesFilters` compares and what the request builder sends, so it is
 * the thing that was wrong: `species` declared `comname`, and the endpoint's filter is
 * `observations.species_id` "and only species_id" -- because it finds the organism, where
 * `comname` finds rows whose label text matches a name that may since have moved. A name
 * in that field is not a filter that returns slightly different rows; it is a 400.
 */
test('F1: the three key-valued dimensions filter on their id column', () => {
  assert.equal(dimensions.DIMENSION.species.field, 'species_id');
  assert.equal(dimensions.DIMENSION.model.field, 'ml_model_id');
  assert.equal(dimensions.DIMENSION.session.field, 'session_id');

  /* And the default question opens on a key, not on the name `'Bat Star'` -- which the
     endpoint rejects outright and which matched nothing in this database anyway. */
  for (const value of filters.DEFAULT_FILTERS.species) {
    assert.equal(Number.isInteger(value), true,
      'the default species is a key; a name here is a 400 on the first page load');
  }
});

/**
 * F11: `permanent` is a state the client had code for and no data had ever reached.
 *
 * `src/data.js:494` short-circuited a retry on `current.thumbnail_permanent`, and **no row
 * has ever carried the key** -- one grep hit, in the file reading it. The endpoint does not
 * put it on a page either: it answers `permanent: true` per *retry* entry and refuses
 * rather than re-queueing. So the client learns it from an answer and keeps it on the row
 * it is holding, and this asserts the rule the interface reads.
 */
test('F11: a permanently failed tile is not offered a retry, and says why', () => {
  const reason = 'The observation has no keyframes, so it has no bounding box.';
  const rows = [
    row(1, { thumbnail_status: 'failed' }),
    row(2, { thumbnail_status: 'failed', thumbnail_permanent: true, thumbnail_reason: reason })
  ];

  /* The rule the store calls, not a copy of it written out here -- a filter duplicated in
     the test is a test that agrees with itself. */
  assert.deepEqual(retryablePage(rows), [1],
    'asking again for a picture that can never exist is a way to hammer a media server');
  assert.deepEqual(retryablePage([]), []);
  assert.deepEqual(retryablePage([row(3)]), [], 'a ready tile is not retried either');

  /* And it is still a page with no imagery, so the page state does not change: the
     observations are there and still flaggable, which is a separate rule. */
  assert.equal(pageState({ rows, loading: false, total: 2 }), 'no-imagery');
  assert.equal(rows[1].thumbnail_reason, reason, 'the reason is the API answer, not something the client invented');
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


/* =========================================================== #126: two kinds of mark
 *
 * The rules behind "left click marks the exception, right click marks accepted, and the
 * main button commits only what was marked". Every one of these is a rule in `model/`,
 * which is the tier that can see meaning; what gets *drawn* is `render.spec.mjs` and what
 * reaches the wire is `api-requests.test.mjs`.
 */

/** A mark of a given kind, written the way the store writes one. */
const mark = (kind = MARK_EXCEPT, reason = null) => ({ kind, reason });

test('R1: a left click marks the exception, which is what a mark has always meant', () => {
  const marks = page.toggleMark(new Map(), 7);
  assert.equal(markKind(marks.get(7)), MARK_EXCEPT);
  assert.equal(isExcepted(marks, 7), true);
  assert.equal(isAccepted(marks, 7), false);
});

test('R2: a right click marks accepted, in every mode that has an accepted value', () => {
  const marks = page.toggleMark(new Map(), 7, MARK_ACCEPT);
  assert.equal(markKind(marks.get(7)), MARK_ACCEPT);
  assert.equal(isAccepted(marks, 7), true);
  assert.equal(isExcepted(marks, 7), false);

  assert.equal(acceptedValue('scientific'), 'reviewed');
  assert.equal(acceptedValue('training'), 'promoted');
});

test('A2: delete has no accepted value, so an accept mark has nothing to mean there', () => {
  assert.equal(acceptedValue('delete'), null);
  /* Inert rather than refused: there is nothing to tell the reviewer, because nothing
     about the gesture was wrong -- this mode simply records no acceptance. */
  assert.deepEqual(acceptRefusal('delete', row(1)), { ok: false, reason: null });
});

test('R7: a tile marked one way and then the other ends with the later mark', () => {
  let marks = page.toggleMark(new Map(), 7);                  // left: exception
  marks = page.toggleMark(marks, 7, MARK_ACCEPT);             // right: accepted
  assert.equal(markKind(marks.get(7)), MARK_ACCEPT, 'the later mark wins');

  marks = page.toggleMark(marks, 7);                          // left again
  assert.equal(markKind(marks.get(7)), MARK_EXCEPT, 'and wins the other way too');
});

test('R7: the same gesture twice takes the mark off, for both kinds', () => {
  let marks = page.toggleMark(new Map(), 7, MARK_ACCEPT);
  marks = page.toggleMark(marks, 7, MARK_ACCEPT);
  assert.equal(marks.has(7), false);

  marks = page.toggleMark(new Map(), 7);
  marks = page.toggleMark(marks, 7);
  assert.equal(marks.has(7), false);
});

test('R7: switching kind drops the reason, because a reason says what is wrong', () => {
  let marks = page.toggleMark(new Map(), 7);
  marks = page.setReason(marks, 7, 'Duplicate');
  assert.equal(marks.get(7).reason, 'Duplicate');

  marks = page.toggleMark(marks, 7, MARK_ACCEPT);
  assert.equal(marks.get(7).reason, null,
    'carrying it across would put "Duplicate" on a record saying the observation is right');
});

test('a reason cannot be set on an accept mark', () => {
  const marks = page.setReason(new Map([[7, mark(MARK_ACCEPT)]]), 7, 'Duplicate');
  assert.equal(marks.get(7).reason, null);
  /* The endpoint refuses one too, so a client that could set it would build a 400. */
});

test('marking all on the page overwrites an accept mark, because it is the later gesture', () => {
  const rows = [row(1), row(2)];
  const marks = page.markAll(new Map([[1, mark(MARK_ACCEPT)]]), rows);
  assert.equal(markKind(marks.get(1)), MARK_EXCEPT);
  assert.equal(markKind(marks.get(2)), MARK_EXCEPT);
});

test('marking all leaves an exception mark alone, so its reason survives', () => {
  const marks = page.markAll(new Map([[1, mark(MARK_EXCEPT, 'Duplicate')]]), [row(1)]);
  assert.equal(marks.get(1).reason, 'Duplicate');
});

test('A3: a seeded mark is an exception, and nothing ever seeds an acceptance', () => {
  const flagged = row(1, { review_decision: 'flagged', flag_reason: 'Duplicate' });
  const marks = page.seedMarks(new Map(), new Set(), [flagged],
    (r) => existingState('scientific', r) === 'flagged');
  assert.equal(markKind(marks.get(1)), MARK_EXCEPT);
  assert.equal(marks.get(1).reason, 'Duplicate');
});

/* --------------------------------------------------- A4: accepting needs imagery */

test('A4: an accept mark is refused on a tile with no picture, and the tile says why', () => {
  const blind = row(1, { thumbnail_status: 'failed' });
  const refusal = acceptRefusal('scientific', blind);
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /No picture/,
    'a refusal with nothing to say would be a click that appeared to do nothing');
  assert.match(refusal.reason, /reviewed/, 'and it names what it would have recorded');
});

test('A4: a queued thumbnail is not a picture either', () => {
  assert.equal(acceptRefusal('training', row(1, { thumbnail_status: 'queued' })).ok, false);
});

test('A4: an exception mark needs no picture, which is the older rule and still holds', () => {
  /* Flagging a tile nobody could see is exactly what "No imagery" is a flag reason for. */
  const blind = row(1, { thumbnail_status: 'failed' });
  const marks = page.toggleMark(new Map(), 1);
  assert.equal(commitOutcome({ mode: 'scientific', rows: [blind], marks }).flags, 1);
});

test('A4: a tile with a picture may be accepted', () => {
  assert.deepEqual(acceptRefusal('scientific', row(1)), { ok: true, reason: null });
});

/* ------------------------------------ R4: the sweep does exactly what it did before */

test('R4: the sweep accepts an accept-marked tile, exactly as it accepts an untouched one', () => {
  const rows = [row(1), row(2), row(3)];
  const marks = new Map([[1, mark(MARK_ACCEPT)], [2, mark(MARK_EXCEPT)]]);

  const outcome = commitOutcome({ mode: 'scientific', rows, marks });
  assert.equal(outcome.flags, 1, 'only the exception is flagged');
  assert.equal(outcome.accepts, 2, 'the accept mark and the untouched tile');
  assert.equal(outcome.skips, 0);
  assert.equal(commitCount({ mode: 'scientific', rows, marks }), 2);
});

test('R4: before #126 every mark was the exception, so a kindless mark still flags', () => {
  /* The compatibility this rests on: `{ reason: null }` with no kind is what the client
     wrote for months, and it has to keep meaning what it meant. */
  const rows = [row(1), row(2)];
  const marks = new Map([[1, { reason: null }]]);
  assert.equal(commitOutcome({ mode: 'scientific', rows, marks }).flags, 1);
});

/* --------------------------------------------- R3: the main button, and only the marked */

test('R3: the main button sends only what is marked', () => {
  const rows = [row(1), row(2), row(3)];
  const marks = new Map([[1, mark(MARK_EXCEPT)], [3, mark(MARK_ACCEPT)]]);
  const touched = new Set([1, 3]);

  assert.deepEqual(selectedRows({ rows, marks, touched }).map((r) => r.observation_id), [1, 3]);

  const outcome = selectionOutcome({ mode: 'scientific', rows, marks, touched });
  assert.equal(outcome.acts, 2);
  assert.equal(outcome.flags, 1);
  assert.equal(outcome.accepts, 1);
  assert.equal(outcome.skips, 0);
});

test('R3: a tile nobody marked is not in the main button count, whatever the record says', () => {
  const rows = [row(1), row(2, { review_decision: 'reviewed' })];
  const outcome = selectionOutcome({
    mode: 'scientific', rows, marks: new Map(), touched: new Set()
  });
  assert.equal(outcome.acts, 0, 'and the button is therefore disabled');
});

test('A3: the main button ignores a seeded mark the reviewer never touched', () => {
  /**
   * The rule the whole assumption turns on. A page arrives with the record's flags already
   * marked, because the human asked to see it that way -- so without the `touched` filter,
   * pressing this button on a freshly loaded page re-commits flags nobody touched, under
   * this reviewer's name and today's date. `observation_reviews` carries a reviewer per
   * row, so that is the record asserting a decision that was never made.
   */
  const flagged = row(1, { review_decision: 'flagged', flag_reason: 'Duplicate' });
  const rows = [flagged, row(2)];
  const marks = page.seedMarks(new Map(), new Set(), rows,
    (r) => existingState('scientific', r) === 'flagged');

  assert.equal(marks.size, 1, 'the page does arrive looking pre-marked');
  assert.equal(selectedRows({ rows, marks, touched: new Set() }).length, 0,
    'and the main button still has nothing to do');

  /* Touch it -- take the flag off and put it back, say -- and it is the reviewer's. */
  const touched = new Set([1]);
  assert.deepEqual(
    selectedRows({ rows, marks, touched }).map((r) => r.observation_id), [1]);
});

test('#135 R3: clicking a mark off makes the main button withdraw it', () => {
  const flagged = row(1, { review_decision: 'flagged' });
  const rows = [flagged];
  /**
   * **This reverses #126's R7**, which said the main button left a take-back alone. It
   * was the only button that could express one and it ignored it, so the only way to undo
   * a decision was the gesture that also decides every other tile on the page.
   *
   * Unmarking and pressing *Commit Marked* withdraws: the reviewer decided nothing about
   * this observation and the record says so.
   */
  const outcome = selectionOutcome({
    mode: 'scientific', rows, marks: new Map(), touched: new Set([1]),
    takenBack: new Set([1])
  });
  assert.equal(outcome.acts, 1, 'the button has something to do');
  assert.equal(outcome.withdraws, 1, 'and it is a withdrawal, not an acceptance');
  assert.equal(outcome.accepts, 0);
});

test('#135 R7: the sweep withdraws a take-back rather than deciding it again', () => {
  /**
   * **This line used to say the opposite**, and it is the correction of 2026-09-12 rather
   * than a new rule beside an old one. It asserted that "the sweep is unchanged and still
   * accepts it", on A2's first answer -- that the two buttons meant different things by
   * the same gesture, deliberately. They do not: *"if it's already been committed and it
   * shows that it's flagged, then you take it back... then if you hit commit it again, it
   * should be in the vanilla state for that mode."* Whichever commit that is.
   *
   * The sweep's own rule is untouched. Everything merely *unmarked* is still accepted --
   * see the test below, which is the same page with an empty `takenBack`. Only an explicit
   * take-back is withdrawn, and `state.takenBack` is the only thing that tells them apart.
   */
  const flagged = row(1, { review_decision: 'flagged' });
  const rows = [flagged];

  const swept = commitOutcome({
    mode: 'scientific', rows, marks: new Map(), takenBack: new Set([1])
  });
  assert.equal(swept.withdraws, 1, 'the sweep withdraws it');
  assert.equal(swept.accepts, 0, 'and does not accept it');
  assert.equal(swept.acts, 1, 'it is still one act, so the button is not disabled');

  /* The same page with nothing taken back: an unmarked tile is an acceptance, as ever. */
  const plain = commitOutcome({ mode: 'scientific', rows, marks: new Map() });
  assert.equal(plain.accepts, 1, 'a merely unmarked tile is still swept into an acceptance');
  assert.equal(plain.withdraws, 0);
});

test('#135 R7: a take-back with no imagery is withdrawn rather than skipped', () => {
  /* A withdrawal removes a decision instead of making one, so it needs no picture -- the
     rule that an acceptance does (R12) has nothing to say about it, and the endpoint agrees:
     its `withdraw` branch runs before the imagery check. */
  const flagged = row(1, { review_decision: 'flagged', thumbnail_status: 'failed' });
  const swept = commitOutcome({
    mode: 'scientific', rows: [flagged], marks: new Map(), takenBack: new Set([1])
  });
  assert.equal(swept.withdraws, 1);
  assert.equal(swept.skips, 0, 'it is not skipped for having no imagery');
});

/* ------------------------------------------------------- taking a decision back (#135) */

test('#135 R2: taking back a promotion this sitting recorded is a take-back', () => {
  /**
   * The defect, at the tier that decides it. Right click promotes, *Commit Marked*
   * records it, and clicking again takes the mark off -- and the derivation asked only
   * about the mode's *exception*, so it answered nothing at all. The tile went on drawing
   * PROMOTED from its own outcome and the click looked as though it had done nothing.
   */
  const promoted = row(1, { training_decision: null });
  /* The store records it when the accept mark comes off a tile the record says is
     promoted -- `takesBack` is that rule -- and this is what the tile then draws. */
  assert.equal(takesBack({ mode: 'training', kind: MARK_ACCEPT, decided: 'promoted' }), true);
  const takeBack = pendingTakeBack({
    mode: 'training', row: promoted, marks: new Map(), takenBack: new Set([1]),
    outcomes: new Map([[1, 'promoted']])
  });
  assert.equal(takeBack, 'promoted', 'and it names what is being taken back');
});

test('#135: taking a flag off a tile the sweep accepted is not a take-back', () => {
  /**
   * The case that made this recorded rather than derived, and it is a real sequence: flag
   * a tile, sweep the page, click the flag off, sweep again. The second sweep **accepts**
   * it, and the reviewer has decided nothing about that acceptance -- but the tile is then
   * unmarked, touched and carrying `reviewed`, which is indistinguishable from a promotion
   * whose accept mark has just been removed. Derived, it read as a take-back and the tile
   * said TAKING BACK for the rest of the sitting.
   *
   * The kind that came off is what separates them, and only the store sees it.
   */
  assert.equal(takesBack({ mode: 'scientific', kind: MARK_EXCEPT, decided: 'reviewed' }), false,
    'a flag coming off is not withdrawing an acceptance');
  assert.equal(takesBack({ mode: 'scientific', kind: MARK_ACCEPT, decided: 'reviewed' }), true,
    'the accept mark coming off is');
});

test('#135 R2: it is the accepted value in scientific mode too, not only training', () => {
  /* A1, answered 2026-09-12: both modes. An acceptance is `reviewed` here and `promoted`
     there, and a rule with one mode excepted is a rule nobody can predict. */
  const seen = row(1);
  assert.equal(takesBack({ mode: 'scientific', kind: MARK_ACCEPT, decided: 'reviewed' }), true);
  assert.equal(pendingTakeBack({
    mode: 'scientific', row: seen, marks: new Map(), takenBack: new Set([1]),
    outcomes: new Map([[1, 'reviewed']])
  }), 'reviewed');
});

test('#135 R2: taking back an exception still derives, which is the older half', () => {
  const flagged = row(1, { review_decision: 'flagged' });
  assert.equal(takesBack({ mode: 'scientific', kind: MARK_EXCEPT, decided: 'flagged' }), true);
  assert.equal(pendingTakeBack({
    mode: 'scientific', row: flagged, marks: new Map(), takenBack: new Set([1])
  }), 'flagged', 'from the record, where this sitting has no outcome for it');
});

test('#135 R4: a committed withdrawal stops being a take-back', () => {
  /* The outcome outranks the row's own column (#131), which is what makes this true
     against the endpoint: it never writes that column back, so the row still says
     `promoted` for the rest of the sitting. */
  const stale = row(1, { training_decision: 'promoted' });
  /* The commit empties the take-back, because the withdrawal is on the record now. */
  assert.equal(pendingTakeBack({
    mode: 'training', row: stale, marks: new Map(), takenBack: new Set(),
    outcomes: new Map([[1, 'withdrawn']])
  }), null, 'the label goes, in the page as well as in the database');
});

test('#135: a mark outranks it, and an untouched tile is not taking anything back', () => {
  const promoted = row(1, { training_decision: 'promoted' });
  assert.equal(pendingTakeBack({
    mode: 'training', row: promoted, marks: new Map([[1, mark(MARK_ACCEPT)]]),
    takenBack: new Set([1])
  }), null, 'a mark is newer than anything it could be taking back');
  assert.equal(pendingTakeBack({
    mode: 'training', row: promoted, marks: new Map(), takenBack: new Set()
  }), null, 'and nobody has taken this one back');
});

test('#135: Delete Mode takes nothing back, because it records no decision', () => {
  /* Both halves are null there -- no accepted value, and a destroyed row is not a pending
     intention -- so a `null === null` comparison must not make every touched tile in
     Delete read as a take-back. */
  assert.equal(takesBack({ mode: 'delete', kind: MARK_EXCEPT, decided: 'flagged' }), false);
  assert.equal(takesBack({ mode: 'delete', kind: MARK_ACCEPT, decided: 'deleted' }), false);
});

test('#135 R3: the take-backs are their own list, and the marks are not in it', () => {
  const rows = [row(1, { training_decision: 'promoted' }), row(2)];
  const marks = new Map([[2, mark(MARK_ACCEPT)]]);
  const touched = new Set([1, 2]);
  assert.deepEqual(
    takenBackRows({ mode: 'training', rows, marks, takenBack: new Set([1]) })
      .map((r) => r.observation_id),
    [1], 'the marked one is committed as a mark, not withdrawn');
  assert.deepEqual(
    selectedRows({ rows, marks, touched }).map((r) => r.observation_id), [2]);
});

test('#135 R5: the button counts a take-back, or it is disabled and unreachable', () => {
  /* This is the whole of step 3 being unreachable: `selectedRows` needs a mark, so an
     unmarked take-back was not in what the button would send and the button was disabled
     with nothing to do. */
  const rows = [row(1)];
  const outcome = selectionOutcome({
    mode: 'training', rows, marks: new Map(), touched: new Set([1]),
    takenBack: new Set([1]), outcomes: new Map([[1, 'promoted']])
  });
  assert.equal(outcome.withdraws, 1);
  assert.equal(outcome.acts, 1, 'so the button is enabled and says what it will do');
});

test('#135 R4: applyCommit folds a withdrawal, which appears in no other array', () => {
  /* `reverted` was deliberately not read, on the grounds that its entries duplicate
     `flagged`. That is true of the one that co-occurs and false of a withdrawal, so the
     outcome went on saying `promoted` after the promotion had been taken off the record. */
  const outcomes = page.applyCommit(new Map([[1, 'promoted']]), {
    reviewed: [], flagged: [],
    reverted: [{ observation_id: 1, outcome: 'withdrawn' }]
  });
  assert.equal(outcomes.get(1), 'withdrawn');
});

test('#135 R4: a revert that co-occurs with a flag still lands on the flag', () => {
  /* The endpoint reports an acceptance replaced by an exception in **both** arrays, with
     the same value in each -- so folding `reverted` after `flagged` changes nothing here.
     The arrays are not a partition, which is the thing that makes the order matter. */
  const outcomes = page.applyCommit(new Map(), {
    reviewed: [],
    flagged: [{ observation_id: 1, outcome: 'flagged' }],
    reverted: [{ observation_id: 1, outcome: 'flagged' }]
  });
  assert.equal(outcomes.get(1), 'flagged');
});

test('A4: the main button cannot be asked to accept a tile with no picture', () => {
  /* Refused at click time, so this can only be reached by building the state by hand --
     which is worth doing, because it is the rule the endpoint enforces at the other end. */
  const blind = row(1, { thumbnail_status: 'failed' });
  const outcome = selectionOutcome({
    mode: 'scientific',
    rows: [blind],
    marks: new Map([[1, mark(MARK_ACCEPT)]]),
    touched: new Set([1])
  });
  assert.equal(outcome.acts, 0, 'nothing to do');
  assert.equal(outcome.skips, 1, 'and it is counted as the skip it would be');
});

/* --------------------------------------------------- what stays marked afterwards */

test('an accept mark survives the commit that honoured it, so the gesture keeps its meaning', () => {
  const outcomes = new Map([[1, 'reviewed'], [2, 'flagged']]);
  const marks = page.marksAfterCommit(
    new Map([[1, mark(MARK_ACCEPT)], [2, mark(MARK_EXCEPT, 'Duplicate')]]),
    outcomes, [1, 2], 'flagged', 'reviewed');

  assert.equal(markKind(marks.get(1)), MARK_ACCEPT);
  assert.equal(markKind(marks.get(2)), MARK_EXCEPT);
  assert.equal(marks.get(2).reason, 'Duplicate');
});

test('a selective commit leaves every mark it did not send exactly where it was', () => {
  /**
   * The difference between the two, and the reason there are two. A page arrives
   * pre-marked; the reviewer marks one more tile and commits only that. Rebuilding the
   * page's marks from the sent ids -- which is what the sweep does, correctly -- would
   * drop every seeded mark on the page, and the record's flags would vanish off the
   * screen without anything being written.
   */
  const marks = new Map([
    [1, mark(MARK_EXCEPT, 'Duplicate')],           // seeded, not sent
    [2, mark(MARK_ACCEPT)]                         // marked by hand, sent
  ]);
  const outcomes = new Map([[2, 'reviewed']]);

  const after = page.marksAfterSelection(marks, outcomes, [2], 'flagged', 'reviewed');
  assert.equal(after.has(1), true, 'the seeded mark is still there');
  assert.equal(after.get(1).reason, 'Duplicate');
  assert.equal(markKind(after.get(2)), MARK_ACCEPT);
});

test('a selective commit drops a mark the record refused to take', () => {
  /* Skipped for no imagery: nothing was written, and nothing on the page should go on
     claiming it was. A conflicted one is the opposite case and keeps its mark. */
  const marks = new Map([[1, mark(MARK_ACCEPT)], [2, mark(MARK_EXCEPT)]]);
  const outcomes = new Map([[2, 'conflicted']]);

  const after = page.marksAfterSelection(marks, outcomes, [1, 2], 'flagged', 'reviewed');
  assert.equal(after.has(1), false, 'skipped, so the mark goes');
  assert.equal(after.has(2), true, 'conflicted, so nothing was written and it stays');
});

test('delete keeps nothing marked, selective or not', () => {
  const outcomes = new Map([[1, 'deleted']]);
  assert.equal(
    page.marksAfterCommit(new Map([[1, mark()]]), outcomes, [1], pendingException('delete')).size,
    0);
});

/* ------------------------------------------------------------- the two counts */

test('the two kinds are counted separately, so neither number is a lie', () => {
  const rows = [row(1), row(2), row(3)];
  const marks = new Map([[1, mark(MARK_EXCEPT)], [2, mark(MARK_ACCEPT)]]);

  assert.equal(markedOnPage({ rows, marks }), 2, 'both, as every caller meant before');
  assert.equal(markedOnPage({ rows, marks, kind: MARK_EXCEPT }), 1);
  assert.equal(markedOnPage({ rows, marks, kind: MARK_ACCEPT }), 1);
});
