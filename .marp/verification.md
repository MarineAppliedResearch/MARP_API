# Verification — MarineAppliedResearch/MARP_API#128 ML Dashboard data layer

**Nothing here has been run.** This is the plan for review (G3). Four of the checks it
names exist and have been run during implementation; four have to be written.

Everything runs from `frontend/apps/marp-ml-dashboard`.

## The one thing to read before the table

**None of this proves anything about MARP's API.** The data layer is fixture data shaped
like the API. Every test below asks whether the dashboard reads from that layer correctly,
and whether the layer's *shape* matches what the routes really return. Whether MARP then
behaves as its contract says is a different question this task does not touch and cannot
answer.

`api-contract-check` is the nearest thing to an exception: it compares the enums the layer
copies against MARP's own definitions, so a state added to MARP and not here fails. That is
a contract check, not an integration test.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `npm run check:markup` | parse | No screen states a card number, breakdown, panel count, donut legend or table row in its markup, and no region a renderer owns is left with nothing behind it. Fails both ways. **Exists.** |
| R1 | `node tools/screens-check.mjs` | browser | Every screen fills its own cards, sub-lines, legend and table from the layer — filled elements counted against elements present, on all eight. **To write.** |
| R2 | `node tools/data-layer-check.mjs` | browser | `GET /gpu/jobs` answers `{jobs, total, limit, offset}` and honours `limit`/`offset`; `GET /gpu/workers` answers a bare array with no paging; `POST /gpu/jobs` answers `200`, not `201`; a job carries the attempt's own progress field names. **To write.** |
| R2 | `npm run check:contract` | parse | `JOB_KINDS`, `JOB_STATES`, `WORKER_STATES`, the live attempt states and `MlModel.status` match MARP's definitions, read from `config/gpu-orchestration.js` and the generated contract. **Exists.** |
| R3 | `node tools/data-layer-check.mjs` | browser | Two loads of the same page produce byte-identical JSON for jobs, workers, models and datasets. Every render check rests on this, so it is asserted rather than assumed. **To write.** |
| R4 | `node tools/data-layer-check.mjs` | browser | The pool is 143 machines and the job window is in the hundreds, with slot counts and live attempts consistent between the two. **To write.** |
| R4 | `npm run shots -- workers` | render | The Workers table is legible at desktop and phone width at full pool size; fails on a console error and on anything cut off at the right edge. **Exists.** |
| R5 | `node tools/data-layer-check.mjs` | browser | All six of MARP's job states occur; at least one cancelled job holds a live attempt, the only way `cancelling` is derivable; at least one batch holds both a succeeded and a failed piece, the only way `issues` is derivable. **To write.** |
| R6 | `node tools/data-layer-check.mjs` | browser | `?mock=slow` makes a call take about two seconds; `?mock=fail:jobs` makes the job routes throw a 500 while the worker routes still answer. **To write.** |
| R6 | `node tools/screens-check.mjs` | browser | With `?mock=fail:jobs` the Jobs table shows its error row and a Try again control; the default path shows neither. The error state exists because the layer can produce one. **To write.** |
| R7 | `node tools/screens-check.mjs` | browser | On Jobs, Workers, History and Models: a filter narrows the count, a sort orders the whole filtered set, and the pager moves to rows continuing that order. **The sort assertion crosses a page boundary deliberately** — sorting only the visible page was the defect this found three times. **To write.** |
| R8 | `npm run check:contract` | parse | The enums the layer copies are MARP's. The route shapes themselves are written down in `.marp/task.md` under *The current surface, measured*, read from the generated contract — reviewed, not executed. **Exists.** |
| R10 | `node tools/screens-check.mjs` | parse | No file outside `mockups/api.js` names an `/api/v2/` route path, so swapping the module for real `fetch` calls is a change in one file. **To write.** |
| R11 | `package.json`, by review | — | No server, no database, no build step: no bundler, no build script, and the data layer adds no runtime dependency. See below. |

## Requirements with no test

- **R9** — *each remaining gap is either closed or listed in `DESIGN.md` with the reason.*
  A documentation requirement, verified by reading. `DESIGN.md` carries 28 gaps; six of them
  (23 to 28) were added during this task and all six are open on purpose, per the decision
  of 2026-10-14. Nothing mechanical distinguishes a complete gap list from an incomplete one.
- **R11** is checkable only in the negative. "No server, no database" is true by inspection
  — the layer is a plain script that makes no network call of its own — and nothing would
  catch somebody adding one except the route-path check written for R10. Worth knowing that
  the coverage is indirect rather than believing it is firmer than it is.

## Edge cases the tests must include

- A job with **no heartbeat yet**: `progress_done` is null, and the cell draws a dash rather
  than a 0% bar. Required by `DESIGN.md` since #104 measured it; a 0% bar is the most
  believable way to claim a measurement that does not exist.
- A worker **never heard from**: `last_seen_at` is null and the column says so rather than
  computing an age from nothing.
- A **page boundary** inside every sort assertion.
- An **empty result**: a filter matching nothing shows the empty row, not a blank table.
- The **mixed batch must be on the first page**. A state reachable only on page four is
  reachable in the data and invisible on the screen somebody opens.

## Regression coverage

Each names a defect found during implementation, so the check fails if it returns.

- `markup-check` fails if a value is written back into a screen, **or** if a region is
  blanked with no renderer behind it. The second half caught the Jobs status donut, which
  had no renderer and had been showing hardcoded values all along.
- `api-contract-check` fails if a page stops loading `api.js`, or loads it after `mock.js`.
  A missing global made every renderer return silently and draw nothing.
- `api-contract-check` fails if the dashboard believes in a job kind or model status MARP
  does not have. Models was built against *Ready / Testing / Error*, none of which exists.
- The R7 sort assertions fail if the generic DOM sorter is rebound to a data-driven table.
  That appeared three times, once per screen, each time leaving the arrow claiming ascending
  over descending rows.

## Known gaps — what this does not cover

- **The five sampled-series graphs**: GPU pool utilization, jobs activity, inference
  throughput, dataset build telemetry and registry trends. None has an API behind it (gaps
  18 to 22); all five stay deterministic design data, drawn and labelled as previews.
  Nothing asserts their values because there is nothing to assert them against.
- **The Inference submission form's deeper surfaces** — the cascading video selector, the
  execution-pipeline contract, the run-plan groups (#180's R19 to R29). Untouched design
  data; only the form's model pickers were wired.
- **The Training runs table**, for a sharper reason: `/v2/training_run` has only a `POST`, so
  nothing can list a run. The table says so in its own header.
- **Anything about the real API.** Restated because it is the easiest thing to forget: a
  green run here means the dashboard reads its fixture correctly, not that MARP works.
- **Accessibility and keyboard operation**, beyond `aria-sort` agreeing with the drawn
  arrow. #180's R5 covered this for the Dashboard; nothing re-checks it here.
- **The browser tier is one browser.** These run in headless Chromium, as every check in
  this app does.

## Manual steps

For Isaac, after the automated checks pass. Each is a judgement a check cannot make.

1. Open all eight screens and confirm the numbers agree *between* them. The running job
   count on Dashboard, Jobs and Inference must be the same number, because one corpus feeds
   all three. Disagreement there is the failure mode this whole task exists to prevent.
2. Open Jobs with `?mock=slow` and watch the loading row; then `?mock=fail:jobs` and judge
   whether the error reads like something an operator could act on.
3. Look at a column that is deliberately a dash — Workers' GPU load, Models' training
   dataset, Training's epochs — and judge whether the absence reads as *not recorded*
   rather than as broken. That judgement is the entire point of drawing them that way and
   no check can make it.
4. Confirm the gap list still describes the system you want. It is the backlog the API work
   will be planned from.
