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
- **R10 · No claim this repository cannot support, and no invented figure.** What MARP
  does today is distinguishable from the direction the architecture is built for.
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
- **R16 · The video player gets a section on the long-form page.** Frame-accurate
  review forwards and backwards, and why a browser cannot do it on its own. The
  claims come from `marp-video-player`'s own README, not from invention.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-11: **leave the cards as they
      are.** No status text. The `Open` door on the two applications that run in the
      browser stays the only signal, as it is today. So R7's "honest about what exists"
      is satisfied by the door and by not describing an unbuilt application as though it
      were finished — not by a status badge.
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
- **2026-09-11** — `Explore. Inform. Protect.` stays. It is the page's own voice rather
  than borrowed marketing, and it passes R8.
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
3. **Applications** — the cards, unchanged in shape (A1, A2).
4. **Keep reading** — the handoff band.
5. **Close** — `Explore. Inform. Protect.`, login, API docs, developer docs.

**`/how-it-works` — `frontend/apps/entry/how-it-works.html`**

1. **Compact header**, not a second hero.
2. **Where the months go** — the three friction cards.
3. **A system that can do anything has to be told everything** — R4.
4. **Underneath** — the capability diagram as evidence, plus the single-record
   paragraph (R1, and A4's folded-in idea).
5. **Going back one frame** — the video player (R16).
6. **Biologists lead. MARP amplifies.** — R5 and R6.
7. **Close** — back to the applications, login, developer docs.

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
