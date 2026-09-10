---
task: MarineAppliedResearch/marp-inference-worker#3
status: verified
---

## What is being verified

That a finished GPU inference job's result file becomes observations and keyframes in the
annotation record, in the shape the annotation GUI writes, with the provenance that makes
them attributable — and that every way it can go wrong writes nothing at all.

## The tier, and why

`tests/gpu-observation-ingest.test.js`, at the **HTTP tier, through the real worker flow**:
submit, poll to lease, hand the artifact over by hash, report a terminal result. Not at the
service tier.

That choice is the whole point of the file. The requirement is that ingest happens *without
anybody asking for it* (R13), and a service-level test would pass while nothing at all ran
when a worker reported success. That is the failure this platform keeps finding — verifying
at a tier that structurally cannot observe the thing being claimed — and it is exactly the
shape it would take here.

The database is the real one, built from the baseline plus the migrations, and the suite
seeds everything it needs: a project, an `Invert` session, a `Fish` session, a model and its
`model_species` rows. Nothing depends on rows the development machine happens to hold, so
the block cannot pass vacuously in CI where there are no observations.

## Which test proves which requirement

| Requirement | Test |
| --- | --- |
| R1 one observation per track, its keyframes | *writes one observation per finished track, with its keyframes, without being asked*; *passes keyframe geometry through untouched* |
| R2 a zero-byte artifact is a valid outcome | *ingests zero observations from an empty result file without erroring* |
| R3 name resolves to a species; ambiguity settled by the model; unresolvable fails loudly | *lets the model's trained-species list settle a name two species rows carry*; *fails the whole ingest on a name MARP does not know* |
| R4 the job carries its session, in exactly one form | *creates the session from project, dive, line and type*; *reuses that session on a second job*; *refuses a session naming both an id and a dive*; *refuses a session described without all four* |
| R5 session type checked against the model | *refuses an inverts model's output written into a Fish session* |
| R6 `ml_model_id` on every row, named at submit | *writes one observation per finished track…*; *refuses a session without a model* |
| R7 timecodes derived through `db/timecode.js` | *writes derived columns a resync can reproduce* |
| R8 the derivation is checked against the worker | *refuses a result whose own timecode disagrees with 25 fps*; *refuses a result whose sub-second frame index disagrees with its absolute frame* |
| R9 `confidence` is contract-required, may be null | *writes one observation per finished track…* (asserts all six values, one of them null); *refuses a result row with no confidence key at all*; *refuses a score outside zero to one* |
| R10 geometry passed through unaltered | *passes keyframe geometry through untouched, including a box wider than the frame* |
| R11 keys assigned the house way | *writes one observation per finished track…* (three consecutive series); *gives every observation its own key when two writes overlap*, with its negative control |
| R12 idempotent per job; a re-run is a new set | *writes one set of observations, however many times it is asked*; *gives a re-run its own set* |
| R13 runs automatically on a published success | every test that asserts `reported.body.ingest`, which is the answer to the worker's own result call |
| R14 a failure is loud and recoverable | *records the failure as a coordinator note*; the on-request route is what every `/ingest` call in the file exercises |
| R15 `gpu_job_id` and `jellyfin_item_id` | *writes one observation per finished track…* |
| R16 the migration is guarded and reversible | run by hand, below. Not covered by a test. |
| R17 generated documentation rebuilt | `npm run docs:build`, below. Not covered by a test. |

## The fixture, and what is honest about it

`tests/fixtures/gpu-observations-job-1256.jsonl` is the **real** result file from job 1256 —
six real California sea cucumbers, 78 real keyframes, real bounding boxes, the real Jellyfin
item id — with one key added per observation.

**The `confidence` values are hand-added.** The worker change that emits `confidence` is on
`3-observation-confidence` in `marp-inference-worker`, not on its `develop` and not pushed,
so every result file that exists today lacks the field. One of the six is `null`, which is
the real case: the reduction can choose a frame the tracker predicted through with no
detection behind it.

This is stated rather than hidden because a fixture drifting from a contract has already
cost this pair real time twice. It is also why *refuses a result row with no confidence key
at all* exists: the contract is that the key is always present, and the only thing standing
between that and a column quietly filling with nulls nobody chose is that assertion.

## Results, as run

`npx jest tests/gpu-observation-ingest.test.js --runInBand --forceExit`:

```
  Test Suites : 1 passed, 0 failed, 1 total
  Tests       : 26 passed, 0 failed, 0 skipped, 26 total
  Duration    : 7.9s
```

The four neighbouring GPU suites, which the changes to `gpu.service.js` and the job spec
could have broken:

```
  Test Suites : 4 passed, 0 failed, 4 total
  Tests       : 58 passed, 0 failed, 0 skipped, 58 total
  Duration    : 24.1s
```

`npm test`, the whole suite:

```
  Test Suites : 41 passed, 0 failed, 41 total
  Tests       : 463 passed, 0 failed, 0 skipped, 463 total
  Duration    : 194.7s
```

437 of those 463 predate this branch. **The 285 figure in the retired spec is stale** —
`develop` has moved a long way since, mostly the mosaic work.

The migration, up and down and up again:

```
== 20260909120500-record-which-job-wrote-an-observation: migrating =======
[observations gpu_job_id+jellyfin_item_id] before: observations=0 gpu_jobs=16 | 13 foreign key(s) watched
[observations gpu_job_id+jellyfin_item_id] after: no rows deleted, dereferenced or orphaned
== 20260909120500-record-which-job-wrote-an-observation: migrated (0.128s)
== 20260909120500-record-which-job-wrote-an-observation: reverting =======
== 20260909120500-record-which-job-wrote-an-observation: reverted (0.021s)
== 20260909120500-record-which-job-wrote-an-observation: migrating =======
== 20260909120500-record-which-job-wrote-an-observation: migrated (0.113s)
```

`npm run docs:build` completed. Its four `ERROR: Unable to parse a tag's type expression`
lines are pre-existing and come from `frontend/apps/marp-mosaic-review/src/model/schedule.js`,
not from anything on this branch.

`node ../scripts/harness/spec-check.mjs .` reports clear to implement: four assumptions
answered, four open and non-blocking, seventeen numbered requirements.

## What is NOT covered

Named rather than left to be discovered:

- **No real worker, no real GPU, no real Jellyfin.** A real result file is replayed through
  the real routes, which is a strong test of MARP's half and no test at all of the worker's.
  The end-to-end claim needs a live run.
- **No real `confidence` from a worker.** Until a job runs with the worker change, nothing
  proves the two sides agree about that key. This is the single most likely place for the
  two repositories to disagree, and it is untested by construction.
- **Concurrent ingest is covered, but only at the repository tier.** *gives every
  observation its own key when two writes overlap* races two `writeJobObservations` calls,
  and its negative control shows that two overlapping transactions reading
  `max(observation_id) + 1` without the lock really do agree on the next key — so the
  passing test cannot quietly stop testing anything. What is *not* covered is two real
  workers reporting within the same second, which is the way it will actually happen.
- **A video that is not 25 fps.** R8's guard is proven by fabricating a disagreeing `tc`,
  not by a real recording at another frame rate. What is proven is that the guard fires;
  what is not proven is that a real non-25 fps video makes it fire.
- **A split video across more than one session.** A16 left that open deliberately. A batch's
  pieces each carry the same `spec.session`, so today they all land in one session; nothing
  tests what should happen if they should not.
- **`observations.version` moving on an ingested row.** `tests/observation-version.test.js`
  covers the trigger; ingest only inserts, so the token starts at 1 and nothing here moves it.
- **The mosaic reviewer reading these rows.** They are ordinary observations with an
  `ml_model_id` and a `confidence`, which is what its Model and Confidence filters already
  read, but no test crosses that boundary.
