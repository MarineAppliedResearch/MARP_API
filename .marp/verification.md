# Verification — marp-inference-worker #9 API persistence

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1, R2, R3 | `gpu-observation-ingest.test.js` › `persists numeric and null keyframe confidence from a worker result` | HTTP + PostgreSQL | A submitted and leased job accepts an uploaded observations artifact, publishes its result, automatically ingests it, and stores every numeric or null `keyframes[].confidence` value unchanged. |
| R4 | Existing `gpu-observation-ingest.test.js` teardown plus the complete GPU subsystem | HTTP + PostgreSQL | The new job and its observation, keyframe, artifact, and seed rows use the suite's established cleanup without contaminating the other 95 GPU checks. |

## Requirements with no test

None.

## Edge cases

- At least two numeric values differ, so a single track-level value cannot satisfy the check.
- One keyframe carries explicit null, proving the database does not substitute zero or a
  neighbouring score.
- Stored rows are ordered and matched by frame number before confidence is compared.

## Regression coverage

The new named test covers marp-inference-worker #9 at the first tier that can observe the
reported defect: the real coordinator HTTP result flow plus persisted PostgreSQL keyframes.

The complete GPU subsystem protects job submission, leasing, artifact handoff, automatic
ingest, observation mapping, concurrency, and cleanup around the new assertion.

## Known gaps

- The historical job-1256 artifact contains real observations and keyframe geometry but
  predates per-keyframe confidence. The test therefore uses explicit numeric and null
  contract sentinels rather than claiming scores can be reconstructed from that artifact.
- The worker's own pipeline tests separately prove that each emitted value comes from the
  raw detection on the frame the keyframe names. Neither repository depends on a sibling
  checkout during its normal test run.

## Manual steps

None.

---

## Results

Run 2026-09-13 in the isolated MARP_API workspace created from merged `origin/develop`,
against its disposable PostgreSQL database.

### Exact end-to-end persistence case — PASS

```powershell
node node_modules\jest\bin\jest.js --runInBand --forceExit --runTestsByPath tests\gpu-observation-ingest.test.js -t "persists numeric and null keyframe confidence"
```

```text
Test: [gpu-observation-ingest.test.js] Ingesting a real result file > persists numeric and null keyframe confidence …... PASS
Test Suites : 1 passed, 0 failed, 1 total
Tests       : 1 passed, 0 failed, 37 skipped, 38 total
Duration    : 1.4s
Result: ALL TESTS PASSED
```

### Complete MARP_API GPU subsystem — PASS

```powershell
npm run test:gpu
```

```text
Test Suites : 5 passed, 0 failed, 5 total
Tests       : 96 passed, 0 failed, 0 skipped, 96 total
Duration    : 12.4s
Result: ALL TESTS PASSED
```
