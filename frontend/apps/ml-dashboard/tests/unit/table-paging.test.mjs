/**
 * Every list table pages the same way.
 *
 * Isaac, on 2026-10-28: *"all of the tables should work and be paginated in the same
 * way."* They did not. Jobs paged at 18, Training runs at 10, Models at 8, Workers at 5;
 * Inference showed six rows with no pager, so a run of 28 pieces in flight pushed every
 * finished job off the tab; Training showed three; the Dashboard five; Saved datasets
 * drew a pager whose buttons did nothing. Each is `drawPager` now, and this holds every
 * one of them to it: a footer saying *Showing 1-18 of N*, a Next that reaches the rest,
 * and Rows 18 / 25 / 50.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const ROWS = 22;
const at = (index) => new Date(Date.now() - index * 3600000).toISOString();

/** A finished job of a kind, the shape every job table reads. */
const job = (index, kind) => ({
  id: 30000 + index, kind, name: `${kind}-${index}`, state: 'succeeded', priority: 0, attempts_made: 1, max_attempts: 3,
  batch_id: null, spec: { session: { session_id: 1 }, model: { ml_model_id: 7, name: 'm' } },
  progress_done: null, progress_total: null, created_at: at(index), updated_at: at(index), finished_at: at(index),
});

const jobs = (kind) => async () => {
  const list = Array.from({ length: ROWS }, (_, index) => job(index, kind));
  return { jobs: list, total: list.length, limit: 500, offset: 0 };
};

const TABLES = [
  { page: 'jobs.html', rows: '#jobs tbody tr[data-job]', answers: { listJobs: jobs('inference'), listSessions: async () => [] } },
  { page: 'inference.html', rows: '.inference-table tbody tr[data-job]', answers: { listJobs: jobs('inference'), listSessions: async () => [] } },
  { page: 'training.html', rows: '.training-table tbody tr[data-job]', answers: { listJobs: jobs('training'), listSessions: async () => [], listTrainingRuns: async () => [], listModels: async () => [], listDatasets: async () => [] } },
  { page: 'dashboard.html', rows: '#current-activity tbody tr[data-job]', answers: { listJobs: jobs('inference'), listSessions: async () => [], listWorkers: async () => [], listModels: async () => [], listDatasets: async () => [] } },
  {
    page: 'models.html',
    rows: '#models tbody tr[data-model]',
    answers: {
      listModels: async () => Array.from({ length: ROWS }, (_, index) => ({
        id: 500 + index, name: `model-${index}`, model_type: 'detection', status: 'trained', created_at: at(index), updated_at: at(index),
      })),
    },
  },
  {
    page: 'workers.html',
    rows: '#workers tbody tr[data-worker]',
    answers: {
      listJobs: jobs('inference'),
      listSessions: async () => [],
      listWorkers: async () => Array.from({ length: ROWS }, (_, index) => ({
        worker_id: 700 + index, name: `rig-${index}`, state: 'online', activity: 'idle', slot_count: 1, worker_version: '0.1.17',
        capabilities: { slots: 1 }, enrolled_at: at(index), last_seen_at: new Date().toISOString(), attempts: [],
      })),
    },
  },
  {
    page: 'datasets.html',
    rows: '#saved-datasets tbody tr.runrow-head:not([hidden])',
    answers: {
      listDatasetBuilds: async () => [],
      listDatasets: async () => Array.from({ length: ROWS }, (_, index) => ({
        id: 800 + index, name: `set-${index}`, description: 'd', status: 'ready', num_samples: 10, num_observations: 10,
        num_classes: 1, created_at: at(index), updated_at: at(index),
      })),
    },
  },
];

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

for (const table of TABLES) {
  test(`${table.page} pages its table the shared way`, async (t) => {
    const screen = await drawScreen(table.page, table.answers);
    t.after(screen.close);

    const { document, window } = screen;
    const rows = () => document.querySelectorAll(table.rows).length;
    const first = document.querySelector(table.rows);

    assert.ok(first, 'the table drew rows');
    /* The panel, not the row: most tables redraw their rows when the page changes. */
    const panel = first.closest('.panel');
    const footer = () => panel.querySelector('.panel-ft');

    assert.equal(rows(), 18, 'eighteen rows on the first page');
    assert.match(footer().textContent, /Showing 1.18 of 22/, 'and the footer says which of how many');
    assert.deepEqual([...footer().querySelectorAll('.rpp option')].map((o) => o.textContent), ['18', '25', '50'],
      'the same Rows choices everywhere');

    footer().querySelector('[aria-label="Next page"]').click();
    await settle();
    assert.equal(rows(), 4, 'Next reaches the other four');
    assert.match(footer().textContent, /Showing 19.22 of 22/);

    const size = footer().querySelector('.rpp select');
    size.value = '25';
    size.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    assert.equal(rows(), 22, 'and 25 a page shows them all, from the first page');
  });
}
