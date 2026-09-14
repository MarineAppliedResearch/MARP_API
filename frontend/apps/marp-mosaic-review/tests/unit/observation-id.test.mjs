import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  copyObservationId,
  observationIdText
} from '../../src/model/observation-id.js';

test('#178 R1: an observation id is presented as its exact decimal primary key', () => {
  assert.equal(observationIdText(1729), '1729');
  assert.throws(() => observationIdText('1729'), /integer observation_id/);
  assert.throws(() => observationIdText(17.29), /integer observation_id/);
});

test('#178 R2: copy writes only the observation id', async () => {
  const writes = [];
  const clipboard = { writeText: async (value) => writes.push(value) };

  await copyObservationId(1729, clipboard);

  assert.deepEqual(writes, ['1729']);
});

test('#178 R2: unavailable and refused clipboard writes are explicit failures', async () => {
  await assert.rejects(copyObservationId(1729, null), /Clipboard access is unavailable/);
  await assert.rejects(
    copyObservationId(1729, { writeText: async () => { throw new Error('denied'); } }),
    /denied/
  );
});
