/**
 * The Workers table's Uptime is how long a machine has checked in without a break.
 *
 * #277. It always read "not reported": the worker's own process uptime was unusable and
 * MARP recorded nothing. `GET /gpu/workers` now carries `up_since`, and the column is now
 * minus that while the machine is online, and a dash when it is not.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const worker = (id, name, state, upSince) => ({
  worker_id: id, name, state, activity: state === 'online' ? 'idle' : state, slot_count: 1,
  worker_version: '0.1.18', capabilities: { slots: 1 }, enrolled_at: '2026-09-10T00:00:00.000Z',
  last_seen_at: state === 'offline' ? '2026-10-21T18:53:31.242Z' : new Date().toISOString(),
  up_since: upSince, attempts: [],
});

test('an online worker shows how long it has been up; an offline one a dash', async (t) => {
  const workers = [
    worker(1, 'ABYSS-fba6be1a', 'online', new Date(Date.now() - (3 * 60 + 25) * 60000).toISOString()),
    worker(2, 'ABYSS', 'offline', '2026-10-21T18:49:00.000Z'),
  ];

  const screen = await drawScreen('workers.html', {
    listWorkers: async () => workers,
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });
  t.after(screen.close);

  const up = (id) => screen.document.querySelector(`#workers tbody tr[data-worker="${id}"] .wup`).textContent.trim();

  assert.equal(up(1), '3h 25m');
  assert.equal(up(2), '—', 'offline has no uptime, rather than a figure from last week');
  for (const cell of screen.document.querySelectorAll('#workers tbody .wup')) {
    assert.doesNotMatch(cell.textContent, /not reported/i, 'the column is measured now');
  }
});
