/**
 * One click of Run is one run per dive and model, however many videos (#336).
 *
 * MARP is sent one request per video, and each used to become a run of its own: Dive 119's
 * three videos were three runs in the Mosaic, alike in name, model and minute. Isaac,
 * 2026-11-09: a run is the whole submission for a dive. So every request of a click for
 * one dive and model carries the same `submission_id`, and the next click a new one.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('every video of a dive submitted in one click shares one submission id, and the next click does not', async (t) => {
  const sent = [];
  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listProjects: async () => [{ project_id: 44, name: 'CAMPA2019' }],
    listRunnableModels: async () => [{
      id: 91, name: 'CAMPA_GR1_TEST6-mixed', status: 'active', model_type: 'detection', artifact_sha256: 'a'.repeat(64),
    }],
    listModelSpecies: async () => [],
    listModelVersions: async () => [],
    listVideoLibraries: async () => [{ id: 'p1', name: 'CAMPA2019', childCount: 1 }],
    // One dive holding two videos.
    listVideoChildren: async (id) => (id === 'p1'
      ? [{ id: 'd1', name: 'Dive 1', isFolder: true, childCount: 2 }]
      : [
        { id: 'v1', name: '20190712_204529_Fwd', isFolder: false, path: '/a.mp4' },
        { id: 'v2', name: '20190712_211530_Fwd', isFolder: false, path: '/b.mp4' },
      ]),
    submitJob: async (body) => { sent.push(body); return { jobs: [{ id: sent.length }] }; },
  });

  t.after(screen.close);
  await settle();

  const { document, window } = screen;

  // Both videos of the dive ticked, then added to the plan.
  for (const box of document.querySelectorAll('[data-video-choice] input[type="checkbox"]')) box.checked = true;
  document.querySelector('[data-add-targets]').click();
  for (const line of document.querySelectorAll('[data-target] [data-target-line]')) {
    line.value = '780';
    line.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  const project = document.querySelector('[data-marp-project]');
  project.value = '44';
  project.dispatchEvent(new window.Event('change', { bubbles: true }));

  if (!document.querySelector('[data-model-config]')) {
    document.querySelector('[data-add-model]').click();
    await settle();
  }

  document.getElementById('runBtn').click();
  await settle();

  assert.equal(sent.length, 2, 'one request per video');
  assert.match(sent[0].submission_id, UUID, 'a submission id, a uuid');
  assert.equal(sent[1].submission_id, sent[0].submission_id, 'the same id for both videos of the dive');

  document.getElementById('runBtn').click();
  await settle();

  assert.equal(sent.length, 4);
  assert.equal(sent[2].submission_id, sent[3].submission_id);
  assert.notEqual(sent[2].submission_id, sent[0].submission_id, 'another click is another run');
});
