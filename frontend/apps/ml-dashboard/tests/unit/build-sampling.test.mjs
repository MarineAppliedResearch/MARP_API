/**
 * Frames per object on the Datasets build flow: the control, the estimate, and what is sent.
 *
 * #296. Dataset 391 cut every frame of every track and an epoch on it took 1 h 40 min.
 * The build flow now takes *Frames per object* (default 10) and *Balance classes*, shows
 * how many images the build will cut before it is queued, and *Duplicate setup* carries
 * the setting -- seed and all -- so a rebuild at fewer frames is one edit.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** What the estimate route answers for dataset 391 at the defaults, near enough. */
const ESTIMATE = {
  observations: 1683,
  images: 17032,
  every_frame: 155258,
  per_split: { train: 13600, eval: 3432 },
  per_class: [
    { species_id: 1, comname: 'California sea cucumber', class_index: 0, images: 6830 },
    { species_id: 2, comname: 'Fish-eating anemone', class_index: 1, images: 6230 },
    { species_id: 3, comname: 'White-plumed anemone', class_index: 2, images: 3972 },
  ],
};

/** The Datasets screen, with one query's worth of answers and the two build calls recorded. */
async function datasetsScreen() {
  const calls = { estimate: [], queued: [] };

  const screen = await drawScreen('datasets.html', {
    listDatasets: async () => [],
    mosaicCounts: async () => ({ promoted: 1683 }),
    mosaicFacets: async () => ({
      species: [{ value: 1, label: 'California sea cucumber', count: 683 }],
      session: [{ value: 9, label: 'Dive 120', count: 1683 }],
    }),
    mosaicPages: async () => ({ pages: [{ rows: [] }] }),
    mosaicFrames: async () => ({ observations: 1683, keyframes: 3366, frames: 155258 }),
    estimateDatasetBuild: async (body) => {
      calls.estimate.push(JSON.parse(JSON.stringify(body)));
      return ESTIMATE;
    },
    queueDatasetBuild: async (body) => {
      calls.queued.push(JSON.parse(JSON.stringify(body)));
      return { dataset: { id: 400, status: 'building' }, job: { id: 22000, state: 'queued' } };
    },
  });

  return { ...screen, calls };
}

/** Fill the form the way Duplicate setup does, and let the debounced estimate land. */
async function duplicate(screen, sampling) {
  screen.document.dispatchEvent(new screen.window.CustomEvent('marp:duplicate-dataset-setup', {
    detail: { jobId: 21900, name: 'WP - FE - CUC', subsets: [{ filters: { session: [9] }, split: 'train' }], sampling },
  }));

  for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
}

test('the form starts at ten frames per object, spread across each track', async (t) => {
  const screen = await datasetsScreen();
  t.after(screen.close);

  const { document } = screen;

  assert.equal(document.querySelector('#dsframes').value, '10');
  assert.equal(document.querySelector('#dsevery').checked, false);
  assert.equal(document.querySelector('#dsbalance').checked, false);
  assert.equal(document.querySelector('[data-build-estimate]').hidden, true, 'no estimate before a query is added');
});

test('Duplicate carries the setting and its seed, and the estimate and the build send both', async (t) => {
  const screen = await datasetsScreen();
  t.after(screen.close);

  const { document, calls } = screen;
  const sampling = { frames_per_object: 6, balance_classes: true, seed: 77 };

  await duplicate(screen, sampling);

  assert.equal(document.querySelector('#dsframes').value, '6');
  assert.equal(document.querySelector('#dsbalance').checked, true);
  assert.equal(document.querySelector('#dsevery').checked, false);

  assert.ok(calls.estimate.length >= 1, 'the estimate was asked for');
  assert.deepEqual(calls.estimate.at(-1).sampling, sampling);

  const said = document.querySelector('[data-build-estimate]');
  assert.equal(said.hidden, false);
  assert.match(said.textContent, /will cut 17,032 images, 9\.1× fewer than every frame \(155,258\)/);
  assert.match(said.textContent, /California sea cucumber 6,830/);

  document.querySelector('[data-queue-build]').click();
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls.queued.length, 1);
  assert.deepEqual(calls.queued[0].sampling, sampling);
});

test('a dataset built before #296 duplicates as every frame, and changing N asks again', async (t) => {
  const screen = await datasetsScreen();
  t.after(screen.close);

  const { document, window, calls } = screen;

  await duplicate(screen, null);

  assert.equal(document.querySelector('#dsevery').checked, true);
  assert.equal(document.querySelector('#dsframes').disabled, true, 'nothing to set at every frame');
  assert.equal(calls.estimate.at(-1).sampling, null);

  // Rebuild it at ten: untick Every frame, and the estimate is asked again with N.
  const every = document.querySelector('#dsevery');
  every.checked = false;
  every.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls.estimate.at(-1).sampling, { frames_per_object: 10, balance_classes: false });
});

test('an opened dataset says how its frames were chosen', async (t) => {
  const set = {
    id: 400, name: 'WP - FE - CUC at ten', description: '', status: 'ready', source: 'ml-dashboard',
    num_samples: 17032, num_observations: 1683, num_classes: 3,
    created_at: '2026-10-29T10:00:00.000Z', updated_at: '2026-10-29T11:00:00.000Z',
  };
  const setups = {
    400: { jobId: 22000, name: set.name, subsets: [{ filters: {}, split: 'train' }], sampling: { frames_per_object: 10, balance_classes: true, seed: 77 } },
    401: { jobId: 21000, name: 'Old', subsets: [{ filters: {}, split: 'train' }], sampling: null },
  };

  const screen = await drawScreen('datasets.html', {
    listDatasets: async () => [set, { ...set, id: 401, name: 'Old' }],
    listDatasetBuilds: async () => [],
    datasetBuildSetup: async (id) => setups[id],
  });
  t.after(screen.close);

  const frames = async (id) => {
    const row = screen.document.querySelector(`#saved-datasets tbody > tr[data-dataset-id="${id}"]`);
    row.querySelector('.exbtn').click();
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    const terms = [...row.nextElementSibling.querySelectorAll('.kv dt')];
    return terms.find((dt) => dt.textContent === 'Frames')?.nextElementSibling.textContent;
  };

  assert.equal(await frames(400), '10 per object, spread across each track · classes balanced · seed 77');
  assert.equal(await frames(401), 'Every frame of every track');
});
