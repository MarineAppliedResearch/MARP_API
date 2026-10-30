/**
 * Cancel on the Jobs screen, and what a job's row claims about itself.
 *
 * Found by Isaac on 2026-10-28 (#279): he ticked the pieces of a run, pressed Cancel, and
 * nothing happened -- the bulk bar's Cancel, the row's stop icon and the expanded job's
 * Cancel had no handler between them. Opening a queued piece then showed "Queue position
 * #3 of 8 queued" beside 82 queued, "Waiting 8m 21s", "Priority 5" on a priority-0 job and
 * "12 GB GPU": literals from the mockup, the same on every job.
 *
 * `window.confirm` is the seam, as in job-delete-confirmation: jsdom's throws, so a
 * dialog this file did not expect cannot pass silently.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const RUN = '6f1c2a0e-1111-4222-8333-944455556666';

/** A job the shape `rowFor` reads. */
const job = (id, state, extra = {}) => ({
  id,
  batch_id: RUN,
  kind: 'inference',
  name: `Piece ${id}`,
  spec: { range: { start_frame: 0, end_frame: 7500 } },
  state,
  priority: 0,
  attempts_made: 0,
  max_attempts: 3,
  workers_used: 0,
  worker_name: null,
  worker_id: null,
  created_by: null,
  created_at: '2026-10-28T20:00:00.000Z',
  updated_at: '2026-10-28T20:00:00.000Z',
  progress_done: null,
  progress_total: null,
  ...extra,
});

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

/**
 * Draw the Jobs screen over some jobs, recording every cancel it asks for.
 *
 * @param {Object[]} jobs - The list.
 * @param {Object} [more] - Extra stubs.
 * @returns {Promise<Object>} The screen, plus `asked` (cancelJobs bodies) and `lists`.
 */
async function jobsScreen(jobs, more = {}) {
  const asked = [];
  let lists = 0;
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => { lists += 1; return { jobs, total: jobs.length, limit: 500, offset: 0 }; },
    listSessions: async () => [],
    cancelJobs: async (body) => {
      /* Through JSON, because the body is built in the page's realm and deepEqual
         compares prototypes. */
      asked.push(JSON.parse(JSON.stringify(body)));
      return { cancelled: 1, skipped: [{ id: 2, reason: 'already succeeded' }] };
    },
    ...more,
  });
  screen.window.confirm = () => true;
  return { ...screen, asked, lists: () => lists };
}

test('ticked jobs are cancelled together, and the screen says what happened', async () => {
  const screen = await jobsScreen([job(1, 'queued'), job(2, 'succeeded')]);
  const { document } = screen;

  for (const box of document.querySelectorAll('#jobs tbody .chkbox')) {
    box.checked = true;
    box.dispatchEvent(new screen.window.Event('change'));
  }
  const before = screen.lists();
  document.querySelector('#bulkCancel').click();
  await settle();

  assert.equal(screen.asked.length, 1, 'one request');
  assert.deepEqual(screen.asked[0].ids.sort(), [1, 2], 'naming every ticked job');
  assert.equal(document.querySelector('#jobsDeleteSaid').textContent,
    'Cancelled 1 job. Skipped 1: 1 already succeeded.');
  assert.ok(screen.lists() > before, 'the table is drawn again, so the rows show their new state');
  screen.close();
});

test('the bulk Cancel works a second time without a reload', async () => {
  const screen = await jobsScreen([job(1, 'queued'), job(3, 'queued')]);
  const { document } = screen;
  const tick = (id) => {
    const box = document.querySelector(`#jobs tbody tr[data-job="${id}"] .chkbox`);
    box.checked = true;
    box.dispatchEvent(new screen.window.Event('change'));
  };

  tick(1);
  document.querySelector('#bulkCancel').click();
  await settle();

  /* Isaac's case: the button stayed greyed after the first one succeeded. */
  assert.equal(document.querySelector('#bulkCancel').disabled, false, 'ready for the next selection');
  tick(3);
  document.querySelector('#bulkCancel').click();
  await settle();

  assert.deepEqual(screen.asked, [{ ids: [1] }, { ids: [3] }]);
  screen.close();
});

test('the row stop icon cancels its own job', async () => {
  const screen = await jobsScreen([job(1, 'leased')]);

  screen.document.querySelector('#jobs tbody tr[data-job="1"] [data-cancel-job]').click();
  await settle();

  assert.deepEqual(screen.asked, [{ ids: [1] }]);
  screen.close();
});

test('a piece of a run can cancel the whole run from its row', async () => {
  /* It was in the expanded detail, which Jobs rows no longer have (#291). */
  const screen = await jobsScreen([job(1, 'queued')]);
  const whole = screen.document.querySelector('#jobs tbody tr[data-job="1"] [data-cancel-run]');

  assert.ok(whole, 'a queued piece of a run offers to cancel the run');
  whole.click();
  await settle();

  assert.deepEqual(screen.asked, [{ batch_id: RUN }], 'the run is named by batch_id, not listed');
  screen.close();
});

test('the bulk bar offers nothing that has no API behind it', async () => {
  const screen = await jobsScreen([job(1, 'queued')]);
  const labels = [...screen.document.querySelectorAll('#bulk button')].map((b) => b.textContent.trim());

  assert.deepEqual(labels, ['Cancel', 'Delete', 'Clear selection']);
  screen.close();
});

/* Every literal the mockup drew into an expanded job, in any state. */
const INVENTED = [/of 8 queued/, /8m 21s/, /12 GB/, /24 GB/, /RTX 4090/, /mAP@50/, /12m 04s/, /11\.9 fps/,
  /CUDA out of memory/, /itravers/, /12:36:5/, /Worker stopped responding/, /campa-lab/, /bergstrom/,
  /Learning dynamics/, /Findings so far/, /Final findings/, /Rockfish/, /21 \/ 21/, /412/];

for (const state of ['queued', 'leased', 'failed', 'succeeded', 'cancelled', 'expired']) {
  test(`a ${state} job's row carries no invented measurement, and does not expand`, async () => {
    /* #291: the row links to the job's own screen rather than opening a detail here. */
    const screen = await jobsScreen([job(5, state, {
      batch_id: null, priority: 0, attempts_made: state === 'queued' ? 0 : 1, worker_name: state === 'queued' ? null : 'ABYSS',
    })]);

    const head = screen.document.querySelector('#jobs tbody tr[data-job="5"]');
    const text = head.textContent;

    for (const literal of INVENTED) assert.doesNotMatch(text, literal, `${state}: ${literal} is not about this job`);
    assert.equal(head.querySelector('.exbtn'), null, 'no expander');
    assert.equal(screen.document.querySelectorAll('#jobs tbody tr.runrow-body').length, 0, 'no detail row');
    assert.equal(head.querySelector('.jname a')?.getAttribute('href'), './inference.html?job=5',
      'the name opens the job on Inference');
    screen.close();
  });
}