---
task: MarineAppliedResearch/MARP_API#126
repos: [marp-api]
status: design
needs: []
---

# Two kinds of mark, and two commits

Design specification for MARP_API#126.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.**

## Where this came from

The human reviewed real observations in the mosaic for the first time on 2026-09-10, against
1,062 rows from three dives, and the commit gesture did not hold up:

> *"The mosaic reviewer's idea of flagging certain things and then hitting a button and having
> everything else accepted isn't really working when trying it out for real. There are times
> when you just want to exclude things, or just approve certain items, without it affecting
> anything else."*

**This is the only feedback in the project that came from using the tool rather than from
reading the code**, which is why it outranks Phase 9.

## What the reviewer gets

Settled by the human, 2026-09-10.

- **Left click marks a tile as the exception**, exactly as it does now — `flagged` in
  Scientific, `excluded` in Training, `deleted` in Delete.
- **Right click marks a tile as accepted** — `reviewed` in Scientific, `promoted` in Training.
  This is new: **a mark now carries a kind.**
- **The main commit button is new, and is the bigger one.** It commits **only what has been
  marked**, each tile according to its own mark, and says nothing at all about a tile nobody
  touched.
- **The existing sweep survives as a smaller, secondary button to its right**, doing exactly
  what it does today.

His words: *"the new button will be the main button, the bigger button… that will only accept
the ones that you've already marked, and the current button will be kind of a smaller button
on the right hand side that will do what it currently does."*

## What is already true, checked rather than assumed

- **A mark has no kind today.** `state.marks` is a set of `observation_id`, and
  `commitOutcome` reads it with a bare `marks.has(r.observation_id)`
  (`src/model/modes.js:220`). Every kind-aware rule below is new behaviour, not a rename.
- **Each mode already declares both halves of the vocabulary.** `MODES[mode].marks` is what a
  marked tile becomes, `MODES[mode].accepts` is what an unmarked one becomes
  (`modes.js:18-60`). So "accept this one specifically" has a value to write in every mode
  that has one — and **`delete` has `accepts: null`**, which is the exception.
- **Delete already commits only what is marked.** `commitActsOnMarked(mode)` branches
  `commitOutcome` for exactly that (`modes.js:222-227`). **The new main button is that
  behaviour generalised**, so its shape is proven rather than invented.
- **Accepting needs imagery; flagging does not.** An unmarked tile without a ready thumbnail
  counts as `skips`, never `accepts` (`modes.js:230-231`).
- **A page arrives with its existing exceptions already marked** (`page.seedMarks`), because
  committing a page holding untouched flags used to clear them silently.
- **`state.touched` records what the reviewer decided by hand**, so a take-back is not
  re-seeded.
- **The commit button already reports on itself** — it shows the count, disables when a commit
  would do nothing, and says how many will be skipped.
- **There is one commit button** (`index.html:94`) and **no `contextmenu` handler** anywhere
  in `src/ui/`.
- **The render tier runs every test at desktop *and* phone width, deliberately.**

## Open assumptions

- [ ] **A1 · product/UI · blocking** — **What is the accept gesture on a touch screen?**
  Right click does not exist on a phone, and the render tier runs the whole suite at phone
  width on purpose. This is the gesture the human expects to use *most*, so it cannot be
  desktop-only.
  Candidates: **long press**, the conventional touch analogue, but slow for a gesture repeated
  hundreds of times a page; a **second tap zone** on the tile, fast but it shrinks the target;
  a **mode toggle** making left click mean accept until switched back, fastest for a run of
  accepts and worst for a mixed page; or **no touch equivalent**, accepting that phone review
  uses the two buttons only.
  **Recommendation: long press, with the phone cost said out loud rather than hidden.** The
  human's call — he is the one who will do it thousands of times.

- [ ] **A2 · product/UI · blocking** — **What does right click mean in Delete Mode?**
  `MODES.delete.accepts` is `null`: the opposite of deleting is leaving a row alone, which
  needs no record, so an accept mark has nothing to mean there.
  Candidates: **inert**; **clears a mark**, which is useful and consistent; or Delete is
  **excluded** from the feature and keeps its single button.
  **Recommendation: inert, and the two buttons collapse to one in Delete** — the new main
  button and today's Delete button would do the identical thing, so showing both would be two
  controls with one meaning.

- [ ] **A3 · behavioural · blocking** — **Does a page still arrive with its existing exceptions
  marked, now that a mark has a kind?**
  `seedMarks` exists because committing a page holding untouched flags silently cleared them —
  **under the sweep.** The new main button cannot clear what it was never told about, so that
  reason does not apply to it.
  The risk runs the other way: if arriving flags are seeded and the reviewer presses the *main*
  button, they re-commit decisions they never made — harmless to the record but dishonest about
  who decided what, and `observation_reviews` carries a reviewer per row.
  Candidates: seed as now and let the main button re-write them; seed nothing and let the
  sweep's old trap return; or **seed as now, and have the main button ignore seeded marks the
  reviewer has not touched** — `state.touched` already tells them apart.
  **Recommendation: the third.** The only one that keeps both buttons honest, and the data to
  do it already exists.

- [ ] **A4 · product/UI · blocking** — **What does an accept mark on a tile with no picture
  do?** Accepting needs imagery and flagging does not; that rule is settled and on the record.
  An explicit accept mark is the reviewer saying *"I have judged this one"*, which they cannot
  have done without seeing it.
  Candidates: **refuse the mark** at click time, with the tile saying why; **allow it and skip
  at commit**, reported in the skip count as today; or allow it outright and let *"No imagery"*
  become a legitimate acceptance.
  **Recommendation: refuse at click time.** The skip count explains a *sweep*, where the
  reviewer never singled the tile out; refusing a deliberate click is clearer than accepting it
  and quietly not doing it.

- [ ] **A5 · API contract · blocking** — **Does the commit request change shape?**
  The endpoint takes `observations: [{ observation_id, version }]` plus `marks`. The main
  button must send only the marked, each with its kind — which the existing request can express
  if `marks` carries the kind and cannot if it does not.
  **Recommendation: extend `marks` with the kind rather than adding a second list**, because
  one list keyed by `observation_id` is what `applyCommit` already folds by, and two lists
  reintroduce the question of what an id appearing in both means.
  **This is a change to a published contract with a snapshot tripwire over it**, so whatever is
  chosen is *moved into* that list, never admitted by loosening it.

- [ ] **A6 · product/UI · non-blocking** — **What does a tile look like for each kind?**
  The tile already derives four things at once — marked, existing, outcome, borrowed — with a
  fixed precedence, and it is the area of the app that has produced the most reported bugs. A
  fifth distinction has to fit that table rather than sit beside it.
  Recommendation: today's mark styling for an exception mark and the mode's accept colour for
  an accept mark, with no new slot — `.badge` stays exactly one element per tile.

## Requirements

- **R1** — Left click marks the exception, unchanged in every mode.
- **R2** — Right click marks accepted, in every mode that has an accepted value.
- **R3** — The main commit button writes **only** marked tiles, each according to its kind,
  and writes nothing for a tile that was not marked.
- **R4** — The secondary button keeps today's behaviour exactly.
- **R5** — The main button is visually primary; the secondary is smaller and to its right.
- **R6** — Both buttons report what they will do before doing it, and both disable when they
  would do nothing.
- **R7** — A tile marked one way then the other ends with the later mark. Clicking a mark off
  leaves the tile untouched by either button.
- **R8** — Every new behaviour has a test at a tier that can observe it: the rules in
  `model/`, the gestures and both buttons in the render tier at **both** viewports.
- **R9** — Nothing is admitted to the mosaic row or the commit contract by loosening a
  tripwire.

## Out of scope

- Phase 9 (scale) and Phase 10 (the video drill-down).
- The reason vocabulary.
- Thumbnails, the sweeper (#121), the file server (#120).
