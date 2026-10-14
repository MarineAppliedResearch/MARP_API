import { test } from 'node:test';
import assert from 'node:assert/strict';

import { observationIdText } from '../../src/model/observation-id.js';

test('#178 R1: an observation id is presented as its exact decimal primary key', () => {
  assert.equal(observationIdText(1729), '1729');
  assert.throws(() => observationIdText('1729'), /integer observation_id/);
  assert.throws(() => observationIdText(17.29), /integer observation_id/);
});
