---
task: MarineAppliedResearch/MARP_API#130
repos: [marp-api]
status: design
needs: []
---

# The picker finds species, and a commit says which commit ran

Design specification for **MARP_API#130** and **MARP_API#131**, together.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.**

## Why these two are one phase

Both were reported on 2026-09-10 from the same sitting — the first time the mosaic was
driven against 1,062 real observations rather than the fixture. Neither blocks the other,
both are small, and both are the same kind of defect: **something on screen that is not
true.** The picker says *"Nothing matches"* when it never asked, and a commit says *"Saved"*
on a button that did not run.

They are also both invisible to the test suite for the same structural reason, which is the
part of this phase worth more than either fix. See *The fixture and the endpoint disagree*.

## What is already true, checked rather than assumed

Established by research on 2026-09-10 against the live corpus and the real database. Every
claim below is from a file and line, not from reading the issue.

### #130 — the picker

- **The endpoint does not send `species_id`.** `ROW_COLUMNS` in
  `repository/mosaic.repository.js:185` selects `o.comname` and `sp.comname AS
  species_comname` and no id. The list is written out deliberately so nothing joins the
  payload by accident, and `tests/mosaic-query.test.js:1078` pins the exact key set.
- **So the client can never work out the list.** `speciesListFor(row)`
  (`src/store.js:282`) opens `if (!row || row.species_id == null) return null`. It is
  always null for a row that came from the API.
- **And the search then returns nothing without asking.** `src/api/index.js:180` is
  `if (!q || !list) return [];` — **no `fetch` is sent.** `src/ui/picker.js:164` draws
  *"Nothing matches. Try 'Search all lists'."*
- **"Search all lists" is dead for a second, independent reason.** `widen` sets
  `list = null` by design (`src/store.js:1656`), and the same line at `api/index.js:180`
  refuses a null list. The escape hatch could never have returned anything.
- **There is no cross-list species search route.** `routes/species.routes.js` has
  `/api/species/list/:list/search` (scoped) and `/api/species` (every row, no search, no
  `is_active` filter). Nothing else.
- **The server half is healthy.** `speciesRepository.searchSpeciesInList('Inverts', 'se')`
  returns 42 rows against the live database; `ur` gives 28, `an` gives 98.
- **The data is not implicated.** All 1,062 observations are `species_list = 'Inverts'`,
  seven distinct species, all `is_active`. The catalogue holds 201 active `Inverts` rows.
- **Permissions are not implicated.** The reviewer the corpus was reviewed by holds
  `species:read`.
- **`MIN_SEARCH = 2` is not the cause.** The `< 2` branch draws *"Type 2 letters to
  search."* and never runs the search at all.
- **The facets already carry the list.** `mosaicRepository.facets({})` returns species
  entries shaped `{"value":775,"label":"California sea cucumber","list":"Inverts",...}`,
  which is exactly what `speciesListFor` looks up.
- **Deriving the list from `session_type` is already decided against.** The comment at
  `src/store.js:268-277` rejects a second copy of `db/species-lists.js` in the client.

### #131 — the commit report

- **One field serves two controls.** `state.commit` is `{ busy, status }`
  (`src/store.js:178`). `renderCommits` destructures it once (`src/ui/chrome.js:101`) and
  hands the same pair to both `paintCommit` calls (lines 118 and 136).
- **It fires in both directions, and `busy` has the same fault.** Pressing the sweep lights
  up Commit Marked too, and while either commit runs *both* buttons spin and say
  `Saving…`.
- **The fill is what makes it read as "the whole page was accepted."**
  `.commit.sweep.ok` (`styles/app.css:517`) turns the outlined sweep solid green.
- **The store already knows which button ran.** All five writes happen inside
  `runCommit({ selective })` (`src/store.js:609, 619, 627, 222`), and `selective` is
  already used to pick the log name at line 598. It simply is not recorded.
- **One commit at a time is genuine.** The `state.commit.busy` guards at
  `src/store.js:1469` and `1501` are real; `busy` being shared is correct.
- **Delete needs no special handling.** `renderCommits` sets `main.hidden = oneButton` and
  returns at `src/ui/chrome.js:134` before the second `paintCommit`.
- **The tile already knows whether its mark has been committed.** `state.outcomes`
  distinguishes them, and that is not incidental — `survives()` (`src/model/page.js:212`)
  is the rule that lets an accept mark outlive a commit, and it is *"the record now agrees
  with the mark"*.
- **The precedence is untouched by either fix.** The `.badge` chain
  (`src/ui/tile.js:235-255`) orders: takingBack, accept mark, exception mark, conflicted,
  outcome, existing, changed. **Mark outranks outcome outranks record.** Both fixes change
  a string inside an existing branch; neither adds a state or reorders the chain.
- **`existingState` is the wrong source and would be a trap.** Under the fixture
  `src/data.js` mutates the row's status column in place; under the API nothing does, and a
  commit deliberately invalidates no cache. It is stale for the rest of the sitting.

### The fixture and the endpoint disagree

This is the root enabler behind #130 and behind #124's F6 and F8, and it will keep
producing defects until something compares the two shapes:

- Fixture rows carry **41 keys** — including `species_id`, `taxserial`,
  `scientific_name`, `processor_name`, `lineId`, `ml_model_id`.
- The endpoint sends **20**.
- `tests/requirements.js:607` reads `state.rows[0].species_id`, **a field only the fixture
  has**, and passes.
- `tests/e2e/render.spec.mjs` navigates with `?backing=fixture` every time (line 28,
  asserted at line 60), and the fixture's `searchSpecies` (`src/data.js:875`) **ignores its
  `list` argument entirely**.
- `backend.js`'s parity check compares the *method set*, not the signatures, so the
  divergence is invisible to it.

## Requirements

- **R1** — Typing two or more characters in the correction picker returns candidates from
  the observation's own species list, against the real API.
- **R2** — **The species list is a property of the observation's session type, sent by the
  server.** The client no longer derives it from the observation's current species, and no
  longer holds a copy of the type-to-list mapping. Per A1.
- **R3** — Searching across every list works, through a route that exists. The panel never
  offers an action that cannot work.
- **R4** — A widened result shows which list each candidate is on; a scoped result does
  not. Per A3.
- **R5** — The empty state distinguishes *the catalogue has no match* from *no search was
  possible*.
- **R6** — Pressing either commit button reports `Saving…` and `Saved` on **that button
  only**. The other shows neither, in either direction, including its fill. **The idle
  button keeps its default appearance** — it is not disabled, blanked or spun. Per A4.
- **R7** — A mark whose commit has been recorded does not claim it is uncommitted. Per A5.
- **R8** — **`TAKING BACK` clears once the take-back is recorded.** The tile prefers this
  sitting's outcome over the row's stale status column, which is the app's own precedence —
  mark over outcome over record — applied consistently. Per A7.
- **R9** — The four derived tile states keep their present precedence, and `.badge` stays
  exactly one element per tile.
- **R10** — A fast-tier check fails when the fixture and the endpoint disagree about a row
  field the client reads.
- **R11** — Every fix has a test at a tier that can observe it. #131's two defects are
  render-tier: the store is *correct* in both cases, so there is nothing store-level to
  see. #130's row-shape fix is red at the API tier before it is green.
- **R12** — Nothing is admitted to a published contract by loosening a tripwire. The exact
  key set in `tests/mosaic-query.test.js:1078` is *moved into*, never widened.
- **R13** — No schema change, therefore no migration. Nothing in this phase alters a table,
  a column or existing data.

## Open assumptions

- [x] **A1 · API contract · blocking** — **How should the client learn an observation's
  species list?**
  (a) Add `o.species_id` to `ROW_COLUMNS` and to the tripwire. `speciesListFor` then works
  exactly as written, and the row finally agrees with the correction response, which
  already returns `species_id` (`repository/mosaic-correction.repository.js:258`).
  (b) Add `sp.species_list` to the row instead — one string, and it removes the facets
  dependency entirely.
  (c) Both.
  **The residual risk in (a), which is why this is being asked rather than decided:**
  `speciesListFor` resolves the list by looking the species up in `state.facets.species`,
  and facets are fetched **per question**. A pinned or cached page whose rows are no longer
  in the current facet answer returns null again — the same bug, intermittently.
  **Recommendation: (c).** `species_id` because the client is written for it and the
  correction path already speaks it; `species_list` because it makes the list a property of
  the row rather than a lookup that can miss. Two more columns on a row that already
  carries twenty.

- [x] **A2 · API contract · blocking** — **What should "Search all lists" call?**
  There is no cross-list search route today.
  (a) A new `GET /api/v2/species/search?q=`, mirroring `searchSpeciesInList` without the
  list predicate and keeping `is_active = true`.
  (b) An optional `list` parameter on a new unscoped path.
  (c) No new route: fetch all 854 species once and filter in the browser — but that
  bypasses `is_active` and re-implements the match.
  (d) Drop the widen action for now and ship the scoped search alone.
  **Recommendation: (a).** It is the same query minus one predicate, it keeps `is_active`
  where it belongs, and the panel already has the button. **This adds a route to a
  published surface, which the harness lists under *ask first*** — so it is yours whichever
  way it goes. (d) is a legitimate answer if you would rather not grow the API surface in a
  bug-fix phase; R3 is satisfied either way.

- [x] **A3 · scientific / data-meaning · blocking** — **Should a widened result say which
  list each candidate is on?**
  `ui/picker.js:21` draws common name and scientific name, and no list. **A common name is
  not unique across lists** — `Red sea urchin` is id 769 on `Inverts` and id 544 on
  `GULF_Inverts`, and the scoped route exists for exactly that reason. Widening without a
  list label lets a reviewer silently correct an `Inverts` observation to a `GULF_Inverts`
  row, and the correction is written to the record.
  **Recommendation: show the list on widened results only**, so the scoped case stays as
  uncluttered as it is today. Material because two reasonable answers change what gets
  recorded. Moot if A2 is answered (d).

- [x] **A4 · product/UI · blocking** — **What does the button that did not run show while
  the other is saving?**
  Today both spin and say `Saving…`, from the same shared field.
  (a) Disabled, keeping its normal wording — `Review page · 50 tiles`, greyed.
  (b) Keep spinning as now; only one commit may run anyway.
  (c) Disabled and blanked.
  **Recommendation: (a).** Disabling is honest, because the guard is real. But `Saving…` on
  a button that is saving nothing is the same lie as `Saved`, one step earlier, and #131
  only names the `Saved` half.

- [x] **A5 · product/UI · blocking** — **What does a committed accept mark's tooltip say,
  and what does "committed" mean?**
  Two readings, and they differ after a reload:
  **(i) this sitting**, from `state.outcomes`. After a reload there is no accept mark at
  all — marks are not persisted and `seedMarks` seeds only exceptions
  (`src/model/page.js:169-172`) — so the tile falls to `existingBadge`, which carries no
  `title`. Nothing false is left behind.
  **(ii) the record says so**, from `existingState`. Wrong twice: stale under the API, and
  it would read "committed" on a tile the reviewer has just right-clicked whose record was
  already `reviewed` from last week — which is not what the mark is about.
  **Recommendation: (i).** The *wording* is the part not to pick unilaterally; a starting
  suggestion is `Recorded as reviewed — click to take it back`, mode-substituted as the
  current string already is.

- [x] **A6 · product/UI · non-blocking** — **Does `TAKING BACK` get the same correction?**
  `src/ui/tile.js:236` reads `Not committed yet — the next commit accepts it` and has the
  identical fault. #131 names only the accept badge.
  **Recommendation: fix both** — one more string in the same ternary. See A7, which is why
  this one is worse than it looks.

- [x] **A7 · behavioural · blocking** — **Does the take-back defect join this phase?**
  Found during research, not in either issue. `takingBack` (`src/ui/tile.js:202`) reads the
  row's own status column. Under the **fixture** `src/data.js` writes that column in place,
  so after a commit the tile correctly shows `REVIEWED`. **Under the API nothing writes
  it**, so `takingBack` stays true and the tile goes on showing `TAKING BACK — Not
  committed yet` for a take-back that has already been recorded.
  **The render tier structurally cannot see this**, because it runs on the fixture — the
  same masking that hid #130. It is the same root cause as #131's tooltip and the same
  three lines of `tile.js`.
  (a) Fold it into this phase. (b) Track it separately.
  **Recommendation: (a).** Fixing the tooltip while leaving the badge beside it lying is
  half a fix, and it is the same edit.

- [x] **A8 · environment · non-blocking** — **Does the render tier stop running on the
  fixture?**
  The app's `CLAUDE.md` says `?backing=fixture` exists because the render tier *"has no
  seeded database to run against yet"* and that *"both come out when that database
  lands"*. **It has landed.** While the tier stays on the fixture, no browser test can
  witness #130, A7, or the next defect of this family.
  **Recommendation: not in this phase.** R8's key-superset check is the cheap 80% and
  belongs here; moving the render tier onto a seeded database is its own piece of work with
  its own failure modes, and this phase is two bug fixes. Worth an issue rather than a
  silent decision — yours to say.

## Decisions

Answered by the human on 2026-09-10 unless noted.

- **A1 — the species list comes from the observation's session type, and the server sends
  it.** *"An observation has a session, that session has a type, each species list is used
  for a different type."*
  **This overrides the recommendation above, and it is better for a reason the research
  missed.** Deriving the list from the observation's *current species* scopes the search by
  whatever the species happens to be now — so an observation corrected to the wrong list
  would offer candidates from that wrong list, and the mistake becomes unfixable through
  the tool. The session type is the invariant, so it always yields the right candidate set.
  The server already owns the mapping in `db/species-lists.js` and the mosaic row already
  carries `session_type`, so **the server resolves it and sends the list**. That also
  settles the objection recorded at `src/store.js:268-277`: the client is not getting a
  second copy of the map, because the client is not doing the mapping.
  `species_id` is **not** needed for this and is not being added — the facets lookup it
  fed goes away entirely.

- **A2 — the cross-list search route gets built.** *"If there is no cross list search
  route, there needs to be one. It's okay to update the marp_api as part of our
  development."*
  So recommendation (a): a search that mirrors `searchSpeciesInList` without the list
  predicate, keeping `is_active = true`.
  **The standing constraint that came with it, recorded because it outlives this phase:**
  API changes are within our purview; **schema changes go through proper migrations and
  production loses no data.** This phase changes no schema — the route reads — so R13 is
  the check that it stayed that way.

- **A3 — a widened result shows which list each candidate is on.** *"That's not a bad
  idea."* Scoped results keep today's uncluttered two-line row. A common name is not unique
  across lists, and a correction is written to the record.

- **A4 — nothing happens to the idle button.** *"It should just show its default, nothing
  should happen to the idle button when the other one is pressed."* So neither `status` nor
  `busy` reaches the button that did not run, and the idle button is **not** disabled.
  **The named cost, accepted rather than hidden:** the store allows one commit at a time
  (`src/store.js:1469, 1501`), so pressing the idle button mid-save does nothing and now
  says nothing either. A narrow window, and a button that spins while saving nothing is the
  worse of the two lies.

- **A5 — settled here, as offered.** *"I'm not too sure, you decide from what you think my
  purpose is."*
  Read as: *the screen must never state something untrue, and a tooltip should say what a
  click will do.* So **"committed" means this sitting, from `state.outcomes`** — after a
  reload there is no accept mark at all, and the tile falls to a badge with no tooltip, so
  nothing false survives. The wording gains a second branch, mode-substituted exactly as
  the current string already is:
  - uncommitted — unchanged: `Not committed yet — the next commit records this one as
    reviewed`
  - committed — new: `Recorded as reviewed — click to flag it instead`
  In Training those read `promoted` and `exclude`. The click is truthful: left click on an
  accept-marked tile flips it to an exception mark rather than clearing it (#126 R1).

- **A6 — dissolved by A7, not answered.** `TAKING BACK`'s tooltip is only false *because*
  the state itself lingers after its commit. Fix the precedence and the badge disappears
  when it should, at which point *"Not committed yet"* is true whenever it is on screen.
  **No string change on that branch.** One line fixes both.

- **A7 — folded into this phase, and the human's definition pins it exactly.**
  *"Taking back is just if something that was committed as flagged gets unflagged, that way
  if we commit again the taking-back item will be unflagged, for the mode it's in. If we
  take back from science mode, then it's not flagged, and we can undo the exclude type in
  the training data."*
  Two things follow. First, **it is per-mode**: the exception being taken back is
  `pendingException(state.mode)`, and taking back in Scientific says nothing about
  Training's exclusion, which is a separate decision in a separate dimension. That is how
  `takingBack` is already written and it stays that way.
  Second, **the defect is the `||`**:
  ```js
  const takingBack = !marked && exception && state.touched.has(id)
    && (outcome === exception || existing === exception);   // ui/tile.js:202
  ```
  `existing` is read off the row's own status column. The fixture writes that column in
  place; **the API never does, and a commit deliberately invalidates no cache.** So once
  the unflag is committed the outcome says `reviewed` while the stale row still says
  `flagged`, and the `||` resurrects the state for the rest of the sitting. It must prefer
  the outcome when there is one and fall back to the record only when there is not.

- **A8 — the fixture/endpoint check lands here; the browser tier moves later, tracked.**
  *"That fails when the fixture and the endpoint disagree about a field the client reads,
  although I'm not against pointing browser tests at the real database… our overall MARP
  umbrella makes running a new database just a few commands, so it might be smart to run
  against that database. Maybe just make that an issue we can tackle later."*
  So R10 is in this phase. The browser tier moving onto a real database is its own issue —
  **and it is a second database on its own port, never the corpus**, because the corpus is
  evidence and browser tests write.

## Out of scope

- Phase 9 (scale) and Phase 10 (the video drill-down).
- The reason vocabulary.
- The thumbnail sweeper (#121) and the file server (#120).
- Moving the render tier onto a seeded database, unless A8 says otherwise.
