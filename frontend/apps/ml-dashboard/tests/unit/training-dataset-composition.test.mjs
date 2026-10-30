/**
 * The Training tab shows the chosen dataset's own split and classes.
 *
 * #294. Under *Start from*, the counts followed the chosen dataset but the *Saved split*
 * and *Class distribution* below them were the mockup's literals -- a 70/20/10 bar and
 * California sea cucumber 3,418 -- whatever dataset was chosen. They are drawn now from
 * `GET /dataset/:id/composition`.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drawScreen, APP } from './screen.mjs';

const at = '2026-10-29T10:00:00.000Z';
const dataset = (id, name) => ({ id, name, status: 'ready', num_observations: 100, num_classes: 3, created_at: at, updated_at: at });

/** Two datasets that disagree about everything the panel shows. */
const COMPOSITIONS = {
  392: {
    splits: [
      { split: 'train', observations: 1067, images: 10179 },
      { split: 'validation', observations: 378, images: 3712 },
      { split: 'test', observations: 238, images: 2348 },
    ],
    classes: [],
    speciesSplits: [
      { species_id: 775, comname: 'California sea cucumber', split: 'train', observations: 437, images: 4685 },
      { species_id: 775, comname: 'California sea cucumber', split: 'test', observations: 95, images: 955 },
      { species_id: 790, comname: 'Fish-eating anemone', split: 'train', observations: 400, images: 4100 },
      { species_id: 789, comname: 'White-plumed anemone', split: 'train', observations: 230, images: 1394 },
    ],
  },
  50: {
    splits: [{ split: 'train', observations: 80, images: 900 }, { split: 'validation', observations: 20, images: 100 }],
    classes: [],
    speciesSplits: Array.from({ length: 10 }, (_, i) => ({
      species_id: i + 1, comname: `Rockfish ${String.fromCharCode(65 + i)}`, split: 'train', observations: 10, images: 100 - i,
    })),
  },
  7: { splits: [], classes: [], speciesSplits: [] },
};

async function trainingScreen() {
  return drawScreen('training.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listModels: async () => [],
    listTrainingRuns: async () => [],
    listDatasets: async () => [dataset(392, 'WP - FE - CUC (10 per object)'), dataset(50, 'Rockfish ten'), dataset(7, 'Legacy import')],
    datasetComposition: async (id) => COMPOSITIONS[id],
  });
}

async function choose(screen, id) {
  const select = screen.document.querySelector('#dataset-det');
  select.value = String(id);
  select.dispatchEvent(new screen.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
}

const panel = (screen) => ({
  split: screen.document.querySelector('[data-fills="dataset-split"]').textContent.replace(/\s+/g, ' '),
  count: screen.document.querySelector('[data-fills="dataset-class-count"]').textContent,
  classes: [...screen.document.querySelectorAll('[data-fills="dataset-classes"] .dist .k')].map((k) => k.textContent),
  values: [...screen.document.querySelectorAll('[data-fills="dataset-classes"] .dist .v')].map((v) => v.textContent),
});

test('two datasets draw their own split and classes', async (t) => {
  const screen = await trainingScreen();
  t.after(screen.close);

  await choose(screen, 392);
  let drawn = panel(screen);

  assert.deepEqual(drawn.classes, ['California sea cucumber', 'Fish-eating anemone', 'White-plumed anemone'], 'most first');
  assert.deepEqual(drawn.values, ['5,640', '4,100', '1,394'], 'summed across splits, in images');
  assert.equal(drawn.count, '(3, in images)');
  assert.match(drawn.split, /10,179/);
  assert.match(drawn.split, /train63%/, 'train is 10,179 of 16,239 images');

  await choose(screen, 50);
  drawn = panel(screen);

  assert.equal(drawn.classes.length, 8, 'the top eight');
  assert.equal(drawn.classes[0], 'Rockfish A');
  assert.equal(drawn.count, '(8 of 10, in images)', 'and how many there are');
  assert.match(drawn.split, /90%/);
  assert.doesNotMatch(drawn.split, /10,179/, 'nothing left over from the last dataset');
});

test('nothing plausible stands in before a choice, or for a dataset with no membership', async (t) => {
  const screen = await trainingScreen();
  t.after(screen.close);

  await choose(screen, '');
  assert.match(panel(screen).split, /Choose a dataset/);
  assert.deepEqual(panel(screen).classes, []);

  await choose(screen, 7);
  assert.match(panel(screen).split, /No membership was recorded/);
  assert.deepEqual(panel(screen).classes, []);
});

test('no literal species or split numbers remain in training.html', () => {
  const html = readFileSync(join(APP, 'training.html'), 'utf8');

  for (const literal of ['Sunflower star', 'California sea cucumber', '8,992', '2,569', '1,285', 'overlap groups', '(8 of 24)']) {
    assert.ok(!html.includes(literal), `"${literal}" is gone from the markup`);
  }
});
