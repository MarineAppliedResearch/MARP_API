/**
 * Retry, move, and the worker controls, on the Jobs and Workers tabs (#319).
 *
 * Settled with Isaac on 2026-11-03: a retried job gets a fresh attempt budget; a queued
 * job's run moves up, down or to the front; a worker can be paused now, drained, resumed
 * or retired; and somebody who cannot change the pool sees the panels without the buttons.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const RUN = '7a1c2a0e-1111-4222-8333-944455556666';
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

const job = (id, state, extra = {}) => ({
  id, batch_id: RUN, kind: 'inference', name: `Piece ${id}`, spec: { range: { start_frame: 0, end_frame: 7500 } },
  state, priority: 0, attempts_made: state === 'queued' ? 0 : 3, max_attempts: 3, workers_used: 0,
  worker_name: null, worker_id: null, created_by: null,
  created_at: '2026-10-28T20:00:00.000Z', updated_at: '2026-10-28T20:00:00.000Z', progress_done: null, progress_total: null,
  ...extra,
});

const ADMIN = { user: { user_id: 1, permissions: ['jobs:read', 'jobs:write'] } };
const READER = { user: { user_id: 2, permissions: ['jobs:read'] } };

test('somebody who may not change jobs sees the rows and none of the controls', async (t) => {
  for (const [me, can] of [[READER, false], [ADMIN, true]]) {
    const screen = await drawScreen('jobs.html', {
      listJobs: async () => ({ jobs: [job(1, 'failed')], total: 1, limit: 500, offset: 0 }),
      whoAmI: async () => me,
    });
    await settle();

    assert.equal(screen.document.body.hasAttribute('data-can-control'), can,
      can ? 'jobs:write shows the controls' : 'without jobs:write they stay hidden');
    assert.ok(screen.document.querySelector('[data-retry-job="1"]').matches('[data-control]'), 'Retry is a control');
    assert.ok(screen.document.querySelector('[data-delete-job="1"]').matches('[data-control]'), 'and so is Delete');
    screen.close();
  }
});

test('a failed job and its run can be retried, a selection from the bulk bar', async (t) => {
  const asked = [];
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs: [job(1, 'failed'), job(2, 'expired'), job(3, 'succeeded')], total: 3, limit: 500, offset: 0 }),
    whoAmI: async () => ADMIN,
    retryJobs: async (which) => {
      asked.push(JSON.stringify(which.ids ? { ids: [...which.ids].sort((a, b) => a - b) } : which));
      return { retried: 1, skipped: [] };
    },
  });
  t.after(screen.close);
  await settle();

  assert.equal(screen.document.querySelector('[data-retry-job="3"]'), null, 'a finished job offers no retry');

  screen.document.querySelector('[data-retry-job="1"]').click();
  await settle();
  screen.document.querySelector(`[data-retry-run="${RUN}"]`).click();
  await settle();

  for (const box of screen.document.querySelectorAll('#jobs tbody .chkbox')) box.checked = true;
  screen.document.querySelector('#bulkRetry').click();
  await settle();

  assert.deepEqual(asked, ['{"ids":[1]}', `{"batch_id":"${RUN}"}`, '{"ids":[1,2,3]}']);
});

test('a queued job offers front, up and down, and asks MARP to move it', async (t) => {
  const asked = [];
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs: [job(4, 'queued'), job(5, 'leased')], total: 2, limit: 500, offset: 0 }),
    whoAmI: async () => ADMIN,
    moveJob: async (id, direction) => { asked.push(`${id}:${direction}`); return { job_id: id, moved: true, position: 1, of: 2 }; },
  });
  t.after(screen.close);
  await settle();

  assert.equal(screen.document.querySelectorAll('[data-move-job="5"]').length, 0, 'a running job has no place to move');
  for (const direction of ['front', 'up', 'down']) {
    screen.document.querySelector(`[data-move-job="4"][data-direction="${direction}"]`).click();
    await settle();
  }

  assert.deepEqual(asked, ['4:front', '4:up', '4:down']);
});

const worker = (id, state, activity = state === 'online' ? 'idle' : state) => ({
  worker_id: id, name: `w${id}`, state, activity, slot_count: 1, attempts: [], capabilities: {},
  worker_version: '0.1.22', enrolled_at: '2026-10-01T00:00:00Z', last_seen_at: new Date().toISOString(),
});

test('a worker offers the controls its state allows, and asks MARP', async (t) => {
  const asked = [];
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(1, 'online'), worker(2, 'paused'), worker(3, 'draining')],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    whoAmI: async () => ADMIN,
    controlWorker: async (id, action) => { asked.push(`${id}:${action}`); return { worker_id: id, state: action }; },
  });
  t.after(screen.close);
  await settle();
  screen.window.confirm = () => true;

  const offered = (id) => [...screen.document.querySelectorAll(`[data-worker-control][data-worker-id="${id}"]`)].map((b) => b.dataset.workerControl);
  assert.deepEqual(offered(1), ['pause', 'drain', 'retire']);
  assert.deepEqual(offered(2), ['resume', 'retire']);
  assert.deepEqual(offered(3), ['resume', 'pause', 'retire']);

  screen.document.querySelector('[data-worker-control="drain"][data-worker-id="1"]').click();
  await settle();
  assert.deepEqual(asked, ['1:drain']);
});

test('a retired worker leaves the list unless asked for', async (t) => {
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(1, 'online'), worker(2, 'retired')],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
  });
  t.after(screen.close);
  await settle();

  const rows = () => [...screen.document.querySelectorAll('#workers tbody tr[data-worker]')].map((row) => row.dataset.worker);
  assert.deepEqual(rows(), ['1']);

  const activity = screen.document.querySelector('select[aria-label="Activity"]');
  activity.value = 'Retired';
  activity.dispatchEvent(new screen.window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(rows(), ['2']);
});
