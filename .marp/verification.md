---
task: MarineAppliedResearch/MARP_API#189
status: awaiting-plan-review
---

## What this verifies

This is the API half of the one-click Windows worker pilot. It proves that a one-time
activation code creates one revocable machine credential, that the credential cannot act
as another worker, and that release metadata survives through the real PostgreSQL schema.

## Automated checks

1. Run `npm run test:gpu` against this workspace's harness-created disposable database.
   The named `worker-provisioning.test.js` case proves R1-R6: one-time use, hashed token
   storage, enrollment, cross-worker poll/artifact rejection, update targeting, terminal
   update failure, explicit retry, and revocation. Existing GPU tests prove administrator
   sessions still use the established permission checks and that normal job leasing remains
   compatible.
2. Apply the new migration to that disposable database, start this branch's API, and inspect
   the migration result. This proves R7 without reading from or writing to `mare_v1`.
3. Request two activation codes through the real HTTP API and activate two distinct machine
   identities. Confirm the pool contains two worker rows with different token ids and that
   neither credential can poll or upload for the other worker.
4. Revoke one token through the existing token API. Confirm its next authenticated request is
   rejected while the other worker continues polling.

## End-to-end evidence shared with worker #18

The second Windows computer will use the development installer against this API. A real
API-assigned inference job must download its registered model through MARP_API, process its
video range on the second computer's NVIDIA GPU, report progress and results, and open the
watch window. Its worker row, attempt, events, and result are inspected through the API.

## Not covered

- No production database migration or write.
- No signed public release; the development installer is intentionally unsigned.
- No automatic fleet rollout. This pilot verifies the API contract and update metadata on
  which that later milestone will depend.

## Results

Not run. Awaiting human review of this plan.
