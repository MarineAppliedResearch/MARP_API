---
task: MarineAppliedResearch/MARP_API#106
repos: [marp-api]
status: design
needs: []
---

# Phase 5 — the page commit

Design specification for MARP_API#106, the **write path** of #68. Three commit endpoints —
scientific review, training disposition, delete — each taking a page of observation ids plus
the marks, and each returning **per-observation outcomes**.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.** Phases 3
(#103) and 4 (#105) are on this branch and unmerged; this stacks on both, and #105's spec is
preserved beside this one as `.marp/task-105-mosaic-query.md`.

## Goal

A reviewer scans a page of pictures, flags what is wrong, and presses **Mark Page Reviewed**.
Everything they did not flag is accepted; everything they flagged is recorded as the
exception, with its reason. What they see afterwards is the truth about each individual
observation: this one was reviewed, that one was flagged, that one somebody else had already
claimed, that one changed underneath them. Two reviewers can work the same page at the same
time and neither destroys the other's work. A reviewer in Delete Mode destroys exactly the
records they picked, and nothing else.

## The basis, and what each recommendation rests on

Three bases, and every recommendation below says which one it stands on.

- **The live development database, read only.** `PostgreSQL 18.6`, queried through
  `information_schema`, `pg_constraint`, `pg_trigger`, `pg_proc` and `pg_indexes`. This is
  the baseline plus 24 migrations including #103's five, so it is the authority for what a
  constraint, index or trigger actually is — `db/baseline/schema.sql` is the baseline only
  and predates this whole design.
- **The repository's files**, and **the client's files**, which are a constraint on the
  contract rather than background: `frontend/apps/marp-mosaic-review/src/data.js`
  (`commitPage`), `src/store.js` (`commitPage`), `src/model/page.js` (`applyCommit`,
  `marksAfterCommit`, `seedMarks`), and that app's `CLAUDE.md`.
- **No measurement.** 1 observation, 8 keyframes, 1 session, 1 project, 854 species, 8 users,
  0 `ml_models`, 0 `dataset_observations`, 0 `observation_reviews`, 0
  `observation_review_current`, 24 `SequelizeMeta` rows. One row answers "fast" to every
  question, so nothing here is benchmarked and no number is claimed. Same agreed basis as
  #99, #103 and #105, not a fallback.

## What is settled before this phase starts

Inherited and enforced. Contradicting any of these fails a constraint or a test rather than
drifting.

- **First valid review wins.** The first reviewer to claim an observation for a purpose owns
  the record; a second is told it is already done and does **not** overwrite the original
  reviewer or timestamp. The same reviewer may revise their own decision. The rule lives in
  the write, not in a reader:
  `ON CONFLICT (observation_id, purpose) DO UPDATE … WHERE current.reviewer_id = :me`.
- **A take-back deletes the projection row.** `observation_review_current_purpose_decision_check`
  permits only `reviewed|flagged` for `scientific` and `promoted|excluded` for `training`, so
  `withdrawn` is legal in the log and **illegal** in the projection. Undecided is the absence
  of a row, because the mosaic's default filter is a primary-key anti-join.
- **`observations.version` is trigger-maintained.** `observations_bump_version_trigger`,
  `BEFORE UPDATE … WHEN (old.* IS DISTINCT FROM new.*)`, and its function assigns
  `NEW.version := OLD.version + 1` from **`OLD`**, never `NEW` — read from the live catalogue.
  Read it to detect a conflict; never write it, and do not add `version: true` to
  `model/observation.model.js`; `tests/observation-version.test.js` fails if you do.
- **A delete leaves no trace.** No provenance table, no soft-delete marker, no record that an
  observation existed. #68 no longer asks for one. The confirmation dialog is the safeguard.
- **Every route under `/api/v2/`**, declared without the prefix through
  `registerVersionedRoute`, which is also what attaches `requirePermission`. Hand-mounting to
  dodge its throw gets the URL and loses the permission check.
- **The annotation fingerprint** (#103's D6). A review row records the keyframe count and the
  maximum `keyframes."updatedAt"` at decision time, because a keyframe edit does **not** move
  `observations.version` — keyframes are their own table. It is a fingerprint, not a version,
  and two edits inside one clock tick that leave the count unchanged are not detected.
- **`taxReview`, `sizereview`, `comname`, `taxserial` and the `TimeSpan` columns are not
  touched.** No new permission key is seeded. `frontend/` is not touched by this phase.

### The three questions #106 named — all three answered by the human, 2026-09-09

Recorded here as settled rather than as open assumptions, with the consequences written out.

**1 · A page commit is NOT one transaction. Save what can be saved; report what cannot, per
observation.** Chosen directly, against the option of failing the whole page. Fifty pictures,
one changed underneath the reviewer: the forty-nine land and that one comes back
`conflicted`. The reasoning to keep: losing forty-nine sound decisions to protect one is a bad
trade, and #68's outcome vocabulary — `reviewed`, `flagged`, `skipped`, `reverted`,
`conflicted` — only means anything if the rest of the page landed. A whole-page rollback makes
four of those five values unreachable. #68 requires the client be **told** which it is; R6
below is that, and the client already renders exactly this shape (`data.js:718` returns
`reviewed`/`flagged`/`skipped`/`reverted` arrays and `store.js:827` paints outcomes from them).
**What "not one transaction" does and does not mean is R7 and R8**, because the two obvious
readings differ and one of them silently loses a reviewer's work.

**2 · All three routes take `observations:write`.** His words: *"i'm not sure, we should error
on the side of more simple."* No new keys, consistent with Phase 2. **The consequence, stated
because it should be visible to whoever revisits it: anyone who can correct a species can also
permanently delete.** The live catalogue holds 23 permission keys and exactly two for
observations — `observations:read` and `observations:write`, the latter described as *"Record,
change and delete observations. This is what an annotator needs."* So the key already claims
delete; what it cannot do is separate it.

#68's *Authorization* wants delete separable — a per-project delete permission plus a global
one. That is **deferred, not designed out**, and here is exactly what adding it later costs,
so the deferral is a decision with a known price:

- **a new permission key seeded** (`observations:delete`, and a global counterpart), which is
  one row in `migrations/…-seed-resource-permissions.js`' pattern and grants to nobody by
  default, so nothing breaks on the day it lands;
- **project scope, which does not exist anywhere today.** `user_permissions` carries
  `user_permission_id`, `user_id`, `permission_id`, `granted_by_user_id`, `createdAt`,
  `updatedAt` — read from `information_schema` — and **no project column**. A per-project grant
  therefore needs a column or a table, i.e. a migration, not a key;
- **the route's guard swapped** — one constant per route (R9), which is why they are three
  routes and not one;
- **a per-observation check inside the delete path**, because #68 requires authorization
  enforced per observation for a mixed-project request. Note `observations.project_id` is
  nullable and the one row on this database has it null, so a project-scoped rule needs an
  answer for "no project" before it can be written;
- **Delete Mode's gating in the client** reading the new key rather than `observations:write`.

**Until that lands, Delete Mode is gated exactly as species correction is**, and a caller
holding `observations:write` may destroy any observation in any project. R10 and D4 are where
that bites hardest: the `annotation-gui` token preset holds `observations:write`
(`scripts/create-application-token.js:47`).

**3 · Imagery: the server checks nothing in this phase.** His words: *"I think until we put in
thumbnails, we'll just simulate the thumbnails locally?"* Yes. The client keeps its own rule —
**accepting needs imagery, flagging does not** (`data.js:739`) — against its simulated
thumbnails, and the real check arrives with Phase 6. So the endpoint accepts what it is told
and makes no judgement about usable imagery. It has nothing to judge with: Phase 4's row shape
carries no `thumbnail_status` (`repository/mosaic.repository.js:140`), nothing on
`observations` records one, and there are no thumbnails to have a status.

`skipped` stays in the vocabulary because #68 defines it and the client renders it. **What the
server emits it for in this phase is exactly one reason: `not-found`** — an id in the request
that is no longer an `observations` row, which is the fixture's own first branch
(`data.js:731`). **It never emits `skipped` for an imagery reason until Phase 6**, and R5 says
so, so that nobody writes a test that cannot fail.

## What is already true, checked rather than assumed

Read from the live database and the files, not from the design record.

- **The two vocabularies differ by exactly one value**, and that is the whole mechanism of a
  withdrawal. `observation_reviews_purpose_decision_check` allows
  `reviewed|flagged|withdrawn` for `scientific` and `promoted|excluded|withdrawn` for
  `training`; `observation_review_current_purpose_decision_check` allows the same lists
  **without `withdrawn`**.
- **`observation_review_current.review_id` is `NOT NULL` and references
  `observation_reviews(review_id)` `ON DELETE CASCADE`.** So the projection row cannot be
  written before its log row exists, which fixes the order of the two statements.
- **The projection has no `created_at`/`updated_at`** — deliberately, per #103 — so nothing in
  it carries a write time other than `first_decided_at` and `decided_at`.
- **`observation_reviews.reviewer_id` is `NOT NULL` and references `users(user_id)`
  `ON DELETE RESTRICT`.** A reviewer cannot vanish while their decision stands, and **a
  principal with no `users.user_id` cannot write a review at all.** See D4.
- **`req.principal` is `{type, id, permissions}` and `id` means two different things.**
  `middleware/resolve-principal.middleware.js:54` sets `type: 'user'` with `id =
  req.user.user_id`; `repository/v2_tokens.repository.js:483` sets `type: 'service'` with
  `id = token.service_client_id`. `routes/v2_tokens.routes.js:59` already carries the helper
  that exists because of this — *"whose principal id is a `service_clients.service_client_id`,
  not a `users.user_id`, and can't satisfy that foreign key."*
- **The `annotation-gui` token preset holds `observations:write`**
  (`scripts/create-application-token.js:47`), alongside `keyframes:write` and
  `sessions:write`.
- **Deleting an observation cascades to exactly four tables**, from `pg_constraint`:
  `keyframes`, `dataset_observations`, `observation_reviews`, `observation_review_current` —
  all `ON DELETE CASCADE`. `dataset_observations` is #103's D3, settled `CASCADE` by the human
  so that *a delete must not be blocked*, which means **a delete silently removes training-set
  membership rows**. `subset_observations` and `subset_keyframes` carry an unconstrained
  `observation_id` and are **not** reached, so a delete orphans rows there — #103 named this
  and left it alone; so does this phase.
- **Phase 4's row shape does not return `version`.** `ROW_COLUMNS`
  (`repository/mosaic.repository.js:140`) is `observation_id`, `obsID`, `confidence`,
  `comname`, `tc`, `dive`, `line`, `session_type`, `project_name`, `review_decision`,
  `flag_reason`, `training_decision`, `exclusion_reason`, `keyframe_count`, `first_framenum`.
  #105's R13 snapshots that key set, so adding to it is a failing test until the snapshot moves.
  **The client therefore cannot know the version it saw, and cannot send it.** D1.
- **The client's commit sends no versions.** `store.js:775` is `state.rows.map((r) =>
  r.observation_id)` and `:791` sends `{mode, observationIds, marks}` — ids and marks, nothing
  else. #68's Delete Mode says *"the request identifies exact observation IDs and versions"*.
- **The fixture rows do carry `version`** (`fixtures/observations.json`), so once the endpoint
  returns it the client change is small.
- **The client reads only two of the five outcome arrays.** `page.js:58` `applyCommit` iterates
  `result.reviewed` and `result.flagged` and does `next.set(r.id, r.outcome)`. `skipped` and
  `reverted` are read only for the counts in the `commitPage:result` event (`store.js:837`).
  **`conflicted` is not read at all**, so today a conflicted tile would draw no badge and look
  untouched — and worse, `page.js:97` `marksAfterCommit` rebuilds the marks from the outcomes,
  so a conflicted flag **loses its mark**. That is the client change this phase forces, and it
  belongs to Phase 8.
- **`reverted` is not a bucket.** `data.js:769` pushes the same entry into `flagged` *and*
  `reverted`. And in Delete Mode `data.js:746` leaves unmarked rows untouched with no outcome
  at all. So the five arrays are **not a partition of the request**, and the contract has to say
  so rather than let somebody assume it.
- **The client's failure path is load-bearing.** `store.js:795` — a thrown commit sets
  `status: 'failed'`, fires `commitPage:failed`, and **leaves every mark exactly as it was** so
  the reviewer can retry without redoing the page. R8 exists to keep that true.
- **A review write does not bump `observations.version`.** Reviews are rows in their own
  tables; the trigger is on `observations`. So two reviewers committing the same page do not
  invalidate each other through `version` — that is what first-wins is for — and `version`
  detects only *"the annotation changed under me"*. Two distinct causes, one outcome value,
  which is why R4 gives `conflicted` a reason.
- **The client's take-back of a flag commits as `reviewed`, not as a withdrawal.** #68's
  *taking back* state is uncommitted, and at commit *whatever is not marked is accepted*
  (`data.js:773`). So **no client gesture produces `withdrawn` today**, and the vocabulary the
  schema carries is unreachable from the mosaic as built. D3.
- **The reason vocabulary is unconstrained in the database** — `varchar(64)`, no `CHECK`, per
  #103's D8, *"enforced by the API rather than a constraint"*. This phase is that API.
- **`repository/observation.repository.js:773` `deleteObservation` swallows its error and
  returns `{}`**, and has unreachable `return {status: …}` code after `return data`. Documented
  in its own JSDoc and named in #103's findings. **This phase does not use it** — see
  *Findings left alone*.

## Requirements

Numbered so a test can cite one.

**The endpoints**

- **R1** — Three routes, declared without the `/api/v2/` prefix and registered through
  `registerVersionedRoute`: `POST /api/mosaic/observations/review`, `…/training`, `…/delete`.
  Three rather than one `mode` parameter, because the permission guard is per route and that
  is what keeps the three operations splittable later (#68, Phase 7's negative obligation).
- **R2** — One request shape feeds all three: the page's observations, and the marks. The
  marks are the **exception set**, so `review` flags them, `training` excludes them, and
  `delete` destroys them and touches nothing else. A row absent from the marks is accepted by
  `review` and `training` and **untouched** by `delete` (`data.js:746`).
- **R3** — Every response entry is found by `observation_id`, never by position. Array order is
  not part of the contract; the client already looks up by key (`page.js:58`).
- **R4** — Outcomes are per observation, from #68's five values. `conflicted` carries a
  **reason** distinguishing *the annotation changed since the page was fetched* from *another
  reviewer already claimed it*, because #68 names both causes and a reviewer needs to know
  which happened.
- **R5** — The five arrays are **not a partition**. `reverted` co-occurs with `flagged` for the
  same id; a `delete` request's unmarked ids appear in no array. The response documents this,
  and **`skipped` is emitted for exactly one reason in this phase, `not-found`** — never for
  imagery, which waits for Phase 6.
- **R6** — The response states its own atomicity, so #68's *"the client is told which"* is
  satisfied by a field rather than by documentation. A value, not a boolean, so a later change
  is expressible without a rename.

**What the transaction actually guarantees**

- **R7** — **One observation's writes succeed or fail together.** The log row and the
  projection change are one unit: a log row with no projection row, or a projection row with no
  log row, is the one inconsistency `observation_review_current` cannot tolerate, and the
  projection's `NOT NULL` foreign key to `review_id` is what makes it detectable rather than
  silent. Species correction is **not** in this phase's write path — that is Phase 7 — so the
  unit is those two writes and nothing else.
- **R8** — **Ineligibility is not an error, and an error is not per row.** A conflict, a
  vanished row, an unclaimable row: none of these raises, so none of them rolls anything back.
  An unexpected failure — a deadlock, the connection dying mid-page — **rolls the whole request
  back and is reported as a failed commit**, because the client's rule is that a failed commit
  applied nothing and left the marks alone (`store.js:795`), and a half-applied commit reported
  as a failure would silently discard the reviewer's work. **A partial result is partial by
  outcome, never partial by accident.**
- **R9** — Every route requires `observations:write`, named in one constant per route so
  swapping it is a one-line change. No permission key is seeded, created or renamed.
- **R10** — Authorization is checked per request **and per observation**, per #68, even though
  in this phase every observation answers the same way. The check exists as a place rather than
  as a formality, so adding a scoped key later changes what it consults and not where it is.

**The write**

- **R11** — First valid review wins, enforced by the constraint:
  `INSERT … ON CONFLICT (observation_id, purpose) DO UPDATE … WHERE
  observation_review_current.reviewer_id = :me`. The rule is written once, in the write, and no
  reader re-derives it (#103's R6).
- **R12** — A conditional write that does not apply is detected by **what came back**, not by a
  prior read. A read-then-write cannot be safe here: two reviewers pass the same read before
  either writes.
- **R13** — After any commit, **the projection still equals the derivation** in
  `migrations/20260909120200-create-observation-review-current.js`' `-- rebuild:` block. That
  block is the single definition of "current" (#103's R6) and
  `tests/observation-review-current.test.js` already asserts equality; this phase's tests
  assert it again **after** a concurrent commit, a version conflict and a withdrawal, because
  that is when a write path can break it.
- **R14** — A withdrawal **deletes** the projection row and leaves every log row in place, and
  it deletes only when the withdrawing reviewer owns the row.
- **R15** — The annotation fingerprint — keyframe count and `max(keyframes."updatedAt")` — is
  computed **server-side at decision time** and written onto every log row. The client is not
  asked for it and cannot be trusted with it.
- **R16** — `representative_keyframe_id` is written `NULL` in this phase, because neither side
  knows it: there is no representative-keyframe assignment on `observations` and Phase 4's row
  returns `first_framenum`, not a keyframe id. Recorded as owed to Phase 6 rather than guessed.
- **R17** — A reason is `varchar(64)`; a longer one, or a value outside #68's initial
  vocabulary, is a `400` on the request rather than a truncated or silently-dropped reason. The
  client can only send its own list, so an unknown value is a bug and not a data condition.

**Delete**

- **R18** — `delete` destroys only marked observations, and the confirmation is the client's
  (`store.js:759`). The endpoint does not second-guess it and does not require a separate
  confirm token.
- **R19** — A delete is a conditional delete on the version the reviewer saw, and a row that
  moved comes back `conflicted` rather than being destroyed.
- **R20** — A delete leaves no trace: no provenance row, and nothing recording who or when.
  **What it removes is named in the spec and asserted by a test**, because the cascade set is
  invisible from the route: `keyframes`, `dataset_observations`, `observation_reviews`,
  `observation_review_current`. It never removes a `dataset`, a `session`, a `project` or a
  source video.

**Everything else**

- **R21** — `npm run docs:build` is re-run and the regenerated contract committed, or the diff
  is a lie.
- **R22** — Correctness is verified by Jest against the real development PostgreSQL through
  `tests/setup/authenticated-agent.js`; `npm test`, never `npx jest`. #106's four named tests —
  concurrent commit, version conflict, withdrawal, and the delete cascade — are only observable
  there.
- **R23** — No migration, no schema change, no new permission key, and nothing under
  `frontend/`. If the answer to D1 requires the mosaic row shape to change, that is an edit to
  `repository/mosaic.repository.js` and #105's snapshot test, **not** a migration.

## Open assumptions

The three #106 named are answered above and are recorded as settled, not here. The four below
were found by this research; each changes the contract, the permissions or the data, so each is
`blocking`. **Every recommendation is a recommendation. Nothing is implemented while one is
open.**

- [x] **D1 · API contract · blocking** — **How does the client tell the server which version it
  saw?** This is the one that decides whether `conflicted` exists at all, and the human has just
  made `conflicted` central by choosing per-observation outcomes.
  Two facts collide. Phase 4's row shape returns no `version`
  (`repository/mosaic.repository.js:140`), and #105's R13 snapshot test makes that key set a
  tripwire. The client's commit sends no versions (`store.js:775`, `:791`), while #68's Delete
  Mode requires *"the request identifies exact observation IDs and versions"*. So today the
  server cannot be told, and a conflict cannot be detected — `version` would be a token nobody
  reads, which is the mirror image of #103's D5 finding that a token some writers do not
  increment is worse than no token.
  **Recommendation: add `version` to the mosaic row shape, and require a
  `[{observation_id, version}]` list on all three commit routes, rejecting a request that omits
  a version with `400`.** Three reasons, all from what is here: the fixture rows already carry
  `version` (`fixtures/observations.json`) so the client change is one field in one map; the
  row shape is the only channel that exists, because the endpoint returns nothing else per
  observation; and an *optional* version is the worse failure — a client that forgets it gets
  silent last-write-wins on the annotation and nothing anywhere says so.
  **What it costs, plainly:** it changes a **published contract surface**. #105 is merged-ready
  with a snapshot test naming its exact row keys, and `docs/openapi.generated.json` records
  that shape. So this is a small edit to a finished phase, and it joins the list of Phase 8
  client changes. It also adds one integer to every row of a 600-row page, which is nothing.
  **The alternative, named so it can be chosen:** the endpoint reads each observation's current
  `version` itself and compares against nothing — i.e. no conflict detection, `conflicted`
  never returned, and #68's *Concurrent review* met only by first-wins. That is coherent and
  much smaller, and it means an observation whose species somebody corrected while the page was
  open is accepted against the state the reviewer did **not** see. **I would not choose it**,
  because that is the exact case #68 built `version` for.
  **What would change the recommendation:** if the human would rather not touch #105's contract
  before it merges, the honest middle is to require versions on `delete` only — where #68 states
  the requirement explicitly and where being wrong is irreversible — and defer them on `review`
  and `training` to Phase 8. Say so and it is one line either way.

- [x] **D2 · scientific or data-meaning · blocking** — **Does a decision that did not take
  effect get a log row?** A reviewer commits and is told `conflicted`. Is that decision written
  to `observation_reviews` anyway, as a record that they said it?
  **Recommendation: no, for both causes of a conflict — and for the version cause it is not a
  preference, it is a correctness requirement.**
  The decisive finding: the projection is defined as *the earliest claiming reviewer's latest
  decision* by the `-- rebuild:` block in
  `migrations/20260909120200-create-observation-review-current.js`. A **version**-conflicted
  commit can happen with nobody having claimed the observation — the annotation changed, no one
  reviewed it. Log that row and the derivation makes that reviewer the claimer, so the next
  rebuild **resurrects a decision the server refused**, and R13's projection-equals-derivation
  assertion becomes the thing that tells you about it, long after the fact. A **claim**-
  conflicted row is safe to log — the derivation still yields the earlier claimer — but there is
  no reason to hold the two to different rules, and #68 says the second reviewer *"is reported
  as already completed"*: reported, not recorded.
  **The trade:** #103's R4 wants the full per-reviewer history, and #68 reserves an *"explicit
  validation mode"* where a second independent review would be the point. Under this
  recommendation those second opinions are never captured, so that mode starts from nothing —
  which is a data-migration-free start, but a start from zero.
  **The alternative:** log claim-conflicts and refuse to log version-conflicts. It captures the
  second opinions, it is derivation-safe, and it costs one rule that has to be explained every
  time somebody reads the write path. **A third option is worse and should not be chosen:**
  logging both and relying on the derivation, because it is correct only until the first
  rebuild.

- [x] **D3 · API contract · blocking** — **What request expresses a withdrawal, given no client
  gesture produces one?** #106 requires a withdrawal test — *"the projection row is gone, the
  log still holds every decision"* — so the endpoint must support one. But the client's
  take-back of a flag commits as `reviewed`, not as a withdrawal (`data.js:773`, and #68's
  *taking back* state is explicitly uncommitted), so **nothing in the mosaic as built ever asks
  for `withdrawn`**, and the vocabulary the schema carries is unreachable.
  **Recommendation: an explicit per-observation intent in the request — a `withdraw` list of
  ids, alongside the page and the marks — which `review` and `training` accept and `delete`
  does not.** It is the smallest thing that makes the settled schema reachable and #106's test
  drivable, it cannot be produced by accident from a page commit, and it is exactly the shape a
  later *"clear my decision"* gesture would send.
  **The trade, said plainly: this builds a path with no caller.** `AGENTS.md` says minimum code
  and no speculative features, and one reading of that is to build no withdrawal at all in
  Phase 5, leave `withdrawn` unwritten, and let #106's withdrawal test become a Phase 7 test
  when a gesture exists. **The reason I do not recommend that** is that the constraint refusing
  `withdrawn` in the projection is the load-bearing half of #103's design, and an enforcement
  nothing exercises is an enforcement nobody has checked — it is one `CHECK` and one `DELETE`
  away from being verified now, at the tier that can see it.
  **What a different answer changes:** the request shape on two routes, and whether `reverted`
  is the only withdrawal-shaped outcome this phase can return.

- [x] **D4 · security/permissions · blocking** — **What happens when a commit arrives on a
  service token?** `observation_reviews.reviewer_id` is `NOT NULL` and references
  `users(user_id)`. A bearer-token principal's `id` is a `service_clients.service_client_id`
  (`repository/v2_tokens.repository.js:483`), and the repository already carries a helper that
  exists because of exactly this trap (`routes/v2_tokens.routes.js:59`). So writing
  `req.principal.id` as the reviewer is one of two bad outcomes: a foreign-key violation and a
  `500`, or — where a `users` row happens to share that number, which it will, because both
  sequences start at 1 — **a review silently attributed to an unrelated person in the scientific
  record.**
  **Recommendation: all three commit routes refuse a non-user principal with `403`, before any
  write.** Two reasons beyond the foreign key. First, all three are reviewer gestures made by a
  person in an interactive tool, and #68's *What counts as reviewed* is about a person having
  looked. Second, and concretely: **the `annotation-gui` token preset holds
  `observations:write`** (`scripts/create-application-token.js:47`), so with the permission
  answer settled as it is, that token would otherwise authorize permanent bulk deletion of
  observations from the mosaic delete route. Refusing non-user principals closes that without a
  new key.
  **Note it is not free.** `delete` has no reviewer to record — deletion leaves no trace — so it
  is the one route where a service principal *could* be served, and refusing it is a choice
  rather than a consequence. **I still recommend refusing it**, because a machine performing
  irreversible bulk deletion with no record of having done so is the one operation in MARP
  where that combination is least acceptable.
  **The alternatives, named:** map a service principal onto a configured "system" user, which
  invents an actor in the scientific record and is the sentinel-row mistake #103 rejected for
  `ml_models`; or make `reviewer_id` nullable, which contradicts *a review belongs to its
  reviewer* and needs a migration this phase does not have.

- [x] **D5 · API contract · non-blocking** — Route paths. `#68` says `POST
  /api/v2/observations/review`; #105 already put the mosaic's routes under
  `/api/v2/mosaic/observations/…`, and the general rule recorded in #105 is that where #68 and a
  later, more specific decision disagree, the later one wins and #68 gets corrected.
  **Following the sibling: `/api/mosaic/observations/{review,training,delete}`**, declared
  without the prefix. Established pattern, recorded rather than asked — and #68's *Phase 5*
  section needs the same correction its *Phase 4* section did.

- [x] **D6 · database/schema · non-blocking** — **Should append-only be enforced on
  `observation_reviews`?** #106 asks, and offers *"or say why not"*. **Why not: a trigger
  refusing `DELETE` would contradict a settled cascade.** `observation_reviews_observation_id_fkey`
  is `ON DELETE CASCADE`, and #68's permanent delete depends on it — so "nothing is ever
  deleted" is already false by design, and a trigger enforcing it would break Delete Mode. That
  leaves refusing `UPDATE` only, which is a migration in a phase whose scope is the write path,
  to protect against a writer that does not exist. **Recommendation: no trigger.** Instead the
  repository is the only writer, it only ever inserts, and a test asserts the write path emits
  no `UPDATE` or `DELETE` against `observation_reviews` — the check that costs nothing and
  fails when somebody adds one. Revisit if a second writer ever appears.

- [x] **D7 · cross-repository integration · non-blocking** — Phase 8 inherits **three more
  incompatibilities**, joining the three #68 already records. Named here so they are expected
  rather than met: `marks` is a `Map` and `excludeIds` a `Set`, and **neither survives
  `JSON.stringify`** — both serialise to `{}`, silently, so the exception set would vanish over
  the wire and a page of flags would commit as accepted; the response entries are keyed `id` in
  the fixture (`data.js:731`) where the endpoint returns `observation_id`, following #68's Phase
  8 ruling that the endpoint's names follow the schema; and **`applyCommit` and
  `marksAfterCommit` must learn `conflicted`** (`page.js:58`, `:97`), or a conflicted tile draws
  no badge and loses its mark. **Not fixed here — this phase does not touch `frontend/`.**

## Answered, 2026-09-09

The human was unsure on D1 and delegated it; D2, D3 and D4 were settled on the
recommendation. All four are recorded with the reasoning, because three of them are
enforced by constraints and the fourth guards the scientific record.

- **D1 — `version` goes into the mosaic row, and all three commit routes require
  `[{observation_id, version}]`.** Full, not delete-only, and the reasoning that decided it
  is worth keeping: **the middle option saves nothing.** For a client to send a version on
  delete, the version has to be in the row it received — so Phase 4's row shape changes
  either way, and "delete-only" buys no reduction in cost while leaving review and training
  on silent last-write-wins. So the real choice was full or nothing, and nothing makes
  #68's *Concurrent review* section unimplementable: `conflicted` could never fire,
  `observations.version` would be a token nobody reads, and that is the exact mirror of
  #103's D5 finding that a token some writers do not increment is worse than no token.
  **What this costs, and it is owed to #105 rather than to this phase:** one entry in
  `ROW_COLUMNS` (`repository/mosaic.repository.js:140`), the R13 snapshot test that names
  the row's exact keys, and a regenerated `docs/openapi.generated.json`. #105 is unmerged,
  so this is a correction to it rather than a revision of something shipped. **Do it as
  part of this phase and say so in the commit**, so the two stay consistent — a row shape
  that cannot support the commit route beside it is not a finished read path.
  An **absent** version is a `400`, never an implicit overwrite: a client that forgets is
  the failure mode an optional field hides.
- **D2 — a decision that did not take effect is not logged.** For the version cause this is
  correctness rather than preference, and the argument is the one to keep: a
  version-conflicted commit can occur **with nobody having claimed the row** — the
  annotation changed, no one reviewed it. Log it and the `-- rebuild:` derivation in
  `migrations/20260909120200-create-observation-review-current.js` makes that reviewer the
  earliest claimant, so **the next rebuild resurrects a decision the server refused**, and
  #103's projection-equals-derivation test is what discovers it, long afterwards. Claim
  conflicts are derivation-safe to log, but #68 says the second reviewer *"is reported as
  already completed"* — reported, not recorded, and one rule is better than two.
  The trade, named: #68's later "explicit validation mode" starts from no data about
  refused attempts.
- **D3 — a withdrawal is an explicit `withdraw` list of ids, on review and training only.**
  Accepted knowing it builds a path the mosaic does not yet call: the client's take-back of
  a flag commits as `reviewed`, so `withdrawn` is unreachable from the app as built. It is
  recommended anyway because the `CHECK` refusing `withdrawn` in the projection is the
  load-bearing half of #103's D1 design, and #106 requires a withdrawal test — one `DELETE`
  away from being verified at the tier that can see it, rather than asserted in prose.
- **D4 — all three routes refuse a non-user principal with `403`, before any write.** This
  is the finding that most justified the gate, and it is a data-integrity matter rather than
  a permissions preference. `observation_reviews.reviewer_id` is `NOT NULL → users(user_id)`,
  while a bearer principal's `id` is a `service_clients.service_client_id`
  (`repository/v2_tokens.repository.js:483`). Both sequences start at 1, so they collide —
  and the failure is not an error but **a review silently attributed to an unrelated person
  in the scientific record.** The helper that refuses this already exists
  (`routes/v2_tokens.routes.js:59`) precisely because of the same trap.
  And the part that matters beyond this phase: the **`annotation-gui` token preset holds
  `observations:write`** (`scripts/create-application-token.js:47`), so under the settled
  single-key answer that token would otherwise authorize **permanent bulk deletion**.
  `/delete` records no reviewer, so refusing it there is a deliberate choice rather than a
  consequence of the foreign key — and it is the right one: a service token should not be
  able to destroy the scientific record unattended.

## Decisions

- **2026-09-09 — A page commit is not one transaction; save what can be saved and report the
  rest per observation.** The human's, directly, against failing the whole page. Losing
  forty-nine sound decisions to protect one is a bad trade, and four of #68's five outcome
  values are unreachable under a whole-page rollback.
- **2026-09-09 — "Not one transaction" means outcomes are per observation. It does not mean
  fifty transactions.** R7 and R8 are the two halves. Ineligibility — a conflict, a vanished
  row, an unclaimable row — is not an error and rolls nothing back, so no savepoint and no
  per-row transaction is needed to isolate it: the outcome falls out of which ids the
  conditional write returns. An **unexpected** failure is not per row and rolls the request
  back, which is what keeps the client's *"a failed commit applied nothing and left the marks
  alone"* true. **The cost of the alternative, named:** independently durable per-observation
  writes would keep the first thirty rows of a page that died mid-flight, at the price of a
  half-applied commit the client reports as a failure while the record disagrees — the reviewer
  then re-commits over work that already landed. **For fifty rows the mechanism cost is not the
  deciding factor either way**: one transaction is one WAL flush and one round trip, fifty
  transactions are fifty of each, and savepoints sit between; correctness picked this, not
  throughput.
- **2026-09-09 — All three routes take `observations:write`, and delete is therefore not
  separable yet.** The human chose simplicity. The consequence is recorded rather than implied:
  anyone who can correct a species can permanently delete. What it would take to add the
  separation is written out above, including the part that is not a permission key at all —
  `user_permissions` has no project scope, so a per-project grant is a migration.
- **2026-09-09 — The server makes no imagery judgement in this phase.** The client simulates
  thumbnails and keeps its own rule. `skipped` is emitted for `not-found` only, and **never for
  imagery until Phase 6**, so no test asserts a skip this phase cannot produce.
- **2026-09-09 — Response entries are found by `observation_id`, and the five arrays are not a
  partition.** `reverted` co-occurs with `flagged`; a delete request's unmarked ids appear
  nowhere. Both are the fixture's existing behaviour and both are easy to assume away.
- **2026-09-09 — The basis is the live development database read through the catalogue, plus
  the repository's and the client's files. No measurement**: one observation. Same basis as
  #99, #103 and #105.

## The shape, written out so it can be reviewed concretely

**Rewritten before anything is built if D1, D2 or D3 are answered differently.** Written
against the recommendations, with the parts each assumption owns marked.

### The request, one shape for all three routes

```jsonc
{
  "observations": [ { "observation_id": 100000, "version": 3 } ],  // D1: the page, as seen
  "marks":        [ { "observation_id": 100001, "reason": "Wrong Species" } ],
  "withdraw":     [ 100002 ]                                       // D3; not on /delete
}
```

`observations` is the whole page, exactly as `store.js:775` sends it. `marks` is the exception
set. One shape for three routes, for the reason A9 gave the counts route: one serialiser, one
validator, and the filters — here the marks — mean the same thing on each.

### The response

```jsonc
{
  "atomicity": "per-observation",     // R6, and #68's "the client is told which"
  "reviewed":   [ { "observation_id": 100000, "outcome": "reviewed" } ],
  "flagged":    [ { "observation_id": 100001, "outcome": "flagged" } ],
  "reverted":   [ { "observation_id": 100001, "outcome": "flagged" } ],  // R5: co-occurs
  "skipped":    [ { "observation_id": 100003, "reason": "not-found" } ],
  "conflicted": [ { "observation_id": 100004, "reason": "claimed" } ],   // or "version"
  "committedAt": "2026-09-09T12:00:00.000Z"
}
```

`outcome` follows the route: `reviewed`/`flagged` for review, `promoted`/`excluded` for
training, `deleted` for delete — which is what the fixture already returns and what the tile
badge reads.

**Nothing in the response says *who* claimed a conflicted observation.** #68's live-page
behaviour wants the tile to show it has already been reviewed *"including by whom where
appropriate"*, and that is deliberately not here: the permission catalog separates
`users:read` — *"so a client can show who processed something"* — from `observations:read`, and
#105's A7 dropped `processor_name` from the mosaic row for exactly that reason. Naming a
reviewer from an `observations:write` route would cross the same line. Showing who belongs to
the read path, under the key that gates identity.

### The write, per route

Two statements per purpose, in this order, because the projection's `review_id` is `NOT NULL`
and references the log:

```sql
-- 1. the log. Append-only, one row per decision that took effect.
--    The source is a join against `observations`, so a vanished id drops out here and is
--    reported `not-found` (R5) rather than raising a foreign-key error mid-page (R8), and
--    the version check is a WHERE rather than an exception (D1).
--    The annotation fingerprint is computed here, server-side (R15).
INSERT INTO observation_reviews (
       observation_id, purpose, decision, reason, reviewer_id, observation_version,
       reviewed_keyframe_count, reviewed_keyframe_max_updated_at, representative_keyframe_id)
SELECT o.observation_id, :purpose, w.decision, w.reason, :me, o.version,
       k.keyframe_count, k.max_updated_at, NULL            -- R16: Phase 6 owes this
  FROM (VALUES …) AS w (observation_id, version, decision, reason)
  JOIN observations o ON o.observation_id = w.observation_id AND o.version = w.version
  LEFT JOIN LATERAL (SELECT count(*)::int AS keyframe_count,
                            max("updatedAt") AS max_updated_at
                       FROM keyframes WHERE observation_id = o.observation_id) k ON true
RETURNING review_id, observation_id, decision;

-- 2. the projection. First valid review wins, enforced by the constraint (R11).
--    A row this reviewer does not own updates nothing and comes back in no RETURNING,
--    which is how `claimed` is detected — by what came back, not by a prior read (R12).
INSERT INTO observation_review_current (
       observation_id, purpose, review_id, decision, reason, reviewer_id,
       first_decided_at, decided_at, observation_version)
SELECT …
  FROM inserted
ON CONFLICT (observation_id, purpose) DO UPDATE
   SET review_id = EXCLUDED.review_id, decision = EXCLUDED.decision,
       reason = EXCLUDED.reason, decided_at = EXCLUDED.decided_at,
       observation_version = EXCLUDED.observation_version
 WHERE observation_review_current.reviewer_id = EXCLUDED.reviewer_id
RETURNING observation_id;
```

`first_decided_at` is never updated — that is the timestamp first-wins has to preserve when the
claiming reviewer revises (#103).

**A withdrawal** (D3) is the same log insert with `decision = 'withdrawn'`, then
`DELETE FROM observation_review_current WHERE (observation_id, purpose) = (…) AND reviewer_id =
:me RETURNING observation_id` — the `CHECK` refuses `withdrawn` in this table, so a delete is
the only legal expression of it (R14).

**A delete** is one statement, conditional on the version:

```sql
DELETE FROM observations o
 USING (VALUES …) AS w (observation_id, version)
 WHERE o.observation_id = w.observation_id AND o.version = w.version
RETURNING o.observation_id;
```

Ids not returned are `conflicted` (`version`) or `skipped` (`not-found`), told apart by one
existence query over the remainder. Nothing else is written, and the four cascades named in R20
do the rest. **The trigger does not fire on a delete**, so the version here is a plain
comparison.

**Under D2's recommendation**, a version-conflicted row never reaches statement 1 — the join
drops it — so nothing is logged for it, which is what keeps R13 true across a rebuild.

## Plan

1. G1 gate — the human answers D1 through D4. Nothing below starts while one is open.
2. Rewrite *The shape* against the answers.
3. The repository: `repository/mosaic-commit.repository.js` beside `mosaic.repository.js`,
   sharing its `MosaicRequestError` shape and its raw-SQL approach (#105's R14). Fast tier
   after each step.
4. The routes, three of them, one permission constant each (R9).
5. If D1 is answered as recommended: add `version` to `ROW_COLUMNS` and move #105's snapshot.
6. `npm run docs:build`, and commit what it regenerates (R21).
7. G3 — `.marp/verification.md` from the requirements above, before anything is run. **Phase
   4's `.marp/verification.md` is still on this branch and is Phase 4's**; it is renamed aside
   at G3 the way its `task.md` was, not overwritten.
8. G4 — run it, record the output verbatim including failures.

## Acceptance criteria

- Three routes exist under `/api/v2/`, each behind `requirePermission('observations:write')`,
  each refusing a non-user principal with `403` (D4).
- Two reviewers committing the same observation: the first owns the record, the second is
  `conflicted` with reason `claimed`, and the original reviewer and `first_decided_at` are
  unchanged. Against the real database, because it is meaningless anywhere else.
- An observation changed under a fetched page comes back `conflicted` with reason `version`,
  and its decision is not written (D1, D2).
- A withdrawal leaves no projection row and every log row (R14).
- A delete removes the observation, its keyframes, its `dataset_observations` membership and
  its review rows, and removes no `dataset`, `session` or `project` (R20).
- **Projection equals derivation** after every one of the above (R13).
- `observations.version` is not written by any statement this phase adds, and
  `model/observation.model.js` is unchanged.
- No migration, no permission key, nothing under `frontend/`. `git diff --stat` shows routes,
  a repository, tests, the regenerated docs, and this file.

## Test plan

Filled in at G3, before anything is run. It has to name, per requirement, the tier that can
observe it — and four of them are only observable against the real PostgreSQL: the concurrent
claim, the version conflict, the withdrawal's `CHECK`, and the delete cascade. A unit test on a
repository method cannot see any of the four.

## Status

- **Gate:** design
- **Notes:** G1. The three questions #106 named are answered by the human and recorded as
  settled. **Four blocking assumptions found by this research are open** — D1 the version
  transport, which decides whether `conflicted` can exist at all; D2 whether a refused decision
  is logged, where the version case is a correctness requirement rather than a preference; D3
  what request expresses a withdrawal, since no client gesture produces one; D4 what happens
  when a commit arrives on a service token, which today would either violate a foreign key or
  attribute a review to the wrong person. Nothing is implemented.

## Findings left alone

Named per `AGENTS.md`, not fixed and not filed.

- **`repository/observation.repository.js:773` `deleteObservation` swallows its error and
  returns `{}`**, and carries unreachable code after its `return`. This phase does not call it —
  the delete route needs a conditional, set-based delete this method cannot express — so the
  broken method stays, unused by the new path and still used by the existing observation route.
  Worth a human's decision about whether the new path should replace it.
- **`subset_observations` and `subset_keyframes` carry an unconstrained `observation_id`**, so
  a permanent delete orphans rows in both. #103 found this and left it; #100 covers only
  `dataset_observations`.
- **`frontend/apps/marp-mosaic-review/src/data.js:739` reports `no-imagery` in Delete Mode**
  for an unmarked row with no thumbnail, even though Delete Mode never touches an unmarked row.
  Harmless noise in the fixture; the endpoint does not copy it.
- **`observations_observation_id_seq` is at `last_value 6` against a table max of 1** — #62's
  drift, still visible.
