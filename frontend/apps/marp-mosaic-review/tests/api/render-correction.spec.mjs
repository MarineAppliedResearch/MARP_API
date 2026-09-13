/**
 * A committed page stays editable, the correction panel, and what Delete Mode shows.
 *
 * Migrated from `tests/e2e/render.spec.mjs` when #157 retired the fixture. Every check
 * here asserts what its ancestor asserted; what changed is the thing underneath it.
 *
 * **This is the chunk with the species corrections in it**, and two consequences of a real
 * backing shape most of the file:
 *
 * - A correction is a real write. It edits the observation row, a trigger moves `version`,
 *   and it invalidates every review decision on that observation in both dimensions. The
 *   journal puts it back -- it intercepts the correction route to learn the species the row
 *   was on *before* the write, which is the one "before" a page response cannot carry.
 * - The candidate lists come from the **real species catalogue**, not the fixture's seven
 *   species. So no check here types a term somebody remembered: the term is derived from
 *   what the endpoint actually serves, and the name asserted is read back out of the same
 *   answer. `Inverts`, `urch` and `rockfish` were all facts about `src/data.js`.
 *
 * The local helpers at the bottom are the whole of that discovery. They are local because
 * `support.mjs` is shared and other agents are in it; if a second file ever wants them,
 * that is the moment to move them rather than now.
 *
 * Refs #157.
 */

import { test, expect } from '@playwright/test';

import { journal } from './journal.mjs';
import { seedPage } from './seed.mjs';
import {
  closeRail,
  expectRealBacking,
  facetsFor,
  findPageOf,
  freshTile,
  openRail,
  pageOf,
  pageSizeOf,
  ready,
  undecided
} from './support.mjs';

/** Every check in this file may commit, so every one of them puts the record back. */
let ledger = null;

test.beforeEach(({ page, request }) => { ledger = journal(page, request); });
test.afterEach(async ({ request }) => { await ledger.restore(request); });

test.describe('a committed page is still editable', () => {
  test('the flag stays marked, a click takes it back, and committing withdraws it', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    /* Still marked, so the same gesture still means the same thing. */
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');

    await tile.click();
    await expect(tile).not.toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('TAKING BACK');

    /**
     * **The second sweep withdraws it** (#135 R7), and this line used to expect `REVIEWED`.
     *
     * It was asserting the rule that the two buttons meant different things by the same
     * gesture — *Commit Marked* withdrew a take-back, the sweep accepted it. Reversed on
     * 2026-09-12: a take-back is an instruction about a tile, not a property of which
     * button reads it, so the tile ends in the vanilla state for the mode either way.
     * The sweep's own rule is untouched: everything merely *unmarked* is still accepted,
     * which is what the tile beside this one is doing.
     */
    await page.locator('#commit').click();
    await expect(tile.locator('.badge')).toHaveCount(0);
    await expect(tile).not.toHaveClass(/marked/);
  });

  test('a mark outranks what the last commit did', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('#commit').click();
    /* Pinned by id: the tile stops matching .out-reviewed the moment it is
       marked, and a positional locator would slide onto a different tile. */
    const id = await page.locator('.tile.out-reviewed').first().getAttribute('data-id');
    /* Not `freshTile`: this check is *about* a tile carrying the acceptance the sweep
       just wrote, which is the one thing a fresh tile is not. The outcome class is the
       only thing that names it, and it is pinned by id on the next line exactly as the
       original did. */
    expect(id, 'the sweep accepted nothing, so there is no committed tile to click.')
      .toBeTruthy();
    const accepted = page.locator(`.tile[data-id="${id}"]`);

    /**
     * **The click takes the acceptance back; it does not flag it** (#135 R8).
     *
     * This assertion read `FLAGGED`, one click after a commit, and that was the defect:
     * *"something that shows as reviewed and I click it, it just switches to flagged...
     * it should go taking back."* The property this test is named for is unchanged — what
     * the reviewer just did outranks what the last commit did — and it is still asserted,
     * twice: first the take-back displaces `REVIEWED`, then the mark displaces the
     * withdrawal.
     */
    await accepted.click();
    await expect(accepted.locator('.badge')).toContainText('TAKING BACK');
    await expect(accepted).not.toHaveClass(/out-reviewed/);

    /* Commit the take-back, and the record carries nothing — so now an ordinary click is
       an ordinary mark again, and it outranks the `withdrawn` outcome underneath it. */
    await page.locator('#commitMarked').click();
    await expect(accepted.locator('.badge')).toHaveCount(0);

    await accepted.click();
    await expect(accepted).toHaveClass(/marked/);
    await expect(accepted.locator('.badge')).toContainText('FLAGGED');
  });
});

test.describe('the correction panel', () => {

  /**
   * One session type, so the list the search is scoped to is determinate.
   *
   * **This address is #130 showing up in a test that used to pass without it.** The
   * scoped search is real now: it asks the observation's own annotation list, where the
   * fixture used to ignore the `list` argument outright and match the whole taxonomy.
   * A term therefore has to be on the list the page's sessions read against, and on an
   * unfiltered page that is whichever session the first tile happens to belong to.
   *
   * **It was `./?sessionType=Inverts` and `urch`**, and both were facts about
   * `src/data.js`. The session type is discovered from the facets, the list it resolves to
   * is read off the rows the endpoint serves (`species_list`, #130's A1), and every search
   * term is derived from that list's own entries -- so nothing here is a name somebody
   * remembered about a corpus.
   */
  const listedAddress = (type) => undecided(`sessionType=${encodeURIComponent(type)}`);

  test('choosing a species closes it, and it does not flash back', async ({ page, request }) => {
    const scoped = await sessionTypeWithList(request);

    await page.goto(listedAddress(scoped.sessionType));
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);

    /* Something the tile is **not** already. The default page was Bat Stars and "Bat Star"
       itself contains "st" -- so a two-letter search matched the species the observation
       already carries, the correction came back `unchanged`, and nothing was written. That
       is correct behaviour and a useless test. The name is read off the tile that is
       actually going to be corrected rather than off a row fetched separately: the two are
       ordered the same way but sized differently, so they are not reliably the same row. */
    const already = (await tile.locator('.cap').innerText()).trim();
    const chosen = await scopedTermAvoiding(request, scoped.list, already);

    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick [data-act="correct"]').click();
    await expect(page.locator('.pick #spSearch')).toBeVisible();
    /**
     * **Two characters before anything is offered** (F14, A11).
     *
     * The panel used to fill itself with six entries on open, from
     * `searchSpecies('')` — and `GET /api/v2/species/list/:list/search` **rejects an
     * empty `q` with a 400**, deliberately, because "an empty search returning all 224
     * entries reads as a working search". So there is nothing to click until something is
     * typed, and this used to click `.srow` straight away.
     */
    await expect(page.locator('.pick #spList')).toContainText('Type 2 letters');
    await page.locator('.pick #spSearch').fill(chosen.term);
    /* A real search is a round trip, so wait for the answer rather than racing it. */
    await expect(page.locator('.pick .srow').first()).toBeVisible();
    await page.locator('.pick .srow').first().click();

    await expect(page.locator('.pick')).toHaveCount(0);
    /* It used to blank and rebuild, so watch it stay gone rather than trusting
       one sample: the flicker was roughly the length of the taxonomy request. */
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(120);
      await expect(page.locator('.pick')).toHaveCount(0);
    }
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.reason-chip')).toContainText('was ');
    /* Added with the migration: the name is read out of the answer the endpoint served
       rather than pinned, so the check can say *which* species it became. `comname` is the
       annotator's frozen label and is deliberately untouched; the caption draws the
       current one (`model/row.js`), which is what a correction moves. */
    await expect(tile.locator('.cap')).toContainText(chosen.first.comname);
  });

  test('the panel does not blank while the taxonomy is loading', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    /* Opening the species chooser awaits a request. The panel must stay on screen
       for the whole of it. */
    await page.locator('.pick [data-act="correct"]').click();
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.pick')).toHaveCount(1);
      await page.waitForTimeout(40);
    }
    await expect(page.locator('.pick #spSearch')).toBeVisible();
  });

  /** Flag the first usable tile and open its species chooser. */
  async function openChooser(page, address) {
    await page.goto(address);
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick [data-act="correct"]').click();
    await expect(page.locator('.pick #spSearch')).toBeVisible();
    return tile;
  }

  /**
   * #130 R1. The defect as reported: *"trying to change a species, nothing comes up in
   * the list as you type."*
   *
   * **The render tier is the only one that can see it as the reviewer met it** — a panel
   * drawing an empty state. The store was correct throughout; it asked the seam, the seam
   * returned an empty array without sending a request, and every layer behaved properly
   * on the way to showing something untrue.
   */
  test('#130 R1: two characters offer candidates from the observation own list', async ({ page, request }) => {
    const scoped = await sessionTypeWithList(request);
    const hit = await shortScopedTerm(request, scoped.list);
    const miss = await offListTerm(request, scoped.list);

    await openChooser(page, listedAddress(scoped.sessionType));

    await expect(page.locator('.pick #spScope')).toContainText(scoped.list);
    await page.locator('.pick #spSearch').fill(hit);

    await expect(page.locator('.pick .srow').first()).toBeVisible();
    await expect(page.locator('.pick #spList')).not.toContainText('Nothing');
    /* Scoped, so no list tag: the whole answer is one list and labelling every row with
       it would be noise (A3). */
    await expect(page.locator('.pick .srow .slist')).toHaveCount(0);

    /**
     * And it really is scoped.
     *
     * Without this the check passes while the scope is not applied at all — which *is*
     * #130. Reintroducing the defect proved exactly that: with `speciesListFor` returning
     * null again the search widened instead of being refused, candidates still appeared,
     * and everything above held. The term was `rockfish`, which is on `Fish` and on no
     * `Inverts` entry; here it is discovered the same way -- a name that the whole
     * taxonomy answers and this list does not -- so a genuinely scoped search has to find
     * nothing.
     */
    await page.locator('.pick #spSearch').fill(miss);
    await expect(page.locator('.pick #spList')).toContainText(`Nothing on ${scoped.list} matches`);
    await expect(page.locator('.pick .srow')).toHaveCount(0);
  });

  /**
   * #130 R3 and R4. "Search all lists" had no route behind it and could never have
   * returned anything; and a widened answer has to say which list each candidate is on,
   * because a common name is not unique across lists and a correction is written to the
   * record.
   */
  test('#130 R3/R4: widening returns candidates, each showing its list', async ({ page, request }) => {
    const scoped = await sessionTypeWithList(request);
    /* `st` was on three of the fixture's lists -- the sea stars on Inverts, Sebastes on
       Fish, Macrocystis on Habitat -- so it could tell a label apart from a constant. The
       real catalogue is asked for a term that does the same job rather than being assumed
       to hold that one. */
    const spanning = await termSpanningLists(request);

    await openChooser(page, listedAddress(scoped.sessionType));

    await page.locator('.pick [data-act="widen"]').click();
    await expect(page.locator('.pick #spScope')).toContainText('whole MARP taxonomy');
    await page.locator('.pick #spSearch').fill(spanning);

    await expect(page.locator('.pick .srow').first()).toBeVisible();
    const tags = page.locator('.pick .srow .slist');
    await expect(tags.first()).toBeVisible();
    /* Every candidate carries one, and between them they name more than one list. */
    expect(await tags.count()).toBe(await page.locator('.pick .srow').count());
    const named = new Set(await tags.allInnerTexts());
    expect(named.size).toBeGreaterThan(1);
  });

  /**
   * #130 R5. The panel must never offer an action that cannot work, and must not report
   * the catalogue empty when it never asked.
   *
   * The fixture's `INVERTS_GULF` was one of five session types it held (#81 D1) that the
   * species-list map does not name. The real corpus has its own -- `db/species-lists.js`
   * says so out loud, and the rows carry `species_list: null` -- so the session type is
   * discovered rather than named. The old panel said *"Nothing matches. Try Search all
   * lists"* here, which was two untruths: nothing had been searched, and the widen action
   * it recommended was itself dead.
   */
  test('#130 R5: no list for the session type is said, not drawn as no match', async ({ page, request }) => {
    const anything = await termSpanningLists(request);

    /**
     * **The corpus has no session in this position, so the check seeds one.**
     *
     * `db/species-lists.js` names `Other` as a type that genuinely does not say which
     * list was in use, and says two such observations were in the development database --
     * but "two observations somewhere" is not something a check may rely on, and the
     * testing database's copy has none at all. A session of type `Other` with rows of its
     * own is the same position, made rather than hoped for, and it is removed afterwards.
     */
    const seeded = await seedPage({ count: 2, thumbnail: 'ready', sessionType: 'Other' });

    try {
      await openChooser(page, seeded.address);

      await expect(page.locator('.pick #spScope')).toContainText('no list for this session type');
      await expect(page.locator('.pick #spList')).toContainText('names no species list');
      await expect(page.locator('.pick #spList')).not.toContainText('Nothing');

      /* And widening is a real way out of it, rather than advice that does nothing. */
      await page.locator('.pick [data-act="widen"]').click();
      await page.locator('.pick #spSearch').fill(anything);
      await expect(page.locator('.pick .srow').first()).toBeVisible();
    } finally {
      await seeded.remove();
    }
  });

  /**
   * The other half of R5: a search that really was made and really found nothing says so,
   * and says which list it searched.
   */
  test('#130 R5: a genuine miss names the list it searched', async ({ page, request }) => {
    const scoped = await sessionTypeWithList(request);

    await openChooser(page, listedAddress(scoped.sessionType));

    /* Nothing in any catalogue is called this, which is the point -- and unlike the
       off-list term above it is a miss everywhere, so the message must still name the
       list that was searched. */
    await page.locator('.pick #spSearch').fill('zzq');

    await expect(page.locator('.pick #spList')).toContainText(`Nothing on ${scoped.list} matches`);
    await expect(page.locator('.pick .srow')).toHaveCount(0);
  });
});

test.describe('Delete Mode shows the scientific record', () => {
  test('an existing flag is visible before anything is deleted', async ({ page, request }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    const tile = await freshTile(page);
    const id = await tile.getAttribute('data-id');
    await tile.click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);

    /**
     * The mode switch takes the page back to 1 under **Delete's** own status defaults, and
     * on a real corpus that is thousands of rows rather than the fixture's one page -- so
     * the row that was just flagged need not still be on screen. The fixture's version of
     * this check asserted that *some* tile showed FLAGGED and got away with it; here the
     * address is walked to wherever the flagged row actually fell, and the assertion is
     * about that tile. Stronger, and deterministic.
     */
    const flagged = page.locator(`.tile[data-id="${id}"]`);
    if (!(await flagged.isVisible().catch(() => false))) {
      const pageSize = await pageSizeOf(page);
      const onPage = await findPageOf(request, DELETE_STATUS, Number(id), pageSize);
      const address = new URL(page.url());
      address.searchParams.set('page', String(onPage));
      await page.goto(address.toString());
      await ready(page);
    }

    /* Deleting is irreversible, so what the record already says has to be visible. */
    await expect(flagged.locator('.badge')).toContainText('FLAGGED');
    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    /* But it is context, not a selection: Delete marks nothing on arrival. */
    await expect(page.locator('.tile.marked')).toHaveCount(0);
    /* Updated for #72: the button used to read "0 tiles" and stay clickable. A commit
       that would act on nothing is now disabled and says so, which is a stronger form of
       the same fact -- so this asserts the stronger one rather than the old wording. */
    await expect(page.locator('#commit')).toBeDisabled();
    await expect(page.locator('#commit')).toContainText('nothing to do');
  });

  test('it offers both status dimensions, and now so does everything else', async ({ page }, info) => {
    /* This asserted that *only* Delete offered both, which is the decision #89 reversed:
       Delete's rail is the one the review modes were given. What is still Delete's own is
       the *default* — it owns the training dimension, so all three values arrive ticked,
       where a review mode borrows it and it arrives narrowing nothing. That distinction is
       asserted in the #89 block at the end of `tests/e2e/render.spec.mjs`. */
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await openRail(page);
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');
    await expect(page.locator('#statusFilters [data-statuskey="trainingDisposition"]')).toHaveCount(3);

    /* The rail overlays the mosaic on a phone, and the mode selector is behind it. */
    await closeRail(page, info);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);
    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');
    await expect(page.locator('#statusFilters [data-statuskey="reviewStatus"]')).toHaveCount(3);
    await expect(page.locator('#statusFilters [data-statuskey="trainingDisposition"]')).toHaveCount(3);
  });

  test('a training filter actually narrows the results in Delete Mode', async ({ page }) => {
    await page.goto(undecided());
    await expectRealBacking(page);
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);
    const before = await page.locator('#total').innerText();

    /* Untick Undecided: what is left is only what a model was already taught with. */
    await page.locator('#statusFilters [data-statuskey="trainingDisposition"][data-status="undecided"]').click();
    await ready(page);
    await expect(page.locator('#total')).not.toHaveText(before);
  });
});

/* ------------------------------------------------------------------------------------
 * Local helpers.
 *
 * Everything below discovers a fact about the corpus rather than asserting one. They are
 * here rather than in `support.mjs` because that file is shared and is being edited by
 * other agents while this lands; the moment a second file wants one of them is the moment
 * to move it.
 * ---------------------------------------------------------------------------------- */

/**
 * Delete Mode's own status defaults, as `MODES.delete` declares them.
 *
 * Written out rather than imported because `findPageOf` takes filters, not a mode -- and
 * it is the *question the address asks* that has to match, which is what the mode switch
 * just wrote into it. If `MODES.delete` ever changes, the page lookup misses and the
 * check fails loudly rather than silently looking at the wrong tile.
 */
const DELETE_STATUS = {
  reviewStatus: ['unreviewed', 'flagged'],
  trainingDisposition: ['undecided', 'promoted', 'excluded']
};

/** Plain JSON, kept between tests so the same discovery is not paid for eleven times. */
const remembered = new Map();

/**
 * Run a discovery once per run and reuse its answer.
 *
 * Only plain data is kept: Playwright disposes the `request` context after each test, so
 * anything holding one would be stale by the next.
 *
 * @param {string} key - What is being remembered.
 * @param {Function} discover - Called when it is not known yet.
 * @returns {Promise<*>} The answer.
 */
async function once(key, discover) {
  if (!remembered.has(key)) remembered.set(key, await discover());
  return remembered.get(key);
}

/**
 * A session type whose observations resolve to a species list, and that list.
 *
 * Read off the rows rather than out of `db/species-lists.js`: `species_list` is on the
 * mosaic row (#130 A1) and is the session's list, which is exactly what the picker scopes
 * to. Asking the data means this cannot disagree with the panel under test.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @returns {Promise<Object>} `{sessionType, list}`.
 */
async function sessionTypeWithList(request) {
  return once('listed', async () => {
    const found = await sessionTypeWhere(request, (row) => Boolean(row.species_list));
    expect(found, 'no session type in this corpus resolves to a species list, so the '
      + 'scoped correction search has nothing to be about.').toBeTruthy();
    return { sessionType: found.sessionType, list: found.row.species_list };
  });
}


/**
 * The first session type holding a row that satisfies `wants` **and** can be marked.
 *
 * "Can be marked" is the second half and it is not decoration: the checks open on
 * `undecided()` and reach for `freshTile`, so a session type whose undecided rows all
 * failed extraction would pass this and fail there, several steps later.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {Function} wants - Called with a served row.
 * @returns {Promise<?Object>} `{sessionType, row}`, or null.
 */
async function sessionTypeWhere(request, wants) {
  const { sessionType } = await facetsFor(request, {});

  for (const candidate of sessionType || []) {
    const narrowed = { sessionType: [candidate.value], reviewStatus: ['unreviewed'] };
    const { rows } = await pageOf(request, narrowed);
    const row = rows.find((r) => wants(r) && hasPicture(r));
    if (row) return { sessionType: candidate.value, row };
  }

  return null;
}

/** What `freshTile` will accept: neither `.failed` nor `.queued`. */
const hasPicture = (row) => row.thumbnail_status !== 'failed' && row.thumbnail_status !== 'queued';

/**
 * Every entry on one annotation list.
 *
 * The source of every search term below. Deriving a term from the catalogue is what stops
 * this file repeating the fixture's mistake of knowing that `urch` finds Red Urchin.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {string} list - The list name.
 * @returns {Promise<Array<Object>>} The entries.
 */
async function listEntries(request, list) {
  return once(`entries:${list}`, async () => {
    const res = await request.get(`/api/v2/species/list/${encodeURIComponent(list)}`);
    expect(res.ok(), `the ${list} list was refused: ${res.status()} ${await res.text()}`)
      .toBeTruthy();
    return res.json();
  });
}

/** The annotation lists the catalogue holds, in the order the endpoint reports them. */
async function allLists(request) {
  return once('lists', async () => {
    const res = await request.get('/api/v2/species/lists');
    expect(res.ok(), `the species lists were refused: ${res.status()} ${await res.text()}`)
      .toBeTruthy();
    return res.json();
  });
}

/** The scoped search the panel makes, made directly, so a term can be checked before it is typed. */
async function scopedSearch(request, list, term) {
  const res = await request.get(
    `/api/v2/species/list/${encodeURIComponent(list)}/search?q=${encodeURIComponent(term)}`
  );
  expect(res.ok(), `searching ${list} for "${term}" was refused: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** The widened search, likewise. */
async function widenedSearch(request, term) {
  const res = await request.get(`/api/v2/species/search?q=${encodeURIComponent(term)}`);
  expect(res.ok(), `searching the taxonomy for "${term}" was refused: ${res.status()}`)
    .toBeTruthy();
  return res.json();
}

/**
 * Candidate search terms, taken from real common names.
 *
 * `length` of 2 is the panel's own minimum; longer ones are how a term gets specific
 * enough to be a genuine miss somewhere else.
 *
 * @param {Array<Object>} entries - Catalogue entries.
 * @param {number} length - How many characters, or 0 for the whole word.
 * @returns {Array<string>} Deduplicated, in catalogue order.
 */
function termsFrom(entries, length) {
  const seen = new Set();
  const out = [];

  for (const entry of entries || []) {
    for (const word of String(entry.comname || '').toLowerCase().match(/[a-z]+/g) || []) {
      if (word.length < Math.max(length, 1)) continue;
      const term = length ? word.slice(0, length) : word;
      if (seen.has(term)) continue;
      seen.add(term);
      out.push(term);
    }
  }

  return out;
}

/** How many terms a discovery tries before it gives up and says so. */
const TRIES = 40;

/**
 * A term whose scoped search offers something the observation is **not** already.
 *
 * The correction route refuses a change to the species the row already carries, as
 * `unchanged`, and nothing is written -- correct behaviour and a useless test. The first
 * `.srow` is what gets clicked, so it is the first *answer* that has to differ, which is
 * why the search is made here rather than the term being hoped for.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {string} list - The list the panel will scope to.
 * @param {string} avoid - The name the tile already carries.
 * @returns {Promise<Object>} `{term, first}`.
 */
async function scopedTermAvoiding(request, list, avoid) {
  const entries = await listEntries(request, list);

  for (const term of termsFrom(entries, 4).slice(0, TRIES)) {
    const found = await scopedSearch(request, list, term);
    if (found.length && found[0].comname !== avoid) return { term, first: found[0] };
  }

  throw new Error(
    `No search over ${list} offers a species other than "${avoid}" first, so a correction `
    + 'made through the panel would be refused as `unchanged` and this check would prove '
    + 'nothing. It fails rather than skipping.'
  );
}

/** The shortest term the panel will act on -- two characters -- that this list answers. */
async function shortScopedTerm(request, list) {
  return once(`short:${list}`, async () => {
    const entries = await listEntries(request, list);

    for (const term of termsFrom(entries, 2).slice(0, TRIES)) {
      const found = await scopedSearch(request, list, term);
      if (found.length) return term;
    }

    throw new Error(`No two-letter search over ${list} matches anything on it.`);
  });
}

/**
 * A term the whole taxonomy answers and this list does not.
 *
 * The scoping assertion turns on it: without a term that is genuinely elsewhere, the check
 * passes while the scope is not applied at all, which *is* #130.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @param {string} list - The list that must not match it.
 * @returns {Promise<string>} The term.
 */
async function offListTerm(request, list) {
  return once(`offlist:${list}`, async () => {
    const lists = await allLists(request);
    const elsewhere = (lists || []).filter((entry) => entry.species_list !== list);

    for (const other of elsewhere) {
      const entries = await listEntries(request, other.species_list);

      for (const term of termsFrom(entries, 0).slice(0, TRIES)) {
        if (term.length < 5) continue;
        const scoped = await scopedSearch(request, list, term);
        if (scoped.length) continue;
        const widened = await widenedSearch(request, term);
        if (widened.length) return term;
      }
    }

    throw new Error(
      `Nothing in the MARP taxonomy is named in a way that ${list} does not also match, so `
      + 'a scoped search cannot be told apart from an unscoped one and #130 R1 has nothing '
      + 'to prove. It fails rather than skipping.'
    );
  });
}

/**
 * A term whose widened search spans more than one list.
 *
 * R4 is that each widened candidate says which list it is on, and a label cannot be told
 * apart from a constant unless at least two of them differ.
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright's request fixture.
 * @returns {Promise<string>} The term.
 */
async function termSpanningLists(request) {
  return once('spanning', async () => {
    const lists = await allLists(request);
    expect((lists || []).length, 'the catalogue holds one list or none, so a widened search '
      + 'cannot span two and R4 has nothing to be about.').toBeGreaterThan(1);

    for (const entry of lists) {
      const entries = await listEntries(request, entry.species_list);

      for (const term of termsFrom(entries, 2).slice(0, TRIES)) {
        const found = await widenedSearch(request, term);
        const named = new Set(found.map((s) => s.species_list).filter(Boolean));
        if (named.size > 1) return term;
      }
    }

    throw new Error(
      'No two-letter search over the MARP taxonomy returns candidates from more than one '
      + 'list, so a widened answer cannot show that it labels them. It fails rather than '
      + 'skipping.'
    );
  });
}
