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

test('#181: an insecure address is named as the reason video cannot play', async () => {
  const { playbackBlocker } = await import('../../src/model/video-boxes.js');
  assert.match(playbackBlocker({ secureContext: false, hasVideoDecoder: false }), /secure address/);
  assert.match(playbackBlocker({ secureContext: true, hasVideoDecoder: false }), /WebCodecs/);
  assert.equal(playbackBlocker({ secureContext: true, hasVideoDecoder: true }), null);
});

test('#181: a desktop keeps the player cache settings it came with; anything else is held small', async () => {
  const { cacheBudgets } = await import('../../src/model/video-boxes.js');
  assert.equal(cacheBudgets({ desktop: true }), null);
  assert.deepEqual(cacheBudgets({ desktop: false }), { rawGiB: 0.125, decodedGiB: 0.25 });
});

test('#181 a phone opens a 720p transcode; a desktop keeps the original file', async () => {
  const { openingQuality } = await import('../../src/model/video-boxes.js');
  assert.equal(openingQuality({ desktop: true }), null);
  // The name is what the player's quality menu matches on, so it must be one of its tiers.
  assert.deepEqual(openingQuality({ desktop: false }),
    { name: '720p, 4 Mbps', maxStreamingBitrate: 4_000_000, maxWidth: 1280, maxHeight: 720 });
});

test('#181 the picture time is the decoded frame\'s own timestamp when there is one', async () => {
  const { pictureTime } = await import('../../src/model/video-boxes.js');
  // Measured on a transcode ten minutes into 20260611_161158_Fwd: the grid said 600, the
  // frame and the burned-in dive clock said 594.
  assert.equal(pictureTime({ mediaTime: 599.993, rawFrameTime: 594.08 }), 594.08);
  assert.equal(pictureTime({ mediaTime: 12.5, rawFrameTime: NaN }), 12.5);
  assert.equal(pictureTime({ mediaTime: 12.5 }), 12.5);
});


test('#181 the first seek is one frame short of the moment, so the player paints and reports', async () => {
  const { firstSeekTarget } = await import('../../src/model/video-boxes.js');
  assert.ok(Math.abs(firstSeekTarget(267.2, 25) - 267.16) < 1e-9);
  // At the very start there is no frame before it, so it goes one after.
  assert.ok(Math.abs(firstSeekTarget(0.02, 25) - 0.06) < 1e-9);
});

test('#181: a box drawn at 25 on a 29.97 video is drawn on the picture it was made on', async () => {
  const { trackTolerance } = await import('../../src/model/video-boxes.js');
  // Drawn on the picture at 12.5792 s; stored as 25-frame 314, which is 12.56 s -- 19 ms early.
  const added = { observation_id: 1, comname: 'x', keyframes: [{ keyframe_id: 1, subset: '1', type: 'start', t: 12.56, x: 0.5, y: 0.5, width: 0.1, height: 0.1 }] };
  assert.equal(boxesAt([added], 12.5792).length, 0, 'with no tolerance the box vanished');
  assert.equal(boxesAt([added], 12.5792, trackTolerance(29.97)).length, 1);
  // Two pictures away it is not drawn: a start-only observation is one moment.
  assert.equal(boxesAt([added], 12.6459, trackTolerance(29.97)).length, 0);
  // Between keyframes it interpolates as before, and past the last within the tolerance it is the last box.
  const track = { observation_id: 2, comname: 'y', keyframes: [
    { keyframe_id: 2, subset: '1', type: 'start', t: 10, x: 0.2, y: 0.5, width: 0.1, height: 0.1 },
    { keyframe_id: 3, subset: '1', type: 'end', t: 12, x: 0.6, y: 0.5, width: 0.1, height: 0.1 }] };
  assert.ok(Math.abs(boxesAt([track], 11, trackTolerance(29.97))[0].x - 0.4) < 1e-9);
  assert.equal(boxesAt([track], 12.015, trackTolerance(29.97))[0].x, 0.6);
});
