---
task: MarineAppliedResearch/MARP_API#152
repos: [marp-api]
status: design
needs: []
---

## Goal

Someone who has never heard of MARP opens the public page and understands, before they
are shown a single diagram or application, why turning ocean survey data into science is
still slow and what MARP is doing about it. Today the page opens with what MARP is made
of. It should open with the gap between collecting ocean data and understanding it, and
earn the architecture and the applications on the way down.

## Requirements

- **R1 · The problem comes before the mechanism.** The first screenful names the gap
  between how fast a survey collects data and how long the science takes. The capability
  diagram and the application cards appear only after the visitor knows why they matter.
- **R2 · The linear five-box workflow is gone.** `Collect -> Review -> Process -> Assist
  -> Deliver` reads as a batch pipeline where each stage waits for the last. It is
  replaced by something that shows stages advancing together from one dataset. Renaming
  the five boxes does not satisfy this.
- **R3 · The page shows what MARP removes.** Repeated handoffs, disconnected tools,
  duplicated preparation, and stages waiting on each other — set against the MARP
  workflow. Without claiming any project finishes in hours today.
- **R4 · "MARP knows what comes next" is explained, not sloganised.** The idea appears
  concretely — MARP can be simpler than a general toolbox because the sequence of work is
  known, so it knows what stage data is in and what normally happens next. That exact
  phrase is a shorthand from the design discussion, not approved copy.
- **R5 · Machine learning is inside the workflow, not the headline.** The page never reads
  as an AI platform for ocean science. ML appears where it earns its place: models process
  data at scale and propose observations.
- **R6 · Scientific authority stays with people, explicitly.** `Biologists lead. MARP
  amplifies.` is preserved in spirit. An experienced scientist must not read the
  automation story and conclude MARP is trying to replace expert review.
- **R7 · Applications are evidence and sit low in the page**, and each card is honest
  about what exists today (see A1).
- **R8 · The transplant test, applied to every sentence.** If a sentence could be moved to
  Salesforce, Palantir, Raytheon or an AI startup's site with only the product name
  changed, it is rewritten. This governs the `<title>`, the `<meta name="description">`,
  the nav labels, the login dialog and the footer — not only body copy. Specifically out:
  *proven workflow · trusted outputs · purpose-built · at scale · unlock · empower ·
  seamless · transformative · streamlined · leverage · robust · revolutionize · connected
  workflows*, and *platform* used as MARP's self-description.
- **R9 · MARE appears nowhere** in the public narrative.
- **R10 · No invented figure, and nothing said that MARP will not do.** Revised
  2026-09-12. It used to require that what MARP does today stay distinguishable
  from the direction the architecture is built for. That was a misreading of who
  the page is for and when it ships: **these pages are released when the work is
  finished, so they are written as though it is.** Every part of MARP, the six
  applications included, is described as working, in present tense, with no
  hedging of any kind. The ban on invented figures is untouched.
- **R11 · Nothing stops working.** Login against `POST /api/v2/auth/login` and the
  redirect to the dashboard, `/api-docs`, `/developer-docs`, and the doors into the two
  running applications all survive the restructure.
- **R12 · The visual identity is the reference, not the target.** Dark marine ground, the
  MARP logo and mark, the restrained cyan/green/blue accents, the hero photography. Layout
  changes where the narrative needs them. The skip link, the aria wiring, the visible
  focus states and the `prefers-reduced-motion` blocks are preserved.
- **R13 · It holds at phone, tablet and desktop widths**, on the breakpoints
  `landing.css` already defines.
- **R14 · House writing style.** No em dashes anywhere on either page, comments
  included. No rule-of-three lists, and no "it is not X, it is Y" construction.
  These are the patterns that make a page read as machine-written, and they were
  all over the first draft.
- **R15 · The landing page is short.** It carries the hero, one diagram, the
  application cards and a handoff, and nothing else. The first draft ran to
  6,503px on a desktop. The long-form argument lives on a second page, which is
  allowed to be as long as it needs.
- **R16 · The video player gets a section on the long-form page.** Revised
  2026-09-12. It says that an observation leads back to the exact frame and that a
  reviewer can move through the footage in either direction, and it stops there.
  The original requirement also asked it to explain **why a browser cannot do this
  on its own**; the final wording pass forbids exactly that, along with playback
  rates, decoding and container mechanics, as developer material. The later
  decision wins.
- **R17 · An application card says what comes out of it, never how a person
  operates it.** The first Stereo Sizing copy described the interaction: pick the
  same two points in both cameras. That is wrong to publish, because the work is
  meant to be done by a model later and the card would then be describing a
  workflow MARP had moved on from. Describe the output and where it lands.
- **R18 · The landing page carries the hero, one diagram and one closing block.**
  Nothing else. The application cards live on the long-form page, and the landing
  page reaches them through the close and through the navigation.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-11: **leave the cards as they
      are.** No status text. The `Open` door on the two applications reachable in a
      browser stays the only signal, as it is today.

      **Amended 2026-09-12**, and the second half of the original answer is now wrong.
      It said the cards should avoid "describing an unbuilt application as though it
      were finished". They should do exactly that, because the page ships when the work
      does. A door is a working hyperlink and four of the six have nothing to link to
      yet; that is a fact about the markup, not a statement in the copy. No card says
      or implies that anything is unfinished.
- [x] **A2 · product/UI · blocking** — answered 2026-09-11: **keep the mockups, fix the
      alt text.** No real survey imagery or species identifications go onto a public page,
      and nothing has to be recaptured when a UI moves. The alt text stops calling a
      running application a concept.
- [x] **A3 · scientific · non-blocking** — taken on the stated default 2026-09-11: the
      page stays qualitative, no figure is invented.
      Original question: — May the page state any quantity at all? The
      story rests on *a survey happens in a day, the science can take months*, which is
      your sentence from the issue. If there is a figure MARP can stand behind — hours of
      video per survey day, a typical turnaround today — it would give the opening
      something concrete. **Default if you say nothing: the page stays qualitative.** I
      will not invent a number.
- [x] **A4 · product/UI · non-blocking** — taken on the stated default 2026-09-11: the
      strip goes, its one true idea folds into the architecture section.
      Original question: — The capability strip near the bottom — *Secure
      API · Connected Data · Scalable Compute · Reusable Services* — fails R8 harder than
      anything else on the page; all four could be lifted onto a defence contractor's site
      unchanged. **Default: delete the strip and fold its one true idea** — everything
      works from one API and one data model — **into the architecture section.** Say if
      you want it kept.
- [x] **A5 · architectural · non-blocking** — taken on the stated default 2026-09-11:
      both checks get written.
      Original question: — The entry app has no tests at any tier; it
      is the only app here that does not. **Default: add two small ones** — a render check
      (Playwright, desktop and phone: the page serves, every nav anchor resolves to a real
      section, no asset 404s, the login dialog opens and closes) and a fast text check
      that fails on the R8 word list, so the next person to edit this page cannot quietly
      put *seamless* back. Say if you would rather ship the page with no tests.

## Decisions

- **2026-09-11** — Files in scope: `frontend/apps/entry/index.html`,
  `frontend/shared/assets/css/landing.css`, `frontend/shared/assets/js/landing.js`, and
  `frontend/apps/entry/README.md`, whose description of the page is already stale. Nothing
  else links `landing.css`, so it can be restructured freely.
- **2026-09-11** — Anything new is drawn in SVG and CSS, the way the hero waves and the
  platform map already are. No new binary assets beyond whatever A2 settles.
- **2026-09-12** — `Explore. Inform. Protect.` **goes**, from both pages. This reverses
  the decision below, and the reason is a fact I did not have: **it is MARE's tagline,
  not MARP's.** So it is an R9 failure rather than a matter of taste. R9 says MARP
  stands on its own merits, and closing on the parent organisation's line is exactly
  what that rule exists to prevent, even though the word MARE never appears on the
  page. The reviewer reached the same conclusion from the other direction, that it
  could sit on any environmental technology site.

  What replaces it may not be a rework of explore/inform/protect. Three imperative
  verbs would be the same borrowed line with the serial numbers filed off, and a
  rule-of-three besides, which R14 already forbids. It ends on MARP's own claim: the
  time between an ocean survey and usable scientific understanding.

- **2026-09-11** — ~~`Explore. Inform. Protect.` stays. It is the page's own voice
  rather than borrowed marketing, and it passes R8.~~ Overturned 2026-09-12, above.
  Recorded rather than deleted because the mistake is instructive: I judged a line to
  be MARP's own voice by reading it, when whose voice it was is a fact about the
  organisation that only the human had.
- **2026-09-11** — The platform map survives as a diagram and moves down the page, so it
  arrives as evidence for an outcome the visitor already understands rather than as
  something to decode first. Per the issue's *Architecture should appear after the visitor
  understands why it matters*.
- **2026-09-11** — Settled mid-implementation, by the human, after seeing the
  first draft rendered:
  - **The transplant test has a second half.** *"If it sounds like it could have
    come from Salesforce, Palantir, Raytheon, or some random AI startup, delete
    it and try again."* Added to #152 as a comment, and now R8.
  - **Avoid the AI writing patterns**, specifically em dashes, rules of three,
    and "it is not this, it is that". Now R14. The whole first draft was
    rewritten for it.
  - **The page is too long for a landing page.** Split, with a learn-more band
    handing off to a second page. Now R15, and `/how-it-works` in `app.js`.
  - **The video player belongs in the long-form page.** Now R16.
- **2026-09-11** — A sixth application card, the **Stereo Sizing Tool**, added on
  the human's instruction. It is a concept like the Data Processing Workspace and
  Automated Report Generation, so it carries no `Open` door. Two consequences:
  the grid drops from five across to three, because six across leaves about
  190px per card and the body copy will not sit in that; and the card has no
  photographed mockup, so its concept interface is **drawn as an SVG in the
  markup** rather than shipped as another `.webp`, following the decision above
  about new visuals. The reference product it is modelled on is not named on the
  page, per R9.
- **2026-09-12** — Second round of shortening, on the human's instruction after
  seeing the split page rendered. The landing page was still too long at 3,536px.
  The application cards moved to the long-form page and the two closing sections
  became one, taking it to 2,553px. Now R18.
- **2026-09-12** — The Stereo Sizing card is named for what it produces rather
  than for a tool somebody drives, and its copy and its drawn mockup both stopped
  describing a person picking points. The human's reason is the one that matters:
  the picking is expected to be done by a model, inside the same workflow, so a
  card that describes the manual interaction would be publishing a process MARP
  intends to replace. Now R17.
- **2026-09-12** — `.platform-map` clips at phone width. The orbit rings around
  the hub are square elements rounded to circles **and they spin**, so their
  layout box grows by up to root two as they turn: a 270px hub becomes a 394px
  box in a 390px viewport and scrolls the whole page sideways. Pre-existing, and
  intermittent enough that it measured clean twice before it was caught. The
  render tier's no-sideways-scroll assertion is what holds it now.
- **2026-09-11** — Each page carries its own icon sprite, holding only the
  symbols it draws. The alternative was one shared sprite through
  `partials.js`, which fetches and assigns `innerHTML`: a `<use>` resolved
  before that lands renders nothing, silently. Five symbols that only the
  deleted workflow and capability strip used are gone.

## Plan

Two pages now, not one (R15).

**`/` — `frontend/apps/entry/index.html`**

1. **Hero** — the gap, stated. Keeps the diver photograph, the logo and the wave.
2. **What MARP changes** — two lanes of the same five stages, queued against
   overlapping. The one diagram this page gets (R2, R3).
3. **Close** — one block doing two jobs: `Explore. Inform. Protect.`, the
   outcome the page opened on, and the door to the long-form page. The handoff
   band and the call to action were two sections saying the same thing in
   sequence, and the page did not have the room (R18).

**`/how-it-works` — `frontend/apps/entry/how-it-works.html`**

1. **Compact header**, not a second hero.
2. **Where the months go** — the three friction cards.
3. **A system that can do anything has to be told everything** — R4.
4. **Underneath** — the capability diagram as evidence, plus the single-record
   paragraph (R1, and A4's folded-in idea).
5. **Going back one frame** — the video player (R16).
6. **Biologists lead. MARP amplifies.** — R5 and R6.
7. **Applications** — the six cards, moved here off the landing page (R18).
8. **Close** — login, API docs, developer docs.

Then: `landing.css` loses section 6 (the five numbered boxes) and section 9 (the
capability strip), and gains the lanes, the explainer, the pull quote, the
compact page header and the handoff band. The README is rewritten. A5's two
checks are added.

## Acceptance criteria

- A reader who scrolls the page once can answer the eight questions in the issue's
  *Acceptance direction* without reading it twice.
- No sentence on the page survives the R8 transplant test, `<title>` and `<meta>`
  included.
- `Collect -> Review -> Process -> Assist -> Deliver` is not on the page in any renaming.
- Login, `/api-docs`, `/developer-docs` and both live application doors still work from
  the rewritten page.
- The page holds together at phone width with no horizontal scroll.
- Every application card says something true about that application's actual state.

## Test plan

Filled at G3, after the gate.

## Status

- **Gate:** ready-for-pr
- **Notes:** All five assumptions settled 2026-09-11. A1 and A2 both came back
  conservative — the application cards keep the shape they have, and no real survey
  imagery goes on a public page. That leaves the rewrite where the issue wanted it: a
  story, hierarchy and copy problem rather than a redesign.
