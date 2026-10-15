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
- **R2** — Coverage is computed from what a job **actually processed**, never
  from the range it was submitted with. A job submitted 0–60,000 that stopped
  at 22,320 because the video ended has not covered 60,000 frames.
- **R3** — Overlapping and adjacent succeeded ranges merge, so a video split
  into pieces that tile it exactly reports as one covered interval rather than
  as N.
- **R4** — The report says which jobs produced each covered interval, so a gap
  can be traced to the attempt that abandoned it.
- **R5** — It answers for a video that was never submitted at all, rather than
  returning nothing. "No work has been requested" and "work was requested and
  is incomplete" are different answers.
- **R6** — Read-only. No state changes, nothing requeued, nothing cancelled.
- **R7** — It is a query over existing columns. No migration, no new table, and
  no new writing path for workers.

## Open assumptions

- [ ] **A1 · scientific/data-meaning · blocking** — **What counts as "actually
      processed"?** A job's `spec.range` is what was *asked for*. The evidence
      of what was *done* is weaker: a yielded attempt leaves
      `resume_from_frame`, but a succeeded job leaves nothing saying where it
      really stopped — job 14371 was submitted 0–60,000 and succeeded at 22,320
      because the video ran out. Three options, and they give different answers:
      **(a)** trust `spec.range` on a succeeded job and accept over-reporting at
      the end of a video; **(b)** derive the real extent from the observations
      and keyframes the job wrote, which is the true record but says nothing for
      a range that genuinely contained no animals; **(c)** have the worker
      report its final frame on success, which is correct but is a change to the
      worker and a new field. → **Which?**
- [ ] **A2 · scientific/data-meaning · blocking** — **What is a video's full
      extent measured against?** Nothing in `gpu_jobs` knows how long a video
      is; the current best proxy is the largest `end_frame` anybody ever
      submitted for it. That makes "complete" mean "as complete as the biggest
      request", which is circular if the first submission was short. The
      alternative is asking Jellyfin for the real duration. → **Proxy, or ask
      Jellyfin?**
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

- **Gate:** design
- **Notes:** A1 and A2 both block, and both are data-meaning questions rather
  than technical ones. A1 is the sharper of the two: every option gives a
  different definition of "done", and the easy one (trust `spec.range`) is the
  one that would quietly hide gaps at the end of every video.
