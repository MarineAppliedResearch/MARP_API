/**
 * What a poll does to the Datasets table, and what it must not do.
 *
 * **This tier exists because of one defect nothing here could observe.** Every poll
 * rebuilt the table and shut every expanded row, so a reader watching a four-hour build
 * had the row they were reading closed under them every twenty seconds. It was found by
 * eye and fixed in `c49990fd`, and could not be pinned: this app's checks are static —
 * syntax, style, markup, links — and none of them can see a redraw. A browser tier can,
 * but a browser tier is minutes and a server and is for finished features. So: jsdom,
 * the real `mock.js`, no server, no database, under two seconds.
 *
 * `mock.js` runs in jsdom as it stands. Five no-op shims below are the whole of what it
 * needed, and none of the render path was changed to make this testable.
 *
 * **Two halves, because the fix had two**, and each fails on its own:
 *
 * - the table is **not** rebuilt when a poll brings the same datasets in a different
 *   order — `GET /dataset` is `findAll()` with no ORDER BY and a build touches
 *   `updated_at` every few seconds, so a reordered answer for no real change is the
 *   normal case rather than a freak one;
 * - when it **is** rebuilt, because something genuinely changed, the row that was open
 *   is open afterwards.
 *
 * A redraw replaces `tbody.innerHTML`, so "was it rebuilt" is asked as node identity
 * rather than by counting rows: the same `<tr>` object still being in the document is
 * exactly what survives one and not the other.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `DATASET_POLL_MS` in `mock.js`. Read from the source so the two cannot drift. */
const DATASET_POLL_MS = Number(
  /DATASET_POLL_MS = (\d+)/.exec(readFileSync(join(APP, 'mock.js'), 'utf8'))?.[1]);

/** One dataset, with the columns the table reads. */
const dataset = (id, name, status, extra = {}) => ({
  id,
  name,
  description: `${name} description`,
  status,
  num_samples: 1000 + id,
  num_observations: 2000 + id,
  num_classes: 4,
  created_at: `2026-10-2${id % 10}T10:00:00.000Z`,
  updated_at: '2026-10-22T10:00:00.000Z',
  ...extra,
});

/** A build in flight against one of them. `leased` is what keeps the poller running. */
const build = (datasetId, state = 'leased') => ({
  job_id: 900 + datasetId,
  dataset_id: datasetId,
  state,
  progress_done: 120,
  progress_total: 1000,
  progress_phase: 'extracting',
  updated_at: '2026-10-22T10:00:00.000Z',
});

/**
 * Boot the Datasets screen in jsdom against an answer the test controls.
 *
 * **`window.MarpApi` is the seam, and it is the app's own.** `api.js` is what normally
 * defines it; the screen only ever reaches for `window.MarpApi`, so standing something
 * else there is using the boundary rather than inventing one. It has to be a stub rather
 * than `?mock=all` for a specific reason: the regression *is* the same datasets arriving
 * in a different order, and the built-in corpus answers in a stable one, so it cannot
 * express the case.
 *
 * Everything the stub does not name answers 404, which the screen already draws honestly
 * — the point here is the table, and a screen whose pickers failed to fill is still a
 * screen whose table can be watched.
 *
 * @param {Object} answers - `{datasets, builds}`, read afresh on every call.
 * @returns {Promise<Object>} The window, and the controls the tests need.
 */
async function openDatasetsScreen(answers) {
  const html = readFileSync(join(APP, 'datasets.html'), 'utf8')
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');

  const dom = new JSDOM(html, {
    url: 'http://localhost/apps/ml-dashboard/datasets.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });

  const { window } = dom;

  /* What jsdom does not implement. Five are things the screen does *to* a browser rather
     than things it asks one, so a no-op is the honest stand-in. `CSS.escape` is the odd
     one out -- it is a real function with a real answer, and the reopen path uses it to
     look a row up by id, so it gets a real enough one. */
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, finish() {} });
  window.scrollTo = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.CSS = { escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`) };

  /* **A clock the test turns, because waiting out the real one is not a test.**
     The screen polls every five seconds, and the first version of this file took sixteen
     seconds for three assertions -- it was not driving anything, it was sitting through
     the interval and reading what happened. Worse, it looked like it was driving:
     `marp:dataset-build-queued` only schedules a poll when none is already scheduled, and
     one always is while a build runs, so the event did nothing at all.

     So time is a thing the test advances. Only the timer functions are replaced; promises
     resolve by themselves, which is why `advance` hands control back to the real event
     loop between callbacks -- `refresh` awaits two of them before it touches the DOM. */
  const realSetTimeout = window.setTimeout.bind(window);
  const queue = new Map();
  let now = 0;
  let nextId = 1;

  window.setTimeout = (fn, delay = 0) => {
    const id = nextId++;
    queue.set(id, { at: now + Number(delay || 0), fn, every: null });
    return id;
  };
  window.setInterval = (fn, delay = 0) => {
    const id = nextId++;
    queue.set(id, { at: now + Number(delay || 0), fn, every: Number(delay || 0) || 1 });
    return id;
  };
  window.clearTimeout = (id) => { queue.delete(id); };
  window.clearInterval = (id) => { queue.delete(id); };

  /** Let anything already resolved actually run. */
  const drain = () => new Promise((resolve) => realSetTimeout(resolve, 0));

  /**
   * Move the clock, running what falls due, oldest first.
   *
   * @param {number} ms - How far.
   * @returns {Promise<void>}
   */
  const advance = async (ms) => {
    const until = now + ms;

    for (let guard = 0; guard < 1000; guard += 1) {
      let due = null;

      for (const [id, entry] of queue) {
        if (entry.at <= until && (!due || entry.at < due[1].at)) due = [id, entry];
      }

      if (!due) break;

      const [id, entry] = due;

      now = Math.max(now, entry.at);

      if (entry.every) entry.at = now + entry.every;
      else queue.delete(id);

      entry.fn();
      /* The callback may be async: everything it awaits settles here, before the next
         due callback runs, so the order the page sees is the order a browser gives it. */
      await drain();
    }

    now = until;
  };

  window.MarpApi = new Proxy({
    listDatasets: async () => answers.datasets.map((set) => ({ ...set })),
    listDatasetBuilds: async () => answers.builds.map((one) => ({ ...one })),
  }, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== 'string') return undefined;
      /* Anything else: the ordinary not-found the screen is already written to survive. */
      return async () => { throw Object.assign(new Error(`no stub for ${name}`), { status: 404 }); };
    },
  });

  const script = window.document.createElement('script');
  script.textContent = readFileSync(join(APP, 'mock.js'), 'utf8');
  window.document.body.appendChild(script);

  /* The first draw is already in flight on real promises; let it finish. */
  await drain();
  await drain();

  return {
    window,
    document: window.document,
    rows: () => [...window.document.querySelectorAll('#saved-datasets tbody > tr[data-dataset-id]')],
    row: (id) => window.document.querySelector(`#saved-datasets tbody > tr[data-dataset-id="${id}"]`),

    /**
     * Let the next poll fall due.
     *
     * **Nothing was added to the page to make this reachable.** `poll` is private to
     * `wireDatasetPage` and stays private; it is already on a timer, so moving the clock
     * past the interval is how a browser would reach it too. `marp:dataset-build-queued`
     * looked like the seam and is not -- it schedules a poll only when none is scheduled,
     * and while a build runs one always is.
     *
     * @returns {Promise<void>}
     */
    poll: () => advance(DATASET_POLL_MS + 1),

    /** The one-second clock, for a test about what it moves. */
    tick: (seconds = 1) => advance(seconds * 1000),

    /* jsdom keeps its own timers otherwise, and `node --test` waits for them. */
    close: () => window.close(),
  };
}

test('a poll that brings the same datasets in a different order leaves the table alone', async (t) => {
  const answers = {
    datasets: [dataset(1, 'Sea Cucumber v2', 'building'), dataset(2, 'Rockfish v3', 'ready')],
    builds: [build(1)],
  };

  const screen = await openDatasetsScreen(answers);
  t.after(screen.close);

  const before = screen.row(1);
  assert.ok(before, 'the building dataset should have a row to start with');

  /* Open it, by the gesture a reader uses. */
  before.querySelector('.exbtn').click();
  assert.equal(before.getAttribute('aria-expanded'), 'true', 'clicking the expander should open the row');

  /* **What the database actually does.** `GET /dataset` has no ORDER BY, and an UPDATE
     writes a new tuple at the end of the heap -- so the row a build is touching moves in
     this answer every time it reports progress. Nothing about the datasets changed. */
  answers.datasets = [answers.datasets[1], answers.datasets[0]];

  await screen.poll();

  assert.equal(screen.row(1), before,
    'the same <tr> should still be in the document: a redraw replaces tbody.innerHTML, so a '
    + 'new node here means the table was rebuilt for a reordered answer that said nothing new');
  assert.equal(before.getAttribute('aria-expanded'), 'true',
    'and the row a reader had open should still be open');
});

test('a poll that genuinely changes something redraws, and reopens the row that was open', async (t) => {
  const answers = {
    datasets: [dataset(1, 'Sea Cucumber v2', 'building'), dataset(2, 'Rockfish v3', 'ready')],
    builds: [build(1)],
  };

  const screen = await openDatasetsScreen(answers);
  t.after(screen.close);

  const before = screen.row(1);
  before.querySelector('.exbtn').click();
  assert.equal(before.getAttribute('aria-expanded'), 'true');

  /* The build finishes. This is a real change and the table should be rebuilt -- and it
     is the exact moment somebody is watching that row. */
  answers.datasets = [dataset(1, 'Sea Cucumber v2', 'ready'), dataset(2, 'Rockfish v3', 'ready')];
  answers.builds = [build(1, 'succeeded')];

  await screen.poll();

  const after = screen.row(1);

  assert.ok(after, 'the dataset should still have a row');
  assert.notEqual(after, before, 'a state change should rebuild the table -- otherwise the pill would lie');
  assert.equal(after.getAttribute('aria-expanded'), 'true',
    'and the rebuild should reopen it: the markup is new, so aria-expanded belonged to a node that is gone');

  const detail = after.nextElementSibling;

  assert.ok(detail?.classList.contains('dataset-row-detail'), 'the reopened row should have its detail panel');
  assert.equal(detail.hidden, false, 'which should be visible, not merely present');
});

test('a poll that changes nothing leaves the running pill in place', async (t) => {
  /* Free with the harness, and it was a real defect: the pill carries the animation that
     says the build is alive, so a rebuild that dropped or restarted it is visible to a
     reader as a stutter and invisible to every static check. */
  const answers = {
    datasets: [dataset(1, 'Sea Cucumber v2', 'building')],
    builds: [build(1)],
  };

  const screen = await openDatasetsScreen(answers);
  t.after(screen.close);

  const pill = screen.row(1).querySelector('.pill[data-state="running"]');

  assert.ok(pill, 'a leased build should draw a running pill');

  await screen.poll();

  assert.equal(screen.row(1).querySelector('.pill[data-state="running"]'), pill,
    'the same pill element should survive a poll that changed nothing');
});

test('the headline cards count the rows that are actually drawn', async (t) => {
  /* Also free with the harness, and the third thing that went wrong today: the cards and
     the table read the same two answers, so a disagreement between them is always a bug
     in one of the two and always invisible to a check that cannot draw the page.

     One dataset in each state the screen distinguishes, so a card that counted the wrong
     bucket cannot pass by coincidence. */
  const answers = {
    datasets: [
      dataset(1, 'Building', 'building'),
      dataset(2, 'Queued', 'draft'),
      dataset(3, 'Ready', 'ready'),
      dataset(4, 'Failed', 'failed'),
      dataset(5, 'Also ready', 'ready'),
    ],
    builds: [build(1, 'leased'), build(2, 'queued')],
  };

  const screen = await openDatasetsScreen(answers);
  t.after(screen.close);

  /** What a card says, by the label beside it. */
  const card = (label) => {
    const found = [...screen.document.querySelectorAll('.stats .stat')]
      .find((one) => one.querySelector('.stat-lab')?.textContent.trim() === label);

    return Number(found?.querySelector('.stat-num')?.textContent.trim());
  };

  /** How many rows the table actually drew in one state. */
  const drawn = (status) => screen.rows().filter((row) => row.dataset.datasetStatus === status).length;

  assert.equal(drawn('building'), 1, 'the fixture should draw one building row');

  assert.equal(card('Building now'), drawn('building'), 'Building now should count the building rows');
  assert.equal(card('Queued builds'), drawn('queued'), 'Queued builds should count the queued rows');
  assert.equal(card('Ready datasets'), drawn('ready'), 'Ready datasets should count the ready rows');
  assert.equal(card('Needs attention'), drawn('attention'), 'Needs attention should count the failed rows');
});
