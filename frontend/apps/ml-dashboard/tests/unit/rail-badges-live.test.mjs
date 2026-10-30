/**
 * The menu counts change while the page stays open.
 *
 * #299. Isaac: *"as different items in the dashboard change, for instance, inference goes
 * from 3 to 2 or training starts, the tabs on this menu should update automatically ...
 * right now they only change when you update the page."* `fillRailBadges` ran once, on
 * load. It now runs on the tick every screen keeps.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

test('the menu counts follow MARP without a reload', async (t) => {
  /* What MARP says, which the test changes between ticks. */
  const counts = { failed: 4, inference: 3, training: 0 };
  let failNext = false;

  const listJobs = async (query = {}) => {
    if (failNext) throw Object.assign(new Error('down'), { status: 503 });

    /* The Jobs badge reads the jobs that finished in the last 24 hours (#315). */
    if (query.finished_after) {
      const jobs = Array.from({ length: counts.failed }, (_, i) => ({
        id: 900 + i, kind: 'inference', state: 'failed', finished_at: new Date().toISOString(),
      }));
      return { jobs, total: jobs.length, limit: 500, offset: 0 };
    }

    return { jobs: [], total: counts[query.kind] || 0, limit: 1, offset: 0 };
  };

  const screen = await drawScreen('models.html', { listJobs, listModels: async () => [] });
  t.after(screen.close);

  const badge = (id) => screen.document.querySelector(`[data-nav-badge="${id}"]`);
  const read = () => ['jobs', 'inference', 'training'].map((id) => (badge(id).hidden ? '-' : badge(id).textContent));

  assert.deepEqual(read(), ['4', '3', '-'], 'what the page loaded with');

  /* An inference job finishes and a training run starts. */
  counts.inference = 2;
  counts.training = 1;
  await screen.window.pollScreenNow();

  assert.deepEqual(read(), ['4', '2', '1'], 'Inference 3 to 2, and Training appears, with no reload');

  /* Nothing needs attention any more: a count that drops to zero hides its badge. */
  counts.failed = 0;
  await screen.window.pollScreenNow();

  assert.deepEqual(read(), ['-', '2', '1']);

  /* A read that fails keeps the last counts rather than clearing them. */
  failNext = true;
  await screen.window.pollScreenNow();

  assert.deepEqual(read(), ['-', '2', '1']);
});
