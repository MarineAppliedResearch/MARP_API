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
thousand pixels. It is 2,553 now, and that took two rounds of cutting rather than
one. Anything that explains rather than pitches belongs on `how-it-works.html`,
which is allowed to be as long as it needs.

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
- **No invented figures.** The page is qualitative on purpose. A survey takes a
  day and the science can take months are the human's own words; nothing else is
  quantified, and nothing should be added without a number somebody can stand
  behind.
- **No claim the repository cannot support**, and what MARP does today stays
  distinguishable from the direction it is built for.
- **MARE appears nowhere.** MARP stands on its own.

## Machine learning is not the headline

MARP is not interesting because it contains models. It is interesting because of
what happens to the time between collecting data and understanding it. ML belongs
inside the review story, where a detection is a proposal and a biologist decides.
`Biologists lead. MARP amplifies.` stays.

## The application cards

On `how-it-works.html`. Six cards, in two rows of three. Two of the applications run in the browser here
and carry an `Open` door; the rest are concepts and do not. That door is the only
status marker on the card, deliberately (#152, A1). The card images are mockups
and stay mockups: a screenshot of the Picture Mosaic Reviewer would put real
survey imagery and real species identifications on a public page (#152, A2). The
alt text says `Concept interface` only for the ones that are concepts.

**The Stereo Sizing card has no photographed mockup.** Its concept interface is
drawn in the markup as an SVG and styled by the `.card-mock__*` rules, rather than
shipped as another `.webp`. Anything else added to this section without a
screenshot should be drawn the same way.

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
