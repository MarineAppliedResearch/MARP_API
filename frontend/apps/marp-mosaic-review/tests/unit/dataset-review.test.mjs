/* Reviewing a built dataset (#271): a tile's pictures, and what a commit records about each. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PICTURE_CHECKED, PICTURE_FLAGGED, flaggedFrames, pictureCommit, pictureDecisions, withPicture
} from '../../src/model/dataset-review.js';
import { MODES, statusDimensions } from '../../src/model/modes.js';

const picture = (framenum, decision = null, reason = null) => ({ framenum, decision, reason });
const row = (id, pictures) => ({ observation_id: id, pictures });

test('#271 R3: flagging pictures on a tile marks it, and the mark says which pictures and why', () => {
  const r = row(1, [picture(10), picture(20), picture(30)]);
  let mark = withPicture(r, null, 20, 'Bounding box too loose');

  assert.equal(mark.kind, 'except');
  assert.deepEqual([...mark.pictures], [[20, 'Bounding box too loose']]);

  mark = withPicture(r, mark, 30, 'Occluded');
  assert.deepEqual([...flaggedFrames(r, mark).keys()], [20, 30]);
  assert.equal(withPicture(r, withPicture(r, mark, 30, null), 20, null), null, 'all unflagged, nothing on record: no mark');
});

test('#271 A2: unflagging what the record flags is promoting it again, so the tile is accepted', () => {
  const r = row(1, [picture(10, 'flagged', 'Occluded'), picture(20, 'promoted')]);

  assert.deepEqual([...flaggedFrames(r, { kind: 'except' })], [[10, 'Occluded']], 'a seeded mark means the record\'s flags');
  const mark = withPicture(r, { kind: 'except' }, 10, null);
  assert.equal(mark.kind, 'accept');
  assert.deepEqual(pictureDecisions(r, mark), [{ observation_id: 1, framenum: 10, decision: 'promoted', reason: null }]);
});

test('#271 R4: a commit promotes every picture not flagged, and sends only what changed', () => {
  const r = row(1, [picture(10), picture(20, 'promoted'), picture(30, 'flagged', 'Occluded')]);
  const mark = withPicture(r, { kind: 'except' }, 10, 'Too small');

  assert.deepEqual(pictureDecisions(r, mark), [
    { observation_id: 1, framenum: 10, decision: 'flagged', reason: 'Too small' }
  ], '20 is already promoted and 30 already flagged for that reason');
  assert.deepEqual(pictureDecisions(r, null).map((d) => [d.framenum, d.decision]), [[10, 'promoted'], [30, 'promoted']],
    'unmarked: every picture promoted, the record\'s flag included');
});

test('#271 R4: a dataset commit answers in the page commit\'s shape, a track at a time', () => {
  const flagged = row(1, [picture(10), picture(20)]);
  const clean = row(2, [picture(5)]);
  const taken = row(3, [picture(7, 'promoted')]);
  const marks = new Map([[1, withPicture(flagged, null, 20, 'Occluded')]]);

  const { decisions, result } = pictureCommit([flagged, clean, taken], marks, [3]);

  assert.deepEqual(decisions.map((d) => [d.observation_id, d.framenum, d.decision]),
    [[1, 10, 'promoted'], [1, 20, 'flagged'], [2, 5, 'promoted'], [3, 7, 'withdrawn']]);
  assert.deepEqual(result.flagged, [{ observation_id: 1, outcome: PICTURE_FLAGGED }]);
  assert.deepEqual(result.reviewed, [{ observation_id: 2, outcome: PICTURE_CHECKED }]);
  assert.deepEqual(result.reverted, [{ observation_id: 3, outcome: 'withdrawn' }]);
});

test('#271: Dataset Review flags with its own two reasons and the training ones, and only it offers the Pictures filter', () => {
  assert.deepEqual(MODES.datasetReview.reasons, ['Box off the animal', 'An animal has no box', ...MODES.training.reasons]);
  assert.equal(MODES.datasetReview.marks, PICTURE_FLAGGED);
  assert.equal(MODES.datasetReview.accepts, PICTURE_CHECKED);
  assert.ok(statusDimensions('datasetReview').some((d) => d.key === 'pictureReview' && d.own));
  for (const mode of ['scientific', 'training', 'delete']) {
    assert.ok(!statusDimensions(mode).some((d) => d.key === 'pictureReview'), mode);
  }
});
