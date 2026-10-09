# MARP Mosaic Review

An interactive prototype of the MARP Picture Mosaic Reviewer, built against the design
record in [MARP_API#68](https://github.com/MarineAppliedResearch/MARP_API/issues/68).

**It talks to MARP_API, and to nothing else.** `src/api/` is the seam. There was a fake
data fixture beside it for the months before this app had an API; #157 deleted it, along
with the flag that could point the application at it. There is still no build step and no
dependencies, and it may still be rewritten — possibly in a different stack, and possibly
as its own repository — once the design settles.

What it is good for: proving the review workflow actually works, feeling the pace of
scanning and committing pages, and giving the requirements something concrete to be
tested against.

## Running it

**The application is served by MARP_API**, because that is where its API is and because
the session cookie only travels same-origin. Start the API and sign in the way you would
for any MARP page; the app is gated on `observations:read` before its files are served, so
an unauthenticated request is redirected rather than handed a page that cannot work.

```bash
npm run dev                    # from the repository root
```

There is no standalone server any more. `tools/serve.mjs` served these files with nothing
behind them, which only worked because the fixture was in front of the API; without one it
would serve an application that cannot load.

Opening `index.html` directly will show an explanatory error rather than a blank page.

## What works

Tap a tile to mark it; the meaning follows the active mode. Pick an optional reason;
choosing **Wrong species** reveals the taxonomy chooser. Change a species and watch the
tile update without moving. Switch modes and see the commit change what it does. Page
through, commit pages, and watch committed pages mark themselves in the pager. Collapse
the filter rail and gain a column. Mark or clear a whole page.

Queued thumbnails resolve in place after a moment, without reordering the mosaic.

Filter on ten dimensions, several values at a time, over a range of confidence, a window
of time of day and a range of dates. The whole question is in the address, so a reload
lands in the same place and the link can be sent to somebody else.

**Deliberately not implemented:** the video drill-down, the data table, live
multi-reviewer updates. `openVideo` fires its action and does nothing else, on purpose.

### The action log

Every gesture fires a **named action**, listed in the *Action log* panel at the bottom
right and logged to the console. These are the seams: each one is a thing that will
later become an API call. Watching the log while clicking is the quickest way to see
the contract the real implementation has to satisfy.

`window.MARP` exposes `{ state, actions }` for poking at from the console.

## Layout

```
index.html              the page

src/model/              the rules. No DOM, no network.
  modes.js                what a mark means, what a commit does per mode
  page.js                 marks, page membership, commit outcomes, paging
  filters.js              the query each mode asks for
  row.js                  the two species names, and why they are not interchangeable
src/api/                the only place that knows a URL, a header or a status
  transport.js            fetch, the session cookie, the error taxonomy, cancellation
  requests.js             the request bodies. Tested by asserting the serialised body
  errors.js               expired / refused / failed, as three separate states
  index.js                the seam MARP_API is behind
src/backend.js          the seam itself. One backing, and it is src/api/
src/store.js            state and named actions; orchestrates model and the seam
src/ui/                 state in, DOM out. Never mutates state.
  dom.js                  helpers and icons
  tile.js                 one tile, and the three things it must show at once
  grid.js                 the mosaic, and the layout maths behind it
  picker.js               the panel a badge opens
  menus.js                dropdowns, anchored to the viewport
  chrome.js               header, sub-bar, rail, pager, action log
  failure.js              expired, refused and failed, as three distinct panels
  mount.js                wiring — the only place that binds events

styles/app.css          appearance; palette from shared/assets/css/tokens.css
tests/unit/             model unit tests, and what reaches the wire — Node, no browser
tests/api/              the browser tier, against a real API on a testing database
tests/walkthrough/      the narrated scenarios, for watching rather than for grading
```

**`src/model/` touches neither the DOM nor the network.** That is what makes the
rules testable in milliseconds, and it is where most of the defects found so far
actually lived — what a mark means per mode, the inverted commit in Delete Mode,
what a committed page holds afterwards.

**`src/api/` is the only place that knows a URL, a header, an HTTP status or a JSON body
shape.** Everything else goes through `MarpBackend.query()`, `commitPage()`,
`setSpecies()`, `retryThumbnails()`, `facets()` and friends. That was the claim the
prototype was built on — swapping the fixture for real endpoints should not require
touching the UI — and it held: the interface changed where the *vocabulary* was wrong and
nowhere else. Every place it was wrong is a finding rather than something an adapter
absorbed, which is why there is no adapter.

## Tests

This application owns its own suite, so it can be extracted from MARP_API without
untangling anything. From this folder:

```bash
npm install                    # once
npx playwright install chromium # once
npm test                       # the unit tier, which is what this package can run alone
```

**`npm test` here is the unit tier and nothing else, deliberately.** The browser tier
needs a running API, a testing database and a reviewer login, and none of the three is
something this package can start — so it is driven from the repository root, which is
where those live. Asking for it here without them is a refusal naming the command, rather
than a skip: a skipped suite looks green.

From the repository root:

| Script | What it runs |
| --- | --- |
| `npm run test:apps` | every frontend application's own suite |
| `npm run test:app:mosaic-review` | this app's own suite — the unit tier |
| `npm run test:app:mosaic-review:unit` | the same thing, named for the tier |
| `npm run test:app:mosaic-review:api` | the browser tier: provisions the testing database if it is not there, serves the app from it, runs, stops |
| `npm run demo:app:mosaic-review` | record the narrated walkthroughs |

All of them are also in VS Code. **Run and Debug** (F5) lists them under *Mosaic
Reviewer*, including *Debug Mosaic Reviewer model tests*, where breakpoints in
`src/model/` work because there is no browser and no server involved. **Run Task**
lists the same set; the fast unit tier is the default test task, so
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> → *Run Test Task* runs it directly.

**`npm run lint` parses every file in the app.** There is no build step, so nothing
else reads the source before a browser does. It runs first as part of `test:unit`,
because a single stray quote once took the whole contract page down and presented as a
sixty-second hang rather than as an error.

**Unit — the model, in Node.** No browser, no server, no database; about a second,
including the parse check. This is the working loop.

```bash
npm run test:unit
```

**The browser tier — a real API, a real session, a testing database.** Playwright, at
desktop and phone width, against a copy of the corpus rather than the corpus. It catches
what the others structurally cannot: that a badge is actually drawn, that a panel is not
positioned off-screen, that the grid settles instead of re-querying itself, that no
console errors occur during a full flow — and, since #157, what the endpoint does that a
fake never would.

```bash
npm run test:app:mosaic-review:api                       # from the repository root
npm run test:app:mosaic-review:api -- -g take-back       # one of them
```

The first run builds the testing database from a corpus dump and says so; every run after
that finds it. `npm run testing-db status` says what is there and `npm run testing-db
reset` throws it away and loads the dump again. `MARP_API`'s own `AGENTS.md` has the
detail, under *The testing database*.

`npm run test:api` and `npm run test:api:headed` from this folder drive Playwright
directly, for when a server is already running and pointed at by `MARP_API_BASE`.

## Recording a walkthrough

```bash
npm run demo                   # the review walkthrough, silent
npm run demo -- delete         # a named scenario
npm run demo:narrated -- review   # spoken
npm run demo:all               # every scenario, spoken
```

Scenarios live in `tests/walkthrough/scenarios.mjs`: **review**, **delete** and
**training**. Adding one means adding an entry there — the runner and the recorder
need no changes.

`tests/walkthrough/` is a Playwright test that drives a scenario and records video
as it goes. It asserts along the way, so a broken application fails
rather than producing a misleading film. Playwright does the driving and the
recording; `tools/record-demo.mjs` converts the result to mp4 if ffmpeg is present.

### Narration

A scene has three parts, deliberately separated: the **caption** shown on screen
(short, readable at a glance), what is **said** (conversational, and spelled for a
speech engine — "Marp", not "MARP", which gets read out as four letters), and what
the app is **driven to do**.

**Lines are spoken and measured before the run**, and each scene is then held for
exactly as long as its own narration. Without that the captions advance on a timer
and the next line talks over the last one.

**This is development tooling, not part of the application or the API**, and nothing
depends on it. It degrades rather than failing — if there is no speech engine, no
ffmpeg, or no network, it says why and leaves the silent video untouched.

Speech engines are tried in order of quality:

| Engine | Quality | Notes |
| --- | --- | --- |
| `edge-tts` | good, neural | Free, no key. Calls a Microsoft endpoint, so the caption text leaves the machine and it needs internet. `pip install edge-tts` |
| Windows SAPI | robotic | Local and offline, no install. The fallback |

Pick a voice with `NARRATE_VOICE`, for example
`NARRATE_VOICE=en-US-AriaNeural npm run demo:narrated`. Adding a paid API, or a
local neural engine such as Piper, means one more entry in `ENGINES`.

A narrated run holds each caption long enough to be spoken over, so it takes about
a minute rather than thirty seconds.

## Known gaps

**Checked against the code, not remembered.** Every line this section used to hold had
become false — the rail was called presentational a refactor after it stopped being so,
and a gap that is no longer a gap is worse than no list, because it sends the next person
to build something that is already there. **#68 is the list of what is unbuilt**; what
follows is only what the code itself cannot tell you.

- **The video drill-down is not implemented.** `openVideo` fires its named action and does
  nothing else, deliberately — the action is the seam, and the player is a separate
  repository.
- **Work in progress is not persisted, and that is a decision rather than a gap.** The
  question — mode, filters, sort, page — lives in the address and survives a reload. Marks,
  outcomes and pinned pages do not: #68 accepts that undecided items from an uncommitted
  page may appear again, and a restored mark looks exactly like a committed one on screen
  while the record agrees with neither.
- **There is no live multi-reviewer view.** Two people reviewing the same filter will not
  see each other's commits until they re-query.
- **The date filter reads a time, not a date.** It compares `tc` as a point in time, so
  today it discriminates time of day and reports the rows whose `tc` carries no readable
  clock rather than looking complete. It starts discriminating dates, with no change to the
  control, once an observation carries one — #76.
- **The browser tier writes, and what it writes to is a copy that holds real decisions.**
  So a check touches as few rows as its assertion needs and puts them back in a `finally`,
  even though `testing-db reset` can rebuild the database from the dump.
- **The identity is the only thing read at start-up.** A reviewer who is signed in but
  lacks `observations:write` or `species:read` meets a refusal panel naming the missing
  permission when they try to commit or correct, rather than a degraded interface that
  hides those controls up front.
