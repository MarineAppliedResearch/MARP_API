# Verification plan — MARP_API#268, YOLO training output

**The plan, for review before it is run.** What has already been run is marked as such
and separated, because most of it has not been.

## The limit that shapes this whole document

**There is a database, and nothing can be loaded into it.** `marp db up --port 5447`
worked and that port is this worktree's. Two things then stopped it being usable, and
neither was worked around:

- `.env` cannot be written here — it is covered by a Read deny rule in this session's
  permissions. Not a problem on its own: real environment variables take precedence over
  dotenv, so `DB_*` can be passed per command and no credential reaches disk.
- **The danger-gate refuses every command containing `mare_v1`**, which is what
  `marp db up` names every database it creates, on any port. So `init-database.js` is
  refused against an empty database on 5447 exactly as it would be against production on
  5432. The gate is right to match and cannot see the difference; the fix is to teach it
  host and port, or to have `db up --port` name a non-default database something else.
  That is shared tooling and the decision sits with Isaac. The hook says explicitly not
  to look for another phrasing, so nothing was attempted, and it was not routed through
  another session either.

So: no schema is loaded, no migration has run anywhere, and **not one test in this branch
has been executed by Jest** — every suite here connects during per-file setup.

Nothing below should be read as passing. Where evidence exists it is named; where it does
not, that is said.

## What has actually been run, and what it proves

| Run | Result | What it does *not* prove |
| --- | --- | --- |
| `db/final-metrics.js` exercised outside Jest, 52 assertions across four files | **52 passed, 0 failed** | Not the Jest suite. No database, no route, no ingest. |
| The same, with the transpose deliberately removed | **24 passed, 2 failed** — the two transpose assertions, and only those | That the other 24 are tripwires. Only the transpose was mutation-checked. |
| `npm run test:subsystems` | **ok — every suite belongs to exactly one subsystem** | Nothing about the tests themselves. |
| Model layer loaded against a dead port | New model registered, `training_runs.confusion_matrices` associated, `metrics_summary` carries both new columns | That the migration runs. The model is a declaration; the table does not exist anywhere. |
| `app.js` built against a dead port | Builds with the three new routes | That any route answers. Nothing was requested. |
| `npm run docs:api:build` | Three paths at `/v2/training_run/{id}/…`, `TrainingRunConfusionMatrix` resolves, `MetricsSummary` documents both new columns | Nothing about behaviour. |

`npx jest tests/final-metrics.test.js` was attempted and failed at `globalSetup`:
*"Refusing to run the test suite against a database that is not local."* The guard is
correct and was **not** disabled — `MARP_TEST_ALLOW_REMOTE_DB` was deliberately left
alone. Pointing `DB_*` at a dead local port satisfied the guard truthfully and the suite
then failed 17/17 on connection errors from the per-file fixture, which is what made it
clear no Jest test can run here at all.

## What must be run once there is a database

### The migration, both ways

- **V1** `npx sequelize-cli db:migrate` applies `20261026160000` against a database built
  from the baseline plus migrations. Proves the two columns, the table, both indexes and
  the integrity guard's own output.
- **V2** `db:migrate:undo` returns the schema to what it was. A `down` that does not is
  a migration that cannot be backed out of a shared database.
- **V3** Re-run `up` after the undo. An index name that survives a drop fails here.

### The reader, through Jest rather than beside it (R3, R4, R5, R6, R8)

- **V4** `npx jest tests/final-metrics.test.js` — the 17 assertions already written.
  They currently have *no* Jest evidence at all.
- **V5** Prove the transpose red inside Jest, by name, the way the harness asks:
  `npx jest tests/final-metrics.test.js -t 'transposes to rows-are-true when serving'`
  against a mutated module. Done outside Jest already; not yet inside it.

### The ingest (R1, R6, R7)

Not yet written. This is the gap in the plan and it is the biggest one.

- **V6** A `final_metrics` artifact on disk, named in a result, produces the expected
  `metrics_summary` rows and one matrix row. Asserted against the rows, not against the
  service's return value — a service that reports what it meant to write rather than
  what landed is how five of seven epoch columns were empty for months.
- **V7** The same result reported **twice** leaves the same row count. The replace is
  the claim; a duplicate per class is the failure it prevents.
- **V8** A malformed report leaves the attempt `succeeded` and the job unwithdrawn, and
  returns `failed` in its answer. This is the deliberate difference from the observation
  ingest and nothing currently proves it.
- **V9** A class name that resolves to two species lands with `species_id` null and
  `class_name` set — not dropped, not guessed at.
- **V10** A training attempt that hands over no `final_metrics` writes nothing and is
  not an error.

### The curves (R9)

- **V17** A `metrics_curves` artifact produces `classes × confidence` rows, each holding
  precision, recall and F1 at one threshold — not three rows per threshold.
- **V18** **The measurement the managing session asked for: the real row count and byte
  size for a run.** The estimate is 20 classes × 1,000 points = 20,000 rows and 1–1.5 MB
  of JSON. If the measurement is far worse, that is Isaac's call and the work stops
  there rather than continuing on the estimate.
- **V19** A curve one point shorter than the confidence axis stores nothing for that
  family. Proven red by shortening a fixture, since a shifted curve is subtly wrong
  rather than visibly broken.
- **V20** A curves artifact whose `split` disagrees with the report's stores nothing.
- **V21** A class with no `metrics_summary` row gets no curve — structural, because
  `metrics_summary_id` is NOT NULL, so this test is guarding the structure rather than
  a rule.
- **V22** `metrics_curves.support` is null on every row written — the count lives on the
  class's `metrics_summary` row, where its grain is right.
- **V24** `support` and `image_count` land on the per-class row, and stay null where the
  trainer reported none. "No instances" and "not counted" are different facts.
- **V25** A curve that is flat zero across every threshold is **stored**, not refused.
  The general rule here is that a gap must not read as a zero; this is the converse, and
  it is the one case where discarding would lose the record of a class the model missed
  completely.
- **V23** `GET /v2/training_run/:id/curves` returns index-aligned parallel arrays, and
  an empty array for a run whose worker sent no curves.

### The routes (R2, R6)

- **V11** `GET /v2/training_run/:id/metrics` on a run with nothing returns empty arrays
  and **200, not 404**.
- **V12** The same on a run with data returns rows whose nulls are still null. Assert on
  a null specifically; a snapshot would pass with zeros in it.
- **V13** `GET /v2/training_run/:id/artifacts` lists a file whose stem the code has never
  seen, under that stem. **This is the acceptance criterion for the open set** and a test
  that only uses known stems cannot see it fail.
- **V14** `GET /v2/training_run/:id/artifacts/:hash` serves the bytes, and refuses a hash
  belonging to a different run with 404.
- **V15** All four refuse an anonymous request with 401, like every route here.

### The corpus guard

- **V16** Every new suite leaves the database as it found it. `corpus-guard.js` enforces
  this and will fail the file otherwise; it is listed because a test that seeds
  `metrics_summary` is writing to a table that has never had a row, and nothing has ever
  had to clean it up before.

## What is deliberately not covered, and why

- **A real training run.** Nothing in MARP has ever produced a `final_metrics` artifact —
  the worker half is designed and agreed but unbuilt, and it is Isaac's gate. So **the
  report fixture is a contract, not an observation.** It is built from what the worker
  session read out of Ultralytics 8.4.145 rather than from stored traffic, and that is
  the weakest evidence in this work. The first real run is what confirms the field names,
  and until then this is the exact failure mode that has already bitten this stream twice.
  The per-epoch fixture *is* from stored rows, including the `child_kind` field no
  document mentions, as a standing reminder of the difference.
- **Ultralytics' own PR curve**, the one interpolating precision onto a fixed *recall*
  grid. Not stored, because `metrics_curves.confidence_threshold` is NOT NULL and means
  confidence; a recall value in it would make the table unreadable without knowing which
  curve each row came from. A PR curve is drawn by plotting the stored precision against
  the stored recall, which is two measurements against each other rather than a
  derivation, and the trainer's rendering is kept as an image besides.
- **`metrics_curves.support`.** A per-class count, not a per-threshold one. Left null
  rather than repeated a thousand times down a column that would then state something
  nobody measured.
- **The dashboard's rendering.** Another session's, built against this shape already.
- **Any backfill.** There is none and there cannot be one: the run directory is deleted
  once MARP holds the result.

## Status

Written at G3 and **not yet reviewed**. V6–V15 and V17–V25 are now written, in
`tests/training-run-yolo-output.test.js` — and **none of V1–V25 has been run**, because
the schema cannot be loaded. That file has never been executed by anything. Whoever runs
it first should expect to fix something, and should treat a green run as the first real
evidence rather than as a confirmation of anything claimed here.
