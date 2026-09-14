---
task: MarineAppliedResearch/MARP_API#187
repos: [MARP_API, marp-inference-worker]
status: implementing
needs: []
---

## Goal

An inference worker can obtain a registered model from MARP API without sharing the
API host's filesystem. The API operator stages the weights in local ignored storage;
workers download them with their existing service credential and reuse verified cached
bytes on later jobs.

## Requirements

- **R1** — An authenticated worker may stream a registered model's artifact by model id.
- **R2** — Artifact paths resolve only beneath a configurable API-local storage root.
- **R3** — Missing model rows, missing storage paths, and missing files return the normal
  API error contract without revealing host filesystem paths.
- **R4** — The dive submission script puts the API artifact route in the job spec instead
  of a machine-local path.
- **R5** — A checked-in, dry-run-by-default staging script copies weights to the registered
  model's storage path and reports their SHA-256; repeated application is safe.
- **R6** — The worker presents its existing bearer credential while downloading and still
  refuses bytes whose SHA-256 differs from the job spec.
- **R7** — A second request for the same model and hash uses the worker cache without an
  HTTP download.
- **R8** — This repair adds no database column and does not implement the general storage
  service tracked by #120.

## Open assumptions

- [x] **A1 · architectural · blocking** — answered 2026-09-14: use a temporary local
  directory on the API machine now; defer the general file server.
- [x] **A2 · security/permissions · blocking** — answered 2026-09-14: workers authenticate
  model requests with their existing MARP API service credential.
- [x] **A3 · database/schema · blocking** — answered 2026-09-14: keep `ml_models.storage_path`
  as the registered relative artifact location and add no schema.
- [x] **A4 · behavioural · blocking** — answered 2026-09-14: workers verify and cache the
  model, reusing the cached version when requested again.

## Decisions

- **2026-09-14** — Resolve registered relative paths under `MODEL_STORAGE_ROOT`, whose
  development default is ignored `.marp/local` storage.
- **2026-09-14** — Gate downloads with `jobs:execute`, the permission already held by a
  worker executing a job; model registry editing permissions remain separate.
- **2026-09-14** — Use Express file streaming, including its standard byte-range handling.

## Plan

1. Add safe model artifact path resolution and an authenticated streaming route.
2. Add the repeatable local staging command and remove the local worker path default.
3. Teach the worker cache download to use the coordinator URL and bearer credential.
4. Add focused API and worker tests, then write the G3 verification package.

## Acceptance criteria

- A worker-only token can download the exact registered bytes from the API.
- An unregistered, absent, or escaping artifact cannot be downloaded.
- A submitted inference spec contains an API route rather than a Windows filesystem path.
- The worker downloads once, verifies the hash, and reuses that cache entry thereafter.

## Test plan

See `.marp/verification.md`; awaiting human review before execution.

## Status

- **Gate:** ready-for-pr
- **Notes:** Focused route tests, staging, worker tests, and real API/Jellyfin/CUDA jobs pass.
  The ML group also exposed an unrelated stale observation-sequence failure recorded in
  `.marp/verification.md`.
