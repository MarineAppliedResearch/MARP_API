/**
 * A run can set when each video's recording started, so its observations carry the real
 * date and time (#76).
 *
 * Isaac, 2026-11-09: *"when we run an infrence model, we might also want to set the time per
 * video, that way we won't need to correct it on the mosaic viewer"*, and *"if we don't, then
 * it should just use the vdieo position time, but make it known that it does that."* So each
 * card offers the clock already set, or else the file name's time, and Run sets it before
 * queueing -- or says plainly that a video has none.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

/** The Inference screen with two videos in one dive, and every call recorded in order. */
async function planWith(t, clocks) {
  const calls = [];
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
      ? [{ id: 'd1', name: 'Dive 1', isFolder: true, childCount: 2 }]
      : [
        { id: 'v1', name: '20190712_204529_Fwd', isFolder: false, path: '/a.mp4' },
        { id: 'v2', name: 'Dive 1 forward', isFolder: false, path: '/b.mp4' },
      ]),
    getVideoClock: async (id) => clocks[id],
    // Copied out of the page's realm, so deepEqual compares values rather than prototypes.
    setVideoClock: async (body) => { calls.push(['clock', JSON.parse(JSON.stringify(body))]); return {}; },
    submitJob: async (body) => { calls.push(['job', body.spec.video.jellyfin_item_id]); return { jobs: [{ id: calls.length }] }; },
  });
  t.after(screen.close);
  await settle();

  const { document, window } = screen;
  for (const box of document.querySelectorAll('[data-video-choice] input[type="checkbox"]')) box.checked = true;
  document.querySelector('[data-add-targets]').click();
  await settle();
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

  const card = (id) => document.querySelector(`[data-target][data-video-id="${id}"]`);
  const run = async () => { document.getElementById('runBtn').click(); await settle(); };
  const status = () => document.querySelector('[data-fills="run-status"]').textContent;
  return { document, window, calls, card, run, status };
}

test('a card offers the file name\'s time, says where it came from, and Run sets it before queueing', async (t) => {
  const plan = await planWith(t, {
    v1: { recorded_start: null, suggested_start: '2019-07-12T20:45:29.000Z' },
    v2: { recorded_start: null, suggested_start: null },
  });

  const named = plan.card('v1');
  assert.match(named.querySelector('[data-target-start]').value, /^2019-07-12T20:45:29(\.000)?$/);
  assert.match(named.querySelector('[data-clock-state]').textContent, /file name/);

  // The other has nothing to offer, and says what that means for its times.
  const unnamed = plan.card('v2');
  assert.equal(unnamed.querySelector('[data-target-start]').value, '');
  assert.match(unnamed.querySelector('[data-clock-state]').textContent, /No clock: .*positions in the video/);

  await plan.run();

  assert.deepEqual(plan.calls[0], ['clock', { jellyfin_item_id: 'v1', start: '2019-07-12T20:45:29.000Z', source: 'file-name' }],
    'the clock is set first, accepted from the file name');
  assert.deepEqual(plan.calls.slice(1).map((call) => call[0]), ['job', 'job'], 'then the runs, and no clock for v2');
  assert.match(plan.status(), /1 video has no clock, so its times will be positions in the video/);
});

test('a typed start is sent as entered, and a clock already set is not sent again', async (t) => {
  const plan = await planWith(t, {
    v1: { recorded_start: null, suggested_start: '2019-07-12T20:45:29.000Z' },
    v2: { recorded_start: '2019-07-12T21:15:30.000Z', start_source: 'synced', suggested_start: null },
  });

  assert.match(plan.card('v2').querySelector('[data-target-start]').value, /^2019-07-12T21:15:30(\.000)?$/);
  assert.match(plan.card('v2').querySelector('[data-clock-state]').textContent, /already set/);

  const box = plan.card('v1').querySelector('[data-target-start]');
  box.value = '2019-07-12T20:45:31';
  box.dispatchEvent(new plan.window.Event('input', { bubbles: true }));
  assert.match(plan.card('v1').querySelector('[data-clock-state]').textContent, /Entered/);

  await plan.run();

  const clocks = plan.calls.filter((call) => call[0] === 'clock');
  assert.deepEqual(clocks, [['clock', { jellyfin_item_id: 'v1', start: '2019-07-12T20:45:31.000Z', source: 'entered' }]]);
  assert.doesNotMatch(plan.status(), /no clock/);
});
