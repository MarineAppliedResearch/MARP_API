# Verification — MarineAppliedResearch/MARP_API#72

<!--
  The G3 package. Written BEFORE anything is run, and reviewed by a human before it is
  run. The point of this file is that "you're missing this case" and "that test does not
  actually prove the requirement" get said while they are still cheap.

  `marp verify plan` drafts it from .marp/task.md. `marp verify run` executes what was
  approved and appends the real results, failures included, verbatim.
-->

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | **none** | ? | A filter matching nothing says so, and says what to change. |
| R2 | **none** | ? | ~~A filter whose work is finished says *that*, and is distinguishable from |
| R3 | **none** | ? | A page whose thumbnails have all failed does not offer a commit that would do |
| R4 | **none** | ? | When the result is smaller than one page, the grid, the pager and the counts |
| R5 | **none** | ? | The count of what a commit will act on is visible when it differs from the |
| R6 | **none** | ? | Thumbnail transitions are exercised by tests: queued → ready, queued → failed, |
| R7 | **none** | ? | A failed thumbnail can be retried, per tile and for a whole failed page. |
| R8 | **none** | ? | Flagging a row with no imagery records the flag. Accepting one does not: an |
| R9 | **none** | ? | "No imagery" is an available flag reason, so a flag raised because nobody could |

**Choosing the tier is the decision that matters.** A rendering defect passes every
store-level check. A rule defect passes every browser test that never exercises it. A fix
reported as verified at a tier that structurally cannot observe the defect is how the same
bug gets reported twice.

## Requirements with no test

- **R1** — A filter matching nothing says so, and says what to change.
- **R2** — ~~A filter whose work is finished says *that*, and is distinguishable from
- **R3** — A page whose thumbnails have all failed does not offer a commit that would do
- **R4** — When the result is smaller than one page, the grid, the pager and the counts
- **R5** — The count of what a commit will act on is visible when it differs from the
- **R6** — Thumbnail transitions are exercised by tests: queued → ready, queued → failed,
- **R7** — A failed thumbnail can be retried, per tile and for a whole failed page.
- **R8** — Flagging a row with no imagery records the flag. Accepting one does not: an
- **R9** — "No imagery" is an available flag reason, so a flag raised because nobody could

<!-- Drafted by `marp verify plan` from the requirement ids the suite mentions.
     A requirement is "covered" here only in the sense that some test names it. Whether
     that test proves it is the thing a human is reviewing. -->

## Edge cases

Each one with the defect or the reasoning it traces to.

## Regression coverage

Tests added because something broke before. Name what broke.

## Known gaps

What this verification does not cover, stated plainly. A gap that is written down is a
decision; a gap that is omitted is a surprise later.

## Manual steps

Anything that cannot be automated — the Windows GUI, GPU inference, a real Jellyfin
server. Written so a human can follow them exactly, with the expected result for each.

## Walkthrough videos

Which scenarios will be recorded and, for each, the requirement it demonstrates and the
assertion it makes. A scene that narrates a result without asserting it can lie, so every
scene named here has to say what it asserts.

---

## Results

<!-- Appended by `marp verify run`. Real output, including failures, verbatim. -->
