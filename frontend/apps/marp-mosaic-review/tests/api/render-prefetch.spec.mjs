/**
 * Prefetching, the cache, and the summary line -- against a real server (#99).
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it, and
 * three consequences of that change are in `support.mjs` rather than repeated per file:
 * the page size follows the viewport, a bare address is not `filters: {}`, and a tile is
 * never chosen by position.
 *
 * **This is the chunk that reached into the backing**, so two things moved and one could
 * not:
 *
 * - The request spy wrapped the fixture's own `queryPages`. The seam it was really watching is
 *   `src/backend.js`'s `MarpBackend`, which is the application and stays -- a plain object
 *   whose methods delegate, so the property can be wrapped and `store.js` sees the wrapper
 *   because it reads it at every call. No interception is added: `page.route()` on the page
 *   query would fetch and re-fulfil the very requests these checks count and time, which is
 *   also why `journal.mjs` listens rather than intercepts.
 * - The fixture's scale affordance inflated it to production depth -- hundreds of thousands
 *   of virtual rows -- so the last-page prefetch and the eviction budget could be observed.
 *   A real corpus is a couple of thousand rows and there is no equivalent, so the two checks
 *   that need depth are `test.fixme` with what they would need written beside them. Faking
 *   the endpoint's answer to simulate depth would be a better fake, which is not the fix for
 *   damage done by a fake.
 *
 * Refs #99, #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import {
  expectRealBacking,
  freshTile,
  isPhone,
  ready,
  undecided,
  watchErrors
} from './support.mjs';

/** Two checks here commit a page, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page }) => { ledger = journal(page); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

/* ------------------------------------------------------------------ #99: never waiting */

/**
 * Watch what the store does, from inside the page, for the whole test.
 *
 * Installed straight after `goto` and before the app has settled, deliberately: the first
 * prefetch is issued 250 ms after the opening page lands, so a listener installed after
 * `ready()` would routinely miss it and every wait for a prefetch would time out.
 *
 * Four things are recorded, and each is here because the obvious way to check it is wrong:
 *
 * - **every named action**, with `state.loading` *at that instant* — R7 is about when a
 *   prefetch is issued, and reading the flag afterwards reads a flag that has moved;
 * - **every render**, so the gap between the render that settled a page and the prefetch
 *   that followed is a measured number rather than an intention;
 * - **whether a loading state was ever in the DOM**, through a `MutationObserver`.
 *   Rendering here is a full re-render, so the skeleton grid is gone within one notify:
 *   sampling `.tile.skeleton` after a page change cannot see the flash that R1 forbids;
 * - **what the store actually sent** to `queryPages`, so "a prefetch never asks for a
 *   count" is read off the request rather than trusted.
 *
 * The spy is on `MarpBackend`, not on the fixture (#157). `backend.js` is the seam every
 * layer above `api/` calls, and its methods are properties on a plain object that
 * `store.js` reads at each call — so wrapping one is observed, and `MarpApi.query` has its
 * own method, so what lands here is still the prefetches and nothing else.
 */
async function instrument(page) {
  await page.evaluate(async () => {
    const { state, subscribe } = await import('./src/store.js');
    const { MarpBackend } = await import('./src/backend.js');

    window.__acts = [];
    const note = (entry) => { if (window.__acts.length < 6000) window.__acts.push(entry); };

    window.addEventListener('marp:action', (e) => note({
      name: e.detail.name, detail: e.detail.detail,
      loading: state.loading, page: state.page, at: performance.now()
    }));
    subscribe((s) => note({ name: '(render)', loading: s.loading, page: s.page, at: performance.now() }));

    window.__spins = 0;
    const look = () => {
      if (document.querySelector('.tile.skeleton')
        || document.querySelector('#field[data-state="loading"]')) window.__spins++;
    };
    window.__watch = new MutationObserver(look);
    window.__watch.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'data-state']
    });
    look();

    window.__sent = [];
    /* The delegate ignores `this`, so the bind is belt and braces rather than load-bearing;
       it keeps the wrapper the same shape as the one this replaced. */
    const real = MarpBackend.queryPages.bind(MarpBackend);
    MarpBackend.queryPages = (args) => {
      /* The abort signal is a host object and does not cross back to the test. Everything
         the assertions read does, and `includeTotal` stays absent when it was absent. */
      const record = { ...args };
      delete record.signal;
      window.__sent.push(record);
      return real(args);
    };
  });
}

const acts = (page) => page.evaluate(() => window.__acts);
const spins = (page) => page.evaluate(() => window.__spins);
const sent = (page) => page.evaluate(() => window.__sent);

/** Forget what has happened so far, so the next assertion is about one page change only. */
const fromHere = (page) => page.evaluate(() => {
  window.__acts.length = 0;
  window.__spins = 0;
});

/** The ids actually drawn, in the order they are drawn. */
const drawn = (page) =>
  page.locator('.tile').evaluateAll((tiles) => tiles.map((t) => t.dataset.id));

/** Which pages the store has asked the data layer for, since `fromHere`. */
const requests = (log) =>
  log.filter((a) => a.name === 'query' || a.name === 'query:pinned');

/**
 * Wait until the prefetcher says it has these pages.
 *
 * An observable rather than a duration, which is what makes it survive the move: a real
 * page-set request is a round trip over a real corpus rather than the fixture's simulated
 * 140 ms, and the 20 s ceiling is a failure budget rather than a wait.
 */
async function prefetched(page, wanted) {
  await expect.poll(() => page.evaluate((want) => {
    const got = new Set();
    for (const a of window.__acts) {
      if (a.name === 'prefetch:cached') for (const p of (a.detail.pages || [])) got.add(p);
    }
    return want.every((p) => got.has(p));
  }, wanted), {
    timeout: 20_000,
    message: `the scheduler should have fetched pages ${wanted.join(', ')} ahead`
  }).toBe(true);
}

/**
 * Change page, and answer with how long that page took to be on screen.
 *
 * Measured inside the browser and resolved by the store's own settled notify, because a
 * `waitForTimeout` would measure the timeout and a poll would measure the poll interval.
 * A cache hit notifies synchronously inside `goToPage`, so the number really is the cost
 * of the page change and not of a round trip to the test.
 */
function pageChange(page, to) {
  return page.evaluate((want) => new Promise((resolve, reject) => {
    import('./src/store.js').then(({ actions, state, subscribe }) => {
      const target = want === 'next' ? state.page + 1
        : want === 'prev' ? state.page - 1 : want;
      if (target === state.page) return reject(new Error(`already on page ${target}`));
      const bail = setTimeout(() => reject(new Error(`page ${target} never settled`)), 20_000);
      const t0 = performance.now();
      const off = subscribe((s) => {
        if (s.loading || s.page !== target) return;
        clearTimeout(bail);
        off();
        resolve(performance.now() - t0);
      });
      actions.goToPage(target);
    }, reject);
  }), to);
}

/**
 * Take the result set to production depth, and empty the cache that was holding the
 * shallow one.
 *
 * The fixture's scale affordance renumbered every row **without changing the question**, so the
 * cache key did not move and the scale-1 pages would go on being served at depth — which
 * would look exactly like a cache defect. A different sort was the cheapest real change of
 * question, so the scale change was followed by one.
 *
 * **There is no such thing against a real server, and this is why the two checks below are
 * `fixme` rather than rewritten** (#157). Depth was a property of the fixture, not of the
 * application: the corpus is a couple of thousand rows, so the whole result is four dozen
 * pages, the last page is one click from the first, and the 3,000-row budget in
 * `model/cache.js` is never reached however far the reviewer roams. Reviving them needs one
 * of two real things — a corpus deep enough to hold a five-figure page count, or the row
 * budget made reachable from outside `cache.js` — and not an endpoint taught to answer as
 * though it had one.
 */
function goDeep(page) {
  throw new Error(
    'There is no way to reach production depth against a real corpus, and faking one is '
    + 'what #157 removed. See the two `test.fixme` checks below for what reviving them needs.'
  );
}

/** Commit the page and wait for the outcome, never for a timeout. */
async function commitAndWait(page) {
  await page.locator('#commit').click();
  await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
}

test.describe('the reviewer never waits (#99)', () => {
  test('R1: paging forward lands on tiles that are already there', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    /* The spy goes on before the app settles: the first prefetch is 250 ms behind the
       opening page, and `expectRealBacking` is an assertion rather than a wait. */
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);
    await prefetched(page, [2, 3]);

    const before = await drawn(page);
    await fromHere(page);
    const ms = await pageChange(page, 'next');
    const log = await acts(page);

    /* No request at all -- the page was already held. */
    expect(requests(log)).toEqual([]);
    expect(log.some((a) => a.name === 'cache:hit')).toBe(true);

    /* And no loading state at any instant. Not "loading was false when we looked": a full
       re-render replaces the skeleton grid within one notify, so the flash R1 forbids is
       invisible to anything that samples afterwards. */
    expect(await spins(page)).toBe(0);
    await expect(page.locator('.tile.skeleton')).toHaveCount(0);
    expect(log.filter((a) => a.name === '(render)' && a.loading)).toEqual([]);

    /* The tiles are really there, and they are really the next page's. */
    const after = await drawn(page);
    expect(after.length).toBeGreaterThan(8);
    expect(after).not.toEqual(before);
    await expect(page.locator(`.tile[data-id="${after[0]}"]`)).toBeVisible();

    /* `LATENCY.query` was 140 ms in the fixture, deliberately, so no fetch could be this
       fast. Against a real server the argument only gets stronger: a round trip to the
       database is longer still, so 60 ms is a number only the cache can produce. This is
       the number that goes in .marp/verification.md. */
    console.log(`[#99 R1] forward onto a held page: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(60);
    expect(errors).toEqual([]);
  });

  test('R1: coming back to the page behind is a hit too', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);
    await prefetched(page, [2]);

    const first = await drawn(page);
    await pageChange(page, 'next');
    /* The scheduler recomputes from the new position; page 1 is head, so it is held. */
    await prefetched(page, [4]);

    await fromHere(page);
    const ms = await pageChange(page, 'prev');
    const log = await acts(page);

    expect(requests(log)).toEqual([]);
    expect(await spins(page)).toBe(0);
    expect(await drawn(page)).toEqual(first);
    console.log(`[#99 R1] back onto the page behind: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(60);
    expect(errors).toEqual([]);
  });

  test('R2: a page served from the cache draws the same tiles, in the same order',
    async ({ page }) => {
      await page.goto(undecided());
      await instrument(page);
      await expectRealBacking(page);
      await ready(page);
      await prefetched(page, [2]);

      await pageChange(page, 'next');
      const once = await drawn(page);
      /* What is drawn is exactly what the store holds -- no hole, no duplicate. */
      const rows = await page.evaluate(async () =>
        (await import('./src/store.js')).state.rows.map((r) => String(r.observation_id)));
      expect(once).toEqual(rows);
      expect(new Set(once).size).toBe(once.length);

      /* And the same page is the same page on a second visit. */
      await pageChange(page, 'prev');
      await pageChange(page, 'next');
      expect(await drawn(page)).toEqual(once);
    });

  test('R10/R11: a commit does not invalidate what is behind', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);
    await prefetched(page, [2, 3]);

    /* Read the id and pin the tile: `.tile:not(.marked)` stops matching the moment it is
       clicked, and `.first()` then slides quietly onto its neighbour. `freshTile` is that
       rule plus the one the real corpus adds -- a tile already carrying a decision takes it
       back when clicked, which is the opposite of marking it (#157). */
    const tile = await freshTile(page);
    await tile.click();
    await expect(tile).toHaveClass(/marked/);
    await commitAndWait(page);

    const reviewed = await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count();
    expect(reviewed).toBeGreaterThan(1);
    const committed = await drawn(page);

    /* Paging on must not discard what is behind -- the defect #99 exists for, reported by
       hand on 2026-09-08. Page 2 was fetched ahead *before* the commit and is still held. */
    await fromHere(page);
    const forward = await pageChange(page, 'next');
    let log = await acts(page);
    expect(requests(log)).toEqual([]);
    expect(await spins(page)).toBe(0);

    /* And back: a committed page is served from the row index by the ids it was committed
       with (R11), with no request, and it still shows what was submitted. */
    await fromHere(page);
    const back = await pageChange(page, 'prev');
    log = await acts(page);
    expect(requests(log)).toEqual([]);
    expect(log.some((a) => a.name === 'cache:pinned')).toBe(true);
    expect(await spins(page)).toBe(0);
    expect(await drawn(page)).toEqual(committed);

    await expect(tile.locator('.badge')).toContainText('FLAGGED');
    expect(await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count()).toBe(reviewed);
    console.log(`[#99 R10] after a commit: forward ${Math.round(forward)} ms, back ${Math.round(back)} ms`);
    expect(errors).toEqual([]);
  });

  test('R7: prefetching yields until the visible page has settled', async ({ page }) => {
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);
    await prefetched(page, [2]);

    const log = await acts(page);
    const started = log.filter((a) => a.name === 'prefetch');
    expect(started.length).toBeGreaterThan(0);

    /* Not one of them was issued while a page was loading. */
    expect(started.filter((a) => a.loading)).toEqual([]);

    /* And the yield is real: the first prefetch is at least 200 ms after the render that
       settled the page, because a response landing mid-layout would notify again and
       re-render on top of the layout pass the reviewer is waiting for. */
    const first = started[0];
    const renders = log.filter((a) => a.name === '(render)' && !a.loading && a.at < first.at);
    expect(renders.length).toBeGreaterThan(0);
    const gap = first.at - renders[renders.length - 1].at;
    console.log(`[#99 R7] settled render to first prefetch: ${Math.round(gap)} ms`);
    expect(gap).toBeGreaterThanOrEqual(200);
  });

  test('R16: a prefetch never asks for a count', async ({ page }) => {
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);
    await prefetched(page, [2]);
    await pageChange(page, 'next');
    await prefetched(page, [4]);

    const asked = await sent(page);
    expect(asked.length).toBeGreaterThan(0);
    /* The total is one per question. Asking again is a second pass over the matching set
       for a number the client already has. */
    expect(asked.filter((a) => a.includeTotal !== undefined)).toEqual([]);
    /* And it stays inside the cap the endpoint enforces: 12 pages or 600 rows. Against the
       real endpoint that cap is the server's own rather than a fixture's manners. */
    for (const a of asked) {
      expect(a.pages.length).toBeLessThanOrEqual(12);
      expect(a.pages.length * a.pageSize).toBeLessThanOrEqual(600);
    }
  });

  test('R3/R6: a prefetch in flight never lands on the visible page', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);
    await prefetched(page, [2]);

    /* Driven from inside the browser: the jump has to happen while the prefetch is
       genuinely in flight, and a round trip to the test was 140 ms of the 140 ms it lasted
       on the fixture. A real page-set request lasts longer, which makes the window wider
       rather than narrower -- but the jump still has to be issued from the `prefetch`
       event, because nothing outside the page knows when that is. */
    const out = await page.evaluate(() => new Promise((resolve, reject) => {
      import('./src/store.js').then(({ actions, state }) => {
        const bail = setTimeout(() => reject(new Error('no prefetch was seen')), 20_000);
        let jumped = null;

        const onStart = (e) => {
          if (e.detail.name !== 'prefetch') return;
          window.removeEventListener('marp:action', onStart);
          /* The reviewer jumps, mid-flight, to somewhere the prefetch is not fetching. */
          jumped = Math.min(state.pageCount, state.page + 12);
          actions.goToPage(jumped);
        };
        const onLand = (e) => {
          if (!jumped) return;
          if (e.detail.name !== 'prefetch:cached' && e.detail.name !== 'prefetch:stale') return;
          window.removeEventListener('marp:action', onLand);
          clearTimeout(bail);
          /* Let anything the landing might have caused actually happen before looking. */
          setTimeout(() => resolve({
            landed: e.detail.name, jumped, page: state.page, loading: state.loading,
            rows: state.rows.map((r) => String(r.observation_id))
          }), 400);
        };
        window.addEventListener('marp:action', onStart);
        window.addEventListener('marp:action', onLand);

        /* A held page: it settles at once, which is what schedules the next prefetch. */
        actions.goToPage(state.page + 1);
      }, reject);
    }));

    /* The jump has to be somewhere else, or the assertions below are vacuous. On the
       fixture the result was always deep enough; a real question can be shallow. */
    expect(out.jumped, 'this question has too few pages for the reviewer to jump away '
      + 'from the prefetch, so there is nothing here to be about').toBeGreaterThan(2);

    /* It was allowed to land rather than cancelled (R6) -- the rows answer the same
       question and may be exactly where the reviewer goes next. */
    expect(out.landed).toBe('prefetch:cached');

    /* And the screen is still the page that was asked for. A prefetch takes no sequencing
       token, so nothing it fetched could have been mistaken for the visible page. */
    expect(out.page).toBe(out.jumped);
    expect(out.loading).toBe(false);
    expect(await drawn(page)).toEqual(out.rows);
    await expect(page.locator('#pageInput')).toHaveValue(String(out.jumped));
    expect(errors).toEqual([]);
  });

  /* FIXME (#157): this needs a result set thousands of pages deep, and the only thing that
     ever produced one was the fixture's scale affordance, at 147. The corpus is a
     couple of thousand rows, so "the last page" is two clicks from the first and is held
     before the reviewer asks for it -- the jump this measures cannot be a genuine fetch, so
     the check would pass while proving nothing. What it proves when it runs: a jump to a
     page nothing could have held costs **exactly one** request rather than one per page of
     the set, and the page beside it is then free. Reviving it needs a testing database with
     a five-figure page count under one question -- not an endpoint taught to answer as
     though it had one. */
  test.fixme('R1: at production depth, the last page is one request and its neighbour is free',
    async ({ page }) => {
      test.setTimeout(90_000);
      const errors = watchErrors(page);
      await page.goto(undecided());
      await instrument(page);
      await expectRealBacking(page);
      await ready(page);

      const deep = await goDeep(page);
      console.log(`[#99 R1] depth: ${deep.total} rows, ${deep.pageCount} pages `
        + `of ${deep.pageSize}, scale ${deep.scale}`);
      expect(deep.pageCount).toBeGreaterThan(1000);

      /* The jump itself is a genuine fetch -- nothing could have held page 9,000 -- and it
         must cost exactly one request rather than one per page of a set. */
      await fromHere(page);
      const jump = await pageChange(page, deep.pageCount);
      let log = await acts(page);
      expect(requests(log).length).toBe(1);
      await expect(page.locator('.tile').first()).toBeVisible();

      /* And then the page beside it is free, which is the point of a page *set*. */
      await prefetched(page, [deep.pageCount - 1]);
      await fromHere(page);
      const beside = await pageChange(page, deep.pageCount - 1);
      log = await acts(page);
      expect(requests(log)).toEqual([]);
      expect(await spins(page)).toBe(0);
      expect((await drawn(page)).length).toBeGreaterThan(8);

      console.log(`[#99 R1] at depth: jump to the last page ${Math.round(jump)} ms, `
        + `the page beside it ${Math.round(beside)} ms`);
      expect(jump).toBeGreaterThan(100);          // it really did go to the data layer
      expect(beside).toBeLessThan(60);
      expect(errors).toEqual([]);
    });

  /* FIXME (#157): this one needs depth *and* enough rows to exceed a budget. `ROW_BUDGET`
     in `model/cache.js` is 3,000 rows and is a constant rather than a setting, so on a
     corpus of a couple of thousand rows the whole result fits in the cache and eviction
     never fires however far the reviewer roams -- the roam below would spin through every
     page it has and resolve with `evicted` null. What it proves when it runs: eviction
     takes the distant and unpinned pages, stops the moment it is back inside the budget,
     never takes the page the reviewer is standing on, and **never loses a row a committed
     page needs** -- the pinned exemption, which is the part with a defect history. Reviving
     it needs the same deep corpus as the check above, or the budget made reachable from
     outside `cache.js`; simulating either is what #157 removed. */
  test.fixme('R8: roaming evicts, and a committed page never loses its rows', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);

    const deep = await goDeep(page);
    expect(deep.pageCount).toBeGreaterThan(1000);

    /* Commit a page a long way in, not page 1: the head is exempt from eviction by band,
       so a pinned page 1 would prove nothing about the pinned exemption. */
    const home = Math.floor(deep.pageCount / 3);
    await pageChange(page, home);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await commitAndWait(page);
    const committed = await drawn(page);

    /* Roam until the budget bites. Each stop fetches a fresh page set, so the 3,000-row
       budget is reached in a handful of stops on a desktop and rather more on a phone,
       where a page is a third the size -- so this is driven by the eviction actually
       happening rather than by a fixed number of stops. */
    const roam = await page.evaluate((away) => new Promise((resolve, reject) => {
      import('./src/store.js').then(({ actions, state, subscribe }) => {
        let evicted = null;
        /* `marp:action` carries the whole log entry, so the payload is `detail.detail`. */
        window.addEventListener('marp:action', (e) => {
          if (e.detail.name === 'cache:evicted') evicted = evicted || e.detail.detail;
        });

        const settle = (n) => new Promise((done) => {
          const off = subscribe((s) => { if (!s.loading && s.page === n) { off(); done(); } });
          actions.goToPage(n);
        });
        const landed = (ms) => new Promise((done) => {
          const t = setTimeout(() => { window.removeEventListener('marp:action', h); done(false); }, ms);
          const h = (e) => {
            if (e.detail.name !== 'prefetch:cached' && e.detail.name !== 'prefetch:failed') return;
            clearTimeout(t); window.removeEventListener('marp:action', h); done(true);
          };
          window.addEventListener('marp:action', h);
        });

        (async () => {
          const spread = Math.max(13, Math.floor((state.pageCount - 40) / 44));
          let stops = 0;
          for (let i = 1; i <= 44 && !evicted; i++) {
            const target = 20 + i * spread;
            if (target >= state.pageCount - 2 || target === away) continue;
            stops += 1;
            await settle(target);
            await landed(10_000);
          }
          resolve({ evicted, stops });
        })().catch(reject);
      }, reject);
    }), home);

    console.log(`[#99 R8] eviction after ${roam.stops} stops: `
      + `${JSON.stringify(roam.evicted)}`);
    expect(roam.evicted, 'roaming should have exceeded the 3,000-row budget').toBeTruthy();
    expect(roam.evicted.pages.length).toBeGreaterThan(0);
    /* Back inside the budget, and no further -- eviction stops the moment it has room. */
    expect(roam.evicted.rows).toBeLessThanOrEqual(3000);
    /* What went is distant and unpinned, never the page the reviewer is standing on. */
    expect(roam.evicted.pages).not.toContain(home);

    /* The committed page is still there, without a request: its page was given up, and
       every row a pinned page needs was kept. */
    await fromHere(page);
    const backHome = await pageChange(page, home);
    const log = await acts(page);
    expect(requests(log)).toEqual([]);
    expect(log.some((a) => a.name === 'cache:pinned')).toBe(true);
    expect(await spins(page)).toBe(0);
    expect(await drawn(page)).toEqual(committed);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    console.log(`[#99 R8] back to the committed page after eviction: ${Math.round(backHome)} ms`);
    expect(backHome).toBeLessThan(60);
    expect(errors).toEqual([]);
  });
});

test.describe('the summary says where you are', () => {
  /* Reported 2026-09-09, once paging became instant: the reviewer moves far more than
     before, and the line only said how many rows were on screen. It now says which page
     that is, out of how many, and what the page size is. */

  const summary = (page) => page.evaluate(() => ({
    pageNow: document.querySelector('#pageNow').textContent.trim(),
    pageTotal: document.querySelector('#pageTotal').textContent.trim(),
    shown: document.querySelector('#shown').textContent.trim(),
    perPage: document.querySelector('#perPage').textContent.trim(),
    tiles: document.querySelectorAll('.tile').length
  }));

  test('it names the page, the page count and the page size', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);

    const at = await summary(page);
    expect(at.pageNow).toBe('1');
    expect(Number(at.pageTotal)).toBeGreaterThan(1);

    /* The page size is stated, and it is the size -- not the row count, which differs on
       a short page. Both are on screen, so neither has to be inferred from the other. */
    const size = await page.evaluate(() => window.MARP.state.pageSize);
    expect(Number(at.perPage)).toBe(size);

    /* On a phone that clause is hidden rather than absent -- the row scrolls sideways and
       M3 requires the sort control to stay inside the viewport, so the trailing words are
       what the row gives up. "Page 2 of 24" is the part worth the width, and it stays at
       both sizes. This asserts the concession deliberately, so it cannot rot into an
       accident. The project name is the question, never a pixel width: a headless viewport
       can be clamped and lie about it. */
    const wordy = page.locator('.sub .per-page');
    if (isPhone(info)) await expect(wordy).toBeHidden();
    else await expect(wordy).toBeVisible();
    await expect(page.locator('#pageNow')).toBeVisible();

    /* And the row count really is the rows drawn, so the number cannot describe a page
       the reviewer is not looking at. */
    expect(Number(at.shown)).toBe(at.tiles);
    expect(errors).toEqual([]);
  });

  test('the page it names follows the reviewer, including onto a cached page',
    async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(undecided());
      await instrument(page);
      await expectRealBacking(page);
      await ready(page);
      await prefetched(page, [2, 3]);

      /* Forward onto a held page: the whole point is that nothing is fetched, so if the
         summary were only refreshed by a query it would sit on page 1 and be wrong. */
      await fromHere(page);
      await pageChange(page, 'next');
      expect(requests(await acts(page)), 'this page change must be a cache hit').toEqual([]);

      let at = await summary(page);
      expect(at.pageNow, 'a cache hit must still move the page number').toBe('2');
      expect(Number(at.shown)).toBe(at.tiles);

      await pageChange(page, 'next');
      at = await summary(page);
      expect(at.pageNow).toBe('3');

      await pageChange(page, 'prev');
      at = await summary(page);
      expect(at.pageNow, 'and going back moves it back').toBe('2');
      expect(Number(at.shown)).toBe(at.tiles);

      /* It agrees with the pager, which is the other place the answer appears. */
      const typed = await page.locator('#pageInput').inputValue();
      expect(typed, 'the summary and the pager must not disagree').toBe(at.pageNow);
      expect(errors).toEqual([]);
    });

  test('a committed page keeps its own count when the reviewer returns', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(undecided());
    await instrument(page);
    await expectRealBacking(page);
    await ready(page);

    await commitAndWait(page);
    await pageChange(page, 'next');
    await pageChange(page, 'prev');

    /* A pinned page is served by id, so the rows are exactly what was submitted -- and
       the number beside them has to be those rows, not the page size. */
    const at = await summary(page);
    expect(at.pageNow).toBe('1');
    expect(Number(at.shown)).toBe(at.tiles);
    expect(errors).toEqual([]);
  });
});
