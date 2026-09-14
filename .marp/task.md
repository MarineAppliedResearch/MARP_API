---
task: MarineAppliedResearch/MARP_API#189
repos: [marp-api, marp-inference-worker]
status: implementing
needs: []
---

## Goal

An administrator creates a one-time activation code, and a new Windows worker exchanges it
once for its own revocable machine credential so installation requires no MARP account login
or manually provisioned shared token.

## Requirements

- **R1** — An administrator may create a labeled activation code with a bounded expiry.
- **R2** — Activation consumes the code transactionally exactly once and enrolls the submitted
  durable machine identity, platform, architecture, runtime, and worker version.
- **R3** — Activation returns a new bearer credential only once and persists only its hash and
  safe prefix through the existing service-token system.
- **R4** — The credential is bound to one worker identity. Service-token GPU operations cannot
  poll, heartbeat, report, upload, or check in for another worker.
- **R5** — Revoking the machine token stops only that worker; existing permission-based human
  administrator access remains unchanged.
- **R6** — Approved worker releases retain immutable version, platform, architecture, runtime,
  URL, size, and SHA-256 metadata, with an optional durable desired release per worker.
- **R7** — Schema changes are additive and preserve every existing worker, job, attempt, token,
  and scientific record.

## Open assumptions

- [x] **A1 · security/API contract · blocking** — answered 2026-09-14: use a short-lived,
  one-time activation code to mint one narrowly scoped credential unique to the machine.
- [x] **A2 · permissions · blocking** — answered 2026-09-14: human administrators keep their
  permission-based access; machine credentials additionally enforce their bound worker id.
- [x] **A3 · distribution · blocking** — answered 2026-09-14: MARP_API approves release
  metadata while immutable packages may live on GitHub Releases.
- [x] **A4 · database/schema · blocking** — settled by the existing implementation: reuse
  service clients and hashed service tokens, adding activation and release rows only.

## Decisions

- **2026-09-14** — Restore the previously implemented provisioning boundary from
  `backup-11-installer-scope`, then reconcile it with current `develop` and issue #187's model
  delivery rather than merging that stale branch.

## Plan

1. Add the activation/release migration and Sequelize models.
2. Restore provisioning repository, service, controller, routes, and registration.
3. Bind machine-token calls to their own worker without changing human authorization.
4. Regenerate the OpenAPI contract and write the focused verification plan.
5. After plan approval, migrate and test only the provisioning/GPU groups against this
   workspace's disposable database, then activate the second computer.

## Acceptance criteria

- A fresh code activates once and cannot be replayed.
- The returned credential enrolls and operates only its own worker.
- Two independently activated computers appear as separate workers and revoking one leaves the
  other operational.
- The installer can obtain runtime-compatible release metadata without an inbound worker port.

## Test plan

Written at G3 after implementation and reviewed before execution.

## Status

- **Gate:** implementing
- **Notes:** No production database or live service configuration is used. Migration checks and
  API tests use only this harness-created disposable database.
