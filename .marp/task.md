---
task: MarineAppliedResearch/MARP_API#111
repos: [marp-api]
status: design
needs: []
---

# Phase 7 — species correction, invalidation, and the permission review

Design specification for MARP_API#111, the last API phase of #68 before the fixture is
replaced. One endpoint — correct an observation's species — plus **the invalidation that
correction causes**, which is the substantial part and which changes the committed
definition of "current". Plus the permission review, which is a negative obligation rather
than a feature.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.** Phases 3
(#103), 4 (#105) and 5 (#106) are merged to `develop`; this branch stacks on nothing. Their
specs are preserved beside this one as `.marp/task-103-review-state-schema.md`,
`.marp/task-105-mosaic-query.md` and `.marp/task-106-page-commit.md`.

## Goal

A biologist looking at a wall of pictures sees one that is plainly the wrong animal, presses
**Change Species**, picks the right one, and the tile confirms it. What the record then says
is the truth: the observation's species is the corrected one, the annotator's own label is
still there to be audited against, and **any approval that was given to the old
classification is gone** — so the observation comes back round to be reviewed again, by
whoever reviews it next rather than only by whoever reviewed it before.

## The basis, and what each recommendation rests on

Three bases, and every recommendation below says which one it stands on.

- **The live development database, read only.** PostgreSQL 18.6, queried through
  `information_schema`, `pg_constraint`, `pg_trigger`, `pg_proc`, `pg_indexes` and
  `pg_get_functiondef`. This is the baseline plus 24 migrations, including #103's five, so
  it is the authority for what a constraint, index or trigger actually is.
  `db/baseline/schema.sql` predates this whole design and is not consulted for it.
- **The repository's files**, and **the client's files**, which are a constraint on the
  contract rather than background: `frontend/apps/marp-mosaic-review/src/data.js`
  (`setSpecies`), `src/store.js` (`changeSpecies`), `src/ui/tile.js`, and that app's
  `CLAUDE.md`.
- **No measurement.** 1 observation, 8 keyframes, 1 session, 854 species, 15 users, 0
  `observation_reviews`, 0 `observation_review_current`, 24 `SequelizeMeta` rows. One row
  answers "fast" to every question, so nothing here is benchmarked and no number is claimed.
  Same agreed basis as #99, #103, #105 and #106, not a fallback.

## What is settled before this phase starts

Inherited. Contradicting any of these fails a constraint or a test rather than drifting.

- **`comname` is never rewritten, and neither is `taxserial`.** `comname` is the label the
  list entry carried when the annotator pressed the button, and roughly 50,000 observations
  already disagree with what their list says today because lists were renamed and renumbered
  underneath records that were correct when made
  (`migrations/20260901120500-add-observations-species-id.js`, Refs #52). A correction changes
  `species_id`. `taxReview`, `sizereview` and the `TimeSpan` columns are untouched too.
- **`observations.species_id` is nullable and about 4% of production rows have no value.**
  Read from the migration above: 438,988 of 440,102 rows carry a `taxserial`, and the
  backfill could not resolve roughly 4% of them. The single row on this database has
  `species_id = NULL`, `comname = 'Blue/Deacon Rockfish'`, `taxserial = 166730`. So "the
  species before the correction" is legitimately absent, not merely unknown.
- **`species_id` references `species(id)`**, `ON UPDATE CASCADE ON DELETE SET NULL` — read
  from `pg_constraint` as `observations_species_id_fkey`. `species` has 854 rows here and
  carries `comname`, `species` (the scientific name), `gui_display_name`, `taxserial`,
  `species_list` and `is_active`.
- **`observations.version` is trigger-maintained.** `observations_bump_version_trigger`,
  `BEFORE UPDATE … FOR EACH ROW WHEN (old.* IS DISTINCT FROM new.*)`, and
  `observations_bump_version()` assigns `NEW.version := OLD.version + 1` from **`OLD`**,
  never `NEW` — read from `pg_get_functiondef`. Read it to detect a conflict; never write it.
  **The `WHEN` clause is load-bearing for this phase**: an update that changes nothing does
  not bump the version. See R4.
- **A review belongs to its reviewer.** `observation_reviews` is the append-only log;
  `observation_review_current` is the maintained projection, keyed `(observation_id,
  purpose)`, and undecided is the *absence* of a row so the mosaic's default filter is a
  primary-key anti-join.
- **The projection is a derived value and therefore part of the data contract**, not a
  cache. Its definition ships once, as the `-- rebuild:` block in
  `migrations/20260909120200-create-observation-review-current.js`, and
  `tests/observation-review-current.test.js` asserts projection equals derivation. That test
  is what catches a half-change months later.
- **Every route under `/api/v2/`**, declared without the prefix through
  `registerVersionedRoute`, which is also what attaches `requirePermission`.
  `routes/lib/register-versioned-route.js:46` throws on a path that already starts
  `/api/v2/`, and hand-mounting to dodge that throw gets the URL and loses the permission
  check.
- **No new permission key is seeded.** Phase 2 settled the existing model.
- **A delete leaves no trace.** Withdrawn 2026-09-09; nothing in this phase reinstates a
  provenance table for deletion.
- **`frontend/` is not changed by this phase.** The incompatibilities this phase creates for
  the client are recorded here (see *Five incompatibilities the client will meet*) and are
  Phase 8's work, exactly as #105's three were.

### The three questions #111 named

**1 · A correction is a review decision.** Settled by the human, 2026-09-09: *"a species
correction is a review decision."* So the correction is a row in `observation_reviews`, not a
separate audit table beside it. The consequences are worked out in D1–D5 below and they are
not all obvious: the table's `CHECK` has no value for it, it carries data no decision carries
(the species it replaced) and none of the data every decision carries (a `reason` from the
flag vocabulary), and a row in that table participates in whatever the derivation says
"current" means — which for a correction must be *nothing*, because a correction is not an
approval and must not read as one on a tile.

**2 · An invalidated decision clears the slate; whoever reviews next owns the
observation.** Settled by the human, 2026-09-09: *"if something was tagged as approved, and
later gets changed, obviously the new change wins."*

This resolves what looked like a collision between two settled rules, and the resolution is
that they were never about the same situation — the implementation conflated them:

- **A race.** Two reviewers acting at the same moment: first valid review wins, and the
  second *"is reported as already completed"* (#68, *Concurrent review*). Unchanged.
- **A supersession.** A decision later overtaken by a material change: the change wins, the
  decision is invalidated, and the observation is open to anybody again.

So **"the earliest claiming reviewer" is scoped to the current round of decisions, not to all
time.** A correction ends a round. That is a change to the committed derivation, and D3 is
what it becomes.

**3 · Whether a correction is version-checked.** **Still open** — A3 below. The coordinator
reported it settled along with the other two, but no answer for it reached this branch, and
guessing at an API contract that every later client has to satisfy is exactly what the gate
exists to prevent. The recommendation is *yes*, with the reasoning in A3.

## What is already true, checked rather than assumed

Each of these was read out of the live catalogue or the committed source, and each one
changes the design if it is wrong.

- **`observation_reviews_purpose_decision_check` admits six combinations and no more:**
  `scientific` × {`reviewed`, `flagged`, `withdrawn`} and `training` × {`promoted`,
  `excluded`, `withdrawn`}. There is no value for a correction. **This phase therefore needs
  a migration whether or not anything else does.**
- **`observation_review_current_purpose_decision_check` admits four:** `scientific` ×
  {`reviewed`, `flagged`} and `training` × {`promoted`, `excluded`}. `withdrawn` is legal in
  the log and illegal in the projection, which is what makes a withdrawal a `DELETE`. A
  correction inherits that shape for free: any value or purpose the projection's `CHECK` does
  not name simply cannot be projected, and the constraint fails loudly rather than quietly if
  a writer tries.
- **`observation_reviews` has no column for a species**, in either direction. Its columns are
  `review_id`, `observation_id`, `purpose`, `decision`, `reason`, `reviewer_id`,
  `observation_version`, `reviewed_keyframe_count`, `reviewed_keyframe_max_updated_at`,
  `representative_keyframe_id`, `decided_at`, `created_at`, `updated_at`. `reason` is
  `varchar(64)` and holds the reviewer-facing flag vocabulary.
- **The committed derivation names the earliest claimant over the whole log.** `claim` groups
  every row by `(observation_id, purpose, reviewer_id)`; `claimer` takes the earliest
  `first_decided_at`; `latest` takes that reviewer's most recent row; the final `WHERE
  decision <> 'withdrawn'` drops a withdrawal. Nothing in it has a notion of a round.
- **Phase 5 decides claim against the log, not the projection.**
  `repository/mosaic-commit.repository.js:433-467` — `appendDecisions` carries its own
  `claim`/`claimer` CTEs and refuses a write with `NOT EXISTS (… c.reviewer_id <> $3)`. So
  the write path holds a *second copy* of the claim rule, deliberately, and **any change to
  the derivation's notion of a claim must land in both files or they disagree.** #103's
  projection-equals-derivation test is what finds that, long afterwards.
- **A withdrawal already locks everyone else out, and this phase does not fix it.**
  `repository/mosaic-commit.repository.js:41-46` records it: *"a claimer who has withdrawn
  still owns the observation."* Phase 5 accepted it as latent because no client gesture
  produced a withdrawal. This phase removes *correction* as a trigger for it; the latent
  issue itself survives untouched, for a future explicit *clear my decision* gesture. Said
  plainly so nobody reads this phase as having closed it.
- **`updateObservation` propagates `comname` to keyframes.**
  `repository/observation.repository.js:690-712`: when the submitted `comname` differs from
  the stored one it updates every `keyframes` row for that observation. `keyframes` carries a
  `comname` and **no `species_id`** — checked in `information_schema`. So a correction must
  not go through `updateObservation`, and because it never sends a `comname` it would not
  trigger the propagation anyway. Both halves are stated because relying on the second alone
  is one refactor away from being wrong.
- **`observations.species_id` is written nowhere in the application today.** Only
  `migrations/20260901120500` populates it, and `model/observation.model.js:227` declares it.
  So the correction is the first write path for it and there is no existing pattern to match.
- **`observations` has no `scientific_name` column.** The mosaic row shape carries
  `o.comname` and no species join at all (`repository/mosaic.repository.js:147-163`), and
  #105 excluded `scientific_name` deliberately. This is why A4 exists.
- **The permission catalog holds 23 keys and exactly two for observations.**
  `observations:read` and `observations:write`, the latter described as *"Record, change and
  delete observations. This is what an annotator needs."* Read from the live `permissions`
  table.
- **`user_permissions` has no project column.** Its columns are `user_permission_id`,
  `user_id`, `permission_id`, `granted_by_user_id`, `createdAt`, `updatedAt`. And
  `observations.project_id` is **nullable**, with the single local row carrying null. Both
  matter to the permission review.
- **`observation_id` is assigned by hand** as `max(observation_id) + 1` in
  `repository/observation.repository.js` (#62), even though the column carries a
  `nextval('observations_observation_id_seq')` default. This phase creates no observation, so
  it is only a note for whoever seeds test rows: insert with SQL, as
  `tests/observation-review-current.test.js:245` already does.

## Requirements

- **R1** — One route, one observation: `POST /api/mosaic/observations/species`, declared
  through `registerVersionedRoute` so it lands at `/api/v2/mosaic/observations/species`
  behind `requirePermission`. Single-observation rather than bulk, because the client's seam
  is `setSpecies(observationId, speciesId)` (`data.js:790`) called one tile at a time
  (`store.js:596`); a bulk form is additive later and nothing asks for it now.
- **R2** — The only observation column written is `species_id`. `comname`, `taxserial`,
  `taxReview`, `sizereview` and the `TimeSpan` columns are not touched, and the write does
  **not** go through `updateObservation`, whose `comname` propagation to `keyframes` has no
  business firing here.
- **R3** — The request carries `{observation_id, version, species_id}` and a stale `version`
  is refused without writing anything, reported the way Phase 5 reports it. *Conditional on
  A3.*
- **R4** — **A correction naming the species the observation already has writes nothing and
  is refused.** This is correctness, not tidiness: the version trigger fires only `WHEN
  (old.* IS DISTINCT FROM new.*)`, so a no-op update leaves the version where it is, and a
  boundary recorded at an unmoved version (R7) would invalidate every existing decision while
  making it impossible for any later decision to clear the boundary. The observation would
  become permanently unreviewable. Found by working the version arithmetic through, not by
  taste.
- **R5** — The correction appends exactly one `observation_reviews` row: `decision =
  'corrected'`, `reviewer_id` = the acting user, `observation_version` = the version the
  correction *applied to* (pre-bump, which is the column's documented meaning),
  `previous_species_id` and `corrected_species_id`, `reason` null. The annotation fingerprint
  columns are populated the way Phase 5 populates them, server-side.
- **R6** — A migration widens `observation_reviews`: the two new species columns, and
  `observation_reviews_purpose_decision_check` rebuilt to admit the correction (A2 decides
  which purpose it belongs to), plus a `CHECK` tying `corrected_species_id IS NOT NULL` to
  `decision = 'corrected'` and null to everything else, so a correction row cannot be
  recorded without saying what it changed to and an ordinary decision row cannot pretend to
  be one.
- **R7** — **A second migration supersedes the definition of "current"**, carrying a new
  `CURRENT_DERIVATION_SQL` with a *boundary*: the most recent invalidating event for an
  observation, before which decisions are history rather than claims. The old migration file
  is not edited — see D4 for why. Its `up()` re-runs the rebuild so every database, including
  ones that already ran #103's migration, ends holding a projection the new definition agrees
  with; its `down()` restores the previous definition and rebuilds again.
- **R8** — A `corrected` row **never claims and never projects.** It takes part in no
  `claimer` computation and reaches no `observation_review_current` row, so an observation
  somebody corrected but nobody reviewed is still unreviewed, and correcting a species does
  not lock the observation to the corrector.
- **R9** — The correction deletes the observation's `observation_review_current` rows for
  **both** purposes, **regardless of `reviewer_id`**, inside the same transaction as the log
  row and the `species_id` update. Unlike `releaseWithdrawn`
  (`repository/mosaic-commit.repository.js:557`) this is not reviewer-scoped: it removes
  other people's projection rows, which is what invalidation means. Their decisions stay in
  the log, which is what *"retaining that decision's audit history"* means.
- **R10** — Phase 5's `appendDecisions` claim CTEs (`mosaic-commit.repository.js:433-467`)
  gain the same exclusions as the derivation, so the write path's claim test and the
  committed derivation stay the same rule. Changing one and not the other is the half-change
  #103's test exists to catch.
- **R11** — `tests/observation-review-current.test.js` reads the **current** definition
  rather than a hard-coded file path, and gains a case with **an invalidation in the middle of
  a log**: decide, correct, decide again as a *different* reviewer, and assert projection
  equals derivation at every step and that the second reviewer's decision is the current one.
  Comparisons of file content against a template literal normalise `\r\n` to `\n` first — the
  suite already does this at line 79 and the reason is in R14.
- **R12** — The route takes its own permission constant, `CORRECTION_PERMISSION`, alongside
  Phase 5's three. Value `observations:write`, no new key seeded.
- **R13** — A non-user principal is refused `403` before any write, with Phase 5's reasoning
  verbatim: `observation_reviews.reviewer_id` is `NOT NULL REFERENCES users(user_id)`, a
  bearer principal's id is a `service_clients.service_client_id`, both sequences start at 1,
  and the failure is not an error but a correction silently attributed to an unrelated person
  in the scientific record.
- **R14** — Refusal-case tests in the style of `tests/auth.test.js` and
  `tests/v2_users.test.js`: anonymous, a user without `observations:write`, and a service
  token. Plus the *coupling* assertion the permission review owes — that review, training,
  deletion and correction each read their own constant, so a test that changes one does not
  move the others. Seeded rows, never borrowed: **CI builds the baseline plus migrations with
  no observations and no sessions**, and a test that borrows an existing row passes here and
  fails there. That happened on Phase 3.
- **R15** — `deniedObservationIds` (`mosaic-commit.repository.js:329`) learns which operation
  is asking. It is currently one function shared by all three modes and returns `[]`; a
  per-project delete rule cannot be written inside it without knowing that delete is the
  caller. One parameter, four call sites.
- **R16** — The response is substitutable for the fixture's: `{ok: true, observation,
  previous}` on success and `{ok: false, error}` on refusal, because `store.js:597` branches
  on `res.ok` alone. What `observation` carries as the corrected species' label is A4.
- **R17** — The whole correction is one transaction, and the observation row is locked `FOR
  NO KEY UPDATE` before its version is read — the same strength and the same reason as
  `lockObservations` (`mosaic-commit.repository.js:355`). One row, so no ordering rule is
  needed, but a concurrent page commit and correction must serialize or one of them records a
  decision against a classification that has already moved.
- **R18** — `npm run docs:build` is re-run and its output committed: this adds a route, and
  `docs/openapi.generated.json` and `docs/developer/` are tracked.

## Open assumptions

- [x] **A1 · scientific or data-meaning · blocking** — answered 2026-09-09: a correction *is*
  a review decision and is recorded in `observation_reviews`, not in a separate audit table.
  Consequences in D1, D2 and D5. → candidate ADR.
- [x] **A2 · database/schema · blocking** — which `purpose` does a `corrected` row carry:
  `scientific`, or a **new, non-review purpose** such as `classification`? Both need the same
  `CHECK` migration and both are made non-projectable for free by the projection's own
  `CHECK`. The difference is what `purpose` *means* and how much SQL has to change:
  `scientific` reads a correction as an act in the scientific review stream — the most
  literal reading of A1 — and requires `decision <> 'corrected'` in both the derivation's and
  Phase 5's claim CTEs; a separate purpose isolates corrections by the discriminator the
  table already has, so Phase 5's claim CTE (which filters `purpose = $2`) needs nothing, but
  it puts a non-review value into a column documented as *"Which review this decision belongs
  to"* and shares a namespace with any future third review purpose. **Recommendation:
  `purpose = 'scientific'`, `decision = 'corrected'`**, with both claim CTEs excluding it —
  because the human's answer to A1 says a correction belongs to review, and because the
  exclusion is one predicate in each of two places that a test already compares. The value
  goes into every correction row forever, which is why it is asked rather than picked.
- [x] **A3 · API contract · blocking** — is a correction version-checked, refusing a stale
  request the way Phase 5's three routes do? **Recommendation: yes, and required rather than
  optional.** Four reasons, in descending weight. (i) #68 already says so: *"MARP_API returns
  a per-observation outcome carrying success or failure, the authoritative updated value, and
  the observation version"* and *"A failed or **conflicted** change does not [show
  Changed]"* — `conflicted` is named for a correction, not just for a commit. (ii) It is
  load-bearing here rather than tidy, because a correction now **destroys other people's
  review decisions** (R9): doing that from a stale view means destroying approvals of a
  classification the corrector was not actually looking at, and the boundary it records (R7)
  would be computed from a row that has moved. (iii) Consistency — all three Phase 5 routes
  require a `version` and Phase 8's whole claim is that nothing above `api/` changes, so one
  write route with a different concurrency model is the one place the client must special-case.
  (iv) The cost is a real client change and is named as such: `setSpecies(observationId,
  speciesId)` sends no version (`data.js:790`), though `store.js:596` has the row and its
  version in hand. **The trade against it:** a correction is a fix, and refusing a fix because
  somebody else touched the row is friction the reviewer resolves by re-fetching and making
  the same correction. That re-fetch is the point, but it is a cost and it is stated.
- [x] **A4 · product/UI · blocking** — after a correction, what does the mosaic show as the
  observation's species, and what does the response carry? This falls straight out of freezing
  `comname` and appears not to have been stated anywhere yet. The mosaic row carries
  `o.comname` and no species join (`repository/mosaic.repository.js:147-163`); the species
  *filter* is `o.species_id` (#105's A4). So after a correction the two disagree: filter by the
  new species and the tile shows the old animal's name, permanently, on every reload. The
  client's own indicator only papers over it for one session — `state.changed` is in-memory
  and `store.js:598` reads `res.observation.comname` as the *new* label, which a frozen
  `comname` never becomes. **Recommendation: the response carries the corrected species'
  label from `species.comname`** (854 rows here; `gui_display_name` is an abbreviation such as
  `Greenblotched RF` and `species` is the scientific name), in a field named for what it is
  rather than reusing `comname` — so that no reader can mistake the catalogue's current label
  for the annotator's frozen one. **And the read path needs the same field**, or a reload
  undoes the display: that is a change to Phase 4's row shape, so it needs routing to this
  phase or to Phase 8 rather than being decided here.
- [ ] **A5 · behavioural · non-blocking** — how is the refused no-op of R4 reported: `400`
  with a validation message, or `{ok: false, error: 'unchanged'}`? Recommendation: `{ok:
  false, error: 'unchanged'}`, because the client already branches on `ok` alone and a `400`
  would surface as a transport failure in a path that has a perfectly good result to show.
  R4's *behaviour* — writing nothing — is a requirement either way.
- [ ] **A6 · scientific or data-meaning · non-blocking** — may a correction name a species
  that is `is_active = false`, or one whose `species_list` differs from the owning session's
  list? Recommendation: refuse an inactive entry, following
  `repository/species.repository.js:412,444,474` which filters `is_active: true` everywhere it
  offers species for annotation; **allow** an off-list one, because #68 says the chooser *"uses
  MARP's authoritative taxonomy"* and a misidentification is exactly the case where the right
  answer is on another list. Note the consequence: `taxserial` stays frozen, so after an
  off-list correction `taxserial` and `species_id` name different organisms, and a query
  joining on `taxserial` gets the pre-correction answer. That is the same auditable drift
  `comname` already carries, by the same decision, but it should be visible.
- [ ] **A7 · database/schema · non-blocking** — `previous_species_id` and
  `corrected_species_id`: `ON DELETE RESTRICT` or `SET NULL`? Recommendation: `RESTRICT`,
  matching `observation_reviews.reviewer_id`, whose migration reasons that an actor must not
  be able to vanish from a record that belongs to them; species are retired with `is_active`
  rather than deleted, so nothing is blocked in practice. `SET NULL` — which is what
  `observations.species_id` uses — would silently empty an audit row, and `observations`'
  choice is about a live value rather than a historical one.

## Answered, 2026-09-09

A1 was settled by the human directly — a species correction **is** a review decision, and
the last commit wins. A2, A3 and A4 are settled here on the recommendations; none of them
needed him, and A4 in particular is a defect found by this research rather than a choice.

- **A2 — a correction carries `purpose = 'scientific'`.** Taken as recommended, on the
  literal reading of A1: the human said a correction *is* a review decision, and the review
  stream it belongs to is the scientific one. A separate `classification` purpose would put
  a non-review value into a column documented as *"Which review this decision belongs to"*
  and would share a namespace with the third review purpose #68 reserves for an explicit
  validation mode.
  **The cost is accepted with open eyes:** `decision <> 'corrected'` has to appear in the
  derivation and in Phase 5's claim CTE, because a correction must not read as an approval
  on a tile. That is two places rather than none, and both are in the same migration this
  phase already needs for the `CHECK`. If a future purpose makes that filter list grow, the
  separate-purpose answer becomes the better one — say so then rather than pretending this
  was free.
- **A3 — a correction is version-checked, and the version is required rather than
  optional.** As recommended, and the second reason is the load-bearing one rather than
  consistency: **a correction now destroys other people's review decisions.** Doing that
  from a stale view means destroying approvals of a classification the corrector was not
  looking at, and the invalidation boundary it records would be computed from a row that has
  already moved. An absent version is a `400`, exactly as on the three commit routes — an
  optional version is the failure an optional field hides.
  #68 also already says so: it names `conflicted` as an outcome of a *correction*, not only
  of a commit.
- **A4 — the response carries the corrected species' label, and the endpoint joins
  `species` to serve it.** This is a **defect**, not a preference, and it was found rather
  than designed: `comname` is frozen deliberately (it is the only record of what the
  annotator chose), while the species *filter* is `species_id` (#105's A4). So without this,
  a reviewer filters for Ochre Star and every corrected tile shows *Bat Star* — the old
  animal's name — permanently, on every reload. The client cannot paper over it, because
  `state.changed` is in-memory for one session and `store.js:598` expects
  `res.observation.comname` to be the *new* label, which a frozen `comname` never becomes.
  **So the row gains the current species' name as its own field**, distinct from `comname`,
  and the tile draws that. `comname` stays exactly as it is and stays in the row: it is what
  makes the correction auditable, and #68's "was Bat Star" indicator is drawn from the
  difference between the two.
  **Two consequences to carry forward.** The mosaic row grows a field, which is a change to
  #105's shape and its snapshot test — moved, not loosened, the way #106 moved it for
  `version`. And this joins the list of Phase 8 client changes, because the client currently
  reads `comname` as the display name.

## Decisions

- **2026-09-09 · D1 — A correction is a decision row, and it is the vocabulary's third
  non-projectable state.** `withdrawn` is legal in the log and illegal in the projection; a
  correction joins it. That is not a workaround for A1's answer, it is what A1's answer
  implies: a correction is recorded *as* a decision, and it is not an approval, so it must
  not paint a tile. The projection's `CHECK` enforces it without being changed at all — any
  value it does not name cannot be inserted, and the constraint fails loudly rather than
  quietly. What *must* change is the derivation's final filter, from `WHERE decision <>
  'withdrawn'` to one that excludes a correction too; without it the rebuild would try to
  insert a `corrected` row and hit the projection's `CHECK`.

- **2026-09-09 · D2 — The previous and the corrected species are two columns on the log row,
  not one and not a `reason`.** Two, because after a *second* correction the observation's
  current species is no longer what the first correction changed *to*, so a single
  `previous_species_id` leaves the chain unreconstructable — and #68 requires the change to
  record *"previous classification, new classification"*. Not `reason`, because that column
  holds the reviewer-facing flag vocabulary in `varchar(64)` and putting a species *name*
  there would reintroduce the exact failure `comname` documents: a text label that goes stale
  underneath the record. A key, not a name. `previous_species_id` is legitimately null — 4%
  of rows have no `species_id` and the one row on this database is one of them — which is why
  R6 ties the `NOT NULL` to `corrected_species_id` instead.

- **2026-09-09 · D3 — "Current" gains a boundary, and everything before it is history rather
  than a claim.** This is A2's answer made concrete. Two CTEs go in front of the existing
  three; nothing else about the derivation changes, and **withdrawal semantics are untouched**:

  ```sql
  -- rebuild:begin
  WITH boundary AS (
      -- The most recent invalidating event per observation. This phase records
      -- exactly one kind, and it is a log row rather than a separate table, so
      -- the boundary cannot disagree with the audit history it is derived from.
      SELECT observation_id, MAX(observation_version) AS at_version
        FROM observation_reviews
       WHERE decision = 'corrected'
       GROUP BY observation_id
  ),
  live AS (
      -- Which decisions still count. One place, read by both claim and latest,
      -- so a claim and the decision it carries can never disagree about the
      -- round they belong to.
      SELECT r.*
        FROM observation_reviews r
        LEFT JOIN boundary b ON b.observation_id = r.observation_id
       WHERE r.decision <> 'corrected'
         AND r.observation_version > COALESCE(b.at_version, -1)
  ),
  claim   AS (SELECT … FROM live GROUP BY observation_id, purpose, reviewer_id),
  claimer AS (SELECT DISTINCT ON (observation_id, purpose) … FROM claim ORDER BY …),
  latest  AS (SELECT DISTINCT ON (r.observation_id, r.purpose) … FROM live r JOIN claimer c …)
  SELECT … FROM latest WHERE decision <> 'withdrawn'
  -- rebuild:end
  ```

  **The version arithmetic, worked through, because it is where this goes wrong.** The
  correction applies to version *v* and the trigger produces *v+1*, and the log row records
  *v* — the version it applied to, which is what the column already means everywhere else. A
  decision taken at *v* is invalidated (`v > v` is false); a decision taken at *v+1* or later
  counts, and *v+1* cannot exist before the correction created it. Two corrections record *v*
  and *v+1*, `MAX` is *v+1*, and a decision made between them falls out. An unrelated edit
  that bumps *v+1* to *v+2* moves no boundary, so a decision at *v+1* survives — which is
  #68's *"presentation-only changes … invalidate nothing"*. And a boundary at a version that
  never moved would invalidate everything and admit nothing, which is R4.

  `live` excludes `corrected` explicitly rather than relying on A2's answer, so the derivation
  is correct under either. `claim` reads `live`, so R8 falls out rather than being asserted.

- **2026-09-09 · D4 — The derivation is superseded by a new migration; migration
  `20260909120200` is not edited.** Editing an applied migration makes the file disagree with
  what ran: the ledger already records it, so `up()` never runs again, and the projection on
  every existing database would keep being maintained against a definition the file no longer
  contains. A new migration carrying the new `CURRENT_DERIVATION_SQL` and re-running the
  rebuild is honest, applies everywhere `db:migrate` runs, and is exactly what #103 planned
  for — its own header says the projection is *"separate from the migration that creates
  `observation_reviews` so that a different answer about the shape of current state replaces
  one file rather than editing two features apart."*

  The consequence for R11: two migration files then contain a `-- rebuild:` block, so "the
  definition exists once" becomes "exactly one definition is *current*, and it is the newest".
  The test should find the definition rather than hard-code a path — which is also the shape
  that survives the next redefinition.

- **2026-09-09 · D5 — What a later phase can and cannot ask, given D1 and D2.** Stated
  because #111 asks for it and because an audit shape is judged by the questions it answers.

  Answerable, and cheaply: who corrected this observation, when, from what to what, at which
  version — one index scan on `observation_reviews_observation_purpose_decided_idx`. The whole
  chain of corrections in order. Everything one person has ever done, corrections included, on
  `observation_reviews_reviewer_decided_idx`. Whether a given decision predates the current
  round, from its `observation_version` alone.

  Not answerable without new work: *"which observations were corrected and are now
  unreviewed"* as a **mosaic filter**. That is an anti-join of the log against the projection,
  not a projection lookup, so it needs its own query and probably its own index — it is not
  free the way the existing status filters are. Also not answerable: whether a *keyframe* edit
  invalidated anything. #103's fingerprint columns exist for it and nothing consumes them yet.

- **2026-09-09 · D6 — Which boundaries this phase implements, and the shape the rest arrive
  in.** #68's *Invalidation* lists four material changes. This phase implements **one**: a
  species correction. The others are named here with the shape they would take, because
  "accommodates the rest" has to mean something specific:

  - **An observation-boundary change** (start or end frame) — same shape exactly: a decision
    row with a correction-family value, a second branch in `boundary`'s `WHERE`. #68 records
    the set of triage corrections beyond species as unsettled, so this waits for that.
  - **A bounding-box keyframe added, removed or changed** — **a different shape, and this is
    the honest part.** A keyframe edit does not move `observations.version` at all (keyframes
    are their own table), so it cannot be expressed as a version boundary. #103 anticipated
    it: `reviewed_keyframe_count` and `reviewed_keyframe_max_updated_at` are recorded with
    every decision, and the predicate is a *fingerprint comparison against live keyframe
    state* — a decision counts while the observation's current fingerprint still matches the
    one it recorded. That lands as a second predicate inside `live`, not a second branch
    inside `boundary`. `live` is the extension point for both kinds; `boundary` is the
    extension point for one of them.
  - **Presentation-only changes** — invalidate nothing, and D3's arithmetic already gives that
    for free.

- **2026-09-09 · D7 — The permission review, which is the phase's negative obligation.**
  #68 wants the three operations *"not coupled in a way that prevents splitting them later."*
  Audited rather than asserted:

  **What is already uncoupled.** `routes/mosaic-commit.routes.js:60-62` declares
  `REVIEW_PERMISSION`, `TRAINING_PERMISSION` and `DELETE_PERMISSION` as three separate
  constants that happen to hold the same value, and `registerVersionedRoute` attaches
  `requirePermission` per route. So the route layer is genuinely split: swapping one is one
  line. R12 keeps that property by giving correction a fourth constant rather than reusing
  one.

  **What is coupled, and it is one thing.** `deniedObservationIds(principal, observationIds)`
  (`mosaic-commit.repository.js:329`) is the named seam for per-observation authorization —
  #68 requires it enforced per observation for a mixed-project request — and it is **one
  function shared by all three modes with no way to tell which is asking.** It returns `[]`
  today, so nothing is wrong; but a per-project delete rule cannot be expressed inside it
  without a parameter, and adding that parameter is cheaper now with three call sites than
  later with more. R15.

  **What splitting deletion off costs today**, priced against the live catalogue: a new
  permission key seeded (one row in `migrations/…-seed-resource-permissions.js`'s pattern,
  granted to nobody, so nothing breaks the day it lands); **project scope, which exists
  nowhere** — `user_permissions` has no project column, so a per-project grant is a migration
  and not a key, and `observations.project_id` is nullable, so a project-scoped rule needs an
  answer for "no project" before it can be written; the route's guard constant swapped; a real
  body for `deniedObservationIds`; and Delete Mode's gating in the client reading the new key.

  **The consequence this phase adds, and it should be visible.** Phase 5 recorded that anyone
  who can correct a species can also permanently delete. The correction route now inverts the
  interesting direction: **anyone holding `observations:write` can destroy any reviewer's
  approval, on any observation, in any project, by correcting a species** — R9 deletes
  projection rows regardless of who owns them. That is what invalidation *is*, and the log
  keeps the history, but it is a new power on an old key and the `annotation-gui` token preset
  holds that key (`scripts/create-application-token.js:47-52`). R13 is why a token cannot use
  this route; a *person* holding the key still can.

## Five incompatibilities the client will meet

Recorded the way #105 recorded its three, because Phase 8's measurable claim is that nothing
above `api/` changes and these are already known to break it. **Not fixed here** — `frontend/`
is out of scope for this phase.

1. **`setSpecies` sends no version** (`data.js:790`). R3/A3 require one. `store.js:596` has
   the row in hand, so it is a small change in a known place.
2. **The fixture rewrites `comname`, `scientific_name` and `taxserial`**
   (`data.js:802-804`). All three are frozen by #111. The fixture is not merely a stand-in
   here, it *contradicts* the rule.
3. **`store.js:598` reads `res.observation.comname` as the new label**, and with `comname`
   frozen that value never changes — so the tile's *"was X → Y"* would render `was X → X`.
   A4 is the endpoint half of this.
4. **`tile.js:94-95` falls back to `row.previous_comname`**, a field the fixture invents on
   the row (`data.js:799`) and which no real row will ever carry.
5. **The fixture's species objects key on `species_id`** (`data.js:794`) while the real
   catalogue's primary key is `species.id`. A naming mismatch in the picker's data, not in this
   endpoint, but it belongs in the same list.

## Plan

Each step small enough to verify, and the order is load-bearing at two points.

1. The migration for `observation_reviews`: two species columns, the rebuilt purpose/decision
   `CHECK`, and the `CHECK` tying `corrected_species_id` to the correction. `down` reverses
   both. `db/data-integrity.js` around it, per this repository's rule for a migration that
   touches existing data — it adds nullable columns and widens a constraint, so nothing should
   move, and the guard is what proves it.
2. The migration superseding `CURRENT_DERIVATION_SQL` (D3, D4), which **must come after step
   1**: its rebuild reads a column list and a vocabulary the first migration creates.
3. `tests/observation-review-current.test.js` moved onto the current definition and given the
   mid-log invalidation case (R11). **Before the write path**, so the test that catches a
   half-change is in place while the half-change is possible.
4. Phase 5's claim CTEs brought into line (R10), with `tests/mosaic-commit.test.js` still
   green — its concurrent-commit and first-wins cases are the ones that would notice.
5. `repository/mosaic-correction.repository.js`: the transaction — lock, version check,
   no-op check, species lookup, `species_id` update, log row, projection delete. Beside the
   other two mosaic repositories and sharing their error shapes.
6. `routes/mosaic-correction.routes.js`: the HTTP surface, its own permission constant, the
   non-user refusal, and the OpenAPI operation with request and response schemas added to
   `docs/openapi.js` beside `MosaicCommitRequest`.
7. `deniedObservationIds` gains the operation parameter (R15) and its four call sites.
8. The refusal-case and coupling tests (R14).
9. `npm run docs:build`, and `npm test` in full.

## Acceptance criteria

- A species correction changes `species_id` and nothing else on the observation; `comname`
  and `taxserial` are byte-identical afterwards, asserted rather than assumed.
- After a correction, an observation that was `reviewed` by one person is unreviewed, and **a
  different person can review it** — the case that was impossible before this phase.
- The projection equals the derivation after every step of decide → correct → decide-as-
  somebody-else, and the committed rebuild SQL reproduces it exactly.
- Phase 5's first-wins behaviour is unchanged for a race: two reviewers on one uncorrected
  observation still produce one owner and one `conflicted / claimed`.
- A stale correction is refused and writes nothing. *Conditional on A3.*
- A correction naming the current species writes nothing.
- Anonymous, under-permissioned and service-token callers are refused, and each of the four
  mosaic write routes reads its own permission constant.
- `npm test` is green in full, including `tests/jellyfin.test.js` locally, and
  `docs/openapi.generated.json` is rebuilt rather than hand-edited.

## Test plan

Filled in at G3, before anything is run, and reviewed by a human. `marp verify plan` writes
the first draft of `.marp/verification.md` from the requirements above, including the ones
with no test against them — which is the part worth looking at. Two constraints already
known, and both are recorded in R11 and R14 because they have each cost a day here: **CI
builds an empty database**, so every test seeds its own observation and session with SQL
rather than borrowing one; and **any comparison of file content against a template literal
normalises `\r\n` to `\n`**, because ECMAScript normalises CRLF inside a template literal and
`readFileSync` does not, so such a test passes in CI and fails on Windows.

## Status

- **Gate:** design
- **Notes:** A1 and the invalidation question are settled by the human, 2026-09-09, and are
  written up as D1–D6. **A2, A3 and A4 are open and blocking.** A2 and A4 are new — they were
  found by working out what A1's answer implies and what freezing `comname` implies, and
  neither had been asked before. A3 is #111's own third question: the coordinator reported it
  settled, no answer for it reached this branch, and it is not being guessed at. Nothing is
  implemented.

## Findings left alone

Named rather than fixed, per `AGENTS.md`.

- **The withdrawal lock-out survives this phase.** A reviewer who withdraws still claims the
  observation forever (`mosaic-commit.repository.js:41-46`). This phase removes correction as
  a way to reach it; a future explicit *clear my decision* gesture reaches it again. Not
  fixed, because fixing it means revising what first-wins means for a case that has nothing to
  do with correction — and D3's boundary is deliberately additive to that rule rather than a
  revision of it. If the human wants both, the change is to make a claim lapse when the
  claimant's latest decision is `withdrawn`, and it belongs in its own issue.
- **The mosaic cannot see that an observation was corrected.** By design here — a correction
  never projects — but it means there is no *filter* for corrected-and-unreviewed, and #68's
  workflow may want one. D5 prices it.
- **`repository/observation.repository.js` `updateObservation` accepts a `comname` and
  propagates it to every keyframe** (lines 690-712). It is the pre-existing annotation write
  path and the GUI depends on it, so nothing about it is wrong; but it is the one route by
  which a caller can still rewrite the annotator's frozen label, and it is worth knowing that
  #111's *"`comname` is never rewritten"* is a rule this phase honours rather than a property
  the schema enforces.
- **`observations.version` is bumped by any change to any column.** `taxReview`, a size
  count, `updateddate` — all of them move the token, so a page fetched before an unrelated
  edit gets `conflicted`. Correct but blunt, and it will read as a false conflict to a
  reviewer. Not this phase's to change.
