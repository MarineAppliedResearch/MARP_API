/* The video page's habitat timeline (#287, R3-R5): the annotation GUI's strip, with review state
   and draggable ends. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  laneOf, colourOf, reviewOf, stripLayout, dragTo, mergesInto, edgeAt,
  wholeView, zoomView, panView, followView, isWhole, stretchMenu, snapToPlayhead, habitatsAt, cutChoice
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

test('R6: zooming keeps the moment under the pointer under the pointer', () => {
  const whole = wholeView(1000);
  const view = zoomView(whole, 1000, 250, 0.5);
  assert.deepEqual(view, { from: 125, to: 625 }, 'half as long, 250 still a quarter of the way along');
  assert.deepEqual(zoomView(view, 1000, 250, 2), whole, 'and back out');
});

test('R6: never closer than ten seconds, never further out than the video, never past its ends', () => {
  assert.equal(zoomView({ from: 100, to: 112 }, 1000, 106, 0.1).to - zoomView({ from: 100, to: 112 }, 1000, 106, 0.1).from, 10);
  assert.deepEqual(zoomView(wholeView(1000), 1000, 500, 4), wholeView(1000));
  assert.deepEqual(zoomView({ from: 0, to: 100 }, 1000, 5, 0.5), { from: 2.5, to: 52.5 });
  assert.deepEqual(zoomView({ from: 900, to: 1000 }, 1000, 1000, 1.5), { from: 850, to: 1000 }, 'held at the end');
  assert.deepEqual(zoomView(wholeView(6), 6, 3, 0.5), wholeView(6), 'a video shorter than the closest zoom stays whole');
});

test('R6: panning moves along and stops at either end of the video', () => {
  assert.deepEqual(panView({ from: 100, to: 200 }, 1000, 50), { from: 150, to: 250 });
  assert.deepEqual(panView({ from: 100, to: 200 }, 1000, -500), { from: 0, to: 100 });
  assert.deepEqual(panView({ from: 100, to: 200 }, 1000, 5000), { from: 900, to: 1000 });
});

test('R7: zoomed in, the strip pages along to keep the playhead in view', () => {
  const view = { from: 100, to: 200 };
  assert.equal(followView(view, 1000, 150), view, 'on screen: left alone');
  assert.deepEqual(followView(view, 1000, 201), { from: 191, to: 291 }, 'played off the end: a tenth in from the left');
  assert.deepEqual(followView(view, 1000, 40), { from: 0, to: 100 }, 'sought back before it: held at the start');
  assert.ok(isWhole(wholeView(500), 500));
  assert.ok(!isWhole(view, 1000));
});

test('#353: a bar\'s menu names the stretch, then goes to its start or its end', () => {
  const [bar] = stripLayout([stretch(1, 'Sand', 12.5, 40.04, { obs_id: 7 })]).bars;
  assert.deepEqual(stretchMenu(bar), [
    { label: '7 · Sand' },
    { label: 'Go to start', t: 12.5 },
    { label: 'Go to end', t: 40.04 }
  ]);
  const [open] = stripLayout([stretch(2, 'Mud', 3, NaN, { open_ended: true })]).bars;
  assert.deepEqual(stretchMenu(open).map((item) => item.label), ['Mud', 'Go to start'], 'no end yet: nowhere to go but the start');
});

test('#355: a dragged end near the playhead lands exactly on it', () => {
  assert.equal(snapToPlayhead(101.3, 101.68, 0.5), 101.68, 'within reach: the playhead');
  assert.equal(snapToPlayhead(99, 101.68, 0.5), 99, 'out of reach: where the pointer is');
  assert.equal(snapToPlayhead(99, NaN, 5), 99, 'no playhead yet: where the pointer is');
});

test('#358: the habitats a moment is in, once each, in the timeline\'s order', () => {
  const stretches = [
    stretch(1, 'Rock', 0, 100), stretch(2, 'Sand', 40, 60), stretch(3, 'Cobble', 50, 55),
    stretch(4, 'Rock', 50, 70), stretch(5, 'Mud', 80, 90), stretch(6, 'Sand', 52, NaN, { open_ended: true })
  ];
  assert.deepEqual(habitatsAt(stretches, 52), ['Cobble', 'Sand', 'Rock'], 'Rock twice is Rock once');
  assert.deepEqual(habitatsAt(stretches, 85), ['Mud', 'Rock']);
  assert.deepEqual(habitatsAt(stretches, 200), []);
  assert.deepEqual(habitatsAt(stretches, NaN), []);
});

test('#360: the selected stretch cuts the one picked second, offered on that one', () => {
  const rows = new Map([[10, { obs_id: 3, comname: 'Rock' }], [20, { obs_id: 9, comname: 'Off Transect' }]]);
  assert.deepEqual(cutChoice({ selectedId: 20, secondId: 10, clickedId: 10, rows }),
    { label: 'Cut 3 · Rock with 9 · Off Transect', target: 10, by: 20 });
  assert.equal(cutChoice({ selectedId: 20, secondId: 10, clickedId: 20, rows }), null, 'not on the cutter');
  assert.equal(cutChoice({ selectedId: 20, secondId: null, clickedId: 10, rows }), null, 'nothing picked second');
  assert.equal(cutChoice({ selectedId: 10, secondId: 10, clickedId: 10, rows }), null, 'not with itself');
});
