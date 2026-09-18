---
task: MarineAppliedResearch/MARP_API#197
repos: [MARP_API, marp-inference-worker]
ran: 2026-09-17
---

## What this covers

Every requirement in `.marp/task.md`, at two tiers: the jest suite, and a live run against
two real GPU workers on two machines and two networks. The live half is here because this
defect could not have been found without a second machine, and a fix for it that had only
ever been seen in a test would be repeating the mistake that produced it.

**Not covered, and deliberately:** ingest of a resumed job's second segment into real
observations. Every job run here was submitted without `spec.session`, so nothing reached
the corpus. Proving R6 end to end means writing test inference into the annotation record,
and that is the human's decision rather than something to slip in behind a verification.
The mechanism is covered at the unit level and by the artifact filtering below; what is not
proven is a second volunteer's observations actually landing.

## R1, R2 — `yielded` is accepted and recorded as itself

`npx jest tests/gpu-orchestration.test.js` — 12 new tests in `GPU attempt yielded`.

```
GPU attempt yielded > accepts yielded as an outcome rather than refusing it            PASS
GPU attempt yielded > records the attempt as yielded, distinguishable from a cancel    PASS
```

And live, on worker 48, using the worker's **unmodified** code — the same code that was
being answered 400 an hour earlier. A 3000-frame mock job stopped at ~frame 300 through
`POST /status/control {"action":"stop"}`:

```
attempt 2723  w48  yielded   completed_through_frame 400   progress_done 400
```

## R3 — how far the worker got is stored

```
GPU attempt yielded > stores how far the worker got                                    PASS
```

`completed_through_frame` is an **exclusive** bound, despite the name: the worker computes
`start_frame + frames_processed`, one past the last frame it finished, which is the same
half-open convention as `spec.range.end_frame`. It is therefore already the next
`start_frame` and is used unmodified. Adding one "to be safe" would skip a frame on every
hand-over and nothing would report it. Written into the code at the point of use.

## R4 — a yielded job goes back to the pool, and resumes where it stopped

```
GPU attempt yielded > returns the job to the queue rather than cancelling it           PASS
GPU attempt yielded > hands the next worker a lease that starts where the last stopped PASS
GPU attempt yielded > does not rewrite the stored spec when it resumes                 PASS
GPU attempt yielded > never moves the resume point backwards                           PASS
```

The lease test asserts the range tiles exactly — `40..100` after a yield at 40 over a
`0..100` job — so no frame is processed twice and none is skipped.

Live, job 3105, the complete lifecycle across two attempts:

```
job 3105 succeeded
  attempt 2723  w48  yielded    400/3000    range 0..3000
  attempt 2724  w48  succeeded  2600/2600   range 400..3000
```

2600 = 3000 - 400. The resumed lease started at 400 exactly.

## R5 — a yield does not spend the attempt budget

```
GPU attempt yielded > does not spend the job's attempt budget                          PASS
GPU attempt yielded > stays claimable after being yielded more times than max_attempts PASS
```

The second drives four yields against a `max_attempts: 2` job and then polls again,
because the property that matters is not the arithmetic but that the job is *still
claimable* past its nominal cap.

Live: `attempts_made 2, yields_made 1` on job 3105 — one attempt spent of four.

`attempts_made` still counts every lease, because it doubles as the lease epoch and two
leases sharing one epoch would be indistinguishable to the coordinator. `yields_made` is a
second column subtracted where the budget is judged, in all three places it is judged.

## R6 — ingest keys on the attempt

Covered structurally rather than by an end-to-end ingest, for the reason in *What this
covers*. Three things were changed and two are observable here:

- `gpu_job_attempts.ingested_at` replaces `gpu_jobs.published_attempt_id` as the guard,
  claimed with `UPDATE ... WHERE ingested_at IS NULL` so two concurrent results for one
  attempt cannot both pass, and released again when the ingest throws or finds nothing.
- Ingest takes **only the reporting attempt's artifacts**, filtered on
  `metadata.attempt_id`.

The filter is not defensive. Job 3105, live, produced:

```
artifacts on job 3105
  980  observations  attempt 2723  137abd370487a45b
  982  observations  attempt 2724  211f41d73eb59e74
```

Two artifacts on one job. `getJobDetail` returns both, so without the filter attempt 2724's
ingest would have swept up 2723's segment as well and written both into the record from one
attempt — a data fault with no error attached to it.

## R7 — nothing else changed

```
GPU attempt yielded > leaves a cancelled result cancelling the job, exactly as before  PASS
GPU attempt yielded > keeps a yielded job out of the queue if it was already cancelled PASS
GPU attempt yielded > refuses a negative completed_through_frame                       PASS
```

The whole GPU group, for regressions:

```
npm run test:gpu
  Test Suites : 7 passed, 0 failed, 7 total
  Tests       : 123 passed, 0 failed, 0 skipped, 123 total
  Duration    : 15.6s
```

## The live pool this was verified against

Two machines, two networks, one coordinator:

```
worker  48  ABYSS-46f37134                RTX 4080 SUPER 16 GiB  cc8.9   (desktop)
worker 898  SoftwareEngineering-a0294ccd  RTX 5060 Laptop 8 GiB  cc12.0  (laptop)
```

Real inference crossed between them: job 3102, `marp_tracking`, ran on the laptop with
weights streamed from MARP and returned real detections, hash-verified. That is not part of
#197 and is recorded here only because it is what made the defects below findable.

## Defects found while verifying, and what happened to each

- **The suite cannot run while the pool is live.** Two failures on the first run: a live
  worker out-polled the suite for its own job, and the corpus guard failed the file because
  `gpu_workers` and `service_tokens` moved under it.

  ```
  expect(polled.body.job_id).toBe(job.id)
    Expected: 3114   Received: 3113

  gpu-orchestration.test.js changed the database.
    - gpu_workers: row(s) modified, count unchanged at 2
    - service_tokens: row(s) modified, count unchanged at 16
  ```

  The guard is right; it cannot tell a heartbeat from a test rewriting rows it did not
  create. Worked around by stopping both workers — **stopped, not paused**: a paused worker
  stays enrolled and goes on heartbeating, so "park the pool" as a rule has to say stop.
  Raised for a decision and deliberately not designed here.

- **MARP accepts a job spec the worker always rejects.** `submitJobs` validates `engine`,
  `video` and `range` and never looks at `model` or `reduction`, both of which the worker
  requires. A bad spec queues, leases, and burns every attempt before anyone sees a pydantic
  traceback in `failure_reason`. Not fixed here — it needs the engine's `requires_model` to
  be visible to the coordinator, which is an open contract question.

- **A registered model with no bytes behind it.** `ml_models` row 91 named a `storage_path`
  under `.marp/local` that did not exist, so `GET /api/v2/model/91/artifact` answered 404 and
  every job carried an absolute Windows path instead. Fixed by placing the artifact where its
  own row says it lives; refusing a filesystem path at submit is not done and is separate.

- **`addConstraint` cannot add a check constraint** without a `fields` list it then ignores.
  Failed the first migration run; rewritten as plain `ALTER TABLE`, which is clearer for a
  clause that is the point of the migration.

## Left alone

- `failure_reason`, the `resume`/`running` vocabulary and the watch window are worker-side
  and belong to marp-inference-worker#20.
- Job targeting (`target_worker_id` plus capability matching) is decided but not built; it
  is a separate issue.
