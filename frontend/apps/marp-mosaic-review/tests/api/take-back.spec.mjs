/**
 * The one tier that runs against a real MARP API (#132, R14).
 *
 * **Why this file exists at all.** Every other browser test navigates with
 * `?backing=fixture`, and the fixture is not a small API — it is a different one. It holds
 * the mosaic in memory and *writes the row's own status column in place* when a page is
 * committed. The endpoint never does that: a decision is a projection row, the mosaic row is
 * served from a cache, and a commit deliberately invalidates nothing. So a defect that lives
 * in the gap between "what the commit recorded" and "what the row still says" cannot be
 * observed on the fixture at any tier. #130, #124's F6 and #124's F8 were all that shape.
 *
 * A8's first answer to this was a better fake. That was reversed on 2026-09-11 — *"if the
 * fixture doesn't trigger the error and the actual system does, that doesn't make any
 * sense"* — and the reversal is why nothing in here simulates anything.
 *
 * **It writes to a real database, so it puts back what it changed.** The only database
 * available is the development corpus: three GPU inference runs over real dives, real
 * thumbnails, and real review decisions that are the evidence behind recorded walkthroughs,
 * with no dump to restore from until #125. So the arrangement below is deliberately narrow:
 *
 * - it touches **one observation**, chosen because it is the only one of its species, which
 *   makes the page it lands on hold exactly that row and nothing else — a page sweep here
 *   writes one decision rather than fifty;
 * - it records that observation's decision before it starts and restores it in a `finally`,
 *   through the same API, so a failed assertion still puts the record back;
 * - it refuses to run at all if the observation it picked is not the whole page, rather than
 *   quietly committing rows it never inspected.
 *
 * Run it with the API serving this app:
 *
 *   MARP_API_BASE=http://localhost:<port> npx playwright test --project=api
 */
import { test, expect } from '@playwright/test';

/**
 * A species with exactly one observation in the corpus, so the mosaic page it produces
 * holds exactly one row.
 *
 * **Not a fact about MARP** — it is read back and checked below, and the test fails with an
 * explanation rather than committing a page it did not expect. Any single-observation
 * species would do; `mosaic/observations/facets` reports the counts.
 */
/**
 * **Nothing here pins a fact about the data.**
 *
 * This was `const LONE_SPECIES = 622` -- the one species with a single observation when
 * this file was written. Seven CAMPA2026 dives landed the same night and it had seven, so
 * the guard below fired and the test refused to run. It was right to refuse; it was wrong
 * to have hard-coded the thing that changed.
 *
 * The isolating filter is discovered from the facets instead, every run. `species` alone no
 * longer isolates anything, so it is paired with `line` -- **not `dive`**, because a dive
 * name repeats across projects (`Dive 12` is in CAMPA2024 and CAMPA2026, and the facet
 * count is their sum) while a line belongs to one session.
 */
async function facetsFor(request, filters) {
  const res = await request.post('/api/v2/mosaic/observations/facets', { data: { filters } });
  expect(res.ok(), `the facets query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  return (await res.json()).facets;
}

/**
 * A `{ species, line }` pair holding exactly one observation, or a failure saying so.
 *
 * One request per line, and the species counts inside that line come back with it -- so
 * this is a handful of requests rather than a sweep of every combination.
 */
async function discoverLoneRow(request) {
  const { line } = await facetsFor(request, {});

  for (const candidate of line) {
    const inLine = await facetsFor(request, { line: [candidate.value] });
    const only = (inLine.species || []).find((sp) => sp.count === 1);
    if (only) return { species: only.value, line: candidate.value, label: only.label };
  }

  /* Fail rather than skip. A skipped test looks green, and this is the only tier that can
     see the defect at all -- so its absence has to be loud. */
  throw new Error(
    'No species has exactly one observation within a single line, so there is no page this '
    + 'test can sweep without writing rows it never inspected. Add an observation, or narrow '
    + 'the page another way.'
  );
}

/** The reason the setup flag carries. One of Scientific's own, so the record says why. */
const SETUP_REASON = 'Other / unsure';

/** Ask the mosaic for the page this test acts on. */
async function lonePage(request, lone) {
  const res = await request.post('/api/v2/mosaic/observations/pages', {
    data: {
      filters: { species: [lone.species], line: [lone.line] },
      sort: [{ field: 'confidence', dir: 'asc' }],
      pageSize: 45,
      pages: [1],
      includeTotal: true
    }
  });
  expect(res.ok(), `the mosaic query was refused: ${res.status()} ${await res.text()}`)
    .toBeTruthy();
  const body = await res.json();
  return { total: body.total, rows: body.pages[0].rows };
}

/** Commit one observation, marked or not, and fail loudly on a refusal. */
async function commitOne(request, row, { marked = false, withdraw = false, reason = SETUP_REASON } = {}) {
  const data = {
    observations: [{ observation_id: row.observation_id, version: row.version }],
    marks: marked
      ? [{ observation_id: row.observation_id, reason, kind: 'except' }]
      : []
  };
  if (withdraw) data.withdraw = [row.observation_id];

  const res = await request.post('/api/v2/mosaic/observations/review', { data });
  expect(res.ok(), `the commit was refused: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

test('R8: a recorded take-back stops saying TAKING BACK', async ({ page, request }) => {
  const lone = await discoverLoneRow(request);
  const before = await lonePage(request, lone);

  /* Still refuse rather than widen. The facets and the page are two queries, and the corpus
     can grow between them -- a GPU run was writing to it while this file was being written.
     So the page is checked, not assumed, and the sweep below never commits a row this test
     did not look at. */
  expect(before.total,
    `species ${lone.species} on line ${lone.line} (${lone.label}) is no longer one `
    + 'observation, so a page sweep here would write rows this test did not inspect.')
    .toBe(1);

  const row = before.rows[0];
  /* An accepted tile needs a picture — "reviewed" means somebody looked at it — so a row
     whose thumbnail never arrived cannot be swept to `reviewed`, and the take-back would
     then fail to clear for a reason that is not this defect. */
  expect(row.thumbnail_status,
    `observation ${row.observation_id} has no picture, so a sweep would skip it`)
    .toBe('ready');

  /* What the record said before this test touched it, so the `finally` can put it back. */
  const original = { decision: row.review_decision, reason: row.flag_reason };

  try {
    /**
     * **The record has to carry the flag, not this sitting.**
     *
     * That is the whole precondition, and it is what the fixture cannot arrange honestly.
     * `takingBack` falls back to the row's own status column, and under the API that column
     * is only ever what the *database* said when the page was fetched — so a flag created by
     * clicking and committing here would leave it null and the defect would not arise. The
     * flag is written through the API first, and the page is then loaded fresh.
     */
    await commitOne(request, row, { marked: true });
    const flagged = await lonePage(request, lone);
    expect(flagged.rows[0].review_decision).toBe('flagged');

    /* Species and line together are the whole question, so the page holds this row alone.
       Scientific opens on `['unreviewed', 'flagged']`, so a flagged row is in view. */
    await page.goto(`./?species=${lone.species}&line=${lone.line}`);

    /* This tier grades the API, and says so. If the fixture flag ever leaks in here, or the
       page stops announcing which backing it is on, this fails rather than a real-database
       assertion quietly passing against an in-memory fake. */
    await expect(page.locator('html')).toHaveAttribute('data-backing', 'api');
    await expect(page.locator('#backingFlag')).toHaveCount(0);

    const tile = page.locator(`.tile[data-id="${row.observation_id}"]`);
    await expect(tile).toBeVisible();
    await expect(page.locator('.tile')).toHaveCount(1);

    /* The page arrives with the record's exception already marked (`page.seedMarks`). */
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');

    /* Take it back: the mark comes off, nothing is written yet, and the record still says
       flagged — which is exactly what TAKING BACK means. */
    await tile.click();
    await expect(tile).not.toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('TAKING BACK');

    /* The sweep accepts everything unmarked, so it records this one as reviewed. */
    await page.locator('#commit').click();

    /**
     * **And the badge must stop claiming the take-back is pending.**
     *
     * This is the assertion the whole file is for. With `takingBack`'s `||` restored —
     * `(outcome === exception || existing === exception)` — the commit lands, the outcome
     * says `reviewed`, and the stale row still says `flagged`, so the tile goes on offering
     * to take back something already on the record for the rest of the sitting.
     */
    await expect(tile.locator('.badge')).toContainText('REVIEWED');
    await expect(tile.locator('.badge')).not.toContainText('TAKING BACK');
    await expect(tile).not.toHaveClass(/out-reverted/);

    /* And the record agrees, read back from the endpoint rather than off the screen. */
    const after = await lonePage(request, lone);
    expect(after.rows[0].review_decision).toBe('reviewed');
  } finally {
    /**
     * Put the record back, through the API, whatever happened above.
     *
     * `withdraw` deletes the projection row, and the absence of a row *is* undecided — so an
     * observation nobody had decided about goes back to nobody having decided about it. The
     * decision log keeps its entries by design; that is the endpoint's contract, not this
     * test leaving something behind.
     */
    const current = (await lonePage(request, lone)).rows[0];

    if (original.decision == null) {
      await commitOne(request, current, { withdraw: true });
    } else if (original.decision === 'flagged') {
      /* The reason belonged to the decision, so it goes back with it. */
      await commitOne(request, current, { marked: true, reason: original.reason });
    } else {
      await commitOne(request, current);
    }

    const restored = (await lonePage(request, lone)).rows[0];
    expect(restored.review_decision,
      `observation ${current.observation_id} was left as ${restored.review_decision} `
      + `instead of ${original.decision}`).toBe(original.decision);
    expect(restored.flag_reason).toBe(original.reason);
  }
});
