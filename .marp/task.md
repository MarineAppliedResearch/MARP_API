---
task: MarineAppliedResearch/MARP_API#257
repos: [MARP_API]
status: design
needs: []
---

## Goal

Make a hole in the data tell you it is a hole. `cancelled` means two things
today — *"we changed our mind"* and *"this never got done"* — so nothing can
safely act on it. This milestone splits them and then fills what is owed.

## Requirements

- **R1** — A new job state, **`interrupted`**: the job stopped part-way and the
  frames it did not reach are owed.
- **R2** — `cancelled` means a human changed their mind. Nothing is missing, and
  nothing is ever requeued from it.
- **R3** — A worker reporting `cancelled` for a job that is **not already
  cancelled** is a worker stopping of its own accord. That is `interrupted`.
  Where the job is already `cancelled`, the human's decision is propagating and
  it stays `cancelled`.
- **R4** — `POST /api/gpu/jobs/:id/cancel` is unchanged: it is the human path
  and it produces `cancelled`.
- **R5** — The coverage view counts an `interrupted` job's unreached frames as a
  gap, which it already does, since coverage is computed from what was reported
  rather than from job state.
- **R6** — Requeueing an owed range creates real queued work over exactly the
  frames nobody covered: never the whole original range, and never frames a
  succeeded job already did.
- **R6a** — `interrupted` work is requeued automatically. Nobody has to notice
  that a volunteer paused.
- **R6b** — `failed` work is **never** requeued automatically. It stays visible
  as `failed`, and the route lets a human requeue it once they have looked.
- **R7** — Requeueing twice does not queue the same frames twice.
- **R8** — The historical 5,329 `cancelled` jobs stay `cancelled`. The
  distinction starts the day it ships; the development database is development
  data and production has not used any of this.

## Open assumptions

- [x] **A1 · behavioural · blocking** — answered 2026-10-15: **`failed` is
      never requeued automatically.** Isaac: *"if something fails a certain
      amount of times we shouldn't automatically keep requeuing it, but if it
      goes to failed status, the user can notice the failed status, and try to
      requeue it or recreate the job manually."*

      A job that has exhausted its attempts has already been retried as much as
      retrying is worth; doing it again on a schedule spends GPU time on
      something that is probably broken rather than unlucky. It stays visible as
      `failed` and a human decides.
- [x] **A2 · product/UI · blocking** — answered 2026-10-15: **both, and they
      differ by what they are allowed to touch.** Isaac: *"i think both can
      reque, like i just said kinda"*.

      - **Automatic**, over `interrupted` work only: a volunteer pausing or a
        worker stopping is an ordinary event and the frames should simply get
        done. Nobody should have to remember.
      - **A route**, for a human, which can also requeue a `failed` job: that is
        the path A1 describes, taken deliberately after somebody has looked.
- [ ] **A5 · behavioural · non-blocking** — **What stops an automatic requeue
      looping?** A requeue makes a *new* job, which starts with a fresh
      `max_attempts`, so a range that is interrupted every time could be
      requeued for ever. Each interruption is legitimate on its own -- a
      volunteer paused -- so a plain attempt cap is the wrong instrument.
      Proposed: carry a requeue count forward on the spec, and stop requeueing
      automatically past a small number, leaving it `interrupted` and visible.
      That is exactly A1's shape, one level up.
- [ ] **A3 · behavioural · non-blocking** — Does an `expired` lease become
      `interrupted`? Today the job returns to the queue by itself, so it is
      already owed and already being dealt with. Proposed: no, leave it.
- [ ] **A4 · API contract · non-blocking** — `interrupted` is a new value in
      `JOB_STATES`, which the job-list filter and the OpenAPI enum both expose.
      Proposed: add it to both; it is additive and no existing value changes
      meaning.

## Decisions

- **2026-10-15** — `cancelled` means nothing is missing; `interrupted` means a
  hole. Isaac: *"something cancelled should mean nothing is missing, we should
  have another term for yes, there's a hole in the data because of this"*.
  `interrupted` says what happened rather than how anyone feels about it, and
  avoids `abandoned`, which already means a lease that blew past its cap.
- **2026-10-15** — The conflation is named in the code today: *"The job is
  cancelled whether or not the cancel came from a human -- a worker that stops
  of its own accord and calls it cancelled is saying the same thing."* They are
  not the same thing, and job 14372 is the evidence: twelve thousand frames
  done, the rest never processed, recorded as though nobody wanted them.

## Plan

1. `interrupted` in `JOB_STATES`, and in the OpenAPI enum the job filter uses.
2. The worker-reported branch in `publishResult` chooses `interrupted` over
   `cancelled` when the job was not already cancelled.
3. A repository query for owed ranges: the gaps from the coverage work,
   narrowed to videos with an `interrupted` job over them.
4. Requeue: submit jobs over those gaps, reusing the submission path so a
   requeued job is an ordinary job with an ordinary spec.
5. A route for it, per A2.

## Acceptance criteria

- A worker reporting cancelled on a live job leaves the job `interrupted`.
- A human cancelling leaves it `cancelled`, and a worker's later report does
  not change that.
- The coverage view shows an interrupted job's unreached frames as a gap.
- Requeueing that video queues jobs covering exactly the gap.
- Requeueing again queues nothing.
- Nothing requeues from a `cancelled` job.

## Test plan

Filled in at G3.

## Status

- **Gate:** design -- both blocking assumptions answered
- **Notes:** Settled. The shape is that automatic requeueing is for things that
  are nobody's fault and will simply work next time, and everything else waits
  for a human to look at it. A5 is the same question one level up and is
  answered the same way; it is non-blocking because the first version can
  requeue once and be watched.
