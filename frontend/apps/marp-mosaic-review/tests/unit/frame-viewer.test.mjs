import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, fittedWidth, overlayRect } from '../../src/model/frame-viewer.js';

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
