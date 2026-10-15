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
`Queue dataset build` starts tracked work with its own progress, worker and diagnostics — **but
not a job in the GPU queue.** Settled 2026-10-14 in #128: a dataset build is not a `gpu_jobs`
row, is never leased through `POST /gpu/poll`, and is not run by the inference worker. Queued,
building and failed entries stay on Datasets and **expand in place**, which is where their
progress, worker, elapsed time, remaining estimate and failure detail belong. A saved dataset
becomes available only after the build succeeds; partial output never masquerades as a usable
dataset.

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
objects. Queued, building and failed rows are builds in flight: they expand in place, showing
progress against frames, the worker, elapsed and remaining time, how much has been materialized,
the split and the fingerprint — plus the failure and a `Retry build` where one is needed. They used
to link into Jobs instead; #128 removed that, because the queue they pointed at never held them.
A successfully materialized `Ready` dataset expands inline too, showing provenance, fingerprint,
composition, split, archive
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

`data-state="running | queued | done | issues | failed | cancelled | cancelling | expired |
paused | online | idle | busy | offline | draining"`

Two of these are not what they look like, and both were nearly got wrong:

- **`issues` is about a batch, never about one job.** It means *finished, but some videos
  or ranges failed* — so the action on it is **Retry failed work**, and the usable work is
  kept. A single MARP job cannot be in this state: #225 settled that a job whose results did
  not reach the database is *failed*, not succeeded-with-problems. It is derived by grouping
  jobs on `batch_id` and finding both `succeeded` and `failed` pieces among them. Gap 1 still
  stands — a batch has no row of its own — so the dashboard computes this from the pieces
  rather than fetching it.
- **`expired` is amber, not grey.** The lease ran out and the work went back to the pool.
  Nothing is wrong with the model or the data and nobody chose to stop it, so it is neither
  `failed` nor `cancelled`; somebody has to resubmit, which is why it is not grey.

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

**These are closed after the dashboard settles, not as they are found** — Isaac,
2026-10-14. That ordering is deliberate and it is the reason the list keeps growing rather
than shrinking: wiring a screen is what reveals what the API is missing, and closing each
one the moment it appears would mean changing routes and schema against a design still
being argued with. So the list is the backlog, written while the evidence is in front of
us, and the API work is one pass afterwards. A gap found here is recorded, drawn honestly
on the screen, and left. Do not open API work off the back of this list without asking.

**That pass happened on 2026-10-15, and it covered items 23 to 28 only.** Each of those now
carries a *Closed in the API* note saying what the route answers and what it still does not.

**"Closed in the API" is not "closed on the screen."** The screens were deliberately left
alone in that pass, so a Progress column with a route behind it is still drawn from the data
layer and a telemetry column still shows a dash. Doing both at once would have meant a change
set where a dashboard failure and a route failure looked the same. Rewiring the screens onto
the new fields is the next pass, and it is cheap now that the shapes are fixed.

1. **A logical job over a MARP selection** — a job named for a project, dive or transect,
   with its own state and progress rollup. `batch_id` has no row of its own, and a batch
   is one video cut into frame ranges and cannot span videos. Milestone 2.
2. **Completed with issues** — not in the job state enum, and there is no parent object to
   hang it on. Milestone 2. **Partly closed 2026-10-14 in #128:** the dashboard derives it by
   grouping jobs on `batch_id` and finding both `succeeded` and `failed` pieces, which needs
   no schema change and no new route. What is still missing is the parent — a batch cannot be
   fetched, named, or given a state of its own, so this is computed from a page of pieces and
   is only as complete as that page. The rollup belongs with gap 1.
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
19. **Dataset build telemetry** — no sampled frames-per-minute, build concurrency, queue-depth
    or completion series exists. The Datasets lifecycle rows and activity chart define the
    intended contract; their progress, worker, ETA and series values are deterministic review
    fixtures in Phase 0.

    **A dataset build is not a GPU job, settled 2026-10-14 in #128.** The ML Dashboard still
    builds datasets — that work is real, it is tracked, and the Datasets screen owns it. What
    it is not is a `gpu_jobs` row: it is not leased through `POST /gpu/poll`, not run by the
    inference worker, and not one of MARP's job kinds, which are inference, tracking, training
    and diagnostic.

    This gap used to read "not *yet* a first-class shared Job kind". That "yet" is what did the
    damage: it left the **Jobs** screen — the GPU queue — showing six hand-written Dataset Build
    rows against a day that is not coming, and those rows made its headline cards disagree with
    the table beneath them, 18 running against 20. They are gone from that screen only.
    `tools/api-contract-check.mjs` fails if the dashboard starts believing in a fifth GPU job
    kind.

    What dataset builds run *on* is a separate question this did not settle — the Datasets
    fixtures name a `gpu-build-02` worker, and nothing in the API backs that yet.
20. **Model-registry trend and cache-coverage history** — current model and worker snapshots can
    supply present totals, but no sampled registry/cache series exists. The Models graph is
    deterministic Phase 0 design data.
21. **GPU pool utilization history** — the worker route provides lifecycle, activity, slots,
    reported capabilities and live attempts, but no sampled GPU utilization, training/inference
    compute split, VRAM pressure or queue-depth series. The Workers graph defines the desired
    telemetry contract; its moving values are not current API output.

    **Closed 2026-10-15, and it needed a measurement to settle an argument.** The obvious move
    was to draw this from the readings MARP already had: 6,789 attempts carry a real NVML
    snapshot spanning five weeks. Querying them says why that would have been a mistake — on
    the two days that ran two thousand jobs, the average GPU utilization in those readings is
    **0.5%**. They are taken at the poll, which is the instant *before* the machine starts, so
    a chart drawn from them shows a farm that is permanently idle. Having the data and plotting
    it would have been worse than having none.

    So the reading now travels on the **heartbeat**, the only thing that happens while work
    runs. `gpu_worker_samples` keeps one row per machine per minute — a unique index on
    `(worker_id, at)` makes that the schema's rule rather than a caller's — and
    `GET /gpu/telemetry/series` reads it back bucketed by minute, hour or day, with a maximum
    beside the average because an average over a pool where one card is saturated and nine are
    idle hides the one fact worth seeing. Kept 30 days, swept on the pool read.

    Two honest limits: only machines that were **working** appear, since a reading exists
    because a heartbeat wrote it, so this is utilization of the machines doing work rather than
    of the pool's whole capacity. And the worker has to be sending it — that half is
    `marp-inference-worker`, and until a given machine runs a version that does, it contributes
    nothing to the series.
22. **Finished-job outcome and turnaround history** — the current job records can be queried for
    terminal states, but `completed with issues` and the sampled rollup used by the History graph
    are not served as an operational series. Those chart values are deterministic review fixtures.

    **Largely closed 2026-10-15, with nothing sampled at all.** `GET /gpu/jobs/series` buckets
    straight out of `gpu_jobs`: `finished` counts jobs whose `finished_at` falls in the bucket,
    `succeeded` the subset that worked, and `waiting` is **reconstructed** rather than recorded
    — a job was waiting at a given instant if it was created before it and had not finished by
    it. No new table, and it was unanswerable before only because `gpu_jobs` had no terminal
    timestamp; gap 24 added one. `completed with issues` is still not in it, because that is
    derived by grouping on `batch_id` and belongs with gaps 1 and 2.
23. **Progress on the job list** — `GET /gpu/jobs` returns no progress of any kind. Progress is
    recorded on the *attempt* (`progress_done`, `progress_total`, `progress_unit`,
    `progress_phase`, `progress_elapsed_s`, every one nullable) and attempts come back only from
    `GET /gpu/jobs/:id`. The Jobs table draws a Progress column on every row, so it is drawn as
    if the list carries it and **the route will have to learn to** — the same shape of gap as
    item 12. A detail call per visible row was the alternative and was rejected: fifty-one
    requests to draw one page. Settled 2026-10-14 in #128.

    The two shapes differ as well, which is item 16's warning again. The mockup carried a flat
    integer percentage with `-1` meaning none. The data layer serves the attempt's own fields and
    the screen computes the percentage, so it can say "1,240 of 3,000 frames" and keep the phase.
    Null before the first heartbeat still draws a dash and never a 0% bar.

    **Closed in the API, 2026-10-15.** `GET /gpu/jobs` carries `progress_done`, `progress_total`,
    `progress_unit`, `progress_phase` and `progress_elapsed_s` from the job's **latest attempt**,
    whatever state that attempt is in -- a failed job showing how far its last try got is useful,
    and a failed job showing nothing is a second way of saying "failed". The attempt's own field
    names, flat on the job, so wiring the screen is a deletion rather than a mapping. One lateral
    join; no opt-in flag.

24. **The job list cannot be asked a question about time** — `GET /gpu/jobs` filters on
    `state`, `kind` and `batch_id`, and nothing else. *Completed today* on the Jobs screen is
    therefore not a query: the dashboard pulls a window of rows back and counts them here.
    That is fine at a few hundred jobs and is not fine at the scale #104 assumes, where the
    card would be counting over a page that no longer contains yesterday. The route needs a
    date range, or a counts endpoint. Found 2026-10-14 while wiring the cards in #128.

    **Closed in the API, 2026-10-15,** and it needed a column first. `gpu_jobs` had no terminal
    timestamp at all -- `finished_at` was on the *attempt* -- so "completed today" could only be
    asked as "touched today", which is a different question. `gpu_jobs.finished_at` now exists,
    is set wherever a job goes terminal and cleared wherever one goes back in the queue, and
    existing rows were backfilled from their last attempt.

    `GET /gpu/jobs` takes `created_after`, `created_before`, `finished_after` and
    `finished_before`, as **absolute instants rather than day names**: MARP has no opinion about
    where a day starts, because a server that decided would be wrong silently for anyone in
    another timezone. No counts endpoint -- `total` already comes back with every page, so a card
    asks for `limit=1` with its range and reads `total`.
25. **A job has no name** — `GpuJobSpec` carries `engine`, `model`, `video`, `session`,
    `range`, `params` and `reduction`. Nothing names the job. The titles the screens show are
    composed from `spec.video.source_name`, which is why they read "SALT 2025 D0895 L4"
    rather than anything a person chose. A submitted job cannot be given a label and found
    again by it. Found 2026-10-14 in #128.

    **Closed in the API, 2026-10-15.** `gpu_jobs.name` is a column rather than a field inside
    `spec`, because the list has to search it and searching inside a JSON blob means a functional
    index or a sequential scan. `POST /gpu/jobs` takes an optional `name` and every piece of a
    split batch carries it, because the person submitted one thing.

    **Null when absent, and MARP composes no fallback.** A name invented by the API would be
    indistinguishable from one a person chose, and the screens already know how to label a job
    that has none. Renaming after submit is deliberately not here: it would be the first job
    update route and belongs with gap 3.
26. **Four of the Jobs screen's six controls cannot be asked of the route** — `GET /gpu/jobs`
    takes `state`, `kind`, `batch_id`, `limit` and `offset`. The Type and Status selectors are
    therefore real queries. **Search, the time window, every sort column and the derived
    *Issues* filter are not**, so the screen fetches a window the route *can* answer and
    narrows, sorts and pages it in the browser.

    That is correct at a few hundred jobs and wrong at the scale #104 assumes, and it fails in
    a way worth naming: sorting and paging are only honest together while the whole matching
    set is in hand. Sort by Progress over a window and page 4 follows page 3; sort by Progress
    over a *page* and the column means nothing. The route needs sort parameters and a search
    before this list can be paged server-side, which is also what gap 24 needs for the cards.
    Found 2026-10-14 in #128.

    **Mostly closed in the API, 2026-10-15.** `GET /gpu/jobs` takes `sort`, `direction` and
    `search`. Sorting covers the columns that live on the job itself -- `name`, `kind`, `state`,
    `priority`, `created_at`, `finished_at` -- and every ordering still ends in `id DESC`, which
    matters more now that `name` and `finished_at` are both nullable and NULLs tie with each
    other. An unknown sort key is a 400 rather than ignored: a sort the route silently dropped
    would hand back rows in some other order and look broken. Search matches the name, the
    video's `source_name` and the batch id -- the three things visible on the row.

    **Progress and Worker are still not sortable**, because they live on the joined attempt and
    ordering by them is a different and more expensive query. They can follow once something has
    measured that the join is affordable at #104's scale.

    **The *Issues* filter stays in the browser**, deliberately. It is derived by grouping on
    `batch_id` and finding both a success and a failure, and a `HAVING` over batches cannot be
    paged with the rows it filters -- so making it a query would trade a visible limitation for a
    subtle one. It remains only as complete as the page in hand, and the screen should keep
    saying so.

27. **The pool view cannot reach the machine telemetry MARP already has** — the Workers table
    has columns for GPU load, VRAM load and temperature/power, and they draw a dash.

    **Corrected 2026-10-15.** This said "a worker reports nothing about itself while it runs"
    and that none of it exists. That was wrong, and wrong in the direction that invents work:
    `marp-inference-worker`'s `system/resource_monitor.py` reads NVML and reports GPU and
    memory `utilization`, `temperature_c`, `power_usage_watts` and `power_limit_watts` per
    device; those travel inside `capabilities` on **every** `POST /gpu/poll` — the schema calls
    that field "Current hardware, snapshotted onto whatever attempt this poll opens" — and
    MARP stores it as `capabilities_snapshot` on the attempt. The mistake was checking the
    enrol and heartbeat bodies and never the poll.

    What is actually missing is narrower and cheaper:

    - **`GET /gpu/workers` does not return it.** `GpuPoolAttempt` carries `attempt_id`,
      `state`, `slot_index`, `lease_epoch`, `lease_expires_at`, `last_heartbeat_at`,
      `progress` and `job` — no `capabilities_snapshot`. `GET /gpu/jobs/:id` does return it,
      so the pool view is the only thing standing between this screen and the numbers.
    - **It is a lease-time snapshot, not a live reading.** The heartbeat carries the attempt's
      progress and nothing about the machine, so the figures are as of when the job started.
      A column headed *GPU load* implying "now" would be overstating what is known.
    - **An idle machine has no reading at all**, because the snapshot lives on an attempt and
      an idle machine has none.

    So the cells still draw a dash today, but for a reason worth one line of route change
    rather than a telemetry pipeline. **#214 owns the power-draw feature** — idle baseline,
    delta above idle, pool totals — and carries six open assumptions of Isaac's that are
    unanswered, so it is blocked at its own design gate rather than waiting on this.

    What is real on the screen now: name, activity (derived by the route), version, the
    enrolment capabilities, slots in use against slot count, when it enrolled, when it was
    last heard from, and its live attempt.

    Uptime is in the same position for a subtler reason: `local_id` is durable across restarts,
    so `enrolled_at` is when the machine first appeared, not when its process started. Showing
    the age of the enrolment under a column headed *Uptime* would be a wrong number rather than
    a missing one. Found 2026-10-14 in #128.

    **Closed in the API, 2026-10-15.** A live attempt in `GET /gpu/workers` now carries
    `telemetry: {as_of, gpus[]}`, each GPU in the worker's own field names --
    `gpu_utilization_percent`, `memory_utilization_percent`, `memory_used_bytes`,
    `memory_total_bytes`, `memory_percent_used`, `temperature_c`, `power_usage_watts`,
    `power_limit_watts`. Not renamed on the way through: calling `gpu_utilization_percent`
    something tidier here would make this the one place in MARP that does, which is item 16 all
    over again.

    **Reduced to the GPUs rather than passed through whole.** The snapshot also describes CPU,
    disk, network, the torch build, the engine list and the reduction registry, and gap 12
    already records this route as megabytes a refresh at #104's scale.

    Two limits stand and the screen must not paper over them: `as_of` is when the **lease
    opened**, not now, so a column headed *GPU load* has to say when it was read; and an idle
    machine holds no attempt and therefore has no reading at all, which is still a dash.

    **The first of those two limits is gone, as of 2026-10-15.** The heartbeat now carries the
    reading as well (see gap 21), so the pool view serves the machine's **live** numbers where
    a current worker is sending them, and falls back to the poll's snapshot where it is not.
    `telemetry.live` says which, and the screen has to read it: a reading from ten seconds ago
    and one from when the lease opened are both "telemetry" and mean quite different things.
    The second limit stands unchanged — an idle machine still has no reading, and the last one
    from an hour ago under a column headed *GPU load* would be a wrong number rather than a
    missing one.

28. **The model registry is thinner than the screens assume** — `GET /api/v2/ml_models` does
    list the registry, so the counts are real. What is not on an `MlModel`: anything marking a
    model **preferred**, any count of **how many workers hold it cached**, and any `versions`
    array — a version chain is `parent_model_id` and has to be walked. `GET /api/v2/dataset`
    likewise has no status, so nothing in the API says a dataset is building.

    Worth knowing alongside it: **`/v2/training_run` has no collection listing.** `POST` on
    the collection creates one, and `GET`, `PUT` and `DELETE` on `/:id` reach one you already
    know the id of — so a training run can be created and fetched by id and never *found*,
    and no screen can show training history from the API at all.

    This line used to say the route had "only a `POST`", which was wrong about the three
    routes on `/:id`. Corrected 2026-10-15; the gap is the collection read, not the whole
    surface.

    Found 2026-10-14 in #128, after looking outside the `/gpu/` group for the first time.

    **Closed in the API, 2026-10-15**, except one part that could not be.

    `ml_models.preferred` is a boolean, **one per `model_type`**, enforced by a partial unique
    index -- registry-wide would have meant choosing one preferred model for detection and
    segmentation together, which is not a choice anybody wants to make.
    `GET /ml_models/:id/versions` walks the chain: up to the root, then back down, so asking
    about any member returns the whole family. Its own route rather than inline on the registry
    listing, so a caller that only wants the list does not pay for a self-join per row.
    `datasets.status` is `draft | building | ready | failed`, and existing rows were backfilled
    to `ready` rather than taking the default, because every dataset in the database is a
    finished one and describing it as unstarted would be a value becoming wrong.
    `GET /training_run` lists runs, newest first, optionally for one model.

    **A dataset's status is a recorded fact, not a derived one.** Whoever creates or updates the
    row sets it; MARP does not run the build and this does not pretend it does. What *performs* a
    dataset build is still open -- that is gap 19, and the Datasets fixtures name a `gpu-build-02`
    worker that nothing in the API backs. Until something is doing the building, nothing moves a
    row off `draft` but a caller.

    **How many workers hold a model cached was not closed**, because nothing records it: not the
    enrolment capabilities, not the poll, not anywhere. It needs the worker to say what it has,
    and the worker is `marp-inference-worker`, a separate git repository rather than a separate
    database.

    **Looked at properly on 2026-10-15 it is small, and needs no migration.** The worker already
    keeps a real cache -- `models/model_cache.py`, laid out as
    `models/cache/<model_id>_<sha256>/<file>` -- so it already knows what it holds and merely
    never reports it. Adding a `models_cached` list to the `capabilities` blob puts it exactly
    where `slots`, `engines`, `cuda_devices` and the NVML telemetry already live, and MARP
    already stores that blob.

    One thing on this side has to change with it: **the poll does not write capabilities back to
    the worker row.** `gpu_workers.capabilities` is written at enrolment and never again -- a
    poll snapshots onto the attempt instead -- so a cache list stored there would be frozen at
    whatever the machine had when it first appeared. That is one statement, still no migration.

    A `worker_model_cache` table is the other option and would be more queryable, with a record
    of *when* something was cached. It costs a migration and sync logic, which the capabilities
    route does not, so it is the thing to promote to rather than to start from.

    Either way the count is as of each worker's last poll, and an offline machine reports
    whatever it last said -- which is about right, since a cache does not empty itself when a
    computer is switched off.

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
