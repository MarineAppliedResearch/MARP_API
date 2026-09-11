# Verification — MarineAppliedResearch/MARP_API#126

Two kinds of mark, and two commits. The plan below is for review **before** it is accepted as
this phase's evidence.

**What has already happened.** G2 ran the suites to know the implementation worked — 273 client
unit, 272 browser across two viewports, 603 API. What has *not* happened is anybody agreeing
they are the right tests, or that the gaps below are acceptable. `## Results` stays empty until
this plan is approved and run.

## Why the tier choices matter more than usual here

This change touches **the area of the app that has produced the most reported bugs** — the
tile's four simultaneous derived states, with their fixed precedence — and adds a fifth
distinction to it. It also adds the first gesture in the app that behaves differently on touch.
So two tiers carry almost all the risk:

- **render, at *both* viewports.** The only tier that can see what was drawn, and the only one
  that can exercise a touch gesture at all. R8 requires both widths deliberately.
- **wire** (`tests/unit/api-requests.test.mjs`). A mark now carries a `kind`, and this is the
  only tier that asserts the *serialised* body. `deepEqual` on the request object would pass
  for a `Map`, a `Set` or a dropped field.

The other three — parse, unit, contract — are the working loop and cover the rules.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `model`: *a tap toggles a mark*, with `MARK_EXCEPT` explicit | unit | Left click is unchanged in every mode; an accepted tile **flips** rather than unmarking, because `had` now asks "was it already *this* kind". |
| R2 | render: right click marks accepted, both viewports; badge is `REVIEWED`/`PROMOTED` in the accept colour | render | `contextmenu` is bound on `#grid`, so the browser menu is suppressed across the whole grid rather than per tile. |
| R2 (touch) | render with `hasTouch: true`: *double tap accepts* · *two taps 600 ms apart are two marks* · *the main button commits from a tap* | render | **Not skipped on desktop** — a real touch context is constructed, because a skipped check looks green. |
| R3 | `model` + contract: the selective commit sends `marked ∩ touched` and nothing else | unit + contract | The main button writes only what the reviewer marked **in this sitting**. A3's whole point. |
| R3 | contract: a selective commit pins nothing and marks no page committed | contract | `pinnedIds` is the query's `exclude` set — pinning would silently remove every untouched tile from the reviewer's remaining work. |
| R4 | the existing sweep tests, unchanged | contract + render | `commitOutcome` swapped `marks.has` for `isExcepted`; before #126 every mark was an exception, so the sweep's behaviour is identical by construction. |
| R5 | render: `#commitMarked` before `#commit`, sweep outlined and smaller; Delete hides the main button | render | Only a browser can say which is visually primary. |
| R5 | render: **the phone footer fits across**, added here | render | `.app` clips rather than scrolls, so an overflow is a commit button cut off the right edge. **Nothing asserted this before**, which is how it came to overflow at 524px in a 412px viewport with a single button. |
| R6 | `model`: `commitOutcome` and `selectionOutcome` drive both buttons | unit | One `renderCommits`/`paintCommit` pair, so a button's number cannot disagree with its own commit. |
| R6 | render: the main button's disabled title distinguishes *nothing marked yet* from *these marks came from the record* | render | The two disabled states mean different things to a reviewer. |
| R7 | `model`: same gesture twice unmarks · the other gesture replaces · switching kind drops the reason | unit | The later gesture wins. |
| R8 | 29 unit, 10 contract, 14 render (× 2 viewports) | all | — |
| R9 | `model.test.mjs` mark shape; `api-requests.test.mjs` × 2 wire assertions | unit + wire | Three tripwires had `kind` **moved into** them. The mosaic row shape is untouched. |
| A4 | render: an accept mark is refused at click time on a tile with no picture, and says why | render | Refusing a deliberate click beats accepting it and quietly not doing it. |
| A5 | wire: `marks` carries `kind`; the server refuses a reason on an accept mark and refuses `kind: accept` on `/delete` | wire + http+db | 400 before any write. |

## Requirements with no test

None. If that is wrong, it is the most useful thing to say at this gate.

## The tests that had to change, and what leaked

Four, and only one is a rule leaking:

1. `model.test.mjs` *a tap toggles a mark* — the mark shape gained `kind`. Moved into the
   tripwire.
2. `api-requests.test.mjs`, twice — wire mark entries gained `kind`. Moved in.
3. **`render.spec.mjs` *the commit button follows the mode that owns the decision*** — it read
   `#commit`'s `backgroundColor`, which is now `rgba(0,0,0,0)` because the sweep is outlined.
   **The rule that leaked: the fill moved to the primary button**, and the test named the
   element rather than the role. It now reads `#commitMarked` for review and training, `#commit`
   for Delete, and additionally asserts the sweep is outlined in the same hue.
4. `tests/requirements.js` `reset()` — gained `state.refused = null`, because the refusal fades
   on a timer and the checks run faster than that.

## Edge cases

- **Two taps 600 ms apart** — outside the 320 ms window, so two separate marks rather than an
  accept.
- **A fast double-click with a desktop mouse** — must not read as a touch double tap. Pointer
  type is taken at `pointerdown`, because a `click` is a `PointerEvent` in Chromium and a
  `MouseEvent` elsewhere.
- **An accept mark on a tile with no picture** — refused at click time.
- **A tile marked, then marked the other way** — the later gesture wins, and the reason is
  dropped when the kind changes.
- **The main button pressed on a freshly loaded page holding record flags** — commits nothing,
  and says why in its disabled title.
- **`openCorrection` on an accepted tile** — forces an exception mark, because saying the
  species is wrong is saying something is wrong.
- **Delete Mode** — right click inert, main button hidden, one control.

## Regression coverage

- **The phone footer**, above. It was already overflowing before this change.
- **`#commitMarked` visible in Delete** — `display: flex` beats the user agent's `[hidden]`.
  The same specificity trap Phase 8 hit with `#failure`; second occurrence, now tested.
- **The R5 size assertion** — the sweep is *wider* (longer label) and *taller* (it carries the
  Ctrl+Enter hint badge), so "primary is bigger" cannot be asserted on the bounding box.

## Known gaps

- **Touch is emulated, not real.** Chromium's `hasTouch` context is not a phone. The 320 ms
  window, and whether a double tap feels right on glass, are unverified on a device.
- **The 320 ms window has a named cost**: on touch, un-marking a tile you have just marked
  means waiting the window out. `DOUBLE_TAP_MS` in `ui/mount.js` is the one number to move.
- **Ctrl+Enter still fires the sweep**, per R4. A stray chord therefore commits the whole page,
  where on the main button it would commit only what was marked by hand — strictly less
  consequential. **Left as-is deliberately and offered to the human; it is one line.**
- **`marksAfterCommit` discards marks made on other pages.** `state.marks` spans the session,
  but a sweep rebuilds from the current page's ids. Pre-existing, untouched, and the selective
  path deliberately does not have this shape.
- **`willAct` in `ui/chrome.js:32` is dead** — computed, never read, already dead on `develop`.
- **`npm run docs:build` exits 1** on four pre-existing jsdoc errors in `model/schedule.js`.
  Unchanged by this branch.
- **CI runs the fast tiers only.** A green pipeline is not this package.

## Manual steps

1. **Review a page the way you would for real** — right click to accept some, left click to
   flag others, leave most untouched, press the **main** button. *Expected:* only what you
   marked is written; everything untouched is still unreviewed when the page is re-queried.
2. **Then press the sweep on a fresh page.** *Expected:* unchanged from today — marked become
   exceptions, everything else is accepted.
3. **On a phone or a narrow window**, confirm both buttons are reachable and the double tap
   accepts. This is the step the automated tier can only approximate.

## Walkthrough video

**Not recorded yet.** The human records these on request and has one from 2026-09-10 showing
the app before this change. A video of the two gestures would be the natural way to judge
whether the interaction actually feels right — which is the question #126 exists to answer —
but recording one is his call, not a step this plan claims.

---

## Results

<!-- Appended after this plan is approved and run. Real output, failures included. -->
