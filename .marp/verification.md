# Verification — MarineAppliedResearch/MARP_API#74

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
| R1 | **none** | ? | `→`/`N` and `←`/`P` move between pages. |
| R2 | **none** | ? | `C` clears the page's marks. |
| R3 | **none** | ? | `1`, `2`, `3` select scientific, training and delete. |
| R4 | **none** | ? | `Ctrl`+`Enter` commits. A bare key never commits. |
| R5 | **none** | ? | No shortcut fires while typing in a text field, or while the delete |
| R6 | **none** | ? | Each shortcut is discoverable from the control it duplicates, in a way that |
| R7 | **none** | ? | `Ctrl`+`Enter` on a page that cannot be committed does not silently do nothing. |

**Choosing the tier is the decision that matters.** A rendering defect passes every
store-level check. A rule defect passes every browser test that never exercises it. A fix
reported as verified at a tier that structurally cannot observe the defect is how the same
bug gets reported twice.

## Requirements with no test

- **R1** — `→`/`N` and `←`/`P` move between pages.
- **R2** — `C` clears the page's marks.
- **R3** — `1`, `2`, `3` select scientific, training and delete.
- **R4** — `Ctrl`+`Enter` commits. A bare key never commits.
- **R5** — No shortcut fires while typing in a text field, or while the delete
- **R6** — Each shortcut is discoverable from the control it duplicates, in a way that
- **R7** — `Ctrl`+`Enter` on a page that cannot be committed does not silently do nothing.

<!-- Drafted by `marp verify plan` from the requirement ids the suite mentions.
     A requirement is "covered" here only in the sense that some test names it. Whether
     that test proves it is the thing a human is reviewing. -->

## Edge cases

Each one with the defect or the reasoning it traces to.

## Regression coverage

Tests added because something broke before. Name what broke.

## Known gaps

- **Focus visibility against the imagery is not tested.** #68 requires the focus ring to
  stay legible over photographic content, including green algae-covered substrate, where a
  green or teal ring vanishes. That needs eyes, not an assertion.
- **Alt and Shift combinations are suppressed by rule and only unit-tested.** We do not use
  them; the rule exists so we never hijack chords the browser and the operating system
  already own -- `Alt` and the left arrow is browser back, `Shift` and a letter is somebody
  typing a capital. Enumerating every such chord in a browser test would prove little.

The touch concern raised in the first draft of this plan is withdrawn: the hint is a badge
drawn on the control permanently, not revealed on hover, so it is visible however the
reviewer is pointing.

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
