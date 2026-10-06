/* The video page's box editing rules (#181): the annotation GUI's controls. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toScreen, toRecord, hitTest, dragged, keyframeShown, menuFor, withEdit, trackKey, MINIMUM_SIZE
} from '../../src/model/box-edit.js';
import { boxesAt } from '../../src/model/video-boxes.js';

const AREA = { left: 100, top: 0, width: 800, height: 450 };
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a record box goes to the screen and back unchanged', () => {
  const box = { x: 0.25, y: 0.5, width: 0.1, height: 0.2 };
  const rect = toScreen(box, AREA);
  assert.deepEqual(rect, { left: 260, top: 180, width: 80, height: 90 });
  const back = toRecord(rect, AREA);
  for (const key of Object.keys(box)) assert.ok(near(back[key], box[key]), key);
});

test('a press lands on the topmost box, and on the selected box\'s grips before any body', () => {
  const rects = [
    { key: 'a', rect: { left: 0, top: 0, width: 100, height: 100 } },
    { key: 'b', rect: { left: 50, top: 50, width: 100, height: 100 } }
  ];
  assert.deepEqual(hitTest(rects, { x: 75, y: 75 }, null), { key: 'b', part: 'body' });
  assert.deepEqual(hitTest(rects, { x: 10, y: 10 }, null), { key: 'a', part: 'body' });
  // a's bottom-right grip sits inside b's body; selected, the grip wins.
  assert.deepEqual(hitTest(rects, { x: 98, y: 102 }, 'a'), { key: 'a', part: 'br' });
  assert.deepEqual(hitTest(rects, { x: 98, y: 102 }, null), { key: 'b', part: 'body' });
  assert.equal(hitTest(rects, { x: 400, y: 400 }, 'a'), null);
});

test('on a small box, the grip a press is nearest wins, not the first in reach', () => {
  // 20 by 12: every corner is within reach of a press on any other.
  const rects = [{ key: 'a', rect: { left: 100, top: 100, width: 20, height: 12 } }];
  assert.deepEqual(hitTest(rects, { x: 120, y: 112 }, 'a'), { key: 'a', part: 'br' });
  assert.deepEqual(hitTest(rects, { x: 100, y: 112 }, 'a'), { key: 'a', part: 'bl' });
  assert.deepEqual(hitTest(rects, { x: 120, y: 100 }, 'a'), { key: 'a', part: 'tr' });
});

test('dragging the body moves the box whole and stops at the picture\'s edge', () => {
  const start = { left: 200, top: 100, width: 80, height: 60 };
  assert.deepEqual(dragged(start, 'body', 30, -20, AREA), { left: 230, top: 80, width: 80, height: 60 });
  assert.deepEqual(dragged(start, 'body', -500, -500, AREA), { left: 100, top: 0, width: 80, height: 60 });
});

test('a corner grip moves its corner, holds the opposite one, and stops at the smallest box', () => {
  const start = { left: 200, top: 100, width: 80, height: 60 };
  assert.deepEqual(dragged(start, 'br', 20, 10, AREA), { left: 200, top: 100, width: 100, height: 70 });
  assert.deepEqual(dragged(start, 'tl', 20, 10, AREA), { left: 220, top: 110, width: 60, height: 50 });
  const crushed = dragged(start, 'tr', -500, 500, AREA);
  assert.equal(crushed.left, 200);
  assert.equal(crushed.width, MINIMUM_SIZE);
  assert.equal(crushed.top + crushed.height, 160);
  assert.equal(crushed.height, MINIMUM_SIZE);
});

test('the keyframe on the shown picture is found within half of the video\'s frame', () => {
  // A GUI row at 25 on a 29.97 video: frame 312 is 12.48 s, the nearest picture 12.4791 s.
  const keyframes = [{ keyframe_id: 1, t: 12.48 }, { keyframe_id: 2, t: 12.52 }];
  assert.equal(keyframeShown(keyframes, 12.4791, 29.97).keyframe_id, 1);
  assert.equal(keyframeShown(keyframes, 12.5125, 29.97).keyframe_id, 2);
  assert.equal(keyframeShown(keyframes, 12.60, 29.97), null);
});

test('the menu is the GUI\'s, offering only what applies to the box', () => {
  const actions = (box) => menuFor({ observation_id: 7, subset: '1', t: 3, ...box }).map((item) => item.action);
  assert.deepEqual(actions({ keyframe: null }), ['info', 'pin', 'end', 'back', 'deleteObservation']);
  assert.deepEqual(actions({ keyframe: { keyframe_id: 5, type: 'middle' } }),
    ['info', 'end', 'back', 'deleteObservation', 'deleteKeyframe']);
  assert.deepEqual(actions({ keyframe: { keyframe_id: 5, type: 'end' } }),
    ['info', 'back', 'deleteObservation', 'deleteKeyframe']);
  // A start set as the end would leave the observation with no start.
  assert.deepEqual(actions({ keyframe: { keyframe_id: 5, type: 'start' } }),
    ['info', 'back', 'deleteObservation', 'deleteKeyframe']);
  assert.equal(menuFor({ observation_id: 7, subset: '1', t: 3, keyframe: null })[0].disabled, true);
});

test('an edit\'s answer replaces, removes and adds keyframes in the held windows', () => {
  const held = new Map([
    [0, [{ keyframe_id: 1, t: 5, x: 0.1 }, { keyframe_id: 2, t: 15, x: 0.2 }]],
    [1, [{ keyframe_id: 2, t: 15, x: 0.2 }, { keyframe_id: 3, t: 25, x: 0.3 }]]
  ]);
  const next = withEdit(held, {
    changed: [{ keyframe_id: 2, t: 15, x: 0.9 }, { keyframe_id: 4, t: 18, x: 0.4 }],
    deleted: [3]
  });
  assert.deepEqual(next.get(0).map((k) => [k.keyframe_id, k.x]), [[1, 0.1], [2, 0.9], [4, 0.4]]);
  assert.deepEqual(next.get(1).map((k) => [k.keyframe_id, k.x]), [[2, 0.9], [4, 0.4]]);
  // The held map itself is left alone.
  assert.equal(held.get(0)[1].x, 0.2);
});

test('a drawn box carries its track, so an edit knows its subset and keyframes', () => {
  const observation = {
    observation_id: 9,
    comname: 'Rockfish',
    keyframes: [
      { keyframe_id: 1, subset: '2', type: 'start', t: 10, x: 0.2, y: 0.5, width: 0.1, height: 0.1 },
      { keyframe_id: 2, subset: '2', type: 'end', t: 12, x: 0.6, y: 0.5, width: 0.1, height: 0.1 }
    ]
  };
  const [box] = boxesAt([observation], 11);
  assert.equal(box.subset, '2');
  assert.deepEqual(box.keyframes.map((k) => k.keyframe_id), [1, 2]);
  assert.equal(trackKey(box), '9_2');
});
