/**
 * An Inference row opens onto what it found (#288).
 *
 * Isaac, on 2026-10-28: *"our inference jobs quit showing what has been found and how many
 * of each thing has been identified"*. They never had: the Jobs tab's findings panel was
 * the mockup's, the same species and counts on every job, and #279 took it out. The real
 * counts come from `GET /gpu/jobs/:id/observations` for a piece and
 * `GET /gpu/batches/:batch_id/observations` for its whole run.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const RUN = '6f1c2a0e-1111-4222-8333-944455556666';
const now = new Date().toISOString();

/** An inference job the shape the Inference table reads. */
const job = (id, state, extra = {}) => ({
  id, kind: 'inference', name: `Piece ${id}`, state, priority: 0, attempts_made: 1, max_attempts: 3,
  batch_id: RUN, spec: { session: { session_id: 641 }, model: { ml_model_id: 7 } },
  progress_done: null, progress_total: null, created_at: now, updated_at: now, finished_at: state === 'queued' ? null : now,
  ...extra,
});

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

/**
 * Draw the Inference tab over some jobs, counting the reads each row makes.
 *
 * @param {Object[]} jobs - The list.
 * @param {Object} answers - `{piece, run}` outcomes to answer with.
 * @returns {Promise<Object>} The screen, plus `asked`.
 */
async function inferenceScreen(jobs, answers) {
  const asked = { piece: [], run: [] };
  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
    jobObservations: async (id) => { asked.piece.push(id); return answers.piece(id); },
    batchObservations: async (batch) => { asked.run.push(batch); return answers.run; },
  });
  return { ...screen, asked };
}

/** Open a row and return its detail. */
async function open(screen, id) {
  const head = screen.document.querySelector(`.inference-table tbody tr[data-job="${id}"]`);
  head.querySelector('.exbtn').click();
  await settle();
  return head.nextElementSibling;
}

/** The lines of one findings list, as `name count`. */
const lines = (section) => [...section.querySelectorAll('.findlist li')]
  .map((li) => `${li.querySelector('b').textContent} ${li.querySelector('strong').textContent}`);

test('a finished piece shows its species, and its run what all the pieces found so far', async (t) => {
  const screen = await inferenceScreen([job(10, 'succeeded'), job(11, 'queued')], {
    piece: () => ({
      job_id: 10, session_id: 641, observations: 5,
      species: [
        { species_id: 3, species_name: 'Rockfish', reported_name: 'Rockfish', observations: 3 },
        /* Corrected in review: the model said Lingcod, a reviewer said Rockfish. */
        { species_id: 3, species_name: 'Rockfish', reported_name: 'Lingcod', observations: 1 },
        { species_id: null, species_name: null, reported_name: 'blob', observations: 1 },
      ],
    }),
    run: {
      batch_id: RUN, pieces: 82, states: { succeeded: 70, queued: 12 }, session_ids: [641], session_id: 641,
      observations: 412, species: [
        { species_id: 3, species_name: 'Rockfish', reported_name: 'Rockfish', observations: 400 },
        { species_id: 9, species_name: 'Sea star', reported_name: 'Sea star', observations: 12 },
      ],
    },
  });

  t.after(screen.close);

  const detail = await open(screen, 10);
  const [piece, run] = detail.querySelectorAll('.findings');

  assert.match(piece.textContent, /5 observations/);
  assert.deepEqual(lines(piece), ['Rockfish 4', 'blob 1'],
    'one line per species, the corrected one counted under what it is, and an unresolved one kept');
  assert.match(piece.textContent, /reported as Lingcod/, 'with what the model called it, where that differs');

  assert.match(run.querySelector('h4').textContent, /The whole run · 82 pieces/);
  assert.match(run.textContent, /412 observations/);
  assert.match(run.textContent, /70 of 82 finished, so far/, 'a run still going is a total so far, and says so');
  assert.deepEqual(lines(run), ['Rockfish 400', 'Sea star 12']);

  assert.equal(detail.querySelector('.findings-go a').getAttribute('href'), '/apps/marp-mosaic-review/?session=641',
    'and one link to review them in the mosaic');
  assert.deepEqual(screen.asked.run, [RUN], 'the run is one read, not one per piece');
});

test('a piece that found nothing says 0, rather than nothing', async (t) => {
  const screen = await inferenceScreen([job(20, 'succeeded', { batch_id: null })], {
    piece: () => ({ job_id: 20, session_id: 641, observations: 0, species: [] }),
  });

  t.after(screen.close);

  const detail = await open(screen, 20);

  assert.match(detail.querySelector('.findings').textContent, /0 observations/);
  assert.equal(detail.querySelectorAll('.findings').length, 1, 'no run section for a job that is not part of one');
  assert.equal(detail.querySelector('.findings-go'), null, 'and nothing to review');
});

test('a queued piece is not asked about, and says it has not run', async (t) => {
  const screen = await inferenceScreen([job(30, 'queued', { batch_id: null })], { piece: () => { throw new Error('asked'); } });

  t.after(screen.close);

  const detail = await open(screen, 30);

  assert.match(detail.textContent, /Not run yet/);
  assert.deepEqual(screen.asked.piece, [], 'nothing read for a piece with nothing to read');
});

test('a row has its expander, and no Open arrow that opens nothing', async (t) => {
  const screen = await inferenceScreen([job(40, 'succeeded', { batch_id: null })], {
    piece: () => ({ job_id: 40, observations: 0, species: [] }),
  });

  t.after(screen.close);

  const row = screen.document.querySelector('.inference-table tbody tr[data-job="40"]');

  assert.ok(row.querySelector('.exbtn'));
  assert.equal(row.querySelector('[aria-label="Open"]'), null);
});
