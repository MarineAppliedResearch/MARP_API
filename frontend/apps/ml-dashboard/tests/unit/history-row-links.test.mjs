/**
 * History rows lead somewhere, and the controls that cannot act are gone.
 *
 * Isaac, looking at the screen: *"each of these jobs should be a link to the individual
 * job it's referencing on one of the other pages... that way we don't have to worry about
 * expanding it right here"*, and *"what does exporting a job even mean"*.
 *
 * Three controls on this screen had no handler bound to them and never had: the `Open`
 * button at the end of every row, `Run again` in the selection bar, and `Export`. The
 * first two are not implemented here — the destinations already exist, so a row leads to
 * one and the buttons come out. Export is implemented, because Isaac asked for the whole
 * list rather than the page: *"we should have the ability to export the entire history
 * list yes"*.
 *
 * **Asserted at the DOM tier because that is the only tier that can see it.** A control
 * with no listener is indistinguishable from a working one at every layer below this: the
 * markup is valid, the data is right, and nothing throws. It is wrong only in that
 * clicking it does nothing, which is a fact about a rendered document.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const DAY = 86400000;
const BASE = Date.parse('2026-10-20T12:00:00.000Z');

/**
 * A finished job of one kind, far enough back to stay inside the default window.
 *
 * @param {Object} fields - `{id, kind, spec, name, state, daysAgo}`.
 * @returns {Object} A job as `GET /gpu/jobs` returns one.
 */
function finishedJob({ id, kind, spec = {}, name = null, state = 'succeeded', daysAgo = 0 }) {
  const started = BASE - daysAgo * DAY;
  return {
    id,
    kind,
    name,
    state,
    spec,
    created_at: new Date(started).toISOString(),
    updated_at: new Date(started + 300000).toISOString(),
    created_by: 7,
    worker_name: 'ABYSS-fba6be1a',
    workers_used: 1,
    progress_done: null,
    progress_total: null,
    batch_id: null,
  };
}

/** An inference job carries a session; the lookup resolves it to a project. */
const INFERENCE = finishedJob({
  id: 21700,
  kind: 'inference',
  daysAgo: 1,
  spec: { session: { session_id: 755 }, range: { start_frame: 0, end_frame: 6000 }, model: { name: 'rockfish5' } },
});

/** A training job carries no session at all, which is why Scope is empty for it. */
const TRAINING = finishedJob({
  id: 21785,
  kind: 'training',
  daysAgo: 2,
  spec: { model: { name: 'rockfish5-2026-10-20' } },
});

/** A dataset build names the dataset it produced, which is where its row lives. */
const BUILD = finishedJob({
  id: 21783,
  kind: 'dataset_build',
  name: 'Build Quillback Test',
  daysAgo: 3,
  spec: { dataset_id: 389 },
});

/**
 * Draw History over a set of finished jobs.
 *
 * @param {Object[]} jobs - What `listJobs` should answer with.
 * @returns {Promise<Object>} From `drawScreen`.
 */
function drawHistory(jobs) {
  return drawScreen('history.html', {
    listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
    listProjects: async () => [{ project_id: 11, name: 'CAMPA2026' }],
    listUsers: async () => [{ user_id: 7, name: 'Isaac Assegai' }],
    listSessions: async () => [{ session_id: 755, project_id: 11, dive: '2026-06-17', line: 3008, type: 'Fish' }],
  });
}

/**
 * The link a named row carries.
 *
 * @param {Object} document - The drawn document.
 * @param {number} id - The job id on the row.
 * @returns {?string} Its href, or null when the name is not a link.
 */
function rowLink(document, id) {
  const row = document.querySelector(`#history tbody tr[data-job="${id}"]`);
  assert.ok(row, `the fixture should have drawn a row for job ${id}`);
  return row.querySelector('.jname a')?.getAttribute('href') ?? null;
}

test('a job in the history leads to that job on the screen that owns it', async (t) => {
  const screen = await drawHistory([INFERENCE, TRAINING, BUILD]);
  t.after(screen.close);

  /* Inference, tracking, training and diagnostic are all rows on the Jobs queue, and
     `?job=` there already prepends and expands the one asked for. */
  assert.equal(rowLink(screen.document, 21700), './jobs.html?job=21700',
    'an inference job should lead to its own row on the Jobs queue');
  assert.equal(rowLink(screen.document, 21785), './jobs.html?job=21785',
    'a training job should lead to its own row on the Jobs queue');

  /* A build is the one kind whose subject is not the job. `datasets.html?dataset=`
     opens the dataset the build produced, which is what a person following the row
     wants to see -- the job itself holds nothing a reader of history needs. */
  assert.equal(rowLink(screen.document, 21783), './datasets.html?dataset=389',
    "a dataset build should lead to the dataset it built, named by its spec's dataset_id");
});

test('a build with no dataset recorded still leads somewhere', async (t) => {
  /* Six builds exist and every one carries `dataset_id`, but the spec is free-form and
     a link that resolves to `dataset=undefined` would open a Datasets screen that
     silently expands nothing. The job's own row is the honest fallback. */
  const orphan = finishedJob({ id: 21777, kind: 'dataset_build', name: 'Build with no dataset', spec: {} });
  const screen = await drawHistory([orphan]);
  t.after(screen.close);

  assert.equal(rowLink(screen.document, 21777), './jobs.html?job=21777',
    'a build whose spec names no dataset should fall back to its job rather than link nowhere');
});

test('no row draws a control that cannot act', async (t) => {
  const screen = await drawHistory([INFERENCE, TRAINING, BUILD]);
  t.after(screen.close);

  const opens = screen.document.querySelectorAll('#history tbody [aria-label="Open"]');
  assert.equal(opens.length, 0,
    'the row Open button had no handler on this screen and the name is the link now');

  /* The column held nothing else, so it goes with the button rather than becoming an
     empty cell on every row. */
  assert.equal(screen.document.querySelectorAll('#history thead th.hacts').length, 0,
    'the Actions column held only the Open button and should be gone with it');

  const head = screen.document.querySelectorAll('#history thead th').length;
  const cells = screen.document.querySelector('#history tbody tr').children.length;
  assert.equal(cells, head, 'every row should still carry one cell per column');
});

test('the selection bar does not offer to run a finished job again', async (t) => {
  const screen = await drawHistory([TRAINING]);
  t.after(screen.close);

  const labels = [...screen.document.querySelectorAll('#bulk button')].map((b) => b.textContent.trim());
  assert.ok(!labels.includes('Run again'),
    'Run again belongs on the job\'s own screen, which the row now links to');
});

test('Export writes every row in the window, not the page being looked at', async (t) => {
  /* Twelve finished jobs against a ten-row page: the defect this guards is an Export
     that writes what is on screen, which looks right until the window has a second
     page. */
  const many = Array.from({ length: 12 }, (_, i) => finishedJob({
    id: 22000 + i,
    kind: 'training',
    daysAgo: i % 7,
    spec: { model: { name: 'rockfish5' } },
  }));

  const screen = await drawHistory(many);
  t.after(screen.close);

  assert.equal(screen.document.querySelectorAll('#history tbody tr').length, 10,
    'the page should still show ten rows, so the export is reaching past it');

  const blobs = [];
  screen.window.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:history'; };
  screen.window.URL.revokeObjectURL = () => {};

  const exportButton = [...screen.document.querySelectorAll('#history-panel .panel-tools button')]
    .find((b) => b.textContent.trim() === 'Export');
  assert.ok(exportButton, 'the panel should carry an Export control');

  exportButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(blobs.length, 1, 'Export should have produced a file');
  const text = await blobs[0].text();
  const lines = text.trim().split(/\r?\n/);

  assert.equal(lines.length, 13, 'a header and all twelve jobs in the window');
  assert.match(lines[0], /Job/, 'the first line should name the columns');
  assert.ok(lines.some((l) => l.includes('22011')), 'a job on the second page should be in the file');
});

test('Export quotes a field that carries a comma', async (t) => {
  /* Job names are typed by a person. `Build ALLTEST2, second pass` splits one column
     into two in every spreadsheet that opens it, and nothing about the file looks
     wrong. */
  const comma = finishedJob({ id: 21999, kind: 'dataset_build', name: 'Build "Quillback", second pass', spec: { dataset_id: 400 } });
  const screen = await drawHistory([comma]);
  t.after(screen.close);

  const blobs = [];
  screen.window.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:history'; };
  screen.window.URL.revokeObjectURL = () => {};

  [...screen.document.querySelectorAll('#history-panel .panel-tools button')]
    .find((b) => b.textContent.trim() === 'Export').click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const text = await blobs[0].text();
  assert.match(text, /"Build ""Quillback"", second pass"/,
    'a field with a comma is quoted and an embedded quote is doubled, which is what RFC 4180 readers expect');
});
