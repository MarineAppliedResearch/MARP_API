import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockLine, positionText, readingOffered, readingBody } from '../../src/model/video-clock.js';

const unset = { recorded_start: null, start_source: null, suggested_start: '2021-06-14T16:40:41.000Z' };
const set = { recorded_start: '2021-06-14T16:40:46.000Z', start_source: 'synced', suggested_start: '2021-06-14T16:40:41.000Z' };

test('#76: a video with no clock says its times are positions, not clock times', () => {
  assert.deepEqual(clockLine(unset), { text: 'No clock set: times are positions in the video', unset: true });
  assert.equal(clockLine(null).unset, true);
});

test('#76: a set clock says when the recording started, in UTC, and how it was learned', () => {
  assert.deepEqual(clockLine(set), { text: 'Recording started 2021-06-14 16:40:46 UTC (read off the picture)', unset: false });
});

test('#76: a position is sent as hh:mm:ss.fff', () => {
  assert.equal(positionText(298.04), '00:04:58.040');
  assert.equal(positionText(7200), '02:00:00.000');
});

test('#76: the box offers the set clock\'s time at the picture, else the file name\'s, else nothing', () => {
  assert.equal(readingOffered(set, 60.4), '2021-06-14T16:41:46.400');
  assert.equal(readingOffered(unset, 60.4), '2021-06-14T16:41:41.400');
  assert.equal(readingOffered({ recorded_start: null, suggested_start: null }, 60.4), '');
});

test('#76: the file name\'s reading left as offered is accepting it; anything else is read off the picture', () => {
  assert.deepEqual(readingBody('2021-06-14T16:41:41.400', 60.4, unset),
    { clock: '2021-06-14T16:41:41.400Z', at_media_position: '00:01:00.400', source: 'file-name' });
  assert.equal(readingBody('2021-06-14T16:41:45', 60.4, unset).source, 'synced');
  // With a clock already set, a reading is always a sync, even if it agrees with the name.
  assert.equal(readingBody('2021-06-14T16:41:41.400', 60.4, set).source, 'synced');
});

test('#76: nothing typed, or nothing a date, is not a reading', () => {
  assert.equal(readingBody('', 60, unset), null);
  assert.equal(readingBody('yesterday', 60, unset), null);
});
