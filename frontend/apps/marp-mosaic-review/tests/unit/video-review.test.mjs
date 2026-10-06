/**
 * The video page's pure rules (#181): keyframe windows around the playhead, which
 * observations a window needs, and the colour a species is drawn in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WINDOW_SECONDS, windowsAround, windowRange, observationsIn, windowsToDrop, speciesColour
} from '../../src/model/video-review.js';

test('#181: the windows held are the playhead\'s own, the next, and the one before', () => {
  assert.equal(WINDOW_SECONDS, 20);
  assert.deepEqual(windowsAround(267), [13, 14, 12]);
  // At the start there is nothing before.
  assert.deepEqual(windowsAround(5), [0, 1]);
  assert.deepEqual(windowRange(13), { from: 260, to: 280 });
});

test('#181: a window needs every observation whose span reaches into it, even one with no keyframe inside', () => {
  const rows = [
    { observation_id: 3, start_s: 250, end_s: 262 },   // ends inside
    { observation_id: 1, start_s: 100, end_s: 900 },   // spans the whole window
    { observation_id: 2, start_s: 279, end_s: 300 },   // starts inside
    { observation_id: 4, start_s: 280, end_s: 290 },   // starts at the window's end: not in it
    { observation_id: 5, start_s: 200, end_s: 259.9 }  // ends before it
  ];
  assert.deepEqual(observationsIn(rows, { from: 260, to: 280 }), [1, 2, 3]);
});

test('#181: windows the playhead has moved away from are let go', () => {
  assert.deepEqual(windowsToDrop([10, 11, 12, 13, 14], windowsAround(267)), [10, 11]);
});

test('#181: a species is the annotation GUI\'s colour, checked against its own C#', () => {
  // From the GUI's speciesColor, run verbatim in .NET on 2026-10-05.
  assert.equal(speciesColour('Red sea star'), 'rgb(71, 124, 225)');
  assert.equal(speciesColour('Cookie star'), 'rgb(85, 71, 225)');
  assert.equal(speciesColour('Rockfish'), 'rgb(71, 225, 133)');
  assert.equal(speciesColour('  Plumose Anemone '), 'rgb(225, 180, 71)');
  assert.equal(speciesColour('Bat Star'), 'rgb(71, 91, 225)');
  assert.equal(speciesColour('Sunflower star'), 'rgb(155, 71, 225)');
  assert.equal(speciesColour(''), 'rgb(255, 255, 255)');
  assert.equal(speciesColour(null), 'rgb(255, 255, 255)');
});
