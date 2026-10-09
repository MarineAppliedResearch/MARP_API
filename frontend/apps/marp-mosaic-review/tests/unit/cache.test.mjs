/**
 * The cache: what makes two questions the same question, and what a hit holds.
 *
 * Both halves are pure, so they are driven through many states rather than a few. The key
 * especially: it is a string, and a string that is wrong in one direction serves the wrong
 * rows while a string that is wrong in the other throws the cache away on every commit —
 * which is the defect #99 exists to prevent. Each of the four things in the question, and
 * each of the three things deliberately left out of it, is asserted on its own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { keyFor, createCache, ROW_BUDGET } from '../../src/model/cache.js';
import { defaultQuery } from '../../src/model/query-url.js';
import { DEFAULT_FILTERS } from '../../src/model/filters.js';

/** A question, in the shape `store.js` holds it. */
const question = (over = {}) => ({
  mode: 'scientific',
  filters: { ...DEFAULT_FILTERS },
  sort: { field: 'confidence', dir: 'asc', then: null },
  pageSize: 45,
  ...over
});

const row = (id) => ({ observation_id: id, comname: 'Bat Star', thumbnail_url: `t/${id}.jpg` });
const rowsFor = (page, count = 45) =>
  Array.from({ length: count }, (_, i) => row(page * 1000 + i));

/** A cache holding one question, with the pages named. */
const loaded = (pages, count = 45) => {
  const cache = createCache();
  cache.use(keyFor(question()));
  pages.forEach((p) => cache.put(p, rowsFor(p, count)));
  return cache;
};

/* ---------------------------------------------------------------------- R9: the key */

test('R9: the same question is the same key, whichever object it arrives in', () => {
  assert.equal(keyFor(question()), keyFor(question()));

  /* Property order must not matter: a key built by stringifying the filters object would
     pass every other test here and fail this one, and the failure would look like the
     cache being useless rather than like a broken key. */
  /* Species is a **key** now, not a name (F1): the endpoint filters on
     `observations.species_id` and refuses a name outright.
     The two objects must be the *same question* written with their keys in a different
     order -- outer keys reversed, and the sort's own two reversed. `backwards` used to
     spread `DEFAULT_FILTERS` *after* `species`, so the default's value won and the two
     agreed only while that default happened to be `[41]`. That made this test pass for a
     reason it was not testing, and it broke the moment the default stopped naming a
     species. Both now set species explicitly, after the spread. */
  const forwards = { mode: 'scientific', filters: { ...DEFAULT_FILTERS, species: [41] }, sort: { field: 'confidence', dir: 'asc' }, pageSize: 45 };
  const backwards = { pageSize: 45, sort: { dir: 'asc', field: 'confidence' }, filters: { ...DEFAULT_FILTERS, species: [41] }, mode: 'scientific' };
  assert.equal(keyFor(forwards), keyFor(backwards));
});

test('R9: the key is a non-empty string, even for the default question', () => {
  const key = keyFor(question());
  assert.equal(typeof key, 'string');
  assert.ok(key.length > 0, 'the default question writes a bare address; the key may not be bare');
});

test('R9: a different filter is a different question', () => {
  /* The baseline narrows by species deliberately. `question()` alone is the *default*
     question, which since A10(b) narrows nothing -- so "species: []" would be the same
     question as the baseline rather than a different one, and this test would be asserting
     that a question differs from itself. */
  const base = keyFor(question({ filters: { ...DEFAULT_FILTERS, species: [41] } }));

  assert.notEqual(base, keyFor(question({ filters: { ...DEFAULT_FILTERS, species: [45] } })));
  assert.notEqual(base, keyFor(question({ filters: { ...DEFAULT_FILTERS, species: [] } })));
  assert.notEqual(base, keyFor(question({ filters: { ...DEFAULT_FILTERS, project: ['Deep Reef Survey 2025'] } })));
  assert.notEqual(base, keyFor(question({ filters: { ...DEFAULT_FILTERS, confidence: { from: 0, to: 0.8 } } })));
  assert.notEqual(base, keyFor(question({ filters: { ...DEFAULT_FILTERS, reviewStatus: ['reviewed'] } })));
  assert.notEqual(base, keyFor(question({ filters: { ...DEFAULT_FILTERS, trainingDisposition: ['excluded'] } })));
});

test('R9: a different sort is a different question', () => {
  const base = keyFor(question());

  assert.notEqual(base, keyFor(question({ sort: { field: 'confidence', dir: 'desc' } })));
  assert.notEqual(base, keyFor(question({ sort: { field: 'updatedAt', dir: 'asc' } })));
  assert.notEqual(base, keyFor(question({
    sort: { field: 'confidence', dir: 'asc', then: { field: 'obsID', dir: 'desc' } }
  })), 'a secondary term changes what page 2 holds, so it changes the key');
});

test('R9: a different mode is a different question', () => {
  const base = keyFor(question());
  assert.notEqual(base, keyFor(question({ mode: 'training' })));
  assert.notEqual(base, keyFor(question({ mode: 'delete' })));
  assert.notEqual(keyFor(question({ mode: 'training' })), keyFor(question({ mode: 'delete' })));
});

test('R9: the page size is in the key, because it changes what page 2 is', () => {
  const base = keyFor(question());
  assert.notEqual(base, keyFor(question({ pageSize: 50 })));
  assert.notEqual(base, keyFor(question({ pageSize: 12 })));
  assert.equal(keyFor(question({ pageSize: 45 })), keyFor(question({ pageSize: '45' })),
    'a page size that arrives as text is the same page size');
});

test('R9: the page is not in the key', () => {
  /* The whole of the address is the key except this. Left in, every page would be its own
     cache and nothing would ever be a hit. */
  const at = (page) => keyFor({ ...question(), page });
  assert.equal(at(1), at(2));
  assert.equal(at(1), at(9780));

  const state = { ...defaultQuery(), pageSize: 45, page: 4000 };
  assert.equal(keyFor(state), keyFor({ ...state, page: 1 }),
    'handing this the whole of state must give the same key from any page');
});

test('A4: the exclusion set is not in the key, so a commit invalidates nothing', () => {
  /* `store.refresh()` sends `excludeIds: page.pinnedIds(state.pageMembers)` on every
     query and that set grows on every commit. In the key, every commit would change the
     identity of every cached page and empty the whole cache — the reviewer waiting after
     every commit, reported by hand on 2026-09-08. */
  const base = keyFor(question());
  assert.equal(base, keyFor({ ...question(), excludeIds: new Set([1, 2, 3]) }));
  assert.equal(base, keyFor({ ...question(), excludeIds: [100123, 100456] }));
});

test('R9: a run of different questions gives a run of different keys', () => {
  const questions = [
    question(),
    question({ mode: 'training' }),
    question({ mode: 'delete' }),
    question({ pageSize: 12 }),
    question({ pageSize: 50 }),
    question({ sort: { field: 'obsID', dir: 'desc' } }),
    question({ sort: { field: 'keyframe_count', dir: 'asc' } }),
    /* `species: []` is no longer distinct from `question()` -- the default narrows nothing
       since A10(b) -- so listing both would collide here and read as a broken key. Two
       genuinely different species selections instead. */
    question({ filters: { ...DEFAULT_FILTERS, species: [41] } }),
    question({ filters: { ...DEFAULT_FILTERS, species: [45] } }),
    question({ filters: { ...DEFAULT_FILTERS, dive: ['D04'] } }),
    question({ filters: { ...DEFAULT_FILTERS, date: { from: '2026-08-01', to: null } } }),
    question({ filters: { ...DEFAULT_FILTERS, timeOfDay: { from: '22:00', to: '02:00' } } })
  ];
  const keys = questions.map(keyFor);
  assert.equal(new Set(keys).size, keys.length, `two of these questions share a key: ${keys}`);
});

/* --------------------------------------------------------------- R10: what changes it */

test('R10: adopting the same question keeps everything', () => {
  const cache = loaded([1, 2, 3]);
  const key = keyFor(question());

  assert.equal(cache.use(key), false, 'nothing was thrown away');
  assert.equal(cache.rowCount(), 135);
  assert.ok(cache.has(2));
});

test('R10: a commit does not invalidate the cache', () => {
  /* Modelled the way it happens: the pins grow, the question does not. */
  const cache = loaded([1, 2, 3]);
  const afterCommit = keyFor({ ...question(), excludeIds: [1000, 1001, 1002] });

  assert.equal(cache.use(afterCommit), false);
  assert.equal(cache.rowCount(), 135, 'paging forward must never discard what is behind');
});

test('R10: a filter, the sort, the mode or the page size empties it', () => {
  for (const over of [
    { filters: { ...DEFAULT_FILTERS, species: [45] } },
    { sort: { field: 'updatedAt', dir: 'desc' } },
    { mode: 'training' },
    { pageSize: 50 }
  ]) {
    const cache = loaded([1, 2, 3]);
    assert.equal(cache.use(keyFor(question(over))), true, `${Object.keys(over)}: kept`);
    assert.equal(cache.rowCount(), 0);
    assert.deepEqual(cache.held(), []);
    assert.equal(cache.has(1), false);
    assert.equal(cache.serve(1), null);
  }
});

test('R10: clear takes the question with it', () => {
  const cache = loaded([1, 2]);
  cache.clear();
  assert.equal(cache.key, null);
  assert.equal(cache.rowCount(), 0);
  assert.equal(cache.use(keyFor(question())), true, 'the next question is a new one');
});

/* ---------------------------------------------------------------- serving a page */

test('R2: a page is served in the order it was cached', () => {
  const cache = loaded([7]);
  const served = cache.serve(7);

  assert.equal(served.length, 45);
  assert.deepEqual(served.map((r) => r.observation_id), rowsFor(7).map((r) => r.observation_id));
});

test('a page that is not held is not a hit', () => {
  const cache = loaded([7]);
  assert.equal(cache.serve(8), null);
  assert.equal(cache.has(8), false);
  assert.equal(cache.has(7), true);
});

test('R12: a cached page never shows a row pinned to another page', () => {
  const cache = loaded([7]);
  const pinnedElsewhere = [7000, 7001, 7002];

  const served = cache.serve(7, new Set(pinnedElsewhere));
  assert.equal(served.length, 42, 'the page renders three tiles short, which is correct');
  for (const id of pinnedElsewhere) {
    assert.ok(!served.some((r) => r.observation_id === id), `${id} is on the page it was committed on`);
  }
});

test('R12: suppression happens when the page is served, not when it is fetched', () => {
  /* The exclusion set grows through a session and is deliberately not in the key, so the
     cached answer itself must not be rewritten — the same page served again under a
     different exclusion set is still whole. */
  const cache = loaded([7]);

  assert.equal(cache.serve(7, [7000]).length, 44);
  assert.equal(cache.serve(7, [7000, 7001]).length, 43);
  assert.equal(cache.serve(7).length, 45, 'the cached page was never edited');
  assert.equal(cache.held()[0].ids.length, 45);
  assert.equal(cache.rowCount(), 45, 'and no row was thrown away by suppressing it');
});

test('R12: an exclusion set may arrive as a Set or an array', () => {
  const cache = loaded([7]);
  assert.equal(cache.serve(7, new Set([7000])).length, 44);
  assert.equal(cache.serve(7, [7000]).length, 44);
  assert.equal(cache.serve(7, []).length, 45);
  assert.equal(cache.serve(7, undefined).length, 45);
});

test('a cached page always holds every one of its rows, through any sequence of work', () => {
  /* The rule `serve` enforces is that a page is either whole or a miss: a hole and a
     suppression look identical on screen and mean opposite things. This drives the two
     things that can take a row away — a page being given up, and a page being re-put — and
     asserts that no page is ever left naming a row the row index has lost. */
  const cache = createCache();
  cache.use('one question');
  const shared = rowsFor(40);
  const whole = () => {
    for (const { page, ids } of cache.held()) {
      const served = cache.serve(page);
      assert.notEqual(served, null, `page ${page} is held but no longer serves`);
      assert.equal(served.length, ids.length, `page ${page} came back short`);
    }
  };

  for (const page of [1, 2, 3, 4, 5]) cache.put(page, rowsFor(page));
  cache.put(40, shared);
  cache.put(41, shared);                          // two pages, one set of rows
  whole();

  cache.evict([1, 40], new Set([2000, 2001]));    // one plain page, one sharing its rows
  whole();

  cache.put(3, rowsFor(3).slice(0, 10));          // and a re-put, which orphans 35 rows
  whole();

  cache.evict([], []);                            // then sweep them
  whole();
  assert.deepEqual(cache.held().map((h) => h.page).sort((a, b) => a - b), [2, 3, 4, 5, 41]);
});

test('serving hands back the cached row itself, so a commit is visible through the cache', () => {
  /* Within a session the reviewer sees the data as they last submitted it. `commitPage`
     writes to the row, and the cache must be looking at the same object or paging back
     would show the answer from before the commit. */
  const cache = loaded([7]);
  const before = cache.serve(7)[0];
  before.review_decision = 'reviewed';

  assert.equal(cache.serve(7)[0].review_decision, 'reviewed');
});

/* ------------------------------------------------------- R11: serving a pinned page */

test('R11: a pinned page is served from the row index by id', () => {
  const cache = loaded([7]);
  const members = [7003, 7001, 7002];            // the order the page was committed in

  const served = cache.rowsFor(members);
  assert.deepEqual(served.map((r) => r.observation_id), members,
    'the pin decides the order, not the cached page');
});

test('R11: a pinned page missing one row is a fetch, not a short page', () => {
  const cache = loaded([7]);
  assert.equal(cache.rowsFor([7000, 7001, 999999]), null);
  assert.deepEqual(cache.rowsFor([]), [], 'a pin with no ids needs nothing fetched');
});

test('R11: a pinned page survives its cached page being given up', () => {
  const cache = loaded([7, 8]);
  const members = rowsFor(7).map((r) => r.observation_id);

  cache.evict([7], new Set(members));
  assert.equal(cache.has(7), false, 'the page is gone from the page index');
  assert.equal(cache.rowsFor(members).length, 45, 'the rows it named are not');
});

/* ------------------------------------------------------------ the two indexes, and rows */

test('the row index counts a shared row once', () => {
  const cache = createCache();
  cache.use('one question');
  const shared = rowsFor(7);

  cache.put(7, shared);
  cache.put(8, shared);                           // the same rows under two page numbers
  assert.equal(cache.rowCount(), 45);
  assert.equal(cache.held().length, 2);
});

test('giving up one page keeps a row another page still needs', () => {
  const cache = createCache();
  cache.use('one question');
  const shared = rowsFor(7);
  cache.put(7, shared);
  cache.put(8, shared);

  cache.evict([7], []);
  assert.equal(cache.rowCount(), 45, 'page 8 still needs every one of them');
  assert.equal(cache.serve(8).length, 45);

  cache.evict([8], []);
  assert.equal(cache.rowCount(), 0);
});

test('R8: eviction never loses a row a pinned page needs', () => {
  const cache = loaded([1, 2, 3]);
  const pinned = new Set(rowsFor(2).map((r) => r.observation_id));

  cache.evict([1, 2, 3], pinned);
  assert.deepEqual(cache.held(), []);
  assert.equal(cache.rowCount(), 45, 'the pinned rows, and nothing else');
  assert.equal(cache.rowsFor([...pinned]).length, 45);
});

test('eviction sweeps a row left orphaned by a page being re-put', () => {
  /* `put` deliberately deletes nothing: it is not told about the pins, and a row it
     dropped could be exactly the one a pinned page needs. The sweep is where they go. */
  const cache = createCache();
  cache.use('one question');
  cache.put(7, rowsFor(7));
  cache.put(7, rowsFor(7).slice(0, 40));          // five rows now belong to no page

  assert.equal(cache.rowCount(), 45, 'still held, because a pin might need them');
  cache.evict([], new Set([7044]));
  assert.equal(cache.rowCount(), 41, 'four swept, and the pinned one kept');
  assert.equal(cache.serve(7).length, 40);
});

test('re-putting a page replaces what it holds rather than adding to it', () => {
  const cache = createCache();
  cache.use('one question');
  cache.put(7, rowsFor(7));
  cache.put(7, [row(999), row(998)]);

  assert.deepEqual(cache.serve(7).map((r) => r.observation_id), [999, 998]);
  assert.deepEqual(cache.held()[0].ids, [999, 998]);
});

test('held() is the shape the scheduler wants, and a copy', () => {
  const cache = loaded([3, 1, 2]);
  const held = cache.held();

  assert.deepEqual(held.map((h) => h.page), [3, 1, 2]);
  for (const entry of held) {
    assert.equal(entry.ids.length, 45);
    assert.equal(typeof entry.lastUsed, 'number');
  }

  held[0].ids.push('nonsense');
  assert.equal(cache.held()[0].ids.length, 45, 'the order of a page is the page');
});

test('recency is a counter, so two pages in the same millisecond cannot tie', () => {
  const cache = loaded([1, 2, 3]);
  const at = () => Object.fromEntries(cache.held().map((h) => [h.page, h.lastUsed]));

  const put = at();
  assert.ok(put[1] < put[2] && put[2] < put[3], 'putting a page counts as using it');

  cache.serve(1);
  const served = at();
  assert.ok(served[1] > served[3], 'and so does serving one');
  assert.equal(served[2], put[2], 'while an untouched page keeps its place');
});

test('an empty page is a real answer and is served without a request', () => {
  /* The scheduler asks for the tail before it knows the count, and the endpoint answers a
     page past the end with no rows. That answer is worth caching. */
  const cache = createCache();
  cache.use('one question');
  cache.put(9999, []);

  assert.equal(cache.has(9999), true);
  assert.deepEqual(cache.serve(9999), []);
  assert.notEqual(cache.serve(9999), null, 'empty is not the same as missing');
});

test('the budget is stated in rows, and it is the cache that owns the number', () => {
  assert.equal(ROW_BUDGET, 3000);
  const cache = loaded(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(cache.rowCount(), 900, 'rowCount is what the budget is measured against');
});
