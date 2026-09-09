# Verification — MarineAppliedResearch/MARP_API#105

Phase 4, the mosaic query and its counts. Written at G3, before the verification run, from
*Correctness verification, now* in `.marp/task.md`.

#103's verification is not gone: it was renamed to
`.marp/verification-103-review-state-schema.md` in the same commit as this file, for the
same reason its spec was renamed — this file has to be what a reader and the harness find
for the phase in flight, and #103's branch is unmerged so its evidence has to survive.
Phase 3's spec flagged that whoever wrote Phase 4's verification would face the choice; this
is that choice, made the same way.

**The tier that matters here is the HTTP tier against a real PostgreSQL**, and for two
reasons rather than one. The obvious one is that this phase is a SQL query and a route:
nothing about a semi-join, an anti-join or a `row_number()` band is observable from a unit
test. The less obvious one is that **every route requires a permission**, so a suite that
calls the API through `request(app)` gets 401 and nothing else — these go through
`tests/setup/authenticated-agent.js`, which leaves an authenticated agent holding every
catalog permission on `global.api`.

**Two requirements are deliberately verified against something other than rows**, because
no row count on this database can see them:

- **R9** — that `keyframe_count` is not computed over the whole matching set for a request
  that does not sort by it. With one observation, the aggregate and the lateral return the
  same answer at the same speed. So `buildPageSetQuery` is exported and the test asserts
  against the **emitted SQL**: no keyframe aggregate inside the `matched` CTE for the three
  sorts that do not name it, and one inside it for the sort that does.
- **R13** — the row's key set. A payload that grows by a column nothing renders is not a
  failure any assertion about *values* can catch, so the test snapshots the **exact key
  set** and fails on an addition as loudly as on a removal.

**Nothing here measures speed, and a green run does not mean this phase passes.** #68 is
blunt: *"a correct endpoint that takes two seconds fails this phase."* The database holds
**1 observation**. The timing checklist is carried forward as **owed**, in full, below.

## What each test proves

All tests are in `tests/mosaic-query.test.js` unless named otherwise. Tier `http+db` means
Supertest through the real Express app against the real development PostgreSQL; `sql` means
an assertion against the statement the builder emits.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R0 | *the routes* › are served under `/api/v2/` and nowhere else | http+db | Both paths answer under `/api/v2/`, and the declared `/api/mosaic/...` path is **not** registered — so the prefix came from `registerVersionedRoute` rather than being written by hand |
| R0, R12 | *the routes* › require `observations:read` rather than a new key | http+db | An agent with no permissions gets 403 from both routes; the permission catalog holds no key mentioning the mosaic or review |
| R1 | *the envelope* › returns an entry for every page asked for, ascending | http+db | Five discontiguous pages asked for out of order come back as five entries in ascending page order, with `pageSize`, `excludedForNoDate` and `servedAt` present |
| R1 | *the envelope* › carries `total` and `pageCount` only when `includeTotal` | http+db | Both keys present with `includeTotal: true`, both **absent** without it — absent, not null |
| R1, R5 | *the envelope* › carries `total` for a page set entirely past the end | http+db | The count survives a request whose every band is empty. This is the case a bare projection loses: the scheduler asks for the tail before it knows the count, and would then get no total to clamp against |
| R2 | *deterministic ordering* › puts tied rows in the same order on every call | http+db | Six seeded rows with **identical `confidence`** are paged at `pageSize` 2; the three pages hold the same ids in the same order across two identical calls, and the order is by `observation_id` |
| R2 | *deterministic ordering* › appends `observation_id` even when the client sorts on something else | http+db | Rows tied on `updatedAt` come back in `observation_id` order; a sort naming only `updatedAt` still gets the tie-break |
| R2 | *deterministic ordering* › appends `observation_id` when the client already sent it | sql | A client that names `observation_id` itself does not get it twice in the `ORDER BY` — the field is not in the closed sort list, so it is rejected, and the appended term is the only one |
| R3 | *one pass* › returns for `[1,3,5]` exactly what pages 1, 3 and 5 return singly | http+db | The discontiguous set is not a different question from three single-page questions. Membership, order and `rowCount` all compared |
| R4 | *one pass* › numbers a deep page from the same ordering as a shallow one | http+db | With 6 seeded rows at `pageSize` 1, page 6 holds what the sixth row of the full ordering holds. **This proves the addressing is offset-consistent, not that it is fast** — flatness in *cost* is measurement 2 in the deferred checklist and is not claimed here |
| R5 | *the cap* › rejects 13 pages with 400 | http+db | 13 pages → 400, and the body is the error envelope, not a truncated result |
| R5 | *the cap* › rejects more than 600 rows with 400 | http+db | 12 pages at `pageSize` 51 → 612 rows → 400. The row cap binds before the page cap on a wide viewport |
| R5 | *the cap* › rejects a page number that is not one | http+db | `0`, `-1` and `1.5` each → 400 |
| R5 | *the cap* › returns an empty page rather than an error past the end | http+db | `rows: []`, `rowCount: 0`, HTTP 200 |
| R6, R7 | *the status filter* › selects exactly the right ids for each set | http+db | Three rows seeded — one `reviewed`, one `flagged`, one with **no projection row** — and every set asserted by id: `['unreviewed']`, `['flagged']`, `['reviewed']`, `['unreviewed','flagged']`, `['reviewed','flagged']`, all three, and `[]`. **The mixed set is the one that catches a `coalesce` regression**, so it is not optional |
| R6, R7 | *the status filter* › is a semi-join or an anti-join, never a `coalesce` | sql | The emitted SQL contains `NOT EXISTS` for a set including the absent value, `EXISTS` for one excluding it, no predicate at all for a set covering the domain, and **no `coalesce` anywhere** |
| R6 | *the status filter* › reads the projection and never the log | sql | `observation_review_current` appears; `observation_reviews` does not appear at all |
| R7 | *the status filter* › filters both dimensions independently | http+db | A row `flagged` for `scientific` and `promoted` for `training` is found by a question naming both, and excluded by a question naming either wrongly |
| R8 | *not filtering* › treats an empty status array as no filter, not as the mode's default | http+db | `reviewStatus: []` returns the `reviewed` row too — the row `['unreviewed','flagged']` would drop |
| R8 | *not filtering* › treats an empty or absent value as no filter on every dimension | sql | An empty array, a null range and an absent key each emit no `WHERE` term, for all ten dimensions |
| R9 | *the keyframe aggregate* › stays out of the matching set for every sort but its own | sql | For `confidence`, `updatedAt` and `obsID`, the `matched` CTE contains no `keyframes` aggregate; the lateral appears only after `FROM tally` |
| R9 | *the keyframe aggregate* › moves into the matching set for the track-length sort | sql | For `keyframe_count`, the CTE does carry the lateral — the cost the human accepted, asserted rather than assumed, so a later "optimisation" that silently drops the sort fails here |
| R9 | *the keyframe aggregate* › is served on every row | http+db | `keyframe_count` and `first_framenum` are the real numbers for a seeded observation with three keyframes |
| R10 | *the counts* › returns all six counts and a total in one pass | http+db | Six seeded rows with a known status distribution; all seven numbers asserted exactly |
| R10 | *the counts* › applies the non-status filters and ignores the status ones | http+db | The same call with `reviewStatus: ['flagged']` added returns **identical** numbers; narrowing a non-status filter changes them |
| R10 | *the counts* › needs no sort and no row numbering | sql | The emitted SQL contains no `row_number` and no `ORDER BY` |
| R11 | *the counts* › total is over a larger set than the page query's total | http+db | For one seeded set, the counts total strictly exceeds the page query's total when a status filter narrows, and both are asserted to their own correct values |
| A5 | *the outer joins* › returns an observation with a null `session_id` | http+db | Seeded with no session. It appears, with null `dive`, `line` and `session_type`. **This is the test that fails if somebody restores the inner join** |
| A5 | *the outer joins* › returns an observation with a null `project_id` | http+db | Seeded with a session but no project. It appears, with null `project_name` |
| A5 | *the outer joins* › excludes it only when the reviewer filters on that dimension | http+db | The same null-session row is absent from a `dive`-filtered question and present in an unfiltered one — so a null is not silently a match either |
| A4 | *the species filter* › matches `species_id` and not `comname` | http+db | Two rows sharing a `comname` and differing in `species_id`; filtering by id returns one. A `comname` value passed as `species` is rejected as not an integer rather than silently matching nothing |
| A3 | *the date dimension* › rejects an active date filter with 400 | http+db | `date: { from: '2026-08-01' }` → 400, naming #76. `date: null` and `date: { from: null, to: null }` are **not** rejected, because the client sends every dimension on every query |
| A3 | *the time-of-day dimension* › is served from `tc` | http+db | A row at `21:57:22` is inside `21:00`–`22:00`, outside `01:00`–`02:00`, and inside the wrapped window `21:00`–`02:00`; a row with a day-rollover `tc` of `1.00:15:33` is inside `00:00`–`01:00`, because the day component says the dive rolled over rather than which hour it was |
| R13 | *the row shape* › is exactly the agreed key set | http+db | A snapshot of the 15 keys. `processor_name`, `lineId` and `scientific_name` asserted **absent** by name, so restoring one is a failing test rather than a silent payload — and A7 turns on `processor_name` staying out |
| R14 | *no duplicate rows* › returns one row for an observation with many keyframes | http+db | An observation with eight keyframes appears once, with `keyframe_count` 8. This is the Sequelize `hasMany`-plus-`limit` defect the raw query exists to avoid |
| R15 | `git status` after `npm run docs:build`, recorded in *Results* | review | The generated contract carries both new operations and is committed |
| R16 | This file, and *Deferred, and why* | review | Correctness is verified by Jest; timing is not verified in this phase, and this file says so rather than implying otherwise |

## Requirements with no test

- **R4 is only half tested.** The test proves the *addressing* is consistent at depth —
  page 6 holds the sixth row — which is what correctness means here. It does **not** prove
  the *cost* is flat, which is the actual requirement. Flatness is measurement 2 in the
  deferred checklist and one observation cannot observe it. Written down rather than
  implied, because a green suite plus a requirement id is exactly how a phase comes to be
  called verified when it is not.
- **R3 is likewise half tested.** That a discontiguous set returns the same rows as three
  single-page requests is asserted; that it costs one pass rather than three is a plan
  reading and a measurement, not a test.
- **R15 has no automated assertion.** The rebuilt contract is inspected in *Results*.

## Edge cases

Each traces to a defect or a decision, not to a hunch.

- **A status set covering the whole domain must emit no predicate.** Delete Mode's
  `trainingDisposition` arrives with all three values ticked (#89), so the common case of
  "no filter" arrives as a full set rather than an empty one. A builder that turned it into
  `EXISTS (… decision = ANY('{undecided,promoted,excluded}'))` would drop every row with no
  projection row, which is most of them.
- **A wrapped time window is `OR`, not `AND`.** 22:00 to 02:00 is one night. Written as
  `AND` it returns nothing at all, and it returns nothing *quietly*.
- **A `tc` carrying a day rollover.** `1.00:15:33` is quarter past midnight on the second
  day of a dive. The day component must be ignored, exactly as `timeOfDayMs` ignores it,
  or the same observation lands in two different hours depending on who asked.
- **`confidence` is nullable and the default sort is `confidence ASC`.** Nulls sort last,
  so unscored rows are on the last pages rather than the first. Asserted, because it is
  invisible until somebody pages to the end.
- **`includeTotal` on a page set entirely past the end.** Covered above; it is the case
  that made the count hang off a one-row tally rather than off the page projection.
- **An unknown sort field, and an unknown status value.** Both rejected with 400. The
  contract calls the sort list closed, and a client that mistypes `updated_at` would
  otherwise get the default question answered without being told which question it asked.

## Regression coverage

Nothing has broken in this code yet — it is new. Three tests are nevertheless written as
regression tests, against defects this repository has already paid for elsewhere:

- **the `coalesce` status filter** — the shape confirmed from the plans to lose the
  index-only scan. `*the status filter* › is a semi-join or an anti-join` fails if it
  returns;
- **`count(*) OVER ()`** — measured to buffer the whole matching set into a second
  tuplestore and spill. `*the envelope*` asserts the emitted SQL does not contain it;
- **the inner join to `sessions`** — #99's contract SQL had it, and it drops any
  observation with a null `session_id`. The two A5 tests fail if it comes back.

## Known gaps

- **No measurement, at all.** 1 observation. See *Deferred, and why*.
- **The two recommended sort indexes are not added.** `observations (confidence,
  observation_id)` and `observations (species_id, confidence, observation_id)` are what
  *Indexes this phase needs* recommends, and this phase adds **no migration** — the human's
  answer to A2 says so in those words. They are owed, and they belong with the measurement
  that justifies each: an index chosen against a real distribution beats one chosen now.
- **`excludedForNoDate` is always 0** and will stay 0 until #76. It is in the envelope
  because the envelope is #99's and the client reads it.
- **The client sends a species *name* and this endpoint takes an id**; it sends
  `excludeIds` as a `Set`, which does not survive `JSON.stringify`; and it reads
  `review_status`/`training_disposition` where this returns
  `review_decision`/`training_decision`. All three are the client-side rename #99 filed as
  Phase 8's. **So the endpoint is substitutable for `queryPages()` on the request and
  response envelope, and not yet on the field names inside a row.**
- **`work_mem` is not set by the endpoint.** A8 recommends `SET LOCAL work_mem` inside the
  request's own transaction and it is non-blocking; it is a number to tune against real
  data and it is measurement 8 below.

## Manual steps

None. Every test here runs under `npm test`.

## Walkthrough videos

None. This phase adds no user-visible surface — the mosaic still runs against its fixture
until Phase 8 points `data.js` at these routes. A video of an HTTP endpoint would narrate
without asserting, which is the failure mode the doctrine names.

## The timing check, still owed

**Carried forward verbatim from *The timing check, deferred* in `.marp/task.md`, and not
one item of it is claimed here.** The data load is expected 2026-09-10. Read-only, never
against production. `EXPLAIN (ANALYZE, BUFFERS)`, three runs, first discarded, with
`work_mem` and `shared_buffers` recorded beside every result — the synthetic run showed a
15% swing from `work_mem` alone, so a number without it is not a result.

1. The typical question, with the two recommended indexes in place.
2. **Flatness (R4)** — page 1 alone against the last page alone. They should cost the same.
3. The count, three ways, on the real query — this is what confirms or overturns A1.
4. Selectivity: the size of the matching set for three questions a reviewer would ask.
5. The status anti-join with the projection populated to a realistic mix. It is **empty**
   here, which makes every anti-join free and every plan in this phase optimistic.
6. `keyframe_count` — the lateral for a 600-row page set, and the sort over the full
   matching set. A2's whole answer depends on the gap between them.
7. Nulls: how many observations have a null `session_id`, `project_id`, `confidence` or
   `species_id`. A4 and A5 are both partly unanswerable without these four numbers.
8. `work_mem` at the server default and at 64 MB, to size A8's `SET LOCAL`.

The numbers that fail the phase or reopen a decision are listed in `.marp/task.md` and are
not restated here, so the two cannot come to disagree.

**A benchmark against one observation would report every one of those as passing.** That is
why none was run.

---

## Results

<!-- Appended after the run. Real output, including failures, verbatim. -->
