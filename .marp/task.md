---
task: MarineAppliedResearch/MARP_API#140
repos: [marp-api]
status: design
needs: []
---

## Goal

A developer who opens `/developer-docs` should land somewhere that plainly belongs to
MARP. Today they land on a default docdash page: light grey, Source Sans Pro, a teal
sidebar, and a front page whose every image is a broken icon because the README's paths
resolve against the wrong directory. The rest of MARP -- the public page, the Mosaic
Reviewer, the ML Dashboard -- shares one identity, dark navy with cyan, `Inter` over
`Arial Narrow`, the compact logo top left. The generated documentation should read as the
same product, and the logo on its front page should actually appear.

## Requirements

- **R1 - The logo resolves.** `docs/developer/index.html` renders `marp-logo.png` and the
  mark at the foot, and the five application screenshots, with no 404 for any of them.
  Verified against the built output, not against the README.
- **R2 - One README.** The fix does not create a second front page to maintain, and does
  not edit `README.md` into something that is wrong on GitHub.
- **R3 - The documentation wears the MARP palette.** Ground, surfaces, borders, links,
  code and the navigation take their colours from the same values as
  `frontend/shared/assets/css/tokens.css`, and the type is the MARP pairing rather than
  docdash's.
- **R4 - No colour is restated by hand.** The documentation stylesheet declares the
  palette once, from the token values, the way every other MARP surface does. A hex
  typed into a rule is the failure this is guarding against; it is how the video player
  ended up referencing an `--amber-300` that did not exist.
- **R5 - The chrome names the product.** The navigation carries the MARP logo and a way
  back to the platform, so a page reached from a deep link says what it is part of.
- **R6 - Nothing generated is edited by hand.** Everything in `docs/developer/` is
  produced by `npm run docs:build` from sources that are tracked, and a rebuild from a
  clean checkout reproduces it.
- **R7 - The fork is a diff, not a rewrite.** The docdash template is copied into this
  repository and changed deliberately. What changed from upstream, and which version it
  was forked from, is written down beside it, so the next upgrade is a comparison rather
  than an excavation. docdash's search, collapse and mobile navigation keep working.
- **R8 - It is legible.** Body text, code, the nav and the signature colours all clear
  the contrast the rest of MARP holds to, at the small sizes docdash uses.
- **R9 - `/api-docs` matches.** The Swagger UI is recoloured and re-typed from the same
  palette, and carries the same chrome, so the two documentation surfaces read as one
  product rather than two vendors.
- **R10 - Both surfaces link to each other and back.** From either documentation site
  there is a way to the other one and a way back to MARP.

## Open assumptions

- [x] **A1 · product/UI · blocking** - answered 2026-09-11: fork the docdash template
      into this repository. It buys a real MARP header bar, the stylesheet in `<head>`
      rather than at the end of `<body>`, and a MARP footer. The cost, owning a template
      that drifts from upstream, is accepted and is what R7 exists to contain.
- [x] **A2 · product/UI · blocking** - answered 2026-09-11: yes, both. `/api-docs` is
      branded in this change too, so the two documentation surfaces match. That is wider
      than #140's text, which names the developer docs only.
- [ ] **A3 · cross-repository · non-blocking** - The second half of #140 is that five
      repositories disagree about the logo, and one still carries the retired MARE icon.
      That spans repositories, so the assumption here is that it becomes its own tracking
      issue rather than part of this branch. Say so if it should be in scope.

## Decisions

- **2026-09-11** - The images are copied into the built output at the path the README
  already uses (`docs/developer/frontend/shared/assets/images/`) rather than referenced by
  a `/assets/...` URL. It is the first option #140 lists, it keeps one README with no
  rewriting step, and the built page works opened from disk as well as served. The cost is
  about 1.1 MB duplicated into committed output, on a directory that is already 120 MB.
- **2026-09-11** - `docs/developer-theme/` is the source directory. jsdoc copies it into
  the output through `templates.default.staticFiles`, which strips the include root, so
  the theme directory is laid out as the output expects it.

## Plan

1. Fork docdash 2.0.2's template into `docs/developer-theme/`, with a note beside it
   saying what was changed and from which version.
2. Take the palette out of `tokens.css` into the theme's stylesheet, once, and write
   every rule against it.
3. Give the layout a MARP header: the compact logo, the product name, and links to the
   platform and to `/api-docs`.
4. Point `templates.default.staticFiles` at `frontend/shared/assets/images` so the
   README's own paths resolve in the output.
5. Rebuild and check every image on the front page against the network, at the tier that
   can see a 404.
6. Rewrite `swagger.css` against the same palette, and give it the same chrome.
7. Add the fast-tier tests: the theme restates no colour, the config still points at the
   fork, both stylesheets exist, and the built front page carries the images.
8. Rebuild `docs/developer/` and commit the generated diff.

## Acceptance criteria

- `/developer-docs` serves a dark MARP page with the logo present and no failed request.
- `/api-docs` is recognisably the same product as `/developer-docs`.
- `npm run docs:build` from a clean checkout reproduces the committed output.
- Neither stylesheet contains a hex outside its own token block.
- docdash's search, collapse and mobile navigation still work.

## Test plan

Filled in at G3.

## Status

- **Gate:** verifying
- **Notes:** #152's spec was still on `develop` when this branch was cut; it is reachable
  at `git show 152-landing-page-narrative:.marp/task.md`.

  A1 and A2 were both answered the larger way, so this change is wider than #140's text:
  the API reference is themed as well as the developer documentation. A3 is still open and
  is not blocking -- the five repositories that disagree about the logo are untouched here.

  Found during implementation and not part of the issue: **six hand-written markdown
  documents live inside `docs/developer/`**, which is generated output. jsdoc will never
  put them back, and a clean rebuild takes all six. They were lost once during this change
  and restored; there is now a test that fails if it happens again.
