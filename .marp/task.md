---
task: MarineAppliedResearch/MARP_API#93
repos: [MARP_API]
status: design
needs: []
---

# A committed page in Delete Mode wears its own mode's red

## Goal

A reviewer who has just destroyed observations sees the interface say so. Today a page
committed in Delete Mode draws its pager chip, its legend swatch and its progress bar in
the green that means "this workflow accepted it" — the one place the interface records
what you did to a page says the opposite of what happened. After this, everything that
reports what a commit did takes the hue of the mode that committed it: green for
scientific review, violet for training, red for Delete. Scientific and Training are
unchanged. Nothing about the imagery changes: mode colour is chrome only.

## Requirements

- **R1** — A page committed in Delete Mode draws its pager chip (`.pg.done`) in red: the
  red channel dominates, and it is clearly distinguishable from Scientific's green and
  Training's violet.
- **R2** — The pager legend swatch, which explains what the pager hue means, carries the
  same hue as the chip it explains, in every mode.
- **R3** — The rail's progress bar, which fills as pages are committed, carries the
  committing mode's hue — red in Delete Mode.
- **R4** — The commit button and its success state carry the committing mode's hue. Both
  are already red in Delete Mode and must stay red.
- **R5** — Scientific review is green and training review is violet everywhere they were
  before, with no visible change to either.
- **R6** — `styles/app.css` gains no new hex value; the reds come from
  `frontend/shared/assets/css/tokens.css`.
- **R7** — The stylesheet's comment, the variable names and the app's `CLAUDE.md` section
  on mode colour all say the same thing as the code afterwards.

## Open assumptions

- [x] **A1 · product/UI · not blocking** — Which hue does Delete's "what the commit did"
  family take? Answered from the issue and the existing stylesheet: `--red-500` as the
  fill and `--red-400` as the pale, the same pair Delete Mode already uses for
  `.mode-note`, a marked tile's outline and its commit button. No new colour is introduced.
- [x] **A2 · product/UI · not blocking** — Is `.ghost.go` wrong in Delete Mode? No: it is
  structurally unreachable there. `renderPicker` in `src/ui/picker.js` returns early and
  empties the host whenever `state.mode === 'delete'`, so the panel that holds that button
  never opens in Delete Mode. Left alone.
- [x] **A3 · product/UI · not blocking** — Was `.commit` / `.commit.ok` already handled?
  Yes. `body[data-mode="delete"] .commit` (specificity 0,2,1) already overrode both
  `.commit` (0,1,0) and `.commit.ok` (0,2,0), so Delete's commit button and its success
  tick were already red. Verified in the browser rather than assumed, and now asserted so
  it cannot silently regress.

## Decisions

- **2026-09-08 — One family, renamed, rather than a second family (the issue's option 1).**
  The issue offers giving Delete its own `--accept*` values, or introducing a separate
  variable meaning "what a commit did to this page". Taking option 1, and paying its
  stated price: the family is renamed `--accept*` → `--commit*` and its comment rewritten,
  because a red `--accept` would be a lie sitting in the stylesheet.

  Why not option 2: every consumer that is actually wrong in Delete Mode already means
  *what this mode's commit does or did* — the commit button, its success state, the
  committed-page chip, the legend explaining that chip, and the progress bar counting
  committed pages. The one consumer with a genuinely acceptance-flavoured meaning,
  `.ghost.go` ("Mark resolved" in the flag panel), cannot appear in Delete Mode at all. So
  classifying consumers into two families would leave `--accept*` with a single member,
  differing from `--commit*` nowhere on screen — five more variables and a second name to
  keep in step, buying no distinction anybody can see. If a later mode ever needs
  "accepted" and "what the commit did" to differ, splitting the family back out is a
  find-and-replace over six rules.

  Reversible in a sentence, which is why it was taken without asking.

## Plan

1. Rename the family at `:root` and under `body[data-mode="training"]`, rewrite the
   comment above it to say what it now means, and add the Delete block's values.
2. Update the six rules that read it.
3. Trim `body[data-mode="delete"] .commit` to the border it alone contributes, so the red
   has one source.
4. Update the mode-colour section of the app's `CLAUDE.md`.
5. Add the render tests, and prove they fail against the old stylesheet.

## Acceptance criteria

- A page committed in Delete Mode has a red pager chip, a red legend swatch and a red
  progress bar; a browser test asserts each, by channel, and asserts the chip is far from
  both Scientific's green and Training's violet.
- `npm run test:unit` stays at 127 passing.
- `npm run test:e2e` passes, with the new assertions added to the render tier.
- No hex value is added to `styles/app.css`.

## Test plan

Colour is a rendering claim, so every assertion lands in `tests/e2e/render.spec.mjs`
beside the existing `REVIEWED is green and PROMOTED is violet, and they are far apart`.
Colours are read by polling for a value that parses, because rendering is a full
re-render and a handle can be detached before `getComputedStyle` runs.

| Requirement | Test |
| --- | --- |
| R1, R5 | `a page committed in Delete Mode is red, and far from the other two modes` |
| R2 | the same test — the swatch is read in all three modes |
| R3 | the same test — the progress bar's gradient is read in Delete Mode |
| R4 | `the commit button follows the mode that owns the decision`, extended to Delete |
| R6 | read by hand over the diff |
| R7 | read by hand |

Each new assertion is proved to catch the defect by restoring the stylesheet from a file
copy taken before the edit and watching the test fail.

## Status

- **Gate:** implementing
- **Notes:** —
