import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MARK_ACCEPT, MARK_EXCEPT } from '../../src/model/modes.js';
import { normalizeRect, intersects, idsInRect, setMarks }
  from '../../src/model/drag-selection.js';

test('drag rectangles normalize in every direction', () => {
  assert.deepEqual(normalizeRect({ x: 40, y: 30 }, { x: 10, y: 5 }), {
    left: 10, top: 5, right: 40, bottom: 30, width: 30, height: 25
  });
});

test('a selection includes every tile it touches, including an edge', () => {
  const selection = { left: 5, top: 5, right: 20, bottom: 20 };
  assert.equal(intersects(selection, { left: 20, top: 10, right: 30, bottom: 30 }), true);
  assert.deepEqual(idsInRect(selection, [
    { id: 1, rect: { left: 0, top: 0, right: 10, bottom: 10 } },
    { id: 2, rect: { left: 20, top: 10, right: 30, bottom: 30 } },
    { id: 3, rect: { left: 21, top: 21, right: 30, bottom: 30 } }
  ]), [1, 2]);
});

test('a drag sets marks without toggling same-kind marks off', () => {
  const original = new Map([
    [1, { kind: MARK_EXCEPT, reason: 'Wrong species', note: 'detail' }],
    [2, { kind: MARK_ACCEPT, reason: null, note: null }]
  ]);
  const excepted = setMarks(original, [1, 2, 3], MARK_EXCEPT);

  assert.deepEqual(excepted.get(1), original.get(1), 'same-kind detail survives');
  assert.deepEqual(excepted.get(2), { kind: MARK_EXCEPT, reason: null, note: null });
  assert.deepEqual(excepted.get(3), { kind: MARK_EXCEPT, reason: null, note: null });
  assert.equal(original.has(3), false, 'the input map is unchanged');

  const repeated = setMarks(excepted, [1, 2, 3], MARK_EXCEPT);
  assert.equal(repeated.size, 3, 'repeating the drag does not unmark anything');
});

test('changing a drag mark kind clears exception-only detail', () => {
  const marks = new Map([[7, {
    kind: MARK_EXCEPT, reason: 'False detection', note: 'review this'
  }]]);
  assert.deepEqual(setMarks(marks, [7], MARK_ACCEPT).get(7), {
    kind: MARK_ACCEPT, reason: null, note: null
  });
});
