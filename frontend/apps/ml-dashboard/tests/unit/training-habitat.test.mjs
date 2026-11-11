/**
 * The Training screen's Habitat tab queues a habitat run, or says why it cannot (#287).
 *
 * A habitat model is trained by the habitat trainer, from a habitat starting model (DINOv2),
 * on a habitat dataset; the API refuses any other pairing. So the tab offers only habitat
 * models and habitat datasets, keeps habitat datasets out of the other tabs, and sends the
 * habitat engine with the pass counts and seed it was given.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

const DINOV2 = { id: 698, name: 'dinov2-vitb14', model_type: 'habitat', is_base: true, status: 'active', artifact_sha256: 'A'.repeat(64) };
const DETECTOR = { id: 412, name: 'rockfish5', model_type: 'detection', status: 'active', artifact_sha256: 'b'.repeat(64) };

async function trainingScreen(t) {
  const sent = [];
  const screen = await drawScreen('training.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listModels: async () => [DINOV2, DETECTOR],
    listDatasets: async () => [
      { id: 294, name: 'rockfish5', status: 'ready', task: 'detection' },
      { id: 700, name: 'campa-habitat', status: 'ready', task: 'habitat' },
    ],
    listWorkers: async () => [],
    submitJob: async (body) => { sent.push(JSON.parse(JSON.stringify(body))); return { batch_id: null, jobs: [{ id: 22001, state: 'queued' }] }; },
  });
  t.after(screen.close);
  await settle();
  return { screen, sent };
}

const options = (document, id) => [...document.querySelectorAll(`#${id} option`)].map((o) => o.textContent);

test('the Habitat tab offers habitat models and habitat datasets only, and the others none', async (t) => {
  const { screen } = await trainingScreen(t);
  const { document } = screen;

  assert.deepEqual(options(document, 'base-hab'), ['dinov2-vitb14']);
  assert.deepEqual(options(document, 'dataset-hab'), ['campa-habitat']);
  assert.ok(!options(document, 'dataset-det').includes('campa-habitat'), 'a habitat dataset is not offered for detection');
  assert.ok(!options(document, 'base-det').includes('dinov2-vitb14'));
});

test('queueing from the Habitat tab sends the habitat trainer, the dataset and the passes', async (t) => {
  const { screen, sent } = await trainingScreen(t);
  const { document, window } = screen;

  document.querySelector('[data-switch="task"] [data-view="hab"]').click();
  document.querySelector('#base-hab').value = '698';
  document.querySelector('#dataset-hab').value = '700';
  document.querySelector('#hab-epochs').value = '8';
  document.querySelector('#hab-seed').value = '2';
  document.querySelector('#trainBtn').click();
  await settle();

  assert.equal(sent.length, 1);
  const { spec } = sent[0];
  assert.equal(spec.engine, 'marp_habitat_training');
  assert.deepEqual(spec.model, { ml_model_id: 698, name: 'dinov2-vitb14', url: '/api/v2/model/698/artifact', sha256: 'a'.repeat(64) });
  assert.deepEqual(spec.dataset, { dataset_id: 700 });
  assert.deepEqual(spec.params, { head_epochs: 3, epochs: 8, seed: 2 });
  assert.match(document.querySelector('[data-fills="train-status"]').textContent, /Queued as job 22001/);
  assert.ok(window);
});

test('with no habitat dataset chosen it says so and queues nothing', async (t) => {
  const { screen, sent } = await trainingScreen(t);
  const { document } = screen;

  document.querySelector('[data-switch="task"] [data-view="hab"]').click();
  document.querySelector('#base-hab').value = '698';
  document.querySelector('#dataset-hab').innerHTML = '<option value="">No habitat dataset saved in MARP</option>';
  document.querySelector('#trainBtn').click();
  await settle();

  assert.equal(sent.length, 0);
  assert.match(document.querySelector('[data-fills="train-status"]').textContent, /Choose a habitat dataset/);
});
