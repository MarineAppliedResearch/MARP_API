---
task: MarineAppliedResearch/marp-inference-worker#9
repos: [marp-api, marp-inference-worker]
status: verifying
needs: []
---

## Goal

Prove that the per-keyframe confidence added by inference-worker issue #9 survives the real
coordinator result flow and is stored unchanged in MARP_API's PostgreSQL `keyframes` rows.

## Requirements

- **R1** — The existing worker-result HTTP flow persists numeric keyframe confidence without
  changing its value.
- **R2** — The same flow persists an explicit null when the worker had no detection score for
  a prediction-only keyframe.
- **R3** — The check uses the real MARP_API application and a disposable PostgreSQL database,
  including job submission, lease, artifact upload, result reporting, automatic observation
  ingest, and a database query of the resulting keyframes.
- **R4** — The test removes the jobs, observations, keyframes, artifacts, and seed rows it
  creates through the suite's existing teardown.

## Open assumptions

None. Issue #9 settled the score meaning and version. MARP_API already accepts the field;
this branch adds only the missing end-to-end contract assertion.

## Decisions

- **2026-09-13** — Keep producer semantics in the worker pipeline tests and persistence
  semantics in MARP_API's existing GPU ingest suite. The component tests meet at the same
  serialized `keyframes[].confidence` contract without making either repository depend on a
  sibling checkout.
- **2026-09-13** — Use the existing real job-1256 observation and keyframe geometry. Numeric
  and null scores are explicit test sentinels because the historical artifact predates issue
  #9 and no honest per-keyframe score can be reconstructed from it.

## Plan

1. Add numeric and null keyframe-confidence values to one result row in the existing GPU
   ingest test without changing the checked-in historical artifact.
2. Submit and report that result through the existing HTTP helpers.
3. Query the stored keyframes and compare every confidence value in frame order.
4. Run only the GPU observation-ingest test against this workspace's disposable database.

## Acceptance criteria

- The API reports the result successfully and automatic ingest succeeds.
- Stored numeric values match the artifact values exactly.
- Stored null remains null.
- The targeted suite passes and its teardown leaves no task rows behind.

## Test plan

Run the named keyframe-confidence case in `tests/gpu-observation-ingest.test.js` through the
GPU subsystem command against this workspace's assigned disposable database. Record the
command and real output before reporting the cross-repository verification complete.

## Status

- **Gate:** verifying
- **Notes:** Isolated workspace created from merged MARP_API `develop`; implementation is in
  place. The exact persistence case and complete GPU subsystem passed; G4 evidence awaits
  human review.
