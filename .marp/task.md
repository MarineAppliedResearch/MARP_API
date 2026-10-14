---
task: MarineAppliedResearch/MARP_API#180
repos: [MARP_API]
status: implementing
needs: []
---

## Goal

Settle each Machine Learning Dashboard surface as a concise, useful view that remains readable
and operable on desktop and phone before advancing beyond the Phase 0 design review.

## Requirements

- **R1** — Remove the duplicate Active and recent jobs table; Jobs owns the complete list.
- **R2** — Represent Jobs, Inference, Training, Datasets, Models, Workers and History with a
  useful statistic or concise current-activity summary that navigates to that screen.
- **R3** — After Worker pool, show a concise Current and recent jobs preview containing
  running work, work needing attention and recently completed work; every displayed column
  sorts the preview, while the complete list, filters and paging remain on Jobs.
- **R4** — On a phone, the overview summaries come first, Worker pool second and Current and
  recent jobs third; both panels use the full content width.
- **R5** — Dashboard summary links work without hover and expose their destination and focus
  to keyboard and assistive-technology users.
- **R6** — Sign in from the ML Dashboard returns to the public MARP front page and opens its
  existing sign-in dialog.
- **R7** — Update the checked-in design contract so it agrees with the settled #180 review
  decisions.
- **R8** — Under Worker pool, show an animated aggregate GPU utilization history against
  total pool capacity, with 24-hour, 5-hour and 1-hour views and 5 hours selected by default;
  keep the design ready for a later live-data source without presenting fixture values as
  API data. Use one cohesive dual-scale graph to distinguish used and available compute,
  used and available VRAM, training and inference demand, and the queued workload. Place the
  graph to the right of pool status on wide desktop and below it on narrower screens, without
  animated markers or separate resource cards and rankings. Its series, axes, grid marks and
  selectable labels remain high-contrast and readable at phone width, with enough vertical
  plotting range to distinguish nearby series rather than compressing them into a shallow band.
- **R9** — Development and testing servers must keep a database corpus paired with its
  thumbnail directory mechanically: selecting a stamped testing database automatically
  selects its stamped thumbnail storage, and a cross-checkout development launch without an
  explicit corpus directory refuses to start instead of serving missing-file responses.
- **R10** — On Jobs, remove More filters; the search box and visible Type, Status and Window
  selectors are the complete filter controls for this design.
- **R11** — Every meaningful Jobs table header sorts the displayed rows in either direction,
  with a visible current sort and controls that remain usable on a phone.
- **R12** — Add one at-a-glance status-composition chart that separates running inference,
  running training, queued, completed and needs-attention work.
- **R13** — Add a compact moving Jobs activity-history graph derived from the settled
  Dashboard graph language, using deterministic review data now and remaining ready for a
  later live-data source.
- **R14** — Every job displayed on the current page expands inline, an Expand all / Collapse
  all control operates on the displayed jobs, and each expanded job exposes its own folded
  Diagnostics subsection without requiring the detail drawer.
- **R15** — Expanded inference work that has processed data shows per-class detection counts
  and confidence plus a findings-over-progress graph. Expanded training work that has begun
  shows epoch curves for training loss, validation loss, precision, recall and mAP. Queued
  work states plainly that result metrics do not exist yet. These are deterministic design
  fixtures until later API phases provide live samples. Every graph legend label toggles an
  isolated high-contrast view of its series; a second activation or Escape restores all lines.
- **R16** — A completed eight-class training job follows a model-review hierarchy grounded in
  MARP's stored outputs: run outcome and best checkpoint; separate box/class/DFL loss and
  validation precision/recall/mAP epoch graphs; split-aware per-class support, P/R/F1/AP table;
  eight-class PR curves; P/R/F1 confidence-threshold selection; raw/normalized confusion
  matrix; class balance; and checkpoint/artifact links. Dense plots and tables remain legible
  through deliberate stacking or contained scrolling on phone. Its Artifacts and Run
  configuration controls open mutually exclusive inline drawers: the former inventories the
  recorded checkpoints, plots and result files without promising an unavailable download;
  the latter exposes the resolved data, model, optimization and runtime settings.
- **R17** — The Jobs page explains its controls, status summaries, table concepts, expanded-job
  metrics, graph series, completed-training evaluation terms, artifacts and resolved run settings
  with concise native hover help. The explanation is attached to the useful target area rather
  than only a small caption, and existing screen-specific wording remains authoritative.
- **R18** — The Inference run view opens with four linked inference-only state summaries, a
  matching status-composition donut, and one dual-axis 24h/5h/1h activity graph comparing
  processing throughput with queued frame volume. Its recent-inference table sorts on desktop
  and through a compact narrow-screen control, becomes readable cards before columns crowd, and
  links each run to its complete Jobs expansion. All additions use deterministic design fixtures
  and state which measurements still require later API support.
- **R19** — Redesign inference submission around a declared inference pipeline rather than a
  YOLO-only form. Keep the scientific task, registered model, execution adapter, task-specific
  parameters, input contract, and output contract distinct. The selected pipeline determines
  which models, inputs, controls, workers, and result destinations are compatible.
- **R20** — When ByteTrack is selected, expose the tracker parameters the installed MARP worker
  actually accepts, with named defaults, validation, concise help, and a resolved configuration
  summary. Do not present BoT-SORT as runnable until a worker adapter and parameter contract exist.
- **R21** — A registered non-YOLO or user-provided model must declare a versioned execution
  adapter, artifact identity, task and input/output contracts, parameter schema and defaults,
  preprocessing/postprocessing, and resource requirements. Submitting a job selects that trusted
  registration; it does not upload and execute arbitrary Python code.
- **R22** — Replace the single Scope selector with a cascading, searchable multi-select video
  query using the Mosaic Reviewer's project, dive and line interaction. Query results are grouped
  by dive and line and list every matching video; choosing several parents preserves still-valid
  narrower selections rather than resetting the query.
- **R23** — Every matching video has a stable preview area, video identity and duration. Show the
  real main-API-proxied Jellyfin image when available and a deliberate placeholder while loading or
  when no image exists. A person can add the whole video or a bounded
  time interval to the run plan and can remove any added target without rebuilding the query. Draw
  every returned video rather than a three-row sample: the results list has contained scrolling on
  desktop and uses normal page scrolling on a phone so both strategies can be reviewed at scale.
- **R24** — The submission is an editable run plan containing multiple run groups. Each group is
  an immutable snapshot of resolved video identities and half-open ranges from one query, not a
  live query that silently gains or loses videos later. A person can add another query as another
  group and delete either one target or an entire group.
- **R25** — Each run group accepts multiple independently configured compatible models. Each model
  chooses all of its declared output classes/species or a searchable subset and retains its own
  inference, post-processing and tracker parameters. The review step states the cross-product
  explicitly: selected video ranges times model configurations, followed by the worker-range split.
- **R26** — Do not overload the coordinator's existing `batch_id`, which currently means pieces of
  one video. A user-visible run plan/group needs its own durable parent and rollups so multiple
  queries, videos and model configurations remain editable and intelligible before submission and
  diagnosable afterward.
- **R27** — API and database contract changes are in scope. There are no deployed clients or
  workers requiring request-shape compatibility, so update the dashboard, API and worker contract
  together rather than maintaining parallel public versions. Preserve every historical job spec,
  raw video reference, observation, keyframe, model record, attempt, event and artifact verbatim or
  through a lossless migration, without reinterpretation or destructive normalization.
- **R28** — Treat Jellyfin's browsable hierarchy as the candidate video inventory: retain every
  library/folder/video item's stable Jellyfin id, parent lineage, raw name/path, duration and image
  availability. The query UI presents Project folder → Dive folder → Video and fetches each
  video's image through the main MARP API, while preserving a visible placeholder during loading or
  when no image exists. The design fixture uses real CAMPA2024 item ids, names, durations and
  thumbnails without embedding a Jellyfin credential or direct service URL. MARP semantic
  assignments remain explicit mappings rather than destructive renames of Jellyfin metadata.
- **R29** — In each timestamp-named Jellyfin video result, place the opening-frame thumbnail beside
  an editable Line field so an operator can read the filmed line card and assign the video to that
  line. Saving the assignment is explicit and separate from adding the video to a run plan. Store
  who changed it, when, and its prior value; never overwrite historical session or observation line
  values as a side effect of cataloging the video.
- **R30** — For this phase, Detection + ByteTrack is the only selectable execution pipeline.
  Segmentation, stereo disparity, classification and custom runtimes may appear as disabled
  `Later` choices with concise illustrative previews, but none may look runnable or establish their
  eventual parameter/result contract prematurely.
- **R31** — Inference has no in-page Run, Batch, Scheduled or Results tabs. It opens directly on
  its one run-plan workflow, which already supports multiple queries, ranges and models. Completed
  and in-progress results belong to the corresponding expandable inference entries on Jobs, so a
  second Results surface is not maintained here.
- **R32** — Training opens with four linked training-state summaries, a matching status donut and
  one system-wide activity graph that shows training GPU compute, running jobs, queued jobs and
  completed runs over 24-hour, 7-day and 30-day windows. Its short sortable recent-training list
  links each row to that job's complete expansion on Jobs and becomes readable cards before desktop
  columns crowd. Per-run learning curves remain in that job's expansion on Jobs.
- **R33** — Training is one continuous overview, setup and recent-jobs page without New run/Runs
  sub-tabs. Detection, classification and instance segmentation select only compatible base models
  and datasets, and expose their real task-specific Ultralytics settings: detection box/class/DFL
  gains, classification head dropout, and segmentation mask overlap/downsample plus box/class/DFL
  gains. Shared optimization and stopping settings remain shared. Job-level augmentation controls
  do not exist: augmentation is materialized and versioned as part of the saved training dataset.
- **R34** — Datasets is one continuous operational and configuration page without Dataset builder /
  Saved datasets sub-tabs. It opens with linked build-state cards, a matching status donut and one
  system-wide 24h/7d/30d activity graph for frame-materialization throughput, building jobs, queue
  pressure and completed builds. Queueing a dataset creates a first-class job in the shared Jobs
  list; only successful completion creates an immutable saved dataset. Below the builder, one
  searchable, task/status-filterable and sortable lifecycle table includes queued, building,
  needs-attention and ready entries. Every row expands to show build state, provenance, composition,
  split and representative imagery; current builds link back to their complete entry in Jobs.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-13: the Dashboard summarizes and
  navigates across every functional screen; it is not another copy of Jobs.
- [x] **A2 · product/UI · blocking** — answered 2026-09-13: a destination may be represented
  by a statistic, a concise list of current work, or both; exact live data arrives in later
  implementation phases.
- [x] **A3 · product/UI · blocking** — answered 2026-09-13: phone order is overview, Worker
  pool, Needs attention; the latter two panels stack at full width.
- [x] **A4 · behavioural · blocking** — answered 2026-09-13: Sign in returns to the front
  page and opens the existing login dialog.
- [x] **A5 · product/UI · blocking** — answered 2026-09-13: the bottom preview combines
  currently running jobs, needs-attention outcomes and recently completed jobs, with every
  header sortable.
- [x] **A6 · product/UI · blocking** — answered 2026-09-13: Worker pool includes an animated
  aggregate utilization chart with 24h, 5h and 1h ranges, defaulting to 5h; live data is a
  later phase, so this review uses deterministic preview data.
- [x] **A7 · environment · blocking** — answered 2026-09-13: the database and derived
  thumbnail directory are one corpus and must be selected together by code, not agent memory.
- [x] **A8 · behavioural · blocking** — answered 2026-09-13: selecting a headline Jobs card
  sorts that category to the top while retaining the full Jobs list.
- [x] **A9 · product/UI · blocking** — answered 2026-09-13: the expanded row is the complete
  job view on this screen, with no separate full-job page. Every state shows identity, scope,
  locked model and submission facts; running adds progress/timing/throughput and workers;
  queued adds position/priority/requirements; failed or issues adds cause, affected work and
  retry actions; completed adds duration and produced results; Diagnostics remains folded for
  every state.
- [x] **A10 · product/UI · blocking** — answered 2026-09-14: use the completed-training hierarchy grounded in
  MARP's stored metrics: (1) always-visible run outcome and per-class table; (2) separate
  epoch plots for box/class/DFL loss and validation precision/recall/mAP rather than mixing
  loss and quality on one dual-scale graph; (3) a test/validation/train split selector over
  per-class PR and confidence-threshold P/R/F1 views; (4) raw/normalized confusion-matrix and
  label-balance views; (5) best-versus-last checkpoint and artifact links. Unsupported
  calibration and qualitative-error plots are deferred rather than implied by fixtures.
- [x] **A11 · product/UI · blocking** — answered 2026-09-14: the Inference overview uses
  linked Running, Queued, Completed-today and Needs-attention cards; a donut summarizes those
  same inference-only states; a 24h/5h/1h dual-axis activity graph compares frames processed
  with frames still queued; and the existing recent-inference table becomes sortable and
  phone-friendly, with rows leading to the complete Jobs view. Confirm that these measures and
  destinations answer the intended at-a-glance question before implementing the redesign.
- [x] **A12 · product/UI · blocking** — answered 2026-09-14: start with a pipeline selector, but
  Detection + ByteTrack is the only enabled choice in this phase. Segmentation, stereo disparity,
  classification and custom runtimes are visibly disabled `Later` concepts. The enabled pipeline
  shows only compatible registered models and derives its execution adapter from the registration.
- [x] **A13 · behavioural · blocking** — answered 2026-09-14: implement ByteTrack configuration
  against the worker's present contract (`track_thresh`, `match_thresh`, `track_buffer`, `mot20`)
  and visibly defer BoT-SORT until MARP has a real BoT-SORT adapter and validated
  parameter schema. Detection confidence and NMS remain separate from tracking thresholds.
- [x] **A14 · architectural/security · blocking** — answered for this phase 2026-09-14: custom
  runtimes are a disabled `Later` concept. Future PyTorch support means registering a trusted,
  versioned runnable adapter/package plus its weights and schemas; this form does not accept
  arbitrary Python or an unqualified `state_dict` for execution.
- [x] **A15 · API contract · blocking** — answered and corrected 2026-09-14: updating the existing
  API contract is part of this work, and there are no deployed clients or workers to support. The
  dashboard, coordinator and worker move together to a typed pipeline/input/model-configuration
  contract. Historical `engine`/`video`/`range`/`params` values remain preserved and inspectable,
  but MARP does not maintain a second execution path solely for an unused request shape.
- [x] **A16 · scientific/data-meaning · blocking** — answered for this phase 2026-09-14: only the
  Detection + ByteTrack observation output is runnable. Masks, class scores, disparity/depth maps,
  confidence maps, embeddings and raw tensors are illustrative `Later` concepts until their own
  artifact and ingestion contracts are designed.
- [x] **A17 · scientific/data-meaning · blocking** — answered for this phase 2026-09-14: stereo
  disparity is disabled and marked `Later`; synchronized-pair and calibration semantics are not
  guessed as part of the current Detection + ByteTrack design.
- [x] **A18 · product/UI · blocking** — answered 2026-09-14: within one run group, every configured
  model runs against every selected video range. Different model-to-video assignments belong in
  separate groups. Call these `Run groups` in the interface because the API already uses `batch`
  for the worker-sized pieces of one video.
- [x] **A19 · scientific/data-meaning · blocking** — answered 2026-09-14: use Jellyfin's hierarchy
  as the discovery inventory: Project folder → Dive folder → timestamp-named videos. The opening
  frames show a filmed line number, so the result row displays the opening thumbnail beside an
  operator-entered line assignment. Preserve the raw hierarchy and permit explicit exceptions;
  the current observation-derived facets remain a separate observation query.
- [x] **A20 · behavioural · blocking** — answered 2026-09-14: a UI time interval is start-inclusive
  and end-exclusive, is validated against Jellyfin/media duration, and is resolved to the API's
  half-open frame range using recorded media timing before jobs are created. Store both the human
  interval and resolved frame bounds for provenance.
- [x] **A21 · scientific/data-meaning · blocking** — answered 2026-09-14: selecting a subset of a
  model's species/classes filters which predictions are retained and ingested. It does not claim
  to reduce model compute unless that execution adapter explicitly supports class-gated execution.
  Persist stable class identifiers plus the model version's class-map snapshot, not display names.
- [x] **A22 · API contract · blocking** — answered 2026-09-14: add a durable inference-plan parent
  with ordered run groups, resolved targets and versioned model configurations. Submission expands
  that plan into independently retryable jobs for each target/model pair and then into existing
  worker-sized frame-range pieces, preserving lineage back to the plan and group.
- [x] **A23 · scientific/data-meaning · blocking** — answered for the current design 2026-09-14:
  the Jellyfin hierarchy supplies project and dive discovery; a timestamp video does not itself
  supply the line. The operator reads the filmed line card from its opening thumbnail and saves an
  explicit video-line assignment. Preserve its audit history and flag any project-folder name that
  does not resolve uniquely rather than guessing a database project id.
- [x] **A24 · product/UI · blocking** — answered 2026-09-14: dataset construction can take hours,
  so it uses the same shared Job lifecycle as inference and training. The Datasets page keeps the
  builder and one combined current-build/saved-dataset list on a single surface; a saved dataset
  does not appear until its build succeeds, while active and failed entries link to Jobs.
- [x] **A25 · product/UI · blocking** — answered 2026-09-14: the dataset builder assembles an
  explicit union of multiple query snapshots. Running a query refreshes its match summary; adding
  appends that subset, refuses an exact duplicate, and recalculates deduplicated membership,
  composition and split counts. Subsets can be removed. A long list scrolls inside its panel on
  desktop but uses the page's normal scroll on a phone.
- [x] **A26 · product/UI · blocking** — answered 2026-09-14: queued, running and failed dataset
  construction entries are Dataset Build jobs, not datasets. Their Datasets-page rows link to full
  first-class job entries on Jobs and do not expand locally. Only a successfully materialized,
  immutable dataset is `Ready` and expandable on Datasets.
- [x] **A27 · product/UI · blocking** — answered 2026-09-14: Dataset summary cards follow the
  same responsive contract as the other reviewed pages: two columns at compact desktop/tablet
  widths and two compact cards per row on a phone; supporting facts wrap inside their own card
  rather than making one card span both columns.
- [x] **A28 · scientific/data-meaning · blocking** — answered 2026-09-14: replace the global
  percentage splitter with an explicit Train, Validation or Test destination selected when each
  query result is added. The final section is a read-only split summary. First assignment wins:
  identical observations and connected overlap groups found by a later query retain their original
  split, are not counted again, and never cross the train/validation/test boundary.
- [x] **A29 · product/UI · blocking** — answered 2026-09-15: Models, Workers and History use the
  same reviewed hierarchy as the other operational pages: four linked summary cards, a compact
  donut, a range-selectable chart with highlightable legend, and a searchable/sortable primary
  list below. The phone cards remain a two-column compact grid.
- [x] **A30 · API contract · blocking** — corrected 2026-09-15 after tracing the nested worker
  capability payload: Workers displays the live CPU, RAM, disk and NVML GPU/VRAM utilization,
  temperature, fan, power and clock readings refreshed during polling, alongside identity,
  lifecycle/activity, slots, version, timestamps and attempts. Process uptime already exists in the
  worker's local status and must join the coordinator snapshot. Historical sampling remains a future
  telemetry seam; rename is still the only working coordinator-side worker mutation.
- [x] **A31 · product/UI · blocking** — answered 2026-09-15: Models owns registry/version
  inspection, Workers owns the enrolled-pool snapshot, and History owns finished work. Cross-page
  summary cards link to the page that owns the detail instead of duplicating its full list.
- [x] **A32 · product/UI · blocking** — answered 2026-09-15: `Register model` is a working Phase 0
  design for manually adding an externally produced artifact and its immutable metadata,
  class order and provenance. MARP training outputs register themselves. Selective “Later” badges
  are removed because every control in the mockup describes the intended implementation.

## Decisions

- **2026-09-13** — The first-screen revision is implemented and reviewed before work moves
  to the next ML Dashboard screen.
- **2026-09-13** — Page-specific summary copy is fixture content for judging the overview;
  it does not establish an API contract.
- **2026-09-13** — The human accepted the revised Dashboard and moved design review to Jobs.
- **2026-09-13** — Expanded job detail prioritizes the scientific result developing inside
  the job, not only orchestration metadata.
- **2026-09-14** — Inference review exposed a new material contract question, so the task returns
  to design before the submission form is generalized. The current worker runs only MARP's
  Ultralytics/ByteTrack pipeline; permissive JSON parameters are transport, not a supported
  cross-runtime product contract.
- **2026-09-14** — Published API evolution is explicitly in scope. Corrected after the human noted
  that no clients or workers exist: do not build dual-version compatibility machinery. Change the
  dashboard, API and worker contract together. Data preservation still means retaining historical
  values and provenance exactly; a migration never manufactures scientific meaning from old
  strings or loses the source representation.
- **2026-09-14** — Removed the Inference sub-navigation. Multi-query work is part of the one run
  plan rather than a separate Batch mode; scheduling is not designed; job results are inspected on
  each expanded Jobs entry rather than duplicated on Inference.
- **2026-10-14** — The human accepted the revised Models, Workers and History designs, which
  closes the design review. Every screen has now been through it.

## Plan

1. Replace the duplicate job table with linked application-wide summaries.
2. Reorder and resize the operational panels for phone layouts.
3. Connect the account-menu Sign in action to the front-page login dialog.
4. Update `DESIGN.md` and add focused browser assertions.
5. Revise Jobs with at-a-glance status/activity, prioritizing summaries and expandable
   diagnostics, including the wider phone/tablet card breakpoint.
6. Settle the generalized inference pipeline, adapter, input and output contracts before
   revising the submission form.
7. Present the verification plan for human approval before running it.

## Acceptance criteria

- The Dashboard contains no general active/recent job table.
- Every functional screen is reachable from a meaningful Dashboard summary.
- Worker pool and Current and recent jobs appear in that order at full content width.
- Sign in reaches the real landing-page dialog through the API origin.
- The design contract and browser assertions state the same behavior.
- Jobs has no More filters control and retains its three visible selectors plus search.
- Headline Jobs summaries move matching rows first without hiding the remaining rows.
- The Jobs donut and moving 24h/5h/1h activity graph remain readable on desktop and phone.
- Every displayed job expands inline, including Diagnostics, and one control expands or
  collapses the current page.
- At 1050px and below, Jobs uses readable cards and exposes all seven sorts in a compact strip.
- Dataset queries can be rerun, added as distinct subsets, deduplicated, removed and reviewed in a
  bounded desktop list without introducing a nested scroll area on a phone.
- Each added query subset is explicitly assigned to Train, Validation or Test; duplicate
  observations and connected overlap groups retain their first split, and the final split panel
  summarizes those assignments without offering a global reshuffle control.
- Every unfinished dataset-build row navigates to a matching Dataset Build entry in Jobs; only
  ready dataset rows expose expansion controls and dataset detail on Datasets.
- Models, Workers and History each have linked compact summary cards, a state donut, a
  range-selectable graph with isolatable series, and a sortable primary list that remains readable
  at phone width.
- Workers displays the live hardware snapshot already reported through worker capabilities,
  distinguishes that snapshot from planned historical sampling, and exposes no unsupported worker
  controls.
- Register model opens a complete artifact, runtime, class-order and provenance workflow, and no
  mockup control is selectively labelled “Later.”

## Test plan

Filled in at G3 after implementation. It will be limited to the ML Dashboard lint/browser
checks and the entry-app login-arrival browser check; no API, database or full-suite run is
needed for this static interaction change.

## Status

- **Gate:** G3 — the test plan for R19-R34, reviewed before anything is run
- **Notes:** The design review is closed; every screen has been through it. Workers is
  constrained to the current API snapshot and labels historical utilization as a future
  telemetry requirement. `.marp/verification.md` covers R1-R18 only, so the sixteen Inference,
  Training and Datasets requirements have no test plan yet. That is the next piece of work.
