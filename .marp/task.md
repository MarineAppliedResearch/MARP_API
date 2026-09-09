---
task: MarineAppliedResearch/MARP_API#103
repos: [marp-api]
status: design
needs: []
---

# Phase 3 — review and training state in the schema

Design specification for MARP_API#103, the first API phase of #68 and the one phases 4, 5,
6 and 7 wait on. **Schema only.** No endpoint, no route, no repository method, no model
change beyond what a migration needs. The phase is finished when `db:migrate` is clean in
both directions on both paths and nothing else has changed.

## Goal

A reviewer's decision becomes a durable record that belongs to them: who decided what,
about which observation, for which purpose, with what reason, at what time, against which
version of the observation. Two reviewers can work over the same observations without
either overwriting the other, and an observation carries the model that produced it. None
of that is visible to anybody yet — this phase only makes it possible, and it makes it
possible without changing one byte of the scientific record that is already there.

## The basis, and what it is not

Three different bases are used below and each recommendation says which.

- **The live development database, read only** — `PostgreSQL 18.6`, `mare_v1`, 31 tables
  and 4 views, 19 rows in `SequelizeMeta`, queried through `information_schema`,
  `pg_indexes` and `pg_constraint`. This is the baseline **plus all 19 migrations**, which
  `db/baseline/schema.sql` alone is not, so it is the authority for what a column, index or
  constraint currently is.
- **The repository's files** — `db/baseline/schema.sql`, `migrations/`,
  `db/retired-migrations/`, `db/data-integrity.js`, `repository/observation.repository.js`,
  `model/observation.model.js`, and `node_modules/sequelize/lib/model.js` where the
  behaviour of the ORM is load-bearing.
- **No measurement.** The database holds **1 observation, 8 keyframes, 1 session, 854
  species, 0 ml_models, 0 dataset_observations**. One row answers "fast" to every question,
  so nothing below is benchmarked. The 440,000-row load is expected 2026-09-10. Where a
  recommendation would be improved by a number, the number to take and the value that would
  overturn the recommendation are named, exactly as #99's spec does.

This is the same agreed basis #99 was settled on, not a fallback.

## What is already true, checked rather than assumed

Read from the live database unless stated.

- `observations` has **41 columns** and exactly **two indexes**: `observations_pkey` and
  `observations_species_id_idx`. There is **no index on `session_id`, `project_id`,
  `user_id`, `confidence`, `obsID` or `updatedAt`**.
- `keyframes` has **one index**, `keyframes_pkey`. Its `observation_id` foreign key has **no
  supporting index**.
- `observations` has four foreign keys out (`project_id`, `session_id`, `user_id`,
  `species_id`) and exactly **one foreign key in**: `keyframes_observation_id_fkey`, `ON
  DELETE CASCADE`.
- **`dataset_observations.observation_id` has no foreign key** — the only constraint on that
  table is `dataset_observations_dataset_id_fkey`. It *does* already have
  `dataset_observations_observation_id_idx`, so adding the constraint needs no new index.
  This is #100.
- **Two more tables carry an unconstrained `observation_id`**: `subset_observations` and
  `subset_keyframes`, both physical tables holding copies of observation columns (see
  `db/baseline/sorce_build_star_subset.sql`). They are a second orphan path that a permanent
  delete also breaks and they are **not** in #100's scope. Named here, deliberately not
  addressed by this phase — R21.
- **Four views depend on `observations`**: `habitat_report`, `marinedebris_report`,
  `observations_report`, `substrate60second_report`. Adding a column does not disturb a
  view, and none of them reference anything this phase adds, so every `down` below can drop
  what it added. Checked through `pg_depend`.
- **`taxReview` (`varchar`) and `sizereview` (`integer`) exist and are both null on the one
  row present.** Settled 2026-09-09 (#99 A7/A9): they are the former flags for "the species
  needs checking" and "the size needs checking", they stay vestigial in *both* directions —
  nothing new writes them and nothing new reads them. **Nothing in this phase touches them,
  so the review record is purely additive.** Verified against the live schema: no
  constraint, no index, no view and no trigger references either column, and nothing in
  `repository/` writes them.
- **`observations` timestamps are quoted camelCase** (`"createdAt"`, `"updatedAt"`), while
  every table added since 2025 uses snake_case (`ml_models.created_at`,
  `dataset_observations.created_at`, `species_pictures.created_at`). New tables follow the
  newer convention — A10.
- **`observations.observation_id` is assigned by the application.**
  `repository/observation.repository.js:620` sets it to `max(observation_id) + 1`; the
  column's default is `nextval('observations_observation_id_seq')` and the sequence sits at
  `last_value 6` against a table max of 1 on this database. #62. Nothing this phase adds
  inserts an `observations` row, so nothing here meets that trap — but a new table's own
  primary key must use `autoIncrement`, the way `species_pictures` and `keyframes` do, and
  not copy the observation pattern.
- **Every observation write goes through a *static* Sequelize call.**
  `observations.update` at `repository/observation.repository.js:303`, `:339`, `:697` and
  `:739`; `observations.create` at `:631`; `observations.destroy` at `:776`. There is no
  instance `.save()` on an observation anywhere in `repository/`, `controller/`, `routes/`
  or `service/`. This matters for D5 and is checked in the ORM: Sequelize's static
  `Model.update` (`node_modules/sequelize/lib/model.js:1887`) contains **no reference to the
  version attribute at all** — optimistic-locking support lives only in instance `save`
  (`:2388`) and instance `destroy` (`:2141`). So `version: true` on the model would never
  fire on any write path that exists today.
- **Adding a column is cheap on this PostgreSQL.** Since PostgreSQL 11 a column added with
  a non-volatile default is a catalog-only change with no table rewrite. Local is 18.6, so
  `ADD COLUMN version integer NOT NULL DEFAULT 1` on a 440,000-row table is a metadata
  operation. Production's server version is not recorded anywhere in this repository — A11.
- **The migration ledger differs by database.** This one has **19 rows** (a baseline capture
  carries no `SequelizeMeta` data, then 19 migrations ran). `AGENTS.md` records existing
  databases carrying **28** — the 19 present files plus the 9 in `db/retired-migrations/`
  whose files are gone, which Sequelize tolerates. **The umbrella's `CLAUDE.md` says ten
  auth/permissions migrations have never run on production**, which cannot both be true of
  the same database. The verification plan therefore *reads* the copy's ledger instead of
  assuming a number — R19, and see *Findings left alone*.

## What must not change

Non-negotiable. Each is a change somebody will reasonably propose, and each loses
something.

- **`comname` is never rewritten, renamed or dropped.** Roughly 50,000 observations
  disagree with what their list says today because lists have been renamed and renumbered
  underneath recorded data, and `comname` is the only record of what the annotator actually
  chose. The reasoning is in `migrations/20260901120500-add-observations-species-id.js`.
- **`taxserial` stays**, for the same reason and because `species_id` is nullable — about 4%
  of observations do not resolve to a current list entry.
- **`tc`, `etc`, `timelog`, `mediaPosition`, `actualPosition` and `frame` stay exactly as
  they are.** .NET `TimeSpan` text written by the annotation GUI; a format an existing query
  can no longer parse counts as loss. `db/timecode.js` owns that arithmetic and nothing here
  re-implements it.
- **`taxReview` and `sizereview` are not touched.** Not read, not written, not migrated, not
  dropped, no default, no constraint.
- **No soft-delete marker.** #68 settled Delete Mode as a true permanent delete.
- **No `review_status` and no `training_disposition` column on `observations`.** Phase 2
  settled that a review belongs to the reviewer. This also rules out the "materialised
  column" candidate in D1 on a settled decision rather than on cost.
- **No backfill of review state.** Having no review row *is* being unreviewed, and the
  default mosaic filter is exactly that anti-join.
- **Nothing writes to production.** Every verification runs against a local disposable
  database, including the production-copy path.

## Requirements

Numbered so a test can cite one.

**The review record**

- **R1** — A reviewer's decision is stored as a row in a new append-only table, never as a
  column on `observations`. One row per decision event; a row is never updated in place and
  never deleted except by the observation's own removal.
- **R2** — Each decision row records: the observation, the reviewer's user identity, the
  review purpose, the decision, an optional reason, the timestamp, the `observations.version`
  the decision applied to, and the representative keyframe or manual-video context that
  supported it (#68, *What counts as reviewed*).
- **R3** — The decision vocabulary can express every state #68 lists: for the scientific
  purpose, accepted and flagged and a withdrawal of either; for the training purpose,
  promoted and excluded and a withdrawal of either. **Undecided is the absence of a row**,
  for both purposes, and is never written.
- **R4** — The full per-reviewer history is retained and queryable: who has reviewed an
  observation, what each of them said, and in what order. #68's later "explicit validation
  mode" must be reachable without a data migration.
- **R5** — The *current* state of an observation for a purpose is answerable by one indexed
  lookup, without walking a per-observation history and without a correlated subquery per
  row of a page. Its shape is D1.
- **R6** — The rule that decides which decision is current is written down once, in one
  place, and is the same rule the read path and the write path use. Two implementations of
  it are not acceptable — that is the class of defect #99 records as the most common in this
  application.

**Optimistic concurrency**

- **R7** — `observations` gains an integer `version`, `NOT NULL DEFAULT 1`, that changes on
  every update to an observation row **whatever code path performs it**, including the
  static bulk updates the annotation GUI drives today.
- **R8** — `version` is never assigned by a client and a client cannot set it back. What
  `version` covers, and what the review row records so #68's *Invalidation* rules can be
  evaluated later, is D6.

**Model provenance**

- **R9** — `observations` gains a nullable `ml_model_id` referencing `ml_models(id)`.
- **R10** — No value is invented for it. Nothing is backfilled, because no model has ever
  written an observation on this database (`ml_models` holds 0 rows) and there is no
  derivable link for a historical row. What a null means is D2, and whatever the answer, it
  is stated in the column comment so an outside consumer of `mare_v1` can read it from the
  database.

**Deletion provenance**

- **R11** — A new table records the deletion of an observation and **survives it**. It
  therefore carries `observation_id` as a plain integer with **no foreign key** — a
  deliberate exception, commented as one, and invisible to `db/data-integrity.js`, which
  discovers foreign keys from the catalogue.
- **R12** — It records at minimum: the deleted observation's id, the actor, the time, the
  originating model or processing run where known, the operation, an optional reason, and
  the authorization scope the actor held (#68, *Authorization*).
- **R13** — It does **not** retain the observation, its keyframes or its imagery (#68, *What
  deletion removes*).
- **R14** — Nothing in this phase deletes anything. The table is created empty and stays
  empty until Phase 7 writes to it.

**Referential integrity**

- **R15** — `dataset_observations.observation_id` gains a foreign key to
  `observations(observation_id)`. Its referential action is D3.
- **R16** — Before the constraint is added, pre-existing orphans are **counted and
  reported**, not guessed at or cleaned up. A non-zero count aborts the migration with the
  number in the message; that failure is information, per #100.

**Indexes**

- **R17** — The new tables carry the indexes their own access patterns need, created with
  the table inside the transaction. A new table is empty, so its index build is instant and
  `CONCURRENTLY` is unnecessary — the comment says so, so the next person does not "fix" it.
- **R18** — The three **missing foreign-key indexes** are added in this wave —
  `keyframes (observation_id)`, `observations (session_id)`, `observations (project_id)`.
  They are correct whatever the mosaic query turns out to be; #99 calls the first two
  "needed whatever A1 answers". They are built with `CREATE INDEX CONCURRENTLY`, in a
  migration that opens **no transaction**, with a comment saying why it breaks the
  repository's pattern. **The sort-serving composites stay out of this phase** — see
  *Judgement calls*.

**Both migration paths**

- **R19** — `db:migrate` is clean, and `db:migrate:undo` back to the pre-phase state is
  clean, on **both**: a fresh database (`scripts/init-database.js` then all migrations) and
  a **restored copy of production** in a local disposable database. The copy's
  `SequelizeMeta` is read and recorded rather than assumed, and the migrations must tolerate
  running in the same `db:migrate` pass as whatever is still pending there.
- **R20** — Every migration that changes data or constraints wraps its work in
  `guardDataIntegrity` from `db/data-integrity.js` and carries a `down` that restores what
  it changed. The one exception is the `CONCURRENTLY` index migration, which opens no
  transaction and so cannot use the guard; it also adds and removes no rows, which is why
  that is safe rather than sloppy.

**Out of scope, stated so it is not accidentally in**

- **R21** — No endpoint, no route, no repository method, no permission key. `subset_observations`
  and `subset_keyframes` are left alone. `taxReview`/`sizereview` are left alone. #76's
  `observed_at` is left alone (D4). #62 is left alone. Nothing is written to any shared or
  production database.

## Open assumptions

D1–D4 are the four #103 names. D5–D7 were found during this research and change the schema,
the migration, or what a later phase can ask, so they join them. **Every recommendation
below is a recommendation. None is settled, and nothing is implemented while any of them is
open.**

- [x] **D1 · architectural · blocking** — **What form does the derived current review state
  take?** #68 lists a materialised column, a view or a summary table and says "the query
  plan in phase 4 decides"; phase 4 needs this built, so the circularity is broken here.
  A materialised column on `observations` is **already ruled out** by Phase 2's settled
  decision that `observations` gains no `review_status`. That leaves derive-on-read versus a
  maintained projection.
  **Recommendation: a maintained projection table, `observation_review_current`, with
  primary key `(observation_id, purpose)`, written in the same transaction as the decision
  row it reflects, and shipped alongside the SQL that rebuilds it from
  `observation_reviews`.** Two decisions per observation at most — one per purpose — beside a
  440,102-row table, so it is small, and the mosaic's default filter ("unreviewed") becomes
  `NOT EXISTS` against a primary key, which is the cheapest shape available.
  **The decisive reason is correctness, not speed, which is what makes it answerable without
  phase 4's measurement.** #68's *Concurrent review* says the ordinary workflow is **first
  valid review wins** — "the first valid approval becomes the active review; the second is
  reported as already completed and does not overwrite the original reviewer or timestamp" —
  while #68's *page workflow* lets the **same** reviewer go back to a committed page and
  change what they recorded. So "current" is not "the latest row": it is *the earliest
  claiming reviewer's latest decision*. Derived on read that is a two-level query
  (`DISTINCT ON` per reviewer, then earliest reviewer among those) which no single index
  serves; as a projection it is one row with a unique key, and the first-wins rule becomes
  an `INSERT … ON CONFLICT (observation_id, purpose) DO UPDATE … WHERE
  current.reviewer_id = :me` in Phase 5 — the rule enforced by the constraint rather than
  re-derived by every reader. That also satisfies R6, which a derivation duplicated into
  each query does not.
  **What it costs to maintain:** it is a derived value, and `AGENTS.md` makes a derived
  column part of the data contract — once it exists, anything that stops maintaining it is
  data loss, not a stale cache. So it owes a committed rebuild definition and a test
  asserting projection equals derivation, and a future writer that bypasses it silently
  corrupts the mosaic's default filter. **What it costs to read:** almost nothing — a
  primary-key anti-join for the default filter, one join for the badge. It cannot be
  combined with `observations.confidence` in a single composite index, but neither can any
  candidate, and #99's materialising design already accepts a sort over the matching set.
  **What would make it the wrong choice:** if the answer to "what is current" is simply
  *last write wins* rather than first-valid-wins, the derivation collapses to one
  `DISTINCT ON (observation_id, purpose)` that an index on
  `(observation_id, purpose, decided_at DESC)` serves directly, the projection stops earning
  its keep, and a plain view is the better answer. **So D1 depends on confirming the
  first-wins reading of #68, and that confirmation is part of this question.** The number to
  take when the data lands is #99's measurement 5 — the cost of the current-state predicate
  over the matching set — with the same ~400 ms threshold on the whole query.
  **Either way the endpoint should see one name**, `observation_review_current`, so that
  swapping a view for a table later, or the reverse, does not reach Phase 4's query.

- [x] **D2 · scientific or data-meaning · blocking** — **Is a hand-entered observation a
  distinguishable "no model", or is it a null?** Carried unanswered from #68's schema audit
  and again from #99 (A8).
  **Recommendation: a plain nullable `ml_model_id`, with the column comment saying that null
  means "no model recorded" and nothing more.** The reason is that the ambiguity has a date
  rather than a shape. `ml_models` holds 0 rows and no model has ever written an observation
  here, so **every row that exists today is unattributable regardless of what column we
  add** — a backfill to "hand entered" would be a claim about the scientific record that
  cannot be checked, which `AGENTS.md` says to ask about rather than infer. For rows created
  after this migration, the discriminator is already available: a model-produced row carries
  `ml_model_id`, a hand-entered one does not, and "before or after model attribution
  existed" is answerable from `createdAt`. **The trade:** the reviewer's Model filter then
  has a "no model" bucket that mixes hand entry with model output whose link was never set,
  and if MARP ever ingests detections through a path that does not set `ml_model_id`, null
  becomes genuinely ambiguous for *new* rows too. The insurance against that is an API
  contract in Phase 7 (require the link on the worker's write path), not a column.
  **The alternative, named so it can be chosen:** a separate nullable `origin` column
  (`human` / `model` / `unknown`), added additively, **left null for every existing row**.
  It answers the question honestly for new data and costs a column. A sentinel "hand entry"
  row in `ml_models` is a third option and is not recommended — it would appear in
  `model_species`, `training_runs` and every "which model" report as a real model.

- [ ] **D3 · scientific or data-meaning · blocking** — **What referential action does
  `dataset_observations.observation_id` get?** #100 sets out `CASCADE`, `RESTRICT`, and
  neither-plus-a-tombstone. Deletion provenance is this phase's, so the choice belongs here.
  **Recommendation: `ON DELETE RESTRICT`** (with `ON UPDATE CASCADE`, matching the other
  observation foreign keys).
  **Why:** `CASCADE` deletes the only record that a training dataset ever contained that
  observation. `training_runs` references `datasets`, and `metrics_summary` references
  `training_runs`, so a published model's training-set composition would silently become
  smaller than it was — a value that becomes ambiguous, which `AGENTS.md` counts as loss even
  though the application still works. `RESTRICT` loses nothing and forbids nothing
  permanently: an observation that must go can have its membership row removed as a separate,
  deliberate, authorized curatorial act and then be deleted. It turns one silent loss into
  two explicit decisions. **The cost, plainly:** Delete Mode will refuse some rows and has to
  say why on screen. That is cheap here because #68 already requires per-observation outcomes
  and already skips ineligible rows, so the shape exists — Phase 7 adds an outcome value, not
  a mechanism. **The tombstone option buys least for the most work:** the membership row
  carries `inclusion_type`, `selection_method`, `weight` and `notes` — *why* the observation
  was chosen, nothing about *what* it was — so a tombstone keeping the id would preserve very
  little, and keeping more would contradict #68's rule that deletion provenance does not
  retain the observation.
  **The number that would change this:** the count of distinct observations in
  `dataset_observations` on production, and how much it overlaps what Delete Mode would
  target. It is 0 rows on this database. If in practice most model-detected observations end
  up in a dataset, `RESTRICT` refuses most of a Delete Mode page and the answer should be
  reconsidered.
  **Note the ordering dependency:** if the answer is `CASCADE`, the deletion provenance table
  needs a column recording which dataset memberships went with the observation, so D3 must be
  answered before that table is written.

- [x] **D4 · database/schema · blocking** — **Does #76 (`observations.observed_at`) ride in
  the same migration wave?**
  **Recommendation: no.**
  Two reasons, both from what is actually here. First, **#76 has four unanswered
  data-meaning questions** — where the authoritative datetime lives, what happens to
  sessions whose clock was never synced, who writes it, and whether a time zone is recorded
  anywhere. Folding it in puts an open blocking assumption on the critical path of the phase
  that four other phases wait on. Second, **the "two passes cost more than one" argument is
  much weaker than it looks on this server.** Adding a nullable column, or a `NOT NULL`
  column with a constant default, has been a catalog-only change since PostgreSQL 11, and
  this database is 18.6 — so the second pass costs a metadata change, not a 440,000-row
  rewrite. #76's expensive parts are the **backfill** (a `db/timecode.js` parse per row) and
  its **index**, and neither gets cheaper for sharing a migration file.
  **The trade, named:** the one real saving is a single maintenance window instead of two,
  and the middle option is to add the bare column now — nullable, no backfill, no index — and
  leave the rest to #76. **I would still not do that**, because an `observed_at` column that
  is null on every row is visible to the outside tools that query `mare_v1` and looks like an
  answer while being none — which is #76's own stated failure mode, a filter that quietly
  lies. If the human wants one window, the cheaper way to get it is to sequence #76's
  migration immediately after this phase's, not inside it.

- [x] **D5 · database/schema · blocking** — **How is `observations.version` incremented?**
  This is a schema object either way, which is why it belongs to this phase.
  **Recommendation: a `BEFORE UPDATE … FOR EACH ROW` trigger created by the same migration
  that adds the column, setting `NEW.version = OLD.version + 1` whenever any column of the
  row changes.**
  **Why it cannot be the ORM:** Sequelize's optimistic locking exists only on instance
  `save` and instance `destroy` (`node_modules/sequelize/lib/model.js:2388`, `:2141`).
  Static `Model.update` — `BULKUPDATE` — contains no reference to the version attribute at
  all (`:1887`). Every observation write in this repository is static:
  `repository/observation.repository.js:303`, `:339`, `:697`, `:739`. So `version: true` on
  the model would leave the token frozen at 1 on every write the annotation GUI performs,
  and **a concurrency token that some writers do not increment is worse than no token** —
  it makes a stale overwrite look like a successful conditional write. The alternative is to
  increment it explicitly in each write path, which is correct until somebody adds the next
  one.
  **What the trigger costs:** it is invisible to Sequelize and to anyone reading
  `model/observation.model.js`, so it needs the column comment, a comment in the migration,
  and a test that an existing static update bumps it. It fires on every write to the table
  the annotation GUI writes during a session — cheap, since it modifies a row already being
  written and `version` is not indexed, so it adds no index maintenance of its own.
  **What would make it wrong:** if the human would rather the write path be rewritten to use
  instance saves, the ORM route becomes available — but that is a change to the annotation
  GUI's hot path and is a bigger thing than this phase.

- [x] **D6 · scientific or data-meaning · blocking** — **What does `version` cover, and what
  does a review row record so #68's invalidation rules can be applied later?**
  #68 requires that a material change invalidates an active approval or exclusion, and its
  list of material changes includes **adding, removing or changing a bounding-box keyframe**.
  A `version` on the `observations` row does not move when a keyframe changes — keyframes are
  their own table — so a review row that records only `observation_version` cannot answer
  "has the annotation changed since I approved this".
  **Recommendation: keep `observations.version` meaning exactly "this observation row
  changed" — that is what optimistic concurrency needs and it is cheap and unambiguous — and
  give the review row a second, separate field describing the annotation state it approved.**
  The cheapest honest form is a pair taken at decision time: the observation's keyframe count
  and the maximum `keyframes."updatedAt"` for that observation. Any add, remove or edit moves
  one of them, which is what #68's list requires, and both are readable without a new column
  on `keyframes`.
  **The trade:** a count plus a maximum timestamp is a fingerprint, not a version — two edits
  in the same clock tick that leave the count unchanged would not be detected. A real
  annotation version would be a `version` column on `keyframes` with its own trigger, which
  is more schema and more write cost on the second-busiest table. **A different answer here
  changes the review table's columns**, which is why it is blocking rather than deferred, even
  though the table will be empty when it ships.

- [x] **D7 · database/schema · blocking** — **One review table with a `purpose`
  discriminator, or two tables?**
  #99's spec recommends **two** — `observation_reviews` and
  `observation_training_dispositions` — on the ground that scientific and training review are
  independent decisions. That is a written recommendation in a merged spec, so disagreeing
  with it needs the human rather than a quiet choice.
  **Recommendation: one table, `observation_reviews`, with a `purpose` column
  (`scientific` | `training`) and a `CHECK` that constrains the decision vocabulary per
  purpose.** Independence is a property of the *decisions*, not of the storage, and it is
  preserved by the purpose column plus the `(observation_id, purpose)` key on the projection.
  What one table buys is concrete: **Delete Mode filters and displays both status dimensions
  and is the only mode that does** (#68), and #85 settled that every mode shows every
  workflow's tags — so the common query wants both dimensions, which is one scan of one table
  and one projection instead of two of each. It also means the "current" rule of D1 is written
  once rather than twice, which is R6, and a third purpose later (#68 reserves an "explicit
  validation mode") is a value rather than a table.
  **The trade:** a shared `decision` column whose legal values depend on `purpose` needs a
  compound `CHECK` and reads slightly less cleanly than two purpose-shaped tables, and
  training-specific fields — the annotation fingerprint of D6 — sit nullable on rows where
  they do not apply. **Cheap to reverse either way while the table is empty**, which it will
  be, and that is the reason this is worth ten minutes of the human's time rather than an
  argument.

- [ ] **D8 · database/schema · non-blocking** — The reason vocabulary. #68 says the
  controlled vocabulary is not settled (`Wrong Species`, `False Detection`, `Duplicate
  Observation`, `Bounding Box Problem`, `Other/Unsure` initially). **Recommendation: a
  `varchar(64)` with no `CHECK` and no lookup table**, and the initial vocabulary recorded in
  the column comment and enforced by the API, so changing an unsettled list does not need a
  migration. Non-blocking because converting it to a foreign key later is additive against an
  empty table.

- [ ] **D9 · database/schema · non-blocking** — Naming. New tables use snake_case
  `created_at` / `updated_at` and snake_case columns, following `ml_models`,
  `dataset_observations` and `species_pictures` rather than `observations`' quoted camelCase.
  Established pattern, recorded rather than asked.

- [ ] **D10 · security/permissions · non-blocking** — No new permission keys. Phase 2 settled
  the existing model, and the live `permissions` table holds 23 keys with nothing covering
  review. The negative obligation is real though: the three operations (scientific review,
  training promotion, deletion) must stay separable, which the `purpose` column and a separate
  deletion table give for free.

- [ ] **D11 · environment · non-blocking** — Production's PostgreSQL major version is not
  recorded anywhere in this repository. The cheap-`ADD COLUMN` claim in D4 and the
  `CONCURRENTLY` plan in R18 both assume ≥ 11. To be read off the production copy when it is
  restored, not asked of production.

## Answered, 2026-09-09

Six of the seven blocking assumptions are settled. **D3 is still open** and is the only
thing holding G1 — it changes what a reviewer sees on screen, so it is the human's.

- **D1 — a maintained projection, as recommended, and the first-wins reading is
  confirmed.** The human settled it directly: **the first valid review wins.** The first
  person to approve an observation owns the record; a second reviewer is told it is already
  done and does not overwrite the original reviewer or timestamp; the *same* reviewer may
  still revise their own decision from a committed page. So "current" is *the earliest
  claiming reviewer's latest decision*, exactly as #68 reads, and
  `observation_review_current` is built with `(observation_id, purpose)` as its key.
  The consequence to honour: the rule lives in the constraint —
  `ON CONFLICT (observation_id, purpose) DO UPDATE … WHERE current.reviewer_id = :me` —
  rather than being re-derived by every reader. And because it is a derived value,
  `AGENTS.md` makes it part of the data contract: it ships with the SQL that rebuilds it
  from `observation_reviews`, and with a test asserting **projection equals derivation**.
  A future writer that bypasses the projection is data loss, not a stale cache.
- **D2 — a plain nullable `ml_model_id`, as recommended.** Decided on the reasoning that
  the ambiguity has a date rather than a shape: `ml_models` holds 0 rows and no model has
  ever written an observation here, so **every row that exists today is unattributable
  whatever column we add**, and a backfill to "hand entered" would be an unverifiable claim
  about the scientific record. The column comment says null means "no model recorded" and
  nothing more. The `origin` column stays available and additive if a real distinction is
  ever needed; the sentinel `ml_models` row stays rejected, because it would appear in
  `model_species`, `training_runs` and every "which model" report as a real model.
- **D4 — #76 does not ride in this wave, as recommended.** Two reasons, both good: #76
  carries four unanswered data-meaning questions and folding them in would put an open
  blocking assumption on the critical path of the phase four others wait on; and the
  "two passes cost more than one" argument is weak on PostgreSQL 18.6, where a column added
  with a non-volatile default is a catalog-only change. #76's cost is its backfill and its
  index, and neither gets cheaper for sharing a file. If one maintenance window is wanted,
  **sequence #76 immediately after this phase rather than inside it** — and do not add a
  bare `observed_at` that is null on every row, which is visible to the outside tools that
  query `mare_v1` and looks like an answer while being none.
- **D5 — a `BEFORE UPDATE` trigger, as recommended.** The finding behind it is decisive and
  was verified rather than assumed: Sequelize's optimistic locking exists only on instance
  `save` and instance `destroy` (`sequelize/lib/model.js:2388`, `:2141`), and static
  `Model.update` — `BULKUPDATE`, `:1887` — never references the version attribute. **Every
  observation write in this repository is static** (`repository/observation.repository.js`
  `:303`, `:339`, `:697`, `:739`), and there is no instance `.save()` on an observation
  anywhere. So `version: true` would leave the token frozen at 1 on every write the
  annotation GUI performs, and **a token that some writers do not increment is worse than
  no token** — it makes a stale overwrite look like a successful conditional write.
  The trigger's cost is that it is invisible to anyone reading the model, so it owes the
  column comment, a comment in the migration, and a test that an existing *static* update
  bumps it.
- **D6 — `version` means "this observation row changed", and the review row records the
  annotation state separately, as recommended.** A keyframe change does not move
  `observations.version`, and #68's invalidation list includes adding, removing or changing
  a bounding-box keyframe — so a review row that recorded only `observation_version` could
  not answer "has the annotation changed since I approved this". The review row therefore
  also takes the keyframe count and the maximum `keyframes."updatedAt"` at decision time.
  Recorded honestly as a **fingerprint, not a version**: two edits within one clock tick
  that leave the count unchanged would not be detected. A real annotation version means a
  `version` column and trigger on `keyframes`, which is more schema and more write cost on
  the second-busiest table, and it is not being built now.
- **D7 — one table with a `purpose` discriminator, as recommended.** The human settled it
  directly, and it **supersedes #99's spec**, which recommended two tables
  (`observation_reviews` and `observation_training_dispositions`). That recommendation is
  not wrong about the decisions being independent; it is wrong that the storage has to be.
  Independence is preserved by the `purpose` column plus `(observation_id, purpose)` on the
  projection, and one table is what the common query wants: Delete Mode filters and displays
  both dimensions, and #85 settled that every mode shows every workflow's tags. One scan
  instead of two, D1's "current" rule written once rather than twice, and a third purpose
  later — #68 reserves an explicit validation mode — is a value rather than a table.
  Cheap to reverse while the table is empty, which it will be when it ships.

## Decisions

- **2026-09-09** — The basis is the live development database read through
  `information_schema`/`pg_constraint`, plus the repository's files. **No measurement**: the
  database holds one observation. Same agreed basis as #99, not a fallback.
- **2026-09-09** — The review record is **purely additive**, resting on #99's A7/A9 answers
  and confirmed against the live schema: nothing constrains, indexes, views or triggers
  `taxReview` or `sizereview`, and nothing in `repository/` writes them.
- **2026-09-09** — Every change in this phase is additive. Nothing existing is rewritten,
  renamed, dropped, repurposed or backfilled.
- **2026-09-09** — The current-state answer is addressed by **one name**,
  `observation_review_current`, whatever D1 decides it is made of, so the implementation can
  be swapped later without reaching Phase 4's query.

## The schema this phase adds

Written against the recommendations so it can be reviewed concretely. **If D1, D3, D6 or D7
are answered differently, this section is rewritten before anything is built.**

### `observation_reviews` — the append-only decision log

| Column | Type | Notes |
| --- | --- | --- |
| `review_id` | `bigint` PK, `autoIncrement` | Its own sequence, assigned by the database. Deliberately not the `observations` pattern (#62) |
| `observation_id` | `integer NOT NULL` → `observations(observation_id)` | `ON DELETE CASCADE`, `ON UPDATE CASCADE`. Deletion is real; what survives it is `observation_deletions` |
| `purpose` | `varchar(32) NOT NULL` | `scientific` \| `training`. D7 |
| `decision` | `varchar(32) NOT NULL` | `reviewed` \| `flagged` \| `withdrawn` for `scientific`; `promoted` \| `excluded` \| `withdrawn` for `training`. Compound `CHECK` per purpose. **No `undecided`** — that is the absence of a row (R3) |
| `reason` | `varchar(64) NULL` | D8. Load-bearing, not decoration: #68 records that a flagged and a rejected tile are indistinguishable without it |
| `reviewer_id` | `integer NOT NULL` → `users(user_id)` | `ON DELETE RESTRICT`. A review belongs to its reviewer, so the actor must not be able to vanish; safe because users are retired by a status column (`migrations/20260731122000-add-deleted-status-to-users.js`) rather than deleted. Note this differs from `species_pictures.uploaded_by`, which uses `SET NULL` because an uploader is provenance rather than the record itself |
| `observation_version` | `integer NOT NULL` | The `observations.version` the decision applied to (#68: every state records the version it applied to) |
| `reviewed_keyframe_count` | `integer NULL` | D6, the annotation fingerprint |
| `reviewed_keyframe_max_updated_at` | `timestamptz NULL` | D6 |
| `representative_keyframe_id` | `integer NULL` → `keyframes(keyframe_id)` | `ON DELETE SET NULL`. Which image supported the decision (#68, *What counts as reviewed*). Null when the decision was made through the video view |
| `decided_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | D9 |

Indexes: `(observation_id, purpose, decided_at DESC)` — the history for one observation, and
the derivation that rebuilds the projection; `(reviewer_id, decided_at DESC)` — "what has
this reviewer done"; `(observation_id)` is covered by the first as a prefix.

### `observation_review_current` — the projection (D1)

Primary key `(observation_id, purpose)`. Columns mirror the active decision — `review_id`
→ `observation_reviews(review_id)`, `decision`, `reason`, `reviewer_id`,
`first_decided_at`, `decided_at`, `observation_version` — plus `observation_id` →
`observations(observation_id)` `ON DELETE CASCADE`. `first_decided_at` is what makes
first-valid-wins enforceable at write time.

Index `(purpose, decision, observation_id)` — the status filter with #68's mandatory
`observation_id` tie-break as the last column, because the tie-break is part of the ordering
and not something appended.

The rebuild SQL ships beside it, in the migration and in a test: it is R6's single
definition of "current", and it is how drift is detected rather than assumed absent.

### `observation_deletions` — deletion provenance (R11–R14)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` PK, `autoIncrement` | |
| `observation_id` | `integer NOT NULL` | **No foreign key, deliberately** — the row it names is gone. Commented, and invisible to `db/data-integrity.js` by design |
| `project_id`, `session_id` | `integer NULL` | Scope, for finding a deletion later. `ON DELETE SET NULL` where the parent still exists |
| `deleted_by` | `integer NOT NULL` → `users(user_id)` | `ON DELETE RESTRICT`, same reasoning as `reviewer_id` |
| `deleted_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `ml_model_id` | `integer NULL` → `ml_models(id)` | `ON DELETE SET NULL`. The originating model, where known |
| `operation` | `varchar(64) NOT NULL` | e.g. `mosaic-delete-mode` |
| `reason` | `varchar(255) NULL` | |
| `authorized_scope` | `varchar(64) NOT NULL` | Project-scoped or global (#68, *Authorization*) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

Index `(observation_id)` and `(deleted_at DESC)`. **Nothing about the observation's content
is stored** (R13).

### New columns on `observations`

| Column | Type | Notes |
| --- | --- | --- |
| `version` | `integer NOT NULL DEFAULT 1` | Catalog-only add on PG ≥ 11. Incremented by a trigger (D5). Not indexed — nothing filters or sorts on it |
| `ml_model_id` | `integer NULL` → `ml_models(id)` | `ON DELETE SET NULL`, `ON UPDATE CASCADE`. No backfill (R10). Comment states what null means (D2) |

An index on `ml_model_id` is **not** added here. The Model filter is Phase 4's, `ml_models`
holds 0 rows, and a column that is null on 440,102 rows is better served by a partial index
(`WHERE ml_model_id IS NOT NULL`) chosen against a real distribution than by a full btree
chosen now.

### `dataset_observations`

Add `dataset_observations_observation_id_fkey` per D3. The supporting index
`dataset_observations_observation_id_idx` already exists, so no index is added.

## The migrations, in order

Six files. Each is listed with whether it opens a transaction, because that is the thing
this repository gets wrong.

1. **`…-add-observations-version-and-model.js`** — adds `version` and `ml_model_id`, then
   creates the `BEFORE UPDATE` trigger and its function. **In a transaction**, work wrapped
   in `guardDataIntegrity` over `['observations', 'ml_models']`. `down` drops the trigger,
   the function and both columns. Nothing is backfilled, so the guard should report two
   columns added and zero rows changed — which is the point of running it here: it proves the
   claim rather than asserting it.
2. **`…-create-observation-reviews.js`** — `observation_reviews`, its `CHECK`s and its
   indexes. **In a transaction.** No guard needed for the table itself (it creates nothing
   that can lose a row), but it runs inside one so `down` is atomic. `down` drops the table;
   its indexes go with it.
3. **`…-create-observation-review-current.js`** — the projection and its index, plus the
   rebuild SQL as a comment and a `-- rebuild:` block the test reads. **In a transaction.**
   Separate from (2) so that a different answer to D1 replaces one file rather than editing
   two features into one.
4. **`…-create-observation-deletions.js`** — the provenance table and its indexes. **In a
   transaction.**
5. **`…-add-dataset-observations-observation-fk.js`** — counts orphans first and aborts with
   the count if any (R16); then `ADD CONSTRAINT … NOT VALID` followed by a separate
   `VALIDATE CONSTRAINT`, because the two-step takes only `SHARE UPDATE EXCLUSIVE` for the
   long half instead of holding `SHARE ROW EXCLUSIVE` on both tables for the whole
   validation. **In a transaction**, wrapped in `guardDataIntegrity` over
   `['dataset_observations', 'observations', 'datasets']` — this is the one migration where
   the guard has something real to protect, because it is the one that touches an existing
   table's constraints. `down` drops the constraint.
6. **`…-add-missing-foreign-key-indexes.js`** — `keyframes (observation_id)`,
   `observations (session_id)`, `observations (project_id)`, each
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. **No transaction, and that is the whole point
   of it being its own file.** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
   block, and every other migration here opens one — the repository's convention, not the
   migrator's, since `sequelize-cli` does not wrap a migration for you. Consequences to write
   into the file as comments:
   - It cannot use `guardDataIntegrity`, which needs a transaction to be able to roll back.
     It adds and removes no rows, so there is nothing for the guard to protect. Say so.
   - A failed `CONCURRENTLY` build leaves an **invalid** index behind. The migration checks
     `pg_index.indisvalid` and drops an invalid leftover before rebuilding, so a re-run after
     a failure is the fix rather than a manual clean-up.
   - `down` uses `DROP INDEX CONCURRENTLY IF EXISTS`, also outside a transaction.

**Why the order matters.** (1) before (2) and (3) because a review row records
`observations.version` and the column has to exist. (2) before (3) because the projection has
a foreign key to the log. (5) is independent and could move, but it runs after the review
tables so that a failure on the pre-existing-orphan check does not block the rest of the
phase. (6) is last because it is the only non-transactional one and the only one whose
failure mode is a leftover object rather than a rollback.

## How both paths are verified

A migration that works on one of these is not finished. Neither path touches production.

**Path A — a fresh database.** A scratch database, then `node scripts/init-database.js`
(baseline: 23 tables, 4 views), then `npx sequelize-cli db:migrate` (19 + 6). Assert: 19
ledger rows before the phase's files are visible, 25 after; the six new objects exist with
the constraints and indexes named above; `db:migrate:undo` six times returns the schema to
the byte-identical state of baseline-plus-19, compared by a structural dump rather than by
eye.

**Path B — a restored copy of production, in a local disposable database.** This is the path
that finds the real problems, because production's schema is *older* than the baseline and
its ledger names files that are gone. Steps, and what each is for:

1. Restore the copy. **Read `SequelizeMeta` and record what is actually there** rather than
   assuming 28 — #103 says 28, `AGENTS.md` says 28, and the umbrella's `CLAUDE.md` says ten
   auth/permissions migrations have never run on production, which cannot all describe one
   database. Whatever the number is, it is the fact this plan then rests on.
2. Record the pre-migration counts of `observations`, `keyframes`, `dataset_observations`,
   `datasets`, `sessions` and `projects`, and the orphan count for
   `dataset_observations.observation_id`. The last one decides whether migration (5) can
   apply at all, and #100 is explicit that a non-zero count is information rather than an
   obstacle.
3. `npx sequelize-cli db:migrate` — which on this copy runs **whatever is still pending plus
   the six**, in one pass. That is the case the phase actually has to survive, and it is not
   exercised by Path A.
4. Assert every count is unchanged, every foreign-key reference count is unchanged, and
   `taxReview`, `sizereview`, `comname`, `taxserial`, `tc`, `etc`, `mediaPosition`,
   `actualPosition` and `frame` are byte-identical before and after — a checksum over each,
   not a spot check. This is the assertion that the phase is additive, and it is the one that
   would catch the failure that matters.
5. Assert `version = 1` on every row and that an ordinary static update through the existing
   repository path moves it to 2 — the test that D5's trigger actually covers the annotation
   GUI's write path, at a tier that can see it. A unit test on the model cannot.
6. `db:migrate:undo` back through the six, then assert the same checksums again.

**What the fast tier can and cannot see.** Parse and unit tests cannot observe a trigger, a
`CHECK`, a referential action or an index — all six migrations are only observable against a
real PostgreSQL, so the tests belong in the Jest suite that runs `--runInBand` against the
development database, and the production-copy path is a human-run step recorded verbatim at
G4. A suite that skips because no copy is available **fails**; it does not pass quietly.

## What a later phase inherits, and what it still has to decide

**Inherits:** the review log and its history; one addressable name for current review state;
`observations.version` incremented on every write path including the annotation GUI's;
`ml_model_id`; deletion provenance that survives a delete; the three missing foreign-key
indexes; and a worked example of a non-transactional `CONCURRENTLY` migration in a repository
whose every other migration opens a transaction.

**Phase 4 still decides:** the mosaic query and the counts endpoint; the sort-serving
composite indexes, each justified by a plan — including `observations ("updatedAt",
observation_id)`, which defeats HOT updates on every write to `observations` and should be
added by use rather than for tidiness; whether `keyframe_count` needs anything beyond the
lateral; and whether the current-state projection is fast enough or the *persist the
ordering* escape hatch in #99's spec is needed.

**Phase 5 still decides:** the commit endpoint's per-observation outcomes and the conditional
write that makes first-valid-wins real; whether a page is one transaction; and what a
withdrawal returns.

**Phase 7 still decides:** the species-correction record; the delete path and the outcome
value D3's answer forces onto it; and whether the permission keys stay generic.

**Left alone deliberately:** #76's `observed_at` (D4); #62's primary-key assignment;
`subset_observations` and `subset_keyframes`' unconstrained `observation_id` (R21);
`taxReview` and `sizereview`.

## Plan

1. G1 gate — the human answers D1 through D7. Nothing below starts while one is open.
2. Rewrite *The schema this phase adds* and *The migrations, in order* against the answers.
3. Write migrations 1–6 in that order, running the fast tier after each.
4. Write the model definitions the new tables need — and only those; no route, no repository
   method.
5. G3 — `.marp/verification.md`, from the requirements above, before anything is run.
6. G4 — run it, both paths, and record the output verbatim including failures.

## Acceptance criteria

- `npx sequelize-cli db:migrate` and `db:migrate:undo` are clean on Path A and Path B.
- Every column, index, constraint and trigger named above exists, verified by querying
  `information_schema` and `pg_constraint` rather than by reading the migration.
- The checksums in Path B step 4 are identical before and after, and after the undo.
- A static update through `repository/observation.repository.js` increments `version`.
- `observation_reviews`, `observation_review_current` and `observation_deletions` are empty.
- No route, controller, repository method or permission key changed. `git diff --stat` shows
  migrations, models, tests and this file.

## Test plan

Filled in at G3, before anything is run. It has to name, per requirement, the tier that can
actually observe it — R7 and D5 in particular are only visible against a real PostgreSQL
through the existing static write path, and a unit test on the model would pass while the
trigger did nothing.

## Status

- **Gate:** design
- **Notes:** G1. Research complete against the live development schema (19 migrations
  applied, 1 observation) and the repository's files; no measurement, and none possible until
  the 440,000-row load lands. Seven blocking assumptions open: #103's four plus three found
  during research — how `version` is incremented (D5), what it covers for #68's invalidation
  rules (D6), and one review table or two (D7, where the recommendation disagrees with #99's
  spec and therefore needs the human). Nothing implemented.

## Findings left alone

Named per `AGENTS.md`, not fixed and not filed.

- **`subset_observations` and `subset_keyframes` carry an unconstrained `observation_id`** and
  are a second orphan path for a permanent delete. #100 covers only `dataset_observations`.
- **The production ledger count is described inconsistently** across `#103`, `AGENTS.md` and
  the umbrella's `CLAUDE.md` (28 rows versus ten migrations never having run there). Path B
  reads it instead of trusting any of the three.
- **`repository/observation.repository.js:776`, `deleteObservation`**, swallows the error and
  returns `{}`, and has unreachable `return {status: …}` code after its `return data`. Already
  documented in its own JSDoc. Phase 7 owns the delete path.
- **`observations_observation_id_seq` is at `last_value 6` against a table max of 1** on this
  database — #62's drift, visible even here.
