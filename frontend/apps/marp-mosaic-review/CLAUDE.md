# marp-mosaic-review — architecture notes

The MARP Picture Mosaic Reviewer. The design record is
[MARP_API#68](https://github.com/MarineAppliedResearch/MARP_API/issues/68); the phased
plan of development lives there too, and this app is phase 0 of it.

`README.md` next to this file says how to run it, what works, and how to record a
walkthrough. **This file is why it is built the way it is** — the invariants, and the
traps that already cost real time. Read it before changing anything structural.

Everything here is vanilla ES modules. No framework, no build step, no bundler, no
runtime dependencies. That is deliberate and worth preserving: it is what lets this
app be extracted into its own repository later without untangling a toolchain.

## The layers, and which way they point

```
ui/  ──calls──▶  store.js  ──asks──▶  model/     (pure rules)
                    │
                    └────asks──▶  data.js        (the only backend knowledge)
```

Dependencies point one way only. Nothing lower ever imports something higher.

| Layer | May touch | Must never touch |
| --- | --- | --- |
| `model/` | its own arguments | the DOM, the network, `state` |
| `data.js` | the fixture, later `fetch` | the DOM, `state`, `model/` |
| `store.js` | `model/`, `data.js`, `state` | the DOM |
| `ui/` | `state`, `actions`, the DOM | `state` **as a writable thing** |

**`model/` touches neither the DOM nor the network.** That is what makes the rules
testable in milliseconds, and it is where most of the defects found so far actually
lived — what a mark means per mode, the inverted commit in Delete Mode, what a
committed page holds afterwards. When a bug is about *meaning*, its fix belongs here
and its test belongs in `tests/unit/`.

**`ui/` reads state and writes DOM. It never writes state.** A UI file that assigns to
`state.anything` has broken the one rule that keeps rendering predictable. Call an
action instead.

**`data.js` is the only file that knows where observations come from.** Everything else
goes through `MarpData.query()`, `commitPage()`, `setSpecies()` and friends, which
already return the shapes the API is expected to return — including the per-observation
`reviewed` / `flagged` / `skipped` / `reverted` results that bulk operations require.
Phase 8 of #68 replaces this file with `src/api/` and claims that nothing above it
changes. Every rule that leaks upward out of this file makes that claim less true.

## How a gesture becomes a render

```
click → mount.js listener → actions.foo() → model/ decides → state mutated
      → fire('foo') logs the named action → notify() → every subscriber re-renders
```

Four things follow from that, all of them load-bearing:

- **`mount.js` is the only file that binds events.** One place to look for "what happens
  when I click this", and one place where event ordering bugs can hide.
- **Every gesture fires a *named action*,** shown in the on-screen action log. Those
  names are the API seams: each one becomes a call in phase 8. Adding a gesture that
  does not fire one hides a future endpoint.
- **Rendering is a full re-render from state.** There is no incremental DOM patching and
  no diffing. Do not add any — the grid is small enough that correctness is worth more
  than the microseconds, and every render bug found so far was easier to see for it.
- **State is not observable.** Mutating `state` without calling `notify()` produces a
  screen that silently disagrees with the data.

`window.MARP` exposes `{ state, actions }` for the console.

## Three things a tile shows at once, and they are different

This is the single most confused area of the code, and the source of several reported
bugs. `ui/tile.js` derives all three; none of them is stored on the row.

| | What it is | Lives in |
| --- | --- | --- |
| **marked** | what this reviewer has marked but not committed | `state.marks`, transient |
| **existing** | what the record already carried before this reviewer arrived | the row's own status columns |
| **outcome** | what the last commit just did | `state.outcomes`, per commit |

A mark is not a decision. **Committing is what writes it to the record** — that is why a
flag survives leaving the page, the session, and the reviewer, and why "my flags
disappeared when I came back" was a real defect rather than a misunderstanding.

`model/modes.js:existingState()` is what decides which status dimension a mode reads.
Scientific review reads `review_status`; training reads `training_disposition`. **They
are independent decisions about the same observation** — #68 is explicit about this, and
conflating them breaks the science, not just the UI.

## Invariants that will bite

Each of these is a bug that actually happened. They look like over-engineering until
you remove one.

**The grid must not re-measure while loading.** `computeLayout` returns early when
`state.loading`. Without it: `overflow-y: auto` adds a scrollbar → the field narrows →
tiles shrink → an extra row fits → overflow → repeat. The grid never settles, "page 1"
holds different observations on each visit, and marks appear to vanish. `scrollbar-gutter:
stable` plus a flap guard closes the rest of that loop.

**Every query carries a sequencing token.** `const token = ++reqSeq; … if (token !== reqSeq) return;`
Overlapping queries land out of order otherwise, and the screen shows an older result
than the one that was asked for last.

**A committed page keeps its membership.** `state.pinnedIds` holds the exact ids that
were on screen, and `refresh()` fetches those by id rather than re-running the filter.
Returning to a page must show what was submitted, not whatever the filter now matches.
This is why `data.js` has `byIds()` at all.

**A click that dismisses the panel must not also act.** `mount.js` returns early when
`state.picker` is open. Acting as well silently undid the very mark the panel belonged
to, and the walkthrough passed anyway because it never asserted the mark survived.

**`setPageSize` guards on `state.ready`, not on row count.** Guarding on
`state.rows.length` meant the first notify (rows still empty) never triggered the
refresh, and the page size stayed wrong until something else moved.

**Grid children need `min-width: 0`.** A grid item's automatic minimum size is its
content, so without this the app grows wider than a phone viewport and the whole page
scrolls sideways. `.app` also pins `width: 100%; max-width: 100vw; overflow: hidden`.

**Do not trust a headless screenshot's width.** Headless Chrome clamps the viewport at
roughly 500px, so a screenshot can show phantom grid overflow that does not exist. The
Playwright `phone` project honours the real width; use that, not a screenshot, to judge
layout.

## Where things go

| Adding | Touch |
| --- | --- |
| a mode | `model/modes.js` (rules), `styles/app.css` (`body[data-mode]` hue), `index.html` (the selector) |
| a filter | `model/filters.js`, `data.js` query, `ui/chrome.js` rail |
| a gesture | `ui/mount.js` listener → new action in `store.js` → rule in `model/` |
| a walkthrough | one entry in `tests/walkthrough/scenarios.mjs`; the runner and recorder need no changes |

Mode colour is **chrome only**. Never tint the imagery — the reviewer is judging how the
organism looks, and #68 treats the image field as a quiet zone.

Palette comes from `frontend/shared/assets/css/tokens.css`. Do not add hex values to
`styles/app.css`; add a token.

## Which tier catches what

Three tiers, and they fail in genuinely different ways. Choosing the wrong one is how
bugs ship.

| Tier | Catches | Cannot catch |
| --- | --- | --- |
| `tests/unit/` — Node | rules, per mode, per commit | anything rendered |
| `tests.html` — browser contract | store behaviour against requirements | whether it was drawn |
| `tests/e2e/` — Playwright | badges actually drawn, panels on-screen, no console errors | meaning |

**Every rendering defect so far passed the store-level checks.** A badge that is never
drawn, a panel positioned off-screen, a grid that re-queries itself — the store was
correct in all three cases. If a fix is about what appears, the test belongs in
Playwright.

The walkthrough videos are a fourth, informal tier and have found a defect the others
missed. They assert as they go, so a broken app fails rather than producing a
misleading film. When adding a scene, **assert the state it is narrating** — the
training exclusion scene passed for a week while excluding nothing, because it only
asserted that the panel opened.

## Known gaps

Tracked as phase 1 in #68: no keyboard model, the filter rail is partly presentational,
no empty or completed states, no feedback when marking a tile whose imagery is
unavailable, and nothing persists across a reload.
