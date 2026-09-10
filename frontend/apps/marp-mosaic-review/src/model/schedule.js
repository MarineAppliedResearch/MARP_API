/**
 * Which pages to hold, in what order to fetch them, and what to give up.
 *
 * Pure rules — no DOM, no network, no `state`. `plan()` is a function of where the
 * reviewer is, how far the result goes, which way they are travelling, and what the cache
 * already holds. Nothing here fetches anything and nothing here evicts anything: the
 * store does both, and it is the only place that knows a prefetch bypasses `reqSeq`.
 *
 * **The visible page is not in `fetch`, deliberately.** #99 R3 makes a prefetch bypass the
 * sequencing token entirely, and R7 makes prefetching wait until the visible page has
 * settled — so by the time this list is acted on, the visible page has already landed
 * through `refresh()` and is in the cache. A prefetch list that named it would be a list
 * the caller could batch it into, which is exactly how a prefetch comes to sit in front of
 * the thing on screen.
 *
 * **`hold` is wider than `fetch`, and that is not an oversight.** The pages behind the
 * reviewer are held — they are not given up — but they are not chased, because the
 * reviewer has just come from them and they are already there. Holding is about what to
 * keep; fetching is about what is missing and worth a request.
 *
 * The window and the budget are numbers, not options. They are settled in
 * `.marp/task.md` — *The scheduler* and *The cache* — with the reasoning.
 */

import { clampPage } from './page.js';
import { ROW_BUDGET } from './cache.js';

/* The neighbourhood, asymmetric along the direction of travel: two pages behind, four
   ahead. `pageWindow` draws ±2 in the pager, so ±2 is the minimum a single click can
   reach; four ahead covers four page turns of thinking time. Turning round mirrors it,
   because "ahead" means "where the reviewer is going", not "up". */
const BEHIND = 2;
const AHEAD = 4;

/* The two pages at each end. The pager pins page 1 and the last page as permanent chips
   at every position, so both are always one click away. */
const ENDS = 2;

/**
 * Is the reviewer travelling backwards?
 *
 * The sign of the last page movement, which the store keeps; a typed jump or a new
 * question resets it to forward. The words are accepted alongside the sign because a
 * direction that is mis-typed and silently means "forward" is invisible — the pages
 * behind simply never get fetched first, which reads as the cache being slow.
 */
const travellingBack = (direction) =>
  direction === 'back' || direction === 'backward' || direction === 'backwards'
  || (typeof direction === 'number' && direction < 0);

/** The last page, or `Infinity` while the count has not arrived yet. */
const lastPage = (pageCount) =>
  (Number.isFinite(pageCount) && pageCount >= 1) ? Math.floor(pageCount) : Infinity;

const inRange = (p, total) => Number.isFinite(p) && p >= 1 && p <= total;

/** A Set from whatever the caller had: `page.pinnedIds()` returns one, an array is fine. */
const asSet = (ids) => (ids instanceof Set ? ids : new Set(ids || []));

/**
 * The pages to hold: a window around the current page, plus the head and the tail.
 *
 * Eleven pages at most, whatever the state — which is what makes the hold set a *bounded*
 * set rather than a growing one, and what keeps one page-set request able to carry it.
 * There is no tail band until the count is known; the scheduler will ask for the tail
 * speculatively once it is, and the endpoint answers an over-the-end page with no rows.
 */
function holdSet(current, total, step) {
  const want = new Set();

  const lo = current - (step > 0 ? BEHIND : AHEAD);
  const hi = current + (step > 0 ? AHEAD : BEHIND);
  for (let p = lo; p <= hi; p++) want.add(p);

  for (let i = 0; i < ENDS; i++) want.add(1 + i);
  if (Number.isFinite(total)) for (let i = 0; i < ENDS; i++) want.add(total - i);

  return [...want].filter((p) => inRange(p, total)).sort((a, b) => a - b);
}

/**
 * Fetch order, highest priority first. The order is the whole of the rule.
 *
 * Next in the direction of travel, then the one behind, then the rest of the run ahead,
 * then the head and the tail. Signs swap when the reviewer is travelling backwards, so
 * working backwards through committed pages feels the same as working forwards.
 *
 * The list is priority-ordered rather than capped, so a caller with a request cap can
 * truncate it and still be asking for the most valuable pages first.
 */
function fetchOrder(current, total, step) {
  const order = [current + step, current - step];
  for (let n = 2; n <= AHEAD; n++) order.push(current + n * step);

  for (let i = 0; i < ENDS; i++) order.push(1 + i);
  if (Number.isFinite(total)) for (let i = 0; i < ENDS; i++) order.push(total - i);

  const seen = new Set([current]);              // the visible page is refresh()'s, not ours
  const out = [];
  for (const p of order) {
    if (seen.has(p) || !inRange(p, total)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Which held pages to give up, in the order they should go.
 *
 * Distance from the current page first, least-recently-used breaking ties. Not LRU first:
 * the reviewer's movement is dominated by ±1 around where they are, so position predicts
 * reuse far better than recency does — a page seen thirty seconds ago and 400 pages away
 * is finished with, while a page never seen and one step ahead certainly is not.
 *
 * Two exemptions, both from #99 R8. The current page, the head and the tail are never
 * given up at any distance, because the pager can reach all of them in one click. And a
 * row a pinned page needs is never lost, so dropping a page whose rows are all pinned
 * frees nothing — the count below has to know that, or eviction stops early believing it
 * has made room it has not made.
 *
 * The count is the rows the cache would hold: the distinct ids across the held pages, plus
 * the pinned ids, which are in the row index whether a cached page names them or not. A
 * row orphaned by a page being re-put is not in either, so this can read a little under
 * what the cache actually holds; `cache.evict` sweeps those whenever it runs.
 */
function evictionOrder({ current, total, held, pinned, budget }) {
  /* Two pages can name the same row, so count the references: dropping a page frees only
     the rows no surviving page still needs. */
  const refs = new Map();
  for (const entry of held) {
    for (const id of (entry.ids || [])) refs.set(id, (refs.get(id) || 0) + 1);
  }

  let rows = refs.size;
  pinned.forEach((id) => { if (!refs.has(id)) rows += 1; });
  if (rows <= budget) return [];

  const exempt = new Set([current, ...holdEnds(total)]);
  const candidates = held
    .filter((entry) => !exempt.has(entry.page))
    .sort((a, b) => Math.abs(b.page - current) - Math.abs(a.page - current)
      || (a.lastUsed || 0) - (b.lastUsed || 0)
      || a.page - b.page);                      // so two identical candidates still order

  const evict = [];
  for (const entry of candidates) {
    if (rows <= budget) break;
    evict.push(entry.page);
    for (const id of (entry.ids || [])) {
      const left = (refs.get(id) || 0) - 1;
      refs.set(id, left);
      if (left <= 0 && !pinned.has(id)) rows -= 1;
    }
  }
  return evict;
}

/** The pages the pager can always reach in one click, and so never gives up. */
function holdEnds(total) {
  const ends = [];
  for (let i = 0; i < ENDS; i++) ends.push(1 + i);
  if (Number.isFinite(total)) for (let i = 0; i < ENDS; i++) ends.push(total - i);
  return ends.filter((p) => inRange(p, total));
}

/**
 * The whole schedule for one position.
 *
 * @param page       where the reviewer is. Clamped into the result, so an address naming
 *                   a page the question no longer reaches plans for the page it lands on.
 * @param pageCount  how many pages the question has, or absent until the count arrives.
 * @param direction  the sign of the last page movement; negative is backwards.
 * @param held       what the cache holds, as `[{ page, ids, lastUsed }]` — exactly what
 *                   `cache.held()` returns. `ids` is what makes the budget honest: the
 *                   budget is stated in rows, and two pages can name the same row.
 * @param pinnedIds  the ids pinned pages need, as `page.pinnedIds(state.pageMembers)`
 *                   returns them. Never evicted, so they are a floor under the budget.
 * @param budget     rows, not pages and not bytes. Defaults to the cache's own.
 *
 * @returns `{ hold, fetch, evict }` — the pages to keep (ascending), the pages to ask for
 *          (priority order, never the visible one), the pages to give up (in order).
 */
export function plan({
  page, pageCount, direction, held = [], pinnedIds, budget = ROW_BUDGET
} = {}) {
  const total = lastPage(pageCount);
  const current = clampPage(page, total);
  const step = travellingBack(direction) ? -1 : 1;

  const hold = holdSet(current, total, step);
  const cached = new Set(held.map((entry) => entry.page));

  return {
    hold,
    fetch: fetchOrder(current, total, step).filter((p) => !cached.has(p)),
    evict: evictionOrder({
      current, total, held, pinned: asSet(pinnedIds), budget: Number(budget) || 0
    })
  };
}
