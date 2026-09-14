import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchoredScroll, clampZoom, fittedWidth, fullFrameActionState, overlayRect, pinchZoom, zoomForBox
} from '../../src/model/frame-viewer.js';

test('#176: the centre-origin scientific box becomes a top-left viewer overlay', () => {
  assert.deepEqual(overlayRect({ x: .5, y: .5, width: .2, height: .4 }),
    { left: .4, top: .3, width: .2, height: .4 });
});

test('#176: a box crossing the frame edge remains visible and correctly sized', () => {
  assert.deepEqual(overlayRect({ x: .02, y: .98, width: .1, height: .1 }),
    { left: 0, top: .9, width: .1, height: .1 });
});

test('#176: zoom stays inside the viewer range', () => {
  assert.equal(clampZoom(.5), 1);
  assert.equal(clampZoom(3.5), 3.5);
  assert.equal(clampZoom(20), 8);
});

test('#176 R9: fit keeps landscape and portrait frames wholly in the viewport', () => {
  assert.equal(fittedWidth(1200, 700, 1920, 1080), 1200);
  assert.equal(fittedWidth(1200, 700, 1080, 1920), 393.75);
});

test('#176 R9: a two-finger distance change becomes bounded native pinch zoom', () => {
  assert.equal(pinchZoom(1, 100, 225), 2.25);
  assert.equal(pinchZoom(4, 100, 25), 1);
  assert.equal(pinchZoom(4, 100, 400), 8);
});

test('#176 R9: pinch zoom keeps the image point beneath the finger midpoint', () => {
  assert.deepEqual(anchoredScroll(
    { left: 40, top: 20 },
    { left: -60, top: -30, width: 600, height: 300 },
    { x: 0.5, y: 0.5 },
    { x: 180, y: 90 }
  ), { left: 100, top: 50 });
});

test('#176 R9: zoom to box fills the viewport while retaining context around it', () => {
  const zoom = zoomForBox(
    { x: .5, y: .5, width: .2, height: .4 }, 1200, 600, 1920, 1080
  );
  assert.ok(Math.abs(zoom - 2) < Number.EPSILON * 4);
});

test('#176 R12: a permanent failure cannot offer another extraction attempt', () => {
  assert.deepEqual(fullFrameActionState({
    thumbnail_status: 'ready', full_frame_status: 'failed', full_frame_permanent: true
  }), {
    action: 'request-full-frame', label: 'Full frame unavailable', disabled: true
  });
  assert.equal(fullFrameActionState({
    thumbnail_status: 'ready', full_frame_status: 'failed', full_frame_permanent: false
  }).disabled, false);
});
