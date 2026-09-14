# Verification — MARP_API #133: GPU playback visible in Jellyfin

This G3 verification package was approved by the human and run at G4.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `gpu-playback-reporting.test.js` — “starts one session identified by the enrolled worker and leased slot”; `jellyfin.test.js` — “finds active playback by a stable explicit device key” | HTTP + PostgreSQL + mocked Jellyfin HTTP | A resolved Jellyfin job starts playback with a stable worker/slot device ID and a readable enrolled worker/slot display name. |
| R2 | `gpu-playback-reporting.test.js` — “reports accepted frame progress as an absolute bounded media position” | HTTP + PostgreSQL + mocked Jellyfin boundary | Accepted frame progress is added to the submitted start frame, converted at 25 fps, and capped at the half-open range end. |
| R3 | The terminal retry, cancel, pause, valid-abandon, and expired-lease cases in `gpu-playback-reporting.test.js` | HTTP + PostgreSQL + mocked Jellyfin boundary | Every coordinator path that tells a worker to stop reading closes the matching Jellyfin session. |
| R4 | The three “keeps … when Jellyfin … fails” cases in `gpu-playback-reporting.test.js` | HTTP + PostgreSQL + failing mocked Jellyfin boundary | Start, progress, and stop failures leave lease, heartbeat, and result responses successful and add an attempt-scoped coordinator note. |
| R5 | The bare-URL cases in `gpu-video-resolution.test.js` and `gpu-playback-reporting.test.js` | HTTP + PostgreSQL | A URL-backed job leases normally and invokes no Jellyfin playback method. |
| R6 | Existing `gpu-video-resolution.test.js` lease-body assertions plus source inspection | HTTP + PostgreSQL | The worker still receives a resolved URL through the existing contract; no worker playback endpoint or standing Jellyfin credential was added. |
| R7 | Controlled production check below | Real MARP API + local disposable PostgreSQL + production Jellyfin | Reporting authenticates as the configured service account and produces the unavoidable service-account playback update, without changing Jellyfin configuration. |
| R8 | `gpu-playback-reporting.test.js` — “reconstructs an expired attempt identity from PostgreSQL and stops its live session”; controlled restart check below | HTTP + PostgreSQL + mocked and production Jellyfin | Stop reconstructs its stable identity from existing attempt/job/worker/slot rows and reads the live position from Jellyfin after coordinator state is restarted. |
| R9 | `gpu-playback-reporting.test.js` — terminal result retry and rejected-heartbeat cases | HTTP + PostgreSQL + mocked Jellyfin boundary | A result retry finds no active session after the first stop, and an invalid worker report cannot close somebody else’s session. |
| R10 | The complete command list and controlled production check | Parse + HTTP + PostgreSQL + production Jellyfin | The changed GPU and Jellyfin tiers run against the disposable database, followed by a real end-to-end session lifecycle against production Jellyfin. |

## Requirements with no test

None. The automated tiers cover the coordinator and repository behavior. The production
session’s visibility and restart behavior are covered by the controlled real-system steps.

## Commands, in order

1. `git diff --check`
   - Expected: no whitespace errors or conflict markers.
2. Run `node --check` for `service/gpu-playback.service.js`, `service/gpu.service.js`,
   `repository/gpu.repository.js`, `repository/jellyfin.repository.js`, and
   `tests/gpu-playback-reporting.test.js`.
   - Expected: every changed JavaScript file parses.
3. `npm run test:subsystems`
   - Expected: the new suite belongs to the GPU group and every suite belongs to exactly
     one subsystem.
4. `npm run test:gpu`
   - Expected: all six GPU suites pass against the workspace's disposable PostgreSQL
     database, including the named lifecycle and failure cases above, and restore their rows.
5. `npm run test:media`
   - Expected: the Jellyfin repository suite passes against its mocked HTTP server,
     including stable device-key lookup and display-name authorization headers.
6. `npm run docs:dev:build`
   - Expected: developer documentation regenerates with the new playback service and
     repository methods.
7. `git diff --check` again after generated documentation and recorded results.

The whole repository suite is not in this package. Repository doctrine assigns it to the
end of a phase; this change has named GPU and Jellyfin tests at the tiers that observe it.

## Edge cases

- Progress below zero is bounded to the range start; progress beyond the piece is bounded
  to the range end.
- A worker rename changes Jellyfin's display name on a new login but not the device key used
  to recover an existing worker-slot session.
- A bare URL never opts into playback reporting.
- A wrong worker or lease epoch receives `abandon` but cannot close the live holder's
  session.
- A repeated terminal result sees no live session after the first stop and sends no second
  stopped report.
- Jellyfin start, progress, lookup, or stop failures remain operational notes and cannot
  change inference state.

## Regression coverage

Issue #133 had no previous implementation. The wrong-epoch case protects the existing lease
ownership rule while adding the new side effect, and the existing video-resolution suite now
asserts that URL-backed jobs remain completely independent of Jellyfin reporting.

## Known gaps

- The production check uses one real video item and the configured service account. It does
  not exercise every media format in Jellyfin because playback reporting carries only item
  identity and position and does not decode media.
- Jellyfin necessarily updates playback data for the configured service account. Before and
  after values will be recorded as evidence; this accepted effect is not rolled back by
  editing production data.
- No real inference worker or GPU is needed: the worker-facing HTTP calls are the same calls
  a worker makes, and this issue does not change inference execution.

## Manual steps

Use the workspace commands to discover its API and database addresses; do not copy an
environment-specific port into this file.

1. Confirm `marp db status` reports the issue workspace's disposable database and start the
   issue workspace API with its configured environment.
2. Through the running API, sign in to the disposable database, find one accessible real
   Jellyfin video item, submit a one-piece GPU job for it, enrol a clearly named temporary
   worker with at least two slots, and poll the job on one named slot.
3. In Jellyfin's live session listing, confirm one active session appears for `MARP GPU
   worker`, its device label contains the enrolled worker name and slot, and its item matches
   the submitted item.
4. Send a frame heartbeat and confirm Jellyfin's live position equals the submitted
   `start_frame + done` at 25 fps.
5. Stop and restart MARP_API without sending a playback stop, then expire the local attempt's
   lease using the disposable database. Trigger the normal job-detail sweep and confirm the
   same Jellyfin session disappears. This proves recovery without an in-memory playback map.
6. Repeat with a second short job and finish it through the result endpoint. Confirm the
   session disappears, then retry the identical result and confirm it does not reappear.
7. Record the configured service account's item user-data before and after. Confirm any
   play-count, last-played, played-state, or resume change is confined to that service
   account. Make no Jellyfin configuration change.
8. Remove the temporary local jobs and worker by destroying the disposable workspace
   database after evidence is recorded, and stop the issue workspace API.

---

## Results

Run 2026-09-13 against the issue workspace's disposable PostgreSQL database and the
configured production Jellyfin server.

- `git diff --check`: passed before verification.
- The five changed JavaScript files in step 2 passed `node --check`.
- `npm run test:subsystems`: passed, 53 suites assigned exactly once; the new playback
  suite is in the GPU group.
- `npm run test:gpu`: passed, 6 suites and 108 tests.
- `npm run test:media`: passed, 1 suite and 20 tests.
- `npm run docs:dev:build`: exited 0. It emitted the repository's existing JSDoc parse
  warnings and regenerated the developer pages, including the new playback service and
  test.
- Controlled production lifecycle using `20200618_155315_Fwd.mp4`:
  - a lease created an active `MARP API/MARP GPU worker` session whose device label named
    the temporary enrolled worker and `slot 1`;
  - an accepted 25-frame heartbeat for a range beginning at frame 100 produced exactly
    `50,000,000` ticks when inspected immediately;
  - reauthentication after a coordinator restart cleared the old active device session,
    and the normal expired-lease sweep marked the attempt abandoned without leaving it
    active;
  - a second session disappeared after a failed terminal result, and the identical result
    retry returned `idempotent: true` without recreating it;
  - the repeatable cleanup removed both temporary jobs and their temporary worker from the
    disposable database;
  - the configured service account's play count moved from 1 to 3, its last-played time
    advanced, and Jellyfin marked the item played with a zero resume position. No Jellyfin
    configuration was changed.

Three setup attempts failed before the successful run and are part of the evidence:

1. The first local API login returned HTTP 401 because the disposable database had no
   review user. Running the repository's repeatable `create-review-user.js` seeder created
   the local test user; no production database was used.
2. Jellyfin returned HTTP 400 when a Unicode middle dot appeared in the MediaBrowser
   `Device` value. The device label now uses the ASCII text ` - slot `, after which
   authentication succeeded. Targeted GPU-playback and Jellyfin tests passed after the fix.
3. The first session inspector authenticated again with the worker's own stable device ID,
   which Jellyfin treats as replacing that device session and therefore made the active
   item disappear. The corrected verifier inspected `/Sessions` through a separate
   identity; it then observed the start and exact progress above. Reauthenticating the
   stable worker identity was separately confirmed to clear the previous active session,
   which is the restart recovery behavior used by the implementation.

After recording these results, developer documentation regenerated again with the final
ASCII device label. The final parse checks, `npm run test:gpu` (6 suites, 108 tests),
`npm run test:media` (1 suite, 20 tests), and `git diff --check` all passed.
