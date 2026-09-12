# MARP public landing page

The public face of MARP. Two documents, one stylesheet, one script.

| File | Served at | Job |
| --- | --- | --- |
| `index.html` | `/` | Short. The problem, one diagram, one closing block. Nothing else. |
| `how-it-works.html` | `/how-it-works` | Long. The whole argument, for somebody who wants it. |

Both routes are registered in `app.js`; the shared assets come from
`frontend/shared/assets/` and are reached as `/assets/...`.

Run the API and open the site root. There is no separate build, no bundler and
no static-server step: these are plain documents that the API serves.

## Why there are two pages

The landing page used to carry the whole story and ran to about six and a half
thousand pixels. Getting it down to roughly a third of that took three rounds of
cutting rather than one. Anything that explains rather than pitches belongs on
`how-it-works.html`, which is allowed to be as long as it needs.

**The application cards are on the long-form page, not here.** That is deliberate
and it is the second thing somebody will want to undo. The landing page reaches
them from the closing block and from the `Applications` item in the navigation,
and `tests/landing-copy.test.js` fails if both of those ever go away, because
removing them would strand every application behind a page nothing links to.

## What governs the writing

Settled in #152, and it is the part most likely to be undone by accident.

- **The problem comes before the mechanism.** The first screenful is about the
  gap between how fast a survey collects data and how long the science takes.
  The architecture diagram and the application cards are evidence, and they sit
  below it.
- **The transplant test.** If a sentence could be moved to Salesforce, Palantir,
  Raytheon or an AI startup's site with only the product name changed, it is
  rewritten. `tests/landing-copy.test.js` holds the word list that came out of
  that, and it runs in CI.
- **No em dashes, no rule-of-three lists, and no "it is not this, it is that."**
  Those are the patterns that make a page read as machine-written.
- **Contrast only with what really happens.** Setting MARP against an
  alternative works only when the alternative is what people actually do today,
  because that is the only comparison a reader recognises. The worked example is
  `a biologist opens a screen of candidates rather than an empty one`, which was
  cut: nobody was ever going to open an empty screen, so the sentence invented an
  alternative that was never on the table and then credited MARP with avoiding
  it. That is the `it is not X, it is Y` tic above, wearing `rather than`
  instead. The contrasts that survive on these pages all pass the test, because a
  normal player really does land near the frame, overwriting a decision really is
  the usual thing to do, reviewing one observation at a time really is the old
  way of working, and a general tool really does have to be configured first. If
  a reader would not have imagined the alternative unprompted, delete it and
  state the thing plainly.
- **Short paragraphs.** Two or three sentences and then a break, everywhere on
  both pages. A `.section-heading__summary` may be several of them stacked, and
  `.explainer` is a two-column block that wants short ones. What is banned is the
  shape rather than the length: a heading stating an idea, a paragraph explaining
  it, then a third explaining the explanation. Cut the third, keep the first two.
  **This is not a licence to cut `/how-it-works` down.** That page exists to show
  what MARP actually has, and its substance is wanted. Only the landing page is
  short.
- **No invented figures.** The page is qualitative on purpose. A survey takes a
  day and the science can take months are the human's own words; nothing else is
  quantified, and nothing should be added without a number somebody can stand
  behind.
- **MARE appears nowhere.** MARP stands on its own, and that reaches further
  than the word: `Explore. Inform. Protect.` was MARE's tagline and closed both
  pages until it was noticed. A borrowed line is the same failure as a borrowed
  name.
- **The claim is turnaround, and only turnaround.** A dive happens and the
  reviewed science comes back fast. MARP is never described as working while the
  vehicle is in the water, in any paraphrase: not `as the data arrives`, not
  `in real time`, not `during the dive`, not `while the survey is still running`.
  The hero's contrast is the page's whole argument, and MARP compresses the gap
  between the two rather than removing it or moving the work underwater. This
  wrong version arrived from three directions at once during #152's review
  because it reads well, which is why `tests/landing-copy.test.js` now stands in
  front of it.
- **MARP is written as finished and working.** Present tense, declarative, no
  hedging anywhere: not `is being built`, not `is designed to`, not `will`. This
  page ships when the thing it describes is done, so it is written from that
  side of the line and the applications are included in that. Two of the six are
  served from here and carry an `Open` door; the other four have nothing to link
  to yet, and that missing door is the only place it shows.

## What MARP does for the person doing the work

The lanes section on the landing page is about a biologist's working week, and
getting that wrong is the fastest way to lose the reader it is written for.

**MARP removes the drudgery, never the human.** The repetitive part stops
consuming somebody's weeks: trawling frame by frame for candidates, lining video
up with navigation, the same mechanical pass over and over. What is left is the
judgement, which is the part that needed a biologist in the first place. So the
job stays one a person can keep doing well for years, and the survey turns into
science sooner for exactly that reason.

A biologist reading this page should recognise their own week getting better. A
draft framed the same change as *some of it goes to the machines*, tagged two
lane stages `Automated`, and said two of them stop being anybody's afternoon.
All three made machines the subject of the sentence and the biologist the
leftover, which is the Raytheon voice R8 exists to catch, arriving through the
back door. Write what the scientist gets.

Watch the other ditch too. `Humane` and `sustainable` are the ideas, and neither
word has to appear; if the copy starts sounding like a human-resources page it
has failed R8 just as surely.

## Machine learning is not the headline

MARP is not interesting because it contains models. It is interesting because of
what happens to the time between collecting data and understanding it. So the
section says what models do for the work and what biologists do with the result,
in two sentences: models make the first pass, biologists make the result
trustworthy, and the reviewed data improves the next models.

`Biologists lead. MARP amplifies.` used to close that section and no longer
appears. It was replaced in the final wording pass, which asked for the same idea
said shorter and with the training feedback in it.

**Two claims in that section were wrong on the public page and must not come
back.** Both are scientific statements and both were corrected in #152's review.

- **Never say a person cannot watch every frame.** People do watch the video, and
  that is precisely why a project takes as long as it does. The honest point is
  that human review grows with every hour of imagery collected and it is expert
  time being spent.
- **Never say a model's output is not an observation.** It is.
  `service/observation-ingest.service.js` writes model findings as real
  `observations` rows, marked by provenance rather than by a different shape. The
  distinction that matters is scientific **acceptance**, which is an
  `observation_reviews` row belonging to a named reviewer, and its absence is what
  unreviewed means.

**Keep models out of the villain role too.** No `poison the record`, no `nobody
should trust a machine`. Models can be very accurate and very useful, and the
page states the positive rule: models propose and accelerate, qualified people
remain authoritative for acceptance and interpretation.

## The application cards

On `how-it-works.html`. Six cards, in two rows of three, and **every one of them
describes a working application.** Two are served from here and carry an `Open`
door; the other four have nothing to link to yet. That door is the only status
marker on the card, deliberately (#152, A1), and it is a functional fact about
the markup rather than a hedge in the copy. Do not invent a URL for the four, do
not add text explaining why they have no door, and do not put `Concept interface`
back into the alt text.

The card images are mockups and stay mockups: a screenshot of the Picture Mosaic
Reviewer would put real survey imagery and real species identifications on a
public page (#152, A2).

**The Stereo Sizing card has no photographed mockup.** Its interface is drawn in
the markup as an SVG and styled by the `.card-mock__*` rules, rather than shipped
as another `.webp`. Anything else added to this section without a screenshot
should be drawn the same way.

**A card says what comes out of an application, never how a person operates it.**
This one said "pick the same two points in both cameras" and that was wrong to
publish: the picking is expected to be done by a model, inside the same workflow,
so the card would have been describing a process MARP intends to replace. The
drawn mockup follows the same rule, which is why it shows a measurement bracket
rather than a cursor placing points.

## Traps

- **The reveal animations are IntersectionObserver-driven.** Everything marked
  `data-reveal` starts at `opacity: 0` and is revealed when it scrolls into view.
  Anything that captures or tests the page has to scroll slowly enough for the
  observer to deliver, or it photographs a blank document. About 300px per 140ms
  works; faster does not.
- **Each page carries its own icon sprite**, holding only the symbols it draws.
  Adding a `<use>` to one page without adding its `<symbol>` renders nothing at
  all, silently. `tests/landing-copy.test.js` checks both directions.
- **`.hero h1 span` runs white to green across 72% to 92% of its own width**, so
  a short span puts the colour break in the middle of a word. Give it a whole
  line.
- **The hero has to fit a SHORT screen, not just a narrow one.** `.hero` carried
  `min-height: max(760px, 100svh)`, which floors it at 760px however short the
  viewport is. A phone held sideways is about 340px tall, so the whole first
  screen was the header and an empty photograph: the headline, the paragraph and
  both buttons were below the fold, and it read as a page that had failed to
  load. The corrections live in section 13b and are keyed on `max-height`, so
  they **must stay after every width-keyed block** or the phone-width rules win
  at equal specificity and put it back. The `phone-landscape` project and the
  first-screen assertion in the render tier exist for exactly this.
- **`.platform-hub` is used in two different grids now**, the capability diagram
  on the long page and the lanes on the landing page, so any rule about its
  placement has to be scoped to `.platform-map`. An unscoped
  `.platform-hub { grid-area: hub }` inside a media query reached the lanes copy
  as well, and because `.lanes` has no area called `hub` the browser invented
  tracks for it and crushed both lanes to 43px. It looked like a broken layout
  and was a leaked selector.
- **The hub label sits inside the circle at `bottom: 13%`**, so a second line
  grows upward into the mark. The map's hub is wide enough for
  `One connected dataset.`; the smaller one in the lanes is not, which is why it
  says `Stays connected.` and is pinned `nowrap`. Both labels used to lean on
  `one record`, which is catchy and not what MARP is: it is a relational
  scientific dataset with connected entities and provenance, and the metaphor was
  becoming a claim about the data model that is false.
- **The lanes diagram is the only thing that says MARP is quicker.** `--from`,
  `--span` and `--at` on each stage are the drawing, on a shared 24-column track:
  the queued lane lays five stages end to end across the whole width, the MARP
  lane starts them earlier, runs them shorter and overlaps them, and both end on
  a check. Keep `--from` plus `--span` at or below 25, or a bar runs past the last
  column into implicit tracks and silently comes out short.

  Two rules about it, and both were learned rather than chosen. **No copy repeats
  what the drawing says.** There is no fraction, no multiplier and no note
  underneath explaining how to read it; a version that needed such a note was what
  #152's review objected to, and a caveat apologising for a diagram means the
  diagram needs another pass. **`Collect` is drawn identically in both lanes.** A
  dive takes as long as a dive, and a MARP bar creeping under the `Collect` bar
  above claims the work happens while the vehicle is still down, which is the one
  thing this page must never say.
- **The orbit rings on the capability diagram are spinning squares.** They are
  square elements rounded to circles, so a rotation grows their layout box by up
  to root two. At phone width that pushed the whole page sideways, which is why
  `.platform-map` clips below 680px. It measured clean twice before it was
  caught, so trust the render tier rather than a spot check.
- **`app.js` is server-side**, so a running server does not pick up a new route
  until it is restarted. `express.static` re-reads these HTML files per request,
  which makes the asymmetry easy to misread as a broken route.

## Login

The dialog posts to `POST /api/v2/auth/login` with `credentials: same-origin`
and, on success, redirects to `/apps/dashboard/index.html`. The error path reads
the standard `{ error: { message } }` envelope, so a wrong password, an unknown
username and a rate-limited attempt all surface the server's own wording. See
`frontend/shared/assets/js/landing.js`.

`old_index.html` is the page this replaced. It is kept for reference and is not
served.
