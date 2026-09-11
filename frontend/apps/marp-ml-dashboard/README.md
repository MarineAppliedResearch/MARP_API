# MARP Machine Learning Dashboard

The operator surface for MARP's distributed GPU/ML system: running inference and
training on the worker pool, building saved training datasets, managing
registered models, and understanding the machines that do the work.

**This is the design, not the application.** Eight hand-written screens with no
data layer — every value on them is written into the HTML. Designed in
[`MARP_API#104`](https://github.com/MarineAppliedResearch/MARP_API/issues/104),
one screen at a time, each reviewed against the reference mockups on that issue
before the next was started.

**Read [DESIGN.md](DESIGN.md) before changing anything here.** It is the
contract: the layout, the breakpoints, the component vocabulary, the state list,
how a screen is put together, and — numbered, so a screen can point at one —
every surface that no API can answer yet.

## Running it

```bash
npm install
npm run serve        # then open the address it prints
```

Served in place by the API as well: `app.js` serves any folder under
`frontend/apps/` by name, so `/apps/marp-ml-dashboard/` opens the Dashboard, and
the Machine Learning Dashboard card on the MARP landing page links to it.

## The loop

```bash
npm run lint         # parse, colours, state vocabulary. About a second
npm run shots        # every screen at four widths, into shots/
npm test             # both
```

`npm run shots` is how the design is reviewed: it writes
`shots/mock-<screen>-<width>.png` at 1672&times;941, 1000px, the full phone
column and the phone fold, plus the account menu and any drawer or expanded row.
It **fails** on a console error, on anything clipped at the right edge, on any
element wider than its container, on two controls in a row that are not on the
same line, and on a tab icon that does not resolve. Every one of those checks
exists because that fault shipped at least once and was found by measuring
rather than by looking.

```bash
node tools/mock-shots.mjs jobs            # one screen
node tools/mock-shots.mjs jobs desktop    # one screen, one width
```

## The screens

| | |
| --- | --- |
| `dashboard` | What the pool is running, queued, and struggling with |
| `jobs` | One queue for training and inference, with the job drawer |
| `inference` | Running a model over MARP data |
| `training` | Fine-tuning from a registered model over one saved dataset |
| `datasets` | Building a training set, and the train/validation/test split |
| `models` | The registry, its versions, lineage and preferences |
| `workers` | The GPU pool, built for 143 machines rather than four |
| `history` | Finished work, in a bounded window |

## What is next

A data layer shaped like the real `/api/v2/gpu/…` responses, so these screens
read from something with the same shape the API has — and so wiring them up
later is a change of source rather than a change of vocabulary. That needs the
API surface settled first, which is its own piece of work.

Until then, nothing here should be read as a decision about how data arrives.
