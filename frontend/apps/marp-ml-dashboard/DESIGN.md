# MARP Machine Learning Dashboard — design contract

The interactive mockup of MARP's ML operator surface. Designed in
[`MARP_API#104`](https://github.com/MarineAppliedResearch/MARP_API/issues/104), which
carries the product requirements and the eight reference mockups. **Where a mockup and
that issue disagree, the issue wins. Where this file and the issue disagree, the issue
wins.** The later, screen-by-screen review decisions in
[`MARP_API#180`](https://github.com/MarineAppliedResearch/MARP_API/issues/180) refine that
record and win where they are more specific.

This file is the contract between the people drawing the eight tabs. It exists because
eight screens drawn independently produce eight vocabularies, and the thing this phase is
supposed to settle is exactly one.

## What this app is, and is not

It is a **mockup with real operation**: fixture data, real filtering, real navigation,
real form behaviour. It is not wired to the API and does not run a job. Wiring is a later
phase, and `src/data.js` is the seam where the API will arrive — the same seam the Picture
Mosaic Reviewer uses.

## The rules that are not style preferences

1. **The palette lives in `../../shared/assets/css/tokens.css`. Never restate a colour.**
   Every colour in this app is `var(--something)`. The few exceptions this app declares
   for itself are in `styles/app.css` under *Local surfaces*, each with a comment saying
   why the token file cannot carry it. Adding another is a conversation, not an edit.
2. **The logo is `marp-logo-compact.png`**, the treatment the Mosaic Reviewer uses. Not
   the stacked logo, not the bare mark.
3. **The shell is authored once**, in `mockups/mock.js`: the icon sprite, the
   rail, and the top bar. A screen declares only what makes it that screen. They
   were copied per page once, and eight hand-written pages drift.
4. **A tab never writes its own hex, font stack, radius or shadow.** If a component you
   need is not in the vocabulary below, it is a shared component — say so rather than
   inventing a private one, because the next tab will need it too.
5. **Numbers are `tabular-nums`** and right-aligned in a table. The base size is 12px and
   the app is dense on purpose; this is an operator console, not a marketing page.
6. **No emoji, anywhere.** Icons are inline SVG from the sprite in `mock.js`.
7. **The interface does not explain itself.** No paragraph of prose on a screen,
   ever. What appears is what changes what a person does: a label, a value, a
   computed consequence, and at most one short line where a field is genuinely
   ambiguous. Rationale — why a split is frozen, why a tracker resets at a
   boundary, why a control is not wired — belongs in this file and in #104.
   Writing it into the UI is how a design review's commentary ends up shipping
   as product copy, and it happened here across four screens before it was
   caught. A control with nothing behind it carries a `later` chip and no
   explanation; anything that genuinely needs attention gets a one-line
   `.warn`, and if it will not fit on one line it is documentation.

## Layout

```
+--------+------------------------------------------------------------------+
| rail   | topbar   title . subtitle . project . search . refresh . actions |
| 208px  +------------------------------------------------------------------+
| logo   |                                                                  |
| nav x8 |  content  (the tab renders here; this is the only scroller)      |
| foot   |                                                                  |
+--------+------------------------------------------------------------------+
```

`.app` is a two-column grid, `208px 1fr`, full viewport height using `100dvh` — `100vh`
does not track mobile browser chrome, which is what let the mosaic reviewer's footer
scroll away. The content area is the page's only vertical scroller, so a tab's panels
scroll under a top bar that stays.

Breakpoints, and they are the only three:

| Width | What changes |
| --- | --- |
| `>= 1100px` | as drawn |
| `760px-1099px` | the rail collapses to a 52px icon strip; multi-column panel rows become one column |
| `< 760px` | the rail becomes a slide-over sheet behind a button in the top bar; every table scrolls inside its own panel |

A table that cannot fit gets `overflow-x: auto` **on its own wrapper**. The page body
never scrolls sideways at any width — that is an acceptance criterion, not a nicety.

## The component vocabulary

Authored in `mockups/mock.css`. Use these; do not re-cut them.

### Panels

```html
<section class="panel">
  <header class="panel-hd">
    <h2>Active and Recent Jobs <span class="count">(14)</span></h2>
    <div class="panel-tools"><!-- selects, search, links --></div>
  </header>
  <div class="panel-bd">...</div>
  <footer class="panel-ft">...</footer>
</section>
```

`.panel-bd.flush` removes the padding, which is what a full-bleed table wants.
`.panel-row` is a grid of panels: `.panel-row[data-cols="2|3|4"]`.

### Stat cards

The Dashboard's headline cards summarize the functional screens. Each card is a real link
to the screen it describes and carries enough current context to tell an operator whether
opening it is worthwhile. A card may show a statistic, a concise current-activity summary,
or both; it never grows into a second copy of the destination's complete table.

```html
<nav class="stats" aria-label="Machine Learning sections">
  <a class="stat stat-link" data-state="running" href="./jobs.html">
    <span class="stat-ico">...svg...</span>
    <span class="stat-lab">Jobs</span>
    <b class="stat-num">14</b>
    <span class="stat-sub"><i>6</i> running <i>8</i> queued</span>
  </a>
</nav>
```

`data-state` tints the icon chip and nothing else. The card body never changes colour —
several differently-coloured cards in a row is a traffic light, not a summary. The visible
arrow and focus ring make navigation apparent without relying on hover.

### Dashboard overview

Dashboard is the concise overview and navigation surface for Jobs, Inference, Training,
Datasets, Models, Workers and History. Jobs owns the general job list; Dashboard does not
repeat it. After the application summaries, Worker pool shows capacity and a short Current
and recent jobs table combines running work, needs-attention outcomes and recently completed
work. Every header in that preview sorts; the complete list, filters, paging, details and
controls remain on Jobs. Both panels use the full content width and appear in that order on
desktop and phone. On a phone the activity rows become readable cards rather than a squeezed
desktop table; a compact sort bar preserves all five sortable fields while the visual table
header is folded away.

Worker pool also carries one aggregate GPU resource graph. The left scale is percent of pool
capacity: stacked training/inference areas make their top edge total compute utilization and
the unfilled region available compute, while a separate line shows VRAM pressure. The right
scale is queued jobs, split into training and inference, because queue growth is what
distinguishes a busy healthy pool from insufficient capacity; worker reachability already
lives in the donut beside it. A compact key shows the current used/free values and names the
largest current load without adding a second card, table, or ranking below the graph. The
range control offers 24h, 5h and 1h with 5h selected by default. There is no animated marker;
during design review deterministic fixture samples advance the lines and can later be replaced
by live samples without changing the chart structure.

Every plotted label is a button: selecting it leaves that series at full contrast and fades
the others; selecting it again or pressing Escape restores the complete graph. Axis type and
grid marks use the brighter text tier and heavier weights, with larger SVG type at phone width
to compensate for viewBox scaling. Highlighting never relies on colour alone: the selected
label retains `aria-pressed`, and solid, dashed and dotted strokes remain distinct.

The plot uses a 760 × 260 viewBox. That added height is data space, not CSS stretching: both
scales map across 188 vertical units so nearby resource series remain distinguishable, while
axis text and strokes preserve their intended proportions on desktop and phone.

Wide desktop places the graph to the right of worker status and capacity. At 1050px and below
it stacks beneath them at full width so a narrow two-column layout cannot leave a tall empty
region under the worker summary.

### Jobs overview and list

Jobs answers two glance questions before the list: what state the work is in now, and how
quickly work has started, completed and accumulated in the queue. One donut separates running
inference, running training, queued, completed-today and needs-attention work. Beside it, one
moving activity graph uses the Dashboard's high-contrast grid and 24h, 5h and 1h range control,
with 5h selected by default. Its deterministic samples are review data and form the seam a
later live source replaces.

The four headline summaries are sort controls, not filters or links. Activating the card itself
moves its matching jobs to the top without hiding any job; its pressed state communicates the
selection without a second “Show first” label competing with the card content on a phone.
Search plus the visible Type, Status and Window selectors are the complete filters; there is no
More filters control.

Every meaningful desktop header sorts in either direction. At 1050px and below the table becomes
job cards, before its columns become cramped at narrow-tablet or wide-phone widths. The hidden
header is replaced by a horizontal sort strip containing the same seven fields, and the closed
card labels Scope, Model, Progress and Submitted explicitly. Every displayed job expands inline,
Expand all / Collapse all applies to the current page, and every expanded job is the complete
on-page view: shared identity and immutable submission facts followed by state- and type-specific
operations, outputs and actions, then its own folded Diagnostics section. The former one-job
drawer remains outside this screen's primary comparison flow.

Once work has begun, the result itself is more prominent than its orchestration metadata.
Inference detail shows each leading detection class with its accumulated count, median
confidence and 10–90% confidence range, beside cumulative findings by processed range. Training
detail plots training and validation loss against precision, recall and mAP through the latest
epoch. Queued jobs show an explicit no-metrics-yet state instead of an empty or fabricated
chart. Every legend label is a button that isolates its matching line; activating it again or
pressing Escape restores the complete graph. All plotted values remain deterministic design
fixtures until the later data phase.

A completed training expansion follows the questions used to decide whether its registered
eight-class detector is useful. Learning dynamics first separates box/class/DFL loss from
validation precision/recall/mAP, rather than putting unlike scales on one plot. Final evaluation
then shows the chosen split and best checkpoint, a per-class support/P/R/F1/AP table, eight-class
PR curves, P/R/F1 confidence-threshold selection, raw or normalized confusion matrices, class
balance, and best-versus-last checkpoint artifacts. The evaluation views share one local tab row
so dense diagnostics do not become a permanent wall of plots. Each graph owns its legend and
highlighting, so selecting one PR class does not dim an unrelated loss or threshold graph. Below
the evaluation, mutually exclusive inline drawers inventory the recorded run artifacts and expose
the resolved data, model, optimization and runtime configuration. Artifact availability is stated
honestly: paths can be inspected, but the design does not offer a download while no delivery route
exists.

Jobs uses the shared native hover-help vocabulary on the full decision surface, not only its
headline counts: status summaries, filters, table concepts, operational metrics, graph series,
evaluation terminology, artifact provenance and every resolved configuration field explain what
they mean. A tooltip belongs to the useful card or row target when its caption alone would be too
small to discover reliably.

### Inference overview and submission

Inference opens with the operational state of inference work before asking somebody to submit
more. It has no in-page Run, Batch, Scheduled or Results tabs: there is one run-plan workflow,
multi-query work is intrinsic to its groups, and scientific results are inspected on each expanded
inference entry in Jobs. Four linked cards lead to running, queued, completed-today and needs-attention inference
work. The same four states form one donut, while a separate dual-axis graph answers whether the
pool is catching up: processing throughput in frames per minute against the number of frames still
queued. The graph uses 24h, 5h and 1h ranges with 5h selected, clear unit labels on both axes, and
independently highlightable series. Values are deterministic design fixtures until the API can
provide time samples and a queued-frame rollup.

The submission workflow follows those operational summaries rather than competing with them. Its
recent-inference table is a short, sortable bridge to Jobs, not a second full queue. Every listed
run maps to the same fixture on Jobs and opens that job's complete inline detail. Before desktop
columns become cramped, the table becomes one card per run and exposes the same seven sorts in a
compact horizontal strip.

Submission builds an explicit run plan. Detection + ByteTrack is the only enabled pipeline in this
phase; detection-only, segmentation, stereo disparity, classification and custom runtimes are
disabled `Later` choices with a small illustrative preview and never look runnable. The execution
adapter is a property of the registered model, not a second technical decision an operator makes.

Video discovery follows Jellyfin's real Project folder → Dive folder → timestamp-named video
hierarchy, using the Mosaic Reviewer's searchable, cascading multi-select behavior. The opening
frame normally films the line card, so every result puts its opening-frame thumbnail beside an
explicit Line field and Save action. Saving that catalog assignment is not the same gesture as
adding the video to a run. The design uses a deliberate placeholder until the API requests the
Jellyfin image, and preserves the raw Jellyfin item id, lineage, name, path and duration regardless
of the scientific assignment. Its visible sample rows use real CAMPA2024 Dive 1 item identities,
durations and thumbnails through relative main-API image routes; the mockup never embeds a direct
Jellyfin service URL or credential.

Each result can contribute the whole video or a start-inclusive/end-exclusive time interval to the
active run group. A group is a snapshot of resolved video ranges from one query and accepts several
independently configured models. Each model chooses all of its versioned class map or a searchable
subset and owns its own detection, ByteTrack, reduction and range settings. Every model in a group
runs on every target in that group; a different assignment is another group. The review surface
states the cross-product before worker splitting — for example `3 video ranges × 2 model
configurations = 6 model runs` — and removes targets, models and whole groups independently.
The result list renders the complete query page rather than a decorative three-row sample. Desktop
contains that list in a stable-height scrolling region so the query and add action remain nearby;
phone removes the nested scroller and lets the document scroll normally.

`Run group` is deliberate product language. The coordinator's existing `batch_id` means worker-sized
pieces of one video, so reusing “batch” for a multi-query plan would make the interface and stored
contract disagree. The revised API needs a durable plan and ordered groups above independently
retryable target/model jobs. There are no deployed clients or workers that require an obsolete
request shape to remain executable, but every historical stored value and its provenance remains
losslessly readable after the contract changes.

### Training overview and submission

Training opens with the same operational hierarchy as Inference: linked running, queued,
completed and needs-attention cards; a status-composition donut; and one system-wide activity view
before the configuration form. The activity chart answers whether training demand is growing and
whether work is clearing: it overlays the percentage of total GPU compute consumed by training,
running jobs and queued jobs, with completed-run bars. It offers 24-hour, 7-day and 30-day windows,
labels compute and job-count scales, and lets each legend item isolate its series. Loss, precision,
recall and mAP must never be averaged across unlike models; those scientific learning curves belong
to the individual training job on Jobs. Moving values here are deterministic review fixtures until
aggregate activity metrics are served live.

The configuration panels remain the place to start a training job. Beneath them, a short sortable
recent-training list shows dataset, intended model version, state, epochs, best validation mAP,
start time and duration. Job names and the All jobs action open Jobs, where the complete training
diagnostics and completed-run evaluation live. Before columns crowd, the list becomes one card per
job with the same sorts available in a compact strip.

Training is one continuous page; it has no separate New training run and Runs views. The task
selector changes the contract, not merely the label. Detection exposes box, class and distribution
focal loss gains. Classification uses a classification checkpoint and exposes classification-head
dropout. Instance segmentation uses a segmentation checkpoint and exposes mask overlap and mask
downsample settings alongside the box/class/DFL gains used by its detection head. Epochs, batch,
image size, optimizer, learning rate, weight decay, warm-up, early-stop patience, seed and
deterministic execution follow the documented Ultralytics training vocabulary. Defaults shown in
the design are the upstream defaults unless MARP's legacy trainer already makes a deliberate choice.

Augmentation is not a training-job setting. A saved dataset carries the already-materialized
augmented samples and their provenance, so a run cannot silently add a second augmentation policy.
The worker contract must preserve that boundary when training execution is implemented.

The legacy `model_training_live.py` is narrower than this intended contract: it passes only epochs,
batch size and patience, hard-codes image size and worker count, and reads detection-only box metrics.
Therefore the classification and segmentation forms are the reviewed task-aware contract to build,
not a claim that the legacy trainer already executes those tasks. Implementation must add and test
those worker paths before enabling real submission.

### Dataset overview, build jobs and saved datasets

Datasets is one continuous page. It has no Dataset builder / Saved datasets tabs: operators first
see the system's build workload, then configure a dataset, then inspect every current build and
completed saved dataset in one lifecycle list. Four linked summaries separate building, queued,
ready and needs-attention work. A matching donut shows their current proportions, while the
24-hour, 7-day and 30-day activity graph overlays materialized frames per minute with building and
queued job counts and completed-build markers. Legend labels isolate each series. These moving
values are deterministic design fixtures until sampled dataset-build telemetry is stored and served.

Materializing images, labels, thumbnails, a manifest and an immutable split may take hours, so
`Queue dataset build` creates a first-class job in the same Jobs system used by inference and
training. Queued, building and failed dataset entries remain visible on Datasets and link to their
complete Jobs expansion. A saved dataset becomes available only after the build succeeds; partial
output never masquerades as a usable dataset.

The builder holds a union of query snapshots rather than one mutable query. `Run query` refreshes
the visible match count and class distribution. Before `Add all matching` is used, the operator
assigns that query result to Train, Validation or Test. Adding appends that exact filter snapshot,
refuses an identical snapshot already present, and deduplicates observations across the union.
First assignment wins: observations and connected overlap groups found by a later query stay in
their original split, are not counted twice, and never cross a split boundary. The final split
panel is a read-only consequence of these query-level assignments, not a global percentage control.
Removing a subset recalculates membership, composition and split counts. More than four subsets
use a bounded internal list on desktop; phones retain one continuous page scroll so the builder
does not trap touch scrolling inside a narrow nested region.

The combined lifecycle table searches names, descriptions, projects and job ids; filters by task
and build status; and sorts every meaningful column. Its rows deliberately represent two different
objects. Queued, building and failed rows are Dataset Build jobs: they do not expand on Datasets and
their name, job marker and `View job` action all open the matching first-class entry in Jobs, where
progress, workers, retry state and diagnostics belong. Only a successfully materialized `Ready`
dataset expands inline on Datasets, showing provenance, fingerprint, composition, split, archive
size and representative imagery, followed by duplicate, training and export actions. `Expand all
ready` ignores build-job rows. At tablet and phone widths each row becomes a card before the desktop
columns crowd, and expanded ready-dataset content stacks without hiding scientific provenance or
images.

### Models overview and registry

Models opens with linked totals for registered versions, preferred versions, worker cache coverage
and recently trained versions. A donut separates ready, testing and attention states. The adjacent
30-day, 90-day and one-year graph shows registry growth, preferred-version growth and cache coverage;
its legend isolates one series at a time. The registry remains the primary list below, with search,
task/status/dataset/base-model filters, sortable columns and expandable version provenance. Links to
cached coverage go to Workers, and recently trained versions go to History rather than duplicating
those lists here.

`Register model` is the one manual intake workflow for a model produced outside a MARP training
job. It records the name and immutable version, task, runtime/format, uploaded weights or managed
artifact URI, SHA-256, ordered classes, training dataset/base model/run provenance, initial testing
state and optional preferred use. A MARP Training job registers its own successful output and does
not need this form. The mockup does not mark individual intended controls “Later”: Phase 0 is the
design of the complete intended surface, while genuinely unavailable inference pipelines remain
disabled and say why.

### Workers overview and enrolled pool

Workers distinguishes what the API returns now from the telemetry the operational overview needs.
The four linked cards summarize reachable workers, occupied slots, running ranges and queued work;
job-related cards lead to Jobs. The donut shows derived worker activity: busy, idle, paused and
offline. The 24-hour, five-hour and one-hour graph is the intended future telemetry surface for
inference compute, training compute, VRAM pressure and queued ranges, and is labelled as such.

The enrolled-worker table uses the complete current `GET /api/v2/gpu/workers` shape, including its
nested worker-reported capability snapshot. The worker refreshes that snapshot while polling, and it
already contains CPU, RAM and disk pressure plus NVML GPU utilization, VRAM usage, temperature, fan,
power draw/limit and clocks when supported. Expanded rows separate those live measurements from the
attempt state and link the parent job to Jobs. The worker's local `/status` also knows process uptime;
the coordinator contract must carry that value before the central dashboard can show it from real
data. Rename is the only current human-facing worker mutation; pause, drain and retire are not
offered as working controls.

### History overview and finished work

History is the canonical finished-work view. Its linked cards expose the selected window, completed
jobs, jobs completed with issues and failed/cancelled outcomes. A matching donut shows that outcome
mix, while the 7-day, 30-day and 90-day graph overlays completed volume, issue volume and median
turnaround. The filtered, sortable table remains below and links each record to its full job detail;
History does not become another live queue.

### State

One vocabulary for every state in the app, on every element that carries one:

`data-state="running | queued | done | issues | failed | cancelled | cancelling | paused |
online | idle | busy | offline | draining"`

- `.dot` — a 7px disc. Always accompanied by text; colour is never the only cue.
- `.st` — the dot plus its label, as one inline unit. This is what a table cell holds.
- `.pill` — the same states as a filled chip, for a heading or a card corner.

Nothing in this app expresses a state any other way, and no tab defines a new state
without adding it here first.

### Tables

```html
<div class="tblwrap">
  <table class="tbl">
    <thead><tr><th class="chk">...</th><th class="sortable" aria-sort="ascending">Job Name</th>
    <th class="num">Frames</th></tr></thead>
    <tbody><tr><td>...</td></tr></tbody>
  </table>
</div>
```

`th.sortable` draws its arrow from `aria-sort`, so the accessible state and the drawn
state cannot disagree. `.num` is right-aligned tabular. `tr.sel` is a selected row,
`tr.attn` a row that needs attention. `.tbl.rowlink tr` is a whole row that navigates.

### Progress

```html
<span class="bar" role="progressbar" aria-valuenow="72"><i style="width:72%"></i></span>
<span class="pct">72%</span>
```

The fill takes its colour from the nearest `data-state`. A job with no progress yet draws
`<span class="dash">&mdash;</span>` and **not** a 0% bar — #104's measurement notes that
progress is legitimately null before the first heartbeat, and a 0% bar claims a
measurement that does not exist.

### Controls

- `.btn` — the base. `.btn.primary` (blue, the one action per surface), `.btn.accent`
  (mint, the second primary where a screen genuinely has two: New Inference / New
  Training), `.btn.ghost`, `.btn.danger`, `.btn.icon` (square, icon only, needs
  `aria-label`), `.btn.sm`.
- `.sel` — a `<select>`. `.sel.wide`.
- `.inp` — a text input. `.search` wraps an `.inp` with a leading icon.
- `.seg` — a segmented control, one button carrying `.on`. The Mosaic Reviewer's
  `.seg` markup exactly, so the two apps are the same object.
- `.tabstrip` — an in-page tab row used only when a screen has genuinely different peer surfaces.
  One
  `<button>` per tab, active carries `.on`, a later-milestone tab carries `disabled`
  and `data-later` which draws the note.
- `.field` — a label, its control, and an optional `.hint` under it. `.field.req` marks
  the label required.
- `.slider` — `<input type="range">` plus a `.slider-out` number box plus min/max end
  labels. The read-out and the range are bound in both directions.
- `.check` — a checkbox and its label as one clickable row.
- `.pager` — previous, numbered pages, next, and a rows-per-page select.
- `.kv` — a two-column definition grid for a detail panel.
- `.stepnum` — the numbered panel heading the Inference and Training mockups use
  (`1. Model & Settings`).
- `.empty` — what a filtered-to-nothing table draws. Every table has one; a table that
  can filter and cannot say "nothing matched" reads as broken.
- `.drawer` — the right-hand slide-over a row opens for its detail.

Focus is `:focus-visible` with a `--cyan-300` ring, inherited from the shell. Do not
remove it and do not restyle it per tab.

## How a screen is put together

```
mockups/mock.css        the shell and the whole component vocabulary
mockups/mock.js         the sprite, the rail, the top bar, and the behaviour
mockups/<screen>.html   one file per screen: dashboard, jobs, inference,
                        training, datasets, models, workers, history
```

A screen is only what makes it that screen:

```html
<body data-screen="jobs">
  <div class="app">
    <aside class="rail"></aside>
    <div class="main">
      <header class="topbar"><h1>Jobs</h1></header>
      <main class="content"> ... </main>
    </div>
  </div>
  <script src="./mock.js"></script>
```

`mock.js` fills the rail from one `NAV` table and the top bar from one `TOPBAR`
table — which is how Models can offer *Import* and *Register* with a wide search
while Jobs offers the two job buttons, without eight pages disagreeing about what
the application is.

Behaviour is opt-in by markup, so a screen gets only what it asks for: sortable
columns (`th.sortable` plus `data-sort` where the drawn value does not sort the
way it reads), expandable rows, a drawer where appropriate, row selection, tab and segment
switchers, sliders, the dataset split, and the lineage fold. Every control also
picks up a hover tip from one `TIPS` dictionary keyed by the text already on
screen.

## Checks, not conventions

`npm run lint` and `npm run shots` are the working loop, and both fail rather
than warn:

- **no raw hex** in a stylesheet, and no `data-state` outside the vocabulary;
- **nothing wider than its container** — a child overflowing its grid column
  lands on top of the column beside it and never leaves the viewport, so the
  right-edge check cannot see it;
- **two controls side by side in a `.fieldrow` sit on the same line**;
- **nothing clipped at the right edge**, allowing for genuine scroll containers;
- **a tab icon that resolves**, because a broken one is silent;
- **no console errors**, at every one of the four widths.

Each of those exists because the thing it checks was wrong at least once.

## What has no API behind it

Every item here is drawn in the mockup and cannot be fetched today. Recorded because a
mockup that quietly invents an API is how the implementation agent gets misled. Sources
are #104's measurement comment and its two decision comments.

1. **A logical job over a MARP selection** — a job named for a project, dive or transect,
   with its own state and progress rollup. `batch_id` has no row of its own, and a batch
   is one video cut into frame ranges and cannot span videos. Milestone 2.
2. **Completed with issues** — not in the job state enum, and there is no parent object to
   hang it on. Milestone 2.
3. **Reprioritising queued work** — `priority` is write-once at submit; there is no update
   route. Milestone 2.
4. **Retry, retry-failed-only, duplicate, run again** — no routes.
5. **A job's event log** — the rows exist (#104 counted 38,101 in one run) and **no route
   returns any of them**. The Jobs diagnostics view is drawn against `events` in the
   fixture.
6. **Artifact download** — `artifacts.path` is recorded, nothing serves the bytes. So the
   CSV test/export mode has no delivery path, and neither does "inspect the result".
7. **Any worker mutation** — pause, resume, drain, assign or preload a model, retire.
   `rename` is the one that exists.
8. **Draining as distinct from paused** — one `paused` state cannot express both.
9. **A per-job worker cap and worker affinity** — no field, no limit.
10. **Chunk size as a recorded property** — a submit-time argument stored nowhere.
11. **Detections per job** — nothing counts them; the ingest writes observations and the
    count is not rolled up anywhere.
12. **`GET /gpu/workers` does not page** — it returns every worker with its full
    capabilities blob. At the scale #104 assumes that is megabytes a refresh, so the
    Workers tab is drawn as if it pages and the route will have to learn to.
13. **Annotated video generation and detection crops** — output options in the Inference
    mockup with no pipeline behind them.
14. **A dataset export** — the images and labels of a saved dataset, as an archive. Drawn
    on the saved-dataset rows and beside *Create dataset*; nothing produces one.
15. **Model weights** — `model.url` is whatever the submitter typed and nothing serves the
    bytes, so *Download weights* has nowhere to fetch from. Drawn on the model's actions
    and per version in its training history.
16. **Three of the shapes used here are not the shapes of the tables they will come from**,
    so wiring them is a mapping and not a rename. `runs[].epochs` here is
    `{epoch, train_loss, val_loss, map50, seconds}`; the real `epochs` table carries
    `box_loss`, `cls_loss`, `dfl_loss`, `precision`, `recall`, `map50`, `map5095`.
    `datasets` here carries a class breakdown and a split; the real table carries
    `num_samples`, `num_classes`, `location`, `source`. `models` here carries a `versions`
    array; `ml_models` carries `parent_model_id`, `model_type`, `architecture_version`,
    `storage_path` and `status`, and **has no versions array at all** — a version chain is
    a self-join. These shapes were chosen for what the screens need; the mapping is the
    implementation phase's work.
17. **How many machines worked on a finished job** is not recorded anywhere, so
    `workers.using` is 0 on every terminal row and a History column cannot show it.
    "Using" is present tense.
18. **Inference throughput and queued-frame history** — current job and range records can be
    aggregated into a present snapshot, but there is no sampled time series or queued-frame
    rollup for the Inference activity graph. Its moving values remain deterministic design data
    until a later phase defines and serves those measurements.
19. **Dataset build jobs and build telemetry** — dataset materialization is not yet a first-class
    shared Job kind, and no sampled frames-per-minute, build concurrency, queue-depth or completion
    series exists. The Datasets lifecycle rows and activity chart define the intended contract;
    their progress, worker, ETA and series values are deterministic review fixtures in Phase 0.
20. **Model-registry trend and cache-coverage history** — current model and worker snapshots can
    supply present totals, but no sampled registry/cache series exists. The Models graph is
    deterministic Phase 0 design data.
21. **GPU pool utilization history** — the worker route provides lifecycle, activity, slots,
    reported capabilities and live attempts, but no sampled GPU utilization, training/inference
    compute split, VRAM pressure or queue-depth series. The Workers graph defines the desired
    telemetry contract; its moving values are not current API output.
22. **Finished-job outcome and turnaround history** — the current job records can be queried for
    terminal states, but `completed with issues` and the sampled rollup used by the History graph
    are not served as an operational series. Those chart values are deterministic review fixtures.

## Running it

```bash
cd frontend/apps/marp-ml-dashboard
npm install
npm run serve      # then open the address it prints
npm run lint       # parse, colours and the state vocabulary. About a second
npm run shots      # every screen at four widths, into shots/
npm test           # lint and shots together
```

`npm run shots` writes `shots/mock-<screen>-<width>.png` at 1672x941, 1000px,
the full phone column, and the phone fold — plus the account menu, and a drawer
or expanded row where a screen has one. Looking at them is the review.

The API serves this in place too: `app.js` serves any folder under
`frontend/apps/` by name, so `/apps/marp-ml-dashboard/` opens the Dashboard. The
Machine Learning Dashboard card on the MARP landing page links to it.
