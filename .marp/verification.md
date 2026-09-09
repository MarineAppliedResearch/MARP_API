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

Two things this phase's verification does *not* get from the test suite, and neither is
glossed: the production-copy migration path, which is **deferred by decision** and has its
own section below, and any measurement. The database holds 1 observation, so nothing here
is benchmarked and no number below is a performance claim.

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
| R19 | Migration runs, recorded in *Results* | migration | `db:migrate` and `db:migrate:undo` clean on the existing development database, on a fresh one built from the baseline, and on one whose ledger names nine files that are gone. **The production-copy half is deferred — see *Deferred, and why*** |
| R20 | Migration output, recorded in *Results* | migration | `guardDataIntegrity` reports before and after for migrations 1 and 4; the `CONCURRENTLY` migration opens no transaction and so cannot use it, and adds no rows |
| R21 | `observation-review-schema` › *the phase is additive* (all four tests) | database | `taxReview` and `sizereview` unchanged and unreferenced; `comname`, `taxserial` and the `TimeSpan` columns still present; no `observed_at` |
| R21 | `git diff --stat`, recorded in *Results* | review | No route, controller, repository method or permission key changed |
| R22 | `dataset-observations-cascade` › all three tests | database | **The cascade removes the membership row and never a parent, in both directions**, against a real database with a dataset, an observation and a membership row seeded |

## Requirements with no test

- **R16's non-zero branch is not exercised as a test.** The migration reports 0 orphans on
  every database available here, and manufacturing an orphan would mean dropping the
  constraint the migration just added. The abort path is read in *Results* from the
  migration's own output on the zero case and from the code, not from a failing run.
- **R19's production-copy half has no automated test**, and is deferred rather than
  substituted. See *Deferred, and why*.

Every other numbered requirement has at least one row above.

## Deferred, and why

**The migration is not verified against a restored copy of production, and that is a
decision rather than an oversight.** Getting a copy needs physical access to the production
database, which means being on site, and the human has deferred it to a later sitting. It
is the one part of R19 that is outstanding, and it is outstanding on purpose.

What is run instead is a **substitute, labelled as one**, because it exercises two of the
three things the production path would and costs nothing: a scratch database built from
`db/baseline/schema.sql` whose `SequelizeMeta` is pre-seeded with the nine retired
migration names, so the ledger names files that are gone exactly as an existing database's
does, and every pending migration then runs **in one pass** rather than the phase's five
alone. That covers the ledger shape and the single-pass ordering. It covers **nothing about
production's data**, and no claim below rests on it doing so.

**Still owed, when there is a copy.** A checklist rather than a memory:

- [ ] Restore the copy into a local disposable database — `marp db up --port 5440` gives
      one that is not this workspace's. Never against production itself.
- [ ] **Read the actual `SequelizeMeta` count off it** — `SELECT COUNT(*) FROM
      "SequelizeMeta";` — and record it. Do not trust a number from this repository: #103,
      `AGENTS.md` and the umbrella's `CLAUDE.md` describe it three inconsistent ways, and
      whatever the copy returns is the fact the rest of the run rests on.
- [ ] Record the pre-migration `COUNT(*)` for `observations`, `keyframes`,
      `dataset_observations`, `datasets`, `sessions` and `projects`, plus the orphan count
      `SELECT COUNT(*) FROM dataset_observations d WHERE NOT EXISTS (SELECT 1 FROM
      observations o WHERE o.observation_id = d.observation_id);`. A non-zero orphan count
      aborts migration 4 with the number in the message; that is information, and somebody
      has to decide what those membership rows meant.
- [ ] Take the **before/after checksum** — `md5(string_agg(...))` over `comname`,
      `taxserial`, `taxReview`, `sizereview`, `tc`, `etc`, `mediaPosition`,
      `actualPosition` and `frame`. **This is the assertion that cannot be made here**: it
      is meaningless on a database with no observations in it, and it is the one that would
      catch the failure that matters — the phase turning out not to be additive on real
      data.
- [ ] `npx sequelize-cli db:migrate` — whatever is still pending plus these five, in one
      pass.
- [ ] Assert every count unchanged and every checksum identical.
- [ ] `SELECT COUNT(*) FROM observations WHERE version <> 1;` — expected 0.
- [ ] `npx sequelize-cli db:migrate:undo` five times, then assert the same checksums again.

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

One, and it is the deferred one: the production-copy migration run, whose checklist is in
*Deferred, and why* above rather than repeated here. Everything else in this verification
runs from `npm test` and the migration commands recorded in *Results*.

## Walkthrough videos

None. This phase renders nothing; there is no screen to record. A video here would narrate
a result without asserting it, which is the failure mode the doctrine names.

---

## Results

Run 2026-09-09. The plan above was committed as `f06bf78` before any of this was run;
individual test files were run as they were written, which is the G2 loop, and the full
suite and the migration paths were run afterwards.

### The suite

```
  Test Suites : 33 passed, 0 failed, 33 total
  Tests       : 269 passed, 0 failed, 0 skipped, 269 total
  Duration    : 22.1s

  Result: ALL TESTS PASSED
```

29 suites and 227 tests before this phase; the four new files add 42 tests, and
227 + 42 = 269. No suite skipped, which matters because a skipped suite looks green.

### Failures on the way, verbatim

Two, both in the projection test and both mine rather than the schema's. Recorded because
the second one is a trap worth knowing about.

**1. The marker regex matched the file's own prose.**

```
  ✗ observation_review_current (#103 D1, R6) > the definition of "current" exists once > is the same block the migration exports and runs
```

The migration's JSDoc says *"Marked with `-- rebuild:begin` / `-- rebuild:end`"*, and the
unanchored pattern `/-- rebuild:begin[\s\S]*?-- rebuild:end/` matched that sentence — a
five-word "block" — instead of the SQL. Fixed by anchoring to the start of a line.

**2. The extracted block commented out the code that followed it.**

```
  ✗ observation_review_current (#103 D1, R6) > the projection equals the derivation > agrees with the derivation through a claim, a losing claim, a revision and a withdrawal
      Error:
          at Query.run (node_modules/sequelize/src/dialects/postgres/query.js:76:25)
```

The reporter shows an empty message; run outside Jest it is
`SQL ERROR: syntax error at end of input | position 1399`. The block's last line is
`-- rebuild:end`, a SQL comment with no trailing newline, so
`SELECT * FROM (${fileBlock}) derived …` put the closing parenthesis inside the comment.
Fixed by embedding a newline after the block. The migration itself was never affected —
its constant keeps its trailing newline — which is why `db:migrate` had been clean
throughout.

### Path A — a fresh database, both directions

Scratch database `marp_phase3_a` on the local disposable PostgreSQL
(`PostgreSQL 18.6 on x86_64-windows`), built from nothing:

```
marp_phase3_a at 127.0.0.1:5432
  0 tables, 0 views, no migrations recorded
Applying db/baseline/schema.sql
Baseline in place: 23 tables, 4 views.
```

Then `npx sequelize-cli db:migrate` — 24 migrations, the 19 that were there plus this
phase's 5. This phase's five, verbatim:

```
== 20260909120000-add-observations-version-and-model: migrating =======
[observations version+model] before: observations=0 ml_models=0 | 8 foreign key(s) watched
[observations version+model] after: no rows deleted, dereferenced or orphaned
== 20260909120000-add-observations-version-and-model: migrated (0.012s)
== 20260909120100-create-observation-reviews: migrating =======
== 20260909120100-create-observation-reviews: migrated (0.006s)
== 20260909120200-create-observation-review-current: migrating =======
== 20260909120200-create-observation-review-current: migrated (0.006s)
== 20260909120300-add-dataset-observations-observation-fk: migrating =======
[dataset_observations observation fk] before: dataset_observations=0 observations=0 datasets=0 | 10 foreign key(s) watched
[dataset_observations observation fk] 0 orphaned membership row(s); adding the constraint
[dataset_observations observation fk] after: no rows deleted, dereferenced or orphaned
== 20260909120300-add-dataset-observations-observation-fk: migrated (0.014s)
== 20260909120400-add-missing-foreign-key-indexes: migrating =======
[foreign key indexes] keyframes_observation_id_idx on keyframes (observation_id)
[foreign key indexes] observations_session_id_idx on observations (session_id)
[foreign key indexes] observations_project_id_idx on observations (project_id)
== 20260909120400-add-missing-foreign-key-indexes: migrated (0.006s)
```

**The undo is compared by value, not by eye.** A second scratch database
`marp_phase3_b` was built from the same baseline and migrated with
`--to 20260901130000-seed-resource-permissions.js`, giving the exact pre-phase state —
baseline plus 19, and nothing of this phase ever applied. A structural snapshot of each
(every column with its type, nullability, default and length; every table, view, index,
constraint, trigger, function and sequence; and the ledger) was hashed:

```
marp_phase3_a  after 24 migrations   lines=882  md5=389fac2ab714b214b9eba989e00301e9
marp_phase3_b  baseline + 19         lines=811  md5=96a42216952646dca5b05a4087a33919
marp_phase3_a  after 5 undos         lines=811  md5=96a42216952646dca5b05a4087a33919
marp_phase3_a  migrated up again     lines=882  md5=389fac2ab714b214b9eba989e00301e9  (files identical)
```

So the undo lands on a database structurally indistinguishable from one this phase never
touched, and re-applying lands back on the same schema. 71 structural lines is the whole
of what the phase adds.

### The ledger-shape substitute for the production path

Labelled a substitute, and it is not the deferred production run. Scratch database
`marp_phase3_c`, baseline loaded, then the nine retired migration names inserted into
`SequelizeMeta` so the ledger names files that are gone exactly as an existing database's
does:

```
ledger rows naming files that are gone: 9 | total ledger rows now: 9
```

`npx sequelize-cli db:migrate` then ran **all 24 in one pass** — the case Path A does not
exercise, because there the phase's five run alone. Sequelize tolerated the nine phantom
names, reported them applied and looked only for files not in the ledger, and the ledger
finished with 33 rows (9 + 24). Structurally identical to `marp_phase3_a`, ledger aside:

```
C matches A structurally (ledger aside)
```

Five undos then returned it to the reference pre-phase structure:

```
C after undo matches baseline+19 structurally
```

### The development database, both directions, repeatedly

`marp_phase3_*` are scratch databases. The workspace's own database was migrated up, down
five times and up again as the work went, and finished at 24 ledger rows. After the five
undos it held no `version` column, no `ml_model_id`, no trigger, no
`observations_bump_version` function, no `observation_review%` table and only
`dataset_observations_dataset_id_fkey`, at 35 tables and views — the count it started at:

```
leftover cols: []
leftover trigger: []
leftover function: []
leftover tables: []
dso fks: dataset_observations_dataset_id_fkey
table+view count: [{"n":35}]
```

### R22 — the cascade, and the check that the check is real

```
Test: dataset_observations cascade (#103 R22) > removes the membership row but keeps the observation when a dataset is deleted ... PASS
Test: dataset_observations cascade (#103 R22) > removes the membership row but keeps the dataset when an observation is deleted ... PASS
Test: dataset_observations cascade (#103 R22) > deletes an observation that is in a dataset rather than refusing it ... PASS
```

A passing cascade test can be vacuous, so it was checked against its own absence: with the
new constraint dropped inside a rolled-back transaction, the same delete leaves the
membership row behind.

```
membership rows surviving without the constraint: 1 (orphaned)
```

That is the orphan the constraint exists to prevent, and it is what the second test would
fail on if the referential action were missing or pointed the wrong way.

### The invalid-index recovery path

`keyframes_observation_id_idx` was marked invalid in `pg_index` to imitate a failed
concurrent build, and the migration's `up` was re-run:

```
marked invalid: [{"indisvalid":false}]
[foreign key indexes] keyframes_observation_id_idx exists but is invalid, so a previous concurrent build failed. Dropping it and rebuilding.
[foreign key indexes] keyframes_observation_id_idx on keyframes (observation_id)
after re-run: [{"relname":"keyframes_observation_id_idx","indisvalid":true}]
```

Re-running after a failure is the fix, as the file claims.

### The documented surface did not change

`npm run docs:build` leaves `docs/openapi.generated.json` byte-identical: no route,
controller or registered schema changed, and neither new model is registered in
`GENERATED_SCHEMAS`. The jsdoc half of the build regenerates `docs/developer/` and touches
478 files — new pages for the five migrations, two models and four test files, plus nav
churn on every existing page and two font SVGs. That is left uncommitted deliberately; see
the judgement calls in the report. The jsdoc run also prints pre-existing parse errors in
`frontend/apps/marp-mosaic-review/src/model/schedule.js`, unrelated to this phase.

### The diff

```
 .marp/task.md                                      | 818 +++++++++++++++++++++
 .marp/verification.md                              | 167 +++++
 ...909120000-add-observations-version-and-model.js | 194 +++++
 .../20260909120100-create-observation-reviews.js   | 223 ++++++
 ...0909120200-create-observation-review-current.js | 280 +++++++
 ...0300-add-dataset-observations-observation-fk.js | 158 ++++
 ...260909120400-add-missing-foreign-key-indexes.js | 138 ++++
 model/observation_review_current.model.js          | 147 ++++
 model/observation_reviews.model.js                 | 169 +++++
 tests/dataset-observations-cascade.test.js         | 164 +++++
 tests/observation-review-current.test.js           | 470 ++++++++++++
 tests/observation-review-schema.test.js            | 366 +++++++++
 tests/observation-version.test.js                  | 143 ++++
 13 files changed, 3437 insertions(+)
```

Migrations, models, tests and these two files. No route, controller, repository method or
permission key, and nothing removed or rewritten.
