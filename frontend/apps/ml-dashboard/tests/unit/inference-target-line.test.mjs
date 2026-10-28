/**
 * A video added to the run plan can be given its line on its own card.
 *
 * The line was read from the picker only at the moment of Add, so a video added before
 * its line was typed sat at "Line not assigned" with nowhere to put one, and the Run
 * refused it: *"20190712_204529_Fwd has no line. Enter one on the card and save it."*
 * Isaac: *"it doesn't allow me to type a line number in for the individual video"*.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test('a card added without a line takes one typed on the card', async (t) => {
  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listVideoLibraries: async () => [{ id: 'p1', name: 'CAMPA2019', childCount: 1 }],
    listVideoChildren: async (id) => (id === 'p1'
      ? [{ id: 'd1', name: 'Dive01', isFolder: true, childCount: 1 }]
      : [{ id: 'v1', name: '20190712_204529_Fwd', mediaType: 'Video', type: 'Video', isFolder: false, path: '/x.mp4' }]),
  });

  t.after(screen.close);
  await settle();

  const { document, window } = screen;
  const choice = document.querySelector('[data-video-choice]');

  assert.ok(choice, 'the video was offered');

  // Added with its line left blank, which is the order a person does it in.
  document.querySelector('[data-add-targets]').click();

  const card = document.querySelector('[data-target][data-video-id="v1"]');
  const box = card && card.querySelector('[data-target-line]');

  assert.ok(box, 'the card has a Line box of its own');
  assert.equal(card.dataset.videoLine, '');

  box.value = '4';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.equal(card.dataset.videoLine, '4', 'which is what the submission reads');
  assert.equal(card.querySelector('.mini-thumb').textContent, 'L4', 'and the badge says so');
});
