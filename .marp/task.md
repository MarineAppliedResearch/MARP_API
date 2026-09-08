---
task: MarineAppliedResearch/MARP_API#85
repos: [MARP_API]
status: implementing
needs: []
---

# Every mode shows every workflow's tags on an observation

## Goal

A reviewer looking at an observation sees what *every* workflow has said about it, whatever
mode they are in. In Scientific Data Review a tile that training has already excluded says
so; in Training Data Review a tile science has already flagged or reviewed says so; Delete
Mode shows both, as it half does today. What the reviewer can *do* to the observation does
not change at all — the active mode still owns the mark, the commit and the filters. This
is only about what the record is allowed to say out loud.

## What is already true

Read from the code on `85-tags-across-modes` (branched from `develop` at `3069411`), not
assumed:

- **`existingState(mode, row)` is mode-scoped and does three jobs, not one.** It feeds the
  tile's record badge (`ui/tile.js`), the seeding of the page's exception set
  (`store.js:refresh` → `page.seedMarks`), and the `deleteImpact` breakdown. Only the first
  of those three is about visibility. Widening this one function would silently widen the
  other two — a training exclusion would start seeding a *scientific* mark.
- **The mode declarations already carry two dimensions for Delete** (`statusKey` plus
  `alsoStatusKey`), and `statusDimensions()` returns a list so the rail, the query, the
  defaults and the collapsed-rail badge stay ignorant of which mode is the exception. That
  list is about **filtering**, and every caller of it is a filter caller.
- **No table maps a status dimension to its row column.** `reviewStatus` →
  `review_status` and `trainingDisposition` → `training_disposition` is spelled out by
  hand in `data.js` (counts, filtering, commit) and again inside `existingState`. Reading
  both dimensions off a row in one place needs that mapping to exist once.
- **`takingBack` in `ui/tile.js` already requires `state.touched.has(id)`** as well as the
  record or the outcome carrying *this mode's* exception. So the derivation #82 is about is
  not widened by this change, provided `existingState` stays mode-scoped. See *#82* below.
- **Colour already carries most of the distinction.** `b-flag` amber and `b-out` green are
  scientific; `b-exc` grey and `b-pro` violet are training, and violet is training's own
  mode hue. `--accept` follows the mode, but `b-pro` is violet outright *because* promotion
  means promotion wherever it appears (recorded in the app's `CLAUDE.md`).
- **The vocabularies are disjoint.** FLAGGED and REVIEWED can only be scientific;
  PROMOTED and EXCLUDED can only be training. Nothing reads both ways.
- **`.badge` is one absolutely-positioned element at the tile's top left**, and several
  render tests do `expect(tile.locator('.badge')).toContainText(...)`. A second element
  carrying the same class would make those locators resolve two elements and fail on strict
  mode — so the record's other-workflow tags need their own class, which is honest anyway:
  `.badge` means *what this mode says about this tile*.
- **The fixture already carries every cross-workflow combination**, so the render tier
  needs no commit to reach them: 236 rows `unreviewed/excluded` and 179
  `unreviewed/promoted` (visible in Scientific's default view), and 214
  `reviewed/undecided` (visible in Training's default view). 23 are `reviewed/excluded`.
- **No row in the fixture starts `flagged`.** A flag only exists after a commit, so
  "flagged in Scientific is visible in Training" has to commit first, which also proves
  the record — not the outcome — is what travelled.
- **The legend is the pager swatch only.** There is no badge legend to extend.

## Requirements

- **R1** — In every mode, a tile shows the tags the record carries in the status dimensions
  that are **not** the active mode's own: scientific `flagged` / `reviewed` while in
  Training, training `promoted` / `excluded` while in Scientific, and the training
  dimension while in Delete.
- **R2** — The active mode's own statement keeps the primary badge, and its precedence is
  unchanged: **a mark outranks an outcome, which outranks the record**, all three read in
  the mode's own dimension. A tag from another workflow can never occupy that slot and can
  never displace a mark.
- **R3** — Another workflow's tag is context, never a selection. Clicking a tile that
  carries one marks it for the active mode exactly as before; nothing about it changes what
  a mark means, what arrives marked, or what the commit acts on.
- **R4** — A commit still writes only the active mode's dimension: a scientific commit
  writes `review_status` and nothing else.
- **R5** — `state.outcomes` stays scoped to the mode and `setMode` still clears it. A tag
  visible in another mode after a commit is the **record** read back through that mode, not
  an outcome that travelled. Nothing gains an outcome badge in a mode that did not commit.
- **R6** — The imagery stays a quiet zone. Another workflow's tag adds a badge and nothing
  else: the tile outline, the dimming and the grayscale keep meaning the *active* mode's own
  state, so a picture a scientist is judging is not greyed out because training excluded it.
- **R7** — Two tags on one tile must not bury the picture or overflow it, at desktop and at
  phone width. The tile is square with a 132px floor; the caption owns the bottom strip and
  the corner chip owns the top right.
- **R8** — A reviewer can tell which workflow a tag came from. **How** is A1, below.
- **R9** — The app's `CLAUDE.md` paragraph that asserts the opposite rule is rewritten to
  say what the code now does and that this reversed on 2026-09-08, and any test encoding the
  old rule is rewritten with the same note rather than deleted.
- **R10** — The status *filters* are untouched: a mode's rail still offers its own
  dimension only, and the address gains no parameter. (See A2.)

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-08: **(a), no label on the tile
  face.** The vocabularies are disjoint, colour already reinforces it, and it costs no width
  on a 132px tile. The workflow, the reason and the person go in the tooltip. Both
  sub-recommendations accepted too: the tag sits **bottom left above the caption, growing
  upward**, and a borrowed REVIEWED tag **does not name the reviewer**.

  *Does the reviewer need to be able to tell which
  workflow a tag came from, spelled out on the tile face?* The issue's own open question.
  Three answers are available and they are not cosmetic variants of each other:

  **(a) No label — vocabulary, colour and a separate slot carry it.** FLAGGED/REVIEWED are
  scientific words and PROMOTED/EXCLUDED are training words; nothing reads both ways.
  Amber/green versus grey/violet reinforces it, and violet is already training's mode hue.
  Another workflow's tags sit in their own quieter slot, so they read as *what somebody
  else's workflow said* rather than as this mode's answer, and the tooltip names the
  workflow, the reason and the person. **Recommended.** It costs no width on a 132px tile,
  it does not touch `.badge`, and it keeps the primary slot unambiguous — which is what
  protects R2.

  **(b) A short prefix on the tag — `SCI · REVIEWED`, `TRN · EXCLUDED`.** Unambiguous with
  no learning, but at 8.5px it roughly doubles the tag's width, and two abbreviations are a
  vocabulary of their own to learn. Available as a cheap follow-up if (a) proves unclear in
  use — it is one template string.

  **(c) An icon that means the workflow rather than the state.** The badge icon is currently
  the *state* (flag, star, tick, circle-slash), which is more informative; replacing it with
  a workflow mark trades information for provenance and would also change the badges the
  active mode draws.

  A second, smaller half of the same question: where the tag sits. Recommended **bottom
  left, just above the caption, growing upward** — the top left stays "what this mode says",
  the bottom left becomes "what the record carries", nothing overlaps the corner chip, and
  `.badge`'s CSS is not touched. The alternative is stacking directly under the primary
  badge at the top left, which is tighter but puts two different kinds of statement in one
  column.

  And whether a REVIEWED tag from science should name the reviewer the way the in-mode badge
  does (`b-oth` draws `row.reviewed_by`). Recommended **no** — from another workflow the
  useful fact is *science has accepted this*, not who; the name goes in the tooltip, and it
  keeps the tag short for R7.

- [x] **A2 · product/UI · blocking** — answered 2026-09-08: **badges only.** The filters,
  the query and the address are untouched. Filtering across workflows, if reviewers turn out
  to want it, is its own issue with its own defaults decided deliberately.

  *Does this change the filters as well as the
  badges?* The issue is written about what is visible on an observation and never mentions
  filtering, but `statusDimensions()` is named as "the shape to generalise", and that
  function is what drives the rail, the query and the address. Recommended **no**: badges
  only. Giving Scientific Review a training-disposition filter would change the default
  query — which observations appear at all — add a rail section and a URL parameter, and
  `trainingDisposition` defaults to `undecided`, so a careless default would hide the very
  promoted and excluded rows this issue wants seen. One line to confirm; if the answer is
  yes it is a separate requirement and probably a separate issue.

- [x] **A3 · product/UI** — settled by the code, not material: **only dimensions other than
  the active mode's own are drawn as record tags.** The mode's own dimension already has the
  primary badge and its full precedence, and a page arrives with its existing exceptions
  marked — so drawing the own-dimension record tag as well would put FLAGGED (the mark) and
  FLAGGED (the record) on the same tile. Follows the existing pattern; not treated as an
  open question.

## Decisions

- **2026-09-08** — `existingState(mode, row)` stays mode-scoped and keeps all three of its
  current callers. Visibility is a **new** derivation over the record, so that seeding the
  exception set and the precedence chain cannot be widened by accident. This reverses the
  visibility half of the note in the app's `CLAUDE.md`; the independence half stands.
- **2026-09-08** — the status dimension → row column mapping becomes one declaration in
  `model/modes.js` rather than a second hand-written pair.
- **2026-09-08** — a borrowed tag carries **no workflow label** on the tile face. The
  vocabularies are disjoint, colour reinforces them, and the tooltip names the workflow, the
  reason and the person. If that proves unclear in use, the prefix form (`TRN · EXCLUDED`)
  is **one template string** in `ui/tile.js` — nobody needs to rediscover that.
- **2026-09-08** — the filters, the query and the address are out of scope. Handing
  Scientific Review a training-disposition filter would change which observations appear at
  all, and `trainingDisposition` defaults to `undecided` — so a careless default would hide
  the very promoted and excluded rows this issue exists to surface. Filtering across
  workflows is its own issue if it is ever wanted.
- **2026-09-08** — `.badge` stays exactly one element per tile and the borrowed tag gets its
  own class: the render tests rely on it, and it is the honest reading — `.badge` means what
  *this* mode says about this tile.

## Plan

1. `model/modes.js` — declare each status dimension once (filter key, row column, neutral
   value, reason column, workflow label), express `existingState` through it unchanged, and
   add the new derivation: the tags a record carries in dimensions other than the mode's
   own. Unit tests first.
2. `ui/tile.js` — draw those tags in their own slot, leaving the mark / outcome / record
   precedence and every class it sets exactly as they are.
3. `styles/app.css` — the slot and the quieter treatment, from tokens, pointer-events off.
4. `tests/unit/model.test.mjs` — the new rules; annotate the mode-scoped `existingState`
   test with why it still holds.
5. `tests/e2e/render.spec.mjs` — the five rendering claims from the issue, plus overflow at
   phone width.
6. `frontend/apps/marp-mosaic-review/CLAUDE.md` — rewrite the paragraph.

## Acceptance criteria

- An observation flagged in Scientific shows that flag in Training and in Delete.
- One excluded in Training shows that in Scientific and in Delete.
- A scientific commit still writes only `review_status`.
- Clicking a tile that carries another workflow's tag still marks it for *this* mode.
- A mark still outranks everything on the record; a committed tile clicked once still
  visibly changes.
- Switching modes still leaves no outcome badge behind.
- No tile overflows or hides its picture at desktop or phone width, and the console stays
  clean.

## Test plan

G3. Filled in before anything is run.

## Status

- **Gate:** implementing — A1 and A2 answered 2026-09-08, both as recommended.
- **Notes:** the fixture is known to reach every case. #82 checked: it does not conflict —
  see below, and it is deliberately left alone.

## #82, and whether the two interact

They do not, as planned here — but they would under the obvious implementation.

`takingBack` is derived as `!marked && exception && state.touched.has(id) && (outcome ===
exception || existing === exception)`, where `exception` is `pendingException(state.mode)`
and `existing` is `existingState(state.mode, row)`. Keeping `existingState` mode-scoped
leaves that expression byte-identical, so #82's symptom is neither fixed nor broadened.

Had `existingState` been widened to return every tag instead, `existing === exception` would
have started matching another workflow's value, and TAKING BACK — which #82 shows already
appears on exclusions nobody touched — would have begun appearing in modes that cannot even
act on the tag. That is the trap, and it is why the decision above is written down.

One thing worth handing to whoever takes #82: its leading suspect looks right. `clearMarks`
and `markAllOnPage` in `store.js` both do `state.rows.forEach((r) =>
state.touched.add(r.observation_id))`, and `touched` is never re-seeded — so one press of
`C` marks every row on the page as hand-decided for the rest of the session. Not reproduced
in a browser here; this task did not run it.
