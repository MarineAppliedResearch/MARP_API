---
task: MarineAppliedResearch/MARP_API#152
status: plan
---

<!-- Hand-written. `marp verify plan` DRAFTS this file from the requirements and
     will overwrite it; it does not check anything. Do not run it over this. -->

# Verification plan, #152

Sixteen requirements, three tiers, and one of those tiers is a person reading the
page. That last part is not a cop-out and it is worth being blunt about: **most
of this issue asks for a story to land, and no assertion can tell you whether it
landed.** A test can prove the word *seamless* is absent. It cannot prove the
page is interesting. So the plan below says which requirements are mechanically
checked, which are checked by reading, and what is not covered at all.

## Tier 1 — copy and structure. `tests/landing-copy.test.js`

Jest, in the main suite, no database, no server, no browser. Reads the two HTML
files and `landing.css` off disk. Runs in CI, which is the point: this is the
tier that stops the rules being undone six months from now by somebody who never
read the issue.

| Proves | How |
| --- | --- |
| **R8** the transplant test | the banned word list, case-insensitive, both pages, comments stripped |
| **R9** no MARE | word-boundary search, both pages |
| **R14** house style | no U+2014 anywhere, comments included |
| **R2** the old pipeline is gone | `Assist` and `Deliver` absent as headings |
| **R11** nothing stops working | both pages link the stylesheet and script; the login form still posts to `/api/v2/auth/login`; `app.js` routes `/how-it-works`; the doors to both live applications and to `/api-docs` and `/developer-docs` are present |
| structural integrity | every `<use href="#x">` has a `<symbol id="x">` **on the same page**, and no symbol is defined and never drawn; every class in either page has a rule in `landing.css` |

The sprite check exists because the split gave each page its own trimmed sprite.
A `<use>` with no matching `<symbol>` draws nothing and reports nothing, which is
the worst kind of breakage to ship.

## Tier 2 — render. `frontend/apps/entry/tests/`, Playwright, `desktop` and `phone`

Not in CI, deliberately: browser tiers are not, by the doctrine in `AGENTS.md`.
Run before merge and when the page changes.

| Proves | How |
| --- | --- |
| **R11** nothing stops working | both pages respond, nothing on them returns >= 400, no uncaught page error, the login dialog opens and closes |
| **R13** it holds at every width | `scrollWidth === clientWidth` at 390px and 1440px |
| **R12** the enhancement layer still works | after a full scroll, nothing is left carrying `data-reveal` without `is-visible` |
| navigation | every in-page `#anchor` resolves to an element that exists |

**The reveal check is the one that earns its keep.** Everything on these pages
starts at `opacity: 0` and is revealed by an IntersectionObserver. A capture that
scrolls faster than roughly 300px per 140ms photographs a blank document, and
that happened during this work: the first full-page screenshot showed the hero
and nothing else. A render test written without knowing that would pass against a
page nobody can read.

## Tier 3 — read by a human. The part no test replaces

These are the requirements the issue actually cares about, and every one of them
is a judgement:

- **R1** the problem arrives before the mechanism
- **R3** the page shows what MARP removes
- **R4** *MARP knows what comes next* is explained rather than sloganised
- **R5** machine learning reads as a supporting part rather than the headline
- **R6** a scientist does not come away thinking MARP wants to replace review
- **R7** the applications read as evidence rather than as the pitch
- **R10** nothing is claimed that MARP cannot do
- **R15** the landing page is short enough to actually be read
- **R16** the video player section is accurate and earns its place

The issue's own *Acceptance direction* is the script for this: eight questions a
new visitor should be able to answer after one pass down the page. Read both
pages once, at full width and on a phone, and answer them.

## Evidence already collected

Real output, from the running page rather than from a description of it.

```
== landing / @ 1440          == landing / @ 390
   failed requests: none        failed requests: none
   page height: 3536px          page height: 6018px
   overflow: 1440 vs 1440       overflow: 390 vs 390
   reveals hidden: 0            reveals hidden: 0

== howitworks @ 1440         == howitworks @ 390
   failed requests: none        failed requests: none
   page height: 4841px          page height: 8214px
   overflow: 1440 vs 1440       overflow: 390 vs 390
   reveals hidden: 0            reveals hidden: 0
```

Route check against the running server:

```
/                         -> 200
/how-it-works             -> 200
/api-docs                 -> 301   (trailing-slash redirect)
/developer-docs           -> 301   (trailing-slash redirect)
/apps/marp-mosaic-review/ -> 302   (permission gate, unauthenticated)
/apps/marp-ml-dashboard/  -> 200
```

R15 in numbers: the landing page went from **6,503px to 3,536px** on a desktop,
and from 11,590px to 6,018px on a phone.

## Not covered, and why

- **Whether the page is any good.** Tier 3 is a person, and that is the honest
  answer rather than a gap to be closed with more assertions.
- **The rule-of-three and "not X, it is Y" halves of R14.** The em dash is
  mechanically checkable and those two are not, so they are enforced by reading.
  A regex for three comma-separated clauses would fire on every honest list.
- **Whether the copy is factually true of MARP (R10).** The claims were taken
  from this repository and from `marp-video-player`'s README rather than
  invented, but no test can confirm that a sentence about a survey is accurate.
  That needs the person who runs the surveys.
- **Visual regression.** No screenshot baselines. The render tier checks that the
  page works, not that it looks the way it looked yesterday.
- **The `301` on `/api-docs` and `/developer-docs`.** Followed by hand and
  correct; the render tier asserts the links are present rather than walking
  them, because they lead into Swagger and JSDoc, which are not this issue.
- **`old_index.html`.** Left in place, not served, not checked.

## Results

Run 2026-09-12. Both automated tiers green. Tier 3 is still the human's.

### Tier 1, `npm run test:core` / `npx jest tests/landing-copy.test.js`

```
  Test Suites : 1 passed, 0 failed, 1 total
  Tests       : 53 passed, 0 failed, 0 skipped, 53 total
  Duration    : 1.6s
  Result: ALL TESTS PASSED
```

Registered in the `core` group, which went from 9 suites to 10:

```
  core          10  projects, sessions, tasks, schema, and data integrity
  ok   every suite belongs to exactly one subsystem
```

### Tier 2, `npm run test:app:entry`

```
  20 passed (18.6s)
```

Two pages, two viewports, five checks each.

### Every check was proved red before it was believed

Eight mutations against scratch copies of the pages, each producing one failure
and naming the offender:

```
Received: "index.html says \"seamless\""
Received: "...<!-- Sticky global navigation - with an em dash. -->..."
Received: "index.html says \"MARE\""
+   "Deliver",   +   "icon-nowhere",   +   "ghost-block"
Expected pattern: /app\.get\(\s*'\/how-it-works'[\s\S]{0,400}?'how-it-works\.html'/
Expected value: "/apps/marp-ml-dashboard/"
```

And for the render tier:

```
Expected: 1600 / 390    Received: 3000                    (sideways)
expect(locator).toBeHidden() ... Received: visible        (dialog)
+   "section-heading reveal", "lanes reveal", ...         (12 and 10 unrevealed)
```

The response check proved itself without being asked: the first version of the
render tier's static shim did not alias `/assets`, and the test failed with four
verbatim 404s.

### What the tiers caught that reading did not

- **An em dash in `landing.js`.** `"Signed in - redirecting..."` is written
  straight into the page by the login handler, so R14 covers it, and neither
  HTML file had one. Checking only the two documents could never have seen it.
  Fixed, and the copy suite now reads the shared script too.
- **A blank page in the first capture.** Everything below the hero photographed
  at `opacity: 0`, because the reveals are IntersectionObserver-driven and the
  capture scrolled faster than the observer delivers. That is now an assertion
  in the render tier rather than a thing somebody has to remember.
- **A colour break in the middle of a word.** `.hero h1 span` runs white to
  green across 72% to 92% of its own width, so `<span>months.</span>` painted
  `month` white and `s.` green. The whole second line is the span now. Caught by
  looking, not by a test, and it stays that way.

### Manual evidence

Login, from both pages, against the real API:

```
/              dialog open: true    bad password: "Invalid username or password."    -> /apps/dashboard/index.html
/how-it-works  dialog open: true    bad password: "Invalid username or password."    -> /apps/dashboard/index.html
```

Routes, against the real server rather than the render tier's shim:

```
/                         -> 200      /apps/marp-mosaic-review/ -> 302  (permission gate)
/how-it-works             -> 200      /apps/marp-ml-dashboard/  -> 200
/api-docs                 -> 301      /developer-docs           -> 301  (trailing slash)
```

R15 in numbers. The landing page went from **6,503px to 3,536px** on a desktop,
and from 11,590px to 6,018px on a phone. `/how-it-works` is 4,841px, which is
the length the argument needed and the reason it is not on the landing page.

### Known gap in tier 2

The render tier serves the pages from `frontend/apps/entry/tools/serve.mjs`, a
static shim, rather than from the real API. So it reproduces the routing rather
than proving it, which is why the `app.js` route assertion lives in tier 1 and
why the route table above was walked by hand against a real server. Setting
`MARP_API_BASE` runs the same specs against the API; the pages are public, so
there is no sign-in step. The alternative was dragging a database and the
thumbnail extractor into a layout test.

## Status

- **Gate:** ready-for-pr
- **Tier 3 is outstanding and is the human's**, and it is the tier that covers
  R1, R3, R4, R5, R6, R7, R10, R15 and R16. Read both pages once at full width
  and once on a phone, against the issue's eight acceptance questions. Four of
  those eight are answered only on `/how-it-works`: why the workflow is narrow,
  where machine learning helps, where scientists stay authoritative, and most of
  why the work is slow today. That is the direct cost of a short landing page
  and it should be a decision rather than a surprise.
