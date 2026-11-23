/* The video page's boxes in the annotation GUI's style (#181, 2026-10-06). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { labelScale, markerFor, identifierText, tabLayout, sharedTabShifts, labelSlots, GUI } from '../../src/model/box-style.js';

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

test('a habitat label keeps its slot whichever others are showing: Rock, then Mud and Rock, then Rock (2026-11-23)', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  // The video's stretches: Mud and Rock, each tab 40 wide on top and 30 underneath.
  const slots = labelSlots([
    { name: 'Rock', widths: { top: 40, bottom: 30 } },
    { name: 'Mud', widths: { top: 40, bottom: 30 } },
    { name: 'Rock', widths: { top: 40, bottom: 30 } }
  ], 1);
  const rock = { id: 7, name: 'Rock', rect: crop, widths: { top: 40, bottom: 30 } };
  const mud = { id: 8, name: 'Mud', rect: crop, widths: { top: 40, bottom: 30 } };

  const alone = sharedTabShifts([rock], 1, slots);
  const both = sharedTabShifts([rock, mud], 1, slots);
  const again = sharedTabShifts([rock], 1, slots);
  assert.deepEqual(alone[0], { top: 44, bottom: 44 }, 'Rock alone is in its own slot, past the empty Mud slot');
  assert.deepEqual(both[0], alone[0], 'Rock does not move when Mud shows');
  assert.deepEqual(both[1], { top: 0, bottom: 0 }, 'Mud in its slot');
  assert.deepEqual(again[0], alone[0], 'nor when Mud goes');
});

test('a slot is as wide as its name or the widest identifier, so a long identifier never runs into the next label', () => {
  const slots = labelSlots([
    { name: 'Mud', widths: { top: 30, bottom: 70 } },
    { name: 'Rock', widths: { top: 35, bottom: 20 } },
    { name: 'Off Bottom', widths: { top: 80, bottom: 20 } }
  ], 1);
  // Mud (70 for the widest identifier, then 4), Rock (70, then 4), then anything else by name.
  assert.deepEqual([...slots.at], [['mud', 0], ['rock', 74], ['off bottom', 148]]);
  assert.equal(slots.end, 232);
});

test('a second label of one name in one place, and a box elsewhere, are packed and left alone', () => {
  const crop = { left: 100, top: 200, width: 300, height: 150 };
  const slots = labelSlots([{ name: 'Rock', widths: { top: 40, bottom: 30 } }], 1);
  const widths = { top: 40, bottom: 30 };
  const shifts = sharedTabShifts([
    { id: 1, name: 'Rock', rect: crop, widths },
    { id: 2, name: 'Rock', rect: crop, widths },
    { id: 3, name: 'Rockfish', rect: { left: 10, top: 10, width: 50, height: 50 }, widths }
  ], 1, slots);
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
