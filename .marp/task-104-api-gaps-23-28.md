---
task: MarineAppliedResearch/MARP_API#104
repos: [MARP_API]
status: implementing
needs: []
---

## Goal

Close the six API gaps the ML Dashboard found while it was being wired, so the columns,
filters and cards the screens already draw are answered by MARP rather than computed in the
browser or drawn as a dash. After this the Jobs list carries progress and can be asked about
time, sorted and searched; a job can be given a name and found by it; the pool view reaches
the machine telemetry the workers already report; and the model registry can say which model
is preferred and which dataset is still building.

These are items 23 to 28 of `DESIGN.md`'s *What has no API behind it*, written down while
wiring #128 and deliberately left until the dashboard settled. It has now settled -- #180
(the design review) and #128 (the data layer) are both merged -- so this is that pass.

## Requirements

- **R1** -- `GET /gpu/jobs` carries each job's progress, so a page of fifty rows draws fifty
  progress bars from one request rather than fifty-one. *(gap 23)*
- **R2** -- `GET /gpu/jobs` can be asked a question about time, so *Completed today* is a
  query rather than a count over whatever window happened to be fetched. *(gap 24)*
- **R3** -- a job can be given a name at submit and found again by it. *(gap 25)*
- **R4** -- `GET /gpu/jobs` can be sorted and searched, so sorting and paging stay honest
  together once the list is paged server-side. *(gap 26)*
- **R5** -- `GET /gpu/workers` returns the machine telemetry already stored on the attempt,
  so the GPU load, VRAM and temperature columns have a source. *(gap 27)*
- **R6** -- a model can be marked preferred. *(gap 28)*
- **R7** -- a model's version chain can be fetched without the caller walking
  `parent_model_id` itself. *(gap 28)*
- **R8** -- a dataset has a status, so the Datasets screen can say one is building. *(gap 28)*
- **R9** -- training runs can be listed. `/api/v2/training_run` has `POST`, and `GET`, `PUT`
  and `DELETE` on `/:id`; what it has no route for is the collection, so a training run can
  be created and fetched by id and never listed. *(gap 28)*

**Not a requirement, and why.** Gap 28 also asks *how many workers hold this model cached*.
Nothing in MARP records that -- not the enrolment capabilities, not the poll, not anywhere --
so it cannot be served from what exists. It needs the worker to report its cache, which is
`marp-inference-worker` work and a second repository.

## Open assumptions

**All answered 2026-10-15.** Isaac: *"i don't have strong opinions about these, lets go with
what we judge as the best design choice"* -- so each answer below is the agent's judgement,
recorded with its reason so that a later disagreement has something to argue with rather than
a silent default to discover. A16 is the one that was put to him as genuinely his; the answer
taken is the one that invents the least.

### Gap 23 -- progress on the job list

- [x] **A1 · API contract · blocking** -- answered 2026-10-15: **flat**, the attempt's own
  column names (`progress_done`, `progress_total`, `progress_unit`, `progress_phase`,
  `progress_elapsed_s`) carried straight onto the job. The pool view nests because an attempt
  there is already an object; a job is not. Flat also matches what the dashboard's data layer
  already serves, so wiring it is a deletion rather than a mapping -- item 16's warning is
  about mappings, and this avoids creating one.
- [x] **A2 · data-meaning · blocking** -- answered 2026-10-15: **the latest attempt, whatever
  its state**, ordered by `id DESC`. A failed job showing how far its last try got is useful;
  a failed job showing nothing is a second way of saying "failed". Nulls still mean "no
  heartbeat yet" and still draw a dash rather than 0%.
- [x] **A3 · performance · non-blocking** -- answered 2026-10-15: **always**. It is one join
  on an indexed foreign key, and an `?include=` flag is a second code path to keep correct
  for a saving nobody has measured.

### Gap 24 -- asking the job list about time

- [x] **A4 · data-meaning · blocking** -- answered 2026-10-15: **`gpu_jobs` gains its own
  `finished_at`**, set when the job reaches a terminal state. `updated_at` moves on any write
  -- a heartbeat, a retry, a priority read-modify-write -- so filtering on it would answer a
  question about *touched today*, which is not the question. Existing terminal rows are
  backfilled from the last attempt's `finished_at`, falling back to `updated_at` where there
  is no attempt, so nothing currently answerable stops being answerable.
- [x] **A5 · behavioural · blocking** -- answered 2026-10-15: **absolute instants**. The
  client sends `created_after` / `created_before` / `finished_after` / `finished_before` as
  timestamps and MARP never has an opinion about where a day starts. A server-side "today"
  would be wrong for anyone not in the server's timezone and would be wrong silently.
- [x] **A6 · API contract · non-blocking** -- answered 2026-10-15: **the date range on the
  list**, no separate counts endpoint. `total` already comes back with every page, so a card
  asks for `limit=1` with its range and reads `total`.

### Gap 25 -- naming a job

- [x] **A7 · database/schema · blocking** -- answered 2026-10-15: **a `name` column on
  `gpu_jobs`**. R4 has to search it, and searching inside a JSON blob means either a
  functional index or a sequential scan.
- [x] **A8 · behavioural · blocking** -- answered 2026-10-15: **optional, null when absent,
  no composed fallback.** The screens already compose a label from `spec.video.source_name`
  and they are the ones that know what their column is for. A fallback composed in MARP would
  be indistinguishable from a name a person chose, which is the kind of ambiguity the
  platform rules single out.
- [x] **A9 · behavioural · non-blocking** -- answered 2026-10-15: **not in this pass.** It is
  the first job update route and it belongs with gap 3 (reprioritising), which is Milestone 2.

### Gap 26 -- sort and search

- [x] **A10 · API contract · blocking** -- answered 2026-10-15: **the four that live on
  `gpu_jobs`** -- `name`, `kind`, `state`, `created_at` -- plus `finished_at` now that A4 adds
  it. *Progress* and *Worker* sort on the joined attempt and can follow once there is a
  measurement saying the join is affordable at scale.
- [x] **A11 · behavioural · blocking** -- answered 2026-10-15: **`name`, the video's
  `source_name` inside the spec, and `batch_id`.** Those are the three things visible on the
  row, and a search that matches something invisible looks broken.
- [x] **A12 · architectural · blocking** -- answered 2026-10-15: **stays a browser-side
  narrowing**, and `DESIGN.md` keeps saying so. A `HAVING` over batches cannot be paged with
  the rows it filters, so making it a query would trade a visible limitation for a subtle one.

### Gap 27 -- telemetry on the pool view

- [x] **A13 · API contract · blocking** -- answered 2026-10-15: **a reduced subset.** The
  attempt carries `telemetry: {gpus: [{index, name, utilization, memory_used_mb,
  memory_total_mb, temperature_c, power_usage_watts, power_limit_watts}], as_of}` rather than
  the whole `capabilities_snapshot`. Gap 12 already records the pool read as megabytes a
  refresh at #104's scale, and a second blob per live attempt makes the worse problem worse.
- [x] **A14 · product/UI · blocking** -- answered 2026-10-15: **show it with its `as_of`.**
  A number known to be from 14:02 is worth more than a dash, provided the screen says 14:02.
  An idle machine keeps the dash, because it genuinely has no reading.

### Gap 28 -- the model registry

- [x] **A15 · database/schema · blocking** -- answered 2026-10-15: **per `model_type`**, as a
  boolean `preferred` with a partial unique index so one model_type cannot have two. Registry-
  wide would mean one preferred model for detection and segmentation together, which is not a
  choice anybody wants to make.
- [x] **A16 · data-meaning · blocking** -- answered 2026-10-15: **a recorded fact, written by
  whoever creates or updates the dataset through the routes that already exist.** MARP does
  not run the build and this does not pretend it does. `status` is
  `draft | building | ready | failed`, NOT NULL, default `draft`; existing rows backfill to
  `ready`, because every dataset in the database now is a finished one with its `num_samples`
  filled in.

  **What this deliberately does not settle** is what performs a dataset build. That is gap 19
  and it is still open -- the Datasets fixtures name a `gpu-build-02` worker and nothing in
  the API backs it. The column means "what the thing doing the building last said", and until
  something is doing the building, nothing will move a row off `draft` but a caller.
- [x] **A17 · API contract · non-blocking** -- answered 2026-10-15: **a separate
  `GET /ml_models/:id/versions`.** Inline would make every registry read walk a self-join for
  the callers that only want the list.

### Across the pass

- [x] **A18 · scope · blocking** -- answered 2026-10-15: **the API only.** Rewiring
  `mockups/api.js` and the screens is a following pass, and it is cheap once the shapes here
  are fixed. Doing both at once would mean a change set where a dashboard failure and a route
  failure look the same.
- [x] **A19 · security/permissions · non-blocking** -- answered 2026-10-15: **reuse the
  neighbouring permissions.** Nothing here is a new kind of access -- it is more of what the
  same caller could already read or write -- so no permission seeding migration.

## Decisions

- **2026-10-15** -- this work goes under **#104, *Design the MARP Machine Learning
  Dashboard***, which is where the gap list was recorded. No new issue; MARP_API#180 and
  MARP_API#128 are both closed.
- **2026-10-15** -- branched from the gap 27 correction rather than from `develop`, because
  that correction is what makes R5 a one-field change instead of a telemetry project.
- **2026-10-15** -- the worker model-cache count is out of scope. It cannot be served from
  anything MARP stores.
- **2026-10-15** -- the assumptions were answered by the agent at Isaac's direction rather
  than by Isaac. Each carries its reason above for exactly that reason.

## Plan

1. One migration adding `gpu_jobs.name` and `gpu_jobs.finished_at`, backfilling `finished_at`
   from the last attempt.
2. One migration adding `ml_models.preferred` and `datasets.status`, with the partial unique
   index and the backfill to `ready`.
3. The models, so the new columns are readable.
4. `listJobs` in the repository and service: the latest-attempt join, the date range, sort and
   search; `submitJob` takes a name.
5. `listWorkerPoolRows` and `listPool`: the telemetry subset on the live attempt.
6. The routes and their swagger: new query parameters, the versions route, the training run
   collection route.
7. Regenerate the contract rather than hand-editing it.
8. `DESIGN.md`: gaps 23 to 28 move from "no API behind it" to what the API now answers, with
   what is still missing stated rather than dropped.

## Acceptance criteria

- A page of the Jobs list draws every progress bar from one request.
- *Completed today* is answered by a query that does not depend on how many rows were fetched.
- A job submitted with a name is found by searching for that name.
- Sorting the Jobs list by any sortable column and turning the page shows the next rows in
  that order, not the next page re-sorted.
- A working machine's pool entry carries its GPU telemetry and the instant it was taken; an
  idle one carries none.
- The registry says which model is preferred per type; a dataset says whether it is building.
- Training runs can be listed over a route.
- `tools/api-contract-check.mjs` and the dashboard's other checks still pass.

## Test plan

G3, after implementation. Each requirement gets a test at a tier that can see it: route and
contract tests for R1 to R9 (shapes, filters, sort order across a page boundary), a migration
test for the backfills, and no browser tier, because A18 keeps the dashboard out of this pass.
