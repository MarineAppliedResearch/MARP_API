---
task: MarineAppliedResearch/MARP_API#128
repos: [MARP_API]
status: design
needs: []
---

## Goal

The eight Machine Learning Dashboard screens stop being pictures. Filters filter, sorting
sorts, paging pages, and a screen can be seen loading, empty and broken rather than only
succeeding instantly. Every value comes from one module shaped like the real API, so wiring
MARP in later is a change of source and not a change of vocabulary.

## Requirements

- **R1** — One module is the only thing the screens read from. No screen carries a value in
  its markup.
- **R2** — Request and response shapes match the real routes, including the awkward ones:
  `204` for no work, paging on `GET /gpu/jobs` but not on `GET /gpu/workers`, and `200`
  rather than `201` from `POST /gpu/jobs`.
- **R3** — The data is deterministic from a fixed seed. Two people on the same screen see
  the same numbers, and a regenerated fixture is byte-identical.
- **R4** — Enough rows to exercise the screens honestly: the Workers screen drawn for 143
  machines, the History screen for a bounded window over hundreds of jobs.
- **R5** — Every state a screen draws is reachable in the data, including the awkward ones:
  `cancelling`, which is derived rather than stored (`state == 'cancelled'` with a live
  attempt, measured at 18-20 seconds), and *completed with issues*, which has no enum value
  and no parent object to hang it on.
- **R6** — Latency and failure are producible, so loading and error states exist because the
  layer can make them happen rather than because somebody drew them.
- **R7** — Filters, sorting, paging and search operate against the layer rather than being
  drawn.
- **R8** — The current API surface is written down per route, checked against the code
  rather than against prose.
- **R9** — Each remaining gap is either closed or listed in `DESIGN.md` with the reason.
- **R10** — Swapping the module for real `fetch` calls is the whole of the wiring work.
- **R11** — No server, no database, no build step. A local module, not a second
  implementation of MARP.

## The current surface, measured

Read from `docs/openapi.generated.json` and `routes/gpu.routes.js` on `develop`, not from
#104's measurement comment, which is a year of assumptions ahead of anything else written
down and is a comment rather than a contract.

Fourteen routes are registered, not the twelve #128 names. Three are dashboard-facing; the
rest are the worker protocol (poll, heartbeat, events, result, the artifact hand-off) and
are not read by any screen.

- `GET /api/v2/gpu/workers` → an array, unpaged. `worker_id`, `name`, `state`, `slot_count`,
  `enrolled_at`, `activity` (derived, never stored), `attempts[]`; nullable `worker_version`,
  `capabilities`, `last_seen_at`.
- `GET /api/v2/gpu/jobs` → `{ jobs[], total, limit, offset }`, newest first, default 50 and
  capped at 500, ordered `created_at` then `id`. Each job: `id`, `kind`, `spec`, `state`,
  `priority`, `attempts_made`, `max_attempts`, `created_at`, `updated_at`; nullable
  `batch_id`, `published_attempt_id`, `created_by`.
- `GET /api/v2/gpu/jobs/:id` → `{ job, attempts[], artifacts[] }`.

## Open assumptions

- [x] **A1 · API contract · blocking** — answered 2026-10-14: the job list carries a
  progress summary. The real route will have to learn to, exactly as gap 12 already says of
  worker paging, so this joins `DESIGN.md`'s gap list rather than being closed quietly. The
  screen is not to make a detail call per visible row.
- [x] **A2 · API contract · blocking** — answered 2026-10-14: serve the API's shape —
  `progress_done`, `progress_total`, `progress_unit`, `progress_phase`,
  `progress_elapsed_s` — and let the screen compute the percentage. It can then render
  "1,240 of 3,000 frames" and keep the phase, and null before the first heartbeat still
  draws a dash rather than a 0% bar. The mockup's flat percent with `-1` goes.
- [x] **A3 · product/UI · blocking** — answered 2026-10-14: an explicit switch, set by query
  parameter — `?mock=slow`, `?mock=fail:jobs`. The default path is instant, successful and
  deterministic, so R3 is untouched and a failure is reproducible by URL and can be
  demonstrated on purpose.
- [x] **A4 · architectural · non-blocking** — answered 2026-10-14 by following the pattern
  already in the repository: `mockups/api.js`, a plain script loaded before `mock.js` and
  exposing one global. `mock.js` is a plain script and cannot `import` without becoming a
  module, and converting it is a change this task did not ask for.
- [x] **A5 · API contract · non-blocking** — answered 2026-10-14: the three dashboard-facing
  routes plus the three mutations a screen performs (submit, cancel, rename). The worker
  protocol — poll, heartbeat, events, result, the artifact hand-off — is not modelled,
  because no screen reads it and a fixture nothing exercises is a fixture that rots.
- [ ] **A6 · product/UI · blocking** — *Found during G2.* R5 requires *completed with issues*
  to be reachable, and gap 2 records that it has no enum value and no parent object to hang
  it on. So the layer has to derive it from something, and which something is a real choice:
  a job that succeeded after earlier attempts failed; one that succeeded with `progress_done`
  short of `progress_total`; or a warnings field that exists on no table today and would make
  this a schema request rather than a derivation. Each tells the operator a different thing,
  and the first two are already distinguishable in the data while the third is not.

## Decisions

- **2026-10-14** — The surface is read out of the generated contract and the route files
  rather than out of #104's measurement comment.
- **2026-10-14** — A1, A2 and A3 above, from Isaac. Together they settle that the data layer
  serves the shape the API will have rather than the shape the mockup drew, and that the
  distance between the two is recorded in `DESIGN.md` rather than hidden inside the module.

## Plan

1. Record the job-list progress gap as `DESIGN.md` gap 23, and correct gap 16's shape list
   if the progress mismatch belongs beside it.
2. The module: the three dashboard-facing routes, the seeded generator, and the `?mock=`
   switch. Shapes exactly as measured above.
3. The generator's scale and reachable states — 143 machines, a bounded window of hundreds
   of jobs, `cancelling` and *completed with issues* among them.
4. Screen by screen, move every value out of the markup and onto the module, starting with
   Jobs because it carries the progress change.
5. Filters, sorting, paging and search against the module rather than the DOM.
6. Loading, empty and error states, proven by the switch.

## Acceptance criteria

- No screen carries a value in its markup, and deleting the module breaks every screen.
- A regenerated fixture is byte-identical to the previous one.
- The Workers screen draws 143 machines and remains usable.
- Each screen can be seen loading, empty and failed.
- Every item in `DESIGN.md`'s gap list is still true, or has moved, with the reason.

## Test plan

Filled in at G3.

## Status

- **Gate:** design — A6 appeared during G2 and is blocking
- **Notes:** Steps 1 to 3 of the plan are done. `DESIGN.md` carries gap 23; `mockups/api.js`
  serves the three read routes and the three mutations from a seeded corpus of 143 machines
  and 420 jobs, with the `?mock=` switch; `tools/api-contract-check.mjs` fails when the
  enums drift from `config/gpu-orchestration.js`, and was proved to fail before it was
  believed. Verified in a browser: byte-identical across reloads, every API job state
  reachable, `cancelling` derivable, `fail:jobs` returning 500 while workers stay up, `slow`
  at 2003ms. Step 4 — moving Jobs onto the module — is where *completed with issues* has to
  be drawn, so A6 blocks it rather than the whole task.
