# Verification — MARP_API#99, prefetching and caching in the mosaic reviewer

<!--
  Piece C: the wiring. `src/store.js`, `tests/e2e/render.spec.mjs`, and one case plus one
  harness fix in `tests/requirements.js`.

  Written before anything was run, except one diagnostic named under *Regression
  coverage* — the contract tier was run once against the new store to find out whether the
  cache contaminates it between checks. It does, and that is recorded there rather than
  discovered later.

  Pieces A and B are committed and their unit tiers pass. This plan does not re-prove
  them; it says which requirement each of their suites already holds, so the gaps below
  are gaps in the whole task and not only in this piece.
-->

## What each test proves

`plan` = `tests/unit/schedule.test.mjs`, `cache` = `tests/unit/cache.test.mjs`,
`scale` = `tests/unit/data-scale.test.mjs` — all three committed with Pieces A and B.
Everything in the **render** and **contract** rows is new here.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| **R1** | `R1: paging forward lands on tiles that are already there` | render | Against the fixture's real 140 ms latency, a page change onto a held page draws that page's tiles with **no `.tile.skeleton` ever in the DOM**, no `#field[data-state="loading"]`, no `query` action, and in a measured time far under one latency. This is the claim the task exists to make and no other tier can see it |
| **R1** | `R1: coming back to the page behind is a hit too` | render | The reviewer moves in both directions. Page forward twice, come back: no loading state, no request |
| **R1, R10** | `R10: a commit does not invalidate what is behind` | render | The defect #99 exists for, reported by hand on 2026-09-08. Commit page 1, page on: page 2 was prefetched *before* the commit and is still a hit. Come back: page 1 is served from the row index by id, with its REVIEWED and FLAGGED badges drawn |
| **R1, R11** | same test, second half | render | A pinned page is served without a request when the row index holds every id it names |
| **R3** | `R3: a prefetch in flight never lands on the visible page` | render | A prefetch is started, the reviewer jumps while it is in flight, and it is allowed to land in the cache — after which the tiles on screen are still the page that was asked for, and equal `state.rows` exactly |
| **R6** | same test | render | The in-flight prefetch lands (`prefetch:cached` for the pages of the old position) rather than being cancelled, and was never waited on: the jump rendered before it landed |
| **R7** | `R7: prefetching yields until the visible page has settled` | render | Every `prefetch` action in the log fired while `state.loading` was false, and the first one is at least 200 ms after the render that settled the page. Both halves of R7, and the second is a real number rather than an assertion about intent |
| **R2** | `R2: a page served from the cache holds the same tiles, in the same order` | render | The drawn tile ids of a held page equal `state.rows` in order, with no duplicate and no hole, and are the same ids on a second visit. The ordering rule itself is `scale`'s (`every query carries the observation_id tie-break, at any depth`) |
| **R1, R4, R5** | `R1: at production depth, the last page is one request and its neighbour is free` | render | Scale 147 — ~440,000 rows, ~9,800 pages. A jump to the last page costs exactly one `query`; the page beside it is then held and renders with no request and no loading state. The acceptance criterion for depth |
| **R8** | `R8: roaming evicts, and a committed page never loses its rows` | render | Roam at depth until `cache:evicted` fires, then go back to the committed page: still served with no request, still showing what was submitted. The budget arithmetic and the eviction *order* are `plan`'s (12 cases); this proves the store wires them to the pinned exemption |
| **R16** | `R16: a prefetch never asks for a count` | render | Every `prefetch` request is asserted to carry no `includeTotal`, by wrapping `MarpData.queryPages` in the page and recording what the store actually sent |
| **D1** | `a superseded query writes no counts into state` | contract | The first settled defect: `state.counts` was assigned *before* the token check, so a superseded response wrote into state and only then bailed. A slow first query is superseded by a fast second; the count that lands is the newest request's, and the superseded one does not even ask |
| **D2** | same test, second assertion | contract | `counts()` is asked for once, not twice — it no longer runs on a refresh that did not run the filter |
| **R9, R10** | `cache`: 13 key cases, 4 invalidation cases | unit | The key is the question; a commit changes nothing in it; a filter, sort, mode or page size empties it |
| **R4, R5, R8** | `plan`: 10 hold-set, 8 fetch-order, 13 eviction cases | unit | Which pages, in what order, weighted by direction; the budget, the eviction order, the exemptions |
| **R11, R12** | `cache`: 4 pinned cases, 3 suppression cases | unit | A pinned page from the row index; suppression at serve time, not fetch time |
| **R13, R15** | `scale`: 27 cases | unit | Depth without growing the fixture; the page-set call in the shape of the contract |
| **R14** | `git diff --stat -- package.json` empty | mechanical | No dependency added |
| **R17** | `npm run test:unit` and `npm run test:e2e`, both projects, every existing test | all | Every filter and every sort keeps working, at both viewport widths |

**Choosing the tier is the decision that matters here twice.**

- **R1 is a rendering claim and is only testable at the render tier.** A store-level check
  cannot see a spinner. `state.loading` never becoming true is necessary but not
  sufficient — `renderGrid` draws `.tile.skeleton` from it and `computeLayout` returns
  early on it, so the test watches the **DOM** with a `MutationObserver` for the whole page
  change and fails if a skeleton or a loading field state existed at any instant, rather
  than sampling the state afterwards when the evidence has gone.
- **D1 is a store race and belongs at the contract tier**, not the render tier. Nothing is
  drawn differently at the moment it happens — that is exactly why it survived — so the
  test drives the store directly and reads `state.counts`.

## Requirements with no test

- **R18** (every schema change additive) — nothing in #99 builds a schema. It constrains
  the migrations that are later work, and there is no code here to test it against.
- **R14** is checked mechanically rather than by a test: `package.json` is unchanged, which
  the diff shows.

## Edge cases

Each traces to a defect, a trap in the app's `CLAUDE.md`, or a note handed over by Piece A
or B.

- **A cache hit still takes a sequencing token.** It awaits nothing, so it needs no guard —
  but a slower visible query already in flight must not land on top of the page the
  reviewer is now looking at. `reqSeq++` on the hit path is what stops that, and it is the
  same defect the token exists for.
- **The visible page is put into the cache.** Piece B's note: without it the scheduler sees
  the one page it can be certain of as missing, chases it, and going back one page is a
  fetch. Proved by `R1: coming back to the page behind is a hit too`.
- **The page is cached after the clamp**, so a page the question no longer reaches — a link
  to page seven of a filter reviewed down to three — is never cached as an empty answer.
- **An empty answer inside the count is not cached.** A hole and an empty result look
  identical on screen and mean opposite things.
- **The locator trap.** Every tile assertion reads `data-id` first and pins the tile;
  no `.first()` on a state selector.
- **The commit race.** The commit tests wait for the outcome badge, never a timeout.
- **The phone rail overlays the mosaic**, so a test that touches a filter opens it and
  collapses it again. The new tests avoid the rail entirely and drive the pager.
- **The current page is an `<input>`**, so it carries no `data-page`; the tests read the
  page from the store or from `#pageInput`, never from a chip.
- **Reading a computed value by polling for one that parses**, for the timings: the
  measurement subscribes to the store and resolves on the first settled notify at the
  wanted page, rather than racing a `waitForTimeout`.
- **The scale is invisible to the cache key.** `MarpData.setScale()` changes what a page
  holds without changing the question, so the depth tests change the sort immediately
  after setting it to empty the cache. Stated in the test, because a stale scale-1 page
  served at depth would look exactly like a cache defect.
- **A cache hit does not refresh `state.total`, `state.pageCount` or the status counts.**
  Named as a deliberate consequence under *Known gaps* rather than left to be found.

## Regression coverage

- **The contract tier's `reset()` had to change, and this was found by running it.** The
  page cache is keyed by the question and every check in `tests/requirements.js` asks the
  same one, so check N+1 was served check N's cached rows — which `MarpData.reload()` had
  just orphaned. Ten checks failed, reporting commits that had not happened
  (`expected "reviewed", got "unreviewed"`), a species change that had not saved, and a
  count that had not moved. `reset()` now asks a question nobody is asking first, which
  empties the cache the way a browser reload would, then asks the real one. The full
  failure output is recorded verbatim under *Results*.
- **D1 and D2** are regressions in the sense that matters: both were found by reading
  during G1, both are named in `.marp/task.md` under *Status*, and neither had a test
  before this one.

## Known gaps

Stated plainly, because a gap written down is a decision.

- **The status counts, the total and the page count are not refreshed by a cache hit.**
  This is deliberate and consistent with the pinned branch, which has always kept the last
  total, page count and `excludedForNoDate` on the ground that it is not running the
  filter. The visible consequence: while paging over held pages, *"Showing 45 of 2,656
  matching"* does not shrink as pages are committed; it is corrected by the next page that
  is genuinely fetched, and `commitPage` refreshes the status counts itself. If that reads
  wrong in use it is a design change, not a defect fix.
- **A species correction costs the next page change its cache**, because it retires every
  cached page. Found by the contract tier during this work and decided rather than
  designed up front — see the second failure under *Results*. It is a judgement call the
  human may want to revisit, and the alternative and why it was refused are recorded in
  `changeSpecies`.
- **A page cached before a commit can render one tile short of `pageSize`.** A4's accepted
  consequence, suppressed at serve time. Proved at the unit tier (`cache`: *a cached page
  never shows a row pinned to another page*), not at the render tier — there is no
  assertion here that the reviewer finds a short page acceptable, because that is a
  judgement for the human using it.
- **At depth, a row cached before a commit does not show that commit.** Piece A's note, and
  sound under the spec: a committed page is pinned, and the display of what a commit did
  comes from `state.outcomes`, not from the row. Not covered at the render tier.
- **Eviction is proved at the unit tier for its arithmetic and order**, and at the render
  tier only for the consequence (it happens, and a pinned page survives it). No test
  asserts *which* distant page went, in a browser.
- **`requestIdleCallback` versus the timer fallback.** The tests run in Chromium, which has
  it, so the fallback path is exercised by no test at any tier.
- **Nothing here is measured against a real API.** Every latency is `src/data.js`'s
  simulation. The whole task rests on that, and #99 says so.
- **No walkthrough video.** The human records those on request, and has asked for one after
  this is verified. None is recorded here.

## Manual steps

None. Everything in this plan is automated.

## Walkthrough videos

**None.** Deliberately: `playwright.config.mjs` leaves the walkthrough project out of the
run unless something names it, nothing here names it, and the human records them on
request. Every claim above is asserted at a tier that runs constantly.

---

## Results

Run 2026-09-09 on this checkout, branch `99-prefetch-and-cache`. Both tiers pass. Two
failures happened on the way and both are recorded verbatim below, because each says
something the passing run cannot.

### The numbers: what a page change costs, before and after

Measured with one throwaway spec driving the same helper the render tests use — resolved
by the store's own settled notify, not by a timeout — run first against the **committed
pre-cache `store.js`** (restored with `git show 1ca132e:…` into a file copy, per the
`CLAUDE.md` rule about never using `git checkout --`), then against this branch's store,
with nothing else changed. `LATENCY.query` is 140 ms in both.

| | desktop, before | desktop, after | phone, before | phone, after |
| --- | --- | --- | --- | --- |
| page 1 → 2 | 148 ms | **3 ms** | 154 ms | **2 ms** |
| page 2 → 3 | 145 ms | **2 ms** | 150 ms | **1 ms** |
| page 3 → 2 (back) | 146 ms | **2 ms** | 148 ms | **2 ms** |
| jump to page 22 / 40 | 149 ms | **2 ms** (held: it is the tail) | 146 ms | 150 ms (outside the hold set) |
| loading states drawn in the DOM | **4** | **1** (the opening load) | **4** | **1** |

The last row is the point rather than the milliseconds: before, every page change drew a
skeleton grid; after, the only loading state in the whole sequence is the first paint. The
phone's jump to page 40 is still a fetch, and correctly so — the phone's result is 200
pages of 15 at scale 1, so page 40 is outside the eleven pages being held, while on the
desktop 22 pages means page 22 *is* the tail and is held.

Verbatim, before:

```
[measure desktop] forward 148 ms, forward again 145 ms, back 146 ms, jump 149 ms, loading states drawn: 4
[measure phone] forward 154 ms, forward again 150 ms, back 148 ms, jump 146 ms, loading states drawn: 4
```

and after:

```
[measure desktop] forward 3 ms, forward again 2 ms, back 2 ms, jump 2 ms, loading states drawn: 1
[measure phone] forward 2 ms, forward again 1 ms, back 2 ms, jump 150 ms, loading states drawn: 1
```

### The numbers the render tests print, from the final run

```
[#99 R1] forward onto a held page: 2 ms
[#99 R1] back onto the page behind: 2 ms
[#99 R7] settled render to first prefetch: 252 ms
[#99 R10] after a commit: forward 2 ms, back 3 ms
[#99 R1] depth: 159201 rows, 3185 pages of 50, scale 147
[#99 R1] at depth: jump to the last page 149 ms, the page beside it 1 ms
[#99 R8] eviction after 10 stops: {"pages":[3185,90,91,92,93],"rows":3000}
[#99 R8] back to the committed page after eviction: 2 ms
[#99 R1] forward onto a held page: 1 ms
[#99 R1] back onto the page behind: 1 ms
[#99 R7] settled render to first prefetch: 262 ms
[#99 R10] after a commit: forward 2 ms, back 1 ms
[#99 R1] depth: 159201 rows, 10614 pages of 15, scale 147
[#99 R1] at depth: jump to the last page 146 ms, the page beside it 1 ms
[#99 R8] eviction after 33 stops: {"pages":[259,260,261],"rows":2991}
[#99 R8] back to the committed page after eviction: 1 ms
```

Four of those are worth reading rather than skimming:

- **The jump to the last page of a 10,614-page result costs 146 ms — one request — and the
  page beside it then costs 1 ms.** That is the acceptance criterion for depth, at the
  phone's page size, where the result really is the ~9,780-page shape #99 asked for.
- **The yield is 252 and 262 ms**, against the 250 ms the spec settled. The prefetcher is
  waiting, and it is waiting for about as long as it says.
- **Eviction bit after 10 stops on the desktop and 33 on the phone**, and left the cache at
  3,000 and 2,991 rows — the budget, exactly, and not below it.
- **The pages given up on the desktop were `[3185, 90, 91, 92, 93]`.** Page 3,185 going
  first looks wrong and is right: committing a page pins ~50 rows out of the query, so the
  count had dropped to 3,184 and page 3,185 no longer existed. The most distant page that
  the pager can no longer reach is the correct thing to give up first.

### The two failures, verbatim

**1. Ten contract checks failed the first time the cache was wired in.** Found by running
the contract tier against the new store deliberately, before writing the plan's harness
fix. This is the whole reason `reset()` changed:

```
Error: contract checks failed:
a committed flag is still shown after leaving the page and returning
Cannot read properties of undefined (reading 'observation_id')
a committed page stays editable: the exceptions are still marked
and committing again accepts it expected "reviewed", got "unreviewed"
a committed decision can be taken back by marking it and committing again
and the observation is now flagged instead expected "flagged", got "unreviewed"
a committed page still shows everything that was submitted on it
and still show as accepted expected "reviewed", got "unreviewed"
a committed decision can be changed and resubmitted from the same page
expected "reviewed", got "unreviewed"
a species change saves and records the change
the row should carry the new species expected "Ochre Star", got "Bat Star"
a correction under a species filter takes the row off the page, and the other marks stay
the corrected row no longer matches the filter, so it must leave the page
the status counts reflect the data and move when work is committed
committing should reduce the unreviewed count (was 1039, now 1039)
R7: a whole failed page can be retried at once
the page starts broken
R6: a queued thumbnail becomes ready, and a commit waits for it
expected "queued", got "ready"
```

Nine of the ten were one cause: every check asks the same question, so each was served the
previous check's cached rows, which its own `MarpData.reload()` had just orphaned.
`reset()` now asks a question nobody is asking first, which empties the cache the way a
browser reload would. That took it to one failure:

```
Error: contract checks failed:
a correction under a species filter takes the row off the page, and the other marks stay
the corrected row no longer matches the filter, so it must leave the page
```

**That last one was not a harness problem, and it changed the design.** A species
correction moves the row's own value out from under the species filter, so #68 requires the
row to leave the page on the next query — and a cached page went on showing it. So a
correction now retires every cached page, keeping the rows a committed page needs. A
commit still retires nothing, which is the distinction #99 settled: a committed page is
pinned and excluded from later queries, so its membership is deliberately frozen, while a
correction pins nothing. Dropping only the *visible* page was the cheaper alternative and
is rejected in a comment in `changeSpecies`: page N+1 was cached while the row was still in
the set, so the reviewer would meet the same observation twice. **A duplicate tile is worse
than one wait.** The cost is one page change at full latency after a correction, which is
what every page change cost before this task.

**2. One new render test failed on its own assertion**, on the first run of the block —
`marp:action` carries the whole log entry, so the payload is `detail.detail`:

```
1) [desktop] › tests\e2e\render.spec.mjs:2986:3 › the reviewer never waits (#99) › R8: roaming evicts, and a committed page never loses its rows

   TypeError: Cannot read properties of undefined (reading 'length')

     3047 |       + `${JSON.stringify(roam.evicted)}`);
     3048 |     expect(roam.evicted, 'roaming should have exceeded the 3,000-row budget').toBeTruthy();
   > 3049 |     expect(roam.evicted.pages.length).toBeGreaterThan(0);
          |                               ^
```

The eviction itself had already happened and printed correctly on the same run, which is
why this is a test defect and not a store one.

### The final run

`npm run test:unit`:

```
ℹ tests 216
ℹ suites 0
ℹ pass 216
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 833.716
```

`npm run test:e2e` — desktop and phone, every existing test included, exit code 0:

```
  4 skipped
  236 passed (1.8m)
```

The 4 skips are pre-existing and are the four `test.skip(info.project.name …)` lines in
`render.spec.mjs` — two layout tests that only apply to the phone and two only to the
desktop, so each is skipped in one project and runs in the other. Nothing is skipped for a
missing prerequisite.

### What the run cost

- Unit: **834 ms** for 216 tests, so the loop is still a loop.
- Contract: **28.6 s → 50.4 s.** The extra 22 s is `reset()`'s cache-emptying query, at
  140 ms across ~68 checks, plus the new stale-counts check which deliberately holds a
  query open for 900 ms. Paid to make each check start from the same place.
- Full browser tier: **1.8 min**, against 56 s recorded in `playwright.config.mjs` before
  this task — the contract check is inside it twice, once per project, and the two deep
  tests add ~30 s (the phone needs 33 stops to exceed the budget at 15 rows a page).

### Requirements, as verified

| | Result |
| --- | --- |
| R1 | **Pass.** 2 ms against 148 ms, and no loading state in the DOM at any instant, at both widths |
| R2 | **Pass.** Drawn ids equal `state.rows` in order, no duplicate, same on a second visit |
| R3, R6 | **Pass.** The in-flight prefetch landed (`prefetch:cached`) and the screen was still the jumped-to page |
| R4, R5 | **Pass** at the unit tier; exercised at the render tier through the hold set actually being held |
| R7 | **Pass.** 252 ms and 262 ms of yield, and no prefetch issued while loading |
| R8 | **Pass.** Evicted to exactly the budget, and the committed page kept its rows |
| R9, R10 | **Pass.** A commit invalidates nothing; a filter, sort, mode or page size empties it |
| R11 | **Pass.** `cache:pinned`, no request, and what was submitted still drawn |
| R12 | **Pass** at the unit tier |
| R13, R15 | **Pass** at the unit tier, and exercised here at scale 147 |
| R14 | **Pass.** `package.json` unchanged |
| R16 | **Pass.** No recorded `queryPages` call carries `includeTotal`, and every one is inside the 12-page / 600-row cap |
| R17 | **Pass.** 216 unit, 236 browser, both projects, no existing test changed except `reset()` |
| R18 | **Not tested** — no schema is built here |
| D1 | **Pass.** A superseded response writes no counts and does not ask for them |
| D2 | **Pass.** One refresh, one count; and none on the pinned or cached branch |
