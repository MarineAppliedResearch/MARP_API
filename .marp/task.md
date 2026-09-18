---
task: MarineAppliedResearch/MARP_API#206
repos: [marp-api]
status: implementing
needs: []
---

## Goal

A reviewer can see how long the detector held on to a thing without switching modes. The
tile's top-right chip shows the track length — `12f`, the number of keyframes behind the
observation — in training mode only, so somebody deciding whether a detection is
scientifically sound has to switch to training mode to find out whether it lasted one frame
or ninety.

## Requirements

- **R1** — The track length is on the tile in scientific mode as well as training mode,
  and visible without hovering.
- **R2** — A reason chip and the track length can be shown at the same time. Neither
  replaces the other, which is what happens today: training mode drops the count into the
  reason chip's `title` when both apply, and a tooltip is not visible on a phone at all.
- **R3** — The count never covers or is covered by another chip, at desktop or phone
  width.
- **R4** — A correction chip stays clickable. It reopens the species chooser and must not
  stop doing so.
- **R5** — An observation with no keyframes reads `0f` rather than blank or `undefinedf`.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-18: where the count goes when a
  reason is also present. **Stacked, count under the reason chip.** The top-right slot is
  the one place on the tile that is not already spoken for — `.badge` is top-left, `.cap`
  the bottom strip, `.confidence-chip` bottom-right over it, `.rtags` bottom-left — and
  both chips are small. Stacking keeps one corner meaning "what this tile is", rather than
  scattering a second reading of the same row into a fourth corner.
- [x] **A2 · product/UI** — answered 2026-09-18: `delete` mode gets it too, and the
  condition is dropped rather than rewritten to name two modes of three. The count is a
  property of the observation, not of a workflow's opinion about it — the same shape as
  `confidenceChip(row)`, which is already drawn unconditionally in every mode two lines
  away. Delete's own documented reasoning is the strongest case for it: *"the useful
  question before removing an observation is not what one workflow thinks, but what
  anything on the record says"*, and a one-frame track is exactly that. Isaac asked for
  scientific and training; this is wider, so it is called out here and in the pull request
  rather than slipped in.
- [x] **A3 · behavioural** — answered 2026-09-18 from the code: a tile whose image never
  arrived keeps the count. `corner()` already renders regardless of thumbnail state, the
  count comes from `keyframes` rather than from the picture, and a track length is most
  useful precisely where there is nothing to look at.
- [x] **A4 · API contract** — answered 2026-09-18 from the code: no endpoint change.
  `keyframe_count` is already on every served row — `count(*)::int` inside the keyframe
  lateral in `mosaic.repository.js`, which returns 0 rather than null for an observation
  with no keyframes, so R5 needs no coalescing on the client.

## Decisions

- **2026-09-18** — The two chips go inside one positioned container rather than being
  given two hard-coded `top` offsets. A second offset would be a rule about how tall the
  first chip is, written in a different file from the chip, and wrong the first time
  somebody changes its padding or a reason wraps to two lines.

## Plan

1. `corner()` returns the reason chip and the count independently rather than choosing.
2. Wrap them in `.corner`, a column that stacks from the top right.
3. Move the positioning off `.frames` and `.reason-chip` onto `.corner`.
4. Browser checks in both modes, and a unit check for the 0 case.

## Acceptance criteria

- A tile in scientific mode shows `Nf` with no hovering.
- A tile carrying both a reason and a count shows both, at desktop and phone width.
- The correction chip still reopens the chooser.
- An observation with no keyframes shows `0f`.

## Test plan

Filled in at G3 in `.marp/verification.md`.

## Status

- **Gate:** implementing
- **Notes:** —
