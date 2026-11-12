/**
 * What a habitat stretch's tile caption adds: how long it ran, and what lay with it (#287).
 *
 * Isaac, 2026-11-12: habitat stretches are ordinary Mosaic tiles, and a reviewer judging "is
 * this Rock?" should see at a glance how long it lasted and what else the line recorded
 * meanwhile.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { habitatDetail } from '../../src/model/row.js';

const stretch = (fields) => ({ session_type: 'Habitat', comname: 'Rock', ...fields });

test('a habitat stretch says how long it ran and what lay with it', () => {
  assert.deepEqual(habitatDetail(stretch({ tc: '16:00:30', etc: '16:03:00', habitat_overlaps: ['Cobble'] })),
    { length: '2m 30s', overlaps: ['Cobble'] });
  assert.deepEqual(habitatDetail(stretch({ tc: '16:00:00', etc: '16:03:00', habitat_overlaps: null })),
    { length: '3m', overlaps: [] });
  assert.equal(habitatDetail(stretch({ tc: '19:10:03', etc: '19:10:05' })).length, '2s');
});

test('a stretch across midnight is not negative, and one with no end has no length', () => {
  assert.equal(habitatDetail(stretch({ tc: '23:59:30', etc: '00:01:00' })).length, '1m 30s');
  assert.equal(habitatDetail(stretch({ tc: '16:00:00', etc: null })).length, null);
});

test('anything that is not a habitat stretch adds nothing', () => {
  assert.equal(habitatDetail({ session_type: 'Fish', tc: '16:00:00', etc: '16:01:00' }), null);
  assert.equal(habitatDetail(null), null);
});
