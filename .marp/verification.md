# Verification — MarineAppliedResearch/MARP_API#140

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `docs-branding` · *every relative src on the built front page exists in the output* | fast | Every non-absolute `src` in the built `index.html` resolves to a file under `docs/developer/`. Reads the built output, not the README, so it sees what a browser would ask for. |
| R1 | `docs-branding` · *the logo and the mark are among them* | fast | The two the issue names by hand are actually on the page, so the check above cannot pass vacuously on a page that lost its images. |
| R1 | manual · the network panel at 1440 and at 390 | render | No request on either documentation surface returns 4xx. The tier that can see a 404; nothing reading files can. |
| R2 | `docs-branding` · *the README still references its images from the repository root* | fast | The fix was not to edit the README into something wrong on GitHub. |
| R3 | `docs-branding` · *the stylesheet is linked from the head* | fast | `marp-docs.css` is in `<head>`, which is the reason the template was forked rather than extended. |
| R3 | `docs-branding` · *the stylesheet was copied into the output* | fast | The link is not pointing at a file the build never produced. |
| R3 | manual · screenshots at 1440 | render | The site is actually dark and actually MARP. No file-level check can see a rule that lost a specificity fight. |
| R4 | `docs-branding` · *matches tokens.css value for value* | fast | Every palette value in both stylesheets equals the one in `tokens.css`. This is the whole reason a copy is allowed. |
| R4 | `docs-branding` · *declares nothing tokens.css does not have* | fast | A colour cannot be smuggled in by inventing a token for it. Three local properties are exempt by name. |
| R4 | `docs-branding` · *states no colour below its palette* | fast | No hex, `rgb()`, `rgba()`, `hsl()` or `hsla()` below the `:root` block, which is what stops the check above being bypassed by typing a colour into a rule. |
| R5 | `docs-branding` · *every page carries the bar, not just the front one* | fast | All 600-odd generated pages, not the one that happened to be looked at. |
| R5 | `docs-branding` · *each uses the compact logo* | fast | The treatment the applications use, per the ML Dashboard's design contract. |
| R6 | `docs-branding` · *the build is wired to the fork and to the mirroring step* | fast | `jsdoc.config.json` points at the fork and `docs:dev:build` runs the script that mirrors the images. A committed output produced by hand would drift from this. |
| R6 | manual · clean rebuild | build | `rm -rf docs/developer && npm run docs:build` reproduces the committed output. |
| R7 | `docs-branding` · *every unchanged file is byte-identical to docdash* | fast | The fork is two changed files and three added ones. A docdash bump trips this, which is the intent. |
| R7 | `docs-branding` · *the forked jsdoc.css is upstream truncated, not upstream edited* | fast | The one change to docdash's stylesheet is a removal at the end; everything before the cut still matches byte for byte. |
| R7 | `docs-branding` · *publish.js forks no logic* | fast | One line re-exporting docdash. The nav builder, the search index and the source rendering stay upstream. |
| R7 | manual · search, collapse, mobile drawer | render | The three template behaviours a fork can silently break. |
| R8 | manual · screenshots at 1440 and 390 | render | Legibility at the sizes docdash actually uses. There is no automated contrast check here and that is a gap, stated below. |
| R9 | `docs-branding` · *app.js hands the bar and the theme to Swagger* | fast | Both files reach `swagger-ui-express`. Neither is imported anywhere else, so nothing else would notice one being dropped. |
| R9 | manual · screenshots of `/api-docs`, collapsed and expanded | render | Swagger UI ships its own colour on almost every element; only a render can say which ones were missed. |
| R10 | `docs-branding` · *each links to the platform and to the other surface* | fast | The bar exists twice, in `layout.tmpl` and in `swagger-chrome.js`. This is the half that will be forgotten. |
| R10 | `docs-branding` · *each says which surface it is* | fast | A deep link says what it is part of. |

## Requirements with no test

None. R1 to R10 each have at least one test above.

## Edge cases

- **A second `<nav>` in the bar.** docdash's stylesheet assumes there is exactly one and
  gives it the whole 250px fixed sidebar, so the bar's links inherited all of it and
  painted a panel over the real navigation. Found by screenshot, not by reading. Covered
  by *the bar links are not a second nav element*.
- **The two `!important` declarations in docdash.** The Home link and the ancestor
  breadcrumb are set with `!important`, so nothing weaker reaches them. Home stayed plum
  on navy through three passes of the stylesheet. Not separately tested; it is visible in
  the screenshot and the reason is written into the stylesheet.
- **The phone at 390px.** Three markdown tables in the README have no wrapper to scroll
  inside and dragged the document 165px sideways; one long inline `code` token accounted
  for the last 11px. Both are in the render evidence rather than in a test, because
  nothing that reads files can measure a layout.
- **jsdoc exits 1 under `--lenient`.** Nine tag expressions in this repository cannot be
  parsed, which made every `&&` after jsdoc unreachable. That is why the build is a script.

## Regression coverage

- **The 404 on every build.** #140's opening defect. `every relative src on the built
  front page exists in the output` is the named test at the tier that can see it.
- **The fonts and their `@font-face` rules.** Removing either without the other is a
  broken site or 1.2 MB of dead weight, so *no webfont is shipped and none is declared*
  asserts both halves together.

## Known gaps

- **No automated contrast measurement.** R8 rests on screenshots and judgement. A
  contrast assertion would need a browser tier this repository does not have for the
  documentation, and adding one for two static sites is not obviously worth it.
- **No render tier for the documentation at all.** The entry app has one
  (`frontend/apps/entry/tests/e2e/`); the documentation does not. Everything in the
  *manual* column below was run by hand for this change and will not be re-run
  automatically. That is a deliberate scope decision, not an oversight.
- **`docs/developer/` is 600-odd generated files and a clean rebuild rewrites all of
  them.** The diff for this change is therefore mostly noise, and a future reviewer cannot
  read it. The theme, the build script and the tests are the reviewable part.
- **The bar's links are absolute (`/`, `/api-docs`).** They are correct when served and
  dead when the built HTML is opened from disk. The images are mirrored precisely so the
  page still *renders* from disk; the navigation does not.

## Manual steps

Run against a server on a port nobody else is using, not 3000.

1. `rm -rf docs/developer && npm run docs:build` — expect the mirroring line and
   `jsdoc exited 1; the site above is complete`, then exit 0. **Then
   `git checkout -- docs/developer/*.md`**: six hand-written documents live inside
   the generated directory and jsdoc will never put them back. `docs-branding` ·
   *the hand-written documents inside the generated directory survive* is the
   check that says so if this is forgotten.
2. Open `/developer-docs/` at 1440x900. Expect: the MARP bar with the logo, a dark navy
   page, the MARP logo rendered on the front page rather than a broken-image icon, and no
   4xx in the network panel.
3. Same page at 390x844. Expect: the bar keeps the logo and drops the label and links, the
   menu button sits inside the bar, the drawer opens below the bar, and the document does
   not scroll sideways.
4. Type into the sidebar search, and collapse a nav group. Expect both to still work.
5. Open a source page (`app.js.html`) and a module page. Expect syntax colouring in the
   MARP palette and a legible sidebar.
6. Open `/api-docs/` and expand a POST operation. Expect the MARP bar, a dark page, the
   method chip carrying the colour rather than the whole block, and legible parameter and
   response tables.

---

## Results

<!-- Appended at G4, after the human has reviewed the plan above. -->
