# Verification — MARP_API #176 and #178: Mosaic inspection

This is the G3 verification plan. The fast tests run while implementing are feedback, not
the approved G4 record. Do not run the browser or live-media steps until the human approves
this plan.

## What each test proves

| Requirements | Evidence | Tier | What it proves |
| --- | --- | --- | --- |
| R1–R3 | `observation-id.test.mjs`; `full-frame.spec.mjs` | unit + real browser | Every details panel shows the exact primary key as compact selectable metadata with no copy control; the panel and pending mark remain open. |
| R4–R7 | `thumbnails.test.js` full-frame block | HTTP + database | A request captures the ready thumbnail's exact frame/subset, persists one job, preserves an in-flight duplicate, and shares the reviewer-priority FIFO ahead of background work. |
| R8–R9 | `frame-viewer.test.mjs`; `full-frame.spec.mjs` | unit + real browser | The viewer fits landscape and portrait frames, supports pinch and button zoom, pans, zooms directly to the box, traps focus, closes with browser Back, and returns to the same URL, marked tile, and details panel. |
| R10–R12 | `thumbnails.test.js`; approved live observation | HTTP + database + media/manual | Delivery requires `observations:read`, uses private revalidation, reports missing/retryable state, preserves native dimensions, and the generated JPEG can be judged at source quality without leaking Jellyfin details. |
| R13 | `mosaic-query.test.js`; missing-file and replacement tests in `thumbnails.test.js` | HTTP + database | Availability rides on the normal Mosaic row, eviction clears it, and a thumbnail replacement invalidates a full frame from the old moment. |
| R14 | Every named command below | unit + HTTP + database + browser | Each changed layer has a test that can observe its own behavior. |
| R15 | Diff review and browser network log | source + browser | No video player, playback stream, or persistent playback lifecycle from #181 is introduced. |
| R16–R17 | `thumbnail-storage.test.js`; cache tests in `thumbnails.test.js` | unit + database + filesystem | One internal storage boundary counts unique physical files, protects shared content-addressed bytes, evicts DB availability and bytes together, and makes evicted artifacts re-creatable. |
| R18–R19 | admin tests in `thumbnails.test.js` and `dashboard-shell.test.js` | HTTP + database + source contract | Only admins can read/write policy; values persist and validate; lowering a limit enforces eviction; the dashboard exposes and explains the limit, watermark, order, split usage, paths, result, and errors. |

## Requirements with no automated test

- Human judgement of whether a native-size JPEG is visually faithful to the live source
  cannot be reduced to dimensions and encoding metadata. The supervised Jellyfin step
  covers it.
- The legacy admin dashboard has a source-contract test rather than a new browser harness.
  Its functional behavior is exercised through the real admin API; its visible layout is
  checked once in the manual dashboard step because that application is already scheduled
  for replacement.

## Commands, in order

1. `git fetch origin`, followed by checking that the feature branch contains the current
   `origin/develop`.
   - Stop and integrate first if `develop` moved; verification against a stale base is not
     evidence about the repository that will receive the pull request.
2. `git diff --check` and `..\scripts\marp.ps1 spec check`.
   - Expected: no whitespace/conflict errors; all 19 requirements and 11 assumptions are
     accepted at the verification gate.
3. Against the database named by `.marp/local/testing-database.json`, run
   `npx sequelize-cli db:migrate:undo --name 20260913210000-add-review-imagery-cache.js`
   and then `npx sequelize-cli db:migrate`.
   - Expected: the additive cache migration reverses and reapplies cleanly on the disposable
     database. No development or production database is migrated by this check.
4. `npm run docs:api:build`, then `git diff --check`.
   - Expected: the generated contract contains the admin policy endpoint and the full-frame
     request/download endpoint, with no hand-edited generated output.
5. `npm run test:app:mosaic-review:unit`.
   - Expected: all Mosaic syntax/model/store/geometry/identity tests pass.
6. Against the same disposable database, run
   `npx jest tests/thumbnails.test.js tests/mosaic-query.test.js tests/thumbnail-storage.test.js tests/dashboard-shell.test.js --runInBand --forceExit`.
   - Expected: queue, routes, persistence, permissions, storage accounting, eviction,
     dashboard contract, and Mosaic row-shape checks all pass.
7. `npm run test:app:mosaic-review:api -- full-frame.spec.mjs`.
   - Expected: the named inspection tests pass in both desktop and phone projects against a
     real temporary API and the disposable testing database; the launcher stops its API.
8. Open the admin dashboard against the disposable database, read the review-imagery panel,
   make one valid no-eviction settings change, and restore the values shown before the edit.
   - Expected: split usage, resolved locations, configured maximum/order/watermark and the
     save result remain legible at desktop and phone widths; errors do not erase old values.
9. With the human present, use a disposable observation whose source video resolves in
   Jellyfin: request its full frame, keep reviewing while it runs, then open it.
   - Expected: interactive work is first, the complete native-resolution frame appears at
     the thumbnail's exact moment, the box is aligned and toggleable, and zoom reveals the
     source detail. Do not run this unattended because it contacts live Jellyfin.
10. Run final `git diff --check` and record every command's real output, including failures,
    below.

The full repository suite and complete Mosaic browser suite are not part of this package.
Repository doctrine reserves them for the end of a phase; this milestone has named tests at
every layer it changes.

## Edge cases and regression coverage

- A second full-frame click while claimed keeps the original claim and FIFO timestamp.
- A replacement thumbnail that chooses another frame cannot leave the old full frame marked
  available; choosing the same frame does not invalidate it.
- Full-frame and replacement requests are peers, and both precede an older background job.
- A missing file changes a false `ready` record into re-creatable unavailable state.
- Identical content-addressed files are counted once and no row-level eviction deletes bytes
  still referenced by another row.
- Lowering the maximum evicts to the configured low watermark; validation or filesystem
  failure leaves the preceding policy active.
- Landscape and portrait source dimensions both fit entirely at 100%; zoom is bounded and
  panning cannot make the reset/close controls unreachable.
- A two-finger distance change produces bounded pinch zoom, and `Zoom to box` centers the
  labeled observation with context still visible around it. The image point beneath the
  gesture midpoint remains beneath it as the fingers move.
- A box that crosses a frame edge remains bounded to the visible image.
- Inspection does not commit, withdraw, correct, delete, or create scientific review data.

## Known gaps

- The automated browser test opens a seeded ready JPEG and separately proves an asynchronous
  request was accepted. It does not open a live Jellyfin stream; that is the supervised
  media step.
- The cache manager accounts for files referenced by ready database rows. Pre-existing
  orphan files, if any, need a later reconciliation/maintenance tool rather than being
  guessed away during a request.
- #181 remains the next milestone and owns source-video playback, scrubbing, and a player
  that can remain loaded but paused in the background.

---

## Results

Approved G4 run: 2026-09-14.

1. **Branch currency and specification — PASS.** Fetched `origin` and merged the current
   `origin/develop` into this feature branch. `git rev-list --left-right --count
   HEAD...origin/develop` reported `11 0`. `marp spec check` accepted all 19 requirements
   and all 11 answered assumptions at the verification gate.
2. **Disposable migration round trip — PASS.** Against `marp_test`, Sequelize reverted and
   reapplied `20260913210000-add-review-imagery-cache`, then applied
   `20260914100000-add-gpu-attempt-progress-phase`. The latter migration inspected 61
   existing GPU attempts and reported zero rows deleted, dereferenced, or orphaned.
3. **Generated API contract — PASS.** `npm run docs:api:build` completed with 130 documented
   paths. The generated output was regenerated after integrating `develop`, not edited by
   hand.
4. **Mosaic unit tier — PASS.** `npm run test:app:mosaic-review:unit` passed 288 tests with
   zero failures and zero skips. A later in-sandbox rerun first reported all 74 source files
   as unparsable because Windows denied every child `node --check` process with `EPERM`;
   running the same command with child-process permission passed all 74 parse checks and all
   288 tests again. No source correction was involved in that environment-only failure.
5. **HTTP, database, storage, and dashboard contract tier — PASS.** The four named Jest
   suites passed: 4 suites and 171 tests, with zero failures and zero skips. Full output is
   recorded in `tests/logs/test-run-2026-09-14T07-29-00-520Z.log`.
6. **Real-browser tier — FAIL, corrected, then PASS.** The first
   `npm run test:app:mosaic-review:api -- full-frame.spec.mjs` run passed four scenarios and
   failed two (desktop and phone). After browser Back closed the frame viewer, the assertion
   at `full-frame.spec.mjs:59` found that `.pick` was no longer visible. Investigation showed
   that a viewer-control click rerenders its DOM before the document dismissal handler runs,
   making the click look as if it occurred outside the selected observation. The dismissal
   rule now preserves the picker whenever the frame viewer is active. The exact rerun passed
   all 6 desktop and phone scenarios in 6.8 seconds; the runner stopped its temporary API.
7. **Supervised live-media behavior — PASS with a noted later refinement.** The human
   requested a frame from a real reviewing session and observed the non-blocking preparing
   state, roughly 5–10 second extraction, ready state, complete full frame at the expected
   moment, and aligned toggleable box. The human described the result as working and
   visually successful. Subsequent automated desktop/phone coverage proves the requested
   pure-color box, compact responsive labels, gesture-anchored pinch zoom, and Back behavior;
   the final gesture refinement has not separately been repeated against live media.
8. **Admin dashboard visual check — PASS.** The human inspected the explanatory review-
   imagery panel from the disposable port-3001 server and approved its current presentation.
   The automated API tier supplies the reversible settings-save, validation, persistence,
   and no-eviction evidence without requiring a destructive low-limit save through the UI.
9. **Final workspace checks — PASS.** `git diff --check` reported no whitespace or conflict
   errors. `marp spec check` again accepted 11 answered assumptions and 19 requirements at
   the `verify` gate. The feature branch contains current `origin/develop` and is 12 commits
   ahead with no commits behind at this point in the run.
