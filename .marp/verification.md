# Verification plan — MARP_API#268, YOLO training output

**Everything in this plan has now been run.** The results are first, with the plan kept
below them so a reader can see what was intended as well as what happened.

## It is verified. What ran, and what it found

The schema-load obstacle was a database **name**, not a permission: every database
`marp db up` creates carries production's, and the danger-gate refuses any command
naming it. The way through was a database of this worktree's own -- `marp db up -Port
5447 -DataDirName yolo-5447`, then `createdb marp_yolo_5447` -- which is a different
database, not a rephrasing of the refused command. `DB_*` passed inline per command, so
nothing reached disk and the `.env` deny rule did not matter.

| Ran | Result |
| --- | --- |
| **V1** baseline + 28 migrations, including this one | **pass** -- 23 tables and 4 views from the baseline, then every migration. The integrity guard reported `before: training_runs=0 metrics_summary=0 \| 9 foreign key(s) watched` and `after: no rows deleted, dereferenced or orphaned`. |
| **V2** `db:migrate:undo` | **pass** -- all four columns and the matrix table gone (`cols after undo: 0`, `matrix table after undo: 0`). |
| **V3** re-apply | **pass** -- clean, so the index names do not survive the drop. |
| **V4** `tests/final-metrics.test.js` | **pass** -- 30 of 30. |
| **V5** transpose proved red **inside** Jest | **pass** -- with the transpose removed, `1 failed, 29 skipped` in the unit suite and `1 failed, 18 skipped` in the endpoint suite. Both tiers see it. Restored: 30 of 30. |
| **V6-V15, V17-V25** `tests/training-run-yolo-output.test.js` | **pass** -- 19 of 19, after three fixture faults. |
| **V18** the curves measurement | **done**, below. |
| `npm run test:ml` | **pass** -- 18 suites, 320 tests. |
| `npm run test:gpu` | **pass** -- 19 suites, 323 tests. |
| `npm run test:subsystems` | **pass**. |

**The first execution failed 19 of 19, and all three causes were in the fixture rather
than in the code under test.** Recorded because the file had claimed, correctly, that it
had never been run: `species.taxserial` is NOT NULL with no default and there is no
`is_active` column; `model_species` needs explicit timestamps; and a PNG stub recorded as
`application/json` made the byte-serving test try to parse it -- which was the route
correctly serving the content type the hand-off had recorded. A test nobody has run is a
draft.

### Re-read against live traffic, 2026-10-27

**A fact in this record went stale within a day, which is the point of re-reading.** On
2026-10-26 no stored event had ever carried `fitness`, `duration_seconds` or a `train/*`
loss, and this document said so. Worker 0.1.6 landed in between, and three of those are
now in traffic on jobs 21782, 21785 and 21786. The fixture in `tests/final-metrics.test.js`
is re-copied from job 21786 attempt 19223, and the tripwire that asserted
`train/box_loss` was absent now asserts its value instead -- kept rather than deleted,
because a fixture agreeing with yesterday's traffic is exactly the failure this work keeps
guarding against.

Two things that re-read also settled:

- **`fitness` has still never appeared in any metric event MARP has stored**, checked
  across every training attempt rather than one payload. `OVERALL_FIELDS` maps it for the
  end-of-run report, which is a different payload, so nothing changes.
- **The offsets are a version boundary, not a gap.** Jobs 21782 and 21785 carry the
  training losses and duration with no offsets; 21786 carries all five. `epochs` mirrors
  it exactly -- run 205 has ten rows with durations and no offsets, run 206 one row with
  both. Working as intended.

**No `final_metrics` or `metrics_curves` artifact exists yet.** `artifacts` holds only
`weights` (5) and `observations` (3,053), and job 21786 succeeded on 2026-10-27 with
weights alone. So the end-of-run fixtures are still derived from the library rather than
from traffic, and V18's sizes are still synthetic. Both are owed again once a run emits
one.

### V18, measured rather than estimated

20 classes x 1,000 confidence points, which is the shape the worker described:

| | |
| --- | --- |
| artifact on the wire, 5dp, three curves | **0.46 MB** |
| `metrics_curves` rows | **20,000** |
| row data on disk | **1,719 kB** |
| insert, batched 500 | **441 ms** |
| `GET /curves` payload | **0.60 MB** |
| read and group | **748 ms** |

**That is at or below the estimate on every axis** -- the worker's 1-1.5 MB was for four
curves unrounded, and three curves at 5dp come to 0.46 MB. 20,000 rows is exactly the
figure raised as the thing to check, and 1.7 MB per run is not a storage problem. The
read is the number to watch rather than the write: 748 ms to assemble a 0.6 MB response
is fine for a panel opened deliberately and would not be fine on a dashboard that polled
it.

**One thing the measurement makes concrete:** a 90-class model would be 90,000 rows and
about 7.7 MB per run, and the read would scale with it. Nothing needs doing now; it is
the point at which paging or a per-class fetch would start to earn its place.

## The plan as written, for reference

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

**Verified at G4, 2026-10-26.** Migration applied, reversed and re-applied; 30 unit
assertions and 19 endpoint assertions green; `test:ml` 320 and `test:gpu` 323 green; the
transpose proved red inside Jest at both tiers before being restored. The curves
measurement is real rather than estimated.

**What this still does not prove**, and it is the important sentence: **no training run
has ever produced a `final_metrics` or `metrics_curves` artifact.** The worker half is
agreed and unbuilt, and its gate is Isaac. So every fixture here is built from what the
worker read out of Ultralytics 8.4.145 rather than from traffic. The two halves are built
and tested against each other's stated contract; nobody should say this works until a
real run has been through it.

The database-naming collision is unresolved as a piece of tooling: every database
`marp db up` creates carries production's own name, whatever port it is on. It did not
block this work in the end -- a separate database solved it -- but the next person to
run `marp db up` on a fresh port will meet the same gate.
