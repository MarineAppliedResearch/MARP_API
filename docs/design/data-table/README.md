# MARP data table — design mockups

Working mockups for MARP's shared data table package, built from the requirements in
[MARP_API#70](https://github.com/MarineAppliedResearch/MARP_API/issues/70).

These are **design studies, not an implementation target and not finished visual
design.** They exist to test decisions from the issue against something you can look
at — column density, how the schema-driven column definitions surface in the header,
whether the editing and selection states read clearly, and where the boundary between
the table package and its hosting application falls.

The issue is the authoritative record. Where a mockup and the issue disagree, the
issue wins.

## Contents

| File | What it shows |
| --- | --- |
| `observation-table.png` | The observation table with its header, editing states, and selection states |
| `html/` | The source each screenshot was rendered from |

## Scope

These mockups cover **the table and its header only**. The surrounding application
context — how the table sits inside the Mosaic Workspace, the Annotation Workspace, or
the Data Processing Workspace — is deliberately not designed yet, and will be worked
out when the package is integrated.

The toolbar and footer shown are the table's own, not application chrome. Whether
those belong to the package or to the hosting application is an open question.

## Regenerating the screenshots

Plain HTML, no build step and no dependencies. Open the file in a browser, or
re-render at the size the screenshot uses:

```bash
chrome --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1600,900 \
  --screenshot=observation-table.png \
  html/observation-table.html
```

The committed screenshot is then downscaled to 1600×900.

## About the data and images

Every column is real — taken from the `observations` schema and the tables it joins to.
The **values are fabricated**, and the thumbnails are placeholders reused from
`../mosaic-reviewer/html/assets/` rather than duplicated here. Neither carries any
scientific meaning.
