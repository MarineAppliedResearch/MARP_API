/**
 * A worker's dataset cache on the Workers tab, and clearing it.
 *
 * #320. A worker caches every training dataset it fetches and evicts the least recently
 * used to keep 50 GB of disk free. The Workers tab shows what each machine holds, the disk
 * it is on and the floor it keeps, and a cache can be cleared from there.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const worker = (id, extra = {}) => ({
  worker_id: id,
  name: `jest-${id}`,
  activity: 'idle',
  state: 'online',
  slot_count: 1,
  capabilities: { resources: {} },
  worker_version: '0.1.20',
  attempts: [],
  last_seen_at: new Date().toISOString(),
  enrolled_at: '2026-10-01T10:00:00.000Z',
  dataset_keep_free_bytes: 50e9,
  dataset_keep_free_is_default: true,
  clear_dataset_cache_requested_at: null,
  dataset_cache: null,
  ...extra,
});

const CACHE = {
  bytes: 21_836_452_639,
  partial_bytes: 0,
  entries: [
    { sha256: '36de15ae'.padEnd(64, '0'), bytes: 1_939_871_777, last_used_at: new Date().toISOString(), in_use: true },
    { sha256: 'ec94afff'.padEnd(64, '0'), bytes: 19_896_580_862, last_used_at: '2026-10-29T06:00:00.000Z', in_use: false },
  ],
  disk: { total_bytes: 1_999_210_803_200, free_bytes: 107_000_000_000 },
  keep_free_bytes: 50e9,
};

test('the Workers tab shows what each machine has cached, its disk and its floor', async (t) => {
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(1, { dataset_cache: CACHE }), worker(2)],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
  });
  t.after(screen.close);

  const sections = [...screen.document.querySelectorAll('[data-dataset-cache]')];
  const text = (section) => section.textContent.replace(/\s+/g, ' ');

  assert.equal(sections.length, 2, 'one per worker');
  assert.match(text(sections[0]), /22 GB in 2 datasets/);
  assert.match(text(sections[0]), /107 GB free of 1999 GB/);
  assert.match(text(sections[0]), /Keeps free\s*50 GB \(default\)/);
  assert.match(text(sections[0]), /36de15ae0000 · 1\.9 GB · used .* · in use/);
  assert.match(text(sections[0]), /ec94afff0000 · 20 GB/);

  // A worker before 0.1.20 reports no cache: a dash, never a zero.
  assert.match(text(sections[1]), /Cached\s*—/);
  assert.equal(sections[1].querySelector('[data-clear-dataset-cache]'), null, 'nothing to clear on a machine that reports none');
});

test('Clear cache asks MARP, once confirmed', async (t) => {
  const asked = [];
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(1, { dataset_cache: CACHE })],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    clearWorkerDatasetCache: async (id) => {
      asked.push(id);
      return { worker_id: id, clear_dataset_cache_requested_at: new Date().toISOString() };
    },
  });
  t.after(screen.close);

  screen.window.confirm = () => true;
  const button = screen.document.querySelector('[data-clear-dataset-cache="1"]');
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(asked, [1]);
  assert.equal(button.textContent, 'Clear requested');
  assert.equal(button.disabled, true);
});
