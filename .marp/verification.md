# Verification — MarineAppliedResearch/MARP_API#187

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1, R2, R3 | `npm run test:ml` (`tests/ml_models.test.js`) | HTTP + real disposable PostgreSQL | Authenticated full/range streaming works; anonymous, missing, and escaping artifacts are refused without exposing host paths. |
| R4 | `npm run test:gpu` plus inspection of the submitted real job | contract + real PostgreSQL | GPU job validation accepts the API-relative model locator and the queued spec retains it. |
| R5 | Run `stage-model-artifact.js` first dry, then with `--apply`, then again | filesystem + real disposable PostgreSQL registry | The command uses the registered relative path, reports SHA-256, changes nothing on dry run, and can be safely repeated. |
| R6, R7 | Worker focused tests named in the worker verification file | HTTP integration | Authorization, checksum verification, and cache reuse work at the download boundary. |
| R1, R4, R6, R7 | Submit and run a short CAMPA inference job through the API, then run a second job for the same model | full system: API + disposable PostgreSQL + Jellyfin + CUDA worker | A worker with no shared source-model path receives the API URL, downloads authenticated bytes, performs real inference, and reuses the verified cache. |

## Requirements with no test

- **R8** — Established by schema diff and scope inspection: no migration or general storage backend is added.

## Edge cases

- Absolute and parent-traversal `storage_path` values return the same public 404 as an absent artifact.
- Byte-range requests return 206 and only the requested bytes.
- A missing registry row, null storage path, and absent file return 404.
- A second job with the same model name and hash must not download again.
- Authorization is not forwarded if a future job names a different HTTP origin.

## Regression coverage

- The CAMPA job spec no longer contains the developer machine's worker checkout path.
- Existing local-file and public HTTP cache sources remain covered by the worker cache suite.

## Known gaps

- This does not register the user's forthcoming second model or infer its species mapping.
- It does not test internet interruption/resume across processes; byte-range serving is covered at the API boundary.
- It does not implement #120's durable/general artifact storage.

## Manual steps

1. Point `MODEL_STORAGE_ROOT` at ignored API-local storage and stage the already registered CAMPA weights with the checked-in command. Confirm the printed digest matches the job's expected digest.
2. Restart the isolated API on its assigned port and run a short real CAMPA job with the worker checkout that has no source-model copy. Confirm the attempt succeeds through Jellyfin and CUDA.
3. Submit a second short job with the same model/hash. Confirm it succeeds and the worker reports the cache action as cached, with no second model GET in the API log.

---

## Results

Run 2026-09-14 on the isolated API database and port assigned by the harness.

- `npm run test:ml`: feature tests passed, but the group finished `8 passed, 1 failed`
  because all three pre-existing `dataset-observations-cascade.test.js` cases failed
  while inserting their fixture. Direct reproduction reported verbatim:
  `duplicate key value violates unique constraint "observations_pkey"`. The failure is
  unrelated to this branch and occurs before those tests exercise cascade behavior.
- `npm test -- tests/ml_models.test.js`: `Tests: 6 passed, 0 failed, 0 skipped, 6 total`.
  Full download, byte range, anonymous refusal, path containment, and cleanup passed.
- `node scripts/stage-model-artifact.js ...` dry run and two `--apply` runs each reported
  `sha256: 9283b8ee1d1ac22ddfe5e8394a95c950cf65e1dfce3c772a1559c0408f52cff8`;
  both applications completed with `Staged.`.
- First full-system attempt exposed and preserved this failure verbatim:
  `TypeError: model='...\\artifact' should be a *.pt PyTorch model`. The worker had
  downloaded and verified the route, but the extensionless route name lost the declared
  model format. The cache now derives `.pt` from the spec, with a regression test.
- The coordinator retried that failed attempt after the fix and job 87 succeeded. A second
  independent job then reported verbatim: `job=89 state=succeeded seconds=7.22 cache=True`.
  Both used the isolated API and database, the real Jellyfin item, and the CUDA engine.
- The extra queued helper job 88 was cancelled after verification.
