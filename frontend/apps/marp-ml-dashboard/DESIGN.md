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
way it reads), expandable rows, a drawer, row selection, tab and segment
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
13. **Scheduled inference** — nothing in #104 asks for it and nothing represents it. Drawn
    as a disabled sub-tab (assumption A4 in `.marp/task.md`).
14. **Annotated video generation and detection crops** — output options in the Inference
    mockup with no pipeline behind them.
15. **A dataset export** — the images and labels of a saved dataset, as an archive. Drawn
    on the saved-dataset rows and beside *Create dataset*; nothing produces one.
16. **Model weights** — `model.url` is whatever the submitter typed and nothing serves the
    bytes, so *Download weights* has nowhere to fetch from. Drawn on the model's actions
    and per version in its training history.
17. **Three of the shapes used here are not the shapes of the tables they will come from**,
    so wiring them is a mapping and not a rename. `runs[].epochs` here is
    `{epoch, train_loss, val_loss, map50, seconds}`; the real `epochs` table carries
    `box_loss`, `cls_loss`, `dfl_loss`, `precision`, `recall`, `map50`, `map5095`.
    `datasets` here carries a class breakdown and a split; the real table carries
    `num_samples`, `num_classes`, `location`, `source`. `models` here carries a `versions`
    array; `ml_models` carries `parent_model_id`, `model_type`, `architecture_version`,
    `storage_path` and `status`, and **has no versions array at all** — a version chain is
    a self-join. These shapes were chosen for what the screens need; the mapping is the
    implementation phase's work.
18. **How many machines worked on a finished job** is not recorded anywhere, so
    `workers.using` is 0 on every terminal row and a History column cannot show it.
    "Using" is present tense.

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
