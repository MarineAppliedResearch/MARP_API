---
task: MarineAppliedResearch/MARP_API#104
repos: [MARP_API]
status: design
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
`marp-inference-worker` work and a second repository. See A12.

## Open assumptions

### Gap 23 -- progress on the job list

- [ ] **A1 - API contract - blocking** -- what shape does progress take on a job? The pool
  view nests it (`progress: {done, total, unit, phase, elapsed_s}`); the attempt's own
  columns and the dashboard's data layer are flat (`progress_done`, `progress_total`, ...).
  Two shapes for one thing is item 16's warning. Which one wins?
- [ ] **A2 - data-meaning - blocking** -- a job can have several attempts. Whose progress is
  the job's: the latest attempt whatever its state, or only a live one, so a failed job shows
  nothing rather than how far its last try got?
- [ ] **A3 - performance - non-blocking** -- always, or only when asked for with
  `?include=progress`? Always is one extra join on every list read; opt-in keeps the cheap
  read cheap and gives the dashboard a flag to set.

### Gap 24 -- asking the job list about time

- [ ] **A4 - data-meaning - blocking** -- **`gpu_jobs` has no finished timestamp.** It has
  `created_at` and `updated_at`, and `finished_at` lives on the *attempt*. So *completed
  today* can be filtered on `updated_at` (which moves on any write and is therefore not
  quite "finished"), derived from the attempt, or `gpu_jobs` can gain a `finished_at` of its
  own. Which?
- [ ] **A5 - behavioural - blocking** -- whose "today"? The server's UTC day, or does the
  client send absolute instants and MARP never has an opinion about days at all?
- [ ] **A6 - API contract - non-blocking** -- a date range on the list, a counts endpoint, or
  both? The cards want counts and the table wants rows, and one route serves both only by
  fetching rows nobody draws.

### Gap 25 -- naming a job

- [ ] **A7 - database/schema - blocking** -- where does the name live: a `name` column on
  `gpu_jobs`, or a field inside the `spec` JSON? A column is indexable and searchable and
  costs a migration; a spec field costs nothing and cannot be searched cheaply. R4 wants to
  search it, which pulls toward the column.
- [ ] **A8 - behavioural - blocking** -- required at submit, or optional? If optional, does
  MARP compose a fallback (today the screens compose one from `spec.video.source_name`), or
  leave it null and let the caller decide what to draw?
- [ ] **A9 - behavioural - non-blocking** -- can a name be changed after submit? That is a
  PATCH route, and gap 3 records that no job update route exists at all, so it would be the
  first one.

### Gap 26 -- sort and search

- [ ] **A10 - API contract - blocking** -- which columns sort? *Job*, *Type*, *Status* and
  *Submitted* are columns on `gpu_jobs`. *Progress* and *Worker* are not -- they live on the
  joined attempt, so sorting by them is a different and more expensive query. Are they in?
- [ ] **A11 - behavioural - blocking** -- what does search match? The name (A7), the video's
  `source_name` inside the spec JSON, `batch_id`, the job id, or all of them?
- [ ] **A12 - architectural - blocking** -- the *Issues* filter is derived by grouping on
  `batch_id` and finding both a success and a failure. Does the route learn that grouping, or
  does it stay a browser-side narrowing that is only as complete as the page in hand?

### Gap 27 -- telemetry on the pool view

- [ ] **A13 - API contract - blocking** -- the whole `capabilities_snapshot` blob per
  attempt, or a reduced telemetry subset? Gap 12 already records that the capabilities blob
  makes `GET /gpu/workers` megabytes a refresh at #104's assumed scale, and this would add a
  second blob per live attempt.
- [ ] **A14 - product/UI - blocking** -- the snapshot is taken when the lease opens, not now,
  and an idle machine has none at all. Does the Workers screen draw it with a qualifier ("as
  of 14:02"), or keep the dash until #214 -- *ML dashboard: worker power draw, idle baseline,
  and delta above idle* -- delivers something live? **#214 is itself blocked on six unanswered
  assumptions**, so "wait for #214" means waiting on that gate too.

### Gap 28 -- the model registry

- [ ] **A15 - database/schema - blocking** -- *preferred* on what axis? One preferred model
  across the whole registry, one per `model_type`, or one per session type, which is how the
  dashboard's own data layer already keys models so `checkSessionTypeAgainstModel` never
  refuses them.
- [ ] **A16 - data-meaning - blocking** -- what are a dataset's statuses, and **what writes
  them**? A dataset build is not a GPU job (settled 2026-10-14 in #128), so no worker moves
  one to `ready`. Without naming the process that sets the status, the column is a field
  nothing fills.
- [ ] **A17 - API contract - non-blocking** -- does `GET /ml_models` return the version chain
  inline, or is it a new `GET /ml_models/:id/versions`? Inline makes every list read walk a
  self-join for callers that do not want it.

### Across the pass

- [ ] **A18 - scope - blocking** -- does this pass also rewire `mockups/api.js` and the
  screens onto the new fields, or stop at the API and leave the dashboard to a following
  pass? A gap is not visibly closed while the screen still draws a dash, but the two are
  separable and the second is cheap once the first is settled.
- [ ] **A19 - security/permissions - non-blocking** -- do the new fields and routes sit behind
  the permissions that already cover their neighbours, or does any of this need a permission
  of its own and therefore a seeding migration?

## Decisions

- **2026-10-15** -- this work goes under **#104, *Design the MARP Machine Learning
  Dashboard***, which is where the gap list was recorded. No new issue; MARP_API#180 and
  MARP_API#128 are both closed.
- **2026-10-15** -- branched from the gap 27 correction rather than from `develop`, because
  that correction is what makes R5 a one-field change instead of a telemetry project. It is
  one commit and travels with this branch.
- **2026-10-15** -- the worker model-cache count is out of scope and recorded as such above.
  It cannot be served from anything MARP stores.

## Plan

Written after the gate, because A1, A4, A7, A10, A13 and A15 each change what the steps are.
The shape it will take: migrations first (A7, A15, A16, and A4 if `finished_at` is added),
then the repository and service reads, then the routes and their contract, then the generated
contract regenerated rather than hand-edited, then the dashboard if A18 says so.

## Acceptance criteria

- A page of the Jobs list draws every progress bar from one request.
- *Completed today* is answered by a query that does not depend on how many rows were fetched.
- A job submitted with a name is found by searching for that name.
- Sorting the Jobs list by any sortable column and turning the page shows the next rows in
  that order, not the next page re-sorted.
- The Workers screen's telemetry columns show a number for a machine that is working, and
  something honest for one that is idle.
- The Models screen says which model is preferred and the Datasets screen says a dataset is
  building, from the API rather than from fixture data.
- Training runs can be listed over a route.
- `tools/api-contract-check.mjs` and the dashboard's other checks still pass.

## Test plan

G3, after implementation. Each requirement gets a test at a tier that can see it: route and
contract tests for R1 to R9 (shapes, filters, sort order across a page boundary), a migration
test for anything that adds a column, and the dashboard's own browser checks only for
whatever A18 brings into scope.
