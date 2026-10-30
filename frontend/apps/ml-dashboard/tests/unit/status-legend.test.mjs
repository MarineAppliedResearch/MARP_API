/**
 * Every entry in a status legend has a dot, coloured as its segment of the ring.
 *
 * #298. Isaac, on the Inference tab: *"the legend doesn't have a color dot for running, or
 * for needs attention"*. A legend dot takes its colour from its class, and the Inference
 * and Training legends named two entries `running` and `failed` -- classes `screens.css`
 * gives no colour -- while the ring beside them used `inference`/`training` and
 * `attention`. So the ring drew those segments and the legend could not say which they
 * were.
 *
 * jsdom does not apply the stylesheet, so this reads it: each legend entry's class must
 * be its ring segment's class, and `screens.css` must colour that class in both.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drawScreen, APP } from './screen.mjs';

const CSS = readFileSync(join(APP, 'screens.css'), 'utf8');
const at = new Date().toISOString();

const job = (id, kind, state) => ({
  id, kind, name: `job ${id}`, state, priority: 0, attempts_made: 1, max_attempts: 3,
  spec: {}, progress_done: null, progress_total: null, created_at: at, updated_at: at, finished_at: state === 'leased' ? null : at,
});

for (const [page, kind, ring] of [['inference.html', 'inference', 'inference'], ['training.html', 'training', 'training']]) {
  test(`${page}: every legend entry has a dot coloured as its ring segment`, async (t) => {
    const jobs = [job(1, kind, 'leased'), job(2, kind, 'queued'), job(3, kind, 'succeeded'), job(4, kind, 'failed')];
    const screen = await drawScreen(page, {
      listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
      listSessions: async () => [],
      listModels: async () => [],
      listDatasets: async () => [],
      listTrainingRuns: async () => [],
    });

    t.after(screen.close);

    const entries = [...screen.document.querySelectorAll('.job-mix-key > span')];
    const segments = [...screen.document.querySelectorAll('.job-donut .donut-part')];

    assert.equal(entries.length, 4, 'four legend entries');
    assert.match(entries[0].textContent, /Running/);
    assert.match(entries[3].textContent, /Need attention/);
    assert.equal(entries[0].className, ring, 'Running is the ring\'s own segment class');

    entries.forEach((entry, index) => {
      const cls = entry.className;

      assert.ok(segments[index].classList.contains(cls), `${entry.textContent.trim()}: same class as its segment`);
      assert.match(CSS, new RegExp(`\.job-mix-key \.${cls} \{ --key:`), `${cls}: the legend colours its dot`);
      assert.match(CSS, new RegExp(`\.donut-part\.${cls} \{ stroke:`), `${cls}: the ring colours its segment`);
    });
  });
}
