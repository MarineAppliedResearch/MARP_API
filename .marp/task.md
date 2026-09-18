---
task: MarineAppliedResearch/MARP_API#197
repos: [MARP_API, marp-inference-worker]
status: verified
needs: []
---

## Goal

A volunteer who stops a running job mid-way gets what they expect: the work done so far is
kept and ingested, and the rest of the job goes back to the pool for another machine to
finish. Today the worker says `yielded`, MARP has no such word, the result is refused with
400, and the run is silently lost.

This is the MARP side. The worker side is MarineAppliedResearch/marp-inference-worker#20.

## Requirements

- **R1** — `yielded` is a result outcome MARP accepts. A worker reporting it gets a normal
  ack, not a 400.
- **R2** — A yielded attempt is recorded as `yielded`, distinguishable afterwards from a
  `cancelled` one. The attempt state check constraint permits it.
- **R3** — `gpu_job_attempts` records how far the worker got, from the
  `completed_through_frame` the worker already computes and already sends.
- **R4** — A yielded job returns to `queued` with its remaining range, so another volunteer
  resumes from where the first stopped. It is not cancelled.
- **R5** — A yield does not spend the job's attempt budget. A job handed between volunteers
  stays claimable.
- **R6** — Ingest happens per attempt rather than once per job, so the second volunteer's
  observations are not refused as already ingested.
- **R7** — Nothing above changes what `succeeded`, `failed` or `cancelled` already do. A
  cancel still cancels, a failure still spends an attempt.

## Open assumptions

- [x] **A1 · API contract · blocking** — answered 2026-09-17: **a fourth outcome,
  `yielded`**, rather than reporting `cancelled` and carrying the partial-work signal in a
  nullable frame number. `cancelled` already means "called off, nothing to keep"; overloading
  it would make the ingest condition depend on a frame count instead of on what happened.
  Isaac's words: *"I'm thinking i lean towards A as well."*

- [x] **A2 · behavioural · blocking** — answered 2026-09-17: **the job is handed back to the
  pool.** A stopped job returns to `queued` with its remaining range and another volunteer
  carries on from `completed_through_frame`. Not cancelled-and-terminal. This is what makes
  `completed_through_frame` mean something rather than be a number nobody reads.

  Asked independently of the worker-side agent and answered the same way on both sides,
  which is why it is recorded as settled rather than as a reading of one reply.

- [x] **A3 · architectural · blocking** — answered 2026-09-17: **a yield does not consume an
  attempt.** `selectClaimableJobRow` filters on `attempts_made < max_attempts`; counting a
  yield there would mean the jobs passed between the most volunteers are the first to become
  unclaimable, which is backwards for a pool.

  **Stated consequence, accepted:** nothing then stops a job no machine can finish from being
  retried forever. There is no backstop for that in this change. If it bites, the answer is a
  separate guard — a total-yield ceiling or a no-progress rule — and not quietly making yields
  cost an attempt after all.

- [x] **A4 · database/schema · blocking** — answered 2026-09-17: **ingest is keyed per
  attempt.** `gpu_jobs.published_attempt_id` holds exactly one attempt and `publishResult`
  guards on it being null, so under A2 the second volunteer's real work would be refused as
  already ingested. The key moves to the attempt.

  Frame-range idempotency was offered and not taken: it only pays off if two workers can
  cover overlapping frames, which nothing can produce yet. Named here so it is a decision
  rather than an omission.

- [x] **A5 · architectural** — answered 2026-09-17, for a later issue rather than this one:
  job targeting is **both pinning and capability matching** — a nullable `target_worker_id`
  on `gpu_jobs` plus a requirements column matched against the `capabilities` the poll
  already carries and already snapshots. Recorded here because it lands in the same tables
  and should not be rediscovered; it is not built by this task.

## Decisions

- **2026-09-17** — Adding `yielded` to `RESULT_OUTCOMES` alone is worse than the present
  bug and must never be shipped on its own. `publishResult`'s trailing `else` hardcodes
  `SET state = 'cancelled'` and cancels the job, so the word would be accepted and then
  silently recorded as a cancel — and because `isReplay` compares `attempt.state` against
  `RESULT_OUTCOMES`, a retry would confirm the wrong answer rather than expose it. The
  vocabulary, the constraint and the explicit branch land together or not at all.

- **2026-09-17** — The migration spells the vocabulary out rather than importing it.
  `config/gpu-orchestration.js` records that migrations deliberately do not read the config;
  a mismatch then surfaces as a database error instead of as silence.

## Plan

1. Migration: alter `gpu_job_attempts_state_check` to include `yielded`; add
   `completed_through_frame` to `gpu_job_attempts`; add whatever A4 needs to key ingest per
   attempt; add the remaining-range column A2 needs on `gpu_jobs`.
2. `config/gpu-orchestration.js`: `yielded` into `RESULT_OUTCOMES` and `ATTEMPT_STATES`.
3. `service/gpu.service.js`: `recordResult` reads and validates `completed_through_frame`.
4. `repository/gpu.repository.js`: an explicit `yielded` branch in `publishResult` that
   records the attempt, stores the frame, requeues the job with its remainder, and does not
   spend an attempt.
5. Ingest: key on the attempt (A4), and stop gating on `outcome === 'succeeded'` alone.
6. Tests at the tier that can see each of these — a refused stop is what started this, and
   both repositories' suites currently pass against each other's wrong assumption.

## Acceptance criteria

- A worker reporting `yielded` is accepted, and the attempt reads `yielded` afterwards.
- The job is `queued` again with its remaining range, and a second poll leases it.
- The first volunteer's observations are present, and the second volunteer's are added
  rather than refused.
- A job handed between several volunteers is still claimable.
- A `cancelled` result still cancels the job.

## Test plan

`.marp/verification.md` on this branch. The cross-machine half is a second real GPU worker
on another machine polling this API, which is why it is being done with that agent rather
than simulated here.

## Status

- **Gate:** design complete, assumptions answered, not yet implementing
- **Notes:** Written 2026-09-17. Every claim about the current schema in this file was
  checked against the running database rather than read off a migration. The worker-side
  agent found A3 and A4 while reading the same code from the other end; both were put to
  Isaac rather than settled between agents.
