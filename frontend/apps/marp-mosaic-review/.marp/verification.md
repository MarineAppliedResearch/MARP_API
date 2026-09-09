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

<!-- Appended after the run. Real output, including failures, verbatim. -->
