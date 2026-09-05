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

## Where the work is

**Read [MARP_API#68](https://github.com/MarineAppliedResearch/MARP_API/issues/68) before
starting anything.** It is the design record and the plan of record: eleven phases, what
each delivers, and what verifies it. This file says how the code works; the issue says
what to build next and why.

As of 2026-09-05, on branch `68-mosaic-review-prototype`:

- **Phase 0 is done.** The prototype runs the whole workflow against a fixture, with
  four test tiers (parse, unit, contract, render/e2e) all green.
- **Phase 1 is in progress** — closing the client's functional gaps, still fixture
  backed. #68 lists what is done and what remains. The largest remaining item is
  multi-select filters: the issue requires irregular combinations across projects,
  dives and lines, and the rail is single-select today.
- **Phase 2 is done.** The five schema-blocking questions were answered on 2026-09-05
  and are written up as *The schema decisions* in #68. Phase 3 is unblocked.

Three of them name client work that has not been built yet. None of it contradicts what
the prototype does — these are the next things to add, not things to undo:

- **The delete confirmation.** Deletion is permanent with no undo, so the client must
  confirm first, naming the exact count and saying plainly that it deletes records from
  the database and cannot be undone through MARP. Not built yet.
- **Adjacent-page prefetching.** Page N+1 is fetched in the background while the reviewer
  works, so paging never shows a delay. Not built yet.
- **Deterministic ordering** with an `observation_id` tie-breaker on every query, which is
  what makes a re-query return the same page.

**`state.pageMembers` stays.** The in-memory pin is wanted: within a session it is what
lets a reviewer return to a page and see, and undo, what they submitted. The
query-derived decision is about *reload* — on a fresh load the filters apply normally and
finished work is expected to have left the view. Do not remove the pin.

Nothing in this app talks to MARP_API yet, and no review or training column exists in
the database. `src/data.js` is the seam where that arrives, in phase 8.

### How this app is worked on

The user reviews changes by using the app, and reports what they see. That has been far
more effective at finding defects than the suite, so:

- **Run `npm run test:unit` after every change.** It is about a second, and it includes
  the parse check.
- **Every reported defect gets a named test at the tier that can actually see it**
  before it is called fixed. Several were reported twice because the first fix was
  verified at a tier that structurally could not observe the bug.
- **Record videos only when asked.** `npm run demo:narrated -- <scenario>` exists for
  confirming behaviour on request, not as part of the loop. The `verify-*` scenarios
  narrate what to watch for and assert it as they go.
- Design decisions go into #68 as they are made. That issue, not this file, is where
  the user expects to find what was decided and why.

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
| **outcome** | what the last commit just did | `state.outcomes`, per commit, per mode |

Their precedence in `tile.js` is fixed and load-bearing: **a mark outranks an outcome,
which outranks the record.** Once the reviewer touches a committed tile they are
editing it, and the screen has to show the new intention rather than the old answer —
otherwise the click appears to do nothing. A fourth derived state, *taking back*, covers
the gap: the record still carries the exception, the reviewer has removed the mark, and
nothing is written until the next commit.

**The marks are the page's exception set — not a scratchpad.** At commit, whatever is
marked becomes the exception and whatever is not becomes accepted. Three rules follow,
and all three were bugs before they were rules:

- A page arrives with its existing exceptions **already marked** (`page.seedMarks`).
  Without that, committing a page holding flags that nobody touched silently cleared
  them, because the commit accepts everything unmarked.
- A commit does **not** clear the marks. `page.marksAfterCommit` keeps the exceptions
  marked, so the page stays editable and a click still means what it meant a moment
  ago. Delete Mode keeps nothing marked — a deleted row is not a pending intention.
- `state.touched` holds what the reviewer decided by hand. Those ids are never
  re-seeded, so taking a flag off and paging away does not put it back.

**`state.outcomes` is scoped to a mode, and `setMode` clears it.** Left standing, a
scientific commit painted REVIEWED badges across Training and Delete — two independent
decisions wearing each other's answer. Nothing is lost: what was committed is on the
record, and the next query reads it back through this mode's own status dimension.

A mark is not a decision. **Committing is what writes it to the record** — that is why a
flag survives leaving the page, the session, and the reviewer, and why "my flags
disappeared when I came back" was a real defect rather than a misunderstanding.

`model/modes.js:existingState()` is what decides which status dimension a mode reads.
Scientific review reads `review_status`; training reads `training_disposition`. **They
are independent decisions about the same observation** — #68 is explicit about this, and
conflating them breaks the science, not just the UI.

**Delete Mode is the deliberate exception, and reads both.** `statusDimensions()`
returns one dimension for the review modes and two for Delete. Deleting is
irreversible, so the useful question is not what one workflow thinks but whether
*anything* on the record says stop — it was flagged, it was accepted for science, it is
already teaching a model. Those badges and filters are context, never a selection:
`pendingException('delete')` is null, so nothing in Delete ever arrives marked, and the
commit acts only on what the reviewer picked in this sitting.

Adding a dimension to a mode means editing `MODES` and nothing else — the rail, the
query, the defaults and the collapsed-rail badge all go through `statusDimensions()`.

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

**A committed page is not finished.** The reviewer can take a flag back and commit
again. Anything that treats a commit as terminal — clearing marks, locking tiles,
letting an outcome outrank a mark — breaks that, and it is the single area of this app
that has produced the most reported bugs.

**Never blank the panel before an `await`.** `renderPicker` is async: it fetches the
taxonomy when the species chooser is open. Clearing `#picker` first left it missing for
the length of that request, which read as the panel closing and reopening by itself.
Fetch, check the render token, *then* replace. Choosing a species also closes the panel
— that is what it was opened to do — while leaving the mark, because correcting a
species and resolving a flag are separate decisions.

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
| a filter | `model/filters.js` (add to `FILTER_KEYS`), `data.js` query and counts, `index.html` rail, `ui/menus.js`, `ui/chrome.js` label, `ui/mount.js` anchor |
| a gesture | `ui/mount.js` listener → new action in `store.js` → rule in `model/` |
| a walkthrough | one entry in `tests/walkthrough/scenarios.mjs`; the runner and recorder need no changes |

Mode colour is **chrome only**. Never tint the imagery — the reviewer is judging how the
organism looks, and #68 treats the image field as a quiet zone. Dimming a tile the
reviewer has already judged is the one accepted exception: flagged, excluded and doomed
tiles all step back, flagged the least because it stays in view to be resolved.

**`--accept` is what "this workflow accepted it" looks like, and it follows the mode.**
Green for scientific review, violet for training — the same violet training already uses
as its mode hue. They were both green, which made two independent decisions read as the
same answer. Everything that means *accepted by the current mode* takes this variable:
the commit button, the pager's committed pages, the legend swatch, the progress bar. The
PROMOTED badge is violet outright rather than through the variable, because it means
promotion wherever it appears.

Palette comes from `frontend/shared/assets/css/tokens.css`. Do not add hex values to
`styles/app.css`; add a token.

**Project, dive and line nest, and `applyFilter` enforces it.** A line number only
means something inside a dive, and a dive inside a project — so changing the wider one
clears the narrower. Leaving them set produces an empty mosaic and no explanation for
it. The dive and line lists are derived from the observations under the filters already
chosen, so the rail never offers a combination that returns nothing.

**The commit button reports on itself.** It is the slow action, the irreversible one,
and the only one that can fail, so it spins while working and then shows a tick or a
cross that fades after a couple of seconds — an acknowledgement, not a state. A failed
commit applies nothing and **leaves the marks alone**, so the page never has to be
redone. `MarpData.failNextCommit()` exists only so that path can be tested.

## The test tiers, and which one catches what

Four tiers plus the walkthrough videos. They fail in genuinely different ways, and
choosing the wrong one is how bugs ship.

| Tier | Command | Catches | Cannot catch |
| --- | --- | --- | --- |
| Parse | `npm run lint` | a file that will not parse | anything else |
| Unit | `npm run test:unit` | the rules in `model/` — per mode, per commit | anything rendered |
| Contract | part of `test:e2e` | store behaviour against the requirements in #68, by name | whether it was drawn |
| Render | `npm run test:e2e` | badges actually drawn, panels on-screen, colours, no console errors | meaning |

`npm test` runs all of them. `npm run test:unit` runs the parse check first.

**Run the unit tier after every change.** It is about a second including the parse
check, and it is the tier that would have caught most of what has been reported by hand.

**Every rendering defect so far passed the store-level checks.** A badge never drawn, a
panel positioned off-screen, a grid re-querying itself, a tick rendered at four times its
size — the store was correct every time. **If a fix is about what appears, the test
belongs in Playwright.** Reporting a fix verified at a tier that structurally cannot
observe it is how several defects got reported twice.

### Where a new test goes

- A rule — what a mark means, what a commit does, how filters nest → `tests/unit/`,
  as a plain `node:test` case. No browser, no DOM, no fixture loading.
- A behaviour the requirements in #68 name → `tests/requirements.js`, registered with
  `test(requirement, name, fn)` where `requirement` is the heading from the issue. Each
  check calls `reset()` first, which reloads the fixture so checks cannot contaminate
  one another.
- Anything visible → `tests/e2e/render.spec.mjs`.

**The locator trap.** A Playwright locator is re-resolved on every use, so a selector
that describes a *state* stops matching the moment the state changes:
`.tile:not(.marked)` clicked once no longer matches that tile, and `.first()` silently
slides onto a different one. Read `data-id` first and pin the tile:
``page.locator(`.tile[data-id="${id}"]`)``. Three tests were wrong this way before they
were right.

**The commit race.** `commitPage` is async and re-seeds the marks when it lands. A click
sent before it finishes is overwritten. Wait for the outcome badge, not a timeout.

## The narrated walkthroughs

Playwright drives a scenario, records video, and a spoken narration is mixed over it.
The user watches these to confirm behaviour, so they are a review surface, not a test
report — but they assert as they go, so a broken app fails and writes no video rather
than producing a convincing film of something that does not work.

**Record them when asked, not as part of the loop.**

```bash
npm run demo:narrated -- verify-modes     # one scenario, spoken
npm run demo -- delete                    # silent, faster
npm run demo:all                          # every scenario, spoken
```

Output lands in `demo/`, which is git-ignored. Send the mp4 to the user directly.

### Writing a scenario

One entry in `tests/walkthrough/scenarios.mjs`. The runner and the recorder need no
changes — that file is the whole interface.

```js
'verify-something': {
  title: 'Verifying: what this shows',
  scenes: [
    {
      caption: 'On screen, short',        // read at a glance
      say: "What the voice says.",        // conversational, spelled for a speech engine
      async act({ page, expect, settled, store }) { /* drive it, and assert */ }
    }
  ]
}
```

The three parts are deliberately separate, and each has its own rules:

- **`caption`** is read at a glance while the voice is talking. Keep it to a few words.
- **`say`** is spoken. Write it as if narrating to somebody watching over your shoulder.
  **Spell for the engine, not for the page**: write `Marp`, because `MARP` is read out as
  four letters. Say what to look at before it happens — *"watch the badges"*, *"keep your
  eye on the first tile"* — because the viewer cannot pause and ask.
- **`act`** drives the app and **must assert what the line is claiming**. This is the
  rule that matters most. The training exclusion scene passed for a week while excluding
  nothing, because it only asserted that a panel opened. A scene that narrates a result
  and does not assert it can lie.

A verification scenario should also **name the old behaviour** — *"before the fix, this
click appeared to do nothing"* — so the viewer can tell whether they are looking at the
fix or at the bug.

`act` receives `settled()`, which waits for the grid to stop moving; use it after
anything that re-queries. `store` is a plain object that carries values between scenes.

### How the timing works

Each line is **spoken and measured before the run**, and the scene is then held for
exactly as long as its own narration. Without that the captions advance on a timer and
the next line talks over the last one. `demo/<id>.holds.json` carries the measured
durations into the run; `demo/<id>.timeline.json` records when each caption appeared so
ffmpeg can place the audio.

A narrated run therefore takes a couple of minutes rather than thirty seconds. The
walkthrough Playwright project has a 240-second timeout for that reason.

### The speech engines

**This is development tooling. Nothing in the application or the API depends on it, and
it must never be the reason a demo fails.** With no speech engine, no ffmpeg, or no
network, it says why and leaves the silent video alone.

| Engine | Quality | Notes |
| --- | --- | --- |
| `edge-tts` | good, neural | Free, no key. Sends the caption text to a Microsoft endpoint, so it needs internet. `pip install edge-tts` |
| Windows SAPI | robotic | Local, offline, no install. The fallback |

Each run prints which engine it chose and what that means — an earlier version fell back
to the robotic voice silently, because the availability check ran through a shell that
mangled `python -c "import edge_tts"`. Adding an engine, including a local neural one
such as Piper, is one entry in `ENGINES` in `tools/narrate.mjs`.

Pick a voice with `NARRATE_VOICE`, e.g. `NARRATE_VOICE=en-US-AriaNeural`.

## Known gaps

Tracked as phase 1 in #68: no keyboard model, the filter rail is partly presentational,
no empty or completed states, no feedback when marking a tile whose imagery is
unavailable, and nothing persists across a reload.
