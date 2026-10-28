/**
 * The Workers detail names the card, the driver and CUDA the machine sent.
 *
 * It read *GPU — · Driver / CUDA ? / ?* beside a row naming an RTX 4080 SUPER, because it
 * looked for `capabilities.gpu`, `.driver` and `.cuda` -- keys no worker sends. The row
 * had been moved onto `cuda_devices`; the panel under it never was.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/* `capabilities` trimmed from ABYSS-fba6be1a on 0.1.17, as `GET /gpu/workers` returns it. */
const worker = {
  worker_id: 5,
  name: 'rig-01',
  state: 'online',
  activity: 'idle',
  slot_count: 4,
  worker_version: '0.1.17',
  capabilities: {
    slots: 4,
    cuda_devices: [{ name: 'NVIDIA GeForce RTX 4080 SUPER', index: 0, total_memory_bytes: 17170956288 }],
    resources: {
      nvidia: { driver_version: '610.88', device_count: 1, devices: [] },
      torch: { cuda_version: '12.8', cuda_available: true },
    },
  },
  enrolled_at: '2026-09-10T00:00:00.000Z',
  last_seen_at: new Date().toISOString(),
  attempts: [],
};

test('the worker detail reads the GPU, driver and CUDA from what the worker sends', async (t) => {
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  t.after(screen.close);

  const head = screen.document.querySelector('table#workers tbody tr[data-worker="5"]');
  assert.ok(head, 'the worker drew');

  const detail = head.nextElementSibling.textContent.replace(/\s+/g, ' ');
  assert.match(detail, /GPU ?NVIDIA GeForce RTX 4080 SUPER/, 'the card, in full');
  assert.match(detail, /Driver \/ CUDA ?610\.88 \/ 12\.8/, 'the driver and CUDA it reported');
});
