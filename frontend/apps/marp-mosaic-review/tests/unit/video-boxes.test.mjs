import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesAt, contentRect } from '../../src/model/video-boxes.js';

const box = (t, x, extra = {}) => ({ t, x, y: 0.5, width: 0.1, height: 0.2, subset: '1', ...extra });

const anemone = {
  observation_id: 1,
  comname: 'Fish-eating anemone',
  keyframes: [box(10, 0.2), box(12, 0.6)]
};

test('#181: a box between two keyframes is interpolated, not snapped to either', () => {
  const [drawn] = boxesAt([anemone], 11);
  assert.equal(drawn.observation_id, 1);
  assert.ok(Math.abs(drawn.x - 0.4) < 1e-9);
  assert.equal(drawn.comname, 'Fish-eating anemone');
});

test('#181: a keyframe\'s own time draws its own box', () => {
  assert.equal(boxesAt([anemone], 10)[0].x, 0.2);
  assert.equal(boxesAt([anemone], 12)[0].x, 0.6);
});

test('#181: nothing is drawn outside a track\'s span, where the record says nothing', () => {
  assert.deepEqual(boxesAt([anemone], 9.9), []);
  assert.deepEqual(boxesAt([anemone], 12.1), []);
});

test('#181: every observation spanning the moment is drawn, each on its own track', () => {
  const rockfish = { observation_id: 2, comname: 'Rockfish', keyframes: [box(11, 0.9), box(14, 0.9)] };
  const split = {
    observation_id: 3,
    comname: 'Two subsets',
    keyframes: [box(10, 0.1, { subset: '1' }), box(13, 0.1, { subset: '1' }), box(10.5, 0.3, { subset: '2' })]
  };
  const drawn = boxesAt([anemone, rockfish, split], 11);
  assert.deepEqual(drawn.map((d) => d.observation_id), [1, 2, 3]);
});

test('#181: keyframes out of order are still read in time order', () => {
  const shuffled = { ...anemone, keyframes: [box(12, 0.6), box(10, 0.2)] };
  assert.ok(Math.abs(boxesAt([shuffled], 11)[0].x - 0.4) < 1e-9);
});

test('#181: a letterboxed picture is centred with bars on the long side', () => {
  // A 16:9 frame in a square box: bars top and bottom.
  assert.deepEqual(contentRect(160, 160, 1920, 1080), { left: 0, top: 35, width: 160, height: 90 });
  // In a wide box: bars left and right.
  assert.deepEqual(contentRect(400, 90, 1920, 1080), { left: 120, top: 0, width: 160, height: 90 });
});
