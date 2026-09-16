import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPickerPosition, draggedPosition, samePickerPosition }
  from '../../src/model/picker-position.js';

test('#183 R2: pointer travel moves the popup from its original top-left', () => {
  assert.deepEqual(
    draggedPosition({ x: 120, y: 80 }, { x: 150, y: 100 }, { x: 210, y: 135 }),
    { x: 180, y: 115 }
  );
});

test('#183 R3: a popup is clamped at every visible work-area edge', () => {
  const bounds = { left: 20, top: 30, right: 420, bottom: 330 };
  const size = { width: 160, height: 100 };
  assert.deepEqual(clampPickerPosition({ x: -40, y: -60 }, size, bounds), { x: 20, y: 30 });
  assert.deepEqual(clampPickerPosition({ x: 500, y: 400 }, size, bounds), { x: 260, y: 230 });
  assert.deepEqual(clampPickerPosition({ x: 100, y: 90 }, size, bounds), { x: 100, y: 90 });
});

test("#183 R6: an oversized popup starts at the usable area's top-left", () => {
  assert.deepEqual(
    clampPickerPosition(
      { x: 300, y: 300 },
      { width: 500, height: 400 },
      { left: 8, top: 12, right: 408, bottom: 312 }
    ),
    { x: 8, y: 12 }
  );
});

test('#183 R4: remembered coordinates compare without rounding drift', () => {
  assert.equal(samePickerPosition({ x: 12.5, y: 44 }, { x: 12.5, y: 44 }), true);
  assert.equal(samePickerPosition({ x: 12.5, y: 44 }, { x: 13, y: 44 }), false);
  assert.equal(samePickerPosition(null, { x: 13, y: 44 }), false);
});
