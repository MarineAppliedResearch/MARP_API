/**
 * Finding one row in a real corpus, and putting it back.
 *
 * Extracted from `take-back.spec.mjs` when #135 gave it a second and a third test. It is
 * **not** a `.spec` file, so Playwright's default `testMatch` leaves it alone.
 *
 * Everything here exists to keep the API tier's three rules (see that app's `CLAUDE.md`,
 * *The API tier*): touch as few rows as the assertion needs and **check** that you are
 * touching what you think, restore what you changed through the API in a `finally`, and
 * never pin a fact about the data.
 *
 * **Nothing here hard-codes a species, a line or an observation.** This was
 * `const LONE_SPECIES = 622` once -- the one species with a single observation on the day
 * it was written -- and seven CAMPA2026 dives landed the same night and it had seven. The
 * isolating filter is discovered from the facets on every run instead.
 */
import { expect } from '@playwright/test';

/** The reason a setup flag carries. One of Scientific's own, so the record says why. */
export const SETUP_REASON = 'Other / unsure';

/** The commit route each mode writes through. Delete takes no withdrawal and is not here. */
const ROUTE = { scientific: 'review', training: 'training' };

/** Which columns on the mosaic row a mode's decision and reason arrive in. */
const COLUMNS = {
  scientific: { decision: 'review_decision', reason: 'flag_reason' },
  training: { decision: 'training_decision', reason: 'exclusion_reason' }
};

/** Ask the facets endpoint, and fail loudly rather than returning nothing. */
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
 * this is a handful of requests rather than a sweep of every combination. `line` and not
 * `dive`, because a dive name repeats across projects (`Dive 12` is in CAMPA2024 and
 * CAMPA2026, and the facet count is their sum) while a line belongs to one session.
 */
export async function discoverLoneRow(request) {
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

/** Ask the mosaic for the page a lone row lands on. */
export async function lonePage(request, lone) {
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

/**
 * Commit one observation through a mode's own route, and fail loudly on a refusal.
 *
 * `kind` is the mark: `except` flags or excludes, `accept` reviews or promotes on its own,
 * and no mark at all means the sweep's acceptance. `withdraw` takes the decision off.
 */
export async function commitOne(
  request, mode, row, { kind = null, withdraw = false, reason = SETUP_REASON } = {}
) {
  const data = {
    observations: [{ observation_id: row.observation_id, version: row.version }],
    marks: kind ? [{ observation_id: row.observation_id, kind, reason: kind === 'except' ? reason : null }] : []
  };
  if (withdraw) data.withdraw = [row.observation_id];

  const res = await request.post(`/api/v2/mosaic/observations/${ROUTE[mode]}`, { data });
  expect(res.ok(), `the commit was refused: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * The page, checked to be the one row this test is allowed to write to.
 *
 * The facets and the page are two queries and the corpus can grow between them -- a GPU run
 * was writing to it while this file's ancestor was being written -- so the page is checked
 * rather than assumed, and a sweep never commits a row the test did not look at.
 */
export async function claimLoneRow(request, mode) {
  const lone = await discoverLoneRow(request);
  const { total, rows } = await lonePage(request, lone);

  expect(total,
    `species ${lone.species} on line ${lone.line} (${lone.label}) is no longer one `
    + 'observation, so a page sweep here would write rows this test did not inspect.')
    .toBe(1);

  const row = rows[0];
  /* An accepted tile needs a picture -- "reviewed" means somebody looked at it -- so a row
     whose thumbnail never arrived cannot be swept at all, and an assertion about a
     take-back would then fail for a reason that is not the defect. */
  expect(row.thumbnail_status,
    `observation ${row.observation_id} has no picture, so a sweep would skip it`)
    .toBe('ready');

  const columns = COLUMNS[mode];
  return {
    lone,
    row,
    /* What the record said before this test touched it, so `restore` can put it back. */
    original: { decision: row[columns.decision], reason: row[columns.reason] }
  };
}

/**
 * Put the record back, through the API, whatever happened above. Call it in a `finally`.
 *
 * `withdraw` deletes the projection row, and the absence of a row *is* undecided -- so an
 * observation nobody had decided about goes back to nobody having decided about it. The
 * decision log keeps its entries by design; that is the endpoint's contract, not this test
 * leaving something behind.
 */
export async function restore(request, mode, { lone, original }) {
  const columns = COLUMNS[mode];
  const current = (await lonePage(request, lone)).rows[0];
  const exception = mode === 'training' ? 'excluded' : 'flagged';

  if (original.decision == null) {
    await commitOne(request, mode, current, { withdraw: true });
  } else if (original.decision === exception) {
    /* The reason belonged to the decision, so it goes back with it. */
    await commitOne(request, mode, current, { kind: 'except', reason: original.reason });
  } else {
    await commitOne(request, mode, current, { kind: 'accept' });
  }

  const restored = (await lonePage(request, lone)).rows[0];
  expect(restored[columns.decision],
    `observation ${current.observation_id} was left as ${restored[columns.decision]} `
    + `instead of ${original.decision}`).toBe(original.decision);
  expect(restored[columns.reason]).toBe(original.reason);
}

/** What a mode's decision column says right now, read back from the endpoint. */
export async function decisionNow(request, mode, lone) {
  const current = (await lonePage(request, lone)).rows[0];
  return current[COLUMNS[mode].decision];
}
