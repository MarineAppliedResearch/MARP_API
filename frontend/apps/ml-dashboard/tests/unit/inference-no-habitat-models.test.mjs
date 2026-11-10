/**
 * The Inference tab's species pipeline does not offer habitat models (#287).
 *
 * A habitat model answers yes or no per substrate for a whole frame, and the API refuses one
 * on the species engine; offering it here would be offering a run that cannot be queued.
 * Habitat models get a pipeline of their own.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test('a habitat model is not among the models the species pipeline offers', async (t) => {
  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listProjects: async () => [{ project_id: 44, name: 'CAMPA2019' }],
    listRunnableModels: async () => [
      { id: 91, name: 'CAMPA_GR1_TEST6-mixed', status: 'active', model_type: 'detection', artifact_sha256: 'a'.repeat(64) },
      { id: 500, name: 'campa-habitat-2026-11-10', status: 'active', model_type: 'habitat', artifact_sha256: 'b'.repeat(64) },
    ],
    listModelSpecies: async () => [],
    listModelVersions: async () => [],
    listVideoLibraries: async () => [],
  });
  t.after(screen.close);
  await settle();

  const { document } = screen;
  if (!document.querySelector('[data-model-config]')) {
    document.querySelector('[data-add-model]').click();
    await settle();
  }

  const offered = [...document.querySelectorAll('[data-model-pick] option')].map((o) => o.value);
  assert.ok(offered.includes('91'), 'the detection model is offered');
  assert.ok(!offered.includes('500'), 'the habitat model is not');
});
