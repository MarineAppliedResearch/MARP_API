/**
 * Inference pieces are asked for in minutes, and the request is not printed on screen.
 *
 * The run plan offered "Piece size (frames)" at 900 -- a mockup value nobody chose, half
 * a minute of video -- and three videos became 82 jobs. Isaac asked for minutes,
 * defaulting to five, converted at each video's own rate; MARP does the converting, so
 * the screen sends seconds. He also asked that the raw request panel go.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test('Run sends a five-minute piece in seconds, and shows no request panel', async (t) => {
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
    listVideoChildren: async (id) => (id === 'p1'
      ? [{ id: 'd1', name: 'Dive 1', isFolder: true, childCount: 1 }]
      : [{ id: 'v1', name: '20190712_204529_Fwd', isFolder: false, path: '/x.mp4' }]),
    submitJob: async (body) => { sent.push(body); return { jobs: [{ id: 1 }] }; },
  });

  t.after(screen.close);
  await settle();

  const { document, window } = screen;

  assert.equal(document.getElementById('specOut'), null, 'the raw request panel is gone');

  document.querySelector('[data-add-targets]').click();

  const line = document.querySelector('[data-target] [data-target-line]');
  line.value = '780';
  line.dispatchEvent(new window.Event('input', { bubbles: true }));

  const project = document.querySelector('[data-marp-project]');
  project.value = '44';
  project.dispatchEvent(new window.Event('change', { bubbles: true }));

  if (!document.querySelector('[data-model-config]')) {
    document.querySelector('[data-add-model]').click();
    await settle();
  }

  const minutes = document.querySelector('[data-setting="piece_minutes"]');

  assert.ok(minutes, 'the setting is a length in minutes');
  assert.equal(minutes.value, '5', 'defaulting to five');

  document.getElementById('runBtn').click();
  await settle();

  assert.equal(sent.length, 1, 'one run submitted');
  assert.equal(sent[0].piece_seconds, 300, 'five minutes, sent as seconds for MARP to convert');
  assert.equal(sent[0].piece_frames, undefined, 'and no frame count of its own');
  assert.equal(sent[0].spec.session.line, '780');
});
