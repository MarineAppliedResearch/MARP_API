/**
 * The Inference tab's habitat pipeline runs habitat models over video (#287).
 *
 * Choosing "Habitat substrates" offers habitat models instead of species ones, and Run sends
 * the habitat engine with the habitat stretch rule, no species settings, and no splitting into
 * pieces -- a piece boundary would cut a stretch in two. The session is made per run, as for
 * species, and MARP gives it the Habitat type from the model's substrates.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test('the habitat pipeline offers habitat models and queues habitat runs', async (t) => {
  const sent = [];
  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listProjects: async () => [{ project_id: 44, name: 'CAMPA 2024' }],
    listRunnableModels: async () => [
      { id: 91, name: 'CAMPA_GR1_TEST6-mixed', status: 'active', model_type: 'detection', artifact_sha256: 'a'.repeat(64) },
      { id: 500, name: 'campa-habitat-2026-11-10', status: 'active', model_type: 'habitat', artifact_sha256: 'b'.repeat(64) },
    ],
    listModelSpecies: async () => [],
    listModelVersions: async () => [],
    listVideoLibraries: async () => [{ id: 'p1', name: 'CAMPA 2024', childCount: 1 }],
    listVideoChildren: async (id) => (id === 'p1'
      ? [{ id: 'd1', name: 'Dive 5', isFolder: true, childCount: 1 }]
      : [{ id: 'v1', name: '20240729_150326 Fwd', isFolder: false, path: '/a.mp4' }]),
    getVideoClock: async () => ({ recorded_start: null, suggested_start: null }),
    submitJob: async (body) => { sent.push(JSON.parse(JSON.stringify(body))); return { jobs: [{ id: sent.length }] }; },
  });
  t.after(screen.close);
  await settle();

  const { document, window } = screen;
  if (!document.querySelector('[data-model-config]')) {
    document.querySelector('[data-add-model]').click();
    await settle();
  }
  const offered = () => [...document.querySelectorAll('[data-model-pick] option')].map((o) => o.value);
  assert.deepEqual(offered(), ['91'], 'the species pipeline offers the detector');

  const pipeline = document.getElementById('pipeline');
  pipeline.value = 'habitat';
  pipeline.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(offered(), ['500'], 'the habitat pipeline offers the habitat model');

  // One video, with its line, into project 44.
  for (const box of document.querySelectorAll('[data-video-choice] input[type="checkbox"]')) box.checked = true;
  document.querySelector('[data-add-targets]').click();
  await settle();
  const line = document.querySelector('[data-target] [data-target-line]');
  line.value = '1810';
  line.dispatchEvent(new window.Event('input', { bubbles: true }));
  const project = document.querySelector('[data-marp-project]');
  project.value = '44';
  project.dispatchEvent(new window.Event('change', { bubbles: true }));

  document.getElementById('runBtn').click();
  await settle();

  assert.equal(sent.length, 1);
  const { spec } = sent[0];
  assert.equal(spec.engine, 'marp_habitat');
  assert.deepEqual(spec.reduction, { name: 'habitat_stretches', version: '1' });
  assert.equal(spec.model.ml_model_id, 500);
  assert.equal(spec.params, undefined, 'no species settings');
  assert.equal(sent[0].piece_seconds, undefined, 'not split into pieces');
  assert.deepEqual(spec.session, { project_id: 44, dive: 'Dive 5', line: '1810', per_run: true });
});
