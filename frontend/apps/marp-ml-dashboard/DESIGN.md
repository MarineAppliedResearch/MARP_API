# MARP Machine Learning Dashboard — design contract

The interactive mockup of MARP's ML operator surface. Designed in
[`MARP_API#104`](https://github.com/MarineAppliedResearch/MARP_API/issues/104), which
carries the product requirements and the eight reference mockups. **Where a mockup and
that issue disagree, the issue wins. Where this file and the issue disagree, the issue
wins.**

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
3. **The shell is authored once**, in `index.html` and `src/app.js`. A tab draws inside
   the content area and never touches the rail, the top bar or the document title.
4. **A tab never writes its own hex, font stack, radius or shadow.** If a component you
   need is not in the vocabulary below, it is a shared component — say so rather than
   inventing a private one, because the next tab will need it too.
5. **Numbers are `tabular-nums`** and right-aligned in a table. The base size is 12px and
   the app is dense on purpose; this is an operator console, not a marketing page.
6. **No emoji, anywhere.** Icons are inline SVG from `src/lib/icons.js`.

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

Authored in `styles/app.css`. Use these; do not re-cut them.

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

The row of headline numbers at the top of Dashboard and Jobs.

```html
<div class="stat-row">
  <div class="stat" data-state="running">
    <span class="stat-ico">...svg...</span>
    <span class="stat-lab">Running Jobs</span>
    <b class="stat-num">6</b>
    <span class="stat-sub"><i>2</i> training <i>4</i> inference</span>
  </div>
</div>
```

`data-state` tints the icon chip and nothing else. The card body never changes colour —
five differently-coloured cards in a row is a traffic light, not a summary.

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
- `.tabstrip` — the in-page tab row (Run Inference Job / Batch Inference / ...). One
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

## Module contract

One file per tab in `src/tabs/`, an ES module:

```js
export const meta = { id: 'jobs', title: 'Jobs', subtitle: 'Everything the pool is doing' };

/** Build the tab. Called once per navigation. Return one element. */
export function render(ctx) { ... }

/** Optional. Wire events after the element is in the document. */
export function mount(el, ctx) { ... }
```

`ctx` is `{ data, nav, fmt }`:

- `ctx.data` — the parsed fixture, already loaded. Read it; never fetch.
- `ctx.nav(id, params)` — navigate to another tab. This is the only way a tab reaches
  another tab.
- `ctx.fmt` — the shared formatters (`fmt.int`, `fmt.pct`, `fmt.dur`, `fmt.when`,
  `fmt.date`, `fmt.gb`). A tab that formats a duration its own way makes two screens
  disagree about the same job.

Build DOM with `src/lib/dom.js` — `h(tag, props, ...kids)` and `frag(...)`. It sets
`class`, `data-*`, `aria-*`, `on*` handlers and text. It does not parse HTML strings, on
purpose: a fixture field interpolated into `innerHTML` is how a mockup grows an injection
bug that survives into the real app.

## The fixture

`fixtures/ml-dashboard.json`, generated by `tools/make-fixture.mjs` from a fixed seed, so
regenerating it produces the same bytes. **A generated file is a regeneration, not a merge
conflict** — if two branches both touch it, run the generator.

Field names follow the real response shapes recorded in #104's measurement comment
wherever the API can already answer, so wiring later is a change of source and not a
change of vocabulary. Top-level keys:

| Key | What it holds |
| --- | --- |
| `projects` | `{id, code, name, dives, lines, videos, frames}` |
| `jobs` | the shared queue and history, newest first |
| `workers` | the pool, 143 rows |
| `models` | `ml_models` registry rows with their versions |
| `datasets` | saved training datasets with their splits |
| `runs` | training runs with epochs and metrics |
| `events` | per-job event lines, for the diagnostics view |
| `counts` | the rollups the stat cards read, precomputed |
| `species` | the label set a model was trained with |

A `job` row, which is the shape most of the app reads:

```json
{
  "id": 1711,
  "batch_id": "b7c1...",
  "name": "GULF_Invertebrate_Detect_v2",
  "kind": "inference",
  "state": "running",
  "priority": 5,
  "scope": { "label": "Survey: DIVE1", "project": "CAMPA 2024", "videos": 1 },
  "model": { "id": 91, "name": "MARP-Det-v3", "version": "2.1.0", "sha256": "9f2c..." },
  "progress": { "done": 12840, "total": 18300, "unit": "frames" },
  "workers": { "using": 8, "cap": 8 },
  "attempts_made": 1,
  "max_attempts": 3,
  "created_by": "itravers",
  "created_at": "2026-09-08T14:12:00Z",
  "updated_at": "2026-09-08T14:32:00Z",
  "finished_at": null,
  "duration_s": null,
  "detections": null,
  "issues": []
}
```

Fields the generator carries beyond that example, because a screen needs them:
`failure_reason` on a failed job, `dataset` and `run_id` on a training job, `scope.video`,
and `model.version_id`. A worker carries `current_job`, `current_model` and `attempts`
beyond the nine real columns — `current_model` is in #104's *Normal worker information* and
has no API representation at all, so without it the Workers tab would invent one. An event
carries `seq`, a real `gpu_job_events` column, because timestamps tie.

**`lease_expires_at` is the only field in the fixture dated in the future**, and it has to
be: a live lease that has already expired reads as a dead machine.

**What "online" counts.** 143 workers are enrolled: 118 `online`, 6 `paused`, 19 `offline`.
`counts.workers_online` is 124 — *reachable*, meaning not offline, with the paused six a
subset of the reachable rather than a fourth bucket. That is how the Dashboard mockup's
"124 / 143, 86% online" adds up. A reading where the pool is 149 machines is the other
available one and is not what this fixture means.

`state` is one of `queued running succeeded issues failed cancelled cancelling paused`.
Two of those are derived rather than stored, and the fixture carries them as states anyway
because that is what a screen shows: **`cancelling`** is `job.state == 'cancelled'` with a
live attempt (#104 measured it lasting 18-20 s), and **`issues`** is the *completed with
issues* rollup, which #104 moved to Milestone 2.

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
13. **Scheduled inference** — nothing in #104 asks for it and nothing represents it. Drawn
    as a disabled sub-tab (assumption A4 in `.marp/task.md`).
14. **Annotated video generation and detection crops** — output options in the Inference
    mockup with no pipeline behind them.
15. **Three of the fixture's shapes are not the shapes of the tables they will come from**,
    so wiring them is a mapping and not a rename. `runs[].epochs` here is
    `{epoch, train_loss, val_loss, map50, seconds}`; the real `epochs` table carries
    `box_loss`, `cls_loss`, `dfl_loss`, `precision`, `recall`, `map50`, `map5095`.
    `datasets` here carries a class breakdown and a split; the real table carries
    `num_samples`, `num_classes`, `location`, `source`. `models` here carries a `versions`
    array; `ml_models` carries `parent_model_id`, `model_type`, `architecture_version`,
    `storage_path` and `status`, and **has no versions array at all** — a version chain is
    a self-join. These shapes were chosen for what the screens need; the mapping is the
    implementation phase's work.
16. **How many machines worked on a finished job** is not recorded anywhere, so
    `workers.using` is 0 on every terminal row and a History column cannot show it.
    "Using" is present tense.

## Running it

```bash
cd frontend/apps/marp-ml-dashboard
npm run serve      # then open the address it prints
npm run lint       # parse check, about a second
npm test           # lint, unit, then Playwright at both viewports
npm run fixture    # regenerate fixtures/ml-dashboard.json
```

Served in place by the API too: `app.js` serves any folder under `frontend/apps/` by name,
so adding this app was a folder and not a route.
