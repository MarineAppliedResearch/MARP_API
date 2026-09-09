# Verification — MarineAppliedResearch/MARP_API#103

Phase 3, review and training state in the schema. Written at G3, before the verification
run, from the requirements in `.marp/task.md`.

**The tier is the decision that matters here, and for this phase it is nearly always the
same one.** Every object this phase adds is a trigger, a `CHECK`, a referential action or
an index, and *none of those is observable from a unit test*. A test on
`model/observation.model.js` would pass while the version trigger did nothing, because
`version` is deliberately not a model attribute; a test that reads `pg_constraint` proves
what was declared, not what happens. So the tests live in the Jest suite that runs
`--runInBand` against a real PostgreSQL, and the ones that matter most perform real writes
and real deletes.

Two things this phase's verification does *not* get from the test suite, and they are in
*Manual steps* and *Known gaps* rather than glossed: the production-copy migration path,
and any measurement. The database holds 1 observation, so nothing here is benchmarked and
no number below is a performance claim.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `observation-review-schema` › *observation_reviews* › has every column / cascades / indexes | database | The decision is a row in `observation_reviews`, keyed by its own sequence, and `observations` gained no review column (see the *phase is additive* block) |
| R1 | `observation-review-schema` › *the phase is additive* › adds no soft-delete marker and no review columns | database | No `review_status`, no `training_disposition`, no soft-delete marker |
| R2 | `observation-review-schema` › *observation_reviews* › has every column the decision record needs | database | Exact column list: observation, reviewer, purpose, decision, reason, timestamp, `observation_version`, the keyframe fingerprint, and the representative keyframe |
| R3 | `observation-review-schema` › *observation_reviews* › constrains the decision vocabulary per purpose | database | The compound `CHECK` carries both purposes and all five decisions, and no `undecided` |
| R3 | `observation-review-current` › refuses a training decision recorded against the scientific purpose | database | The vocabulary is enforced, not documented: `promoted` under `scientific` is rejected by the constraint |
| R3 | `observation-review-current` › agrees with the derivation … *withdrawal* step | database | Undecided is the absence of a row: after a withdrawal there is no projection row for that purpose |
| R4 | `observation-review-current` › agrees with the derivation … final history assertion | database | Five decisions from two reviewers across two purposes are all still readable, in order, after the current state has moved three times |
| R5 | `observation-review-schema` › *observation_review_current* › is keyed on the observation and the purpose; indexes the status filter | database | Current state is one primary-key lookup, and the status filter has an index with `observation_id` as its last column |
| R6 | `observation-review-current` › *the definition of "current" exists once* (both tests) | unit + file | The `-- rebuild:` block in the committed migration is the block the module exports and runs — a second copy fails rather than drifts |
| R6 | `observation-review-current` › agrees with the derivation through a claim, a losing claim, a revision and a withdrawal | database | The write path (Phase 5's `ON CONFLICT … WHERE reviewer_id`) and the read-side derivation agree after **every** decision, not just at the end |
| R6 | `observation-review-current` › is reproduced exactly by the committed rebuild SQL | database | Throwing the projection away and rebuilding it from the log lands on the same rows |
| R7 | `observation-version` › is incremented by a static update through the repository | database | `repository/observation.repository.js`'s static `Model.update` — the annotation GUI's own path — moves `version`. This is the assertion a unit test cannot make |
| R7 | `observation-version` › starts at 1 on a newly inserted observation | database | `NOT NULL DEFAULT 1` |
| R7 | `observation-review-schema` › is maintained by a BEFORE UPDATE row trigger | database | The trigger exists, is `BEFORE UPDATE … FOR EACH ROW`, and calls the function |
| R8 | `observation-version` › overwrites a version supplied by the writer with `OLD.version + 1` | database | A writer cannot set the token forward to fake a conditional write or back to hide one |
| R8 | `observation-version` › is not a Sequelize model attribute | unit | Nothing can assign it through the ORM, and a later "tidy-up" that adds it to the model fails here first |
| R9 | `observation-review-schema` › *observations.ml_model_id* › is a nullable integer; references ml_models | database | Nullable `integer` with `ON DELETE SET NULL`, `ON UPDATE CASCADE` to `ml_models(id)` |
| R10 | `observation-review-schema` › carries a comment saying what null means | database | The meaning of null is readable from the database itself by an outside consumer of `mare_v1`, not only from this repository |
| R11–R14 | — | — | **Withdrawn.** There is no deletion provenance table. `observation-review-schema` › creates no deletion provenance table asserts the absence |
| R15 | `observation-review-schema` › *dataset_observations* › has a validated foreign key to observations that cascades | database | The constraint exists, references `observations(observation_id)`, and `convalidated` is true — a `NOT VALID` left behind would mean existing rows are unenforced |
| R16 | Migration output, recorded in *Results* | migration | The orphan count is reported before the constraint is added; a non-zero count aborts with the number in the message |
| R17 | `observation-review-schema` › indexes the history for one observation and the work of one reviewer; indexes the status filter | database | Both new tables carry exactly the indexes named in the spec and nothing else |
| R18 | `observation-review-schema` › *the three missing foreign-key indexes* › each exists and is valid | database | All three exist, are on the right table and column, and `indisvalid` is true |
| R19 | Migration runs, recorded in *Results* | migration | `db:migrate` and `db:migrate:undo` clean on the existing development database and on a fresh one built from the baseline. **Path B is a manual step and a known gap** |
| R20 | Migration output, recorded in *Results* | migration | `guardDataIntegrity` reports before and after for migrations 1 and 4; the `CONCURRENTLY` migration opens no transaction and so cannot use it, and adds no rows |
| R21 | `observation-review-schema` › *the phase is additive* (all four tests) | database | `taxReview` and `sizereview` unchanged and unreferenced; `comname`, `taxserial` and the `TimeSpan` columns still present; no `observed_at` |
| R21 | `git diff --stat`, recorded in *Results* | review | No route, controller, repository method or permission key changed |
| R22 | `dataset-observations-cascade` › all three tests | database | **The cascade removes the membership row and never a parent, in both directions**, against a real database with a dataset, an observation and a membership row seeded |

## Requirements with no test

- **R16's non-zero branch is not exercised as a test.** The migration reports 0 orphans on
  every database available here, and manufacturing an orphan would mean dropping the
  constraint the migration just added. The abort path is read in *Results* from the
  migration's own output on the zero case and from the code, not from a failing run.
- **R19's Path B has no automated test**, by necessity. See *Manual steps*.

Every other numbered requirement has at least one row above.

## Edge cases

- **A no-op update must not inflate `version`.** The trigger carries
  `WHEN (OLD.* IS DISTINCT FROM NEW.*)`, so `SET count = count` leaves the token alone.
  Tested. Traces to what the token is *for*: an inflated version invalidates a review that
  nothing actually changed, which is #68's invalidation rule firing on nothing.
- **A writer that supplies `version` itself.** Tested with raw SQL rather than the ORM,
  because `version` is not a model attribute and Sequelize would silently drop it — so the
  ORM cannot express this case and the tier that can is the database.
- **A second reviewer deciding later.** The losing claim is the case first-valid-wins
  exists for, and the assertion is that neither `reviewer_id` nor `first_decided_at` moves
  while the log keeps both decisions.
- **The same reviewer revising from a committed page.** `decision` and `decided_at` move,
  `first_decided_at` does not.
- **A withdrawal, then the projection.** The projection row is deleted, and a `CHECK`
  refuses `withdrawn` in the projection so a future writer cannot park one there. Traces
  to the default mosaic filter: a withdrawn row left in place would hide the observation
  from "unreviewed" forever.
- **Both purposes on one observation at once.** Asserted, because the whole argument for
  one table with a discriminator is that the common query wants both dimensions.
- **An invalid index left by a failed `CONCURRENTLY` build.** Proved by marking a real
  index invalid in `pg_index` and re-running the migration's `up`, recorded in *Results*.
  Traces to `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, which would otherwise skip an
  invalid index forever — maintained on every write and used by nothing.
- **A cascade test that is vacuous.** Checked by dropping the new constraint inside a
  rolled-back transaction and confirming the membership row survives as an orphan without
  it, recorded in *Results*. A test that would pass either way proves nothing.

## Regression coverage

Nothing in this phase is a fix for a defect, so there is no regression suite. Two tests
are written to fail if a plausible future "tidy-up" happens, which is the same idea
pointed forwards:

- `observation-version` › *is not a Sequelize model attribute* fails if somebody adds
  `version` to `model/observation.model.js`, which would let a client assign it.
- `observation-review-current` › *is the same block the migration exports and runs* fails
  if the definition of "current" is copied anywhere.

## Known gaps

Stated plainly, so each is a decision rather than a surprise.

- **Path B — a restored copy of production — is not verified.** No copy of production is
  reachable from this workspace, and nothing may be run against production itself. The
  closest available substitute is run instead and reported as a substitute: a scratch
  database built from `db/baseline/schema.sql` whose `SequelizeMeta` is pre-seeded with
  the nine retired migration names, so the ledger names files that are gone exactly as an
  existing database's does, and all pending migrations then run **in one pass**. That
  exercises the ledger shape and the single-pass ordering. It does **not** exercise
  production's data: the checksum comparison over `comname`, `taxserial`, `taxReview`,
  `sizereview` and the `TimeSpan` columns before and after is meaningless on a database
  with no observations in it, and is therefore **not** claimed.
- **D11 — production's PostgreSQL major version is still unrecorded.** The
  catalog-only-`ADD COLUMN` claim and the `CONCURRENTLY` plan both assume ≥ 11. Local is
  18.6, verified. To be read off the copy when there is one.
- **No measurement of anything.** 1 observation. Every index here is justified by being a
  foreign key with nothing behind it, not by a plan.
- **The annotation fingerprint is a fingerprint, not a version.** Two keyframe edits
  within one clock tick that leave the count unchanged are not detectable. Recorded in the
  column comments; a real annotation version means a `version` column and trigger on
  `keyframes`.
- **Nothing enforces append-only on `observation_reviews`.** An `UPDATE` or `DELETE`
  against it would succeed. The spec does not ask for a rule or trigger, and no code
  writes the table yet; Phase 5 owns the write path.
- **Nothing yet maintains the projection.** Phase 5 does. The rebuild SQL and the
  equality test are what will catch a writer that bypasses it; today the table is empty
  and its correctness is asserted through the upsert the test performs on Phase 5's
  behalf.

## Manual steps

**Path B, for whoever has a production copy.** Never against production itself.

1. Restore the copy into a local disposable database. `marp db up --port 5440` gives you
   one that is not the workspace's.
2. `SELECT COUNT(*) FROM "SequelizeMeta";` and record the number. **Do not assume it.**
   #103, `AGENTS.md` and the umbrella's `CLAUDE.md` describe it three inconsistent ways,
   and whatever this returns is the fact the rest of the run rests on.
3. Record `COUNT(*)` for `observations`, `keyframes`, `dataset_observations`, `datasets`,
   `sessions` and `projects`, and the orphan count:
   `SELECT COUNT(*) FROM dataset_observations d WHERE NOT EXISTS (SELECT 1 FROM observations o WHERE o.observation_id = d.observation_id);`
   A non-zero orphan count aborts migration 4 with the number in the message. That is
   information: somebody has to decide what those membership rows meant.
4. `npx sequelize-cli db:migrate` — whatever is still pending plus these five, in one
   pass. Expected: clean, with the two `[integrity]` before/after lines and the
   `0 orphaned membership row(s)` line.
5. Assert every count from step 3 is unchanged, and that `md5(string_agg(...))` over
   `comname`, `taxserial`, `taxReview`, `sizereview`, `tc`, `etc`, `mediaPosition`,
   `actualPosition` and `frame` is byte-identical before and after. This is the assertion
   that the phase is additive on real data, and it is the one that would catch the failure
   that matters.
6. `SELECT COUNT(*) FROM observations WHERE version <> 1;` — expected 0.
7. `npx sequelize-cli db:migrate:undo` five times, then assert the same checksums again.

## Walkthrough videos

None. This phase renders nothing; there is no screen to record. A video here would narrate
a result without asserting it, which is the failure mode the doctrine names.

---

## Results

<!-- Appended after the plan above was committed. Real output, including failures, verbatim. -->
