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

**Do not restate what phase the work is in here.** This file went stale within two days
of being written, because it duplicated status that #68 owns and that changes every time
something ships. Status lives in the issue; this file holds what the issue does not — how
the code is put together, and the traps.

What is settled and shapes the code:

- **Phase 2 answered the schema questions** — see *The schema decisions* in #68. A review
  belongs to the reviewer, a species correction edits the observation, Delete is a real
  permanent delete, page membership is query-derived, and the existing permission model is
  used initially.
- **Deterministic ordering** with an `observation_id` tie-breaker on every query is what
  makes a re-query return the same page. It is a requirement of every query this app will
  ever make, not a phase.

**`state.pageMembers` stays.** The in-memory pin is wanted: within a session it is what
lets a reviewer return to a page and see, and undo, what they submitted. The
query-derived decision is about *reload* — on a fresh load the filters apply normally and
finished work is expected to have left the view. Do not remove the pin.

**The app talks to MARP_API.** `src/api/` is the seam; `src/data.js` survives as a
**test** fixture and nothing else. Which backing is in force is `src/backend.js`, and the
application never points it at the fixture — see *The two backings* below.

### How this app is worked on

The user reviews changes by using the app, and reports what they see. That has been far
more effective at finding defects than the suite, so:

- **Run `npm run test:unit` after every change.** It is sixty milliseconds, and it includes
  the parse check.
- **Which tier, and when, is in *Running tests while you work* below.** The short of it:
  unit after every change, browser once at the end, walkthroughs only when asked.
- **Coverage is never traded for speed.** The browser tier runs every test at desktop
  *and* phone width, deliberately, and that stays. If a run is too slow the answer is to
  make it run faster — the fixture is per-browser-context, so the tests parallelise — and
  never to stop running some of them.
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
ui/  ──calls──▶  store.js  ──asks──▶  model/       (pure rules)
                    │
                    └────asks──▶  backend.js  ──▶  api/     (the real thing)
                                       └────────▶  data.js  (the fixture, tests only)
```

Dependencies point one way only. Nothing lower ever imports something higher.

| Layer | May touch | Must never touch |
| --- | --- | --- |
| `model/` | its own arguments | the DOM, the network, `state` |
| `api/` | `fetch`, a URL, a header, a status | the DOM, `state` |
| `data.js` | the fixture | the DOM, `state` |
| `store.js` | `model/`, `backend.js`, `state` | the DOM, a URL, a status |
| `ui/` | `state`, `actions`, the DOM | `state` **as a writable thing** |

**`model/` touches neither the DOM nor the network.** That is what makes the rules
testable in milliseconds, and it is where most of the defects found so far actually
lived — what a mark means per mode, the inverted commit in Delete Mode, what a
committed page holds afterwards. When a bug is about *meaning*, its fix belongs here
and its test belongs in `tests/unit/`.

**`ui/` reads state and writes DOM. It never writes state.** A UI file that assigns to
`state.anything` has broken the one rule that keeps rendering predictable. Call an
action instead.

**`src/api/` is the only place that knows a URL, a header, an HTTP status or a JSON body
shape.** `grep -nE "/api/|fetch\(" src/` outside `src/api/` finds nothing, and that is a
requirement rather than tidiness — it is what let the fixture be swapped for the endpoint
without rewriting the interface.

### The two backings

`src/backend.js` holds one of them, and the **selection is per entry point, never a
runtime flag the application can be subject to**:

- **`index.html` imports the store and nothing else**, so the app is on `src/api/` however
  it is launched. It has no reference to the fixture to reach for.
- **`tests.html`** — the contract tier — installs the fixture explicitly. Those checks are
  about the *rules* and they drive `failNextCommit`, `slowNextCommit`, `breakThumbnails`,
  `bumpVersion` and `reload`; none of that is expressible against a real server.
- **the unit tier** imports `src/data.js` directly, as it always has.

There is **one exception and it is deliberately loud**: `?backing=fixture` puts the app on
the fixture, paints a permanent `FIXTURE — not the API` banner, and stamps
`documentElement.dataset.backing`. The render tier passes it and asserts the banner, so a
run cannot grade the fixture while claiming to be the API.

**The fixture is scaffolding, it is on its way out, and a new browser test does not go on
it.** Settled by the human on 2026-09-12: *"The fixture was only put in place so we could do
iterative development until we got it over to the API. That fixture is not even supposed to
be there anymore. Our tests are supposed to be written to an actual dump to database."*

This paragraph said the opposite for months — *"neither the flag nor the fixture is coming
out"*, on the grounds that the fixture tier is the fast loop and can break a commit on
purpose. That is the most misleading thing this file has ever said, because it is the
sentence that tells the next person a fixture-backed browser tier is the right home for a
new test. It is not.

**The reason is not tidiness, it is that the fixture masks a whole class of defect by
construction.** `src/data.js` is not a small API, it is a *different* one: it writes the
row's own status column in place when a page is committed, and the endpoint never does that
— a decision is a projection row, the row is served from a cache, and a commit deliberately
invalidates nothing. Anything living in the gap between what a commit recorded and what the
row still says is therefore invisible on the fixture at **every** tier that uses it. #130,
#124's F6 and #124's F8 were all that shape, and so was #135 R7: three fixture-backed step
tests passed while the page sweep put back a promotion the reviewer had just withdrawn,
because on the fixture the row had already been rewritten and the sweep's mistake did not
show. One test against a real server on a dumped corpus caught it in a single run.

**Where a browser test goes now:** `tests/api/`, against a real API serving a **copy** of
the corpus — `marp db dump`, `marp db up -Port <yours>`, `marp db load` into that second
database, and the API pointed at it. *The API tier* below is the how.

**What is still true about the fixture.** It is fast, it runs at two viewports, and it can
break a commit on purpose — `failNextCommit`, `slowNextCommit`, `breakThumbnails`,
`bumpVersion`, `reload` — which no real server will do for you. The existing fixture-backed
suites are staying where they are for now, deliberately: migrating them is its own piece of
work and not a thing to do by surprise in the middle of a bug fix. So read them as *the way
it used to be done*, not as the pattern to copy.

The cost of two backings is that they can drift, and the answer is that **they present the
same method set**: `backend.js` writes the list out rather than proxying, so a method one
of them lacks fails by name.

### Two names for a species, and they are not interchangeable

`model/row.js` is the whole rule and it is worth reading before touching a caption:

- **`comname`** is the label the species list entry carried **when the annotator chose
  it**. A correction never rewrites it. Keeping it frozen is what makes the drift from
  `species_id` auditable rather than silently tidied away.
- **`species_comname`** is the **current** catalogue name of whatever `species_id` now
  points at.

So drawing `comname` shows the old animal for ever on any corrected observation, while the
species *filter* — which is `species_id` — matches the new one. The tile draws
`currentSpeciesName(row)`. The "was X" chip draws `state.changed`, and **only a correction
made in this session**: making legacy drift visible is a behaviour change rather than a
port, and that was decided against.

### The row's neutral state is null

`review_decision` and `training_decision` carry `null` for "nobody has decided" — the
absence of a projection row. The **filter** vocabulary still spells that `'unreviewed'` and
`'undecided'`, because that is what the endpoint's filters take and what the rail's counts
are keyed by. `STATUS_DIMENSIONS` declares both and `dimensionState` is the one place they
are reconciled. Comparing a filter value against a row column directly is the mistake, and
it passed for months because the fixture invented a string for the neutral state.

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

## Four things a tile shows at once, and they are different

This is the single most confused area of the code, and the source of several reported
bugs. `ui/tile.js` derives all four; none of them is stored on the row.

| | What it is | Lives in |
| --- | --- | --- |
| **marked** | what this reviewer has marked but not committed, and **which of the two things they marked** | `state.marks`, transient |
| **existing** | what the record already carried before this reviewer arrived | the row's own status columns |
| **outcome** | what the last commit just did | `state.outcomes`, per commit, per mode |
| **borrowed** | what another workflow's dimension says about the same observation | the row's other status column, drawn as `.rtag` |

Their precedence in `tile.js` is fixed and load-bearing: **a mark outranks an outcome,
which outranks the record.** Once the reviewer touches a committed tile they are
editing it, and the screen has to show the new intention rather than the old answer —
otherwise the click appears to do nothing. A fourth derived state, *taking back*, covers
the gap: the record still carries a decision, the reviewer has removed the mark, and
nothing is written until the next commit.

**It covers either of the mode's two values, not only its exception** (#135). It asked about
the exception alone, so taking a *promotion* back derived nothing at all: the tile went on
drawing PROMOTED from its own outcome and the click looked as though it had done nothing.

**And it is recorded rather than derived**, which is the part that will look like extra
state until you remove it. `state.takenBack` holds the ids, `takesBack()` is the rule that
puts one there, and a new mark or a commit takes it out. Derived, it cannot be right: a tile
that is unmarked, touched and carrying an acceptance is either a promotion whose accept mark
has just come off — a take-back — or a tile the sweep accepted after a *flag* came off, which
is not one, and no combination of marks, touches and outcomes tells those apart. The first
version of #135 derived it, and the second sweep in *a committed page is still editable* left
the tile reading TAKING BACK for the rest of the sitting. **The kind of mark that came off is
what separates them, and only the store sees it.**

`pendingTakeBack` is what the tile and the commit button both ask, because what the tile says
is being taken back and what the button withdraws must not be two answers.

**A mark carries a kind, and there are two of them** (#126). `except` is what a mark has
always meant — flagged, excluded, deleted — and it is what a left click records and what
`seedMarks` seeds. `accept` is the other one: a right click on a pointer, a **double tap**
on a touch screen, recording the mode's accepted value for that one tile and saying nothing
about any other. `markKind()` defaults an absent kind to `except`, so every rule written
before this went on meaning what it meant.

The kind fits **inside** the tile's precedence rather than beside it: a mark still outranks
an outcome, which still outranks the record, and the kind only decides what the mark itself
draws. `.badge` stays exactly one element per tile, and an accept badge carries no
`data-badge` — the panel chooses a flag or exclusion reason and an acceptance has nothing in
that vocabulary to say. An accept mark is **refused at click time on a tile with no
picture**, in its own `.refusal` slot that can never reach the badge: accepting is the
reviewer saying "I looked at this", which they cannot have done without seeing it.

**There are two commit buttons, and they act on different things** (#126). The main one
commits **only what the reviewer marked by hand in this sitting**, each tile by its own
kind — `state.touched` is the "by hand" half and it is not a nicety, because the page still
arrives with the record's flags already marked and `observation_reviews` records a reviewer
per row. It sends only the marked rows as `observations`, which is how "commit just these"
is expressible in the existing contract with no new field — **and the reviewer's take-backs
beside them, in `withdraw`** (#135). A withdrawal deletes the projection row, and the
absence of a row is what *undecided* means, so the decision comes off the record while
`observation_reviews` -- the decision log -- keeps its rows.

**Either button applies a take-back, and this paragraph used to say the opposite** (#135
R7). It said *"the two buttons now mean different things by the same gesture,
deliberately"* — *Commit Marked* withdrew the decision, the sweep accepted it. That was
wrong, it shipped, and it is the defect #135 was reopened for: taking a promotion back and
pressing the sweep promoted it straight again, so the reviewer's withdrawal was undone by
the button next to the one that honoured it. The rule is **a take-back is an instruction
about a tile, not a property of which button reads it**: *"if you hit commit it again, it
should be in the vanilla state for that mode"* — unreviewed in Scientific, undecided in
Training, whichever commit that is.

**What is not changed is the sweep's own rule.** Everything merely *unmarked* is still
accepted, exactly as it always was. Only an explicit take-back is withdrawn, and
`state.takenBack` is the only thing that can tell the two apart — which is the same reason
it is recorded rather than derived. `runCommit` therefore builds its withdrawal list for
both buttons, and `commitOutcome` counts those separately from the accepts so the sweep's
tooltip does not report a withdrawal as an acceptance.

#126's R7 said *Commit Marked* ignored a take-back altogether, which left the only way to
undo a promotion being the gesture that also decides every other tile on the page. Both
halves of that are now gone.

**It pins nothing and marks no page committed**: `page.pinnedIds` becomes the query's `exclude` set, so pinning there would
take every untouched tile on the page out of the reviewer's remaining work without saying
so. The smaller button to its right is the page sweep.

**A decision from an *earlier* sitting can be taken back too**, and it always could — the
supervising diagnosis for #135 said it could not, on the theory that the endpoint never
writes the row's status column, and that is worth writing down so nobody fixes it twice.
`ROW_COLUMNS` in `repository/mosaic.repository.js` selects `rc.decision AS review_decision`
and `rt.decision AS training_decision` straight out of `observation_review_current`, so a
decision made at any time arrives *on the row* and `existingState` finds it. What the
endpoint does not do is write that column back **after a commit in this sitting** — which
is #131, and is why `state.outcomes` is preferred over the column rather than the other way
round.

**A click on a tile carrying a committed decision takes that decision back** (#135 R8,
answered 2026-09-12). Whichever of the mode's two values it is: `REVIEWED` and `PROMOTED`
behave exactly as `FLAGGED` and `EXCLUDED` already do. *"Something already promoted in
training mode, I click it and it just goes straight to excluded, and it should go to taking
back. Now let's see if it was excluded and I click it -- it does do taking back."*

**Why only half of it was broken**, which is the thing to know before somebody "tidies" the
asymmetry away: a page arrives with its *exceptions* already marked (`page.seedMarks`), so
a click on a flagged or excluded tile was already removing a mark, and `takesBack` turned
that into a take-back. **Nothing seeds an accept mark**, so on a reviewed or promoted tile
there was nothing to remove and the click fell through to marking -- and the record went
from reviewed straight to flagged, with no take-back step and no way to reach the vanilla
state by clicking at all. One rule, two routes into it, because the marks arrive
asymmetrically. `clickTakesBack` in `model/modes.js` is the accepted-value route;
`takesBack` is the seeded-mark one.

**It is a toggle against the record, not a cycle through states.** Click again and the tile
goes back to what it was; only a commit clears the decision:

```
REVIEWED  --click-->  TAKING BACK  --click-->   REVIEWED     back where it was
REVIEWED  --click-->  TAKING BACK  --commit-->  (vanilla)    the decision is cleared
(vanilla) --click-->  FLAGGED                                now an ordinary mark
```

**So there is no one-click route from a committed acceptance to a flag, and that is
intended.** Taking back is a decision the reviewer commits, and only then can they flag.
Do not add a shortcut. An earlier guess had the second click apply the exception and was
overturned before it was built -- it is A8 in `.marp/task.md`, recorded so it is not
re-proposed.

**This is the left click. The right click is unchanged**, and still toggles an accept mark,
so a reviewed tile can still be re-accepted by the gesture that accepts. An earlier draft
of this section described the defect as an acceptance needing two *right* clicks; that was
the wrong gesture and the paragraph is replaced rather than left to confuse.

**The sweep still treats the marks as the page's exception set — not a scratchpad.** At a
sweep commit, whatever is marked as the *exception* becomes the exception and everything
else becomes accepted, an accept mark included. Three rules follow, and all three were bugs
before they were rules:

- A page arrives with its existing exceptions **already marked** (`page.seedMarks`).
  Without that, committing a page holding flags that nobody touched silently cleared
  them, because the commit accepts everything unmarked.
- A commit does **not** clear the marks. `page.marksAfterCommit` keeps the exceptions
  marked, so the page stays editable and a click still means what it meant a moment
  ago. Delete Mode keeps nothing marked — a deleted row is not a pending intention.
- `state.touched` holds what the reviewer decided by hand. Those ids are never
  re-seeded, so taking a flag off and paging away does not put it back. **Clear resets the
  page instead of emptying it** — it drops the reviewer's marks *and* their take-backs on
  this page and lets the record's exceptions seed again, so the page looks as it did on
  arrival. Clearing used to empty the marks and add every row to `touched`, which silently
  staged the reversal of every exception the record carried: they read as TAKING BACK and
  the next commit would have accepted them. TAKING BACK now appears only where somebody
  clicked an individual tile, which is what it means.

**Each mode keeps its own session work, and `setMode` parks it rather than clearing it.**
`state.outcomes`, `state.committedPages` and `state.pageMembers` all belong to the mode
that made them — left shared, a scientific commit painted REVIEWED badges across Training
and Delete, two independent decisions wearing each other's answer. They used to be cleared
on every mode switch for that reason, which also discarded the reviewer's session: review
three pages, glance at Training, come back, and there was no way to see what had been
submitted, because the pins are the only thing that keeps a committed page visible past a
filter that no longer matches it. `state.parked` holds them per mode instead, so the
isolation and the session both survive. Reported 2026-09-08.

**Uncommitted marks do not travel.** `marks` and `touched` are still cleared by `setMode`.
An uncommitted mark is a pending intention in one workflow and the reviewer walked away
from it; a committed page is on the record, and parking only affects how it is displayed.

**A different question drops every mode's parked work**, not just the active one's — a new
filter or a new sort means page 2 is not the same page 2, so restoring those pins would
resurrect pages the query no longer returns. `resetForNewQuery()` and `reorder()` are where
that happens, and `clearFilters` was writing those six lines out by hand until it missed
this and was routed through the helper.

A mark is not a decision. **Committing is what writes it to the record** — that is why a
flag survives leaving the page, the session, and the reviewer, and why "my flags
disappeared when I came back" was a real defect rather than a misunderstanding.

**Every mode shows every workflow's tags, and this reversed on 2026-09-08** (#85). Whenever
somebody looks at an observation they see what every workflow has said about it — flagged,
reviewed, promoted, excluded — whichever mode they are in. This file used to say the
opposite: that a mode showed only the dimension it reads. The decisions *are* independent,
and that part stands; hiding one of them was the wrong way to express it. Delete Mode
already read both, and its reasoning generalises — *deleting is irreversible, so the useful
question is not what one workflow thinks but whether anything on the record says stop* — and
the same is true of a reviewer deciding anything at all. An observation already excluded
from training looked untouched to the person deciding whether to destroy it.

Two derivations, and the distinction is the whole fix:

- **`existingState(mode, row)` is mode-scoped and must stay that way.** It answers "what
  does the dimension this mode acts on say", and three things ask it: the tile's primary
  badge with its mark/outcome/record precedence, `store.refresh` seeding the page's
  exception set through `page.seedMarks`, and `deleteImpact`. Widening it would make a
  training exclusion seed a *scientific* mark, and would let another workflow's value
  satisfy the `takingBack` derivation. It is not a display function.
- **`borrowedTags(mode, row)` is the visibility one.** It returns what the record carries in
  every dimension *except* the mode's own — which already has the badge — as
  `{ key, value, workflow, reason, by }`. `ui/tile.js` draws these as `.rtag` in their own
  slot at the tile's bottom left. **`.badge` stays exactly one element per tile**: it is
  what *this* mode says, and a record tag that could reach that slot could outrank a mark,
  which is how clicking a committed tile comes to look like it did nothing.

A borrowed tag carries **no workflow label on the tile face**. FLAGGED and REVIEWED can only
be scientific, PROMOTED and EXCLUDED can only be training, and colour reinforces it; the
tooltip names the workflow, the reason and the person. If that proves unclear in use, the
prefix form (`TRN · EXCLUDED`) is one template string in `tile.js`.

It adds a badge and **nothing else**. Outline, dimming and grayscale keep meaning the active
mode's own state — a picture a scientist is judging must not be greyed out because training
excluded it.

**Every mode filters on both dimensions too, and this reversed on 2026-09-08** (#89). #85
deliberately left the filters alone, and this is that decision reversed rather than two
notes contradicting each other. The reason #85 gave was sound and is now spent: it named
the risk that "handing Scientific that filter with a careless default would hide the very
promoted and excluded rows #85 exists to surface", and #89 addresses that risk head on
instead of avoiding it by leaving the filter out. Delete's rail is the one the other two
now have.

**A mode's *own* dimension and the dimensions it *filters on* are different things**, and
conflating them again is how a training exclusion comes to seed a scientific mark:

- **`MODES[mode].statusKey` is what the mode acts on.** One dimension per mode. It drives
  `existingState`, the tile's primary badge and its precedence, the seeding of the page's
  exception set, and what a commit writes. Untouched by #89.
- **`statusDimensions(mode)` is what the mode may filter on**, which is now every
  dimension. It drives the rail, the query, the defaults, the collapsed-rail badge and the
  address. Each entry carries `own`.

**A borrowed dimension arrives not filtering at all, and that is the whole difficulty.**
`trainingDisposition` defaults to `['undecided']`, so a borrowed dimension taking its
owner's default would drop every promoted and excluded row out of Scientific's opening page
— 151 of 1083 in the fixture, silently, with nothing on screen saying so. So
`statusDimensions` gives a borrowed dimension `defaults: []`, `defaultStatusFor` therefore
sets only the mode's own dimensions, and `DEFAULT_FILTERS` derives its status entries from
`statusDimensions('scientific')` rather than naming `MODES.training.defaultStatus` — that
second one is the route the trap arrives by even when the first is right, because
`defaultQuery()` copies `DEFAULT_FILTERS` straight out with no `defaultStatusFor` pass.
`render.spec.mjs` measures the default total against the fixture for exactly this reason;
a test that compares the app to itself cannot see the count move.

**In the address, absence of a borrowed dimension means "not filtering"** — never "use the
owning mode's default". That is the same distinction that stops a cleared species filter
coming back on reload, and `queryFilters` no longer drops a status dimension for belonging
to another workflow.

**Delete Mode is still the exception in what it *owns*.** It is the only mode with two own
dimensions, so it is the only one where the second arrives with all three values ticked
rather than empty; deleting is irreversible, so anything already on the record is a reason
to stop. Those filters are context, never a selection: `pendingException('delete')` is
null, so nothing in Delete ever arrives marked, and the commit acts only on what the
reviewer picked in this sitting.

The status counts are unchanged and are **not** conditioned on either status dimension:
`store.countFilters()` sends `{ species, project, dive }`, `data.js:counts()` returns all
six values, and `ui/chrome.js` reads `state.counts[value]` by value alone. So a borrowed
count can exceed the result total, exactly as it already could in Delete — and the two
vocabularies have to stay disjoint, or one dimension's count would appear beside the
other's box.

Adding a dimension to a mode means editing `MODES` and nothing else; adding a *new*
dimension means one entry in `STATUS_DIMENSIONS`, which now also holds the rail label and
the value list. The rail, the query, the defaults, the collapsed-rail badge and the address
all go through `statusDimensions()`.

## Invariants that will bite

Each of these is a bug that actually happened. They look like over-engineering until
you remove one.

**The grid must not re-measure while loading.** `computeLayout` returns early when
`state.loading`. Without it: `overflow-y: auto` adds a scrollbar → the field narrows →
tiles shrink → an extra row fits → overflow → repeat. The grid never settles, "page 1"
holds different observations on each visit, and marks appear to vanish. `scrollbar-gutter:
stable` plus a flap guard closes the rest of that loop.

**The commit carries the mode it started in.** `commitPage` reads `state.mode` and
`state.page` once, and everything after the `await` is checked against those. Writing the
outcomes back unconditionally meant a commit landing after a mode switch put them straight
back after `setMode` had cleared them — a whole page of scientific badges displayed in
Training. The commit already happened and the record is written; what is dropped is this
mode's display of it, and the next query reads the record back.

**Every query carries a sequencing token.** `const token = ++reqSeq; … if (token !== reqSeq) return;`
Overlapping queries land out of order otherwise, and the screen shows an older result
than the one that was asked for last.

**A committed page keeps its membership, and it costs no request.** `state.pageMembers`
holds the exact ids that were on screen and `refresh()` serves them from the cache —
`cache.rowsFor(ids)`, and `evict` never gives up a row a pinned page needs. Returning to a
page must show what was submitted, not whatever the filter now matches.

There is **no by-ids endpoint and there does not need to be**: the design asked for one and
the capability already existed. If the cache ever cannot serve a pinned page the pin is
dropped, a named action fires, and the ordinary query runs — better than an empty grid, and
visible rather than silent.

**A retry cannot conjure a picture.** The retry endpoint answers `queued` and never a
synchronous `ready`; what turns a queued tile into a picture is the poll, which re-reads
the visible page on a backoff and notifies **once per round**. A permanent failure is
refused rather than re-queued, and the client learns `permanent` from the retry *answer* —
never from a row, which has never carried it.

**A conflict is not a refusal for being second.** The last commit wins, always. `conflicted`
fires only where a row moved *underneath the page the reviewer was looking at*; nothing was
written, the marks are kept, and the page offers to re-read.

**A commit does not move `observations.version`, so nothing local may bump it** (#135). A
decision is written to `observation_reviews` and `observation_review_current`; the token
moves only on the observation row's own `BEFORE UPDATE` trigger, which a review commit never
fires. The store used to add one itself — true of `src/data.js`, false of the endpoint — so
the *second* commit of a tile in one sitting sent a version one ahead of the live row and
came back `conflicted` for a conflict that had not happened. A species correction does edit
the row, and does still bump it.

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

**Accepting needs imagery; flagging does not.** `data.js` used to drop every row whose
thumbnail had not arrived *before* it looked at the marks, so a flag on a broken tile was
silently thrown away. "Reviewed" means somebody looked at it, and that needs a picture.
"Flagged" means somebody is saying something is wrong, and a thumbnail that never arrived
is itself worth flagging — so a marked row is written either way, and `No imagery` is one
of the scientific reasons so the record says why.

**The commit button must never offer to act on rows it will skip.** `commitOutcome` splits
a page into what will be accepted, flagged and skipped; the button shows that number, is
disabled when a commit would do nothing, and says how many will be skipped when they
differ. `commitCount` alone was enough only while every row was assumed to have imagery.
Since #126 there are two buttons and `selectionOutcome` is the main one's half of that,
answering in the same shape so `renderCommits` draws both through one path.

**Two buttons do not fit a phone footer at full length, and `.app` clips rather than
scrolls.** So each button carries two wordings — `.lw` and `.sw`, long and short — and the
media query picks one; both carry the count, because that is what "the button says what it
will do" means. Reading the viewport in JavaScript instead would make the label depend on
when a render happened to run.

**A page has a state, and `pageState` names it.** Empty, filtered-out, no-imagery,
partial-imagery, ready. Named in `model/` rather than inferred where it is drawn, so the
chrome and the grid cannot disagree about which state they are in, and so the rule is
testable without a browser.

**Delete is the only modal, and Cancel holds the focus.** `ui/confirm.js` interrupts
because deletion is permanent and rare; everything else here is one gesture with no
dialog, because a reviewer repeats it thousands of times. Focus lands on Cancel, since
Enter and Space are the keys somebody presses without reading. The dialog reads its count
from the same rule the commit uses, so the number on screen cannot disagree with the
number deleted.

**The pointer selects; the keyboard commands.** There is deliberately no keyboard cursor
through the grid. Marking with a pointer is one action with no traversal, while
arrow-and-space is two keystrokes plus the walk between tiles — so keyboard selection
would make the tool slower for the people who use it most. #68 originally said the
opposite and was corrected on 2026-09-05. `model/keys.js` maps a key to an action or to
nothing, and `mount.js` has the one listener that consults it. Accessibility parity is
still required; it is the floor, not the speed path. **Commit is a chord** — it is the one
irreversible action that is not otherwise gated.

## Where things go

| Adding | Touch |
| --- | --- |
| a mode | `model/modes.js` (rules), `styles/app.css` (`body[data-mode]` hue), `index.html` (the selector) |
| a filter | one entry in `model/dimensions.js`. Nothing else — the rail, the query, the counts, the collapsed-rail badge and the address all read the declaration. If it ever needs a second place, the refactor has regressed |
| a gesture | `ui/mount.js` listener → new action in `store.js` → rule in `model/` |
| a kind of mark | `MARK_*` in `model/modes.js`, then the badge branch in `ui/tile.js` and the button's rule beside `selectionOutcome` |
| a walkthrough | one entry in `tests/walkthrough/scenarios.mjs`; the runner and recorder need no changes |
| a keyboard shortcut | one entry in `SHORTCUTS` in `model/keys.js`, then a case in `runShortcut` in `ui/mount.js`. The hint draws itself on any control the id matches |
| a page state | `pageState` in `model/modes.js`, then `ui/grid.js` |
| a record tag another workflow owns | `STATUS_DIMENSIONS` in `model/modes.js` — which also carries its rail label and its values — then the `TAG_CLASS` / `TAG_ICON` pair in `ui/tile.js` |

Mode colour is **chrome only**. Never tint the imagery — the reviewer is judging how the
organism looks, and #68 treats the image field as a quiet zone. Dimming a tile the
reviewer has already judged is the one accepted exception: flagged, excluded and doomed
tiles all step back, flagged the least because it stays in view to be resolved.

**`--commit` is what this mode's commit does, and it follows the mode.** Green for
scientific review, violet for training — the same violet training already uses as its mode
hue — and red for Delete. Scientific and training were both green, which made two
independent decisions read as the same answer. Everything that reports what a commit does
or did takes this variable: the commit button and its success state, the pager's committed
pages, the legend swatch that explains that hue, the progress bar counting them. The
PROMOTED badge is violet outright rather than through the variable, because it means
promotion wherever it appears.

**It was called `--accept` and it had no Delete value**, so a page committed in Delete Mode
inherited the root green and the one place recording what you did to a page said you had
accepted what you had in fact destroyed (#93). The family is named for the commit rather
than for acceptance because Delete has no accepted state — the alternative, a red
`--accept`, would have been a lie sitting in the stylesheet. `.ghost.go` in the flag panel
still reads it and is the one consumer that is not about a commit; it never appears in
Delete Mode, because `renderPicker` returns early there.

**A hue that means something in one mode must be given a value in all three.** The bug was
not a wrong colour but a missing one: `body[data-mode="delete"]` set the chrome variables
and stopped, so everything else silently fell through to `:root`.

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

Five tiers plus the walkthrough videos. They fail in genuinely different ways, and
choosing the wrong one is how bugs ship.

| Tier | Command | Catches | Cannot catch |
| --- | --- | --- | --- |
| Parse | `npm run lint` | a file that will not parse | anything else |
| Unit | `npm run test:unit` | the rules in `model/`, and **what reaches the wire** | anything rendered |
| Contract | part of `test:e2e` | store behaviour against the requirements in #68, by name | whether it was drawn |
| Render | `npm run test:e2e` | badges actually drawn, panels on-screen, colours, no console errors | meaning |
| API | `--project=api`, see below | what a **real server** does and the fixture does not | anything needing a broken backing |

**`tests/unit/api-requests.test.mjs` is the tier that can see a serialisation defect**, and
every assertion in it goes through `JSON.parse(JSON.stringify(body))`. That is not
pedantry: `JSON.stringify(new Set([1,2,3]))` is `{}` and `JSON.stringify(new Map(...))` is
`{}` too, so `deepEqual` on the request *object* passes while the wire carries nothing.
An exclusion set left this client as an empty object for months — the endpoint excluded
nothing, every committed page came back among the pages still to do, and the arithmetic on
screen stayed plausible throughout. **Assert the serialised body, never the argument.**

`npm test` runs all of them. `npm run test:unit` runs the parse check first.

### Running tests while you work

Two commands, and the difference between them is the difference between a working loop
and a person watching a progress bar.

```bash
npm run test:unit     # 60 ms.  After every single change. This is the loop.
npm run test:e2e      # minutes. Once, when the work is finished.
```

**`npm run test:unit` after every change, without asking.** Parse check plus every rule
in `model/`. It is fast enough that there is never a reason to skip it, and it is the tier
that would have caught most of what has been reported by hand.

**`npm run test:e2e` is not part of the loop.** It drives real Chromium across two
viewports and takes minutes. Run it when the work is done, before saying it is done —
not between edits, and not to check a change you just made. A rule you are iterating on
belongs in a unit test where you can run it fifty times.

**Never run a bare `playwright test` during development** and never leave a dev server
behind: a stale one holding the port makes the next run fail outright, by design.

**The walkthroughs are neither.** `npm run demo:narrated -- <scenario>` records a video to
show the user that a finished feature works. Only when asked. See *The narrated
walkthroughs* below.

Where a new test goes follows the same split. **"Add a test for that" means
`tests/unit/`** — a rule proved in `model/` costs nothing to run and so actually gets run.
The browser tier is where a completed feature earns its place; it is not where the working
loop lives.

**Every rendering defect so far passed the store-level checks.** A badge never drawn, a
panel positioned off-screen, a grid re-querying itself, a tick rendered at four times its
size — the store was correct every time. **If a fix is about what appears, the test
belongs in Playwright.** Reporting a fix verified at a tier that structurally cannot
observe it is how several defects got reported twice.

### The API tier

`--project=api` runs `tests/api/` in a real browser against a **real MARP API**, with a real
session, and no fixture anywhere in it. It is opt-in on `MARP_API_BASE`, and asking for the
project without it is a loud refusal rather than *Project "api" not found*.

```bash
npm start                                   # from the repository root, on a port of your own
set -a; . .marp/local/<your>.env; set +a    # the reviewer login, git-ignored
MARP_API_BASE=http://localhost:<port> npx playwright test --project=api
```

`tools/api-session.mjs` is a `globalSetup` that signs in and writes a Playwright storage
state, because `/apps/marp-mosaic-review` is session-gated in `app.js` and the app is not
even served without one. The login is created by `scripts/create-review-user.js` and needs
`observations:read`, `observations:write` and `species:read`; `MARP_REVIEW_USERNAME` and
`MARP_REVIEW_PASSWORD` are how it is passed, and it is a credential, so it lives in
`.marp/local/` and never in a tracked file.

**Why a fifth tier rather than more render tests.** `src/data.js` is not a small API, it is a
*different* one — it writes the row's own status column in place when a page is committed,
and the endpoint never does that: a decision is a projection row, the row is served from a
cache, and a commit deliberately invalidates nothing. So anything living in the gap between
what a commit recorded and what the row still says is invisible on the fixture at every tier.
#130, #124's F6 and #124's F8 were all that shape, and so is the take-back defect this tier
was built for. The first answer to it was a fixture affordance that *simulated* the endpoint
not writing back, and that was rejected on 2026-09-11: *"if the fixture doesn't trigger the
error and the actual system does, that doesn't make any sense."* A better fake is not the fix
for damage done by a fake.

**It stopped being the fifth tier on 2026-09-12 and became the default one.** See *The two
backings*: the fixture was scaffolding for the months before this app had an API, and a new
browser test belongs here. #135 R7 is the worked example — three fixture-backed step tests
passed while the page sweep put back a promotion the reviewer had just withdrawn.

**Point it at a copy of the corpus, not at the corpus.** This is the first rule now, and it
is what makes the tier ordinary rather than frightening. `marp db dump` reads the
development database and writes both halves — the rows and the thumbnails — into
`.marp/local/`; `marp db up -Port <yours> -DataDirName <yours>` brings up a second
PostgreSQL beside it; `marp db load <dump> <thumbnails> --apply` fills it. Serve the API
from that database and the tests write to a copy nobody is relying on.

One trap in that, found on 2026-09-12 and worth ten minutes: **`load` refuses when the
repository's `storage/observation-thumbnails` is not empty**, and that directory is shared
with whatever else is running out of the checkout — so loading into an empty second
database is refused because of files belonging to the first. The answer is not `--force`.
Run the load from a throwaway `git worktree` (junction `node_modules` into it) so it has a
`storage/` of its own; the shared one is then never touched at all.

**Three rules that still hold even against a copy**, because a test that only works on a
disposable database is a test nobody can run anywhere else:

- **Touch as few rows as the assertion needs, and know which.** `tests/api/corpus.mjs`
  discovers a `{species, line}` pair with exactly one observation, so the page it sweeps
  holds one row rather than fifty — and it *checks* that, failing with an explanation rather
  than committing rows it never inspected. It pins no species, no line and no observation:
  it was `const LONE_SPECIES = 622` once, and seven CAMPA2026 dives landed the same night.
- **Restore what you changed, in a `finally`, through the API.** A failed assertion must
  still put the record back. `withdraw` on the commit route deletes the projection row, and
  the absence of a row is what `undecided` means, so an observation nobody had decided about
  goes back to exactly that.
- **Every test asserts `data-backing`.** No `?backing=fixture` is injected here — that is a
  `beforeEach` in `tests/e2e/render.spec.mjs`, and this project's `testDir` does not include
  it — but asserting the backing is what makes a run unable to grade a fixture and report it
  as the API.

It is **not** part of the loop and not in `npm test`: it needs a server, a database and a
login, and a missing one of those must fail rather than skip. Desktop viewport only — what it
proves is about what gets written and read back, not about layout.

### Where a new test goes

- A rule — what a mark means, what a commit does, how filters nest → `tests/unit/`,
  as a plain `node:test` case. No browser, no DOM, no fixture loading. This is still the
  first place to look, and it is unaffected by everything below.
- **Anything that needs a browser → `tests/api/`**, against a real server on a dumped
  corpus. Read *The API tier* below first. This used to say `tests/e2e/render.spec.mjs` for
  "anything visible" and `tests/api/` only for what the fixture could be wrong about, and
  that ranking is reversed: see *The two backings* — you cannot tell in advance which
  defects the fixture is going to mask, and #135 R7 is the one that proves it.
- The two fixture-backed browser tiers — `tests/requirements.js` and
  `tests/e2e/render.spec.mjs` — are **not** where new work goes. They are still run and
  still maintained, and a test already in them that your change breaks is yours to fix;
  they are simply not the destination any more.

**The locator trap.** A Playwright locator is re-resolved on every use, so a selector
that describes a *state* stops matching the moment the state changes:
`.tile:not(.marked)` clicked once no longer matches that tile, and `.first()` silently
slides onto a different one. Read `data-id` first and pin the tile:
``page.locator(`.tile[data-id="${id}"]`)``. Three tests were wrong this way before they
were right.

**The commit race.** `commitPage` is async and re-seeds the marks when it lands. A click
sent before it finishes is overwritten. Wait for the outcome badge, not a timeout. When you
need to drive what happens *during* a commit, `MarpData.slowNextCommit(ms)` holds one open —
racing a 260 ms latency reports the wrong thing about one run in ten.

**On a phone the rail overlays the mosaic.** It is collapsed by default there, so a test
touching a filter must open it — and then collapse it again before clicking tiles, or every
tile is present and covered. Playwright reports that as resolved-and-never-visible, which
reads like a missing tile and is not one. Three tests learned this separately.

**The page you are standing on is an `<input>`, not a chip.** `renderPager` draws a typable
box for the current page, so it carries neither `data-page` nor the committed marker. A
committed page only shows as committed once you have paged away from it, which is also when
a reviewer sees it. Two tests tripped on this.

**`page.fill()` raises `input` but not `change`.** Anything the rail commits on `change` —
which is everything two-ended, deliberately, so a slider does not re-query per pixel — is
never applied by a bare `fill`. That is a real user path too, not only a test artefact:
typing a time and clicking into the mosaic removes the element before it can blur, which is
why the rail also listens on `focusout` and Enter.

**Read a computed colour by polling for a value that parses.** Rendering is a full
re-render, so a handle taken the instant an element appears can be detached before
`getComputedStyle` runs — and that returns an empty string, so `.match(/\d+/g)` is null and
the test dies with "Cannot read properties of null" without saying anything about colour.
`commitAndReadBadge` is the pattern.

**Reintroduce a defect with a file copy, never `git checkout --`.** Proving a test fails
against the old behaviour is the right instinct, and `git checkout -- <file>` on a file
holding uncommitted work discards all of it. `cp` it first and restore from the copy.

**The cost of an action is the number of times it notifies.** Rendering is a full re-render
from state, deliberately — so an action that notifies per row costs a full rebuild of the
grid per row. `retryFailedThumbnails` did that and cost a hundred renders for one button
press, which is what made two browser tests flaky under parallel workers. A contract check
now fails if a page-level retry re-renders per tile.

## The narrated walkthroughs

**The runner and the recorder are shared** -- `MARP_API/tools/walkthrough/`, extracted from
here (ADR-0007). Its README is where the scenario format, the caption/say/act rules, the
timing and the speech engines are documented. What stays in this app is
`tests/walkthrough/scenarios.mjs`, plus knowing when the grid has stopped moving.

Playwright drives a scenario, records video, and a spoken narration is mixed over it.
The user watches these to confirm behaviour, so they are a review surface, not a test
report — but they assert as they go, so a broken app fails and writes no video rather
than producing a convincing film of something that does not work.

**Record them when asked, not as part of the loop.** They are not a tier and they are not
in `npm test`. `playwright.config.mjs` leaves the `walkthrough` project out of the run
entirely unless something names it — a bare `playwright test` used to pull it in, which
turned a ninety-second loop into four and a half minutes and recorded videos nobody had
asked for.

**A walkthrough is for the human to watch. It is not automated testing, and it must never
be counted as coverage.** Settled again on 2026-09-11: *"walkthrough tests are for me to
review, those aren't for automated testing."*

So a walkthrough is never the evidence that something works, never cited in place of a
test, and never added to make a tier look complete. If a behaviour needs proving, it needs
a test at a tier that can observe it; the walkthrough is what the user watches afterwards
to decide whether he likes it. The assertions inside a scenario exist for one narrow
reason — so a broken app fails instead of producing a convincing film of something that
does not work — and that is quality control on the film, not coverage of the feature.

Two consequences that are easy to get wrong:

- **A walkthrough runs on test data. Never the corpus.** Settled 2026-09-11: *"the narrated
  walkthrough should only happen on test data — we're not doing actual data work during
  these times, it's so I can review development work."*
  A recording signs in as a real reviewer and commits real decisions, so pointed at the
  corpus it **writes to the scientific record while demonstrating a feature**. That is a
  defect, not a side effect: 60 review rows landed in the development corpus during one
  recording on 2026-09-11 and are still there, indistinguishable from decisions a person
  made on purpose.
  The recording still has to *do* the review — a film of a review tool that reviews nothing
  is worthless — so the fix is the database it does it to, not the doing. Point it at a
  disposable copy: `marp db up --port` plus `marp db load` (#125) makes one in a couple of
  commands, and #132 wants the same thing for the browser tier.
- **#142's corpus guard cannot see any of it.** That guard runs inside Jest, and a
  walkthrough is Playwright. **Do not "fix" that by pulling walkthroughs into the guarded
  path or into `npm test`** — they are not tests, and putting them there would both slow
  the loop and start recording videos nobody asked for, which is exactly what
  `playwright.config.mjs` excludes the project to prevent.

**And a walkthrough never belongs in a verification plan.** It is not a verification step,
it does not appear in `.marp/verification.md`, and no plan proposes one — *"a walkthrough
video is just supposed to be something I specifically ask for"* (2026-09-10). The user asks
for one when he wants to watch something; that is the whole of when they happen.

The confusion had a cause worth naming, because a sentence alone would not have fixed it:
`.marp/verification.template.md` carried a `## Walkthrough videos` heading, so every plan
written from the template was invited to promise a video nobody had requested. **The heading
is gone from the template**, in this repository and in the umbrella, and a comment in its
place says not to add it back. That is the check; this paragraph is the reason.

None of that weakens the rule below — a scene still has to assert what it narrates. That is
about not filming a broken app, not about a video being evidence that a phase is done.

**A walkthrough must never be the only thing asserting a behaviour.** Its job is to show
the user that a new feature works; every claim a scene makes has to already be proved by
the unit, contract or render tier, which run constantly. When a walkthrough is the only
witness to something, that behaviour is unwatched between recordings — and recordings
happen on request, which may be weeks apart. This is not hypothetical: a species
correction taking a row off a species-filtered page was asserted only in a scene, while
the contract check covering the same ground cleared the filter to sidestep it and returned
`'skipped'` when it hit the case anyway. A skipped branch looks green. **If a walkthrough
scene catches something, the fix is a named test at a real tier first, and the scene
second.**

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

### The cue goes first, or the action happens before the words

Reported twice on 2026-09-09, on two cuts of `verify-prefetch`. First *"you kinda flip
through it a little too quickly"*, and then, after a fix that did not work: *"you say pay
attention — I am now going to move forward, but you already moved forward a second or two
before that."*

**The runner starts `act` the instant the line begins speaking.** So the moment an action
happens is decided by *where in the sentence its cue falls*, and nothing else.

**The first fix was wrong and is worth recording as wrong**, because it looks correct: a
fixed `LEAD` pause at the top of `act`. It does not work, because a lead is measured in
milliseconds while the cue is measured in *words* — park "I am going to page forward"
twelve seconds into a paragraph and a two-second lead fires the action under "the fixture
still takes a hundred and forty milliseconds…", which is nowhere near it. Any fixed number
is wrong for every line except the one it was tuned against.

The rule is about the writing:

- **An action scene's line opens with its cue in the first three or four words**, then
  describes the result. *"Paging forward now … there. New tiles, straight away."* The
  ellipsis is where the action goes, and `beat(page, CUE)` is only long enough to say those
  few words.
- **Explanation gets its own scene, with no action in it.** If a line needs to set
  something up, argue for it, or name the old behaviour, it moves the app not at all. Half
  the scenes in `verify-prefetch` are these, and they are what make the other half legible.
- **One action per scene.** Page forward *and* back, or commit *and* return, is two scenes.
- **A dwell afterwards**, holding the result on screen. `beat(page, DWELL)`.
- **Anything that opens is held open long enough to be read** — a panel, a menu, a dialog.
  It is the only chance the viewer gets; they cannot pause and ask.

Length is not the cost it appears to be. `verify-prefetch` went seven scenes → nine →
seventeen, and 107 seconds → 158 → 210. All three were cheap to record, and the first two
were worth nothing, because a demo whose narration does not match what is on screen is
not evidence of anything.

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

**Not a list of what is unbuilt** — #68 is that, and a second copy here drifts. What
follows is what the code itself cannot tell you.

- **The reviewer no longer waits, and the cache is why** (#99, 2026-09-09). A page change
  was 148 ms and a skeleton grid; it is 2 ms and no loading state at all. Two consequences
  are deliberate and will otherwise be found as defects. **A cache hit does not refresh
  the total or the status counts**, consistent with the pinned branch, so *"Showing 45 of
  2,656 matching"* does not shrink while paging over held pages — the next genuine fetch
  corrects it, and `commitPage` refreshes the counts itself. And **a species correction
  retires every cached page** while a commit retires none: a correction moves the row out
  from under the species filter, so a cached page would go on showing it, and dropping only
  the visible page would leave it on the next one — a duplicate tile is worse than one
  wait. `.marp/verification.md` on that branch carries the numbers.

- **The question persists; the work in progress does not.** The mode, the filters, the
  sort and the page live in the URL and survive a reload — and the address is a link, so
  it can be sent to somebody else. Marks, outcomes and pinned pages are deliberately not
  persisted: #68 says undecided items from an uncommitted page may appear again, and a
  restored mark is indistinguishable on screen from a committed one while the record
  agrees with neither. `model/query-url.js` is the whole of it, and a bare address means
  the default question while any other address is read literally — which is why clearing
  the species filter survives a reload instead of being handed back.
- **`src/data.js` is a fixture, not an API.** Everything above it is written as though the
  API already existed, which is the point — but no claim in this file about latency,
  ordering or failure modes has been tested against a real server.
- **The Model dimension filters simulated data.** The fixture generates `model_name`,
  because a control nobody can exercise is a control nobody can judge — but no column
  links an observation to a model in the real schema. That is Phase 3 of #68.
