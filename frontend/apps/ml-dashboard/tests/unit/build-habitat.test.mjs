/**
 * Habitat substrates on the Datasets build flow (#287).
 *
 * Ticking it queues a habitat build: the same queries, task `habitat`, and nothing about
 * splits or frames per object, which a habitat build decides itself. Frames per object
 * and its estimate are put away while it is ticked, and the reason shown instead.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async (n = 30) => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test('a habitat build sends the queries and task habitat, and no sampling', async (t) => {
  const queued = [];
  const screen = await drawScreen('datasets.html', {
    listDatasets: async () => [],
    mosaicCounts: async () => ({ promoted: 12 }),
    mosaicFacets: async () => ({ session: [{ value: 9, label: 'Dive 5', count: 12 }] }),
    mosaicPages: async () => ({ pages: [{ rows: [] }] }),
    mosaicFrames: async () => ({ observations: 12, keyframes: 24, frames: 400 }),
    estimateDatasetBuild: async () => ({ observations: 12, images: 40, every_frame: 400, per_split: {}, per_class: [] }),
    queueDatasetBuild: async (body) => {
      queued.push(JSON.parse(JSON.stringify(body)));
      return { dataset: { id: 500, status: 'building' }, job: { id: 23000, state: 'queued' } };
    },
  });
  t.after(screen.close);

  const { document, window } = screen;
  document.dispatchEvent(new window.CustomEvent('marp:duplicate-dataset-setup', {
    detail: { jobId: 1, name: 'CAMPA habitat', subsets: [{ filters: { session: [9] }, split: 'train' }], sampling: null },
  }));
  await settle(40);

  const box = document.querySelector('#dshabitat');
  assert.equal(box.checked, false);
  assert.equal(document.querySelector('[data-habitat-hint]').hidden, true);

  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('.build-sampling').hidden, true, 'frames per object is put away');
  assert.equal(document.querySelector('[data-habitat-hint]').hidden, false, 'and what a habitat build takes is said');

  document.querySelector('[data-queue-build]').click();
  await settle(6);

  assert.equal(queued.length, 1);
  assert.equal(queued[0].task, 'habitat');
  assert.equal(queued[0].subsets.length, 1, 'the query goes as it would for any build');
  assert.equal(queued[0].sampling, undefined);
  assert.equal(queued[0].splits, undefined);
});
