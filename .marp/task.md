# 225 — A job is not finished until its data is in the database

**Issue:** MarineAppliedResearch/MARP_API#225
**Branch:** `225-a-job-is-not-finished-until-its-data-landed` off `develop`

Isaac, 2026-09-19: *"we 100% need to make sure that if a job is considered
finished the api has actually ingested it's data, otherwise the job isn't
finished. In the end there should be no reason why ingest would fail, that just
means that we didn't get the data that was supposed to run and that is
unacceptable."*

## Requirements

- **R1** An attempt whose ingest failed is `failed`, not `succeeded`, and its job
  goes back to the queue while attempts remain.
- **R2** A job that legitimately detected nothing still ingests zero observations
  and finishes. Retrying those would burn three attempts on every empty result.
- **R3** `already_have` is false when the bytes are not on disk, so a worker that
  would otherwise skip the upload sends them.
- **R4** A result naming an artifact MARP does not hold is refused while the
  worker still has the file, rather than published and then withdrawn.
- **R5** A test never deletes an artifact file or staging row that existed before
  it ran.

## Open assumptions

- [x] **behavioural, blocking** — retry on a GPU, or a non-terminal state that
  does not re-run? *Answered by Isaac: fail and retry. "In the end there should
  be no reason why ingest would fail." The GPU cost is accepted deliberately.*
- [x] **behavioural** — does a cancelled job come back? *No. Somebody stopped it
  on purpose and a late ingest failure is not grounds to restart it.*

## Why R5 is in this issue rather than its own

It is the cause of the largest share of the symptom. `runJob([])` hands over an
**empty** results file; artifacts are content-addressed, so that file is the same
file every real job that detected nothing produced. The cleanup deleted it, and
every later hand-over of that content was answered `already_have` against a row
whose bytes were gone. 196 attempts ingested that artifact successfully; the 179
after it did not.

Invisible in CI, whose database holds no production empty artifact to collide
with. It only damages a real corpus.

## Not in scope

The 470 attempts already in this state. Nothing here re-ingests them; R3 means a
re-run can now succeed, which is the mechanism by which they become recoverable.
