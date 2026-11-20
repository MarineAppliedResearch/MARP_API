/* The video page's habitat timeline (#287, R3-R5): the annotation GUI's strip, with review state
   and draggable ends. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  laneOf, colourOf, reviewOf, stripLayout, dragTo, mergesInto, edgeAt
} from '../../src/model/habitat-timeline.js';

/** A stretch as the video read gives one. */
const stretch = (id, comname, start, end, extra = {}) => ({
  observation_id: id, species_id: { Sand: 1, Mud: 2, Rock: 3, Cobble: 4 }[comname] ?? 9, comname,
  start_s: start, end_s: end, open_ended: false, review_decision: null, flag_reason: null, version: 1, ...extra
});

test('R3: each substrate is in the GUI\'s lane and colour; Sand and Mud share one', () => {
  assert.equal(laneOf('Cobble'), 0);
  assert.equal(laneOf('Boulder'), 1);
  assert.equal(laneOf('Sand'), 2);
  assert.equal(laneOf(' mud '), 2, 'whatever its case and spacing');
  assert.equal(laneOf('Rock'), 3);
  assert.equal(laneOf('Off Transect'), 4);
  assert.equal(laneOf('Kelp'), -1);
  assert.equal(colourOf('Sand'), '#f2d45c');
  assert.equal(colourOf('Rock'), '#8b5a2b');
});

test('R3: the lane for anything else is drawn only when something is in it, on top', () => {
  const plain = stripLayout([stretch(1, 'Rock', 0, 5)]);
  assert.deepEqual(plain.rows, [0, 1, 2, 3, 4]);
  assert.equal(plain.bars[0].row, 3);
  const other = stripLayout([stretch(1, 'Rock', 0, 5), stretch(2, 'Kelp', 1, 2)]);
  assert.deepEqual(other.rows, [-1, 0, 1, 2, 3, 4]);
  assert.equal(other.bars.find((b) => b.id === 2).row, 0);
  assert.equal(other.bars.find((b) => b.id === 1).row, 4, 'pushed down one');
});

test('R4: a bar says whether its stretch is reviewed, flagged and why, or not yet', () => {
  const { bars } = stripLayout([
    stretch(1, 'Sand', 0, 5, { review_decision: 'reviewed' }),
    stretch(2, 'Sand', 6, 9, { review_decision: 'flagged', flag_reason: 'Wrong substrate' }),
    stretch(3, 'Sand', 10, 12)
  ]);
  assert.deepEqual(bars.map((b) => b.review), ['reviewed', 'flagged', 'unreviewed']);
  assert.equal(bars[1].reason, 'Wrong substrate');
  assert.equal(reviewOf({}), 'unreviewed');
});

test('R5: a stretch with no end yet is drawn at its start and cannot be dragged', () => {
  const { bars } = stripLayout([stretch(1, 'Sand', 4, NaN, { open_ended: true })]);
  assert.equal(bars[0].start, 4);
  assert.equal(bars[0].end, 4);
  assert.equal(bars[0].draggable, false);
});

test('R5: dragging an end stays inside the video and never past the other end', () => {
  const bar = { start: 10, end: 20 };
  assert.deepEqual(dragTo(bar, 'start', 4, 100), { start: 4, end: 20 });
  assert.deepEqual(dragTo(bar, 'start', -3, 100), { start: 0, end: 20 }, 'not before the video');
  assert.deepEqual(dragTo(bar, 'start', 25, 100), { start: 19, end: 20 }, 'a second short of the end');
  assert.deepEqual(dragTo(bar, 'end', 30, 100), { start: 10, end: 30 });
  assert.deepEqual(dragTo(bar, 'end', 130, 100), { start: 10, end: 100 }, 'not past the video');
  assert.deepEqual(dragTo(bar, 'end', 2, 100), { start: 10, end: 11 });
});

test('A4: a drag into a neighbour of the same substrate merges it, and what that reaches in turn', () => {
  const { bars } = stripLayout([
    stretch(1, 'Sand', 10, 20),
    stretch(2, 'Sand', 25, 30),
    stretch(3, 'Sand', 29, 40),
    stretch(4, 'Mud', 21, 50),
    stretch(5, 'Sand', 60, 70)
  ]);
  const dragged = bars.find((b) => b.id === 1);
  assert.deepEqual(mergesInto(bars, dragged, { start: 10, end: 24 }), [], 'short of it: nothing');
  assert.deepEqual(mergesInto(bars, dragged, { start: 10, end: 26 }), [2, 3],
    'into 2, and 2 overlaps 3, so the grown stretch takes 3 as well');
  assert.ok(!mergesInto(bars, dragged, { start: 10, end: 55 }).includes(4), 'never another substrate');
});

test('A4: a neighbour already overlapped before the drag is not merged by it', () => {
  const { bars } = stripLayout([stretch(1, 'Sand', 10, 20), stretch(2, 'Sand', 18, 22)]);
  assert.deepEqual(mergesInto(bars, bars[0], { start: 10, end: 30 }), []);
});

test('R5: a press near a bar\'s end picks that end up; the middle does not', () => {
  const rect = { left: 100, right: 200 };
  assert.equal(edgeAt(rect, 103, 6), 'start');
  assert.equal(edgeAt(rect, 196, 6), 'end');
  assert.equal(edgeAt(rect, 150, 6), null);
  assert.equal(edgeAt({ left: 100, right: 104 }, 103, 6), 'end', 'a narrow bar is all ends, the nearer one');
});
