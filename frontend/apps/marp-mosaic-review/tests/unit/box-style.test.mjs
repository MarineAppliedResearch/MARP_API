/* The video page's boxes in the annotation GUI's style (#181, 2026-10-06). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { labelScale, markerFor, identifierText, tabLayout, sharedTabShifts, labelColumns, GUI } from '../../src/model/box-style.js';

test('labels are the GUI\'s size on a 600-pixel picture, and follow the picture within limits', () => {
  assert.equal(labelScale(600), 1);
  assert.equal(labelScale(900), 1.5);
  assert.equal(labelScale(200), 0.7);
  assert.equal(labelScale(4000), 1.6);
});

test('each kind of keyframe has the GUI\'s marker: shape and colour', () => {
  assert.deepEqual(markerFor('start'), { shape: 'right', colour: '#ff6b6b', hollow: false });
  assert.deepEqual(markerFor('middle'), { shape: 'circle', colour: '#6fb1ff', hollow: false });
  assert.deepEqual(markerFor('end'), { shape: 'left', colour: '#ff6b6b', hollow: false });
  assert.deepEqual(markerFor('interpolated'), { shape: 'circle', colour: '#a7ec35', hollow: true });
});

test('the identifier reads as the GUI\'s: obs ID, then database id, then a subset that is not "0"', () => {
  assert.equal(identifierText({ obs_id: 12, observation_id: 5128, subset: '1' }), '12  ·  5128 : 1');
  assert.equal(identifierText({ obs_id: 12, observation_id: 5128, subset: '0' }), '12  ·  5128');
  assert.equal(identifierText({ obs_id: null, observation_id: 5128, subset: null }), '?  ·  5128');
});

test('the species tab sits on the box\'s top left corner and the identifier tab under it, at the GUI\'s offsets', () => {
  const rect = { left: 100, top: 200, width: 80, height: 60 };
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  const at1 = tabLayout(rect, 1, { top: 50, bottom: 40 });
  assert.equal(at1.top.left, 98);
  assert.equal(at1.top.top, 175);
  assert.equal(at1.top.width, 6 + GUI.marker + GUI.markerGap + 50 + 9);
  // The text is centred in its tab, not hung from a baseline.
  close(at1.top.middle, at1.top.top + at1.top.height / 2);
  // The identifier tab ends 22 pixels under the box, as Margin="-2,0,0,-22".
  close(at1.bottom.top + at1.bottom.height, 282);
  close(at1.bottom.middle, at1.bottom.top + at1.bottom.height / 2);

  // Everything grows with the picture.
  const at15 = tabLayout(rect, 1.5, { top: 75, bottom: 60 });
  close(at15.top.top, 200 - 25 * 1.5);
  assert.ok(Math.abs(at15.top.height - at1.top.height * 1.5) < 1e-9);
});

test('#352: boxes drawn in one place lay their labels side by side, so every substrate shows', () => {
  // Three habitat stretches at one moment share the habitat crop's box; a fourth box is elsewhere.
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const shifts = sharedTabShifts([
    { rect: crop, widths: { top: 40, bottom: 30 } },
    { rect: { ...crop }, widths: { top: 50, bottom: 20 } },
    { rect: { left: 10, top: 10, width: 50, height: 50 }, widths: { top: 60, bottom: 60 } },
    { rect: { ...crop, left: 100.2 }, widths: { top: 45, bottom: 25 } },
  ], 1);
  assert.deepEqual(shifts[0], { top: 0, bottom: 0 }, 'the first keeps its place');
  assert.deepEqual(shifts[1], { top: 44, bottom: 34 }, 'the second starts past the first, with a gap');
  assert.deepEqual(shifts[2], { top: 0, bottom: 0 }, 'a box alone is untouched');
  assert.deepEqual(shifts[3], { top: 98, bottom: 58 }, 'the third past both, matched to the pixel');

  // And the shift reaches where the tabs are drawn, top and bottom separately.
  const plain = tabLayout(crop, 1, { top: 40, bottom: 30 });
  const moved = tabLayout(crop, 1, { top: 40, bottom: 30 }, shifts[1]);
  assert.equal(moved.top.left - plain.top.left, 44);
  assert.equal(moved.top.textLeft - plain.top.textLeft, 44);
  assert.equal(moved.bottom.left - plain.bottom.left, 34);
  assert.equal(moved.bottom.textLeft - plain.bottom.textLeft, 34);
});

test('#352: labels sharing a box keep their places when one is selected and drawn on top', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const widths = { top: 40, bottom: 30 };
  // Rock (7), Mud (8), Cobble (9); then Rock selected, so drawn last.
  const before = sharedTabShifts([7, 8, 9].map((id) => ({ id, rect: crop, widths })), 1);
  const after = sharedTabShifts([8, 9, 7].map((id) => ({ id, rect: crop, widths })), 1);
  assert.deepEqual(before.map((s) => s.top), [0, 44, 88]);
  assert.deepEqual(after.map((s) => s.top), [44, 88, 0], 'Rock still first, Mud and Cobble where they were');
});

test('#352: habitat labels go Cobble, Boulder, Sand, Mud, Rock, packed, whatever their ids', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const widths = { top: 40, bottom: 30 };
  const shifts = sharedTabShifts([
    { id: 1, name: 'Rock', rect: crop, widths },
    { id: 2, name: 'Sand', rect: crop, widths },
    { id: 3, name: 'Cobble', rect: crop, widths }
  ], 1);
  assert.deepEqual(shifts.map((s) => s.top), [88, 44, 0], 'Cobble first, then Sand, then Rock; no gap where Boulder would be');
});

test('a habitat label keeps its column while it lasts, from the box\'s left edge: Rock, then Mud and Rock, then Rock (2026-11-23)', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const widths = { top: 40, bottom: 30 };
  // Rock from 0 to 30 s; Mud from 10 to 20 s, under it.
  const columns = labelColumns([
    { id: 7, start: 0, end: 30, widths },
    { id: 8, start: 10, end: 20, widths }
  ], 1);
  const rock = { id: 7, name: 'Rock', rect: crop, widths };
  const mud = { id: 8, name: 'Mud', rect: crop, widths };

  const alone = sharedTabShifts([rock], 1, columns);
  const both = sharedTabShifts([mud, rock], 1, columns);
  const again = sharedTabShifts([rock], 1, columns);
  assert.deepEqual(alone[0], { top: 0, bottom: 0, width: 40 }, 'Rock alone at the box\'s left edge');
  assert.deepEqual(both[1], alone[0], 'Rock does not move when Mud shows, though Mud comes first in the old order');
  assert.deepEqual(both[0], { top: 44, bottom: 44, width: 40 }, 'Mud in the next column');
  assert.deepEqual(again[0], alone[0], 'nor when Mud goes');
});

test('a stretch takes the leftmost column free for its whole life, and one that starts as another ends takes its place', () => {
  const widths = { top: 40, bottom: 30 };
  const { columnOf } = labelColumns([
    { id: 1, start: 0, end: 10, widths },
    { id: 2, start: 5, end: 20, widths },
    { id: 3, start: 10, end: 30, widths },
    { id: 4, start: 15, end: Infinity, widths },
    { id: 5, start: 25, end: 40, widths }
  ], 1);
  // 3 starts as 1 ends: column 0. 4 overlaps 2 and 3: column 2. 5 overlaps 3 and 4 only: column 1.
  assert.deepEqual([...columnOf], [[1, 0], [2, 1], [3, 0], [4, 2], [5, 1]]);
});

test('columns are even, as wide as the widest tab above or below, and each tab is drawn that wide', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const columns = labelColumns([
    { id: 1, start: 0, end: 10, widths: { top: 30, bottom: 70 } },
    { id: 2, start: 0, end: 10, widths: { top: 80, bottom: 20 } }
  ], 1);
  assert.equal(columns.width, 80);
  assert.equal(columns.step, 84);
  const shifts = sharedTabShifts([
    { id: 1, name: 'Mud', rect: crop, widths: { top: 30, bottom: 70 } },
    { id: 2, name: 'Off Bottom', rect: crop, widths: { top: 80, bottom: 20 } }
  ], 1, columns);
  assert.deepEqual(shifts.map((s) => s.top), [0, 84]);
  const plain = tabLayout(crop, 1, { top: 10, bottom: 10 });
  const drawn = tabLayout(crop, 1, { top: 10, bottom: 10 }, shifts[1]);
  assert.equal(drawn.top.width, 80, 'the name tab fills its column');
  assert.equal(drawn.bottom.width, 80, 'and so does the identifier under it');
  assert.equal(drawn.top.left - plain.top.left, 84);
  assert.equal(drawn.bottom.left, drawn.top.left, 'the identifier lines up under its name');
});

test('a box with no column, in the same place or elsewhere, is packed after the columns and left alone', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const widths = { top: 40, bottom: 30 };
  const columns = labelColumns([{ id: 1, start: 0, end: 10, widths }], 1);
  const shifts = sharedTabShifts([
    { id: 1, name: 'Rock', rect: crop, widths },
    { id: 2, name: 'Sea star', rect: crop, widths },
    { id: 3, name: 'Rockfish', rect: { left: 10, top: 10, width: 50, height: 50 }, widths }
  ], 1, columns);
  assert.deepEqual(shifts.map((s) => s.top), [0, 44, 0]);
});

test('#352: boxes a fraction of a pixel apart are one place, so their labels still do not overlap', () => {
  const widths = { top: 40, bottom: 30 };
  const shifts = sharedTabShifts([
    { id: 1, name: 'Mud', rect: { left: 100.49, top: 200, width: 300, height: 150 }, widths },
    { id: 2, name: 'Sand', rect: { left: 100.51, top: 200.4, width: 299.6, height: 150 }, widths },
    { id: 3, name: 'Rock', rect: { left: 140, top: 200, width: 300, height: 150 }, widths }
  ], 1);
  assert.deepEqual(shifts.map((s) => s.top), [44, 0, 0], 'Sand then Mud side by side; a box 40 px over is a place of its own');
});
