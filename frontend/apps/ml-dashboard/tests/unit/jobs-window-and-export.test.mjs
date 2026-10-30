/**
 * Jobs is the job history, so it carries the window and the export.
 *
 * Isaac, looking at the two tabs: *"it doesn't make sense that we have a jobs tab, and a
 * history tab, the jobs tab is the jobs history!"* — and he is right in a stricter sense
 * than it first reads. Both screens called the identical `listJobs({ limit: 500 })` and
 * differed only in two numbers applied afterwards: Jobs kept a 7-day window and every
 * state, History a 30-day window and the terminal states. The table was the same table.
 *
 * So History folds into Jobs, and the two things History had that Jobs did not come with
 * it: a window that reaches past 30 days, and an export of what the filters leave.
 *
 * **The export assertions are about the window, not the page.** Jobs draws 18 rows at a
 * time; an export built from the table reads correctly until there is a second page, and
 * is then quietly wrong rather than visibly broken — which is the failure that outlives
 * a review.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const DAY = 86400000;
const BASE = Date.parse('2026-10-20T12:00:00.000Z');

/**
 * A job as `GET /gpu/jobs` returns one.
 *
 * @param {Object} fields - `{id, kind, state, daysAgo, name, spec}`.
 * @returns {Object}
 */
function job({ id, kind = 'inference', state = 'succeeded', daysAgo = 0, name = null, spec = {} }) {
  const at = BASE - daysAgo * DAY;
  return {
    id,
    kind,
    name,
    state,
    spec: { model: { name: 'rockfish5' }, ...spec },
    created_at: new Date(at).toISOString(),
    updated_at: new Date(at + 300000).toISOString(),
    created_by: 7,
    worker_name: 'ABYSS-fba6be1a',
    workers_used: 1,
    progress_done: null,
    progress_total: null,
    batch_id: null,
  };
}

/**
 * Draw Jobs over a set of jobs.
 *
 * @param {Object[]} jobs - What `listJobs` should answer with.
 * @returns {Promise<Object>} From `drawScreen`.
 */
function drawJobs(jobs) {
  return drawScreen('jobs.html', {
    listJobs: async ({ state } = {}) => {
      /* The rail asks for counts with `limit: 1`; the table asks for everything. */
      const rows = state ? jobs.filter((j) => j.state === state) : jobs;
      return { jobs: rows, total: rows.length, limit: 500, offset: 0 };
    },
    listProjects: async () => [{ project_id: 11, name: 'CAMPA2026' }],
    listUsers: async () => [{ user_id: 7, name: 'Isaac Assegai' }],
    listSessions: async () => [{ session_id: 755, project_id: 11, dive: '2026-06-17', line: 3008, type: 'Fish' }],
  });
}

/**
 * Capture whatever the next export hands the browser.
 *
 * @param {Object} window - The drawn window.
 * @returns {Object[]} Blobs, filled as exports happen.
 */
function captureDownloads(window) {
  const blobs = [];
  window.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:jobs'; };
  window.URL.revokeObjectURL = () => {};
  return blobs;
}

/** The Export control on the Jobs toolbar. */
const exportControl = (document) => [...document.querySelectorAll('#filters button')]
  .find((b) => b.textContent.trim() === 'Export');

test('the Jobs window reaches as far back as History did', async (t) => {
  const screen = await drawJobs([job({ id: 1 })]);
  t.after(screen.close);

  const options = [...screen.document.querySelectorAll('select[aria-label="Window"] option')]
    .map((o) => o.textContent.trim());

  /* History offered 7, 30, 90 and this year; Jobs stopped at 30, so folding one into
     the other without these two loses the only thing the longer window was for. */
  assert.ok(options.includes('Last 90 days'), 'Jobs should offer the 90-day window History had');
  assert.ok(options.includes('This year'), 'Jobs should offer the yearly window History had');

  /* Jobs' own short window is what makes it a queue rather than an archive. */
  assert.ok(options.includes('Last 24 hours'), 'Jobs should keep its own shortest window');
});

test('a window past 30 days actually widens the table', async (t) => {
  /* The options are markup and the map is code: offering "This year" without extending
     the lookup leaves a control that changes the label and nothing else, which is the
     defect this whole pass is about. */
  const screen = await drawJobs([
    job({ id: 1, daysAgo: 0 }),
    job({ id: 2, daysAgo: 45 }),
    job({ id: 3, daysAgo: 200 }),
  ]);
  t.after(screen.close);

  const rows = () => screen.document.querySelectorAll('#jobs tbody tr[data-job]').length;
  assert.equal(rows(), 1, 'the default 7-day window should hold only the newest job');

  const windowSelect = screen.document.querySelector('select[aria-label="Window"]');

  windowSelect.value = 'Last 90 days';
  windowSelect.dispatchEvent(new screen.window.Event('change', { bubbles: true }));
  assert.equal(rows(), 2, '90 days should reach the job 45 days back');

  windowSelect.value = 'This year';
  windowSelect.dispatchEvent(new screen.window.Event('change', { bubbles: true }));
  assert.equal(rows(), 3, 'this year should reach the job 200 days back');
});

test('Export writes every job the filters leave, not the page on screen', async (t) => {
  /* Twenty jobs against an eighteen-row page. */
  const many = Array.from({ length: 20 }, (_, i) => job({ id: 3000 + i, daysAgo: i % 5 }));
  const screen = await drawJobs(many);
  t.after(screen.close);

  assert.equal(screen.document.querySelectorAll('#jobs tbody tr[data-job]').length, 18,
    'the page should still show eighteen, so the export is reaching past it');

  const blobs = captureDownloads(screen.window);
  const control = exportControl(screen.document);
  assert.ok(control, 'the Jobs toolbar should carry an Export control');

  control.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(blobs.length, 1, 'Export should have produced a file');
  const lines = (await blobs[0].text()).trim().split(/\r?\n/);

  assert.equal(lines.length, 21, 'a header and all twenty jobs in the window');
  assert.ok(lines.some((l) => l.includes('3019')), 'a job on the second page should be in the file');
});

test('Export quotes a field that carries a comma', async (t) => {
  /* Job names are typed by a person. `Build ALLTEST2, second pass` splits one column into
     two in every spreadsheet that opens the file, and nothing about the file looks wrong.
     Written against History's export and kept when that screen folded into this one,
     because the writer it guards is the one Jobs exports through. */
  const screen = await drawJobs([job({ id: 21999, name: 'Build "Quillback", second pass' })]);
  t.after(screen.close);

  const blobs = captureDownloads(screen.window);
  exportControl(screen.document).click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.match(await blobs[0].text(), /"Build ""Quillback"", second pass"/,
    'a field with a comma is quoted and an embedded quote doubled, which is what RFC 4180 readers expect');
});

test('Export honours the filters rather than dumping the fetch', async (t) => {
  /* An export that ignores the narrowing is worse than one that ignores the paging: it
     looks complete, so nobody checks it against what they were looking at. */
  const screen = await drawJobs([
    job({ id: 1, daysAgo: 0, name: 'rockfish nightly' }),
    job({ id: 2, daysAgo: 0, name: 'urchin sweep' }),
  ]);
  t.after(screen.close);

  const search = screen.document.querySelector('#filters input[type="search"]');
  search.value = 'urchin';
  search.dispatchEvent(new screen.window.Event('input', { bubbles: true }));

  const blobs = captureDownloads(screen.window);
  exportControl(screen.document).click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const text = await blobs[0].text();
  assert.ok(text.includes('urchin sweep'), 'the job the search left should be in the file');
  assert.ok(!text.includes('rockfish nightly'), 'the job the search removed should not be');
});
