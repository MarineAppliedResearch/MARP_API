---
task: MarineAppliedResearch/MARP_API#105
repos: [marp-api]
status: design
needs: []
---

<!--
  Phase 4 of #68: the mosaic query and its counts. G0/G1 only — no route, no controller,
  no repository method, no migration. This document plus the report is the deliverable.

  This branch is `105-mosaic-query`, stacked on `103-review-state-schema` rather than on
  `develop`, because Phase 4 needs Phase 3's schema and Phase 3 is not merged.

  #103's spec was moved to `.marp/task-103-review-state-schema.md` so this file can be
  what `marp spec check` reads. It is not deleted: #103's branch is unmerged and its spec
  has to survive. `.marp/verification.md` is still #103's and was deliberately left alone
  — see *Findings left alone*.
-->

## Goal

`POST /api/v2/mosaic/observations/pages` and a counts endpoint beside it: filtered,
sorted, paged over ~440,000 observations, deterministic, and fast enough that the
reviewer never waits. #68 is blunt about where the work is — *"the real work is not the
route, it is the query plan"* — and #99 already wrote the contract the client is built
against. This phase settles the three things #99 could not, because #99 had no database
to measure against and #103's schema did not exist yet.

The endpoint is new, so there is no existing caller to keep compatible. The client,
however, is already shipped against #99's contract, and that *is* a constraint.

## The basis, and what each recommendation rests on

Three different bases are used below and each recommendation says which. Conflating them
is how #99's count decision came to be stated more confidently than its evidence
supported.

- **The live database.** Every schema claim under *What is already true* was read from
  `information_schema`, `pg_indexes`, `pg_constraint`, `pg_trigger` and `pg_proc` on the
  running development database, which is the baseline plus all of #103's migrations — not
  from `db/baseline/schema.sql`, which is the baseline only and is missing everything
  #103 added.
- **A plan shape.** `EXPLAIN` against the real tables, read for the *shape* of the plan:
  which join strategy, which index, whether an optimisation applies. The row counts in
  those plans are meaningless — there is **one observation** — and no timing from them is
  quoted anywhere.
- **A measurement of the query machinery.** `EXPLAIN (ANALYZE, BUFFERS)` over **440,102
  synthetic rows from `generate_series`**, shaped `(confidence float8, observation_id
  int)`, three runs each. This measures the sort, the window functions and the
  tuplestores at production cardinality. It writes nothing and touches no table.
  **What it proves:** the relative cost of the ways of obtaining the count, and the
  absolute cost of a full-set sort on this machine. **What it does not prove:** anything
  about filter selectivity, the joins, the review-state anti-join, or real I/O. Those
  wait for the data, and *The timing check, deferred* is the checklist for them.

**`EXPLAIN ANALYZE` against the one real observation is worthless as a measurement and is
not used as one.** Where a number appears below it is from the synthetic run and is
labelled.

## What is settled before this phase starts

Inherited, and not to be re-decided here.

### `POST`, with an explicit `pages: [...]` array — answered 2026-09-09

#68's *Phase 4* says `GET /api/v2/observations/mosaic`. #99 decided `POST`. **The human
settled it on 2026-09-09: #99 wins.** Two reasons, both facts rather than preferences:

- the client sends an exclusion set (`page.pinnedIds` in `store.refresh`) that reaches
  **thousands of observation ids** after a session of committing, and that does not fit in
  a URL under any common proxy limit;
- the scheduler's unit is a **discontiguous set of pages** in one call, not a page, so the
  request body carries a `pages` array.

**The general rule, recorded because it will come up again: #68 is the design record and
it is old in places. Where #68 and a later, more specific issue disagree, the later
decision wins — and the fix is to correct #68 rather than leave two sections
contradicting each other.**

**#68's *Phase 4* section still says `GET /api/v2/observations/mosaic` and needs
correcting.** The human is making that edit; this phase does not.

### From #103, and not re-derived

- **`observation_review_current`** answers current review state as a primary-key lookup on
  `(observation_id, purpose)`. Do not re-derive current state from `observation_reviews`.
- **Undecided is the absence of a row.** The projection's `CHECK` permits only
  `reviewed|flagged` for `scientific` and `promoted|excluded` for `training`; a withdrawal
  deletes the row. So each status dimension has a **three-valued domain, one of which is
  absence** — which is what shapes the status predicate below.
- **`observations.version`** exists and is maintained by a `BEFORE UPDATE` trigger.
- **`keyframes (observation_id)`, `observations (session_id)`, `observations
  (project_id)`** exist; #103 added them.

### From #99, and not re-decided

Offset addressing by page number, served by one materialising page-set query; the
discontiguous set; the 12-page / 600-row cap with a `400` rather than a silent truncation;
`rows: []` for a page past the end; `observation_id` appended as the final sort term by the
server, always. `includeTotal` means *"tell me the total"* and **never** *"run `count(*)
OVER ()`"* — #99 recorded that the count's source is not part of the contract, which is
what lets A1 below change it without touching the client.

## What is already true, checked against the live database

Read from the running database, not from the baseline file.

**`observations` now carries four indexes**, not the two #99 recorded:
`observations_pkey`, `observations_species_id_idx`, `observations_session_id_idx`,
`observations_project_id_idx`. The last two are #103's. `keyframes` carries
`keyframes_pkey` and **`keyframes_observation_id_idx`** — #99's highest-priority missing
index is already there.

**None of the four sort fields is indexed.** `SORT_FIELDS` declares `confidence`,
`keyframe_count`, `updatedAt` and `obsID`. `confidence` and `updatedAt` are unindexed
columns; `obsID` is a distinct unindexed column from `observation_id`; `keyframe_count` is
not a column at all.

**`observations.confidence` is nullable** (`double precision`), and the default sort is
`confidence ASC`. Postgres sorts nulls last in `ASC`, so the ordering stays total and
deterministic — but the first pages of the default question are the *lowest-confidence
scored* rows and every unscored row lands on the last pages. That is almost certainly
what is wanted; it is written down because it is invisible until somebody pages to the end.

**Both foreign keys the mosaic joins on are nullable.** `observations.session_id` and
`observations.project_id` are `is_nullable = YES`, and the single row on this database has
`project_id = null` with `session_id = 1`. #99's contract SQL uses an **inner** `JOIN
sessions` and reaches projects through `sessions.project_id`, so it would silently drop
any observation whose `session_id` is null. See A5.

**`observations` has no date or timestamp of observation.** The columns are `tc`, `etc`,
`timelog`, `mediaPosition`, `actualPosition`, `frame` — all `varchar(255)` — plus
`createdAt`/`updatedAt`, which are when the *row* was written. #99 proposed adding
`observed_at`; **#103 deliberately did not add it** (its D4, deferring #76). So the `date`
and `timeOfDay` dimensions arrive at this phase with no column behind them. See A3.

**`observations.ml_model_id` exists** (#103) and is unindexed; `ml_models` holds 0 rows.
`dimensions.js` still comments that the link does not exist — that comment is now stale,
and it is not this phase's to fix.

**The version trigger fires on any real change.**

```
CREATE TRIGGER observations_bump_version_trigger BEFORE UPDATE ON public.observations
  FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION observations_bump_version()
```

This is decisive for A2: **anything that writes a derived value onto `observations` bumps
`version`**, and `version` is #68's optimistic-concurrency token.

**`species.species` is the scientific name**; `species.comname` is the common one.
Both exist, and `species` holds 854 rows here.

**Row counts on this database:** 1 observation, 8 keyframes, 1 session, 1 project, 854
species, 0 `ml_models`, 0 `dataset_observations`, 0 `observation_reviews`, 0
`observation_review_current`, 5 users, 24 `SequelizeMeta` rows.

**The permission catalog holds 23 keys and none of them mentions review or the mosaic.**
For observations there are exactly two: `observations:read` and `observations:write`.
`users:read` is described as *"so a client can show who processed something"* and
`reports:read` as *"Separate from observations:read because it exposes who did how much
work."* That separation is deliberate and it bears on A7.

**`registerVersionedRoute` derives the V2 path from a V1 path and throws if given one that
already starts `/api/v2/`** (`routes/lib/register-versioned-route.js`). So the route is
declared as `path: '/api/mosaic/observations/pages'` and registers at
`/api/v2/mosaic/observations/pages`. Mechanical, but it is the kind of thing that costs an
hour if discovered while implementing.

**There is still no pagination anywhere in the API.** No `limit`, no `offset`, no
`findAndCountAll` in `repository/observation.repository.js`.

## Requirements

- **R0** — **Every route this phase creates is served under `/api/v2/`.** Stated by the
  human 2026-09-09. There is no V1 to opt into — `AGENTS.md` says "There are no V1 routes" —
  and the only supported way to get there is `registerVersionedRoute`, which also attaches
  the permission. So a route is declared *without* the prefix and mounted *with* it; a route
  hand-mounted beside the helper to dodge the throw would arrive without its
  `requirePermission` wrapper, which is the real risk here rather than the URL.

- **R1** — `POST /api/v2/mosaic/observations/pages` accepts #99's request body unchanged
  and returns #99's envelope unchanged: `pageSize`, `pages[]` with an entry for **every**
  page asked for in ascending order, `total` and `pageCount` only when `includeTotal`,
  `excludedForNoDate`, `servedAt`.
- **R2** — Every ordering the endpoint applies ends with `observation_id`, appended
  server-side, always, regardless of what the client sent. A page fetched twice against
  unchanged data holds the same ids in the same order.
- **R3** — A discontiguous page set costs one pass over the matching set, not one pass per
  page. Asking for pages `[1,2,3,47,48,9779,9780]` costs what asking for page 1 costs.
- **R4** — The cost of a request does not grow with the page number. Page 9,780 costs what
  page 1 costs.
- **R5** — A request exceeding 12 pages or 600 rows is rejected with `400`, never
  truncated. A page past the end returns `rows: []`, `rowCount: 0`, not an error.
- **R6** — Current review state is read from `observation_review_current` by its primary
  key or its `(purpose, decision, observation_id)` index. Nothing walks
  `observation_reviews`.
- **R7** — A status filter whose selected set includes the absent value (`unreviewed`,
  `undecided`) is expressed as an **anti-join over the complement**, and one that excludes
  it as a **semi-join**. Neither is written as `coalesce(decision, 'unreviewed') IN (…)`,
  which demotes the decision test to a post-join filter — confirmed from the plan.
- **R8** — An empty or absent filter value means **not filtering**, never the owning
  mode's default. Both status dimensions are sent on every query (#89) and both may be
  empty.
- **R9** — `keyframe_count` is never computed over the whole matching set for a request
  that does not sort by it.
- **R10** — The counts endpoint applies the **non-status** filters only and returns all
  six status counts plus a total, in one pass, with no sort and no `row_number`. This
  mirrors `data.js` `counts()`, which is deliberately not conditioned on either status
  dimension.
- **R11** — The counts `total` and the page query's `total` are **different numbers over
  different sets** and are never substituted for one another. Counts' total is over the
  non-status-filtered set; the page query's is over the status-filtered set.
- **R12** — No new permission key is seeded (#68, Phase 2). Both routes are registered
  through `registerVersionedRoute` behind an existing key.
- **R13** — The row shape is what the tile renders. Anything the endpoint returns that
  nothing renders is named and justified, not carried by inheritance.
- **R14** — `sequelize.query`, not the Sequelize query builder: a `hasMany` include
  combined with `limit` makes Sequelize emit a subquery and duplicate parent rows, which
  is why every joined query in `repository/observation.repository.js` is unpaginated.
- **R15** — `npm run docs:build` is re-run and the regenerated contract is committed, or
  the diff is a lie.
- **R16** — Correctness is verified by Jest against the real development PostgreSQL,
  through `tests/setup/authenticated-agent.js`. Timing is **not** verified in this phase
  and the spec says so rather than implying otherwise.

## Open assumptions

Eight blocking, and #105 asked for exactly that: *"anything you find that changes the
endpoint's shape, its permissions, or the schema joins them as blocking."* A1 and A2 are
the two #105 named; A3 to A7 are what the live schema turned up; A9 is the sibling of a
decision the human has just made.

- [x] **A1 · performance · blocking** — **Where does the count come from?** #99 chose
  `count(*) OVER ()` inside the materialising CTE, on the reasoning that the pass happens
  anyway so the count is free. **The reasoning is right and the implementation is wrong.**
  **Recommend: take the count from a `count(*)` over the same materialised matching set,
  and never from `count(*) OVER ()`.** Measured, three runs each, 440,102 synthetic rows:
  | Form | Execution time | Extra buffering |
  | --- | --- | --- |
  | sort + `row_number()`, no count | 263.7 / 268.2 / 268.7 ms | none |
  | \+ `count(*) OVER ()` — #99 as written | 347.5 / 349.9 / 350.7 ms | **14,613 kB to disk** |
  | \+ `(SELECT count(*) FROM matched)` | 292.2 / 293.8 / 304.1 ms | none |
  `count(*) OVER ()` has an empty window frame, so its `WindowAgg` cannot emit a row until
  it has read the last one: it buffers the **entire matching set** into a second
  tuplestore, which spills at this machine's `work_mem`. That is **+82 ms (+31%)** against
  **+30 ms (+11%)** for the same number taken as an ordinary aggregate over the CTE. The
  count is nearly free, as #99 said — but because the matching set is materialised once,
  not because the window function is cheap.
  **A second finding, which is what makes #99's underlying argument stronger than #99
  knew.** Postgres 15+ pushes a `rn <= N` predicate into a `row_number()` window as a
  `Run Condition` and stops scanning early. I confirmed from the plans that it appears for
  a **single** band (`rn BETWEEN 1 AND 45`) and disappears for an **OR of bands** — and
  also disappears when `count(*) OVER ()` is added. Since the scheduler always asks for a
  discontiguous set, the run condition is already unavailable, so the count costs nothing
  in *rows scanned*. It costs only the buffer, and the recommendation removes that.
  **The trade:** `(SELECT count(*) FROM matched)` requires the CTE to be genuinely
  materialised (`WITH … AS MATERIALIZED`, or referenced twice, which it is), so it cannot
  be inlined into the outer query. That is what this design wants anyway. **The honest
  caveat:** this is the query machinery at production cardinality, not the real query. The
  absolute numbers move with `work_mem` — at 64 MB the same three were 297 ms and 272 ms,
  with the gap narrowing from 31% to 9% — so the *ordering* of the three is the durable
  result and the magnitudes are not.
- [x] **A2 · database/schema · blocking** — **`keyframe_count`: aggregate, or a maintained
  denormalised value?** The question splits in two and they have different answers.
  **For display it needs nothing.** The `LEFT JOIN LATERAL` sits in the *outer* query, so
  it runs once per row actually returned — at most 600 per request under the cap — and
  `keyframes_observation_id_idx` already exists (#103). That is 600 index lookups, not an
  aggregate over the matching set, and R9 is satisfied by construction.
  **For the "Track length" sort it needs a maintained value.** `keyframe_count` is one of
  the four shipped `SORT_FIELDS`, and sorting by it means computing it for every row of
  the matching set *before* `row_number()` can be assigned. Measured: one hash aggregate
  producing 440,103 groups from 3,520,816 synthetic rows is **614 ms**, 28.7 MB of hash
  memory — pure CPU, with no table I/O or index descent in it, so the real figure is
  higher. On top of ~270 ms for the sort that is over #99's ~400 ms threshold and
  approaching #68's two-second failure line for one sort option.
  **Recommend: a maintained projection table `observation_keyframe_stats (observation_id
  PK, keyframe_count, first_framenum)`, kept by a trigger on `keyframes` — and
  deliberately NOT a column on `observations`.** The reason is specific and I confirmed it
  from `pg_trigger`: #103's `observations_bump_version_trigger` is `BEFORE UPDATE … WHEN
  (old.* IS DISTINCT FROM new.*)`, so **writing a derived count onto `observations` would
  bump `observations.version` every time a keyframe was inserted or deleted.** `version`
  is #68's optimistic-concurrency token, so drawing a bounding box would make every
  reviewer holding that page report a version conflict at commit (Phase 5). A separate
  table has the same maintenance cost, no interaction with `version`, and no HOT-update
  cost on the table the annotation GUI writes during a session.
  **What it costs, either way, said plainly.** It is a migration inside this phase — a
  trigger, a backfill over every keyframe, and an index `(keyframe_count,
  observation_id)`. **The value joins the data contract:** AGENTS.md is explicit that
  derived columns are part of what the scientific record promises, so once it exists,
  anything that stops maintaining it is data loss and not a stale cache. It needs a
  rebuild-and-compare test, the way #103's projection has one. And the trigger fires per
  keyframe row while the annotation GUI writes keyframes in bulk.
  **The cheaper answer, if it is acceptable: drop "Track length" from the server-side sort
  list for this phase** and add the table when somebody actually sorts by it. That is a
  visible product change — a control disappears from the rail — which is why it is the
  human's call and not mine.
- [x] **A3 · API contract · blocking** — **Does this phase serve the `date` and
  `timeOfDay` dimensions, and how?** There is no date column on `observations`: #99
  proposed `observed_at`, #103 deliberately left it alone. Both dimensions resolve to
  `observations.tc`, a `varchar(255)` that holds **two different formats** —
  `[d.]HH:MM:SS[.fffffff]` .NET `TimeSpan` text, or a string beginning `YYYY-MM-DD` where
  the clock was synced (`carriesDate`/`timeOfDayMs` in `model/match.js`). Serving them
  means parsing that varchar in SQL for every candidate row, which no btree can help
  with, and it also means producing `excludedForNoDate` as a second aggregate. Three
  answers, and they are materially different pieces of work:
  **(a) Serve them from `tc` with expression indexes** — `((substring(tc,1,10)))` for
  date, partial on `tc ~ '^\d{4}-\d{2}-\d{2}'`, and an `IMMUTABLE` function plus an
  expression index for time of day. Cheapest to ship, no migration touching data, but it
  puts the `TimeSpan` grammar into SQL in a second place — and `AGENTS.md` says **use
  `db/timecode.js`, never re-implement the arithmetic.** A SQL parser is by definition a
  re-implementation, and its two known traps (millisecond truncation; a leading sign in
  front of everything) would have to be reproduced exactly.
  **(b) Add `observed_at timestamptz` here**, backfilled where derivable with
  `db/timecode.js`, `tc` untouched. This is what #99 designed and #103 declined. It makes
  both dimensions indexable and removes the parsing, and it is a migration over 440,102
  rows in a phase that #105 scoped to one possible migration.
  **(c) Do not serve them.** The endpoint rejects those two filters and the rail disables
  the controls. Honest, shippable, and a visible loss of a shipped feature.
  **Recommend (c) for this phase, with (b) as its own piece of work.** The reason is not
  laziness: (a) duplicates the timecode grammar, which this repository has an explicit
  rule against, and (b) is a data migration over the scientific record that deserves its
  own gate rather than riding along inside a query phase. But this removes two of the ten
  rail dimensions from the first real endpoint, which is a product decision and squarely
  the human's.
- [x] **A4 · scientific or data-meaning · blocking** — **Does the species filter match
  `comname` or `species_id`?** They disagree, and the disagreement is large. The client
  declares `{ key: 'species', field: 'comname', source: 'observations.comname' }`
  (`model/dimensions.js`) and `DEFAULT_FILTERS.species` is `['Bat Star']` — a name.
  #99's own request contract says `"species": [41] // observations.species_id`. Both
  cannot be right, and they return **different sets**: `species_id` is nullable and #99
  records that ~4% of observations do not resolve, while ~50,000 disagree with what their
  list says today because lists were renamed and renumbered under recorded data.
  **Recommend the endpoint accept `species_id` and only `species_id`**, because it is
  indexed, it is unambiguous, and #99's contract already says so — with the consequence
  stated rather than buried: **a reviewer filtering by species would then not see the ~4%
  of rows whose `comname` matches but whose `species_id` is null.** Whether those rows
  should appear is a question about what the record means, and AGENTS.md says to ask it
  rather than infer it. #99 filed the name-versus-id difference as "Phase 8's rename";
  it is not only a rename, and that is why it is here.
- [x] **A5 · database/schema · blocking** — **Which join reaches `projects`, and are the
  joins inner or outer?** `observations.session_id` and `observations.project_id` are both
  nullable, and the one row on this database has `project_id = null` with `session_id =
  1`, so the two paths demonstrably disagree even here. `dimensions.js` says the project
  dimension is `projects.name via observations.project_id`; #99's contract SQL reaches
  projects through `sessions.project_id` and joins `sessions` **inner**.
  **Recommend: `LEFT JOIN sessions` and `LEFT JOIN projects` via `observations.project_id`,
  matching the client's declaration** — so an observation with no session or no project is
  still reviewable, appears with null `dive`/`line`/`type`, and is excluded only when the
  reviewer actually filters on one of those dimensions. An inner join would silently
  remove rows from the mosaic, and a reviewer cannot tell the difference between "there
  are none" and "they were dropped by a join". **The trade:** left joins remove the
  planner's freedom to drive from `sessions` when a `dive` predicate is very selective,
  which may cost on the dive-filtered question. The mitigation is to promote the join to
  inner *only* when a predicate on that table is present, which is one branch in the
  builder and not a second query. **What is genuinely unknown and needs the human:** how
  many production observations have a null `session_id` or `project_id`. If it is zero the
  question is academic; nothing here can tell.
- [x] **A6 · API contract · blocking** — **Does the row carry the four fields nothing
  renders?** #68's Phase 4 says *"exactly the row shape the tile renders and nothing
  more."* Checked against `src/ui/tile.js`, the tile reads `observation_id`, `comname`,
  `confidence`, `dive`, `line`, `tc`, `keyframe_count`, `thumbnail_status`, `thumb`,
  `review_status`, `training_disposition`, `flag_reason`, `exclusion_reason`,
  `reviewed_by` and `previous_comname`. #99's response contract additionally lists
  `project_name`, `session_type`, `lineId`, `processor_name`, `scientific_name` and
  `first_framenum`. **Recommend: drop `processor_name` and `lineId`; keep `first_framenum`;
  ask about `scientific_name` and `project_name`.** `processor_name` is the one that
  matters — nothing renders it, and it is exactly the "who did how much work" the
  permission catalog separates from `observations:read` (see A7), so carrying it makes the
  endpoint leak a category of data the catalog deliberately gates. `first_framenum` is
  free from the same lateral and Phase 6 needs it to address a thumbnail.
  `scientific_name` is unresolved in #68 itself — *"whether a tile shows the common name,
  the scientific name, or both"* is one of its open questions — so returning it is
  speculative either way. At 600 rows per request the payload is a real consideration, not
  a tidiness one.
- [x] **A7 · security/permissions · blocking** — **Which existing permission key gates
  these two routes?** `requirePermission` takes exactly one key and #68 forbids seeding
  new ones. `observations:read` is the obvious answer and the one I would pick — but the
  catalog's own descriptions make it not quite clean: the mosaic row joins `sessions`
  (`sessions:read`), `species` (`species:read`) and, if A6 keeps it, `users.name`, where
  `users:read` exists precisely *"so a client can show who processed something"* and
  `reports:read` is *"Separate from observations:read because it exposes who did how much
  work."* **Recommend `observations:read` for both routes, on the condition that A6 drops
  `processor_name`** — with that field gone, the endpoint exposes nothing the catalog
  gates elsewhere, and joined session and species labels are the same data
  `observations:read` already returns through the existing observation routes. If the
  human wants `processor_name`, the route needs a second check rather than a wider single
  key, and that is a different design.
- [ ] **A8 · environment · non-blocking** — `work_mem` on this database is **4 MB**, and
  it is the single setting that most changes this endpoint's cost: raising it to 64 MB took
  the sort from an external merge spilling 11.2 MB to an in-memory quicksort, and the
  measured query from 349 ms to 297 ms. **Recommend the endpoint issue `SET LOCAL work_mem`
  inside its own transaction** rather than relying on the server default, so one endpoint's
  appetite is not a global change. Non-blocking because it is a number to tune against real
  data, not a change of shape — but it belongs in the deferred checklist and it is there.
- [x] **A9 · API contract · blocking** — **Is the counts endpoint `GET` or `POST`?** The
  human settled the page-set call as `POST` on the exclusion-set argument, and **that
  argument does not apply here**: `data.js` `counts()` takes the non-status filters only
  and no exclusion set, so its question does fit a URL. #68 says `GET
  /api/v2/observations/mosaic/counts`. **Recommend `POST
  /api/v2/mosaic/observations/counts`, taking the same `filters` object minus `pages`,
  `exclude` and `includeTotal`** — one request shape, one serialiser, one validator, and
  the ten multi-select dimensions are awkward and easy to get subtly wrong in a query
  string. **The trade, and it is real:** a `GET` counts call would be HTTP-cacheable and
  semantically a read, and #68 asked for `GET`. This is the same #68-versus-later
  disagreement as the verb question, and the same rule applies — but the human's decision
  was about the *page-set* endpoint, so I am not extending it to this one by inference.

## Answered, 2026-09-09

- **A1 — take the count from `(SELECT count(*) FROM matched)`, never `count(*) OVER ()`.**
  Not put to the human: it is a measurement, not a judgement. `count(*) OVER ()` has an
  empty window frame, so its `WindowAgg` buffers the entire matching set into a second
  tuplestore and spills — 348 ms and 14,613 kB to disk, against 293 ms and no extra
  buffering for the identical number as an ordinary aggregate over the same materialised
  CTE. #99's *reasoning* stands and is confirmed: the count is nearly free because the set
  is materialised once. Its *implementation* does not.
  Carried forward as a caveat rather than a settled magnitude: at `work_mem` 64 MB the gap
  narrows from 31% to 9%, so **the ordering of the three forms is the durable result and
  the absolute numbers are not.** The deferred checklist repeats it against real data.
- **A2 — keep the "Track length" sort, serve it with the aggregate, and build no
  maintained table.** Settled by the human: *"i think it's okay if it takes 614 ms to sort
  440000 rows of keyframes by length."*
  So neither option as offered. **No `observation_keyframe_stats`, no trigger on
  `keyframes`, no backfill, and no new derived value joining the data contract** — this
  phase adds no migration at all. The cost is accepted with open eyes: sorting by track
  length computes a hash aggregate over the matching set, measured at 614 ms for 440,103
  groups from 3,520,816 rows, on top of ~270 ms for the sort. That is past #99's ~400 ms
  guidance and well inside #68's two-second failure line, **and it is one sort option of
  four** — the other three are unaffected.
  Two things make it more defensible than the raw number suggests, and both should be
  said rather than assumed: **#99's prefetcher means a reviewer pays it once per question,
  not once per page change** — the page set arrives in one request and paging within it is
  a cache hit; and the display of `keyframe_count` still costs nothing, because the
  `LEFT JOIN LATERAL` sits in the outer query and runs at most 600 times per request
  against an index that already exists.
  **The trap that made a column on `observations` the wrong answer is recorded even though
  it is now moot**, because somebody will propose it again: #103's
  `observations_bump_version_trigger` is `BEFORE UPDATE … WHEN (old.* IS DISTINCT FROM
  new.*)`, so writing a derived count onto `observations` would bump `version` on every
  keyframe insert or delete — and drawing a bounding box would then make every reviewer
  holding that page hit a version conflict at commit. If this decision is ever revisited,
  it must be a separate table, never a column.
- **A6 — drop `processor_name` and `lineId`; keep `first_framenum`; leave
  `scientific_name` out for now.** Not put to the human beyond the part that was.
  `src/ui/tile.js` renders none of the four. `processor_name` and `lineId` go because an
  endpoint should not return what nothing draws, and `processor_name` in particular is the
  category the permission catalog gates separately — see A7. `first_framenum` stays: it is
  free from the same lateral that already produces `keyframe_count`, and Phase 6 needs it.
  `scientific_name` is left out because whether the mosaic shows scientific names is still
  an open question in #68, and adding a field later is additive while removing one is not.
- **A7 — `observations:read` on both routes.** Follows A6 and needs no separate decision.
  Only `observations:read` and `observations:write` exist for observations, Phase 2 settled
  that no new permission keys are seeded, and the catalog's own note — that `reports:read`
  is *"Separate from `observations:read` because it exposes who did how much work"* — is
  satisfied precisely because A6 drops `processor_name`. **The two are one decision:** if
  `processor_name` is ever put back into the row, this route stops being an
  `observations:read` route.
- **A9 — `POST` for the counts endpoint too.** One request shape for both routes rather
  than two, and the filters a count is asked for are the same filters the page query
  carries. The exclusion set is the reason the page endpoint had to be `POST` and a count
  does not carry one — which is why the agent correctly declined to extend the decision by
  inference — but consistency is worth more here than a `GET` that would be cacheable in
  theory and never cached in practice, since the rail re-asks on every filter change.


- **A3 — serve `timeOfDay`; defer `date` to #76.** The question split once the real columns
  were read, and the split is the answer. `observations.tc` holds the **actual clock time**
  — the one row here reads `21:57:22`, with `mediaPosition` `00:02:18.28` as the elapsed
  media time beside it — so **time of day is servable today**, from a column that already
  exists, with no parsing of a date that is not there. **Nothing anywhere holds the date an
  observation was made:** not `observations`, and not `sessions`, whose only timestamps are
  `createdAt`/`updatedAt` — when the *row* was written, which is not when the dive happened
  and would be wrong to substitute. So the date filter is not "limited" pending #76, it is
  unanswerable, and the endpoint rejecting it is more honest than a control that excludes
  everything. Neither (a) nor (b) from the recommendation: no timecode grammar goes into
  SQL, and no data migration rides inside a query phase.
- **A4 — `species_id`.** The human settled it: *"every observation whose current species
  record resolves to Bat Star."*
  **And he corrected the reasoning, which was wrong in this spec and in the framing put to
  him.** `comname` is not free text an annotator typed — **the annotator presses a species
  button and the list entry's name is recorded.** So the drift between `comname` and
  `species_id` is not data-entry noise; it is **lists renamed and renumbered underneath
  records that were correct when they were made** (`migrations/20260901120500-add-observations-species-id.js`,
  Refs #52, which measured it against production: roughly 50,000 disagreeing, about 4% not
  resolving at all, 1,114 rows with no `taxserial`). That makes `species_id` right for a
  better reason than being the indexed key: **it finds the organism**, where `comname` finds
  rows whose label text matches a name that may since have moved.
  `comname` is still never dropped — it is the only record of what the entry was called at
  the time, and that is what makes the drift auditable.
- **A5 — `LEFT JOIN` on both, reached via `observations.project_id`.** Not put to the human:
  there is no judgement in it. Both `session_id` and `project_id` are nullable, the single
  row on this database has `project_id = null`, and an inner join would drop it — and a
  reviewer cannot tell a dropped row from a row that does not exist. Silent omission is the
  failure mode this whole application is built to avoid.

## Decisions

- **2026-09-09** — **`POST` with an explicit `pages[]` array**, answered by the human.
  #99 beats #68 because it is later and more specific, and because the exclusion set does
  not fit a URL. #68's *Phase 4* section needs correcting and the human is doing it.
- **2026-09-09** — **Where #68 and a later, more specific issue disagree, the later
  decision wins, and #68 gets corrected.** Recorded as a general rule, not as a one-off.
- **2026-09-09** — The count's *source* is not part of the published contract, only its
  availability. That is #99's decision and it is what lets A1 change the SQL without the
  client noticing.
- **2026-09-09** — **A status dimension has a three-valued domain, one value of which is
  the absence of a projection row.** So a selected set is served as a semi-join when it
  excludes the absent value and as an anti-join over the complement when it includes it.
  Confirmed from the plans: both forms use
  `observation_review_current_purpose_decision_idx` as an index-only scan, while the
  `coalesce` form demotes the decision test to a post-join filter.
  The default question — `['unreviewed','flagged']` — is therefore `NOT EXISTS (… AND
  decision = 'reviewed')`, and a set covering every value is no predicate at all, which is
  what Delete Mode's `trainingDisposition` default produces.
- **2026-09-09** — **The counts pass and the page pass cover different sets** and both
  return something called `total`. Counts is not conditioned on either status dimension —
  deliberately, per `data.js` — so #68's *"must not cost a second full scan"* cannot be
  satisfied literally: it is a second pass over a **larger** set. It is a cheap one,
  because it needs no sort and no `row_number`, which is the whole of what made the page
  query expensive in the measurement.
- **2026-09-09** — **The lateral for `keyframe_count` belongs in the outer query, not the
  CTE**, so it runs per returned row rather than per matching row. That is what keeps R9
  true for every sort except "Track length".

## The query contract, and what changes from #99

**#99's request and response envelope stand unchanged.** `frontend/apps/marp-mosaic-review/.marp/task.md`
*The query contract* is the source and it is not restated here — restating it is how two
copies come to disagree. `src/data.js` `queryPages()` is its working implementation and
the endpoint must be substitutable for it.

Three changes, each traceable to an assumption above:

1. **The count is an aggregate over the materialised CTE, not `count(*) OVER ()`** (A1).
   Invisible to the client.
2. **The row shape loses `processor_name` and `lineId`** (A6). Visible, and the client
   does not read either today.
3. **`date` and `timeOfDay` are rejected rather than served** (A3), and
   `excludedForNoDate` is therefore always `0` in this phase. Visible, and it needs the
   rail told.

### The shape, with the pieces this phase settles

The skeleton is #99's. What is written out here is only what changed.

```sql
WITH matched AS MATERIALIZED (
  SELECT o.observation_id,
         row_number() OVER (ORDER BY o.confidence ASC, o.observation_id ASC) AS rn
    FROM observations o
    LEFT JOIN sessions s ON s.session_id = o.session_id        -- A5: nullable FK
    LEFT JOIN projects p ON p.project_id = o.project_id        -- A5: via observations
   WHERE o.species_id = ANY ($1)                              -- A4: id, not comname
     AND NOT EXISTS (SELECT 1 FROM observation_review_current rc  -- R7: the complement
                      WHERE rc.observation_id = o.observation_id
                        AND rc.purpose = 'scientific'
                        AND rc.decision = ANY ($2))
)
SELECT m.rn,
       (SELECT count(*) FROM matched) AS total,                -- A1: not count(*) OVER ()
       o.observation_id, o."obsID", o.confidence, o.comname, o.tc,
       s.dive, s.line, s.type AS session_type, p.name AS project_name,
       rc.decision AS review_decision, rc.reason AS flag_reason,
       rt.decision AS training_decision, rt.reason AS exclusion_reason,
       k.keyframe_count, k.first_framenum
  FROM matched m
  JOIN observations o ON o.observation_id = m.observation_id
  LEFT JOIN sessions s ON s.session_id = o.session_id
  LEFT JOIN projects p ON p.project_id = o.project_id
  LEFT JOIN observation_review_current rc
         ON rc.observation_id = o.observation_id AND rc.purpose = 'scientific'
  LEFT JOIN observation_review_current rt
         ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
  LEFT JOIN LATERAL (                                          -- A2: outer, so ≤600 times
        SELECT count(*)::int AS keyframe_count, min(framenum) AS first_framenum
          FROM keyframes WHERE observation_id = o.observation_id) k ON true
 WHERE m.rn BETWEEN $3 AND $4 OR m.rn BETWEEN $5 AND $6        -- one band per page
 ORDER BY m.rn;
```

`AS MATERIALIZED` is not decoration: `(SELECT count(*) FROM matched)` needs the CTE to be
a real tuplestore rather than inlined, and that is also what makes R3 and R4 true.

**When the sort names `keyframe_count`**, the lateral has to move inside `matched` and run
over the whole matching set — which is the case A2 exists to answer, and the case a
maintained `observation_keyframe_stats` turns back into a plain join.

### The counts endpoint

One pass, six counts, no sort and no window function. Confirmed from the plan as a single
`Aggregate` over the joins, with both projection joins served by index-only scans on
`observation_review_current_purpose_decision_idx`.

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE rc.decision IS NULL)      AS unreviewed,
       count(*) FILTER (WHERE rc.decision = 'reviewed') AS reviewed,
       count(*) FILTER (WHERE rc.decision = 'flagged')  AS flagged,
       count(*) FILTER (WHERE rt.decision IS NULL)      AS undecided,
       count(*) FILTER (WHERE rt.decision = 'promoted') AS promoted,
       count(*) FILTER (WHERE rt.decision = 'excluded') AS excluded
  FROM observations o
  LEFT JOIN sessions s ON s.session_id = o.session_id
  LEFT JOIN observation_review_current rc
         ON rc.observation_id = o.observation_id AND rc.purpose = 'scientific'
  LEFT JOIN observation_review_current rt
         ON rt.observation_id = o.observation_id AND rt.purpose = 'training'
 WHERE <the non-status filters only>;
```

`IS NULL` rather than a `coalesce` is the point: it is what an outer join already knows.

## Indexes this phase needs

#103 shipped the three foreign-key indexes, so what is left is the sorts. **Each is
justified by the sort it serves, and `observation_id` is the last column because the
tie-break is part of the ordering rather than something appended.**

| Index | Serves | Recommend |
| --- | --- | --- |
| `observations (confidence, observation_id)` | `DEFAULT_SORT` — the sort of the default question | **Add.** Nulls sort last in `ASC`, which a btree scan gives natively |
| `observations (species_id, confidence, observation_id)` | the commonest question: one species, ordered by confidence | **Add.** The one filter-plus-sort composite that clearly earns its place |
| `observations ("obsID", observation_id)` | the "Observation number" sort | **Defer.** Add when somebody uses it; it is cheap but unjustified today |
| `observations ("updatedAt", observation_id)` | the "Last updated" sort | **Defer, and say why.** `updatedAt` changes on every write, so this index **defeats HOT updates on every write to `observations`** — the table the annotation GUI writes throughout a session. #99 flagged it and #103 repeated the warning. Add it by measured use, never for symmetry |
| `observations (ml_model_id) WHERE ml_model_id IS NOT NULL` | the Model dimension | **Defer.** `ml_models` holds 0 rows; a partial index chosen against a real distribution beats a full btree chosen now, which is #103's reasoning and it still holds |
| `observation_keyframe_stats (keyframe_count, observation_id)` | the "Track length" sort | **Only if A2 is answered that way** |

**`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block**, and every migration
in this repository opens one. #103 wrote the worked example —
`…-add-missing-foreign-key-indexes.js`, no transaction, checking `pg_index.indisvalid` and
dropping an invalid leftover so a re-run after a failure is the fix. Copy it, including
the comment saying why `guardDataIntegrity` cannot be used.

## Correctness verification, now

What is genuinely provable on a database holding one observation. All of it is Jest against
the real development PostgreSQL, seeded by the suite — `npm test`, never `npx jest`
(`--runInBand` exists because workers race each other over one database), and through
`tests/setup/authenticated-agent.js` because every route requires a permission.

Each test names the requirement it proves.

| Proves | Test |
| --- | --- |
| R1 | every page asked for comes back, ascending, `pages[]` complete; `total`/`pageCount` present only with `includeTotal` |
| R2 | seed rows with **tied** `confidence`; assert page membership and order are identical across two calls, and that a client sort omitting `observation_id` still gets it appended |
| R3 | a discontiguous set `[1,3,5]` returns exactly the rows that pages 1, 3 and 5 return when asked for singly |
| R5 | 13 pages → `400`; 601 rows → `400`; a page past the end → `rows: []`, `rowCount: 0` |
| R6, R7 | seed one reviewed, one flagged and one with no projection row; assert each status set — `['unreviewed']`, `['flagged']`, `['unreviewed','flagged']`, `[]` — returns exactly the right ids. **This is the test that would catch a `coalesce` regression**, so it must include the mixed set |
| R8 | an empty status array returns every row, and does not apply the mode's default |
| R9 | sort by anything but `keyframe_count`, and assert the emitted SQL has no aggregate inside the CTE — asserted against the SQL, because no row count on this database can observe it |
| R10, R11 | seed a set whose status distribution is known; assert the six counts and that counts' `total` exceeds the page query's `total` when a status filter narrows |
| A5 | seed an observation with a **null `session_id`** and one with a **null `project_id`**; assert both appear in an unfiltered mosaic. This is the test that fails if somebody restores the inner join |
| R12 | a caller without the permission gets 403; the permission catalog is unchanged |
| R13 | the row's key set is exactly the agreed list — a snapshot, so an accidental addition is a failing test rather than a silent payload |
| R14 | no duplicate parent rows for an observation with many keyframes |

**None of this observes speed, and a green run does not mean the phase passes.** #68:
*"a correct endpoint that takes two seconds fails this phase."*

## The timing check, deferred — the checklist

**Deferred, deliberately, matching the shape #103 recorded for its production path.** This
database holds one observation; the data load is expected 2026-09-10. Nothing below is run
in this phase and no number below is claimed.

Read-only, and never against production.

Run each under `EXPLAIN (ANALYZE, BUFFERS)`, three times, discarding the first, and record
`work_mem` and the server's `shared_buffers` beside every result — the synthetic run showed
a 15% swing from `work_mem` alone, so a number without it is not a result.

1. **The typical question.** `species_id = <Bat Star>`, review status `['unreviewed',
   'flagged']`, sort `confidence ASC, observation_id ASC`, `pageSize` 45, pages
   `[1,2,3,4400,8798,8799]`, `includeTotal: true`, with the two recommended indexes in
   place.
2. **Flatness (R4).** The same question for page 1 alone and for the last page alone.
   **They should cost the same.** If the deep page costs materially more, the materialising
   form is not doing what this design claims.
3. **The count, three ways, on the real query** — no count, `count(*) OVER ()`, and
   `(SELECT count(*) FROM matched)`. This is the synthetic measurement in A1 repeated
   against real joins and real selectivity, and it is the one that confirms or overturns
   A1's recommendation.
4. **Selectivity, because the whole design turns on it.** The size of the matching set for
   three questions a reviewer would really ask. The design costs O(matching rows) per
   request; a typical set of 30,000 and one of 300,000 are different decisions.
5. **The status anti-join** at scale, with the projection populated to a realistic mix —
   because an empty `observation_review_current` makes every anti-join free and every plan
   here is therefore optimistic.
6. **`keyframe_count`.** The lateral for a 600-row page set (A2's display case), and the
   same sort by `keyframe_count` over the full matching set (A2's sort case). Both, because
   A2's recommendation depends on the gap between them.
7. **Nulls.** How many observations have a null `session_id`, `project_id`, `confidence` or
   `species_id`. A5 and A4 are both partly unanswerable without these four numbers.
8. **`work_mem`.** Measurement 1 at the server default and at 64 MB, to size the
   `SET LOCAL` in A8.

**The numbers that fail the phase, or reopen a decision:**

- **Two seconds on measurement 1 fails the phase outright.** #68, the experience goal.
- **Above ~400 ms on measurement 1 reopens #99's A1** — the addressing decision. That is
  #99's own threshold and its reasoning holds: past it a prefetch can no longer hide behind
  the reviewer's thinking time. The designed escape hatch is *persist the ordering*
  (`mosaic_page_membership`), which is offset semantics at keyset cost, and it must be
  compared against the hybrid rather than the hybrid being assumed.
- **A deep page costing more than 1.5× a shallow one on measurement 2** means R4 is false
  and the flatness claim has to be withdrawn from this spec rather than explained.
- **`(SELECT count(*) FROM matched)` not beating `count(*) OVER ()` on measurement 3**
  overturns A1. The synthetic result is about the window machinery; if real selectivity
  changes the ordering, the measurement wins.
- **Sorting by `keyframe_count` inside ~400 ms on measurement 6** removes the need for
  `observation_keyframe_stats` entirely, and A2 should be answered the cheap way.
- **A typical matching set an order of magnitude larger than expected on measurement 4** is
  the one result that genuinely argues for keyset, since an unselective filter is the case
  it handles best.

A note on honesty, because it is the failure mode #105 warned about: **a benchmark against
one observation would report every one of these as passing.** The checklist is worthless
until the data lands, and the phase is not verified before then.

## Plan

1. G1 gate — the human answers A1 through A9. Nothing below starts while one is open.
2. Rewrite *The query contract, and what changes from #99* and *Indexes this phase needs*
   against the answers.
3. If A2 is answered for a maintained value: the migration first, on its own, with its
   rebuild-and-compare test, before any route exists.
4. The query builder, as `sequelize.query` in the repository layer (R14). Fast tier after
   each change.
5. The two routes through `registerVersionedRoute`, declared at their `/api/...` paths.
6. `npm run docs:build`, and say in the report what the jsdoc half rewrote.
7. G3 — `.marp/verification.md` from *Correctness verification, now*, reviewed before
   anything runs.
8. G4 — run it, record the output verbatim including failures, and carry *The timing check,
   deferred* forward as still owed.

## Acceptance criteria

- Both routes exist at `/api/v2/mosaic/observations/...`, behind an existing permission
  key, with no new key seeded.
- The endpoint is substitutable for `data.js` `queryPages()` on the request and response
  envelope, for every case the fixture's own contract tests cover.
- Every requirement R1–R16 has a named test at a tier that can observe it, and the R9 and
  R13 tests assert against the SQL and the key set respectively, because no row count here
  can see either.
- `npm test` green, and the pre-existing suite count unchanged except by additions.
- `docs/openapi.generated.json` rebuilt and committed.
- `.marp/verification.md` records the deferred timing checklist as **owed**, not as passed.

## Test plan

Filled in at G3, before anything is run, from *Correctness verification, now*. It must name
per requirement the tier that can actually observe it — R9, R13 and A5's null-join case in
particular are invisible to any test that only counts returned rows on a database with one
observation in it.

## Status

- **Gate:** design
- **Notes:** G1. Eight blocking assumptions open; nothing implemented. `POST` was settled
  by the human on 2026-09-09 and is recorded under *What is settled* rather than as an
  assumption. A1 and A2 carry measurements of the query machinery at production
  cardinality over synthetic rows; A3 to A7 came out of the live schema and are the ones
  #105 did not anticipate.

## Findings left alone

Named per `AGENTS.md`, not fixed and not filed.

- **`.marp/verification.md` is still #103's** and was left where it is. #103's spec was
  renamed because this file has to be what `marp spec check` reads; the verification file
  has no such collision *yet*, but whoever writes Phase 4's verification at G3 will face
  the same choice. Flagging rather than pre-empting it.
- **`model/dimensions.js` says the model link does not exist** — *"NOTHING YET. ml_models
  exists; the link from an observation does not. #68"*. #103 added `observations.ml_model_id`,
  so that comment is now wrong. It is in the client app, and correcting it is not this
  phase's.
- **`observations_observation_id_seq` has a default on the column** but
  `repository/observation.repository.js` assigns `max(observation_id) + 1` by hand, so the
  sequence drifts. #62, and visible on this database: the one observation has
  `observation_id = 0` and `obsID = -1`.
- **`db/baseline/schema.sql` cannot be trusted for the current shape** and #99's spec was
  read from it, which is why #99 lists as missing three indexes that now exist. Not a
  defect — the file is the baseline by design — but any future spec that reads it alone
  will make the same mistake.
