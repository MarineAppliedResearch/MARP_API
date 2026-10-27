/**
 * An expandable table opens shut.
 *
 * **Both tables that build their detail row as markup opened with every row expanded**,
 * and neither static check could see it: the markup is correct, the ids resolve, the
 * links work. Isaac found the registry by looking at it — *"the model registry starts
 * with all models expanded"* — and the pool had the same defect, unreported, from the
 * same line copied.
 *
 * The cause is one attribute. Nothing in the stylesheet holds `.runrow-body` closed, so
 * the `hidden` attribute is the whole mechanism; `jobs` and `saved-datasets` build their
 * detail with `createElement` and set `hidden = true`, and `models` and `workers` built
 * theirs as a string and did not. It read worse than "starts expanded": `aria-expanded`
 * on the head stayed `"false"` while the panel was open, so the two disagreed and the
 * first click on any row set them to agree and changed nothing a reader could see.
 *
 * So this asserts the invariant rather than the fix — every expandable table on the
 * screen, drawn shut, with the attribute and the panel agreeing — which is what stops
 * the next table built the same way from arriving open.
 *
 * The jsdom boot lives in `screen.mjs`, which this shares with
 * `models-training-dataset.test.mjs`.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/**
 * Assert that every expandable table on a drawn screen starts shut.
 *
 * @param {Object} screen - From `drawScreen`.
 * @param {string} table - The table's id, for the message.
 * @returns {void}
 */
function assertStartsShut(screen, table) {
  const heads = [...screen.document.querySelectorAll(`#${table} tbody tr.runrow-head`)];
  const bodies = [...screen.document.querySelectorAll(`#${table} tbody tr.runrow-body`)];

  /* Without this the rest passes on an empty table, which is exactly the state a screen
     lands in when its stub is wrong. */
  assert.ok(heads.length > 0, `#${table} should have drawn some rows to be worth asserting about`);
  assert.equal(bodies.length, heads.length, `#${table} should have one detail row per row`);

  assert.deepEqual(
    bodies.filter((row) => !row.hidden).map((row) => row.previousElementSibling?.textContent.trim().slice(0, 30)),
    [],
    `#${table} should draw every detail row hidden: nothing in the stylesheet holds one shut, `
    + 'so a detail row built as markup without the hidden attribute renders open');

  assert.deepEqual(
    heads.filter((head) => head.getAttribute('aria-expanded') !== 'false').map((head) => head.className),
    [],
    `#${table} should say aria-expanded="false" on every head, so the attribute and the panel `
    + 'agree -- when they disagree the first click on a row changes nothing visible');
}

test('the model registry draws its rows shut', async (t) => {
  const model = (id, name, parent = null) => ({
    id,
    name,
    model_type: 'detection',
    architecture_version: 'YOLOv8l',
    status: 'trained',
    parent_model_id: parent,
    storage_path: `/weights/${name}.pt`,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
  });

  const screen = await drawScreen('models.html', {
    listModels: async () => [model(1, 'MARP-Rockfish-Det'), model(2, 'MARP-Inverts-Det', 1)],
  });

  t.after(screen.close);

  assertStartsShut(screen, 'models');
});

test('the compute pool draws its rows shut', async (t) => {
  /* The same defect, from the same line copied into `workerRows`. Isaac reported the
     registry; this one nobody had mentioned. */
  const worker = (id, name) => ({
    worker_id: id,
    id,
    name,
    activity: 'idle',
    state: 'ready',
    slot_count: 1,
    capabilities: { gpu: 'RTX 4090', vram_mb: 24576 },
    worker_version: '1.0.0',
    attempts: [],
    last_seen_at: '2026-10-22T10:00:00.000Z',
    enrolled_at: '2026-10-01T10:00:00.000Z',
  });

  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(1, 'bergstrom-4090'), worker(2, 'campa-lab-02')],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
  });

  t.after(screen.close);

  assertStartsShut(screen, 'workers');
});
