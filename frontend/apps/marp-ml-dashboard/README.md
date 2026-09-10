# MARP Machine Learning Dashboard

The operator surface for MARP's distributed GPU/ML system: running inference and training
jobs, managing saved training datasets and registered models, and understanding the worker
pool that executes the work.

**This is a mockup with real operation.** Fixture data, real filtering, real navigation,
real form behaviour — and no connection to the API. It exists to settle the design before
an implementation phase wires it up. Designed in
[`MARP_API#104`](https://github.com/MarineAppliedResearch/MARP_API/issues/104).

**Read [DESIGN.md](DESIGN.md) before changing anything here.** It is the contract: the
layout, the breakpoints, the component vocabulary, the state list, the module contract,
the fixture shape, and — numbered, so a screen can point at one — every surface the
mockups draw that no API can answer yet.

## Running it

```bash
npm install
npm run serve        # then open the address it prints
```

The API serves it in place too: `app.js` serves any folder under `frontend/apps/` by name,
so adding this app was a folder and not a route.

## The loop

```bash
npm run lint         # parses every file, and enforces two DESIGN.md rules. About a second.
npm run test:unit    # anything with logic in it
npm run shots        # screenshots every tab at both viewports into shots/
npm test             # lint, unit, then Playwright at both viewports
```

`npm run lint` is the working loop. It runs two checks:

- **`tools/syntax-check.mjs`** — will every file parse? There is no build step here, which
  is a feature, but it means nothing reads the source before a browser does.
- **`tools/style-check.mjs`** — no raw hex colour in a stylesheet, and no `data-state`
  outside the vocabulary. Both are DESIGN.md rules, and a rule that is only written down
  is a rule that drifts. A declaration that genuinely needs a literal carries
  `token-exempt` and a reason.

`npm run shots` is how whoever is drawing a screen looks at what they drew. It starts its
own server on its own port, writes `shots/<tab>-<desktop|phone>.png`, and **fails on two
things a screenshot will not tell you**: a console error, and a page that scrolls
sideways.

```bash
npm run shots            # every tab, both viewports
node tools/shots.mjs jobs desktop
```

## The fixture

```bash
npm run fixture          # regenerate fixtures/ml-dashboard.json
```

Deterministic, from a fixed seed, so regenerating produces the same bytes. It is a
**generated file**: if two branches both touch it, the resolution is to run the generator
again, not to hand-resolve the diff. `tests/unit/fixture.test.mjs` asserts the invariants
that would otherwise rot silently — that the stat-card rollups equal a recount of the
rows, that every dataset's split sums to its membership, and that a busy worker's job
actually exists.

## Narrated walkthroughs

```bash
npm run demo             # the default scenario, silent
npm run demo:narrated -- jobs
npm run demo:all
```

Playwright drives a scenario, records video, and a spoken narration is mixed over it.
These are a **review surface** — a person watches one to confirm behaviour — but they
assert as they go, so a broken application fails and writes no video rather than producing
a convincing film of something that does not work. The recorder is shared; see
`MARP_API/tools/walkthrough/` and ADR-0007. This app contributes two files:
`tests/walkthrough/scenarios.mjs` and `tools/record-demo.mjs`.

Recorded on request, never in the loop. A narrated run takes minutes.

## Layout of the source

```
index.html                  the document. Links the shared tokens, never restates them.
DESIGN.md                   the contract. Binding.
src/app.js                  the shell and the router. Owns the rail and the top bar.
src/data.js                 the seam. Today one fixture; later, the /api/v2/gpu routes.
src/lib/dom.js              h / frag / fill. No HTML-string parsing, deliberately.
src/lib/parts.js            the shared components, as builders
src/lib/fmt.js              the shared formatters
src/lib/icons.js            the icon set. No emoji anywhere in this app.
src/tabs/*.js               one module per tab: meta, render(ctx), mount(el, ctx)
styles/app.css              the shell and the component vocabulary
styles/tabs-*.css           what one group of tabs needs and nobody else does
```

The rule that makes it hold together: **a tab renders into the content slot and never
reaches out of it.** That is what let eight tabs be drawn by different people and still be
one application.
