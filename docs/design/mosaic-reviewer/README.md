# Picture Mosaic Reviewer — design mockups

Working mockups for the MARP Picture Mosaic Reviewer, built from the requirements in
[MARP_API#68](https://github.com/MarineAppliedResearch/MARP_API/issues/68).

These are **design studies, not an implementation target and not finished visual
design.** They exist to test decisions from the issue against something you can
actually look at — layout, tile density, whether the review states are
distinguishable while scanning, and whether the mode is obvious enough to prevent a
destructive mistake. Several were changed by what the mockups revealed.

The issue is the authoritative record. Where a mockup and the issue disagree, the
issue wins.

## Contents

| File | What it shows |
| --- | --- |
| `scientific-review.png` | The main page workflow in Scientific Data Review mode |
| `delete-mode.png` | Delete Mode, with its inverted commit and ambient danger treatment |
| `tile-states.png` | Every tile state at working size, plus a desaturated set |
| `html/` | The source each screenshot was rendered from |

## Regenerating the screenshots

The pages are plain HTML with no build step and no dependencies. Open any of them
in a browser directly, or re-render at the size the screenshots use:

```bash
chrome --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1600,900 \
  --screenshot=scientific-review.png \
  html/scientific-review.html
```

The committed screenshots are then downscaled to 1600×900.

Each page is a single self-contained file; `html/assets/` holds the shared MARP logo
and the placeholder organism crops.

## About the organism images

The tiles are **placeholders**, sliced from the earlier conceptual mockup attached to
issue #68. They are not real survey imagery and carry no scientific meaning. They are
there so the mockups can be judged at realistic density with realistic subject
matter — a grid of similar organisms with the occasional outlier.

Some decisions in the issue are explicitly deferred until these can be tested against
real imagery, in particular tile spacing, how organism scale is conveyed, and the
presentation of small bounding boxes.
