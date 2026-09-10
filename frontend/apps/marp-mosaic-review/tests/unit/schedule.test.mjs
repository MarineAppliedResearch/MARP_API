/**
 * The scheduler: which pages to hold, in what order to fetch them, and what to give up.
 *
 * `plan()` is a pure function, so it is driven through many states here rather than a few.
 * A rule exercised at one page number is barely exercised at all: the window clamps
 * differently at the head, at the tail, on a short result and before the count has
 * arrived, and every one of those has produced an off-by-one in this application before.
 *
 * The numbers — two pages behind, four ahead, two at each end, 3,000 rows — are written
 * out literally rather than read from the module, so changing one fails these tests. That
 * is the point of them: they are the record of what #99 settled.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { plan } from '../../src/model/schedule.js';
import { ROW_BUDGET, createCache } from '../../src/model/cache.js';

/** A held page, with disjoint ids per page so row sharing has to be asked for. */
const heldPage = (page, { rows = 45, lastUsed = page } = {}) => ({
  page,
  lastUsed,
  ids: Array.from({ length: rows }, (_, i) => page * 1000 + i)
});

const heldPages = (list, opts) => list.map((p) => heldPage(p, opts));

/** Every state worth driving the window through, short results and the ends included. */
const states = [];
for (const pageCount of [1, 2, 3, 4, 7, 11, 60, 9780]) {
  for (const page of [1, 2, 3, 4, 5, 6, 30, 500, pageCount - 2, pageCount - 1, pageCount]) {
    if (page < 1 || page > pageCount) continue;
    for (const direction of [1, -1]) states.push({ page, pageCount, direction });
  }
}

/* ------------------------------------------------------------------ R4: the hold set */

test('R4: the hold set is the neighbourhood plus the head and the tail', () => {
  const { hold } = plan({ page: 500, pageCount: 9780, direction: 1 });

  assert.deepEqual(hold, [1, 2, 498, 499, 500, 501, 502, 503, 504, 9779, 9780]);
  assert.equal(hold.length, 11, 'eleven pages: 7 neighbourhood, 2 head, 2 tail');
});

test('R4: the neighbourhood is asymmetric forward — two behind, four ahead', () => {
  const { hold } = plan({ page: 500, pageCount: 9780, direction: 1 });

  assert.ok(hold.includes(498), 'two pages behind are held');
  assert.ok(!hold.includes(497), 'a third page behind is not');
  assert.ok(hold.includes(504), 'four pages ahead are held');
  assert.ok(!hold.includes(505), 'a fifth page ahead is not');
});

test('R4: travelling backwards mirrors the window — four behind, two ahead', () => {
  const { hold } = plan({ page: 500, pageCount: 9780, direction: -1 });

  assert.deepEqual(hold, [1, 2, 496, 497, 498, 499, 500, 501, 502, 9779, 9780]);
  assert.ok(hold.includes(496), 'four pages behind are held when that is where they go');
  assert.ok(!hold.includes(495));
  assert.ok(hold.includes(502), 'two pages ahead are still held');
  assert.ok(!hold.includes(503), 'but not four');
});

test('R4: the window clamps at the head and de-duplicates the head band', () => {
  assert.deepEqual(plan({ page: 1, pageCount: 9780, direction: 1 }).hold,
    [1, 2, 3, 4, 5, 9779, 9780]);
  assert.deepEqual(plan({ page: 2, pageCount: 9780, direction: 1 }).hold,
    [1, 2, 3, 4, 5, 6, 9779, 9780]);
  assert.deepEqual(plan({ page: 3, pageCount: 9780, direction: 1 }).hold,
    [1, 2, 3, 4, 5, 6, 7, 9779, 9780]);
});

test('R4: the window clamps at the tail and de-duplicates the tail band', () => {
  assert.deepEqual(plan({ page: 9780, pageCount: 9780, direction: 1 }).hold,
    [1, 2, 9778, 9779, 9780]);
  assert.deepEqual(plan({ page: 9779, pageCount: 9780, direction: 1 }).hold,
    [1, 2, 9777, 9778, 9779, 9780]);
  assert.deepEqual(plan({ page: 9780, pageCount: 9780, direction: -1 }).hold,
    [1, 2, 9776, 9777, 9778, 9779, 9780]);
});

test('R4: a short result holds everything and asks for nothing twice', () => {
  assert.deepEqual(plan({ page: 1, pageCount: 1 }).hold, [1]);
  assert.deepEqual(plan({ page: 1, pageCount: 1 }).fetch, []);
  assert.deepEqual(plan({ page: 1, pageCount: 3 }).hold, [1, 2, 3]);
  assert.deepEqual(plan({ page: 2, pageCount: 3 }).fetch, [3, 1]);
});

test('R4: the hold set is bounded, sorted, in range and holds the reviewer at every state', () => {
  for (const state of states) {
    const { hold } = plan(state);
    const where = JSON.stringify(state);

    assert.ok(hold.length <= 11, `${where}: ${hold.length} pages held, more than eleven`);
    assert.deepEqual(hold, [...hold].sort((a, b) => a - b), `${where}: not ascending`);
    assert.equal(new Set(hold).size, hold.length, `${where}: a page held twice`);
    assert.ok(hold.every((p) => p >= 1 && p <= state.pageCount), `${where}: out of range`);
    assert.ok(hold.includes(state.page), `${where}: the visible page is not held`);
    assert.ok(hold.includes(1), `${where}: page 1 is a permanent chip and must be held`);
    assert.ok(hold.includes(state.pageCount), `${where}: so is the last page`);
  }
});

test('R4: the hold set is a pure function of page, pageCount and direction', () => {
  const a = plan({ page: 40, pageCount: 90, direction: 1, held: heldPages([40, 41]) });
  const b = plan({ page: 40, pageCount: 90, direction: 1, held: [] });
  assert.deepEqual(a.hold, b.hold, 'what is already cached must not change what is held');

  const c = plan({ page: 40, pageCount: 90, direction: 1, pinnedIds: [1, 2, 3] });
  assert.deepEqual(a.hold, c.hold, 'nor may the pins');
});

test('R4: with no count yet there is no tail band, and nothing is clamped away', () => {
  for (const pageCount of [undefined, null, 0, NaN]) {
    const { hold } = plan({ page: 4000, pageCount, direction: 1 });
    assert.deepEqual(hold, [1, 2, 3998, 3999, 4000, 4001, 4002, 4003, 4004],
      `pageCount ${pageCount}: the tail is unknown, so it is not held`);
  }
});

test('R4: a page the question no longer reaches plans for the page it lands on', () => {
  assert.deepEqual(plan({ page: 99999, pageCount: 60, direction: 1 }).hold,
    plan({ page: 60, pageCount: 60, direction: 1 }).hold);
  assert.deepEqual(plan({ page: 0, pageCount: 60, direction: 1 }).hold,
    plan({ page: 1, pageCount: 60, direction: 1 }).hold);
});

/* --------------------------------------------------------------- R5: the fetch order */

test('R5: fetch order is next, then behind, then the run ahead, then the ends', () => {
  const { fetch } = plan({ page: 500, pageCount: 9780, direction: 1 });
  assert.deepEqual(fetch, [501, 499, 502, 503, 504, 1, 2, 9780, 9779]);
});

test('R5: travelling backwards swaps the signs, so the pages behind come first', () => {
  const { fetch } = plan({ page: 500, pageCount: 9780, direction: -1 });
  assert.deepEqual(fetch, [499, 501, 498, 497, 496, 1, 2, 9780, 9779]);
  assert.equal(fetch[0], 499, 'a reviewer working backwards gets 499 before 501');
});

test('R5: the words for a direction are read as well as the sign', () => {
  const back = plan({ page: 500, pageCount: 9780, direction: -1 });
  for (const direction of ['back', 'backward', 'backwards']) {
    assert.deepEqual(plan({ page: 500, pageCount: 9780, direction }), back,
      `direction ${direction} must not silently mean forward`);
  }
  const forward = plan({ page: 500, pageCount: 9780, direction: 1 });
  for (const direction of [undefined, 0, 'forward', 'anything else']) {
    assert.deepEqual(plan({ page: 500, pageCount: 9780, direction }), forward);
  }
});

test('R5: the head and the tail are fetched last, after the whole neighbourhood', () => {
  const { fetch } = plan({ page: 500, pageCount: 9780, direction: 1 });
  const last = Math.max(fetch.indexOf(504), fetch.indexOf(499));
  for (const end of [1, 2, 9779, 9780]) {
    assert.ok(fetch.indexOf(end) > last, `page ${end} must come after the neighbourhood`);
  }
});

test('R5: what the cache already holds is not asked for again', () => {
  const held = heldPages([500, 501, 502, 1, 2]);
  const { fetch } = plan({ page: 500, pageCount: 9780, direction: 1, held });
  assert.deepEqual(fetch, [499, 503, 504, 9780, 9779]);

  const all = heldPages(plan({ page: 500, pageCount: 9780 }).hold);
  assert.deepEqual(plan({ page: 500, pageCount: 9780, held: all }).fetch, [],
    'everything held is nothing to fetch');
});

test('R3: the visible page is never in the fetch list, at any state', () => {
  /* It is `refresh()`'s, on the sequencing token. A prefetch list that named it would be a
     list the caller could batch it into, which is how a prefetch comes to sit in front of
     the thing on screen. */
  for (const state of states) {
    const { fetch } = plan(state);
    assert.ok(!fetch.includes(state.page),
      `${JSON.stringify(state)}: the visible page is in the prefetch list`);
  }
});

test('R4/R5: everything fetched is something held, in range, and asked for once', () => {
  for (const state of states) {
    const { hold, fetch } = plan(state);
    const where = JSON.stringify(state);

    assert.equal(new Set(fetch).size, fetch.length, `${where}: a page fetched twice`);
    assert.ok(fetch.every((p) => hold.includes(p)),
      `${where}: fetching ${fetch.filter((p) => !hold.includes(p))}, which is not held`);
    assert.ok(fetch.every((p) => p >= 1 && p <= state.pageCount), `${where}: out of range`);
  }
});

test('R5: the pages behind are held but not chased', () => {
  /* The reviewer has just come from them, so they are already in the cache; holding them
     is what stops them being given up. Asking for them again would be a wasted request. */
  const forward = plan({ page: 500, pageCount: 9780, direction: 1 });
  assert.ok(forward.hold.includes(498));
  assert.ok(!forward.fetch.includes(498));

  const back = plan({ page: 500, pageCount: 9780, direction: -1 });
  assert.ok(back.hold.includes(502));
  assert.ok(!back.fetch.includes(502));
});

test('R5: truncating the fetch list to a request cap keeps the nearest pages', () => {
  /* The endpoint caps a page set at 12 pages or 600 rows, so the caller truncates. That is
     only safe while the list is priority-ordered. */
  const { fetch } = plan({ page: 500, pageCount: 9780, direction: 1 });
  assert.deepEqual(fetch.slice(0, 3), [501, 499, 502]);
  assert.deepEqual(fetch.slice(0, 1), [501]);
});

/* ------------------------------------------------------------------ R8: the eviction */

test('R8: nothing is evicted while the cache is inside the budget', () => {
  const held = heldPages([1, 2, 30, 31, 32, 500, 9780]);
  assert.deepEqual(plan({ page: 31, pageCount: 9780, held, budget: 3000 }).evict, []);
});

test('R8: the budget is 3,000 rows, and it is the default', () => {
  const under = heldPages(Array.from({ length: 66 }, (_, i) => 100 + i));   // 2,970 rows
  const over = heldPages(Array.from({ length: 67 }, (_, i) => 100 + i));    // 3,015 rows

  assert.equal(ROW_BUDGET, 3000);
  assert.deepEqual(plan({ page: 130, pageCount: 9780, held: under }).evict, [],
    '2,970 rows is inside the budget');
  assert.ok(plan({ page: 130, pageCount: 9780, held: over }).evict.length > 0,
    '3,015 rows is not, and no budget was passed — the default has to be the 3,000');
});

test('R8: the most distant page goes first', () => {
  const held = heldPages([500, 501, 499, 5000, 4000]);
  const { evict } = plan({ page: 500, pageCount: 9780, held, budget: 100 });

  assert.equal(evict[0], 5000, 'distance decides, and 5000 is furthest from 500');
  assert.equal(evict[1], 4000);
});

test('R8: the current page, the head and the tail are never evicted at any distance', () => {
  const held = heldPages([1, 2, 500, 501, 4000, 9779, 9780]);
  const { evict } = plan({ page: 500, pageCount: 9780, held, budget: 0 });

  assert.deepEqual(evict, [4000, 501],
    'with a budget of nothing, everything evictable goes and nothing else does');
  for (const exempt of [1, 2, 500, 9779, 9780]) {
    assert.ok(!evict.includes(exempt), `page ${exempt} must never be evicted`);
  }
});

test('R8: least-recently-used breaks a tie in distance', () => {
  const held = [
    heldPage(400, { lastUsed: 9 }),
    heldPage(600, { lastUsed: 3 })              // same distance, seen longer ago
  ];
  const { evict } = plan({ page: 500, pageCount: 9780, held, budget: 0 });
  assert.deepEqual(evict, [600, 400]);

  const other = [heldPage(400, { lastUsed: 2 }), heldPage(600, { lastUsed: 7 })];
  assert.deepEqual(plan({ page: 500, pageCount: 9780, held: other, budget: 0 }).evict,
    [400, 600], 'and it is the recency that decides, not the page number');
});

test('R8: an equal distance and an equal recency still order deterministically', () => {
  const held = [heldPage(600, { lastUsed: 4 }), heldPage(400, { lastUsed: 4 })];
  assert.deepEqual(plan({ page: 500, pageCount: 9780, held, budget: 0 }).evict,
    [400, 600], 'the lower page number first — defensible rather than arbitrary');
});

test('R8: eviction stops the moment the cache is back inside the budget', () => {
  const held = heldPages([500, 501, 502, 900, 1000, 1100]);   // 270 rows
  const { evict } = plan({ page: 500, pageCount: 9780, held, budget: 150 });

  assert.deepEqual(evict, [1100, 1000, 900],
    'three pages take 270 rows down to 135; the fourth is not needed');
});

test('R8: giving up a page that shares its rows frees nothing, so eviction goes on', () => {
  const shared = heldPage(900).ids;
  const held = [
    { page: 900, ids: shared, lastUsed: 1 },
    { page: 901, ids: shared, lastUsed: 2 },    // the same 45 rows under another page
    heldPage(500, { lastUsed: 3 })
  ];
  const { evict } = plan({ page: 500, pageCount: 9780, held, budget: 60 });

  assert.deepEqual(evict, [901, 900],
    'dropping 901 leaves those rows needed by 900, so the count does not move until both go');
});

test('R8: a row a pinned page needs is never counted as freed', () => {
  const pinned = heldPage(900).ids;                    // committed, and pinned by id
  const held = [heldPage(900, { lastUsed: 1 }), heldPage(700, { lastUsed: 2 })];

  const withPins = plan({
    page: 500, pageCount: 9780, held, pinnedIds: new Set(pinned), budget: 50
  });
  const without = plan({ page: 500, pageCount: 9780, held, budget: 50 });

  assert.deepEqual(without.evict, [900],
    'without pins, giving up the furthest page takes 90 rows to 45 and that is enough');
  assert.deepEqual(withPins.evict, [900, 700],
    'with them, giving up 900 frees nothing, so the rule has to keep going');
});

test('R8: pins alone over the budget evict what they can and then stop', () => {
  const pinned = new Set(Array.from({ length: 400 }, (_, i) => 90_000 + i));
  const held = heldPages([1, 2, 500, 501, 4000, 9779, 9780]);
  const { evict } = plan({
    page: 500, pageCount: 9780, held, pinnedIds: pinned, budget: 100
  });

  assert.deepEqual(evict, [4000, 501],
    'the pinned rows are a floor under the budget and cannot be answered by evicting');
});

test('R8: the plan and the cache agree about the budget', () => {
  /* The strongest form of this rule: apply what `plan` says to a real cache and read the
     row count back. A plan that is arithmetically plausible and disagrees with the store
     it drives would leave the cache permanently over budget and evicting on every page
     change, which is invisible at either module's own boundary. */
  const budget = 300;
  const cache = createCache();
  cache.use('one question');

  const row = (id) => ({ observation_id: id, thumbnail_url: `t/${id}.jpg` });
  for (const page of [1, 2, 30, 31, 32, 33, 500, 900, 4000, 9779, 9780]) {
    cache.put(page, Array.from({ length: 45 }, (_, i) => row(page * 1000 + i)));
  }
  assert.equal(cache.rowCount(), 495, '11 pages of 45 distinct rows');

  const pinnedIds = new Set(cache.held().find((h) => h.page === 30).ids);
  const { evict } = plan({ page: 31, pageCount: 9780, held: cache.held(), pinnedIds, budget });
  cache.evict(evict, pinnedIds);

  assert.ok(cache.rowCount() <= budget,
    `${cache.rowCount()} rows left, over a budget of ${budget}`);
  for (const kept of [1, 2, 31, 9779, 9780]) {
    assert.ok(cache.has(kept), `page ${kept} is exempt and must still be cached`);
  }
  assert.deepEqual(cache.rowsFor([...pinnedIds]).length, 45,
    'the pinned page can still be served by id, whatever was evicted around it');
});
