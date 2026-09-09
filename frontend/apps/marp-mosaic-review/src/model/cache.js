/**
 * What the client already holds for the question it is asking.
 *
 * Pure rules — no DOM, no network, no `state`. The store owns the instance and is the
 * only thing that puts anything in; this file decides what a hit is, what a page holds,
 * what a row is shared by, and what is lost when something has to go.
 *
 * **Two indexes over one store**, because the two consumers are different:
 *
 *   pages  page number  -> the observation ids it holds, in order
 *   rows   observation id -> the row
 *
 * A page holds ids; the rows are shared. That is what lets a *pinned* page be served
 * without a request — `refresh()` takes the pinned branch and asks for the ids
 * `state.pageMembers` named, which `rowsFor()` answers out of the row index — and it is
 * what stops giving up a page from taking a row another page still needs.
 *
 * **A pinned page and a cached page are not the same thing, and are disjoint.** A pinned
 * page is a promise about *membership*: these exact ids were on screen and were committed.
 * A cached page is an answer to *the question* at page N. The row index is where they meet.
 */

import { toQuery } from './query-url.js';

/**
 * The budget, in rows.
 *
 * Not pages: `pageSize` follows the reviewer's viewport, so twelve pages is 300 rows on a
 * phone and 1,200 on a wide desktop, and a page budget would mean a different footprint on
 * every machine. Not bytes either: there is no portable way to size a JavaScript object
 * graph, so a byte budget would be an estimate wearing the clothes of a measurement.
 *
 * 3,000 rows is about 3.3 MB of row objects and about 66 pages at 45 per page — six times
 * the hold set, so the reviewer can roam a long way before anything goes.
 *
 * **The second limit, said out loud rather than pretended away:** the rows carry thumbnail
 * *URLs*, and the decoded images are the browser's memory and are far larger. Nothing here
 * bounds those, and it must not claim to.
 */
export const ROW_BUDGET = 3000;

/**
 * The key: what makes two questions the same question.
 *
 * The address `model/query-url.js` produces, with the page left out and the page size put
 * in. #79 already made the question serialisable, canonical and round-trippable, so it is
 * a ready-made key — with two adjustments, each necessary:
 *
 * - **The page comes out.** It is the address, not the question; left in, every page would
 *   be its own cache. It is dropped rather than read, so handing this the whole of `state`
 *   gives the same key from any page.
 * - **The page size goes in.** `toQuery` never writes it, deliberately, and it changes what
 *   page 2 *is*. So a window resize changes the key and empties the cache, which is
 *   correct rather than a bug.
 *
 * **The exclusion set stays out** (A4, answered 2026-09-08). In the key, `excludeIds` grows
 * on every commit, so every commit would change the identity of every cached page and throw
 * the whole cache away — the reviewer waiting after every commit, which is the defect #99
 * exists to prevent. Suppression happens when a page is served instead.
 */
export function keyFor({ mode, filters, sort, pageSize }) {
  return `${toQuery({ mode, filters, sort, page: 1 })}|pageSize=${Number(pageSize) || 0}`;
}

/** A Set from whatever the caller had. `page.pinnedIds()` returns one; an array is fine. */
const asSet = (ids) => (ids instanceof Set ? ids : new Set(ids || []));

/**
 * A cache for one question at a time.
 *
 * One question, not several: a filter, the sort, the mode or the page size produce a
 * genuinely different result set, and `resetForNewQuery()` already retires the pins, the
 * committed pages and every mode's parked work for that reason. A cache outliving them
 * would be the one thing left holding rows from a question nobody is asking, so adopting a
 * different key empties it. A commit does not change the key, and so invalidates nothing.
 */
export function createCache() {
  let key = null;
  const pages = new Map();        // page -> ids, in page order
  const rows = new Map();         // id -> row
  const refs = new Map();         // id -> how many cached pages name it
  const used = new Map();         // page -> when it was last put or served

  /* A counter rather than a clock: two pages put in the same millisecond would tie, and
     the tie-break exists so that eviction has a defensible order rather than an arbitrary
     one. Monotonic is the only property needed. */
  let tick = 0;

  const release = (page) => {
    for (const id of (pages.get(page) || [])) {
      const left = (refs.get(id) || 0) - 1;
      if (left <= 0) refs.delete(id); else refs.set(id, left);
    }
  };

  const empty = () => {
    pages.clear(); rows.clear(); refs.clear(); used.clear();
  };

  return {
    /** The question these rows answer, or null before one has been adopted. */
    get key() { return key; },

    /**
     * Adopt a question. A different one empties everything; the same one keeps it all.
     *
     * Returns whether anything was thrown away, so the store can say so in the action log.
     */
    use(next) {
      if (next === key) return false;
      key = next;
      empty();
      return true;
    },

    /** Cache one page's answer. Re-putting a page replaces what it holds. */
    put(page, list) {
      release(page);
      const ids = [];
      for (const row of (list || [])) {
        const id = row.observation_id;
        ids.push(id);
        rows.set(id, row);
        refs.set(id, (refs.get(id) || 0) + 1);
      }
      pages.set(page, ids);
      used.set(page, ++tick);
    },

    has(page) { return pages.has(page); },

    /**
     * The rows for a cached page, or null when this page is not a hit.
     *
     * `exclude` is suppressed here rather than at fetch time (R12): the exclusion set grows
     * on every commit and is deliberately not part of the key, so a page cached before a
     * commit can name a row now pinned to the page it was committed on. Dropping it here
     * means the reviewer sees that page one tile short, which is correct — the row is on the
     * page they committed it on — and it means the cached answer itself is not rewritten,
     * so the same page served again with a different exclusion set is still whole.
     *
     * A page whose rows are not all present returns null rather than a short page. A hole
     * and a suppression look identical on screen and mean opposite things.
     */
    serve(page, exclude) {
      const ids = pages.get(page);
      if (!ids) return null;

      const skip = asSet(exclude);
      const out = [];
      for (const id of ids) {
        if (!rows.has(id)) return null;
        if (skip.has(id)) continue;
        out.push(rows.get(id));
      }
      used.set(page, ++tick);
      return out;
    },

    /**
     * The rows a pinned page named, or null if the row index is missing any of them.
     *
     * R11: a committed page is served without a request when every id it holds is here.
     * Null is not a failure — it is the store's cue to fetch those ids by id, which is what
     * `refresh()` did for every pinned page before this cache existed.
     */
    rowsFor(ids) {
      const out = [];
      for (const id of (ids || [])) {
        if (!rows.has(id)) return null;
        out.push(rows.get(id));
      }
      return out;
    },

    /**
     * What is held, in the shape `plan()` wants: `[{ page, ids, lastUsed }]`.
     *
     * `ids` rather than a row count, because the budget is stated in rows and two pages can
     * name the same row — a count would make the scheduler's arithmetic plausible and wrong.
     * The array is a copy: the scheduler reads it, and nothing outside here may reorder what
     * a page holds, because the order *is* the page.
     */
    held() {
      return [...pages].map(([page, ids]) =>
        ({ page, ids: ids.slice(), lastUsed: used.get(page) || 0 }));
    },

    /** Rows in the row index. The number the budget is about. */
    rowCount() { return rows.size; },

    /**
     * Give up these pages, and the rows nothing needs any more.
     *
     * `keepIds` is the pinned set, and it is absolute: a row a pinned page needs is never
     * lost here at any distance (R8), because losing it would cost the reviewer the one
     * thing `state.pageMembers` promises — that going back to a committed page shows what
     * was submitted.
     *
     * The sweep also collects rows no cached page names any more, which is how a row
     * orphaned by a re-put of its page eventually goes. `put` deliberately does not do
     * that: it is not told about pins, and a row it dropped could be exactly the one a
     * pinned page needs.
     */
    evict(list, keepIds) {
      const keep = asSet(keepIds);
      for (const page of (list || [])) {
        if (!pages.has(page)) continue;
        release(page);
        pages.delete(page);
        used.delete(page);
      }
      for (const id of [...rows.keys()]) {
        if (refs.has(id) || keep.has(id)) continue;
        rows.delete(id);
      }
    },

    /** Everything goes, and the question with it. A reload has nothing to restore. */
    clear() { key = null; empty(); }
  };
}
