---
task: MarineAppliedResearch/MARP_API#99
repos: [marp-api]
status: design
needs: []
---

<!--
  Prefetching and caching in the mosaic reviewer. G0/G1 only: this document is the
  deliverable, and nothing under src/ or tests/ has been touched.

  `marp spec check` parses the headings, so they are fixed. See AGENTS.md.

  NOTE for whoever runs the gate: this spec sits at
  `frontend/apps/marp-mosaic-review/.marp/task.md`, not at the repository root.
  `marp spec check` and the PreToolUse spec-gate both look at `<repo>/.marp/task.md`
  and will not find it, so the G1 gate is open unless it is pointed here:
  `marp spec check MARP_API/frontend/apps/marp-mosaic-review`. Raised in the G1
  report; deliberately not fixed here.
-->

## Goal

A reviewer never waits for data. Paging through a result feels like scrolling something
already in memory — whichever page they go to, and however deep into the set they are.
Today every page change waits on a query, and at production scale (440,102 observations,
roughly 9,780 pages at 45 per page) that wait is the whole experience of the tool. This
task decides the query the API should serve, writes that contract down concretely enough
to implement, says what the schema has to become to serve it, and builds the client's
scheduler and cache to it against a fixture deep enough to prove the claim.

## The basis, and what this design is allowed to assume

**The recommendations rest on a reading of `db/baseline/schema.sql`, the index set, the
migrations, the client code, and how the query would actually have to be built. There is
no measurement, and that is the agreed basis** — the local `mare_v1` has not been loaded
with real data, so a benchmark would be a query over an empty table answering "fast" to
everything. It is the right basis for a decision taken now, not a substitute for a better
one.

**Neither the index set nor the schema is treated as a constraint.** Rewriting the API is
expected and that includes the schema: #68 carries this as Phase 2/3 schema and API work,
and #99 expects new endpoints for the mosaic rather than bent existing ones. So the
question answered below is *what should the mosaic be served by* — not *what can the
current tables support*. What the schema has to become is a deliverable of this spec, in
*What the schema has to become*.

**The one hard constraint is data preservation, and it is not negotiable.** `mare_v1` is a
scientific record that people and tools outside this workspace query and report on. Any
transformation of existing data must lose nothing: a column that stops being populated, a
value that becomes ambiguous, or a format an existing query can no longer parse all count
as loss, even when the application still works, and derived columns are part of that
contract. Every schema change below is described as a migration that preserves what is
there, wrapping its work in `db/data-integrity.js` — which counts rows and foreign-key
references before and after and refuses to commit if anything was lost — and carrying a
`down` that restores what it changed. `migrations/20260901120500-add-observations-species-id.js`
is the worked example to copy. **Where a change would be hard to make losslessly, it is
said plainly rather than proposed as though it were free.**

**Meaning is asked about, not inferred.** Two existing columns look like review state and
the schema does not settle what they mean; that is A7, for the human, not something to work
out by inspection.

## The starting state

Read from `db/baseline/schema.sql` and the 19 files in `migrations/`. This is where the
endpoint's author begins. It is not why the design is what it is.

**`observations` carries exactly two indexes.**

| Index | Columns | Where it comes from |
| --- | --- | --- |
| `observations_pkey` | `observation_id` | `db/baseline/schema.sql:2282` |
| `observations_species_id_idx` | `species_id` | `migrations/20260901120500-add-observations-species-id.js` |

`db/baseline/schema.sql` contains no `CREATE INDEX` on `observations` at all; the species
one comes from that migration's `addIndex` call, and no other migration adds or drops an
index on the table. There is **no index on** `project_id`, `session_id`, `user_id`,
`taxserial`, `comname`, `confidence`, `createdAt`, `updatedAt`, `obsID` or `video_source`
— the foreign keys included.

**`keyframes` carries one index**, `keyframes_pkey` on `keyframe_id`
(`db/baseline/schema.sql:2234`). There is **no index on `keyframes.observation_id`**, the
column every mosaic row aggregates over for `keyframe_count` and `first_framenum`.
`sessions`, `projects` and `users` carry their primary keys plus two unique name
constraints; `species` is well indexed, including `species_taxserial_idx`.

**None of the four sort fields the client offers is indexed today.** `SORT_FIELDS` in
`src/model/filters.js` declares exactly four: `confidence`, `keyframe_count`, `updatedAt`
and `obsID`. `confidence` and `updatedAt` are unindexed columns; `obsID` is a different
column from the indexed `observation_id` and is unindexed; `keyframe_count` is not a
column at all — it is `count(*)` over an unindexed `keyframes.observation_id`.

**There is no pagination anywhere in the API today.** `routes/observation.routes.js`
registers eighteen routes and none takes a page, a limit or an offset;
`repository/observation.repository.js` contains no `limit`, no `offset` and no
`findAndCountAll`. `GET /api/v2/observations` returns every row. The mosaic endpoint is
entirely new, so there is no existing caller to keep compatible and the contract can be
exactly what the mosaic needs.

**The client filters on ten dimensions, five of them across joins.**
`src/model/dimensions.js` declares `project`, `dive`, `line`, `sessionType`, `session`,
`species`, `confidence`, `timeOfDay`, `date` and `model`, each carrying a `source` naming
where it lives in the real schema. `dive`, `line` and `sessionType` are `sessions`
columns; `project` is `projects.name`; `model` has no column yet. #68 requires the
combinations to be irregular — *"all bat stars from several complete projects, or one dive
from one project combined with selected dives and lines from others"* — so the cross
product is not something a finite index set can cover, whatever the schema looks like.

## Requirements

- **R1** — Paging to any page the scheduler was holding renders that page's tiles with no
  loading state and with no request. This is the claim the whole task exists to make, it
  is a rendering claim, and it is proved in `tests/e2e/render.spec.mjs` against a fixture
  latency high enough that a real fetch would be plainly visible.
- **R2** — Every query the client makes carries the reviewer's sort terms followed
  unconditionally by `observation_id`, exactly as `sortTerms` in `model/filters.js` already
  guarantees. A page served from the cache and the same page re-fetched hold the same ids
  in the same order.
- **R3** — A prefetch never takes the visible-page sequencing token (`reqSeq` in
  `store.js`), never sets `state.loading`, never calls `notify()` for a page that is not on
  screen, and never causes the visible page to render later than it would have without it.
- **R4** — The scheduler holds a named, bounded set of pages: a window around the current
  page, plus the head and the tail of the result. It recomputes that set on every page
  change, and the set is a pure function of `{ page, pageCount, direction }`.
- **R5** — Fetch order is priority-ordered and weighted by the direction the reviewer is
  travelling. A reviewer moving backwards has the pages behind them fetched first.
- **R6** — At most one prefetch request is in flight. A prefetch already in flight when the
  reviewer jumps is allowed to land in the cache, is never waited on, and is never
  cancelled.
- **R7** — Prefetching yields. No prefetch is issued until the visible page has settled,
  plus an idle delay.
- **R8** — The cache has a budget stated in rows. When it is exceeded, pages are evicted by
  distance from the current page with least-recently-used breaking ties, and a row a pinned
  page needs is never evicted.
- **R9** — The cache is keyed by the *question* — mode, filters, sort and page size — not by
  the address, not by the page number, and not by the exclusion set.
- **R10** — Committing does not invalidate the cache. Changing a filter, the sort, the mode
  or the page size empties it. A reload has nothing to restore, because it is in memory.
- **R11** — A pinned page (`state.pageMembers`) is served without a request when every id it
  names is present in the cache's row index.
- **R12** — A cached page never shows an observation pinned to a different page. Suppression
  happens when the page is served, not when it is fetched.
- **R13** — `src/data.js` can serve a result set deep enough that eviction genuinely happens
  and the last page is genuinely far away — the production shape, ~440,000 rows and ~9,780
  pages — without the fixture file growing and without the synthesis cost landing inside
  the measured latency.
- **R14** — `src/data.js` stays the only file that knows where observations come from, and
  no runtime dependency is added.
- **R15** — The page-set call is implemented behind `data.js` in exactly the shape the
  endpoint will serve, so Phase 8 replaces the body and nothing above the seam changes.
- **R16** — The count is requested once per question and never on a prefetch.
- **R17** — Every existing filter and every existing sort keeps working. The unit, contract
  and render suites pass unchanged, at both viewport widths.
- **R18** — Every schema change this design asks for is additive, is reachable by a
  migration that preserves every value and every foreign-key reference already there, and
  carries a `down`. No existing column stops being populated and none changes meaning.

## Open assumptions

A1–A4 shape the endpoint somebody else has to write; A7 is a question about what existing
data means. They are consultative by instruction and by #99: the recommendation and the
trade are given, the answer is the human's, and nothing is built on any of them until they
are answered.

- [x] **A1 · API contract · blocking** — Offset, cursor (keyset), or a hybrid?
  **Recommend offset**, addressed by page number and served by one materialising page-set
  query (see *The query contract*). **Argued on design merit with both the index set and
  the schema treated as things we will change** — see *Why offset, with a free hand at the
  schema* for the argument in full. In short: the things the client already requires — a
  discontiguous page set in one request, a typed page jump, the first/last chips, a
  shareable `page=N` link — are page-number operations that no cursor can express and no
  schema change makes expressible, so keyset does not remove offset from the system, it
  adds a second path beside it; keyset's constant-depth property needs one index covering
  the filter *and* the sort, which the irregular ten-dimension filter set structurally
  prevents however the tables are shaped; and, decisively for this task, **keyset optimises
  next and previous, which is exactly the movement the cache being built here makes free.**
  Designing the schema freely does not favour cursors — it gives page numbers a *better*
  answer, because the ordering itself can be persisted (see *If it is not fast enough*).
  **The trade, plainly.** Offset in the materialising form buys page numbers, the
  discontiguous page set, the exact count from the same pass, and one code path; it pays a
  cost proportional to the *matching set*, paid on every request, flat in depth. Keyset
  buys a cost proportional to the page size — real once indexed, and real only for
  next/previous over a filter the index covers — at the price of everything above.
  **The hybrid, and what it costs**, is under *The hybrid, and why not yet*: two
  implementations of one ordering that must agree exactly, where a disagreement is not a
  performance bug but a correctness one, because #68 makes page membership query-derived
  and `state.pageMembers` pins whatever the ordering produced.
- [x] **A2 · API contract · blocking** — How is a set of pages requested, including the
  discontiguous case? **Recommend `POST /api/v2/mosaic/observations/pages`** carrying an
  explicit `pages: [1,2,3,47,48,9779,9780]` array, capped server-side, with the response
  echoing which pages it carries. POST rather than GET because the question carries ten
  filter dimensions with multi-selects *and* an exclusion set that reaches thousands of
  observation ids after a session of committing (`page.pinnedIds` in `store.refresh`),
  which does not fit a URL under any common proxy limit. **The trade:** POST gives up HTTP
  caching and idempotent-by-method semantics, neither of which this client uses — it has
  its own cache and its own sequencing. A GET with the question in the query string would
  be cacheable and would break the first time a reviewer committed twenty pages.
- [x] **A3 · API contract · blocking** — Where does the count come from, and what does a
  count over an arbitrary filter combination cost on 440,102 rows? **Recommend it comes
  from the same scan as the rows**, as `count(*) OVER ()` inside the materialising CTE,
  returned only when the client asks (`includeTotal: true`) — which it does once per
  question and never on a prefetch. **The cost, read rather than measured:** the count is
  over the *matching* set after filters, and it is the same pass the page-set query
  performs anyway, so the *marginal* cost of an exact count is close to zero. That is the
  argument for taking it from that pass rather than from a separate `COUNT(*)` endpoint
  (two passes), from `pg_class.reltuples` (wrong under any filter, and #68 requires
  "Showing 50 of 2,656 matching" to be true), or from a cache (an invalidation problem, for
  a number that is already free). **The trade:** the client must then remember the count
  across prefetches rather than re-reading it from every response, and a count that arrives
  with the rows cannot be shown before them.
- [x] **A4 · behavioural · blocking** — Is `excludeIds` in the cache key? **Recommend no.**
  `store.refresh()` sends `excludeIds: page.pinnedIds(state.pageMembers)` on every query,
  and that set grows on every commit. In the key, every commit invalidates the entire
  cache — the reviewer waiting after every commit, which is precisely what #99 forbids
  ("A commit does not invalidate the cache"). Out of the key, a page cached before a commit
  may hold a row now pinned to a committed page, so suppression moves to serve time (R12)
  as a rule in `model/`. **The trade:** a cached page can be one row short of `pageSize`
  after a commit, which is visible and is the correct thing to show — those rows are on the
  page the reviewer committed them on.
- [ ] **A5 · performance · non-blocking** — The budget is 3,000 rows, and eviction is by
  distance with LRU as the tie-break. Recommendation and reasoning under *The cache*; both
  are tunable numbers rather than structure, so this is recorded rather than blocking.
- [ ] **A6 · architectural · non-blocking** — Depth comes from a scale factor inside
  `data.js`, not from a larger fixture file. Reasoning under *How the fixture gets deep
  enough*. Recorded rather than blocking because it is invisible above the seam.
- [x] **A7 · scientific or data-meaning · blocking** — **What do `observations."taxReview"`
  (`varchar(255)`) and `observations.sizereview` (`integer`) mean, and does either already
  record a review decision?** Nothing in the schema, the migrations or the repository
  settles it, and it is not answerable by inspection — which is exactly the case AGENTS.md
  says to ask about rather than infer. It is blocking because it decides whether the review
  table #68 settled on is **purely additive** (recommended, and what *What the schema has to
  become* assumes) or whether it has to carry these forward, which would make it a
  transformation of existing scientific data rather than an addition — a different migration
  with a different risk. **Recommendation: treat both as out of scope and untouched**, on
  the reading that they predate this workflow, and design the review table additively. If
  either does hold a review decision, say so and this section is rewritten before anything
  is built.
- [ ] **A8 · database/schema · non-blocking** — For `observations.ml_model_id`: should a
  hand-entered observation be recorded as a distinguishable "no model" rather than a null?
  Carried forward unanswered from #68's schema audit, which flagged it as a question for
  whoever owns the decision rather than one to infer. Not blocking here because the mosaic
  simulates the dimension in the fixture and nothing in this task depends on the answer.

## Answered, 2026-09-08

The human answered all five blocking assumptions. G1 is closed and implementation may
start. A1, A2 and A3 were delegated to the calling agent to confirm rather than
rubber-stamp; A4 was delegated outright; A7 was answered from domain knowledge that is
not in the schema and could not have been inferred from it.

- **A1 — offset, as recommended.** Confirmed on the ground the spec argues: the
  page-number requirements are already in shipped code — the pager's typable `<input>`
  (`ui/chrome.js`), the permanent first/last chips (`pageWindow` in `model/page.js`), and
  `page=N` in the shareable address (#79). A cursor cannot express any of them, so keyset
  would be additive complexity beside a path that has to exist anyway rather than a
  replacement for it. The escape hatch — persist the numbering — is preferred over a
  hybrid for the reason the spec gives: one ordering, not two that must agree exactly.
  **Risk to carry, not a blocker:** the materialising form costs O(matching rows) on the
  first request per question, so a broad filter pays for a full pass before the cache can
  hide anything. That is what *What to measure when the data lands* exists to check, and
  the ~400 ms threshold is the number that reopens this.
- **A2 — `POST` with an explicit `pages[]` array, as recommended.** Settled by one fact
  rather than by preference: `excludeIds` reaches thousands of observation ids after a
  session of committing, which does not fit a URL under any common proxy limit. GET is
  not a stylistic alternative here, it is broken. The 12-page / 600-row cap stands, and
  so does returning `rows: []` for a page past the end — the scheduler asks for the tail
  before it knows the count.
- **A3 — the count comes from the same pass as the rows, as recommended.** With one
  coupling named, because it is easy to lose: the count is free *because* the
  materialising pass already walks the matching set. A1 and A3 are one decision seen
  twice. **The contract must not assume the count's source is permanent** — if the
  snapshot table is ever built, the count comes from there instead, and `includeTotal`
  should read as "tell me the total", never as "run `count(*) OVER ()`".
- **A4 — `excludeIds` stays out of the cache key, as recommended.** Delegated to
  judgement, and the reasoning is the one the spec gives: in the key, the set grows on
  every commit, so every commit changes the identity of every cached page and discards
  the whole cache. That is the reviewer waiting after every commit, which is the defect
  #99 exists to prevent and which was reported by hand on 2026-09-08. Duplicate
  suppression therefore happens at serve time (R12).
  **The visible consequence, stated so it is not discovered as a bug:** a page cached
  before a commit can render one tile short of `pageSize`. That is correct — those rows
  are on the page they were committed on, which is the same promise `state.pageMembers`
  already makes — but it is visible, and if it reads wrong in use it is a design change
  rather than a defect fix.
- **A7 — `taxReview` and `sizereview` are former review flags, and they stay vestigial.**
  Answered from domain knowledge: they are the old flags for "the species needs checking"
  and "the size needs checking". The decision is to **stop writing them and use the new
  review records instead**, leaving the existing values untouched for historical data.
  So the review table #68 settled on **is purely additive**, as recommended, and *What the
  schema has to become* stands unchanged. No migration transforms them; nothing new reads
  or writes them.
  **A follow-on question this raises, deliberately not answered here — see A9.**

## Answered after the gate

- [x] **A9 · scientific or data-meaning · answered 2026-09-08** — Now
  that A7 has established `taxReview` and `sizereview` are former review flags, should the
  mosaic **display** that historical intent? An observation whose species was already
  flagged for checking years ago is precisely what a reviewer would want to see, and #85
  settled the general principle that every mode shows every workflow's tags. Leaving the
  columns vestigial is a decision about *writing* them; whether anything *reads* them is a
  separate question and belongs to the phase that builds the review surface. Recorded here
  so the answer to A7 did not quietly lose it.
  **Answered 2026-09-08: no. Leave them alone entirely.** The mosaic will read the new
  columns that arrive with the new endpoints, and nothing in it reads `taxReview` or
  `sizereview`. So the two columns are vestigial in both directions — not written, and not
  read — and the review surface is built only on the review records #68 settled. Nothing
  in #99 depended on this either way.

## Decisions

- **2026-09-08** — A1, A2, A3, A4 and A7 answered by the human; see *Answered*. G1 is
  closed. A7's answer keeps the review table additive, which is what every schema
  recommendation here assumed.
- **2026-09-08** — The count's *source* is not part of the contract, only its
  availability. `includeTotal` means "tell me the total"; how the server derives it may
  change without the client changing.
- **2026-09-08** — The basis for A1–A4 is a reading of the schema, the client code and the
  query shape, with no measurement, because the database has not been loaded. This is the
  agreed basis rather than a fallback.
- **2026-09-08** — **Neither the index set nor the schema is a constraint.** A1 is argued on
  design merit; what the schema has to become is a deliverable of this spec.
- **2026-09-08** — **Every schema change this design asks for is additive.** Nothing existing
  is rewritten, renamed, dropped or repurposed. Where a tempting change would be lossy, it
  is named and refused rather than proposed.
- **2026-09-08** — A pinned page and a cached page are disjoint by construction. `refresh()`
  takes the pinned branch before the query branch, so a pinned page is never *in* the page
  cache; it is served from the cache's row index by id. That is the whole relationship, and
  it is why the cache has two indexes rather than one.
- **2026-09-08** — Prefetches bypass `reqSeq` entirely rather than participating in it. A
  request that can never become the visible page needs no sequencing, and giving it a token
  is how it would come to overwrite the visible page.

## Why offset, with a free hand at the schema

The index question and the schema question are both set aside here. Assume we add whatever
columns, tables and indexes the design needs. The recommendation is still offset, and it is
stronger for the wider question rather than weaker.

**1. The client's requirements are page-number requirements, and no schema change makes a
cursor able to satisfy them.**

| What the client does | Where | Under a cursor |
| --- | --- | --- |
| Ask for a discontiguous set of pages in one request | #99, settled 2026-09-09; the scheduler's unit | Cannot name a page it has not walked to |
| Type a page number and jump | `ui/chrome.js` renders the current page as an `<input>` | Needs an offset path |
| Show the first and last page as permanent chips | `pageWindow` in `model/page.js`; #68 *Navigating pages* | The last page is reachable by reversing the sort; "page 4,000" is not |
| Send a link to `?page=9780` | `model/query-url.js`; #79 | A cursor token is opaque, and goes stale |

This is the part of the argument that is untouched by anything we can do to the tables. A
cursor is a position, not an address; the interface #68 specifies is addressed.

**2. Keyset's constant-depth property needs one index covering the filter and the sort
together, and the filter set prevents that whatever shape the tables take.** A keyset step
is `WHERE (confidence, observation_id) > (:c, :id) ORDER BY confidence, observation_id
LIMIT 45`, and it touches 45 index entries **only when every predicate is satisfied by that
same index**. Denormalising the join-borne dimensions onto `observations` — `dive`, `line`,
`type` — would let *some* of them into a composite index, and it is worth doing for the one
or two commonest shapes. It does not solve the problem: #68 requires the combinations to be
irregular, so the cross product of ten dimensions cannot be covered by any finite index
set, and for any filter the index does not cover, a keyset scan walks the index discarding
non-matching rows — offset's cost profile, reached by a more complicated route, with fewer
capabilities.

**3. Cost in the right currency.** A materialising page-set query costs O(matching rows),
and the matching set is the work the reviewer is actually doing — the mosaic is *built* by
filtering, and #99's own example is 2,656 matching rows out of 440,102. It is **flat in
depth**: page 1 and page 9,780 cost the same, which is exactly what #99 asks for ("however
deep into the set they are"). Offset's classic weakness — deep pages costing more than
shallow ones — is a property of `LIMIT/OFFSET`, not of page-number addressing, and the
materialising form does not have it.

**4. Decisive for this task: keyset optimises the one movement the cache makes free.**
Keyset is fastest at next and previous. Prefetching is *also* fastest at next and previous
— that is what the scheduler holds first. Once this task ships, next/previous is a cache
hit and costs nothing at all. What is left on the network is jumps, first/last and
speculative page sets: the movements keyset is worst at and offset is best at. Spending a
second code path to speed up the traffic this task is removing is the wrong trade.

### If it is not fast enough: persist the ordering, do not switch to cursors

This is what changes when the schema is designable, and it is worth stating because it is
the answer people reach for cursors to get.

If measurement shows the materialising pass too slow at production size, the fix is to
**persist the numbering** rather than to change the addressing: a snapshot table
`mosaic_page_membership (query_id, rn, observation_id)`, built once per question, after
which every page — any page, any discontiguous set, at any depth — is an index-only lookup
of `WHERE query_id = ? AND rn BETWEEN ? AND ?`. That is **offset semantics at keyset cost**,
and it keeps every page-number capability above.

#68 has already reserved the ground: *Saved views versus managed review batches* says a
managed batch with fixed or versioned membership is not required initially and must not be
ruled out. This is that, in its smallest useful form.

What it costs, said plainly rather than sold:

- **Freshness.** A snapshot is stale the moment another reviewer commits, and #68's
  *Concurrent review* is explicit that the ordinary workflow is first-valid-review-wins with
  live updates. A frozen membership fights that, so it needs a lifetime and a rule for when
  it is rebuilt.
- **A write path and a cleanup path**, for a table whose rows are disposable. That is
  operational work, not schema work.
- It is **additive and lossless** — a new table referencing `observations(observation_id)`,
  touching nothing existing — so R18 is satisfied trivially. That is the one part of it
  that is free.

**Recommend not building it now.** Build the materialising query, measure it, and reach for
this only if measurement says so. It is named here so that the escape hatch is a known
design rather than a rewrite.

### The hybrid, and why not yet

Keyset for next and previous, offset for a jump. It is the reasonable third answer and it
should be reopened when there is a measurement, but not adopted now:

- **Two implementations of one ordering must agree exactly.** Not a soft requirement here:
  #68 makes page membership query-derived, `state.pageMembers` pins whatever the ordering
  produced, and a cursor path and an offset path that disagree by one row mean page 7 by
  cursor and page 7 by number hold different observations. A correctness bug that presents
  as a display bug, which is the class of defect this application has produced most.
- **The prefetcher cannot use the fast path.** A page set cannot be expressed in cursors, so
  the component this task exists to build would fall back to the offset path for everything
  it does. The hybrid's fast path would serve only the reviewer's manual next click — which,
  after this task, is a cache hit.
- **It does not generalise across the sorts.** `keyframe_count` is `count(*)` over
  `keyframes`, so no cursor can step through it without denormalising the count onto
  `observations` first. A hybrid would be keyset for three sorts and offset for the fourth:
  a third path.

**When to revisit:** if the measurement below shows the materialising query exceeding
roughly 400 ms on a typical reviewer question at production size. At that point the second
path has earned itself — though *persist the ordering* is the cheaper answer to the same
problem, and should be compared against it rather than assumed away.

## What the schema has to become

What the mosaic needs, what has to change to provide it, and — for each — that it is
reachable by a migration preserving everything currently there. **Everything below is
additive.** The pattern to copy is
`migrations/20260901120500-add-observations-species-id.js`: work wrapped in
`guardDataIntegrity` from `db/data-integrity.js`, unresolved rows reported rather than
guessed at, and a `down` that genuinely reverses.

### New tables

| What | Why the mosaic needs it | Losslessness |
| --- | --- | --- |
| **`observation_reviews`** — reviewer, decision, reason, purpose/mode, timestamp, one row per reviewer per observation per workflow | #68 settled this: a review belongs to the reviewer, not to the observation, so it is a table and not a `review_status` column. The mosaic's default filter is on current review state, so the query must be able to filter and sort on it | **Purely additive**, subject to A7. New table, new foreign key to `observations(observation_id)`, nothing existing touched. `down` drops it |
| **`observation_training_dispositions`** — same shape, for promoted/excluded/undecided | Same decision, same reason. Scientific review and training review are independent (#68), so they are two tables and not one with a discriminator | Same |
| **`mosaic_page_membership`** *(only if measurement demands it)* | The escape hatch above | Additive; disposable rows |

**The mosaic filters on *current* state, and that is the part to design deliberately.** A
review table answers "what has each reviewer said"; the mosaic asks "what does this
observation's current state say", on every row of every page, as a filter. Getting that
from the table on the fly is a `DISTINCT ON (observation_id) … ORDER BY … DESC` or a
lateral, per query, over the matching set. Two ways to serve it, and this is a real
decision for whoever builds it rather than one to settle here: derive it in the query, or
maintain a projection (`observation_review_current`) that the query joins. Both are
additive. The projection is faster to filter and index and is another thing that can drift;
the derivation cannot drift and costs more. **Recommend deriving it first** and measuring,
on the same principle as the pagination answer: do not add a maintained copy before there
is a number saying it is needed.

### New columns on `observations`

All nullable, all additive, none replacing anything.

| Column | Why | Losslessness |
| --- | --- | --- |
| `ml_model_id` → `ml_models(id)`, nullable | #68's audit: nothing links an observation to the model that produced it, and "which model produced this" is the question a reviewer most obviously wants to filter on. Nullable because every observation predating the link, and every hand-entered one, has no model and never will | Additive. Backfill only where a link is genuinely derivable; report what does not resolve rather than guessing, exactly as the species migration does. See A8 for whether "no model" should be distinguishable from null |
| `version` integer, default 1 | #68 *Concurrent review* requires optimistic concurrency so a stale page cannot overwrite somebody else's decision; nothing provides a token today. The client already assumes it — `data.js` increments `row.version` on every write | Additive with a default; no existing value changes. Prefer an integer over reusing `updatedAt`: timestamps tie, and this repository already has a truncation trap in `db/timecode.js` worth not repeating |
| `observed_at timestamptz`, nullable | The mosaic has a `date` dimension and today it must parse `tc`, which is `varchar(255)` of .NET `TimeSpan` text and only carries a date where the clock was synced (#76). A real timestamp makes the dimension indexable and removes the parsing | **This is the one to be careful about.** Additive and backfilled *where derivable*; **`tc` is not rewritten, not reformatted and not dropped.** It is the record of what was actually recorded, and #76 exists because it cannot answer for every row. Null means "no date derivable", the count of which the endpoint already reports as `excludedForNoDate`. Use `db/timecode.js` for the parsing; never re-implement the arithmetic |

### What must **not** change, and why

Naming these is part of the deliverable, because each is a change somebody will reasonably
propose and each would lose something:

- **`comname` is never rewritten or dropped**, and the species filter should move to
  `species_id` beside it rather than replacing it. The species migration's own reasoning:
  roughly 50,000 observations disagree with what their list says today, because lists have
  been renamed and renumbered underneath recorded data, and `comname` is the only record of
  what the annotator actually chose at the time. Dropping it would quietly rewrite history.
- **`taxserial` stays**, for the same reason, and because `species_id` is nullable — about
  4% of observations do not resolve to a current list entry.
- **`tc`, `etc`, `mediaPosition`, `actualPosition` and `frame` stay as they are.** They are
  .NET `TimeSpan` text written by the annotation GUI, and a format an existing query can no
  longer parse counts as loss. `observed_at` sits beside `tc`; it does not replace it.
- **`taxReview` and `sizereview` are not touched** pending A7. If either turns out to hold a
  review decision, the review table becomes a migration of existing scientific data rather
  than an addition, and that is a different piece of work with a different risk.
- **No soft-delete marker.** #68 settled Delete Mode as a true permanent delete; adding a
  marker would contradict a settled decision.

### Indexes the design needs

`observation_id` appears in every composite because the tie-break is part of the ordering —
an index on `(confidence)` alone still leaves a sort node in the plan to resolve ties, so it
does not eliminate the sort that #68's deterministic-ordering requirement forces on every
query. **The tie-break is not something to append; it is the last column of the index.**

| Index | Why | Priority |
| --- | --- | --- |
| `keyframes (observation_id)` | A missing foreign key index. Every mosaic row needs `count(*)` and `min(framenum)` per observation; without it that is a scan of `keyframes` per query, and #55 records 33,764 keyframes in a *single* session | **Highest.** Needed whatever A1 answers |
| `observations (session_id)` | Missing foreign key index. Every mosaic query joins `sessions`, and the `dive`, `line` and `sessionType` predicates push onto it | High. Needed whatever A1 answers |
| `observations (project_id)` | Missing foreign key index; project is the outermost dimension of the rail | High |
| `observations (confidence, observation_id)` | The default sort (`DEFAULT_SORT` is `confidence asc`), tie-break included, so an ordered scan needs no sort node | High |
| `observations (species_id, confidence, observation_id)` | The commonest single query the app makes: `DEFAULT_FILTERS.species` narrows to one species and `DEFAULT_SORT` orders by confidence. The one filter-plus-sort composite that clearly earns its place | High |
| `observations ("obsID", observation_id)` | The "Observation number" sort. Quoted — `obsID` is camelCase, and it is **not** `observation_id` | Medium |
| `observations ("updatedAt", observation_id)` | The "Last updated" sort. **The one index here with a real ongoing write cost** — see below | Medium, and justify it by use |
| `observation_reviews (observation_id, created_at DESC)` and the training equivalent | What "current state for this observation" is derived from | With the tables |
| `observations (observed_at)` | The date dimension, once the column exists | Medium |

**`keyframe_count` cannot be indexed as it stands.** It is `count(*)` over `keyframes`, so
ordering by it means a sort over the matching set — acceptable under the materialising
design, since that pass happens anyway. The alternative is a maintained
`observations.keyframe_count`, which is a **derived column and therefore part of the data
contract**: once it exists, anything that stops maintaining it is data loss, not a stale
cache. Not proposed here.

### What the indexes and columns cost on a 440,102-row table

- **Storage is not the issue.** A two-column btree over 440k rows is on the order of 10–15
  MB; the whole list is well under 100 MB. The new nullable columns are close to free.
- **Write cost is the issue, and it concentrates in one index.** `observations` is written
  by the annotation GUI *during* a session — inserts as the annotator works, and updates
  through `updateObservationWithCount` and `updateObservationWithSize` in
  `routes/observation.routes.js`. Each index adds a btree insert per row insert. More
  importantly, Postgres can only use a HOT update — which skips index maintenance entirely —
  when **no indexed column changes**, and `updatedAt` changes on every update. So
  `observations ("updatedAt", observation_id)` **defeats HOT updates on every write to the
  table**, and it should be added because the "Last updated" sort is actually used, not
  because the list looks tidier with it.
- **Build cost, and a real trap.** `CREATE INDEX CONCURRENTLY` on 440k rows is seconds and
  is what should be used, so the annotation GUI is not locked out while it builds. **It
  cannot run inside a transaction block** — and every migration in this repository wraps its
  work in one, `db/data-integrity.js` included. A migration adding these has to be written
  outside that pattern, deliberately, with a comment saying why.

## What to measure when the data lands

Short and specific. Read-only, and never against production.

1. **The typical question, as the endpoint would serve it.** Filters `species_id = <Bat
   Star>` and review status unreviewed; sort `confidence ASC, observation_id ASC`;
   `pageSize` 45; one request for pages `[1, 2, 3, 4400, 8798, 8799]`. Run under `EXPLAIN
   (ANALYZE, BUFFERS)` with the indexes above in place.
2. **Flatness.** The same query for page 1 alone and for the last page alone. They should
   cost the same. If they do not, the materialising form is not doing what this design
   claims.
3. **The keyset comparison.** `WHERE (confidence, observation_id) > (:c, :id) ORDER BY
   confidence, observation_id LIMIT 45` under the same filter, at page 1 and at page 8,798,
   with `observations (species_id, confidence, observation_id)` present.
4. **Selectivity, because the whole argument turns on it.** The size of the matching set for
   two or three questions a reviewer would really ask. The materialising design costs
   O(matching rows), so a typical matching set of 30,000 and one of 300,000 are different
   decisions.
5. **The cost of current review state**, derived per query, over the matching set — because
   that is the one part of the query with no existing shape to reason from.

**The numbers that would change the answer:**

- The materialising page-set query on the typical question exceeding **~400 ms** at
  production size. Above that a prefetch can no longer hide behind the reviewer's thinking
  time. Reopen A1 — and compare *persist the ordering* against the hybrid before choosing
  the hybrid, because it solves the same problem without a second addressing scheme.
- Keyset at depth on a *filtered* query proving materially faster than the materialising
  query — say better than 3× on measurement 3. If it is not, which is what a filtered join
  should predict, the hybrid is dead and offset stands on merit.
- Typical matching sets an order of magnitude larger than expected. That is the one result
  that would genuinely argue for keyset, since an unselective filter is the case it handles
  best.

## The query contract

**Conditional on A1, A2 and A3.** Written against the recommendation so it can be reviewed
concretely; if the answers differ, this section is rewritten before anything is built.

### Request

`POST /api/v2/mosaic/observations/pages`

```jsonc
{
  "filters": {
    "project":     ["Deep Reef Survey 2025"],   // projects.name
    "dive":        ["D04"],                     // sessions.dive
    "line":        ["1"],                       // sessions.line
    "sessionType": ["Fish"],                    // sessions.type  (NOT session_type)
    "session":     [400],                       // observations.session_id
    "species":     [41],                        // observations.species_id
    "confidence":  { "from": 0.0, "to": 0.8 },  // observations.confidence, inclusive
    "timeOfDay":   { "from": "22:00", "to": "02:00" },  // may wrap past midnight
    "date":        { "from": "2026-08-01", "to": null },
    "model":       [],                          // observations.ml_model_id, once it exists
    "reviewStatus":        ["unreviewed"],
    "trainingDisposition": []                   // empty means NOT FILTERING, never a default
  },
  "sort":     [{ "field": "confidence", "dir": "asc" }],
  "pageSize": 45,
  "pages":    [1, 2, 3, 47, 48, 49, 9779, 9780],
  "exclude":  [100123, 100456],
  "includeTotal": true
}
```

Field meanings, and the rules that are not optional:

- **`filters`** — the ten dimensions of `model/dimensions.js` plus the two status
  dimensions of `model/modes.js`. An **absent or empty value means not filtering**, never
  "apply the owning mode's default". That distinction is #89's, and getting it wrong drops
  151 rows out of the fixture's opening page silently.
- **`sort`** — one or two terms, each `{ field, dir }`, `field` drawn from the closed list in
  `SORT_FIELDS`. **The server appends `observation_id` as the final term, always,
  unconditionally, and regardless of what the client sent.** Page membership is
  query-derived (#68), so a comparator that can return zero for two different rows means
  page one holds different observations on each visit. The client appends it too; both
  appending is correct and neither may stop.
- **`pageSize`** — the client's request, bounded by a server maximum. It follows the
  reviewer's viewport (`setPageSize` in `store.js`), so it is not a constant and is not in
  the address.
- **`pages`** — an explicit list of 1-based page numbers. **May be discontiguous.**
  De-duplicated and sorted server-side. Capped: recommend **12 pages or 600 rows per
  request, whichever binds first**, and a request exceeding it is rejected with `400` rather
  than silently truncated.
- **`exclude`** — observation ids the client already holds pinned to a committed page.
  Optional; omitting it on a prefetch is fine.
- **`includeTotal`** — when true the response carries `total` and `pageCount`. The client
  sends it once per question; every prefetch sends it false.

### Response

```jsonc
{
  "pageSize": 45,
  "total":     2656,        // only when includeTotal
  "pageCount": 60,          // only when includeTotal
  "pages": [
    { "page": 1,    "rows": [ /* … */ ], "rowCount": 45 },
    { "page": 9780, "rows": [ /* … */ ], "rowCount": 17 }
  ],
  "excludedForNoDate": 0,
  "servedAt": "2026-09-08T11:04:22.113Z"
}
```

- **`pages`** carries an entry for **every** page that was asked for, in ascending page
  order, so the client never has to work out which came back. A page beyond `pageCount`
  returns `rows: []` and `rowCount: 0` rather than an error — the scheduler asks for the
  tail speculatively before it knows the count.
- **`rows`** are mosaic rows: the `observations` columns plus the joined fields
  (`project_name`, `dive`, `line`, `lineId`, `type`, `processor_name`, `scientific_name`,
  `keyframe_count`, `first_framenum`) that #68's schema audit established are a join and not
  a migration, plus the current review and training state from the new tables. The fixture
  calls the session's type `session_type`; **the schema calls it `type` and the schema's
  name wins.**
- **`excludedForNoDate`** — how many observations a date filter could not answer for because
  no date is derivable (#76). A filter that silently omits is worse than no filter.
- **`servedAt`** is diagnostic. Nothing depends on it.

### How it would have to be built

One pass, not one pass per page:

```sql
WITH matched AS (
  SELECT o.observation_id,
         row_number() OVER (ORDER BY o.confidence ASC, o.observation_id ASC) AS rn,
         count(*)     OVER ()                                                AS total
    FROM observations o
    JOIN sessions s ON s.session_id = o.session_id
    JOIN projects p ON p.project_id = s.project_id
   WHERE <the filters, including current review state>
)
SELECT m.rn, m.total, o.*, s.dive, s.line, s."lineId", s.type,
       u.name AS processor_name, sp.species AS scientific_name,
       k.keyframe_count, k.first_framenum
  FROM matched m
  JOIN observations o ON o.observation_id = m.observation_id
  JOIN sessions     s ON s.session_id     = o.session_id
  LEFT JOIN users   u ON u.user_id        = o.user_id
  LEFT JOIN species sp ON sp.id           = o.species_id
  LEFT JOIN LATERAL (
        SELECT count(*)::int AS keyframe_count, min(framenum) AS first_framenum
          FROM keyframes WHERE observation_id = o.observation_id) k ON true
 WHERE m.rn BETWEEN 1 AND 45            -- page 1
    OR m.rn BETWEEN 91 AND 135          -- page 3
    OR m.rn BETWEEN 440056 AND 440100   -- page 9780
 ORDER BY m.rn;
```

Four properties, each the reason for the shape:

1. **A discontiguous page set costs the same as one page.** The scan and the sort happen once
   regardless of how many bands are asked for. That is what makes the page set the
   scheduler's natural unit rather than an optimisation.
2. **It is flat in depth.** Page 9,780 costs what page 1 costs — the property people reach
   for keyset to get, obtained without giving up page numbers.
3. **The count falls out of the same pass**, answering A3 without a second scan.
4. **The cost is proportional to the matching set**, paid per request. That is the honest
   downside, it is why measurement 4 matters, and *If it is not fast enough* is the exit.

Rejected, with the reason. **N × `LIMIT/OFFSET` UNION ALL**, one subquery per requested
page: simpler SQL, but each page pays its own offset walk, so a set spanning page 1 and page
9,780 walks 440,000 rows for that one page. **Plain `LIMIT/OFFSET` per request** is cheaper
than the materialising form for shallow pages, because Postgres can use a bounded top-N
heapsort while `offset + limit` stays small — so it trades "cheap shallow pages, expensive
deep pages" for "uniformly moderate pages". Uniform is the right trade when the requirement
is that the reviewer never waits *however deep they are*.

### Two traps for the endpoint's author

- **Sequelize will not write this.** A `hasMany` include (`keyframes`) combined with `limit`
  makes Sequelize emit a subquery and duplicate parent rows; ordering on an included model's
  column with `limit` compounds it. Every existing joined query in
  `repository/observation.repository.js` is unpaginated for that reason. Write this one as
  `sequelize.query`.
- **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction**, and every migration here
  wraps its work in one.

## The scheduler

Pure rules, in a new `src/model/schedule.js`. No DOM, no network, no `state`.

### Which pages to hold, and the numbers

Given the current page `c` and page count `P`:

| Band | Pages | Why |
| --- | --- | --- |
| Neighbourhood | `c-2 … c+4` | 7 pages, asymmetric forward because forward is where the reviewer goes. `pageWindow(current, total, span = 2)` already draws ±2, so ±2 is the minimum a click can reach; +4 covers four page turns of thinking time |
| Head | `1, 2` | `pageWindow` pins page 1 in the pager at every position, so it is always one click away |
| Tail | `P, P-1` | Same, for the last page. #68 makes the last page a permanent chip |

Eleven pages, about 495 rows at 45 per page. Clamped to `[1, P]` and de-duplicated, so a
short result holds everything and asks for nothing twice.

### Fetch order

Priority, highest first. The order is the whole of the rule:

1. **The visible page.** Always, alone, ahead of everything, and never behind a prefetch.
2. **`c+1`, then `c-1`, then `c+2`, `c+3`, `c+4`** — signs swapped when the reviewer is
   travelling backwards.
3. **Head and tail**, once per question, then held.
4. Nothing else.

**Direction changes priority.** The scheduler keeps the sign of the last page movement; a
typed jump or a new question resets it to forward. One comparison, and it is what makes
working backwards through committed pages feel the same as working forwards.

### In flight, and what a jump does

**At most one prefetch request at a time**, carrying up to the cap in one page set. Two
reasons, both from what is there: the store serialises the visible query behind a single
token and shows one loading state, and under the recommended endpoint each request pays a
pass over the matching set — so one request carrying twelve pages is strictly better than
twelve requests. Batching is the point of the page-set contract.

**A prefetch in flight when the reviewer jumps is allowed to land.** Not cancelled.
Cancelling the HTTP request does not un-run the query Postgres has already started, so it
saves the client some bytes and the server nothing; the rows are valid for the same
question, so keeping them costs nothing and may be exactly where the reviewer goes next.
What must happen on a jump is that the *next* prefetch is recomputed from the new position
and the in-flight one is never waited on.

**A prefetch never takes the sequencing token.** It does not go through `refresh()` at all;
it writes to the cache and nowhere else. This is the invariant that protects R3, and it is
stronger than giving prefetches a token would be.

### Yielding

**A prefetch is scheduled only after the visible page has settled** — after `state.loading`
goes false and the render that follows it has run — **plus an idle delay of 250 ms.** Prefer
`requestIdleCallback` where the browser has it, with the timer as the fallback; both are
platform, so no dependency is added. The reason is the grid: a full re-render from state
happens on every notify, `computeLayout` returns early while loading, and a response landing
mid-layout would notify again and re-render on top of the layout pass the reviewer is
waiting for.

## The cache

Pure rules in a new `src/model/cache.js`; the store owns the instance.

### Shape

**Two indexes over one store**, because the two consumers are different:

- `pages: Map<pageNumber, observationId[]>` — what a page holds, in order.
- `rows:  Map<observationId, row>` — the rows themselves.

A page holds ids; the rows are shared. That is what lets a **pinned page be served from the
cache without a request** (R11) — `refresh()` takes the pinned branch and asks for
`state.pageMembers.get(page)` by id, and if every id is in `rows` there is nothing to fetch
— and what stops evicting a page from evicting a row another page still needs.

**A pinned page and a cached page are not the same thing, and are disjoint.** A pinned page
is a promise about *membership*: these exact ids were on screen and were committed, and
`refresh()` serves it by id, never from `pages`. A cached page is an answer to *the question*
at page N. The row index is where they meet.

### The budget, and its units

**3,000 rows.** Not pages, and not bytes:

- **Pages are the wrong unit** because `pageSize` follows the viewport (`setPageSize` in
  `store.js`). Twelve pages is 300 rows on a phone and 1,200 on a wide desktop, so a page
  budget means a different footprint on every machine.
- **Bytes are the honest unit and are not measurable.** There is no portable way to size a
  JavaScript object graph; `performance.memory` is Chrome-only and non-standard. A byte
  budget would be an estimate wearing the clothes of a measurement.
- **Rows are countable exactly**, are what the cache holds, and are proportional to bytes for
  a row shape that is fixed.

3,000 rows is about 3.3 MB of row objects — `fixtures/observations.json` is 3,364,130 bytes
for 3,000 rows, so roughly 1.1 KB each — and about 66 pages at 45 per page, six times the
495-row hold set. The reviewer can roam a long way before anything is evicted, which is the
point.

**Say the second limit out loud rather than pretending the first covers it:** the rows carry
thumbnail *URLs*, and the decoded images are the browser's memory and are far larger than
the rows. The client cannot bound them and must not claim to.

### Eviction

**Distance from the current page, with least-recently-used as the tie-break.** Not LRU
first, and the reason is worth having rather than assuming:

- LRU's premise is that recency predicts reuse. Here the reviewer's movement is dominated by
  ±1 around the current page, so **position predicts reuse far better than recency does**: a
  page visited thirty seconds ago and 400 pages away will not be visited again, while a page
  never visited and one step ahead certainly will.
- The "at page 50 of 500, pages 20 and 30 are probably worthless" instinct is right about
  *uncommitted* pages and wrong about committed ones. #68 says a mistaken commit is
  corrected by going back to it, and `state.committedPages` is how the reviewer finds it. So
  the rule is: **evict by distance, but never evict a row a pinned page needs.** That
  exemption is the concrete form of the pinned/cached relationship above.
- LRU as the tie-break, so two pages equidistant from the current one evict in a defensible
  order rather than an arbitrary one.

**Never evicted, at any distance:** the current page, the head (1, 2), the tail (P, P−1), and
any row named in `state.pageMembers`.

### The key

**The address `model/query-url.js` produces, with `page` stripped and `pageSize` appended.**
#79 already made the question serialisable, round-trippable and canonical — a bare address
means the default question and any other address is read literally — and that is a
ready-made key. Adjustments, each necessary and each read from the code:

- **`page=N` comes out.** It is the address, not the question; left in, every page would be
  its own cache.
- **`pageSize` goes in.** `toQuery` never writes it, deliberately, and it changes what page 2
  *is*. A window resize therefore changes the key and empties the cache, which is correct
  and worth stating so nobody treats it as a bug.
- **`mode` stays.** It is already in the address, the modes filter differently
  (`statusDimensions`), and `setMode` resets to page 1.
- **`excludeIds` stays out**, per A4.

### What changes it

- **A commit does not invalidate anything.** Within a session the reviewer sees the data as
  they last submitted it, and paging forward never discards what is behind. #99 settled this,
  and it is why A4 matters.
- **A filter, the sort, the mode or the page size empties the cache entirely.** Not lazily —
  emptied. `resetForNewQuery()` and `reorder()` already clear pins, committed pages and every
  mode's parked work for exactly this reason, and a cache outliving them would be the one
  thing left holding rows from a question nobody is asking. **The cache holds one question at
  a time.**
- **A reload has nothing to restore.** It is in memory, and #68 is explicit that the transient
  half is not persisted.

## How the fixture gets deep enough

3,000 rows is 60 pages at 50 per page. Eviction never happens there, the last page is four
clicks away, and a prefetcher that looks instant against it has proved nothing.

**Recommend: `src/data.js` gains a scale, and the fixture file does not grow.**

- **Growing the file is not available.** 3,000 rows is 3,364,130 bytes, so 440,000 rows is
  roughly 490 MB. Unshippable in git, and the `fetch` plus `JSON.parse` of it would dwarf the
  140 ms `LATENCY.query` the app deliberately simulates — distorting precisely the
  measurement this task exists to make. A middle option, ~30,000 rows at 33 MB, is still too
  large to commit and still only 660 pages.
- **A scale factor distorts less.** What is being measured is whether the right pages are
  held, whether eviction bites, and whether a page change avoids a spinner. Those depend on
  page count, addressability, latency and row count — not on the scientific content of the
  rows. The fixture stays the *content*; the scale supplies the *depth*.

Four requirements on it, each of which is a way it could quietly cheat:

1. **Served rows must be distinct objects.** If the synthesiser hands back shared references,
   a cache holding 3,000 rows costs nothing and eviction proves nothing. Only pages actually
   served need materialising, which is exactly the right amount of work.
2. **The order must be total and deterministic**, with the `observation_id` tie-break, over
   the whole virtual set. R2 does not get an exemption for being synthetic.
3. **The synthesis cost must not land inside the measured latency.** Build the ordered index
   once per question, memoise it, and let the artificial `LATENCY.query` delay be what the
   tests measure against. Sorting 440,000 entries on every query would make the fixture
   slower than the API it stands in for.
4. **Mutations must survive.** `commitPage` and `setSpecies` write to rows; against a virtual
   set they write to an overlay keyed by virtual id, so 440,000 rows are never materialised
   and a committed page still reads back as committed.

Default scale 1, so every existing test sees exactly the fixture it sees today. The deep
tests set it explicitly.

## Plan

Three pieces with disjoint files. A and B are parallel; C lands last because it is the only
file both of them need. **None of them touches MARP_API's schema, routes, controllers or
repository** — the endpoint and the migrations are later work, built to this spec.

- **Piece A — depth.** Owns `src/data.js` and `tests/unit/data-scale.test.mjs`. Delivers the
  scale, and `MarpData.queryPages()` in the shape of the contract above, alongside the
  existing `query()`, which stays and keeps working. Nothing else.
- **Piece B — rules.** Owns `src/model/schedule.js`, `src/model/cache.js`,
  `tests/unit/schedule.test.mjs` and `tests/unit/cache.test.mjs`. Pure: hold set, fetch
  order, direction, budget, eviction, key. No DOM, no network, no `state` — the layering rule
  the app's `CLAUDE.md` sets out.
- **Piece C — wiring.** Owns `src/store.js` and `tests/e2e/render.spec.mjs`. Small: a cache
  instance, a cache check at the top of `refresh()` that short-circuits `state.loading`, and
  a `_schedulePrefetch()` called where `_chaseQueuedThumbnails()` is called today.

The interfaces, named so A and B can be written against them before C exists:

- **A ↔ B: none.** They never call each other. That is the point of the split.
- **A ↔ C:** `MarpData.queryPages({ filters, sort, pageSize, pages, exclude, includeTotal })`
  → `{ pages: [{ page, rows, rowCount }], total?, pageCount?, excludedForNoDate }` — the
  contract above, so C is written against the endpoint and A is one implementation of it.
- **B ↔ C:** `plan({ page, pageCount, direction, held, pinnedIds, budget })` →
  `{ hold, fetch, evict }`, and `keyFor({ mode, filters, sort, pageSize })` → `string`. Pure
  functions, no state, no I/O.

**Why C exists.** A two-way split leaves nobody owning `store.js`, and the store is where the
two halves meet: `refresh()` is the only place that decides whether to fetch or serve, it
holds `reqSeq`, and a cache hit has to short-circuit `state.loading` or the grid still
flashes a loading state and `computeLayout` still returns early — a cache that renders a
spinner has failed R1. If the split must be two, merge B into C; **do not merge A into C**,
since `data.js` and `store.js` are the two files most likely to be touched by other Phase 8
work.

## Acceptance criteria

- Paging next, previous, and back to a page already worked shows tiles immediately, with no
  loading state, against a fixture scaled to production depth and the fixture's own latency.
  Measured in `render.spec.mjs`, at both viewport widths.
- A jump to the last page of a ~9,780-page result is one request, and the page either side of
  it is then already held.
- Committing a page and paging on does not re-fetch anything behind, and going back to the
  committed page shows exactly what was submitted.
- Roaming far enough to exceed the budget evicts, and what is evicted is distant and
  unpinned. A pinned page never loses its rows.
- Changing a filter or the sort empties the cache, and the first page after it is a fetch.
- `npm run test:unit` and `npm run test:e2e` both pass, unchanged suites included.
- No new entry in `package.json`.

## Test plan

Filled in at G3, before anything is run. The tiers are already decided by the app's
`CLAUDE.md` and by #99, and the split is not negotiable:

- **`tests/unit/`** — every rule: hold set, fetch order, direction weighting, the budget,
  eviction order, the exemptions, the key, and what each invalidation does. Pure functions,
  milliseconds, driven through hundreds of states.
- **`tests/e2e/render.spec.mjs`** — that the reviewer does not wait. A rendering claim no
  other tier can observe: a store-level check cannot see that a spinner was drawn. Assert the
  absence of the loading state and the presence of the tiles, and record real page-change
  times in `.marp/verification.md`. "Feels faster" is not a result.
- **`tests/requirements.js`** — the #68 headings this touches: *Moving through pages* and
  *Navigating pages*.

## Status

- **Gate:** design — **blocked at G1.** A1, A2, A3, A4 and A7 are open and unticked. Nothing
  under `src/` or `tests/` has been touched, and nothing in MARP_API outside this file.
- **Notes:** A1 was argued three times on widening footings — as the schema stands, with
  indexes assumed addable, and finally with the schema designable — and the answer did not
  move. The decisive argument is the last one: keyset optimises next and previous, which is
  exactly the movement the cache built here makes free, leaving jumps, first/last and
  speculative page sets on the network, which are the movements offset is best at. Designing
  the schema freely strengthens rather than weakens it, because the ordering itself can be
  persisted if measurement demands — offset semantics at keyset cost, with every page-number
  capability kept.
- **Found while reading and deliberately left alone**, all reported at G1: the stale
  `state.counts` assignment ahead of the token check in `store.refresh()`; that
  `store.refresh()` calls `counts()` on every refresh including a pinned one, which against a
  real API is a second pass over the matching set on every page turn; that
  `dataset_observations.observation_id` has **no foreign key** to `observations`, so #68's
  permanent delete would leave orphaned training-set membership rows behind; and that this
  repository's copy of the shared AGENTS.md block still says `Refs #NN` or `Closes #NN` where
  the umbrella now forbids `Closes` outright.
