/**
 * `src/data.js` at depth: the scale factor, and the page-set call.
 *
 * These are rules, not renderings — what a page holds, in what order, how deep the set
 * goes, what the page-set contract answers — so they belong in the tier that costs
 * nothing and therefore actually gets run. Nothing here needs a browser.
 *
 *   node --test frontend/apps/marp-mosaic-review/tests/unit/
 *
 * **The reference implementation below is the point of this file.** `query()` and
 * `queryPages()` now share one piece of machinery that also has to scale, and the only
 * way to know it still answers what `query()` answered before is to compare it against
 * something that is not it. A test that compares the app to itself cannot see a moved
 * number, and the counts in `tests/requirements.js` and `tests/e2e/render.spec.mjs` are
 * measured against this fixture deliberately.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = readFileSync(join(APP, 'fixtures', 'observations.json'), 'utf8');

/* `data.js` loads the fixture with `fetch` against a relative URL — which is what a
   browser does and what node cannot. Standing a reader in for it is the whole of what
   lets this tier see this file at all, and it keeps the stub in the test rather than
   putting a test-shaped door in `data.js`. */
globalThis.fetch = async (url) => {
  if (!String(url).endsWith('observations.json')) throw new Error(`unexpected fetch: ${url}`);
  return { ok: true, status: 200, json: async () => JSON.parse(RAW) };
};

/* One parse for the reference and the lookups, which never mutate what they read.
   `reload` still parses fresh rows every time, because that isolation is the point. */
const PRISTINE = JSON.parse(RAW);

const { MarpData } = await import('../../src/data.js');
const { matchesFilters, unanswerable } = await import('../../src/model/match.js');
const { sortTerms } = await import('../../src/model/filters.js');

/**
 * Commit a set of served rows, in the shape the endpoint takes.
 *
 * `commitPage({ mode, observationIds, marks })` is gone: the three commit routes require
 * `observations: [{ observation_id, version }]` and **refuse a request that omits a
 * version** -- "a missing version is a 400, never an implicit overwrite" (F4, A7, R7). The
 * store passes the rows it is holding, so the version travels with the thing the reviewer
 * looked at; these tests do the same.
 *
 * @param {string} mode - The reviewing mode.
 * @param {Array<Object>} rows - Served rows, each carrying its own `version`.
 * @param {Map} [marks] - The exception set.
 * @returns {Promise<Object>} The commit result.
 */
const commit = (mode, rows, marks = new Map()) =>
  MarpData.commitPage({ mode, rows, marks });

/* ------------------------------------------------------- the reference implementation */

/**
 * What `query()` did before this task, written out again from the fixture: everything
 * not deleted, then the rail, then the exclusion set, then the two status dimensions,
 * then the reviewer's sort terms with `observation_id` appended unconditionally, then a
 * slice. Deliberately not a call into the new machinery.
 */
function reference({ filters = {}, sort, page = 1, pageSize = 45 }, observations) {
  const alive = observations.filter((r) => !r.deleted);
  let rows = alive.filter((r) => matchesFilters(filters, r));

  const excludedForNoDate = unanswerable(filters, alive);

  if (filters.excludeIds && filters.excludeIds.size) {
    rows = rows.filter((r) => !filters.excludeIds.has(r.observation_id));
  }
  /* The row carries the schema's `review_decision` / `training_decision`, where the
     **neutral state is null** -- the absence of a review record -- while the *filter*
     vocabulary still spells that `'unreviewed'` / `'undecided'`, exactly as
     `MosaicQueryFilters` does. This reference held the fixture's old private vocabulary on
     both sides, so it agreed with a fixture that agreed with nothing (F3). */
  const decided = (value, neutral) => (value == null ? neutral : value);
  if (filters.reviewStatus && filters.reviewStatus.length) {
    rows = rows.filter((r) =>
      filters.reviewStatus.includes(decided(r.review_decision, 'unreviewed')));
  }
  if (filters.trainingDisposition && filters.trainingDisposition.length) {
    rows = rows.filter((r) =>
      filters.trainingDisposition.includes(decided(r.training_decision, 'undecided')));
  }

  const terms = sortTerms(sort);
  rows = rows.slice().sort((a, b) => {
    for (const term of terms) {
      const x = a[term.field], y = b[term.field];
      if (x !== y) return (x > y ? 1 : -1) * (term.dir === 'desc' ? -1 : 1);
    }
    return a.observation_id - b.observation_id;
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  return {
    ids: rows.slice(start, start + pageSize).map((r) => r.observation_id),
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    excludedForNoDate
  };
}

/**
 * A pristine fixture at a chosen depth, and the base rows the reference reads.
 *
 * Reloading between checks matters here for the same reason it does in
 * `tests/requirements.js`: commits mutate rows, so a suite running many checks against
 * one fixture is running each of them against whatever the last one left behind.
 */
async function fixtureAt(scale) {
  await MarpData.reload();          // fresh rows, and it drops every simulated edit
  MarpData.setScale(scale);
  return PRISTINE.observations;
}

const ids = (rows) => rows.map((r) => r.observation_id);

/**
 * Every call this file makes pays the fixture's deliberate 140 ms `LATENCY.query`, and
 * this is the unit tier — the one that runs after every change. So independent calls are
 * issued together rather than one after another: the latency is a timer, so twelve of
 * them in flight cost one. **Nothing is traded away for that.** Where a check has to see
 * the effect of a write, it stays sequential.
 */
const all = (xs, fn) => Promise.all(xs.map(fn));

/**
 * The simulated network is off for every check here, and put back on before each one.
 *
 * `LATENCY.query` is 140 ms deliberately, and paying it ~180 times made this file eight
 * seconds of a tier that is supposed to be the working loop. **No assertion was given up
 * for that**: the calls are the same calls, and what is skipped is the waiting.
 *
 * `beforeEach` rather than a one-off at the top, so a check that needs the real latency
 * turns it off for itself and cannot leave it off for the next one. And it is per test
 * *file*: `node --test` gives each file its own process, so nothing here can reach
 * another file — or, because `withoutLatency` refuses to act in a browser, any tier that
 * has one.
 */
beforeEach(() => { MarpData.withoutLatency(); });

/** The questions worth asking, each exercising a different part of the filter set. */
const QUESTIONS = [
  { name: 'nothing selected', q: {} },
  {
    name: 'the default question',
    q: { filters: { species: ['Bat Star'], reviewStatus: ['unreviewed'], trainingDisposition: [] } }
  },
  {
    name: 'a borrowed status dimension narrowed',
    q: { filters: { trainingDisposition: ['promoted', 'excluded'] } }
  },
  {
    name: 'a project and a dive',
    q: { filters: { project: ['Deep Reef Survey 2025'], dive: ['D04'] } }
  },
  {
    name: 'a confidence range',
    q: { filters: { confidence: { from: 0.2, to: 0.6 } } }
  },
  {
    name: 'a time-of-day window that wraps midnight',
    q: { filters: { timeOfDay: { from: '22:00', to: '02:00' } } }
  },
  {
    name: 'a date range no row can answer',
    q: { filters: { date: { from: '2026-08-01', to: null } } }
  },
  {
    name: 'track length, longest first',
    q: { sort: { field: 'keyframe_count', dir: 'desc', then: null } }
  },
  {
    name: 'observation number, highest first',
    q: { sort: { field: 'obsID', dir: 'desc', then: null } }
  },
  {
    name: 'last updated with a secondary term',
    q: { sort: { field: 'updatedAt', dir: 'asc', then: { field: 'obsID', dir: 'desc' } } }
  },
  {
    name: 'a model, sorted by confidence high first',
    q: { filters: { model: ['BatStarNet v3.2'] }, sort: { field: 'confidence', dir: 'desc', then: null } }
  }
];

/* ------------------------------------------------------------------- the default scale */

test('the scale defaults to 1, so nothing that existed sees a different fixture', () => {
  assert.equal(MarpData.scale(), 1,
    'a default above 1 would move every count measured against this fixture');
});

test('the latency override refuses to act in a browser (R1)', async () => {
  /* This is the check that makes the no-leak claim a fact rather than a convention.
     `render.spec.mjs` proves the reviewer does not wait, and it can only prove that
     against the real 140 ms — so if the override ever reached a browser tier, those tests
     would pass showing a grid with no spinner because there was nothing to wait for.
     Green, and proving nothing, and invisible. `typeof window` is the whole gate, so
     standing a `window` up here exercises exactly the path Playwright would take. */
  await fixtureAt(1);
  assert.equal(MarpData.withoutLatency(false), false);

  globalThis.window = {};                       // stand in for any browser tier
  try {
    assert.equal(MarpData.withoutLatency(true), false,
      'it must report that it did nothing rather than let a caller believe it worked');

    const started = Date.now();
    await MarpData.query({ page: 1 });
    assert.ok(Date.now() - started >= 130,
      'and the simulated network must still be there');
  } finally {
    delete globalThis.window;
  }
});

test('query() answers exactly what it answered before the scale existed', async () => {
  const base = await fixtureAt(1);

  const cases = [];
  for (const { name, q } of QUESTIONS) {
    for (const page of [1, 2, 7, 999]) cases.push({ name, q, page });
  }
  const answers = await all(cases, (c) => MarpData.query({ ...c.q, page: c.page }));

  cases.forEach(({ name, q, page }, i) => {
    const want = reference({ ...q, page }, base);
    const got = answers[i];

    assert.deepEqual(ids(got.rows), want.ids, `${name}, page ${page}: the rows`);
    assert.equal(got.total, want.total, `${name}: the total`);
    assert.equal(got.pageCount, want.pageCount, `${name}: the page count`);
    assert.equal(got.excludedForNoDate, want.excludedForNoDate,
      `${name}: how many rows the date filter could not answer for`);
    assert.equal(got.page, page);
    assert.equal(got.pageSize, 45);
  });
});

test('query() still returns the fixture rows themselves at scale 1', async () => {
  const base = await fixtureAt(1);
  const got = await MarpData.query({ page: 1 });
  const first = got.rows[0];

  assert.equal(first.observation_id, reference({ page: 1 }, base).ids[0]);
  assert.ok(first.thumb, 'a served row carries the fixture row it came from');
  /* `thumb` is a **fixture** field. The endpoint's row deliberately carries no `thumb` --
     "the address is derivable from a key this row already carries" -- so the tile asks the
     seam for a picture's address rather than building one (F7, R1). */
  assert.equal(MarpData.thumbnailUrl(first), `./fixtures/thumbs/${first.thumb}`);
  const again = await MarpData.query({ page: 1 });
  assert.equal(again.rows[0], first, 'the same object, as every existing test expects');
});

test('an exclusion set removes exactly the rows it names, and nothing else', async () => {
  const base = await fixtureAt(1);
  const open = await MarpData.query({ page: 1 });
  const excludeIds = new Set(ids(open.rows).slice(0, 10));

  const want = reference({ filters: { excludeIds }, page: 1 }, base);
  const got = await MarpData.query({ filters: { excludeIds }, page: 1 });

  assert.deepEqual(ids(got.rows), want.ids);
  assert.equal(got.total, want.total);
  assert.equal(got.total, open.total - 10, 'ten fewer rows match, not ten fewer on one page');
  for (const id of excludeIds) assert.ok(!ids(got.rows).includes(id));
});

/* ------------------------------------------------------------------------------- depth */

test('the set is as deep as the scale says, and the page count follows (R13)', async () => {
  const base = await fixtureAt(147);
  const want = reference({}, base);

  const got = await MarpData.query({ page: 1, pageSize: 45 });
  assert.equal(got.total, want.total * 147, '3,000 x 147 is the production shape');
  assert.equal(got.total, 441000);
  assert.equal(got.pageCount, Math.ceil(441000 / 45));
  assert.ok(got.pageCount > 9700, `${got.pageCount} pages is where eviction happens`);

  /* The last page, which is what the scheduler asks for speculatively. */
  const last = await MarpData.query({ page: got.pageCount, pageSize: 45 });
  assert.equal(last.rows.length, 441000 - (got.pageCount - 1) * 45);
  assert.equal(last.total, got.total, 'the count does not move with the page');
});

test('the depth costs the fixture, not the virtual set (R13)', async () => {
  await fixtureAt(400);                                  // 1.2 million rows

  const started = Date.now();
  const got = await MarpData.query({ page: 20000, pageSize: 45 });
  const took = Date.now() - started;

  assert.equal(got.total, 3000 * 400);
  assert.equal(got.rows.length, 45);
  /* A guard, not a benchmark — and with the simulated network off, what is left is the
     synthesis and nothing else, which is what makes the bound worth having. An
     implementation that sorted or indexed 1.2 million entries per query would be a second
     or more here. */
  assert.ok(took < 300, `a deep page cost ${took} ms of synthesis, which is too much`);
});

test('a deep page is materialised, not handed out as shared references (R13)', async () => {
  await fixtureAt(147);
  const [got, other] = await Promise.all([
    MarpData.query({ page: 500, pageSize: 45 }),
    MarpData.query({ page: 501, pageSize: 45 })
  ]);

  assert.equal(new Set(got.rows).size, 45, 'no two rows on a page are the same object');
  assert.equal(new Set(ids(got.rows)).size, 45, 'and no two share an id');

  for (const row of other.rows) {
    assert.ok(!got.rows.includes(row), 'nor does the next page reuse one');
  }
});

test('a served row is a copy, so writing to it cannot reach the fixture (R13)', async () => {
  await fixtureAt(147);
  const q = { pageSize: 45, pages: [3000] };

  const [first, second] = await Promise.all([MarpData.queryPages(q), MarpData.queryPages(q)]);
  const a = first.pages[0].rows[0], b = second.pages[0].rows[0];

  assert.equal(a.observation_id, b.observation_id, 'two fetches of a page are the same rows');
  assert.notEqual(a, b, 'and not the same objects');
  assert.deepEqual(a, b, 'equal in every field');

  /* The page cache hands back the row objects it holds rather than copies of them, so
     this is the property that keeps a write through one cached page out of another — and
     out of the fixture, which is the source of truth for every later query. `store.js`
     writes `thumbnail_status` on a served row while a retry is in flight, so this path is
     live rather than hypothetical. */
  a.species_comname = 'Not A Species';
  a.review_decision = 'flagged';
  a.thumbnail_status = 'failed';

  const third = await MarpData.queryPages(q);
  assert.deepEqual(third.pages[0].rows[0], b, 'the next fetch is unmoved');

  const overlapping = await MarpData.queryPages({ pageSize: 45, pages: [2999, 3000] });
  const again = overlapping.pages[1].rows[0];
  assert.notEqual(again, a, 'and an overlapping page set does not share the object either');
  assert.deepEqual(again, b);
});

test('a committed replica is copied out of the overlay too, not handed over (R13)', async () => {
  await fixtureAt(9);
  const filters = { reviewStatus: ['unreviewed'] };
  const open = await MarpData.query({ filters, page: 1, pageSize: 3 });
  const committed = ids(open.rows);

  await commit('scientific', open.rows);

  const [[one], [two]] = await Promise.all([
    MarpData.byIds([committed[0]]), MarpData.byIds([committed[0]])
  ]);
  assert.notEqual(one, two, 'the overlay row is the record; a served copy of it is not');
  assert.deepEqual(one, two);

  one.review_decision = null;
  const [three] = await MarpData.byIds([committed[0]]);
  assert.equal(three.review_decision, 'reviewed', 'the record did not move');
});

test('every query carries the observation_id tie-break, at any depth (R2)', async () => {
  await fixtureAt(147);

  await all([
    { field: 'confidence', dir: 'asc', then: null },
    { field: 'keyframe_count', dir: 'desc', then: null },
    { field: 'obsID', dir: 'asc', then: null }
  ], async (sort) => {
    /* Two adjacent deep pages, so the boundary between them is checked too. */
    const [a, b] = await Promise.all([
      MarpData.query({ sort, page: 3000, pageSize: 45 }),
      MarpData.query({ sort, page: 3001, pageSize: 45 })
    ]);
    const rows = a.rows.concat(b.rows);

    for (let i = 1; i < rows.length; i++) {
      const x = rows[i - 1][sort.field], y = rows[i][sort.field];
      if (x === y) {
        assert.ok(rows[i - 1].observation_id < rows[i].observation_id,
          `${sort.field} ties must break on observation_id, ascending`);
      } else {
        const ordered = sort.dir === 'desc' ? x > y : x < y;
        assert.ok(ordered, `${sort.field} ${sort.dir} is out of order at rank ${i}`);
      }
    }
  });
});

test('a page served twice holds the same ids in the same order (R2)', async () => {
  await fixtureAt(147);
  const q = { filters: { species: [41] }, page: 1234, pageSize: 45 };   // Bat Star, by key

  const [first, second] = await Promise.all([MarpData.query(q), MarpData.query(q)]);
  assert.deepEqual(ids(second.rows), ids(first.rows));
  assert.notEqual(second.rows[0], first.rows[0], 'a fresh object, but the same row');
});

test('byIds serves virtual ids, in the order asked for', async () => {
  await fixtureAt(147);
  const got = await MarpData.query({ page: 900, pageSize: 45 });
  const wanted = ids(got.rows).slice(0, 5).reverse();

  const back = await MarpData.byIds(wanted);
  assert.deepEqual(ids(back), wanted, 'a pinned page keeps its membership and its order');

  const missing = await MarpData.byIds([wanted[0], -1]);
  assert.deepEqual(ids(missing), [wanted[0]], 'an id nothing answers for is dropped');
});

test('a commit against a replica survives, and leaves its siblings alone (R13)', async () => {
  const scale = 5;
  await fixtureAt(scale);

  const filters = { species: [41], reviewStatus: ['unreviewed'] };   // Bat Star, by key
  const open = await MarpData.query({ filters, page: 1, pageSize: 3 });
  const committed = ids(open.rows);
  assert.equal(committed.length, 3);

  await commit('scientific', open.rows);

  /* The sibling replicas of the same base rows are a different decision each. */
  const siblings = committed.map((id) => {
    const k = id % scale;
    return (id - k) + ((k + 1) % scale);
  }).filter((id) => !committed.includes(id));
  assert.ok(siblings.length, 'the check is worthless without at least one sibling');

  const [back, kin, after] = await Promise.all([
    MarpData.byIds(committed),
    MarpData.byIds(siblings),
    MarpData.query({ filters, page: 1, pageSize: 3 })
  ]);

  for (const row of back) {
    assert.equal(row.review_decision, 'reviewed', 'a committed replica reads back committed');
    /* A reviewer **id**, not a name (A13, F8). `reviewed_by: 'I. Travers'` was a column
       the endpoint's row has never carried, holding one developer's name. */
    assert.equal(row.review_reviewer_id, 5);
  }
  for (const row of kin) {
    assert.equal(row.review_decision, null,
      'committing one replica must not commit the row it was copied from');
  }

  /* And the question the reviewer is asking now holds exactly three fewer. */
  assert.equal(after.total, open.total - 3);
  for (const id of committed) assert.ok(!ids(after.rows).includes(id));
});

test('a species correction against a replica survives (R13)', async () => {
  await fixtureAt(7);
  /* Species is filtered by **key** now, not by name (F1): the endpoint's filter is
     `observations.species_id`, and only that, because it finds the organism where a name
     finds rows whose label happens to match. */
  const batStar = PRISTINE.species.find((sp) => sp.comname === 'Bat Star');
  const rockfish = PRISTINE.species.find((sp) => sp.comname === 'Rockfish');

  const open = await MarpData.query({ filters: { species: [batStar.species_id] }, page: 2, pageSize: 4 });
  const target = open.rows[1];

  const res = await MarpData.setSpecies({
    observationId: target.observation_id, speciesId: rockfish.species_id, version: target.version
  });
  assert.equal(res.ok, true);
  assert.equal(res.observation.observation_id, target.observation_id);

  /* It has left the species-filtered set, and joined the other one. */
  const [[back], bat, rock] = await Promise.all([
    MarpData.byIds([target.observation_id]),
    MarpData.query({ filters: { species: [batStar.species_id] }, page: 1, pageSize: 45 }),
    MarpData.query({ filters: { species: [rockfish.species_id] }, page: 1, pageSize: 45 })
  ]);
  /* **`species_comname` moved and `comname` did not** (F6). `comname` is the label the
     annotator's list entry carried and a correction never rewrites it; keeping it frozen
     is what makes the drift auditable. This asserted `back.comname === 'Rockfish'` and
     `back.previous_comname === 'Bat Star'` -- a field no row carries at all. */
  assert.equal(back.species_comname, 'Rockfish');
  assert.equal(back.comname, 'Bat Star', 'the annotator label is never rewritten');
  assert.equal(back.previous_comname, undefined, 'and there is no such field');
  assert.equal(bat.total, 1185 * 7 - 1);
  assert.equal(rock.total,
    PRISTINE.observations.filter((r) => r.species_id === rockfish.species_id).length * 7 + 1);
});

test('the status counts scale with the set, and move when work is committed', async () => {
  const scale = 11;
  const base = await fixtureAt(scale);
  const filters = { species: [41] };            // Bat Star, by key (F1)

  const [before, open] = await Promise.all([
    MarpData.counts({ filters }),
    MarpData.query({ filters, page: 1, pageSize: 6 })
  ]);
  const matching = base.filter((r) => matchesFilters(filters, r));
  assert.equal(before.total, matching.length * scale);
  /* Null is the neutral state on the row; `unreviewed` is what the *count* is keyed by. */
  assert.equal(before.unreviewed,
    matching.filter((r) => r.review_decision == null).length * scale);

  await commit('scientific', open.rows);

  const after = await MarpData.counts({ filters });
  assert.equal(after.total, before.total, 'reviewing something does not remove it');
  assert.equal(after.unreviewed, before.unreviewed - 6, 'six fewer are unreviewed');
  assert.equal(after.reviewed, before.reviewed + 6);
});

test('exclusion suppresses exactly the replicas it names, at depth', async () => {
  await fixtureAt(147);
  const open = await MarpData.query({ page: 4000, pageSize: 45 });
  const excludeIds = new Set(ids(open.rows));

  const got = await MarpData.query({ filters: { excludeIds }, page: 4000, pageSize: 45 });
  assert.equal(got.total, open.total - 45, 'forty-five fewer rows match');
  for (const id of excludeIds) {
    assert.ok(!ids(got.rows).includes(id), 'a suppressed replica is gone');
  }
  /* Its siblings are not: exclusion names ids, not rows. */
  const sibling = [...excludeIds][0] + 1;
  const deep = await MarpData.byIds([sibling]);
  assert.equal(deep.length, 1);
});

test('the date filter reports what it could not answer for, at depth', async () => {
  const base = await fixtureAt(147);
  /* A17: the range compares `tc` as a point in time, so the ends are **times**. It was
     `{ from: '2026-08-01' }`, comparing the date component of `tc` -- which no row carries,
     so the filter answered zero rows and the whole set was "unanswerable". That is the
     reading the human ruled out. */
  const filters = { date: { from: '00:00', to: null } };

  const got = await MarpData.query({ filters, page: 1 });
  assert.equal(got.excludedForNoDate, reference({ filters }, base).excludedForNoDate * 147);
  /* Every row's `tc` carries a readable clock, so nothing is unanswerable and a range
     open at the top matches the whole set. Under the old reading this asserted `total: 0`
     and `excludedForNoDate` equal to the whole set -- a filter that excluded everything
     and said so, which is why it had to be refused rather than served. */
  assert.equal(got.excludedForNoDate, 0, 'every tc in this fixture carries a clock');
  assert.equal(got.total, (await MarpData.query({ page: 1 })).total,
    'a range open at the top narrows nothing');
});

/* ------------------------------------------------------------ the page-set contract */

test('queryPages and query cannot disagree about what a page holds (R2, R15)', async () => {
  for (const scale of [1, 147]) {
    await fixtureAt(scale);
    const pages = scale === 1 ? [1, 2, 3] : [1, 2, 3, 500, 4000];

    await all(QUESTIONS, async ({ name, q }) => {
      const [set, ...singles] = await Promise.all([
        MarpData.queryPages({ ...q, pageSize: 45, pages, includeTotal: true }),
        ...pages.map((page) => MarpData.query({ ...q, page, pageSize: 45 }))
      ]);

      set.pages.forEach((entry, i) => {
        const one = singles[i];
        assert.equal(entry.page, pages[i]);
        assert.deepEqual(ids(entry.rows), ids(one.rows),
          `${name} at scale ${scale}, page ${entry.page}`);
        assert.equal(set.total, one.total, `${name} at scale ${scale}: the total`);
        assert.equal(set.pageCount, one.pageCount);
        assert.equal(set.excludedForNoDate, one.excludedForNoDate);
      });
    });
  }
});

test('every page asked for comes back, de-duplicated and ascending (R15)', async () => {
  await fixtureAt(147);
  const asked = [4000, 1, 9779, 2, 4000, 4001];

  const set = await MarpData.queryPages({ pageSize: 45, pages: asked, includeTotal: true });
  assert.deepEqual(set.pages.map((p) => p.page), [1, 2, 4000, 4001, 9779],
    'the caller never has to work out which pages arrived');
  for (const entry of set.pages) {
    assert.equal(entry.rowCount, entry.rows.length, 'rowCount says what rows holds');
    assert.equal(entry.rowCount, 45);
  }
  assert.equal(set.pageSize, 45);
  assert.ok(set.servedAt, 'servedAt is diagnostic, and present');
});

test('a discontiguous set is one request and costs one real latency (R15)', async () => {
  /* **Do not delete this as redundant.** `LATENCY.query` is 140 ms deliberately — high
     enough that a genuine fetch is plainly visible on screen — and it is what lets
     `render.spec.mjs` prove the reviewer does not wait. Every other check in this file
     runs with the simulated network switched off, so this is the only thing left
     asserting that the real latency is still real, and that a page set costs one of it
     rather than one per page. */
  assert.equal(MarpData.withoutLatency(false), false, 'the real thing, for this check');
  await fixtureAt(147);

  const started = Date.now();
  const set = await MarpData.queryPages({
    pageSize: 45, pages: [1, 2, 3, 4000, 4001, 4002, 9779, 9800], includeTotal: true
  });
  const took = Date.now() - started;

  assert.equal(set.pages.length, 8);
  assert.ok(took >= 130, `a page set must still cost a request; it took ${took} ms`);
  assert.ok(took < 8 * 140,
    `eight pages took ${took} ms — a page set must not cost one latency per page`);
});

test('a page past the end is empty rather than an error (R15)', async () => {
  await fixtureAt(147);
  const set = await MarpData.queryPages({ pageSize: 45, pages: [9800, 9801, 40000], includeTotal: true });

  /* The scheduler asks for the tail speculatively, before it knows the count. */
  const beyond = set.pages.filter((p) => p.page > set.pageCount);
  assert.ok(beyond.length, 'the check needs at least one page past the end');
  for (const entry of beyond) {
    assert.deepEqual(entry.rows, []);
    assert.equal(entry.rowCount, 0);
  }
});

test('the total comes back only when it is asked for (R16)', async () => {
  await fixtureAt(147);

  const [quiet, asked, only] = await Promise.all([
    MarpData.queryPages({ pageSize: 45, pages: [1, 2] }),
    MarpData.queryPages({ pageSize: 45, pages: [1, 2], includeTotal: true }),
    MarpData.queryPages({ pageSize: 45, pages: [], includeTotal: true })
  ]);
  assert.equal('total' in quiet, false, 'a prefetch never asks for the count');
  assert.equal('pageCount' in quiet, false);
  assert.equal(quiet.pages.length, 2);

  assert.equal(asked.total, 441000);
  assert.equal(asked.pageCount, Math.ceil(441000 / 45));

  /* No pages and a total is a legitimate request: the count, once, per question. */
  assert.deepEqual(only.pages, []);
  assert.equal(only.total, 441000);
});

test('a page set over the cap is rejected, not silently truncated (R15)', async () => {
  await fixtureAt(147);
  const rejected = async (args) => {
    try {
      await MarpData.queryPages(args);
    } catch (err) {
      return err;
    }
    return null;
  };

  const many = await rejected({ pageSize: 45, pages: Array.from({ length: 13 }, (_, i) => i + 1) });
  assert.ok(many, 'thirteen pages is over the twelve-page cap');
  assert.equal(many.status, 400);

  const wide = await rejected({ pageSize: 200, pages: [1, 2, 3, 4] });
  assert.ok(wide, '800 rows is over the 600-row cap, at four pages');
  assert.equal(wide.status, 400);

  assert.equal((await rejected({ pageSize: 45, pages: [0] })).status, 400, 'pages are 1-based');
  assert.equal((await rejected({ pageSize: 45, pages: [1.5] })).status, 400);
  assert.equal((await rejected({ pageSize: 45, pages: 4 })).status, 400, 'pages is an array');

  /* Right on the cap is served, so the cap is a boundary and not a suggestion. */
  const ok = await MarpData.queryPages({
    pageSize: 50, pages: Array.from({ length: 12 }, (_, i) => i + 1)
  });
  assert.equal(ok.pages.length, 12);
});

test('the page set reads the exclusion set from either place it can arrive in (R15)', async () => {
  await fixtureAt(147);
  const open = await MarpData.queryPages({ pageSize: 45, pages: [7], includeTotal: true });
  const suppressed = ids(open.pages[0].rows).slice(0, 20);

  /* The contract's own field... */
  const [wire, store] = await Promise.all([
    MarpData.queryPages({ pageSize: 45, pages: [7], exclude: suppressed, includeTotal: true }),
    /* ...and where `queryFilters` puts it, so the store can pass one filters object to
       this and to `query`. */
    MarpData.queryPages({
      filters: { excludeIds: new Set(suppressed) }, pageSize: 45, pages: [7], includeTotal: true
    })
  ]);
  assert.equal(wire.total, open.total - 20);
  assert.equal(store.total, open.total - 20);
  assert.deepEqual(ids(store.pages[0].rows), ids(wire.pages[0].rows));
});

test('the sort arrives in either shape a caller can hold (R2, R15)', async () => {
  await fixtureAt(147);

  /* The wire carries terms; the client holds one sort object. Both must mean the same
     order, or a prefetched page and the visible page would disagree. */
  const [object, wire, bare, dflt] = await Promise.all([
    MarpData.queryPages({
      sort: { field: 'keyframe_count', dir: 'desc', then: { field: 'confidence', dir: 'asc' } },
      pageSize: 45, pages: [2000]
    }),
    MarpData.queryPages({
      sort: [{ field: 'keyframe_count', dir: 'desc' }, { field: 'confidence', dir: 'asc' }],
      pageSize: 45, pages: [2000]
    }),
    /* Nothing named means the default question, exactly as `query()` reads it. */
    MarpData.queryPages({ pageSize: 45, pages: [2000] }),
    MarpData.query({ page: 2000, pageSize: 45 })
  ]);
  assert.deepEqual(ids(wire.pages[0].rows), ids(object.pages[0].rows));
  assert.deepEqual(ids(bare.pages[0].rows), ids(dflt.rows));
});

test('setting the scale renumbers the set and drops simulated edits', async () => {
  const base = await fixtureAt(5);
  const filters = { reviewStatus: ['unreviewed'] };
  const unreviewed = reference({ filters }, base).total;

  const open = await MarpData.query({ filters, page: 1, pageSize: 4 });
  assert.equal(open.total, unreviewed * 5, 'the set is the fixture, five times over');

  await commit('scientific', open.rows);
  const [committed] = await MarpData.byIds([ids(open.rows)[0]]);
  assert.equal(committed.review_decision, 'reviewed');

  MarpData.setScale(9);
  assert.equal(MarpData.scale(), 9);
  const back = await MarpData.query({ filters, page: 1, pageSize: 4 });
  assert.equal(back.total, unreviewed * 9,
    'nothing is committed any more: a virtual id means something different now');

  MarpData.setScale(1);
  assert.equal(MarpData.scale(), 1);
});
