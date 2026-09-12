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

## Open assumptions

- [ ] **A1 · product/UI · blocking** — What is true about each of the five applications,
      and should the page say so on the card? Today all five look alike except that two
      carry an `Open` door. As far as this repository can tell there are three different
      states, not two: **Picture Mosaic Reviewer** and **Machine Learning Dashboard** run
      in the browser here; the **Video Annotation Tool** is `VIDEO_PROCESSING_GUI`, a real
      Windows desktop client in daily use but not reachable from a browser; **Data
      Processing Workspace** and **Automated Report Generation** do not exist yet. R7 and
      R10 both turn on this. Is that description right, and do you want each card to state
      its status plainly?
- [ ] **A2 · product/UI · blocking** — The five card images are mockups, and their alt
      text calls them *"Concept interface"* — including for the two applications that are
      now real. I can capture real screenshots of the Mosaic Reviewer and the ML Dashboard
      from the running server. **But a screenshot of the Mosaic Reviewer shows real survey
      imagery and real species identifications on a public page**, which is your call and
      not mine. Real screenshots, or keep the mockups and fix the alt text?
- [ ] **A3 · scientific · non-blocking** — May the page state any quantity at all? The
      story rests on *a survey happens in a day, the science can take months*, which is
      your sentence from the issue. If there is a figure MARP can stand behind — hours of
      video per survey day, a typical turnaround today — it would give the opening
      something concrete. **Default if you say nothing: the page stays qualitative.** I
      will not invent a number.
- [ ] **A4 · product/UI · non-blocking** — The capability strip near the bottom — *Secure
      API · Connected Data · Scalable Compute · Reusable Services* — fails R8 harder than
      anything else on the page; all four could be lifted onto a defence contractor's site
      unchanged. **Default: delete the strip and fold its one true idea** — everything
      works from one API and one data model — **into the architecture section.** Say if
      you want it kept.
- [ ] **A5 · architectural · non-blocking** — The entry app has no tests at any tier; it
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

## Plan

Section order, which is the part worth reacting to at this gate:

1. **Hero** — the gap, as a statement rather than a product description. Keeps the diver
   photograph, the logo and the wave graphic.
2. **The bottleneck** — why a day of collection becomes months of work. Named and
   concrete: the handoffs, the re-preparation, the waiting.
3. **The change** — the handoff chain set against stages that advance together. This is
   the visual that replaces the five numbered boxes (R2, R3).
4. **Why a narrow workflow is an advantage** — R4, written as an explanation.
5. **How that is possible** — the existing capability diagram, re-captioned as evidence.
6. **Biologists lead** — R5 and R6 together, ML placed inside the workflow.
7. **Applications** — R7, with whatever A1 settles.
8. **Close** — `Explore. Inform. Protect.`, login, API docs, developer docs.

Then: rewrite `landing.css`'s section 6 (Workflow) and 9 (capability strip) for the new
blocks, leaving sections 1–5 and 7–14 structurally alone; update the README; add whatever
A5 settles.

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

- **Gate:** design
- **Notes:** A1 and A2 are blocking and both come from the same underlying question — what
  is honestly true about the five applications, and how much of the real system is shown
  on a public page. A3, A4 and A5 have stated defaults and will not hold implementation
  up.
