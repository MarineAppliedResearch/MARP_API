# 225 — verification

## What was run

`npx jest tests/gpu-observation-ingest.test.js` — **43 tests, all passing.**
Five name a requirement, four of them new:

| Test | Proves |
| --- | --- |
| An attempt whose results were not ingested > is failed rather than succeeded, and its job goes back to the queue | R1 |
| An attempt whose results were not ingested > leaves a job that legitimately detected nothing succeeded | R2 |
| A job that detected nothing > ingests zero observations from an empty result file without erroring | R2 (existing) |
| An artifact recorded without its bytes > is asked for again rather than reported as already held | R3 |
| An artifact recorded without its bytes > refuses a result that names it, so the worker uploads instead | R4 |

The R1 test asserts the attempt row itself, not only the response: `state` is
`failed`, `ingested_at` is still NULL — now consistent rather than contradictory
— and the job row is `queued`.

`npx jest tests/gpu-orchestration.test.js` — **55 passed, 0 failed**, and the
corpus guard raised nothing.

## R5, proven by doing the damage and then not doing it

The empty artifact was restored to the store and its hash verified:

    restored empty artifact, sha256 verifies: true

The suite that used to delete it was then run **five times**. After every run:

    empty artifact SURVIVED all runs

Before the change the guard reported the two halves separately as they were
fixed, which is the evidence that both were real:

    gpu_artifacts_staging: 2 row(s) deleted that the suite did not create
    gpu_artifacts_staging: 5 row(s) added and left behind
    gpu_artifacts_staging: row(s) modified, count unchanged at 1593

All three are gone. The last one is why `handOver` now checks before uploading
rather than uploading unconditionally: re-uploading an existing artifact upserts
a staging row the suite did not create. That also makes the helper match what a
worker really does, which is what its own docstring always claimed.

## What was NOT proven, and why

The suite cannot be run cleanly on this machine while the pool is working. Three
inference workers are polling the same coordinator, and `submitAndLease` fails
with `expect(leased.status).toBe(200)` when a real worker takes the test's job
first. Across six runs, two to four tests failed this way and **a different set
each time**; the five above passed in every run.

The corpus guard also reports `gpu_workers`, `service_clients` and
`service_tokens` modified on most runs. That is the live pool heartbeating, not
this suite. Isaac ruled on 2026-09-19 that this is acceptable for now, on the
grounds that workers will run either in production or during deliberate testing.

So: the requirements are proven, and the suite around them is not clean. Both are
stated rather than one being allowed to imply the other.
