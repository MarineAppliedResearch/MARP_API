# Verification — MarineAppliedResearch/MARP_API#71

**Reviewed before anything is run.** Nothing here has been executed; these are the tests I
intend to write. `marp verify plan` currently reports 5 requirements with 0 referenced by
tests, which is true, and is why this file comes first.

## What each test proves

| Req | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `delete: commitPage sends nothing until confirmed` | contract | `MarpData.commitPage` is **not called** on the first click in Delete Mode. Asserted by counting calls, not by looking at the screen. |
| R1 | `delete: cancelling leaves every mark exactly as it was` | contract | after cancel, `state.marks` is unchanged and `state.confirm` is null |
| R2 | `deleteImpact counts only marked, ready rows` | unit | the dialog's number equals `commitCount` for the same page — including that a marked tile whose thumbnail failed is not counted |
| R2 | `the dialog names the number actually deleted` | render | the count in the heading equals the number of `.tile.out-deleted` after confirming |
| R3 | `the dialog states the deletion is permanent` | render | the warning line is on screen and visible |
| R4 | `scientific and training commit without a dialog` | contract | each calls `MarpData.commitPage` immediately and never sets `state.confirm` |
| R5 | `Escape cancels, and focus starts on Cancel` | render | Escape closes it and sends nothing; `document.activeElement` is Cancel when it opens |
| A3 | `the breakdown counts reviewed and promoted rows` | unit | `deleteImpact` returns `{reviewed, promoted}` matching the fixture, and omits `excluded` |
| A3 | `the breakdown appears only when there is something to say` | render | with none reviewed or promoted, no "Including…" line is drawn |

**Why these tiers.** The rule is pure data, so it belongs in `model/` — milliseconds, no
DOM. "Did it actually send" is a question about the store and the data seam: invisible to a
unit test, and unreliable asserted through a screen. Whether the dialog is on screen,
focused and dismissible is only observable in a browser.

Putting R1 in Playwright would be the classic mistake here — it would pass whenever the
dialog appeared, whether or not a request went out behind it.

## Requirements with no test

None, once the above are written. R1 and R2 have two tests each because they are the two
that would hurt if wrong.

## Edge cases

- **A marked tile whose thumbnail failed.** `commitCount` excludes non-ready rows, so the
  dialog must too, or it promises to delete something it will not.
- **Zero marked.** No dialog at all, per the A5 decision — tested so that decision cannot be
  silently reversed later.
- **One observation.** "1 observation", not "1 observations".
- **Confirming twice.** `confirmDelete` no-ops when `state.confirm` is null, so a double
  click cannot send two deletes.

## Regression coverage

New behaviour, so none inherited. The existing rule it must not break is that a failed
commit applies nothing and leaves marks intact; R4 covers the other two modes, and the
delete path reuses the same `commitPage` body below the gate.

## Known gaps

- **These prove the client asks before sending. They cannot prove the API deletes what it
  was told to** — the API does not exist yet. That is Phase 7.
- **Nothing tests that the dialog is readable.** Whether the breakdown actually gives
  somebody pause is for the walkthrough and for you, not for an assertion.
- **Screen readers are not tested.** `role="alertdialog"` and the labelling are written to
  be correct and verified by nothing here.

## Manual steps

None; all of the above is automatable.

## Walkthrough videos

One scenario, `verify-delete-confirmation`, two paths, an assertion behind every line:

1. Mark ten tiles in Delete Mode, commit, and **hold on the dialog** so it can be read —
   count and breakdown both on screen. Asserts it is visible and names ten.
2. Cancel. Asserts all ten are *still marked* and nothing was deleted — narrated as
   "before this change, that click would already have destroyed them".
3. Commit again, confirm, assert ten tiles carry the deleted outcome.

---

## Results

<!-- Appended by `marp verify run` once this plan is approved. -->
