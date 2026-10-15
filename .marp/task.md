---
task: MarineAppliedResearch/MARP_API#257
repos: [MARP_API]
status: design
needs: []
---

## Goal

Answer the question "is this dive actually done?" from the record rather than
from somebody's memory. Today the coordinator stores what was *attempted* --
5,329 cancelled jobs against 3,040 succeeded on this database -- and nothing
distinguishes a range nobody wanted from a range that was started and never
finished. A GPU worker that gives a job up mid-range leaves no trace saying
those frames are still owed.

This milestone delivers the **read-only half**: a view that reports, for a
video, which frames have a succeeded job over them and which do not.
Requeueing what is owed is deliberately not in it, because it turns on a
question only the human can answer.

## Requirements

- **R1** — Given a video and a session, report the frame ranges covered by
  succeeded inference jobs, and the ranges not covered, as half-open intervals
  consistent with the rest of the GPU API.
- **R2** — Coverage is computed from what a job **actually processed**, as the
  worker reported it, never from the range it was submitted with. A job
  submitted 0–60,000 that stopped at 22,320 because the video ended has not
  covered 60,000 frames.
- **R2a** — The worker reports, on a terminal result, the frame ranges it
  actually processed and the time it took.
- **R2b** — The coordinator compares that against the range it asked for, at
  ingest, and records the difference. A shortfall is noticed when it happens,
  not reconstructed by a query months later.
- **R3** — Overlapping and adjacent succeeded ranges merge, so a video split
  into pieces that tile it exactly reports as one covered interval rather than
  as N.
- **R4** — The report says which jobs produced each covered interval, so a gap
  can be traced to the attempt that abandoned it.
- **R5** — It answers for a video that was never submitted at all, rather than
  returning nothing. "No work has been requested" and "work was requested and
  is incomplete" are different answers.
- **R6** — Read-only. No state changes, nothing requeued, nothing cancelled.
- **R7** — The reported ranges are stored where the attempt is, so the view
  reads a recorded fact rather than inferring one. This does need a migration;
  what it must not become is a second copy of the job record.
- **R8** — A video's extent comes from Jellyfin, so "complete" means complete
  against the video rather than against the largest request made of it.

## Open assumptions

- [x] **A1 · scientific/data-meaning · blocking** — answered 2026-10-15: **the
      worker reports the ranges it actually processed, and the coordinator
      compares them against what it asked for, at ingest.** Isaac: *"when we
      ingest from the worker, the coordinator should compare the work the worker
      did with the work it was expecting the worker to do, so the worker should
      technically be reporting the ranges of what it actually processed, it
      could even report the time taken so the coordinator can track that and
      show it in the dashboard."*

      This is wider than the final-frame field that was proposed, and better:
      the check happens where the evidence arrives rather than being
      reconstructed later by a query, so a shortfall is noticed at the moment it
      happens. It also makes coverage a recorded fact instead of an inference.
      Elapsed time rides along for the dashboard.
- [x] **A2 · scientific/data-meaning · blocking** — answered 2026-10-15: **ask
      Jellyfin.** It knows the video's real length, so "complete" is measured
      against the video rather than against the largest request anybody happened
      to make. `repository/jellyfin.repository.js` already talks to it.
- [ ] **A3 · product/UI · non-blocking** — Is a gap reported per *(video,
      session)* or per *video*? The same item appears under several sessions
      (item `48ff096a…` under 754 and 640), which are different survey contexts
      rather than a repeat of the same work. Proposed: per *(video, session)*,
      because a session is what a scientist reasons about.
- [ ] **A4 · API contract · non-blocking** — A new `GET` under
      `/api/gpu/...`, or part of the existing job listing? Proposed: its own
      route, `GET /api/gpu/coverage`, because it answers a different question
      from "list the jobs" and takes different parameters.
- [ ] **A5 · behavioural · non-blocking** — Do `failed` and `expired` jobs
      count as not-covered the same way `cancelled` does? Proposed: yes — only
      `succeeded` covers anything; everything else is absence of evidence.

## Decisions

- **2026-10-15** — The read-only view ships first and alone. Requeueing is the
  second piece and is blocked on what `cancelled` means: today it covers both
  *"we changed our mind"* and *"this never got done"*, and nothing automatic
  should act on a word carrying two meanings. Raised with Isaac on 2026-10-15.
- **2026-10-15** — This is a query, not a new table. The record of what was
  attempted already exists; what is missing is a way to read it. A new table
  would be a second copy of the same facts, and the first to drift.

## Plan

1. A repository function that, for a `(video, session)`, returns succeeded jobs
   with their ranges and whatever A1 settles on as evidence of real extent.
2. Merge the intervals, in SQL rather than in JavaScript, so a long video does
   not pull thousands of rows to fold them.
3. The complement against the extent A2 settles on, yielding the gaps.
4. A service that names the jobs behind each covered interval (R4).
5. One route, documented through `docs/openapi-route-registry.js`, and
   `npm run docs:build` re-run because the generated contract is committed.

## Acceptance criteria

- A video processed by a batch that tiled it exactly reports one covered
  interval and no gaps.
- A video with a job cancelled mid-range reports the gap, and names the job.
- Job 14372 -- cancelled on 2026-10-15 after twelve thousand frames -- appears
  as a gap, since it is the worked example the issue was opened on.
- A video nobody has submitted reports "nothing requested", not "complete".
- Re-running the query changes nothing in the database.

## Test plan

Filled in at G3.

## Status

- **Gate:** design -- both blocking assumptions answered; scope now spans two repositories
- **Notes:** A1 and A2 both block, and both are data-meaning questions rather
  than technical ones. A1 is the sharper of the two: every option gives a
  different definition of "done", and the easy one (trust `spec.range`) is the
  one that would quietly hide gaps at the end of every video.
