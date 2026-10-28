/**
 * A busy worker draws, and one that cannot be drawn does not take the pool with it.
 *
 * Isaac, with an inference run on ABYSS: the Workers tab read only "Could not load the
 * pool (no answer)". The pool had loaded; the live-attempt detail read `progress_done`,
 * `id` and `job_id`, which `GET /gpu/workers` does not send, and the first busy machine
 * threw out of the whole render (#282). Every fixture until now had `attempts: []`.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/* As `GET /gpu/workers` returned ABYSS-fba6be1a on 2026-10-28, trimmed: attempt 19262. */
const attempt = (id, slot, done) => ({
  attempt_id: id,
  state: 'running',
  slot_index: slot,
  lease_epoch: 1,
  lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  last_heartbeat_at: new Date().toISOString(),
  progress: { done, total: 7500, unit: 'frames', phase: 'inferring', elapsed_s: 278.7 },
  job: { job_id: id - 19262 + 21892, kind: 'inference', state: 'leased', batch_id: 'b1' },
});

const worker = (id, name, attempts) => ({
  worker_id: id,
  name,
  state: 'online',
  activity: attempts.length ? 'busy' : 'idle',
  slot_count: 4,
  worker_version: '0.1.17',
  capabilities: { slots: 4, cuda_devices: [{ name: 'NVIDIA GeForce RTX 4080 SUPER', total_memory_bytes: 17170956288 }] },
  enrolled_at: '2026-09-10T00:00:00.000Z',
  last_seen_at: new Date().toISOString(),
  attempts,
});

const draw = (workers) => drawScreen('workers.html', {
  listWorkers: async () => workers,
  listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
  listSessions: async () => [],
});

test('a busy worker draws every job it holds, from the fields the pool sends', async (t) => {
  const screen = await draw([worker(5, 'ABYSS-fba6be1a', [attempt(19262, 0, 4500), attempt(19263, 1, 2670)])]);

  t.after(screen.close);

  const doc = screen.document;
  assert.doesNotMatch(doc.querySelector('table#workers').textContent, /Could not load the pool/);

  const head = doc.querySelector('table#workers tbody tr[data-worker="5"]');
  assert.ok(head, 'the busy worker drew');

  const detail = head.nextElementSibling.textContent.replace(/\s+/g, ' ');
  assert.match(detail, /Live attempts \(2\)/);
  assert.match(detail, /19262 · job 21892/);
  assert.match(detail, /4,500 \/ 7,500 frames · inferring/);
  assert.match(detail, /19263 · job 21893/);
});

test('a worker that cannot be drawn says so, and the rest of the pool still draws', async (t) => {
  // A field that throws when read stands in for any record the row code misreads.
  const misread = { ...attempt(19270, 0, 10), get progress() { throw new Error('unreadable progress'); } };
  const screen = await draw([worker(5, 'broken-rig', [misread]), worker(6, 'rig-02', [])]);

  t.after(screen.close);

  const doc = screen.document;
  assert.doesNotMatch(doc.querySelector('table#workers').textContent, /Could not load the pool/);
  assert.match(doc.querySelector('table#workers').textContent, /Could not draw broken-rig/);
  assert.ok(doc.querySelector('table#workers tbody tr.runrow-head[data-worker="6"]'), 'the other worker drew');
});
