/**
 * The Completed card counts what finished in the range chosen beside it.
 *
 * #284. Isaac: the Inference tab's *Completed today* always counted today, whatever the
 * 1h / 24h / 7d / 30d menu said. It now follows the menu -- its count, its label and the
 * Jobs list it opens -- and the Jobs tab's card follows its own *Job activity* menu.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();

/** One succeeded job finished `hours` ago. */
const finished = (id, kind, hours) => ({
  id, kind, name: `job ${id}`, state: 'succeeded', priority: 0, attempts_made: 1, max_attempts: 3,
  spec: { range: { start_frame: 0, end_frame: 1000 } }, progress_done: null, progress_total: null,
  created_at: ago(hours + 1), updated_at: ago(hours), finished_at: ago(hours),
});

/** Finished half an hour, 5 hours, 3 days and 20 days ago: 1, 2, 3 and 4 in the four ranges. */
const JOBS = (kind) => [finished(1, kind, 0.5), finished(2, kind, 5), finished(3, kind, 72), finished(4, kind, 480)];

/** The API's answer to "finished after", from the jobs above. */
function listJobs(kind) {
  return async (query = {}) => {
    let rows = JOBS(kind);
    if (query.kind && query.kind !== kind) rows = [];
    if (query.finished_after) rows = rows.filter((job) => job.finished_at >= query.finished_after);
    if (query.state) rows = rows.filter((job) => job.state === query.state);
    return { jobs: rows, total: rows.length, limit: query.limit || 50, offset: 0 };
  };
}

const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 20)); };

for (const [page, kind, attr, card] of [
  ['inference.html', 'inference', 'data-inference-range', '.stat[data-state="done"]'],
  ['jobs.html', 'inference', 'data-jobs-range', '.stat[data-job-priority="done"]'],
]) {
  test(`${page}: each range counts the jobs finished in it`, async (t) => {
    const screen = await drawScreen(page, {
      listJobs: listJobs(kind),
      listSessions: async () => [],
      listWorkers: async () => [],
      listModels: async () => [],
    });

    t.after(screen.close);

    const doneCard = () => screen.document.querySelector(card);
    const read = () => [doneCard().querySelector('.stat-lab').textContent, doneCard().querySelector('.stat-num').textContent];

    for (const [range, count, label] of [['1h', '1', 'last hour'], ['24h', '2', 'last 24 hours'], ['7d', '3', 'last 7 days'], ['30d', '4', 'last 30 days']]) {
      screen.document.querySelector(`[${attr}="${range}"]`).click();
      await settle();

      assert.deepEqual(read(), [`Completed, ${label}`, count], `${range}`);
    }

    if (page === 'inference.html') {
      assert.match(doneCard().getAttribute('href'), /window=month&status=done/, 'the link opens the same range on Jobs');
    }
  });
}
