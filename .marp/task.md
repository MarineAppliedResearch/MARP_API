---
task: MarineAppliedResearch/MARP_API#104
repos: [marp-api]
status: design
needs: []
---

## Goal

MARP gets a Machine Learning Dashboard: the operator surface for running inference and
training on the distributed GPU pool, managing saved training datasets and registered
models, and understanding the worker pool. This task is the **interactive HTML mockup** of
that application — eight tabs, real look and feel, real operation, fixture data. Nobody
runs a job from it yet. Its purpose is to settle the design so that a later phase can wire
it to the API without re-litigating layout, vocabulary or workflow.

## Requirements

- **R1 · Visual family** — the app reads as MARP. Palette comes from
  `frontend/shared/assets/css/tokens.css` and is never restated. Logo is
  `marp-logo-compact.png`, the treatment the Picture Mosaic Reviewer uses. Dense compact
  panels, 12px base, `tabular-nums`, dark marine ground, restrained luminous accents.
- **R2 · Shell** — a fixed left rail carrying the logo, the eight destinations and a
  status foot; a top bar carrying the page title, the project scope, search and the two
  primary job actions. The shell is identical on every tab and is authored once.
- **R3 · Eight tabs, each recognisably the drawn mockup** — Dashboard, Jobs, Inference,
  Training, Datasets, Models, Workers, History. Each is drawn from its own mockup on #104,
  which is the reference for layout and content.
- **R4 · Basic operation, not a picture** — the rail navigates; in-page tab strips switch;
  selects and search filter the rows they are drawn above; sliders and steppers move and
  their read-outs follow; paging pages; a row opens its detail; a form's summary reflects
  what has been chosen. Every control either does its thing or is visibly disabled.
- **R5 · One fixture, one shape** — every tab reads `fixtures/ml-dashboard.json`. Field
  names match the real API response shapes recorded on #104 wherever the API can already
  answer, so wiring the app later is a change of source and not a change of vocabulary.
- **R6 · Honest about what is not built** — where a screen shows something the API has no
  representation for (a logical job over a project, "completed with issues", a job event
  log, an artifact download, worker mutation), the app still draws it, and `DESIGN.md`
  records it in one list. A mockup that quietly invents an API is how the implementation
  agent gets misled.
- **R7 · Responsive** — usable at desktop width and at phone width. The rail collapses to
  icons and then to a sheet; tables that cannot fit scroll inside their own panel and never
  scroll the page sideways.
- **R8 · Its own package** — the app owns its `package.json`, a static server, a syntax
  check and its walkthrough scenarios, the way `marp-mosaic-review` does, so it can be
  extracted later without untangling anything.

## Open assumptions

- [x] **A1 · product/UI · non-blocking** — answered 2026-09-09 from #104 and the mockups:
  the mockups are drawn as they are, including surfaces the API cannot answer yet. The
  issue's mockup process asks for exactly that, and R6 is how the gap is recorded rather
  than hidden. Getting this wrong costs a label, not a rebuild.
- [x] **A2 · product/UI · non-blocking** — answered 2026-09-09: the mockups' top-bar
  **Environment: Production** select is dropped. MARP has no environment concept, and a
  mockup that offers a Production/Staging switch teaches the implementation agent that one
  exists. **Project** stays; it is real.
- [x] **A3 · product/UI · non-blocking** — answered 2026-09-09: the rail carries eight
  destinations, following the mockups, where #104's prose lists seven functional domains.
  History is drawn as its own tab there and Jobs keeps the active/recent view.
- [ ] **A4 · product/UI · non-blocking** — the Inference tab's mockup carries a
  **Scheduled Inference** sub-tab. Nothing in #104 asks for scheduling and no API
  represents it. Drawn as a disabled sub-tab labelled as a later milestone unless told
  otherwise.

## Decisions

- **2026-09-09** — the app lives at `frontend/apps/marp-ml-dashboard/`. `app.js` already
  serves any folder under `frontend/apps/` by name, so adding it is a folder and not a
  route.
- **2026-09-09** — one shared stylesheet holds the shell and the component vocabulary;
  each group of tabs adds its own stylesheet for what only it needs. This is what lets
  three agents draw eight tabs without fighting over one file.
- **2026-09-09** — a tab is an ES module exporting `render(ctx)` and optionally
  `mount(el, ctx)`. The router owns the shell and never reaches inside a tab.

## Plan

1. Shell and design system, authored once: `index.html`, `styles/app.css`, `src/app.js`,
   `src/lib/dom.js`, `src/data.js`, `fixtures/ml-dashboard.json`, `DESIGN.md`, the package
   and its tools.
2. Eight tabs, three agents, disjoint files:
   - Dashboard, Jobs, History — the table-and-rollup screens.
   - Inference, Training — the two creation flows.
   - Datasets, Models, Workers — the asset and pool screens.
3. Integrate: one screenshot per tab at desktop and phone width.
4. Narrated walkthrough per tab group, for the human's review.

## Acceptance criteria

- Every one of the eight tabs renders at 1672x941 and at 390x844 with no horizontal page
  scroll and no element overlapping another.
- Every control listed in R4 has been exercised in a browser test and asserted on its
  effect, not on the fact that it was clicked.
- `styles/*.css` contains no hex colour that is not a token reference, except the few
  local surfaces `tokens.css` genuinely does not carry — each with a comment saying why.
- `DESIGN.md` lists every surface that has no API behind it.
- The app runs from a fixture with no server beyond a static file server.

## Test plan

Written at G3, in `.marp/verification.md`. The tiers this app has are the mosaic
reviewer's: a syntax check, unit tests over anything with logic, Playwright at two
viewports for what was drawn, and narrated walkthroughs. A store-level check cannot see a
layout, and that is the failure mode this design is most exposed to.
