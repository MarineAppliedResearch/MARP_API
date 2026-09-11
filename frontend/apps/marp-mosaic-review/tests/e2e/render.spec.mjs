/**
 * Render-layer tests.
 *
 * These exist because the unit and contract tiers structurally cannot see the DOM.
 * Three defects so far lived here and every store-level check passed while they were
 * live: a stale identifier crashed rendering, a committed page drew no badge, and a
 * layout feedback loop kept re-querying the grid. Each is covered below.
 */
import { test, expect } from '@playwright/test';

/**
 * Every navigation in this file asks for the **fixture** backing, and says so.
 *
 * The application itself runs against the API (A2): `src/backend.js` defaults to
 * `src/api/` and `index.html` never points it anywhere else. This tier cannot yet —
 * A15 settled that the seeded database a browser tier needs is **not built in this
 * phase**, and the six real observations of one species in one dive cannot exercise
 * paging, filtering or a second species.
 *
 * So the parameter is passed here, in **one place**, and the page makes the choice
 * unmissable: it paints a permanent `FIXTURE — not the API` banner and stamps
 * `documentElement.dataset.backing`, which the check below asserts. A2's objection to a
 * runtime flag was that it is "how a render test comes to grade a fixture and report it
 * as the API"; a flag the page announces and the tier asserts cannot do that silently.
 *
 * Both come out when the seeded database lands and this tier is repointed.
 */
const FIXTURE = 'backing=fixture';

/**
 * **In the hash, never the query string.**
 *
 * The query string *is* the question: `model/query-url.js` reads an address literally, and
 * a **bare** one means the default question — that is what makes a deliberately cleared
 * species filter survive a reload instead of being handed back. So `?backing=fixture`
 * made every address non-bare, the app opened on nothing-narrowing rather than on its
 * default question, and ten tests here reported a total of 2,755 where 1,083 was expected.
 *
 * The hash is not part of the question, and `rememberQuery()` preserves it across the
 * `replaceState` the app does on every refresh — so it survives paging and filtering.
 */
const withFixture = (url) => {
  const text = String(url);
  const [before, hash = ''] = text.split('#');
  const merged = hash ? `${hash}&${FIXTURE}` : FIXTURE;
  return `${before}#${merged}`;
};

test.beforeEach(async ({ page }) => {
  const go = page.goto.bind(page);
  page.goto = (url, options) => go(withFixture(url), options);
});

test('this tier grades the fixture, and the page says so', async ({ page }) => {
  /* The assertion that makes the arrangement above safe: if the parameter is ever
     dropped, or the page stops honouring it, this fails rather than a hundred tests
     quietly grading something else. */
  await page.goto('./');
  await expect(page.locator('#backingFlag')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-backing', 'fixture');
  /* And it is not in the question. A backing in the query string would make every
     address non-bare, which silently costs the app its default question. */
  expect(new URL(page.url()).search).toBe('');
});

/** Wait for the first page of tiles, and for the grid to stop changing size. */
async function ready(page) {
  await expect(page.locator('.tile').first()).toBeVisible();
  await expect(page.locator('.tile.skeleton')).toHaveCount(0);
  let last = -1;
  for (let i = 0; i < 12; i++) {                  // settle, then confirm it stays settled
    const n = await page.locator('.tile').count();
    if (n === last && n > 0) return;
    last = n;
    await page.waitForTimeout(250);
  }
}

/** The rail starts collapsed on a phone, so open it before reaching for a filter. */
async function openRail(page) {
  if (await page.locator('.app.railed, body.railed, #rail.collapsed').count()) { /* noop */ }
  const rail = page.locator('#statusFilters [data-status]').first();
  if (!(await rail.isVisible().catch(() => false))) await page.locator('#railbtn').click();
  await expect(rail).toBeVisible();
}

/** Collect console errors and page errors for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test.describe('the mosaic renders and stays settled', () => {
  test('loads a page of tiles with names, and no errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await ready(page);

    expect(await page.locator('.tile').count()).toBeGreaterThan(8);
    /* every tile carries its species name, including ones with no image */
    const captions = await page.locator('.tile .cap').allTextContents();
    expect(captions.length).toBe(await page.locator('.tile').count());
    expect(captions.every((c) => c.trim().length > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the grid settles: no further queries once a page has loaded', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    /* The layout loop re-queried forever, which is what made marks appear to vanish. */
    const count = () => page.evaluate(() =>
      window.__queries ?? (window.__queries = 0));
    await page.evaluate(() => {
      window.__queries = 0;
      window.addEventListener('marp:action', (e) => {
        if (e.detail.name === 'query') window.__queries++;
      });
    });
    await page.waitForTimeout(2500);
    expect(await count()).toBe(0);
  });

  test('an unavailable thumbnail still shows its species and stays markable', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    /* Break one deliberately rather than hoping the fixture put a failed tile on this
       page. It skipped whenever it did not, on both viewports — and a skipped test reports
       green while proving nothing, which is the one thing the doctrine here is emphatic
       about. */
    const id = await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      const { MarpData } = await import('./src/data.js');
      const target = state.rows.find((r) => r.thumbnail_status === 'ready');
      MarpData.breakThumbnails([target.observation_id]);
      await actions.refresh();
      return target.observation_id;
    });
    await ready(page);

    const noImage = page.locator(`.tile[data-id="${id}"]`);
    await expect(noImage).toHaveClass(/failed/);
    await expect(noImage.locator('.cap')).not.toBeEmpty();
    await noImage.click();
    await expect(noImage).toHaveClass(/marked/);
  });
});

test.describe('marking and the flag panel', () => {
  test('a tap marks the tile and draws its badge', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');
  });

  test('the badge opens the panel, and clicking away closes it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    await page.locator('#field').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.pick')).toHaveCount(0);
  });

  test('the panel stays inside the mosaic even on the bottom row', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').last();
    await tile.click();
    await tile.locator('[data-badge]').click();

    const panel = page.locator('.pick');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const field = await page.locator('#field').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(field.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(field.y + field.height + 1);
  });

  test('dismissing the panel does not also unmark the tile', async ({ page }) => {
    /* Clicking away used to close the panel AND toggle the tile under the cursor,
       which silently undid the very mark the panel belonged to. */
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await expect(page.locator('.pick')).toBeVisible();

    /* Dispatched rather than clicked: on a phone the panel physically covers the
       grid, and the regression is in the grid's own handler, not in hit-testing. */
    await page.locator('.tile:not(.failed):not(.queued)').nth(4).dispatchEvent('click');
    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/marked/);
    await expect(page.locator('.tile.marked')).toHaveCount(1);
  });

  test('Escape closes the panel and leaves the mark alone', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pick')).toHaveCount(0);
    await expect(tile).toHaveClass(/marked/);
  });

  test('choosing a reason shows it on the tile', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await tile.locator('[data-badge]').click();
    await page.locator('.pick .chip', { hasText: 'Bounding box' }).click();
    await expect(tile.locator('.reason-chip')).toContainText('Bounding box');
  });
});

test.describe('committing a page', () => {
  test('draws the outcome on every tile, and it survives leaving and returning',
    async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      await ready(page);

      const flagged = page.locator('.tile:not(.failed):not(.queued)').first();
      await flagged.click();
      await page.locator('#commit').click();

      /* the committed page must show what was submitted: greens as well as ambers */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
      await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
      const reviewedBefore = await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count();
      expect(reviewedBefore).toBeGreaterThan(1);

      await page.locator('[data-page="next"]').click();
      await ready(page);
      await page.locator('[data-page="prev"]').click();
      await ready(page);

      await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
      expect(await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count())
        .toBe(reviewedBefore);
      expect(errors).toEqual([]);
    });
});

test.describe('every mode renders', () => {
  for (const [mode, label] of [['training', 'Training Data Review'], ['delete', 'Delete']]) {
    test(`${mode} mode loads tiles and its own status filter`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      await ready(page);

      await page.locator('.seg button', { hasText: label }).click();
      await ready(page);

      expect(await page.locator('.tile').count()).toBeGreaterThan(0);
      const statusLabel = await page.locator('#statusLbl').textContent();
      expect(statusLabel).toBe(mode === 'training' ? 'Training disposition' : 'Review status');

      /* A mark must survive giving it a reason and closing the panel — in every mode. */
      if (mode === 'training') {
        const tile = page.locator('.tile:not(.failed):not(.queued)').first();
        await tile.click();
        await tile.locator('[data-badge]').click();
        await page.locator('.pick .chip', { hasText: 'Occluded' }).click();
        await page.keyboard.press('Escape');
        await expect(tile).toHaveClass(/marked/);
        await expect(tile.locator('.badge')).toContainText('EXCLUDED');
        await expect(tile.locator('.reason-chip')).toHaveText('Occluded');
        await expect(page.locator('#footCount')).toContainText('1');
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe('the filter rail', () => {
  test('toggling it changes how much room the mosaic has', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    /* The rail starts collapsed on a phone and open on a desktop, so assert the
       direction of the change rather than assuming which way it goes. */
    const collapsed = await page.evaluate(() =>
      document.body.classList.contains('rail-collapsed'));
    const before = await page.locator('.tile').count();
    await page.locator('#railbtn').click();
    await ready(page);
    const after = await page.locator('.tile').count();
    if (collapsed) expect(after).toBeLessThanOrEqual(before);
    else expect(after).toBeGreaterThan(before);
  });

  test('a filter menu opens, is searchable, and is not clipped by the rail',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      /* the filters are behind the rail, which is collapsed by default on a phone */
      if (await page.evaluate(() => document.body.classList.contains('rail-collapsed'))) {
        await page.locator('#railbtn').click();
        await expect(page.locator('[data-dim="species"]')).toBeVisible();
      }
      await page.locator('[data-dim="species"]').click();

      const menu = page.locator('.menu');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);          // the rail used to clip it off-screen

      await menu.locator('.msearch').fill('rock');
      await expect(menu.locator('[data-v]')).toHaveCount(2);   // Rockfish, Rock Crab
    });
});

test.describe('the modes do not wear each other\'s answers', () => {
  /* Still true after #85, and worth being precise about what it means now: an *outcome*
     never travels between modes, because it is what the last commit did here. What the
     record carries does travel, as a borrowed `.rtag` — see the #85 block below. `.badge`
     is this mode's own answer, and that is what this checks. */
  test('a scientific commit leaves no badge behind in training or delete', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.tile:not(.failed):not(.queued)').first().click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
    await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' })).toHaveCount(0);

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
  });

  test('switching modes clears the marks along with the outcomes', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.tile:not(.failed):not(.queued)').first().click();
    await expect(page.locator('.tile.marked')).toHaveCount(1);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await expect(page.locator('.tile.marked')).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- #85
   Every mode shows every workflow's tags. These are here rather than in the unit tier
   because they are claims about what is drawn on a tile, and every rendering defect in
   this app so far passed the store-level checks. */

/**
 * A tile on screen whose record carries `value` in `column`, paging forward if this page
 * holds none.
 *
 * The fixture guarantees these rows exist — 236 excluded, 179 promoted, 214 reviewed out
 * of 3000 — but not that one lands on page 1 at every viewport, and a phone page holds a
 * fraction of a desktop one. So it pages rather than skipping: a skipped check looks green.
 */
async function tileCarrying(page, column, value, pages = 6) {
  for (let i = 0; i < pages; i++) {
    /* With imagery, so the claims about the picture not being dimmed have a picture. */
    const id = await page.evaluate(([c, v]) => {
      const row = (window.MARP.state.rows || [])
        .find((r) => r[c] === v && r.thumbnail_status === 'ready');
      return row ? row.observation_id : null;
    }, [column, value]);
    /* Pinned by id, because a locator describing a state stops matching once it changes. */
    if (id !== null) return page.locator(`.tile[data-id="${id}"]`);
    await page.locator('[data-page="next"]').click();
    await ready(page);
  }
  throw new Error(`no observation with ${column}=${value} in the first ${pages} pages`);
}

/** Page forward until the tile for one known observation is on screen. */
async function tileById(page, id, pages = 6) {
  for (let i = 0; i < pages; i++) {
    const tile = page.locator(`.tile[data-id="${id}"]`);
    if (await tile.count()) return tile;
    await page.locator('[data-page="next"]').click();
    await ready(page);
  }
  throw new Error(`observation ${id} is not in the first ${pages} pages`);
}

test.describe('every workflow\'s tags are visible from every mode', () => {
  test('R1: a training exclusion is drawn while reviewing science', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await ready(page);

    const tile = await tileCarrying(page, 'training_decision', 'excluded');
    const tag = tile.locator('.rtag');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('EXCLUDED');
    /* R6: another workflow's opinion must not grey out the picture being judged. */
    await expect(tile).not.toHaveClass(/has-excluded/);
    await expect(tile.locator('img')).toHaveCSS('filter', 'none');
    expect(errors).toEqual([]);
  });

  test('R1: a training promotion is drawn while reviewing science', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = await tileCarrying(page, 'training_decision', 'promoted');
    await expect(tile.locator('.rtag')).toContainText('PROMOTED');
    await expect(tile).not.toHaveClass(/has-promoted/);
  });

  test('R1: a scientific review is drawn while reviewing training data', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);

    const tile = await tileCarrying(page, 'review_decision', 'reviewed');
    const tag = tile.locator('.rtag');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('REVIEWED');
    /* The borrowed tag says what happened, not who: the name is in the tooltip. */
    await expect(tag).toHaveAttribute('title', /Scientific data review: reviewed/);
  });

  test('R1: Delete Mode shows the training tags it used to hide', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);

    /* Delete always read the scientific dimension — the training one is what was missing,
       and it is the sharpest case in #85: an observation already excluded from training
       looked untouched at the moment somebody was deciding whether to destroy it. */
    const tile = await tileCarrying(page, 'training_decision', 'excluded');
    await expect(tile.locator('.rtag')).toContainText('EXCLUDED');
    expect(errors).toEqual([]);
  });

  test('R1/R5: a committed flag reaches training as the record, not as an outcome',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      /* An undecided row, so training's own default filter still shows it afterwards. */
      const id = await page.evaluate(() => {
        const row = window.MARP.state.rows.find((r) => r.thumbnail_status === 'ready'
          && r.training_decision == null);
        return row ? row.observation_id : null;
      });
      expect(id, 'the first page must hold a ready, undecided row').not.toBeNull();

      const tile = page.locator(`.tile[data-id="${id}"]`);
      await tile.click();
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
      await page.locator('#commit').click();

      /* Wait for the commit to *land*, not for the badge on our own tile: that already
         said FLAGGED as a mark, so waiting on it proves nothing and leaves the page
         mid-commit. `commitPage` is async and writes `state.outcomes` when it resolves,
         so switching mode first has the outcomes arrive after `setMode` cleared them --
         which paints this commit's answers across Training. That is a real race in
         `store.js`, found by this test on 2026-09-08 and not fixed here. */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      const moved = await tileById(page, id);

      await expect(moved.locator('.rtag')).toContainText('FLAGGED');
      /* R5: `setMode` cleared the outcomes, so the only thing that could have drawn this
         is the record read back. Training's own answer — the primary badge — is silent. */
      await expect(moved.locator('.badge')).toHaveCount(0);
    });

  test('R2/R3: a mark still outranks the record, and the tag does not swallow the click',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      const tile = await tileCarrying(page, 'training_decision', 'excluded');

      /* Clicking the tag itself, which is the click most likely to be swallowed. */
      await tile.locator('.rtag').click();
      await expect(tile).toHaveClass(/marked/);
      /* R2: the primary badge is this mode's mark. If a record tag could reach that slot,
         clicking a tile would appear to do nothing. */
      await expect(tile.locator('.badge')).toContainText('FLAGGED');
      /* R1 still holds while marked: the exclusion is on the record either way. */
      await expect(tile.locator('.rtag')).toContainText('EXCLUDED');
    });

  test('R7: the tag stays inside the tile and clear of the caption', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = await tileCarrying(page, 'training_decision', 'excluded');

    const tileBox = await tile.boundingBox();
    const tagBox = await tile.locator('.rtag').boundingBox();
    const capBox = await tile.locator('.cap').boundingBox();

    expect(tagBox.x).toBeGreaterThanOrEqual(tileBox.x - 1);
    expect(tagBox.x + tagBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width + 1);
    expect(tagBox.y).toBeGreaterThanOrEqual(tileBox.y - 1);
    /* Above the caption, not through it — the species name is what names the tile. */
    expect(tagBox.y + tagBox.height).toBeLessThanOrEqual(capBox.y + 1);
    /* And the image field stays mostly a quiet zone: the tag is in its bottom strip. */
    expect(tagBox.y).toBeGreaterThan(tileBox.y + tileBox.height / 2);

    /* The page must not scroll sideways because a tile grew a second label. */
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('a committed page is still editable', () => {
  test('the flag stays marked, a click takes it back, and committing accepts it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
    await tile.click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    /* Still marked, so the same gesture still means the same thing. */
    await expect(tile).toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('FLAGGED');

    await tile.click();
    await expect(tile).not.toHaveClass(/marked/);
    await expect(tile.locator('.badge')).toContainText('TAKING BACK');

    await page.locator('#commit').click();
    await expect(tile.locator('.badge')).toContainText('REVIEWED');
  });

  test('a mark outranks what the last commit did', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('#commit').click();
    /* Pinned by id: the tile stops matching .out-reviewed the moment it is
       marked, and a positional locator would slide onto a different tile. */
    const id = await page.locator('.tile.out-reviewed').first().getAttribute('data-id');
    const accepted = page.locator(`.tile[data-id="${id}"]`);
    await accepted.click();
    await expect(accepted.locator('.badge')).toContainText('FLAGGED');
    await expect(accepted).not.toHaveClass(/out-reviewed/);
  });
});

test.describe('the correction panel', () => {
  test('choosing a species closes it, and it does not flash back', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
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
    /* Something the tile is **not** already. The default page is Bat Stars, and "Bat Star"
       itself contains "st" -- so a two-letter search matched the species the observation
       already carries, the correction came back `unchanged`, and nothing was written. That
       is correct behaviour and a useless test. */
    await page.locator('.pick #spSearch').fill('urch');
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
  });

  test('the panel does not blank while the taxonomy is loading', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const tile = page.locator('.tile:not(.failed):not(.queued)').first();
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
});

test.describe('Delete Mode shows the scientific record', () => {
  test('an existing flag is visible before anything is deleted', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const id = await page.locator('.tile:not(.failed):not(.queued):not(.marked)')
      .first().getAttribute('data-id');
    await page.locator(`.tile[data-id="${id}"]`).click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    /* Deleting is irreversible, so what the record already says has to be visible. */
    await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    /* But it is context, not a selection: Delete marks nothing on arrival. */
    await expect(page.locator('.tile.marked')).toHaveCount(0);
    /* Updated for #72: the button used to read "0 tiles" and stay clickable. A commit
       that would act on nothing is now disabled and says so, which is a stronger form of
       the same fact -- so this asserts the stronger one rather than the old wording. */
    await expect(page.locator('#commit')).toBeDisabled();
    await expect(page.locator('#commit')).toContainText('nothing to do');
  });

  test('it offers both status dimensions, and now so does everything else', async ({ page }) => {
    /* This asserted that *only* Delete offered both, which is the decision #89 reversed:
       Delete's rail is the one the review modes were given. What is still Delete's own is
       the *default* — it owns the training dimension, so all three values arrive ticked,
       where a review mode borrows it and it arrives narrowing nothing. That distinction is
       asserted in the #89 block at the end of this file. */
    await page.goto('./');
    await ready(page);
    await openRail(page);
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');
    await expect(page.locator('#statusFilters [data-statuskey="trainingDisposition"]')).toHaveCount(3);

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');
    await expect(page.locator('#statusFilters [data-statuskey="reviewStatus"]')).toHaveCount(3);
    await expect(page.locator('#statusFilters [data-statuskey="trainingDisposition"]')).toHaveCount(3);
  });

  test('a training filter actually narrows the results in Delete Mode', async ({ page }) => {
    await page.goto('./');
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

test.describe('taking a decision back reads as heading towards accepted', () => {
  test('the TAKING BACK badge is green, not amber', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const id = await page.locator('.tile:not(.failed):not(.queued):not(.marked)')
      .first().getAttribute('data-id');
    const tile = page.locator(`.tile[data-id="${id}"]`);
    await tile.click();
    await page.locator('#commit').click();
    /* Wait for the commit to land: clicking before it does lets marksAfterCommit
       overwrite the toggle, and the tile comes back marked. */
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    await tile.click();

    const badge = tile.locator('.badge');
    await expect(badge).toContainText('TAKING BACK');
    /* Polled, not read once. Rendering is a full re-render from state, so a handle taken
       the moment a badge appears can be detached before it is read, and `getComputedStyle`
       on a detached node returns an empty string — which failed as "Cannot read properties
       of null" rather than saying anything about colour. `commitAndReadBadge` below already
       does this; this test never got the same treatment, and it was one of the flakes
       making full runs noisy. */
    let colour = '';
    await expect.poll(async () => {
      colour = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
        .catch(() => '');
      return /^rgba?\(/.test(colour) ? 'read' : `not a colour yet: ${JSON.stringify(colour)}`;
    }, { message: 'never got a colour off the TAKING BACK badge' }).toBe('read');
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    expect(g, `green channel should dominate, got ${colour}`).toBeGreaterThan(r + 40);
    expect(g, `and it should not be the amber it used to be, got ${colour}`).toBeGreaterThan(b);
    /* Distinct from the settled greens, which are the acid --green ramp. */
    expect(b, `a cooler green than --green-400, got ${colour}`).toBeGreaterThan(80);
  });
});

test.describe('the two workflows do not wear the same colour', () => {
  /** Commit the current page and return the rgb of the first outcome badge. */
  async function commitAndReadBadge(page, label) {
    await page.locator('#commit').click();
    const badge = page.locator('.tile .badge', { hasText: label }).first();
    await expect(badge).toBeVisible();

    /* Poll rather than read once. Rendering here is a full re-render from state, and the
       commit is async -- so a handle taken the instant the badge appears can be detached
       by the next render before it is read, and `getComputedStyle` on a detached node
       returns an empty string. `''.match(/\d+/g)` is null, and the test died with
       "Cannot read properties of null" instead of saying anything about colour. */
    let rgb = null;
    await expect.poll(async () => {
      rgb = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
        .catch(() => '');
      return /^rgba?\(/.test(rgb) ? 'read' : `not a colour yet: ${JSON.stringify(rgb)}`;
    }, { message: `never got a colour off the ${label} badge` }).toBe('read');

    return rgb.match(/\d+/g).map(Number);
  }

  test('REVIEWED is green and PROMOTED is violet, and they are far apart', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const [rr, rg, rb] = await commitAndReadBadge(page, 'REVIEWED');
    expect(rg, `REVIEWED should be green, got rgb(${rr},${rg},${rb})`).toBeGreaterThan(rr);
    expect(rg, 'and not blue').toBeGreaterThan(rb);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    const [pr, pg, pb] = await commitAndReadBadge(page, 'PROMOTED');
    /* Violet: blue leads, and red is well ahead of green. */
    expect(pb, `PROMOTED should be violet, got rgb(${pr},${pg},${pb})`).toBeGreaterThan(pg);
    expect(pr, 'and reddish rather than cyan').toBeGreaterThan(pg);

    /* The point of the change: these must not be confusable at a glance. */
    const distance = Math.hypot(rr - pr, rg - pg, rb - pb);
    expect(distance, `too close: rgb(${rr},${rg},${rb}) vs rgb(${pr},${pg},${pb})`)
      .toBeGreaterThan(120);
  });

  test('the commit button follows the mode that owns the decision', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const read = () => page.locator('#commit')
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    const sci = (await read()).match(/\d+/g).map(Number);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    const tra = (await read()).match(/\d+/g).map(Number);

    expect(sci[1], 'Mark Page Reviewed is green').toBeGreaterThan(sci[2]);
    expect(tra[2], 'Promote Page is violet').toBeGreaterThan(tra[1]);

    /* #93: Delete Marked is red. It always was — `body[data-mode="delete"] .commit`
       outranked the accept family — but nothing asserted it, so the family could be
       renamed out from under it without a test noticing. */
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    const del = (await read()).match(/\d+/g).map(Number);
    expect(del[0], `Delete Marked is red, got rgb(${del.join(',')})`).toBeGreaterThan(del[1] + 40);
    expect(del[0], 'and not violet').toBeGreaterThan(del[2]);
  });
});

/* ---------------------------------- what a commit did to this page (#93) */

test.describe('a committed page wears the hue of the commit that did it', () => {
  /**
   * A computed colour, polled until it parses.
   *
   * Same trap as `commitAndReadBadge` above: rendering is a full re-render, so a handle
   * taken the instant an element appears can be detached before `getComputedStyle` runs,
   * and a detached node returns an empty string. `''.match(/\d+/g)` is null, and the test
   * then dies saying nothing about colour.
   */
  async function readColour(locator, prop) {
    let value = '';
    await expect.poll(async () => {
      value = await locator.evaluate((el, p) => getComputedStyle(el)[p], prop).catch(() => '');
      return /rgba?\(/.test(value) ? 'read' : `not a colour yet: ${JSON.stringify(value)}`;
    }, { message: `never got ${prop} off the element` }).toBe('read');
    /* The last colour in the value: the progress bar is a gradient running from cyan to
       the mode's own hue, and it is the far end that carries the meaning. */
    const colours = value.match(/rgba?\([^)]*\)/g);
    return colours[colours.length - 1].match(/[\d.]+/g).map(Number);
  }

  /** Commit the current page, whichever mode is active, and wait for it to land. */
  async function commitPage(page, mode) {
    if (mode === 'delete') {
      for (let i = 0; i < 2; i++) {
        const id = await page.locator('.tile:not(.marked):not(.failed)').first()
          .getAttribute('data-id');
        await page.locator(`.tile[data-id="${id}"]`).click();
      }
      await expect(page.locator('.tile.marked')).toHaveCount(2);
      await page.locator('#commit').click();
      await page.locator('[data-confirm="go"]').click();
      await expect(page.locator('.tile.out-deleted')).toHaveCount(2);
    } else {
      await page.locator('#commit').click();
      await expect(page.locator('.tile .badge',
        { hasText: mode === 'training' ? 'PROMOTED' : 'REVIEWED' }).first()).toBeVisible();
    }
    /* The page you are standing on is a text input, not a chip, so the committed chip
       only exists once you have moved off it — which is also when a reviewer sees it. */
    await page.locator('[data-page="next"]').click();
    await ready(page);
    await expect(page.locator('.pg.done').first()).toBeAttached();
  }

  /** Into `mode`, commit a page, and report the chip's and the swatch's colours. */
  async function committedIn(page, mode) {
    if (mode !== 'scientific') {
      await page.locator('.seg button', { hasText: mode === 'training' ? 'Training Data Review' : 'Delete' })
        .click();
      await ready(page);
    }
    await commitPage(page, mode);
    return {
      chip: await readColour(page.locator('.pg.done').first(), 'color'),
      swatch: await readColour(page.locator('.swatch'), 'backgroundColor')
    };
  }

  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  test('R1/R2/R5: Delete is red, and nowhere near the green or the violet',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      /* One load, three modes: each mode parks its own committed pages, so the pager
         starts empty again on arrival rather than showing the previous mode's work. */
      const sci = await committedIn(page, 'scientific');
      const tra = await committedIn(page, 'training');
      const del = await committedIn(page, 'delete');

      /* The reported defect: this chip was the root green, in the mode whose commit had
         just destroyed those observations permanently. */
      expect(del.chip[0], `the chip should be red, got rgb(${del.chip.join(',')})`)
        .toBeGreaterThan(del.chip[1] + 40);
      expect(del.chip[0], 'and not violet').toBeGreaterThan(del.chip[2]);

      /* Unchanged, and asserted here so a shared variable cannot move them quietly. */
      expect(sci.chip[1], `scientific stays green, got rgb(${sci.chip.join(',')})`)
        .toBeGreaterThan(sci.chip[0]);
      expect(tra.chip[2], `training stays violet, got rgb(${tra.chip.join(',')})`)
        .toBeGreaterThan(tra.chip[1]);
      expect(tra.chip[0], 'and reddish rather than cyan').toBeGreaterThan(tra.chip[1]);

      /* Different is not enough: a person glancing at the pager has to be able to tell
         which of the three they are looking at. */
      expect(far(del.chip, sci.chip),
        `too close to green: rgb(${del.chip.join(',')}) vs rgb(${sci.chip.join(',')})`)
        .toBeGreaterThan(120);
      expect(far(del.chip, tra.chip),
        `too close to violet: rgb(${del.chip.join(',')}) vs rgb(${tra.chip.join(',')})`)
        .toBeGreaterThan(120);

      /* R2: the swatch is the legend for that chip, so it cannot disagree with it. */
      expect(del.swatch[0], `the swatch should be red, got rgb(${del.swatch.join(',')})`)
        .toBeGreaterThan(del.swatch[1] + 40);
      expect(sci.swatch[1], 'the swatch stays green in scientific').toBeGreaterThan(sci.swatch[0]);
      expect(tra.swatch[2], 'and violet in training').toBeGreaterThan(tra.swatch[1]);
    });

  test('R3: the progress bar fills with the hue of the mode filling it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    const bar = page.locator('#progBar');
    const sci = await readColour(bar, 'backgroundImage');
    expect(sci[1], `scientific progress is green, got rgb(${sci.join(',')})`)
      .toBeGreaterThan(sci[0]);

    /* The rail overlays the mosaic on a phone, so put it away before touching a tile. */
    await page.locator('#railbtn').click();
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);
    const del = await readColour(bar, 'backgroundImage');
    expect(del[0], `deleting does not fill a bar with green, got rgb(${del.join(',')})`)
      .toBeGreaterThan(del[1] + 40);
  });

  test('R4: the commit button says the delete succeeded without saying it was accepted',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await page.locator('.seg button', { hasText: 'Delete' }).click();
      await ready(page);

      const id = await page.locator('.tile:not(.marked):not(.failed)').first()
        .getAttribute('data-id');
      await page.locator(`.tile[data-id="${id}"]`).click();
      const commit = page.locator('#commit');
      await commit.click();
      await page.locator('[data-confirm="go"]').click();

      await expect(commit).toHaveClass(/ok/);
      const ok = await readColour(commit, 'backgroundColor');
      expect(ok[0], `the tick state should be red, got rgb(${ok.join(',')})`)
        .toBeGreaterThan(ok[1] + 40);
    });
});

test.describe('a judged tile steps back', () => {
  test('flagging dims the image, as excluding already did', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const id = await page.locator('.tile:not(.failed):not(.queued):not(.marked)')
      .first().getAttribute('data-id');
    const img = page.locator(`.tile[data-id="${id}"] img`);

    const before = await img.evaluate((el) => getComputedStyle(el).filter);
    await page.locator(`.tile[data-id="${id}"]`).click();
    const after = await img.evaluate((el) => getComputedStyle(el).filter);

    expect(before).toBe('none');
    expect(after, 'a flagged tile should be dimmed').toContain('brightness');
    /* Lighter than an exclusion: flagged work stays in view to be resolved. */
    const b = Number(after.match(/brightness\(([\d.]+)\)/)[1]);
    expect(b).toBeGreaterThan(0.55);
    expect(b).toBeLessThan(1);
  });
});

test.describe('filtering by where the observation came from', () => {
  test('L1, L2, L3: the rail is one list, in order, with no processor in it',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      /* The four group headings went in #81. They cost four rows of a rail that was
         already drawing its status filters below the fold. */
      await expect(page.locator('.railgroup__title')).toHaveCount(0);

      /* The order is the whole of the arrangement now, so it is worth asserting all of
         it. `session type` before `session`, because the type narrows the sessions. The
         confidence label carries its current range too, so this compares the beginning of
         each label rather than the whole of it. */
      const labels = await page.locator('#railDimensions .lbl').allInnerTexts();
      const expected = ['project', 'dive', 'line', 'session type', 'session',
                        'species', 'confidence', 'time of day', 'date', 'model'];
      expect(labels.length).toBe(expected.length);
      expected.forEach((label, i) => {
        expect(labels[i].toLowerCase().trim().startsWith(label),
          `rail row ${i} should start with "${label}", and reads "${labels[i]}"`).toBe(true);
      });

      await expect(page.locator('[data-dim="processor"], [data-span="processor"]'))
        .toHaveCount(0);
    });

  test('every declared dimension actually reaches the rail', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    const declared = await page.evaluate(async () => {
      const m = await import('./src/model/dimensions.js');
      return m.DIMENSIONS.map((d) => d.key);
    });
    for (const key of declared) {
      const control = page.locator(`[data-dim="${key}"], [data-span="${key}"]`);
      await expect(control, `${key} is declared but nothing draws it`).toHaveCount(1);
    }
  });

  test('dive is a dropdown, and choosing one narrows the mosaic', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    const before = Number((await page.locator('#total').innerText()).replace(/\D/g, ''));

    await page.locator('[data-dim="dive"]').click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.locator('.menu [data-v]').nth(1).click();      // nth(0) is "All dives"
    await ready(page);

    /* The button says what is chosen; the label span it used to write into is gone. */
    await expect(page.locator('[data-dim="dive"]')).not.toContainText('All dives');
    const after = Number((await page.locator('#total').innerText()).replace(/\D/g, ''));
    expect(after).toBeLessThan(before);
  });

  test('the line list is scoped to the chosen dive', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="line"]').click();
    const allLines = await page.locator('.menu [data-v]').count();
    await page.keyboard.press('Escape');

    await page.locator('[data-dim="dive"]').click();
    await page.locator('.menu [data-v]').nth(1).click();
    /* A multi-select menu stays open after a pick, and it hangs over the line button
       below it. Dismiss it the way a reviewer would before reaching for the next one —
       this used to pass only because the taller rail pushed the menu upwards instead. */
    await page.keyboard.press('Escape');
    await ready(page);

    await page.locator('[data-dim="line"]').click();
    const scoped = await page.locator('.menu [data-v]').count();
    expect(scoped, 'one dive offers no more lines than every dive together')
      .toBeLessThanOrEqual(allLines);
  });

  test('R7: changing the dive drops only the lines that no longer apply', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="line"]').click();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);
    await expect(page.locator('[data-dim="line"]')).not.toContainText('All lines');

    await page.locator('[data-dim="dive"]').click();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);

    /* This used to assert the line was cleared outright. #77 changed that deliberately:
       a line still reachable under the new dive is kept, and only one that is not gets
       dropped -- otherwise a careful multi-line selection is lost because one dive
       changed. Either outcome is correct here depending on the fixture, so what this
       asserts is the invariant: whatever survives must still be offered. */
    /* The first span carries the summary; the second is the chevron glyph. */
    const shown = await page.locator('[data-dim="line"] span').first().innerText();
    await page.locator('[data-dim="line"]').click();
    const offered = (await page.locator('.menu [data-v]').allInnerTexts())
      .map((t) => t.trim()).filter(Boolean);
    await page.keyboard.press('Escape');

    if (!shown.includes('All lines')) {
      const chosen = shown.replace(/\s+/g, ' ').trim();
      expect(offered.some((o) => o.trim() === chosen)).toBe(true);
    }
  });
});

test.describe('filtering by when it happened, and how sure the model was', () => {
  /** Type into one end of a two-ended control and let the rail's change handler run. */
  async function setSpan(page, key, end, value) {
    const box = page.locator(`[data-span="${key}"] [data-end="${end}"]`);
    /* Time and date live behind a summary button since #81 L5, so the popover holding
       their ends has to be opened first. The confidence track is in the rail itself. */
    if (!(await box.count())) await page.locator(`[data-dim="${key}"]`).click();
    await box.fill(value);
    /* `fill` raises `input` and not `change`, and the rail waits for `change` — text
       sitting in a field is not a value anybody has committed to yet. Enter is what a
       person presses, and it is one of the three events the panel listens for. */
    await box.press('Enter');
    await ready(page);
  }

  const total = async (page) =>
    Number((await page.locator('#total').innerText()).replace(/\D/g, ''));

  test('R2: the confidence slider narrows the mosaic', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    const before = await total(page);

    /* The arithmetic is unit-tested. What is not is that the slider reaches it — a
       control wired to nothing passes every check that cannot see the screen. */
    const from = page.locator('[data-span="confidence"] [data-end="from"]');
    await from.evaluate((el) => {
      el.value = '0.9';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ready(page);

    expect(await total(page)).toBeLessThan(before);
    await expect(page.locator('[data-span="confidence"]')).toBeVisible();
  });

  test('R4: a time window that wraps past midnight returns both sides of it',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      /* Evening first, with no wrap: the fixture runs from midnight to just before
         seven, so this is the late end of it on its own. */
      await setSpan(page, 'timeOfDay', 'from', '05:00');
      await setSpan(page, 'timeOfDay', 'to', '06:59');
      const oneSide = await total(page);
      expect(oneSide).toBeGreaterThan(0);

      /* Now wrap it past midnight. Written as an AND rather than an OR — the usual way
         this goes wrong — a wrapped window returns nothing at all.

         Polled rather than read once: both windows return more than a page, so the tile
         count `ready()` watches is the same either side of the change and cannot say when
         the new result has landed. The number that moves is the one to wait on. */
      await setSpan(page, 'timeOfDay', 'to', '01:00');
      await expect.poll(() => total(page)).toBeGreaterThan(oneSide);
    });

  test('R5: the date filter says how many observations it could not see',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      const note = page.locator('[data-note="date"]');
      await expect(note).toBeHidden();          // nothing to say until a date is asked for

      /**
       * **A17 changed what this filter compares, and so what it can fail to answer.**
       *
       * It used to compare the *date component* of `tc`, which no observation carries — so
       * the filter excluded everything and the note reported the whole result. That is why
       * the endpoint refused it outright. Answered differently by the human: the range
       * compares `tc` as a **point in time**, so a row answers whenever its `tc` carries a
       * readable clock.
       *
       * Which leaves the note with something narrower and truer to say: the rows whose
       * `tc` says nothing at all. The fixture carries two, deliberately, because a rule
       * with nothing to report is a rule nothing watches — and this line is still the ONLY
       * thing standing between the reviewer and a result they cannot explain.
       *
       * The ends are times now, not dates. That is the control keeping its shape while
       * what it can discriminate grows, which is what A14 meant.
       */
      await setSpan(page, 'date', 'from', '00:00');

      await expect(note).toBeVisible();
      const said = await note.innerText();
      expect(said).toMatch(/\d+/);
      expect(Number(said.replace(/\D/g, ''))).toBe(2);
      expect(said.toLowerCase()).toContain('no recorded date');
    });
});

test.describe('the question survives a reload', () => {
  test('R1: a filter is in the address, and comes back after a reload', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="dive"]').click();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);

    const chosen = await page.locator('[data-dim="dive"] span').first().innerText();
    const narrowed = await page.locator('#total').innerText();
    expect(page.url()).toContain('dive=');

    await page.reload();
    await ready(page);
    await openRail(page);

    /* The same question, not merely a page that loaded. */
    await expect(page.locator('[data-dim="dive"] span').first()).toHaveText(chosen);
    await expect(page.locator('#total')).toHaveText(narrowed);
  });

  test('R6: the address is a link — a fresh visit lands on the same question and page',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      await page.locator('[data-dim="dive"]').click();
      await page.locator('.menu [data-v]').nth(1).click();
      await page.keyboard.press('Escape');
      await ready(page);
      await page.locator('[data-page="next"]').click();
      await ready(page);

      const link = page.url();
      expect(link).toContain('page=2');
      const total = await page.locator('#total').innerText();

      /* Arriving cold at the address, the way somebody sent it would. */
      await page.goto(link);
      await ready(page);

      /* The question and the page number, not which observations are on it. How many
         tiles fit is measured from the window, so page two of the same question is
         honestly a different handful on a narrower screen -- and the page size is
         deliberately not in the address. Asserting membership here passed on a desktop and
         failed on a phone for a reason that has nothing to do with whether the link works. */
      await expect(page.locator('#total')).toHaveText(total);
      expect(page.url()).toContain('page=2');
      expect(await page.evaluate(() => window.MARP.state.page)).toBe(2);
      expect(await page.locator('.tile').count()).toBeGreaterThan(0);
    });

  test('R2: marks do not come back, because the record does not have them',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      const tile = page.locator('.tile:not(.failed):not(.queued)').first();
      await tile.click();
      await expect(page.locator('.tile.marked')).toHaveCount(1);

      await page.reload();
      await ready(page);
      /* #68 is explicit that undecided items from an uncommitted page may appear again.
         Restoring the mark would be worse than losing it: on screen it is indistinguishable
         from one that was committed, and the record agrees with neither. */
      await expect(page.locator('.tile.marked')).toHaveCount(0);
    });

  test('R3: an address that makes no sense still opens the application', async ({ page }) => {
    const errors = watchErrors(page);
    /* Every one of these is wrong in a different way: a mode that does not exist, a
       confidence outside its own bounds, a page that is not a page, a parameter naming
       no dimension. None of them may cost the reviewer a working screen. */
    await page.goto('./?mode=archaeology&confidence=5..9&page=0&utm_source=email');
    await ready(page);

    expect(await page.locator('.tile').count()).toBeGreaterThan(0);
    await expect(page.locator('.seg button.on')).toContainText('Scientific');
    expect(errors).toEqual([]);
  });

  test('R5: Reset restores the default question in one gesture', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    const before = await page.locator('#total').innerText();

    await page.locator('[data-dim="dive"]').click();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);
    expect(page.url()).toContain('dive=');

    await page.locator('#railReset').click();
    await ready(page);

    await expect(page.locator('[data-dim="dive"]')).toContainText('All dives');
    await expect(page.locator('#total')).toHaveText(before);
    /* Back to the default question is back to the bare address. */
    expect(page.url()).not.toContain('dive=');
  });

  test('R5: Reset keeps the mode the reviewer is working in', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="dive"]').click();
    await page.locator('.menu [data-v]').nth(1).click();
    await page.keyboard.press('Escape');
    await ready(page);

    await page.locator('#railReset').click();
    await ready(page);

    /* Clearing the filters is not leaving the workflow. */
    await expect(page.locator('#statusLbl')).toHaveText('Training disposition');
    expect(page.url()).toContain('mode=training');
  });
});

test.describe('a page resets, and a commit stays in its own mode', () => {
  /**
   * Training, with an exclusion genuinely on the record and in view.
   *
   * The exclusion is *made* rather than looked for. Waiting for the fixture to happen to
   * put one on the first page worked on a desktop and skipped on a phone, where fewer
   * tiles fit — and a skipped test reports green while proving nothing.
   */
  async function trainingWithExclusions(page) {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);

    /* Exclude one and commit, so the record carries it. Then it seeds as a mark on every
       later visit, which is the state both of these tests are about. */
    await page.locator('.tile:not(.failed):not(.queued)').first().click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'PROMOTED' }).first()).toBeVisible();

    await openRail(page);                       // collapsed by default on a phone
    await page.locator('#statusFilters [data-statuskey]', { hasText: 'Excluded' }).click();
    await ready(page);

    /* Re-query so the exclusion arrives from the record rather than sitting in the marks
       the commit left behind — otherwise these tests would pass on session state. */
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      state.marks = new Map();
      state.touched = new Set();
      state.outcomes = new Map();
      state.pageMembers = new Map();
      state.committedPages.clear();
      await actions.refresh();
    });
    await ready(page);

    /* Give the mosaic the screen back. On a phone the rail is an overlay, so leaving it
       open makes every tile present but covered — Playwright reports the element as
       resolved and never visible, which reads like a missing tile and is not one. */
    if (await page.evaluate(() => !document.body.classList.contains('rail-collapsed')
        && window.innerWidth < 760)) {
      await page.locator('#railbtn').click();
      await ready(page);
    }
    await expect(page.locator('.tile .badge', { hasText: 'EXCLUDED' }).first()).toBeVisible();
  }

  test('R1: Clear puts the page back as it arrived, and tags nothing taking back',
    async ({ page }) => {
      await trainingWithExclusions(page);

      const excluded = page.locator('.tile .badge', { hasText: 'EXCLUDED' });
      const before = await excluded.count();

      await page.keyboard.press('c');
      await page.waitForTimeout(600);

      /* Clearing used to empty the marks and mark every row on the page as hand-decided,
         which is never re-seeded — so the record's exceptions lost their mark, read as
         TAKING BACK, and the next commit would have promoted them. Reported 2026-09-08. */
      await expect(page.locator('.tile .badge', { hasText: 'TAKING BACK' })).toHaveCount(0);
      await expect(excluded).toHaveCount(before);
      expect(await page.evaluate(() => window.MARP.state.touched.size)).toBe(0);
    });

  test('R2: TAKING BACK still appears when the reviewer clicks an exclusion',
    async ({ page }) => {
      await trainingWithExclusions(page);
      const tagged = page.locator('.tile', { has: page.locator('.badge', { hasText: 'EXCLUDED' }) });

      /* The rule the fix must not break: one click on an excluded tile is exactly when
         taking back is meant to show. */
      const id = await tagged.first().getAttribute('data-id');
      await page.locator(`.tile[data-id="${id}"]`).click();
      await expect(page.locator(`.tile[data-id="${id}"] .badge`)).toContainText('TAKING BACK');
    });

  test('R3: a commit landing after a mode switch paints nothing in the new mode',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      /* Hold the commit open so the switch lands in the middle of it, rather than racing
         a 260 ms fixture latency and reporting the wrong thing one run in ten. */
      await page.evaluate(async () => {
        const { MarpData } = await import('./src/data.js');
        MarpData.slowNextCommit(4000);
      });

      await page.locator('.tile:not(.failed):not(.queued)').first().click();
      await page.locator('#commit').click();
      await page.waitForTimeout(300);

      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      await page.waitForTimeout(4200);              // let the scientific commit land

      /* `setMode` clears the outcomes for a reason: two independent decisions must not
         wear each other's answer. The commit path wrote them back unconditionally, so a
         whole page of scientific badges appeared in Training. */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
      await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' })).toHaveCount(0);
      expect(await page.evaluate(() => window.MARP.state.outcomes.size)).toBe(0);
      expect(await page.evaluate(() => window.MARP.state.committedPages.size)).toBe(0);
    });

  test('R4: a commit that stays in its own mode still applies', async ({ page }) => {
    /* The other half. A guard that discarded every commit would pass R3 and be useless. */
    await page.goto('./');
    await ready(page);
    await page.locator('.tile:not(.failed):not(.queued)').first().click();
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    expect(await page.evaluate(() => window.MARP.state.committedPages.size)).toBe(1);
  });
});

test.describe('a mode keeps its own session work', () => {
  /** Commit the page we are on, and wait for it to land. */
  async function commitAndSettle(page) {
    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    await ready(page);
  }

  const mode = (page) => page.evaluate(() => window.MARP.state.mode);
  const session = (page) => page.evaluate(() => ({
    pins: window.MARP.state.pageMembers.size,
    committed: window.MARP.state.committedPages.size,
    outcomes: window.MARP.state.outcomes.size,
    marks: window.MARP.state.marks.size
  }));

  test('R1: what was reviewed is still there after a trip through another mode',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await commitAndSettle(page);
      await page.locator('[data-page="next"]').click();
      await ready(page);                          // step off it, so its chip is drawn
      const before = await session(page);
      const chipsBefore = await page.locator('.pg.done').count();
      expect(before.committed).toBe(1);
      expect(chipsBefore).toBe(1);

      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
      await ready(page);

      /* `setMode` used to throw the pins, the committed pages and the outcomes away. That
         stopped one mode wearing another's answers and discarded the reviewer's session
         with it: three pages reviewed, one glance at Training, and no way back to what had
         been submitted. Reported 2026-09-08. */
      const after = await session(page);
      expect(after.pins).toBe(before.pins);
      expect(after.committed).toBe(before.committed);
      expect(after.outcomes).toBe(before.outcomes);
      /* `setMode` lands on page 1, which is the committed one, so it is already on screen. */
      await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

      /* Step off it to see its chip: the current page is a typable input rather than a
         chip, so it carries neither `data-page` nor the committed class. */
      await page.locator('[data-page="next"]').click();
      await ready(page);
      expect(await page.locator('.pg.done').count()).toBe(chipsBefore);
    });

  test('R2: uncommitted marks do not travel', async ({ page }) => {
    await page.goto('./');
    await ready(page);

    const before = (await session(page)).marks;
    await page.locator('.tile:not(.failed):not(.queued):not(.marked)').first().click();
    expect((await session(page)).marks).toBe(before + 1);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
    await ready(page);

    /* An uncommitted mark is a pending intention the reviewer walked away from. Only
       what reached the record comes back — and the record's own exceptions re-seed, which
       is why this compares against the arrival count rather than zero. */
    expect((await session(page)).marks).toBe(before);
  });

  test('R3: the other mode still sees none of this mode\'s outcomes', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await commitAndSettle(page);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);

    /* The isolation the clearing was protecting has to survive the parking. `.badge` is
       what this mode says; a REVIEWED tag from the record may legitimately appear as an
       `.rtag` under #85, and that is a different element on purpose. */
    expect(await mode(page)).toBe('training');
    expect((await session(page)).outcomes).toBe(0);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
  });

  test('R4: changing the question drops every mode\'s pinned pages', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await commitAndSettle(page);
    expect((await session(page)).committed).toBe(1);

    await openRail(page);                       // collapsed by default on a phone
    await page.locator('#railReset').click();
    await ready(page);

    /* A different question means a different result, so page 2 is not the same page 2.
       Parked pins would restore pages the filter no longer returns. */
    expect(await page.evaluate(() => window.MARP.state.parked.size)).toBe(0);

    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
    await ready(page);
    expect((await session(page)).committed).toBe(0);
  });
});

test.describe('"Marked this page" means this page', () => {
  const counter = (page) => page.locator('#markedCount');

  test('R1: a page you have not touched reads zero, and counts only its own marks',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      /* Mark two here, then walk to a page nobody has touched. `state.marks` spans the
         session by design, so the counter read the session total and only ever went up —
         a fresh page showed the marks left behind on the last one. Reported 2026-09-08. */
      await page.locator('.tile:not(.failed):not(.queued):not(.marked)').nth(0).click();
      await page.locator('.tile:not(.failed):not(.queued):not(.marked)').nth(0).click();
      const here = Number(await counter(page).innerText());
      expect(here).toBeGreaterThanOrEqual(2);

      await page.locator('[data-page="next"]').click();
      await ready(page);
      const fresh = Number(await counter(page).innerText());
      const seeded = await page.locator('.tile.marked').count();
      expect(fresh, 'a new page counts what is marked on it, not what was left behind')
        .toBe(seeded);
      expect(fresh).toBeLessThan(here);

      /* And marking here moves it by one, from the page's own number. */
      await page.locator('.tile:not(.failed):not(.queued):not(.marked)').first().click();
      expect(Number(await counter(page).innerText())).toBe(fresh + 1);
    });

  test('R2: going back to a page shows its own count again', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.tile:not(.failed):not(.queued):not(.marked)').nth(0).click();
    await page.locator('.tile:not(.failed):not(.queued):not(.marked)').nth(0).click();
    const first = Number(await counter(page).innerText());

    await page.locator('[data-page="next"]').click();
    await ready(page);
    await page.locator('[data-page="prev"]').click();
    await ready(page);

    /* The marks themselves must still be there — this is a display fix, not a change to
       what a mark survives. */
    expect(Number(await counter(page).innerText())).toBe(first);
    expect(await page.locator('.tile.marked').count()).toBe(first);
  });

  test('R3: Delete Mode names the number on this page, before destroying anything',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await page.locator('.tile:not(.failed):not(.queued):not(.marked)').first().click();

      await page.locator('.seg button', { hasText: 'Delete' }).click();
      await ready(page);
      await page.locator('.tile:not(.failed):not(.queued)').first().click();
      await page.locator('[data-page="next"]').click();
      await ready(page);

      /* The dangerous one. This note said "Permanently deletes the N marked tiles" with N
         being a session total, in front of an irreversible action. */
      const marked = await page.locator('.tile.marked').count();
      expect(Number(await counter(page).innerText())).toBe(marked);
      const note = await page.locator('#commitNote, #modeNote').first().innerText()
        .catch(() => '');
      if (/Permanently deletes the (\d+)/.test(note)) {
        expect(Number(note.match(/Permanently deletes the (\d+)/)[1])).toBe(marked);
      }
    });
});

test.describe('the commit button reports on itself', () => {
  test('it spins while saving, then confirms', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const commit = page.locator('#commit');
    const before = await commit.innerText();

    await commit.click();
    await expect(commit.locator('.spin')).toBeVisible();
    await expect(commit).toContainText('Saving');
    await expect(commit).toBeDisabled();

    await expect(commit).toContainText('Saved');
    await expect(commit).toHaveClass(/ok/);
    await expect(commit).toBeEnabled();

    /* The tick is an acknowledgement, not a state: it goes away again. */
    await expect(commit).toContainText(before.split('·')[0].trim(), { timeout: 6000 });
  });

  test('a failed commit says so, and changes nothing', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const id = await page.locator('.tile:not(.failed):not(.queued):not(.marked)')
      .first().getAttribute('data-id');
    await page.locator(`.tile[data-id="${id}"]`).click();

    await page.evaluate(() => import('./src/data.js').then((m) => m.MarpData.failNextCommit()));
    const commit = page.locator('#commit');
    await commit.click();

    await expect(commit).toContainText('Failed');
    await expect(commit).toHaveClass(/bad/);
    /* Nothing was applied, and the mark survives so the page need not be redone. */
    await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
    await expect(page.locator('.pg.done')).toHaveCount(0);
  });
});

test.describe('how many pages are done', () => {
  test('the count rises with each committed page, beside the swatch', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const done = page.locator('#pagesDone');
    await expect(done).toContainText('0 of');

    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
    await expect(done).toContainText('1 of');

    await page.locator('[data-page="next"]').click();
    await ready(page);
    await page.locator('#commit').click();
    await expect(done).toContainText('2 of');

    /* It counts pages, not visits: going back to one already committed adds nothing. */
    await page.locator('[data-page="prev"]').click();
    await ready(page);
    await expect(done).toContainText('2 of');
  });

  test('it resets when the question changes', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('#commit').click();
    await expect(page.locator('#pagesDone')).toContainText('1 of');

    /* A different mode is a different set of decisions, so the tally starts again. */
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);
    await expect(page.locator('#pagesDone')).toContainText('0 of');
  });

  test('it survives on a phone, where the trailing words do not', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'about the phone layout');
    await page.goto('./');
    await ready(page);
    await expect(page.locator('#pagesDone')).toBeVisible();
    await expect(page.locator('#pagesDone .lw')).toBeHidden();
    /* The footer must still not wrap, which is what hid the legend in the first place. */
    const bar = await page.locator('.foot').boundingBox();
    expect(bar.height).toBeLessThan(80);
  });
});

/* ------------------------------------------- where progress lives (#91) */

test.describe('progress is not in the rail', () => {
  /* The header row, said precisely. A second status dimension draws its heading as
     `.lbl sub` inside the rail, so a bare `.sub` locator resolves two elements and
     every strict-mode call on it throws -- and since #89 that heading is in every
     mode, not just Delete. */
  const HEADER = '.app > .sub';

  test('it rides the sub bar, on the sort control\'s row', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the phone drops progress; see the phone test below');
    await page.goto('./');
    await ready(page);

    /* The rail collapses, resets and scrolls, and progress belongs to the whole review
       rather than to the filters — so none of those three may be able to take it off
       screen. Since #89 gave every mode six status boxes the rail scrolls in all of
       them, which is what made this the wrong home rather than an unlucky one.
       The ancestry is the assertion: a coordinate check would still pass with the bar
       back inside the rail on a tall enough window. */
    await expect(page.locator(HEADER + ' .prog')).toBeVisible();
    await expect(page.locator('.rail .prog')).toHaveCount(0);

    /* Same row as the sort, and in front of it. The sort is still the end of the row. */
    const prog = await page.locator(HEADER + ' .prog').boundingBox();
    const sort = await page.locator('#sortBtn').boundingBox();
    expect(Math.abs((prog.y + prog.height / 2) - (sort.y + sort.height / 2)),
      'progress and the sort share a row').toBeLessThan(2);
    expect(prog.x + prog.width, 'the sort stays at the end').toBeLessThanOrEqual(sort.x + 1);

    /* `.sub` is a fixed-height band, so a second line is clipped rather than shown:
       three stacked divs moved into it wholesale would have been invisible. */
    const sub = await page.locator(HEADER).boundingBox();
    expect(sub.height).toBeLessThan(40);
  });

  test('the updater still reaches all three ids', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await expect(page.locator('#progPct')).toHaveText('0%');

    await page.locator('#commit').click();
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    /* The move kept `progPct`, `progBar` and `progText` precisely so the `subscribe`
       block in index.html did not have to change. This is what proves it did not. */
    await expect(page.locator('#progPct')).not.toHaveText('0%');
    await expect(page.locator('#progText')).toContainText(' of ');
    expect(await page.locator('#progBar').evaluate((el) => el.style.width)).not.toBe('0%');
  });

  test('a phone drops progress rather than pushing the sort off the row',
    async ({ page }, info) => {
      test.skip(info.project.name !== 'phone', 'about the phone layout');
      await page.goto('./');
      await ready(page);

      /* The first version of this asserted the opposite -- bar and percentage kept, only
         the wording dropped -- and it cost M3, which requires the whole sort control to
         sit inside the viewport. This row scrolls sideways here, so anything progress
         spends on width is not a smaller sort but a sort past the end of the row. Between
         the two, progress is the item this row can do without. */
      await expect(page.locator(HEADER + ' .prog')).toBeHidden();

      const sort = await page.locator('#sortBtn').boundingBox();
      const width = await page.evaluate(() => window.innerWidth);
      expect(sort.x, 'the sort starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect(sort.x + sort.width, 'and ends inside it, unscrolled')
        .toBeLessThanOrEqual(width + 1);

      /* Desktop still has it, so this is a width concession and not a removal. */
      await page.setViewportSize({ width: 1600, height: 900 });
      await ready(page);
      await expect(page.locator(HEADER + ' .prog')).toBeVisible();
      await expect(page.locator('#progPct')).toBeVisible();
    });
});

/* ------------------------------------------- the delete confirmation (#71) */

test.describe('the delete confirmation', () => {
  /**
   * Into Delete Mode with `n` tiles marked, ready to commit.
   *
   * The mode is chosen by clicking the segment, not by a query parameter -- the app
   * does not read one. An earlier version of these tests used `?mode=delete`, ran the
   * whole thing in scientific review, and reported a missing dialog when what had
   * actually happened was an ordinary review commit.
   */
  async function markForDeletion(page, n) {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    const ids = [];
    for (let i = 0; i < n; i++) {
      const tile = page.locator('.tile:not(.marked):not(.failed)').first();
      const id = await tile.getAttribute('data-id');
      ids.push(id);
      await page.locator(`.tile[data-id="${id}"]`).click();
    }
    await expect(page.locator('.tile.marked')).toHaveCount(n);
    return ids;
  }

  test('R2/R3: it names the number and says the deletion is permanent', async ({ page }) => {
    await markForDeletion(page, 3);
    await page.locator('#commit').click();

    const box = page.locator('.confirm__box');
    await expect(box).toBeVisible();
    await expect(box.locator('.confirm__title')).toContainText('3 observations');
    await expect(box.locator('.confirm__warn')).toContainText('cannot be undone');
  });

  test('R5: focus starts on Cancel, and Escape cancels', async ({ page }) => {
    const ids = await markForDeletion(page, 2);
    await page.locator('#commit').click();
    await expect(page.locator('.confirm__box')).toBeVisible();

    /* Enter and Space are what somebody hits without reading, so neither may destroy
       anything: the focused control is Cancel. */
    await expect(page.locator('[data-confirm="cancel"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.confirm__box')).toHaveCount(0);

    /* Cancelled means nothing happened at all -- the marks are still there, so the
       page does not have to be redone. */
    await expect(page.locator('.tile.marked')).toHaveCount(2);
    for (const id of ids) {
      await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/marked/);
    }
    await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
  });

  test('R2: confirming deletes exactly the number it named', async ({ page }) => {
    await markForDeletion(page, 4);
    await page.locator('#commit').click();
    await expect(page.locator('.confirm__title')).toContainText('4 observations');

    await page.locator('[data-confirm="go"]').click();
    await expect(page.locator('.confirm__box')).toHaveCount(0);
    await expect(page.locator('.tile.out-deleted')).toHaveCount(4);
  });

  test('A5: with nothing marked, there is nothing to confirm', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);

    /* #71 settled that confirming a deletion of zero records must never happen, because
       it teaches people to dismiss the dialog without reading it. #72 made that
       unreachable rather than merely handled: the button is disabled, so the click cannot
       be made at all. Asserting the stronger guarantee. */
    await expect(page.locator('#commit')).toBeDisabled();
    await expect(page.locator('.confirm__box')).toHaveCount(0);
    await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
  });

  test('R4: scientific review commits with no confirmation at all', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('#commit').click();
    await expect(page.locator('#commit')).toContainText('Saved');
    await expect(page.locator('.confirm__box')).toHaveCount(0);
  });
});

/* ------------------------------------ the states never rendered (#72) */

test.describe('the states never rendered', () => {
  /** Empty the mosaic by asking for something that does not exist. */
  async function emptyIt(page) {
    await page.goto('./');
    await ready(page);
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      /* An array: every set dimension has held one since #77. This was a bare string,
         which happened to produce an empty result for the wrong reason. */
      state.filters.species = ['No Such Species'];
      await actions.refresh();
    });
  }

  test('R1: an empty result says so, and offers the way out', async ({ page }) => {
    await emptyIt(page);
    await expect(page.locator('#field')).toHaveAttribute('data-state', /empty|filtered-out/);
    await expect(page.locator('.pagestate--empty')).toBeVisible();
    await expect(page.locator('.pagestate--empty')).toContainText('Nothing to review here');
    await expect(page.locator('[data-act="clear-filters"]')).toBeVisible();
  });

  test('R1: clearing the filters brings the mosaic back', async ({ page }) => {
    await emptyIt(page);
    await page.locator('[data-act="clear-filters"]').click();
    await ready(page);
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.pagestate')).toHaveCount(0);
  });

  test('R3: a page with no imagery disables the commit and says why', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      const { MarpData } = await import('./src/data.js');
      MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
      await actions.refresh();
    });
    await expect(page.locator('#commit')).toBeDisabled();
    await expect(page.locator('#commit')).toContainText('nothing to do');
    await expect(page.locator('.pagestate--banner')).toBeVisible();
  });

  test('R7: the banner offers to ask for the imagery again', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      const { MarpData } = await import('./src/data.js');
      MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
      await actions.refresh();
    });
    await page.locator('[data-act="retry-thumbnails"]').click();

    /**
     * **The retry asks; it does not deliver** (F10, R12, A9).
     *
     * The endpoint answers `queued` and never a synchronous `ready` — an accepted retry
     * has not happened yet, and extraction runs at three concurrent Jellyfin streams. So
     * the first thing the reviewer sees is a page of PREPARING tiles, and the commit stays
     * disabled because accepting a tile means somebody looked at it.
     *
     * This asserted `#commit` was enabled the moment the click returned, which was only
     * ever true because the fixture invented the picture on the spot.
     */
    await expect(page.locator('.tile.queued').first()).toBeVisible();
    await expect(page.locator('#commit')).toBeDisabled();

    /* And then the poll turns them into pictures: one request and one repaint per round,
       on a backoff, stopping when nothing is queued. That is what clears the banner. */
    await expect(page.locator('.pagestate--banner')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('#commit')).toBeEnabled({ timeout: 30000 });
  });

  test('R5: the button says how many will be skipped', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      const { MarpData } = await import('./src/data.js');
      MarpData.breakThumbnails(state.rows.slice(0, 3).map((r) => r.observation_id));
      await actions.refresh();
    });
    await expect(page.locator('#skipNote')).toBeVisible();
    await expect(page.locator('#skipNote')).toContainText('without imagery');
  });

  test('R9: the reason list can say nobody could see it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const id = await page.locator('.tile:not(.marked)').first().getAttribute('data-id');
    await page.locator(`.tile[data-id="${id}"]`).click();
    await page.locator(`.tile[data-id="${id}"] [data-badge]`).click();
    await expect(page.locator('.pick')).toBeVisible();
    await expect(page.locator('.pick .chip', { hasText: 'No imagery' })).toBeVisible();
  });
});

/* ------------------------------------------- keyboard shortcuts (#74) */

test.describe('keyboard shortcuts', () => {
  test('R1: N pages forward and P comes back', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const first = await page.locator('.tile').first().getAttribute('data-id');

    await page.keyboard.press('n');
    await ready(page);
    const second = await page.locator('.tile').first().getAttribute('data-id');
    expect(second).not.toBe(first);

    await page.keyboard.press('p');
    await ready(page);
    await expect(page.locator('.tile').first()).toHaveAttribute('data-id', first);
  });

  test('R2: C clears the marks on the page', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const id = await page.locator('.tile:not(.marked)').first().getAttribute('data-id');
    await page.locator(`.tile[data-id="${id}"]`).click();
    await expect(page.locator('.tile.marked')).toHaveCount(1);

    await page.keyboard.press('c');
    await expect(page.locator('.tile.marked')).toHaveCount(0);
  });

  test('R3: the number keys switch mode', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.keyboard.press('3');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'delete');
    await page.keyboard.press('2');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'training');
    await page.keyboard.press('1');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'scientific');
  });

  test('R4: Enter alone does not commit; Ctrl+Enter does', async ({ page }) => {
    await page.goto('./');
    await ready(page);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);

    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
  });

  /* The rule and the wiring can each be right while the pair is wrong: this proves
     mount.js actually tells resolveKey that an input has focus. */
  test('R5: typing in the species search does not page', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const before = await page.locator('.tile').first().getAttribute('data-id');

    /* The rail starts collapsed on a phone, so the species control is not reachable
       until it is opened. The shortcut rule is the same either way; getting to the
       input is what differs. */
    await openRail(page);
    await page.locator('[data-dim="species"]').click();
    await page.locator('.menu input').first().fill('no');
    await page.waitForTimeout(500);

    await expect(page.locator('.tile').first()).toHaveAttribute('data-id', before);
  });

  test('R6: the shortcuts are drawn on the controls they duplicate', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await expect(page.locator('#commit')).toHaveAttribute('data-key', 'Ctrl+Enter');
    await expect(page.locator('#clearMarks')).toHaveAttribute('data-key', 'C');
    await expect(page.locator('.seg button[data-mode="delete"]')).toHaveAttribute('data-key', '3');
  });

  test('R7: Ctrl+Enter on a page that cannot be committed says so', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.evaluate(async () => {
      const { state, actions } = await import('./src/store.js');
      const { MarpData } = await import('./src/data.js');
      MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
      await actions.refresh();
    });
    await expect(page.locator('#commit')).toBeDisabled();

    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#commit')).toHaveClass(/nudge/);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
  });
});

/**
 * #81 — the reported bugs and the crowding.
 *
 * All of these are about what is on the screen, which is why they are here rather than in
 * `tests/unit/`. Four were reported from use, and the store was right for every one of
 * them: the menus held the right values, the status filter held the right key, and the
 * rail declared every dimension it was asked to. None of that is what the reviewer saw.
 */
test.describe('the filter rail, cleaned up', () => {
  /** The entry that clears a set dimension, by the text it carries. */
  const allEntry = (page, label) => page.locator('.menu [data-v=""]', { hasText: label });

  test('B1: choosing a project unticks "All projects" while the menu is open',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      await page.locator('[data-dim="project"]').click();
      await expect(page.locator('.menu')).toBeVisible();
      await expect(allEntry(page, 'All projects')).toHaveClass(/on/);

      /* The menu deliberately stays open, so the reviewer is looking at both entries at
         once. Before the fix only the clicked entry restated itself, and the menu claimed
         "All projects" and one project simultaneously. */
      await page.locator('.menu [data-v]').nth(1).click();
      await expect(page.locator('.menu')).toBeVisible();
      await expect(allEntry(page, 'All projects')).not.toHaveClass(/on/);
      await expect(allEntry(page, 'All projects').locator('.tick')).toBeEmpty();

      /* And back again: taking the last specific value off means the dimension is not
         filtering, which is what "All projects" says. */
      await page.locator('.menu [data-v]').nth(1).click();
      await expect(allEntry(page, 'All projects')).toHaveClass(/on/);
    });

  test('B1: the dive and line menus behave the same way', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    for (const [key, label] of [['dive', 'All dives'], ['line', 'All lines']]) {
      await page.locator(`[data-dim="${key}"]`).click();
      await expect(allEntry(page, label)).toHaveClass(/on/);
      await page.locator('.menu [data-v]').nth(1).click();
      await expect(allEntry(page, label), `${key} still claims ${label}`)
        .not.toHaveClass(/on/);
      await page.keyboard.press('Escape');
      await ready(page);
    }
  });

  test('B2: clicking the button that opened a menu closes it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    const project = page.locator('[data-dim="project"]');
    await project.click();
    await expect(page.locator('.menu')).toHaveCount(1);

    /* It used to close and immediately reopen, so the button read as inert. */
    await project.click();
    await expect(page.locator('.menu')).toHaveCount(0);

    /* And a click on a different button moves the menu rather than only dismissing. */
    await project.click();
    await expect(page.locator('.menu')).toHaveCount(1);
    await page.locator('[data-dim="species"]').click();
    await expect(page.locator('.menu')).toHaveCount(1);
    await expect(page.locator('.menu .mhead')).toContainText('species');
  });

  test('B2: it still closes after a pick has redrawn the rail underneath it',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      /* The rail is redrawn from state on every change, so the button that opened the
         menu is replaced by an identical one while the menu is still up. Holding the
         element rather than its name would make this second click open a new menu. */
      const project = page.locator('[data-dim="project"]');
      await project.click();
      await page.locator('.menu [data-v]').nth(1).click();
      await ready(page);

      await project.click();
      await expect(page.locator('.menu')).toHaveCount(0);
    });

  test('B3: the time controls are 24-hour, with no AM or PM anywhere', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    await page.locator('[data-dim="timeOfDay"]').click();
    const from = page.locator('[data-span="timeOfDay"] [data-end="from"]');
    await expect(from).toBeVisible();

    /* A native `<input type="time">` draws 12-hour from the browser locale and there is
       no attribute that changes it -- `lang="en-GB"` was tried in this same Chromium and
       still drew `01:30 PM`. So these are text fields, and what the field holds is
       exactly what is on the screen, which is what makes this assertable at all. */
    await expect(from).toHaveAttribute('type', 'text');
    await from.fill('13:30');
    await from.press('Enter');
    await expect(from).toHaveValue('13:30');

    const panel = await page.locator('.menu--panel').innerText();
    expect(panel.toLowerCase()).not.toMatch(/\b(am|pm)\b/);
    expect(panel).toContain('24-hour');

    /* And the summary on the rail button says the same thing back, in the same clock. */
    await expect(page.locator('[data-dim="timeOfDay"]')).toContainText('13:30');

    /* A time that is not a time does not become a filter, and does not sit in the field
       looking as though it did. */
    await from.fill('noon');
    await from.press('Enter');
    await expect(from).toHaveValue('');

    /* Shorthand is read the way it is meant, and the field says what was understood. */
    await from.fill('930');
    await from.press('Enter');
    await expect(from).toHaveValue('09:30');
  });

  test('L4: confidence is one track carrying two handles', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    const from = page.locator('[data-span="confidence"] [data-end="from"]');
    const to = page.locator('[data-span="confidence"] [data-end="to"]');
    const a = await from.boundingBox();
    const b = await to.boundingBox();

    /* Two stacked sliders is what this replaced, so the assertion is that they occupy
       the same strip: same top, same left, same width. Stacked, the second sat a row
       below the first and the pair read as two independent numbers. */
    expect(Math.round(a.y)).toBe(Math.round(b.y));
    expect(Math.round(a.x)).toBe(Math.round(b.x));
    expect(Math.round(a.width)).toBe(Math.round(b.width));
    await expect(page.locator('[data-span="confidence"] .dual__track')).toHaveCount(1);

    /* And the fill between the handles follows them, which is the only thing that makes
       one track legible as a range rather than as two dots. */
    await from.evaluate((el) => {
      el.value = '0.4';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('[data-span="confidence"]'))
      .toHaveAttribute('style', /--from:\s*40%/);
    await expect(page.locator('.span-val')).toContainText('0.40');
  });

  test('L5: time and date take one rail row each', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    /* Two native inputs each did not fit side by side in the rail column, so they
       wrapped, and the pair took three rows between them. Behind a summary button they
       take one row each, and the popover has the width the controls need. */
    for (const key of ['timeOfDay', 'date']) {
      await expect(page.locator(`#railDimensions [data-span="${key}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-dim="${key}"]`)).toHaveCount(1);
    }

    const one = await page.locator('[data-dim="timeOfDay"]').boundingBox();
    const two = await page.locator('[data-dim="date"]').boundingBox();
    expect(two.y - one.y).toBeLessThan(60);      // label plus control, and nothing more

    await page.locator('[data-dim="date"]').click();
    await expect(page.locator('.menu--panel [data-span="date"] [data-end="from"]'))
      .toBeVisible();
    await expect(page.locator('.menu--panel [data-span="date"] [data-end="to"]'))
      .toBeVisible();
  });

  test('L6: the reset is the first control in the rail, and costs almost nothing',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      const reset = await page.locator('#railReset').boundingBox();
      const collapse = await page.locator('#railbtn').boundingBox();
      const firstFilter = await page.locator('#railDimensions .lbl').first().boundingBox();

      expect(reset.y).toBeLessThan(firstFilter.y);
      expect(reset.width).toBeLessThanOrEqual(collapse.width + 1);
      /* It says what it is to a screen reader and on hover; it does not spend a word on
         saying it in the rail. */
      await expect(page.locator('#railReset')).toHaveAttribute('aria-label', /reset/i);
    });

  test('L7: nothing in the rail is drawn where it cannot be reached', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    /* The rail was `overflow: hidden` over content taller than it, so the status filters
       were drawn below the fold and could not be reached at all. A rail that hides
       controls silently is worse than one that scrolls. The progress bar was the other
       thing lost that way, and #91 took it out of the rail altogether rather than
       leaving it to be rescued by the scrolling — it is asserted where it lives now, in
       `progress is not in the rail` above.
       `.rail-body` is what scrolls, so *reachable* is the claim, not "fits without
       scrolling" — that proxy held only while the rail had three status boxes in it. Since
       #89 gave every mode six, Scientific's rail scrolls the way Delete's always has, and
       asserting the proxy would have meant weakening the rail rather than the test.
       Checked in every mode now, which is the gap the old version left: Delete Mode has
       had two dimensions since #71 and was never asked this question.

       **`scrollIntoView` is not the test, and that mistake was made here first.**
       `overflow: hidden` is still scrollable *programmatically*, so a version of this that
       scrolled each control into view and measured it passed with the original bug put
       back. What a person can reach is decided by the container: it has to be scrollable
       whenever its content is taller than it is. */
    for (const mode of ['Scientific Data Review', 'Training Data Review', 'Delete']) {
      await page.locator('.seg button', { hasText: mode }).click();
      await ready(page);
      await openRail(page);

      /* Measured in one evaluate, because doing it across several Playwright calls raced
         the rail's own re-render and failed once in three runs on desktop for that and
         nothing else. A flaky rail test teaches people to re-run rather than look. */
      const rail = await page.evaluate(() => {
        const body = document.querySelector('.rail-body');
        const style = getComputedStyle(body);
        return {
          overflowY: style.overflowY,
          overflows: body.scrollHeight > body.clientHeight + 1
        };
      });

      /* The bug: content taller than a container nobody can scroll. */
      if (rail.overflows) {
        expect(['auto', 'scroll'], `the rail overflows in ${mode} and must scroll`)
          .toContain(rail.overflowY);
      }

      for (const sel of ['#statusFilters [data-status="unreviewed"]',
                         '#statusFilters [data-status="reviewed"]']) {
        await expect(page.locator(sel), `${sel} is drawn in ${mode}`).toHaveCount(1);
        const box = await page.evaluate((s) => {
          const el = document.querySelector(s);
          const body = document.querySelector('.rail-body');
          if (!el) return null;
          const a = el.getBoundingClientRect();
          const b = body.getBoundingClientRect();
          /* Where it sits in the scrollable content, not on screen — so an element below
             the fold of a rail that scrolls is reachable, and one outside the content box
             of a rail that does not scroll is not. */
          return {
            height: a.height,
            top: (a.top - b.top) + body.scrollTop,
            bottom: (a.bottom - b.top) + body.scrollTop,
            reachable: body.scrollHeight
          };
        }, sel);

        expect(box, `${sel} is drawn in ${mode}`).not.toBeNull();
        expect(box.height, `${sel} has a size in ${mode}`).toBeGreaterThan(0);
        expect(box.top, `${sel} is above the rail's content in ${mode}`)
          .toBeGreaterThanOrEqual(-1);
        expect(box.bottom, `${sel} is past the end of the rail's content in ${mode}`)
          .toBeLessThanOrEqual(box.reachable + 1);
      }
    }
  });

  test('M1: the field and the direction are chosen separately, and both are on screen',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      /* The sub-bar says both halves without anything being opened. It used to carry one
         phrase from a fixed list, so which way the mosaic was ordered was something to
         work out rather than something to read. */
      await expect(page.locator('#sortLabel')).toHaveText('Confidence ↑ low first');

      await page.locator('#sortBtn').click();
      await expect(page.locator('.menu')).toBeVisible();
      await expect(page.locator('.menu .mhead').first()).toHaveText('Sort by');

      /* Change the field. The menu stays open, and its direction entries reword
         themselves for the field that is now chosen. */
      await page.locator('.menu [data-v="keyframe_count"]').click();
      await ready(page);
      await expect(page.locator('.menu')).toBeVisible();
      await expect(page.locator('.menu [data-v="keyframe_count"]')).toHaveClass(/on/);
      await expect(page.locator('.menu [data-v="desc"]')).toContainText('Longest first');
      await expect(page.locator('#sortLabel')).toHaveText('Track length ↑ shortest first');

      /* And the direction on its own, keeping the field. */
      await page.locator('.menu [data-v="desc"]').click();
      await ready(page);
      await expect(page.locator('.menu [data-v="desc"]')).toHaveClass(/on/);
      await expect(page.locator('.menu [data-v="asc"]')).not.toHaveClass(/on/);
      await expect(page.locator('#sortLabel')).toHaveText('Track length ↓ longest first');

      await page.keyboard.press('Escape');
      /* It is a real order, not just a label: the address carries it and a reload keeps it. */
      expect(page.url()).toContain('sort=keyframe_count.desc');
    });

  test('M2: a secondary sort is chosen in the same menu, and reaches the address',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);

      await page.locator('#sortBtn').click();
      await expect(page.locator('.menu [data-v="then:none"]')).toHaveClass(/on/);
      /* The primary's own field is not offered as the tie-break: a term that can never be
         reached is not a sort. */
      await expect(page.locator('.menu [data-v="then:confidence"]')).toHaveCount(0);

      await page.locator('.menu [data-v="then:keyframe_count"]').click();
      await ready(page);

      /* The menu stays open and grows a direction pair worded for the field just chosen. */
      await expect(page.locator('.menu')).toBeVisible();
      await expect(page.locator('.menu [data-v="then:keyframe_count"]')).toHaveClass(/on/);
      await expect(page.locator('.menu [data-v="then:desc"]')).toContainText('Longest first');
      await expect(page.locator('#sortLabel'))
        .toHaveText('Confidence ↑ low first, then Track length ↑ shortest first');

      await page.locator('.menu [data-v="then:desc"]').click();
      await ready(page);
      await expect(page.locator('#sortLabel'))
        .toHaveText('Confidence ↑ low first, then Track length ↓ longest first');

      await page.keyboard.press('Escape');
      expect(page.url()).toContain('sort=confidence.asc,keyframe_count.desc');

      /* And it survives the reload, which is the whole of #79's claim about this branch. */
      await page.reload();
      await ready(page);
      await expect(page.locator('#sortLabel'))
        .toHaveText('Confidence ↑ low first, then Track length ↓ longest first');
    });

  test('M2: the tie-break really breaks ties, and the primary still governs',
    async ({ page }) => {
      /* Confidence carries two decimal places over four hundred-odd rows, so the primary
         ties constantly and the secondary has real work to do. A menu that recorded a
         secondary and ordered nothing by it would pass every other M2 assertion. */
      const idsFor = async (sort) => {
        await page.goto(`./?sort=${sort}`);
        await ready(page);
        return page.locator('.tile').evaluateAll((els) => els.map((e) => e.dataset.id));
      };

      const up = await idsFor('confidence.asc,keyframe_count.asc');
      const down = await idsFor('confidence.asc,keyframe_count.desc');

      expect(up.length).toBeGreaterThan(10);
      expect(down.length).toBe(up.length);
      expect(down.join(','), 'reversing the tie-break must reorder the page')
        .not.toBe(up.join(','));

      /* The primary is still the first word: whatever the tie-break does, confidence never
         goes backwards. Read from the store, because a tile does not draw its confidence. */
      const climbing = await page.evaluate(async () => {
        const { state } = await import('./src/store.js');
        return state.rows.every((r, i) => i === 0 || r.confidence >= state.rows[i - 1].confidence);
      });
      expect(climbing, 'the secondary must only break ties, never reorder across them')
        .toBe(true);
    });

  test('M3: a phone sorts with the same control, at the same size', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'about the phone layout');
    await page.goto('./');
    await ready(page);

    const button = page.locator('#sortBtn');
    await expect(button).toBeVisible();

    /* Reachable without hunting: the whole control is inside the viewport, rather than
       pushed off the end of a bar that happens to scroll. */
    const box = await button.boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

    /* And the same control, not a smaller one. It was hidden here once, and then given a
       smaller font and less padding, which is the same answer in a politer form. */
    const style = (el) => el.evaluate((e) => {
      const s = getComputedStyle(e);
      return `${s.fontSize} ${s.paddingTop} ${s.paddingLeft}`;
    });
    const onPhone = await style(button);
    await page.setViewportSize({ width: 1600, height: 900 });
    await ready(page);
    expect(onPhone, 'the phone gets the same control as the desktop')
      .toBe(await style(button));

    /* Usable, not merely present: the whole secondary sort is driven at phone width. */
    await page.setViewportSize({ width, height: 839 });
    await ready(page);
    await button.click();
    await page.locator('.menu [data-v="then:updatedAt"]').click();
    await ready(page);
    await page.locator('.menu [data-v="then:desc"]').click();
    await ready(page);
    await expect(page.locator('#sortLabel'))
      .toHaveText('Confidence ↑ low first, then Last updated ↓ newest first');
  });

  test('M1: the order actually applied changes when the direction does', async ({ page }) => {
    await page.goto('./?sort=confidence.asc');
    await ready(page);
    const lowest = await page.locator('.tile').first().getAttribute('data-id');

    await page.goto('./?sort=confidence.desc');
    await ready(page);
    const highest = await page.locator('.tile').first().getAttribute('data-id');

    /* A menu that reorders nothing would pass every assertion above. */
    expect(highest).not.toBe(lowest);
  });

  test('B4: a status filter draws one control, not two', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    /* The second control was a keyboard-shortcut badge. `renderStatusFilters` wrote
       `data-key="reviewStatus"` to name the status dimension, and #74's
       `[data-key]::after { content: attr(data-key) }` drew that value beside the label as
       a grey pill. Two meanings for one attribute, and the pill read `reviewStatus`. */
    const unreviewed = page.locator('#statusFilters [data-status="unreviewed"]');
    await expect(unreviewed).toBeVisible();
    const badge = await unreviewed.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(badge, 'a status checkbox draws no badge of any kind').toBe('none');

    /* And the badge still works where it belongs, so this is not a fix by deletion. */
    const commit = await page.locator('#commit').evaluate(
      (el) => getComputedStyle(el, '::after').content);
    expect(commit).not.toBe('none');
  });
});

/* -------------------------------------------------------------------------- #89
   Every mode filters on both workflow statuses, the way Delete already does.

   These are here rather than in the unit tier because the rail is what the reviewer sees,
   and because the claim that matters most — that Scientific's default result set did not
   move — is only true end to end. The store has been correct every time a rendering
   defect shipped here. */

/** What the store is filtering on, and how many rows the question returns. */
const question = (page) => page.evaluate(() => ({
  total: window.MARP.state.total,
  reviewStatus: window.MARP.state.filters.reviewStatus,
  trainingDisposition: window.MARP.state.filters.trainingDisposition
}));

/**
 * The default result count worked out from the fixture itself, independently of the app.
 *
 * Deliberately not "whatever the app said last time": a test that compares the app to
 * itself cannot tell that the borrowed dimension started narrowing. This counts the rows
 * the default question is *meant* to return — one species, unreviewed or flagged, every
 * training disposition — and reports the promoted and excluded share, which is exactly
 * what a careless `defaultStatusFor` would silently remove.
 */
/* Derived from the fixture file, never from the app -- a check that asks the application
   what it expects cannot see the count move, which is the whole point of this one.
   `comname === 'Bat Star'` was here because the default question opened on that species.
   A10(b) removed that literal, so the default narrows by status alone and this must too;
   leaving the species in would compare the app against a question it no longer asks.
   Independently counted in the fixture: 3,000 observations, 2,755 with a null
   `review_decision` and 245 reviewed, so the default view is the 2,755. */
const expectedDefault = (page) => page.evaluate(async () => {
  const res = await fetch('./fixtures/observations.json');
  const db = await res.json();
  const rows = db.observations.filter((r) => !r.deleted
    && ['flagged', null].includes(r.review_decision));
  return {
    total: rows.length,
    decided: rows.filter((r) => r.training_decision != null).length
  };
});

test.describe('every mode filters on both workflow statuses', () => {
  test('R3: Scientific opens with no training narrowing, and its total does not move',
    async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      await ready(page);

      const want = await expectedDefault(page);
      /* If this were zero the check below would pass while narrowing everything, so the
         fixture's own shape is asserted before it is relied on. */
      expect(want.decided,
        'the fixture must hold promoted or excluded rows in the default view, or this proves nothing')
        .toBeGreaterThan(0);

      const got = await question(page);
      expect(got.trainingDisposition,
        'the borrowed dimension must arrive not filtering, not at its owner\'s default')
        .toEqual([]);
      expect(got.reviewStatus).toEqual(['unreviewed', 'flagged']);
      expect(got.total,
        `the default result set must not move: ${want.decided} promoted/excluded rows are at stake`)
        .toBe(want.total);

      /* And the default question is still the bare address. */
      expect(new URL(page.url()).search).toBe('');
      expect(errors).toEqual([]);
    });

  test('R1: Scientific\'s rail draws both dimensions, its own first', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);

    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');

    /* Six boxes, and the borrowed three unticked. The tick is the whole claim: a group
       drawn with all three ticked is what would have hidden the rows. */
    await expect(page.locator('#statusFilters [data-status]')).toHaveCount(6);
    for (const value of ['undecided', 'promoted', 'excluded']) {
      await expect(page.locator(
        `#statusFilters [data-statuskey="trainingDisposition"][data-status="${value}"] .box`))
        .not.toHaveClass(/\bon\b/);
    }
    for (const value of ['unreviewed', 'flagged']) {
      await expect(page.locator(
        `#statusFilters [data-statuskey="reviewStatus"][data-status="${value}"] .box`))
        .toHaveClass(/\bon\b/);
    }

    /* Every box carries a count. They come from the same query Delete's do, over the
       non-status filters only, so a borrowed count can exceed the result total. */
    const counts = await page.locator('#statusFilters [data-status] .n').allTextContents();
    expect(counts).toHaveLength(6);
    expect(counts.every((c) => /^[\d,]+$/.test(c.trim()))).toBe(true);
  });

  test('R1: Training\'s rail leads on its own dimension and borrows review status',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
      await ready(page);
      await openRail(page);

      await expect(page.locator('#statusLbl')).toHaveText('Training disposition');
      await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Review status');
      await expect(page.locator('#statusFilters [data-status]')).toHaveCount(6);

      const got = await question(page);
      expect(got.trainingDisposition).toEqual(['undecided']);
      expect(got.reviewStatus, 'borrowed, so it arrives narrowing nothing').toEqual([]);
    });

  test('R9: ticking Excluded in Scientific narrows to excluded observations',
    async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      await ready(page);
      await openRail(page);

      await page.locator(
        '#statusFilters [data-statuskey="trainingDisposition"][data-status="excluded"]').click();
      await ready(page);

      await expect(page.locator(
        '#statusFilters [data-statuskey="trainingDisposition"][data-status="excluded"] .box'))
        .toHaveClass(/\bon\b/);

      /* Drawn, not merely stored: every tile on the page wears the borrowed EXCLUDED tag,
         which is the visible consequence of the filter having been applied. */
      const tiles = await page.locator('.tile').count();
      expect(tiles).toBeGreaterThan(0);
      await expect(page.locator('.tile .rtag', { hasText: 'EXCLUDED' })).toHaveCount(tiles);

      const only = await page.evaluate(() =>
        window.MARP.state.rows.every((r) => r.training_decision === 'excluded'));
      expect(only, 'the borrowed filter must actually narrow the query').toBe(true);

      /* Still Scientific: what a tap records is the mode's own, not the borrowed one. */
      await expect(page.locator('#statusLbl')).toHaveText('Review status');
      expect(errors).toEqual([]);
    });

  test('R7: a borrowed filter arrives from the address and stays in it', async ({ page }) => {
    await page.goto('./?trainingDisposition=excluded');
    await ready(page);

    const got = await question(page);
    expect(got.trainingDisposition).toEqual(['excluded']);
    const only = await page.evaluate(() =>
      window.MARP.state.rows.every((r) => r.training_decision === 'excluded'));
    expect(only).toBe(true);

    /* The app must not rewrite the address it was given into something else. */
    expect(new URL(page.url()).search).toContain('trainingDisposition=excluded');
  });

  test('R6: the collapsed rail badge counts a borrowed dimension only once it narrows',
    async ({ page }) => {
      await page.goto('./');
      await ready(page);
      await openRail(page);

      const badge = page.locator('#fcount');
      const before = Number(await badge.textContent());

      const promoted = page.locator(
        '#statusFilters [data-statuskey="trainingDisposition"][data-status="promoted"]');
      await promoted.click();
      await ready(page);
      expect(Number(await badge.textContent()),
        'a narrowing borrowed dimension is one more active filter').toBe(before + 1);

      await promoted.click();
      await ready(page);
      expect(Number(await badge.textContent()),
        'and unticking puts it back, because it holds nothing again').toBe(before);
    });

  test('R8: Delete Mode is unchanged — both dimensions, both defaults', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);

    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');

    /* All three training values ticked on arrival: Delete owns the dimension, and there it
       is context rather than a filter. This is what must NOT become "not filtering". */
    for (const value of ['undecided', 'promoted', 'excluded']) {
      await expect(page.locator(
        `#statusFilters [data-statuskey="trainingDisposition"][data-status="${value}"] .box`))
        .toHaveClass(/\bon\b/);
    }
    const got = await question(page);
    expect(got.trainingDisposition).toEqual(['undecided', 'promoted', 'excluded']);
    expect(got.reviewStatus).toEqual(['unreviewed', 'flagged']);
  });
});

/* ------------------------------------------------------------------ #99: never waiting */

/**
 * Watch what the store does, from inside the page, for the whole test.
 *
 * Installed straight after `goto` and before the app has settled, deliberately: the first
 * prefetch is issued 250 ms after the opening page lands, so a listener installed after
 * `ready()` would routinely miss it and every wait for a prefetch would time out.
 *
 * Four things are recorded, and each is here because the obvious way to check it is wrong:
 *
 * - **every named action**, with `state.loading` *at that instant* — R7 is about when a
 *   prefetch is issued, and reading the flag afterwards reads a flag that has moved;
 * - **every render**, so the gap between the render that settled a page and the prefetch
 *   that followed is a measured number rather than an intention;
 * - **whether a loading state was ever in the DOM**, through a `MutationObserver`.
 *   Rendering here is a full re-render, so the skeleton grid is gone within one notify:
 *   sampling `.tile.skeleton` after a page change cannot see the flash that R1 forbids;
 * - **what the store actually sent** to `queryPages`, so "a prefetch never asks for a
 *   count" is read off the request rather than trusted.
 */
async function instrument(page) {
  await page.evaluate(async () => {
    const { state, subscribe } = await import('./src/store.js');
    const { MarpData } = await import('./src/data.js');

    window.__acts = [];
    const note = (entry) => { if (window.__acts.length < 6000) window.__acts.push(entry); };

    window.addEventListener('marp:action', (e) => note({
      name: e.detail.name, detail: e.detail.detail,
      loading: state.loading, page: state.page, at: performance.now()
    }));
    subscribe((s) => note({ name: '(render)', loading: s.loading, page: s.page, at: performance.now() }));

    window.__spins = 0;
    const look = () => {
      if (document.querySelector('.tile.skeleton')
        || document.querySelector('#field[data-state="loading"]')) window.__spins++;
    };
    window.__watch = new MutationObserver(look);
    window.__watch.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'data-state']
    });
    look();

    window.__sent = [];
    const real = MarpData.queryPages.bind(MarpData);
    MarpData.queryPages = (args) => { window.__sent.push(args); return real(args); };
  });
}

const acts = (page) => page.evaluate(() => window.__acts);
const spins = (page) => page.evaluate(() => window.__spins);
const sent = (page) => page.evaluate(() => window.__sent);

/** Forget what has happened so far, so the next assertion is about one page change only. */
const fromHere = (page) => page.evaluate(() => {
  window.__acts.length = 0;
  window.__spins = 0;
});

/** The ids actually drawn, in the order they are drawn. */
const drawn = (page) =>
  page.locator('.tile').evaluateAll((tiles) => tiles.map((t) => t.dataset.id));

/** Which pages the store has asked the data layer for, since `fromHere`. */
const requests = (log) =>
  log.filter((a) => a.name === 'query' || a.name === 'query:pinned');

/** Wait until the prefetcher says it has these pages. */
async function prefetched(page, wanted) {
  await expect.poll(() => page.evaluate((want) => {
    const got = new Set();
    for (const a of window.__acts) {
      if (a.name === 'prefetch:cached') for (const p of (a.detail.pages || [])) got.add(p);
    }
    return want.every((p) => got.has(p));
  }, wanted), {
    timeout: 20_000,
    message: `the scheduler should have fetched pages ${wanted.join(', ')} ahead`
  }).toBe(true);
}

/**
 * Change page, and answer with how long that page took to be on screen.
 *
 * Measured inside the browser and resolved by the store's own settled notify, because a
 * `waitForTimeout` would measure the timeout and a poll would measure the poll interval.
 * A cache hit notifies synchronously inside `goToPage`, so the number really is the cost
 * of the page change and not of a round trip to the test.
 */
function pageChange(page, to) {
  return page.evaluate((want) => new Promise((resolve, reject) => {
    import('./src/store.js').then(({ actions, state, subscribe }) => {
      const target = want === 'next' ? state.page + 1
        : want === 'prev' ? state.page - 1 : want;
      if (target === state.page) return reject(new Error(`already on page ${target}`));
      const bail = setTimeout(() => reject(new Error(`page ${target} never settled`)), 20_000);
      const t0 = performance.now();
      const off = subscribe((s) => {
        if (s.loading || s.page !== target) return;
        clearTimeout(bail);
        off();
        resolve(performance.now() - t0);
      });
      actions.goToPage(target);
    }, reject);
  }), to);
}

/**
 * Take the result set to production depth, and empty the cache that was holding the
 * shallow one.
 *
 * `MarpData.setScale()` renumbers every row **without changing the question**, so the
 * cache key does not move and the scale-1 pages would go on being served at depth — which
 * would look exactly like a cache defect. A different sort is the cheapest real change of
 * question, so the scale change is followed by one. Answers with the depth reached.
 */
function goDeep(page, scale = 147) {
  return page.evaluate((n) => new Promise((resolve, reject) => {
    Promise.all([import('./src/data.js'), import('./src/store.js')])
      .then(([{ MarpData }, { actions, state, subscribe }]) => {
        MarpData.setScale(n);
        const bail = setTimeout(() => reject(new Error('the deep question never settled')), 20_000);
        const off = subscribe((s) => {
          if (s.loading) return;
          clearTimeout(bail);
          off();
          resolve({ pageCount: s.pageCount, total: s.total, pageSize: s.pageSize, scale: MarpData.scale() });
        });
        actions.setSort('confidence', 'desc');
        void state;
      }, reject);
  }), scale);
}

/** Commit the page and wait for the outcome, never for a timeout. */
async function commitAndWait(page) {
  await page.locator('#commit').click();
  await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
}

test.describe('the reviewer never waits (#99)', () => {
  test('R1: paging forward lands on tiles that are already there', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await instrument(page);
    await ready(page);
    await prefetched(page, [2, 3]);

    const before = await drawn(page);
    await fromHere(page);
    const ms = await pageChange(page, 'next');
    const log = await acts(page);

    /* No request at all -- the page was already held. */
    expect(requests(log)).toEqual([]);
    expect(log.some((a) => a.name === 'cache:hit')).toBe(true);

    /* And no loading state at any instant. Not "loading was false when we looked": a full
       re-render replaces the skeleton grid within one notify, so the flash R1 forbids is
       invisible to anything that samples afterwards. */
    expect(await spins(page)).toBe(0);
    await expect(page.locator('.tile.skeleton')).toHaveCount(0);
    expect(log.filter((a) => a.name === '(render)' && a.loading)).toEqual([]);

    /* The tiles are really there, and they are really the next page's. */
    const after = await drawn(page);
    expect(after.length).toBeGreaterThan(8);
    expect(after).not.toEqual(before);
    await expect(page.locator(`.tile[data-id="${after[0]}"]`)).toBeVisible();

    /* `LATENCY.query` is 140 ms in the fixture, deliberately, so no fetch can be this
       fast. This is the number that goes in .marp/verification.md. */
    console.log(`[#99 R1] forward onto a held page: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(60);
    expect(errors).toEqual([]);
  });

  test('R1: coming back to the page behind is a hit too', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await instrument(page);
    await ready(page);
    await prefetched(page, [2]);

    const first = await drawn(page);
    await pageChange(page, 'next');
    /* The scheduler recomputes from the new position; page 1 is head, so it is held. */
    await prefetched(page, [4]);

    await fromHere(page);
    const ms = await pageChange(page, 'prev');
    const log = await acts(page);

    expect(requests(log)).toEqual([]);
    expect(await spins(page)).toBe(0);
    expect(await drawn(page)).toEqual(first);
    console.log(`[#99 R1] back onto the page behind: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(60);
    expect(errors).toEqual([]);
  });

  test('R2: a page served from the cache draws the same tiles, in the same order',
    async ({ page }) => {
      await page.goto('./');
      await instrument(page);
      await ready(page);
      await prefetched(page, [2]);

      await pageChange(page, 'next');
      const once = await drawn(page);
      /* What is drawn is exactly what the store holds -- no hole, no duplicate. */
      const rows = await page.evaluate(async () =>
        (await import('./src/store.js')).state.rows.map((r) => String(r.observation_id)));
      expect(once).toEqual(rows);
      expect(new Set(once).size).toBe(once.length);

      /* And the same page is the same page on a second visit. */
      await pageChange(page, 'prev');
      await pageChange(page, 'next');
      expect(await drawn(page)).toEqual(once);
    });

  test('R10/R11: a commit does not invalidate what is behind', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await instrument(page);
    await ready(page);
    await prefetched(page, [2, 3]);

    /* Read the id and pin the tile: `.tile:not(.marked)` stops matching the moment it is
       clicked, and `.first()` then slides quietly onto its neighbour. */
    const id = await page.locator('.tile:not(.failed):not(.queued)').first().getAttribute('data-id');
    const tile = page.locator(`.tile[data-id="${id}"]`);
    await tile.click();
    await expect(tile).toHaveClass(/marked/);
    await commitAndWait(page);

    const reviewed = await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count();
    expect(reviewed).toBeGreaterThan(1);
    const committed = await drawn(page);

    /* Paging on must not discard what is behind -- the defect #99 exists for, reported by
       hand on 2026-09-08. Page 2 was fetched ahead *before* the commit and is still held. */
    await fromHere(page);
    const forward = await pageChange(page, 'next');
    let log = await acts(page);
    expect(requests(log)).toEqual([]);
    expect(await spins(page)).toBe(0);

    /* And back: a committed page is served from the row index by the ids it was committed
       with (R11), with no request, and it still shows what was submitted. */
    await fromHere(page);
    const back = await pageChange(page, 'prev');
    log = await acts(page);
    expect(requests(log)).toEqual([]);
    expect(log.some((a) => a.name === 'cache:pinned')).toBe(true);
    expect(await spins(page)).toBe(0);
    expect(await drawn(page)).toEqual(committed);

    await expect(tile.locator('.badge')).toContainText('FLAGGED');
    expect(await page.locator('.tile .badge', { hasText: 'REVIEWED' }).count()).toBe(reviewed);
    console.log(`[#99 R10] after a commit: forward ${Math.round(forward)} ms, back ${Math.round(back)} ms`);
    expect(errors).toEqual([]);
  });

  test('R7: prefetching yields until the visible page has settled', async ({ page }) => {
    await page.goto('./');
    await instrument(page);
    await ready(page);
    await prefetched(page, [2]);

    const log = await acts(page);
    const started = log.filter((a) => a.name === 'prefetch');
    expect(started.length).toBeGreaterThan(0);

    /* Not one of them was issued while a page was loading. */
    expect(started.filter((a) => a.loading)).toEqual([]);

    /* And the yield is real: the first prefetch is at least 200 ms after the render that
       settled the page, because a response landing mid-layout would notify again and
       re-render on top of the layout pass the reviewer is waiting for. */
    const first = started[0];
    const renders = log.filter((a) => a.name === '(render)' && !a.loading && a.at < first.at);
    expect(renders.length).toBeGreaterThan(0);
    const gap = first.at - renders[renders.length - 1].at;
    console.log(`[#99 R7] settled render to first prefetch: ${Math.round(gap)} ms`);
    expect(gap).toBeGreaterThanOrEqual(200);
  });

  test('R16: a prefetch never asks for a count', async ({ page }) => {
    await page.goto('./');
    await instrument(page);
    await ready(page);
    await prefetched(page, [2]);
    await pageChange(page, 'next');
    await prefetched(page, [4]);

    const asked = await sent(page);
    expect(asked.length).toBeGreaterThan(0);
    /* The total is one per question. Asking again is a second pass over the matching set
       for a number the client already has. */
    expect(asked.filter((a) => a.includeTotal !== undefined)).toEqual([]);
    /* And it stays inside the cap the endpoint enforces: 12 pages or 600 rows. */
    for (const a of asked) {
      expect(a.pages.length).toBeLessThanOrEqual(12);
      expect(a.pages.length * a.pageSize).toBeLessThanOrEqual(600);
    }
  });

  test('R3/R6: a prefetch in flight never lands on the visible page', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await instrument(page);
    await ready(page);
    await prefetched(page, [2]);

    /* Driven from inside the browser: the jump has to happen while the prefetch is
       genuinely in flight, and a round trip to the test is 140 ms of the 140 ms it lasts. */
    const out = await page.evaluate(() => new Promise((resolve, reject) => {
      import('./src/store.js').then(({ actions, state }) => {
        const bail = setTimeout(() => reject(new Error('no prefetch was seen')), 20_000);
        let jumped = null;

        const onStart = (e) => {
          if (e.detail.name !== 'prefetch') return;
          window.removeEventListener('marp:action', onStart);
          /* The reviewer jumps, mid-flight, to somewhere the prefetch is not fetching. */
          jumped = Math.min(state.pageCount, state.page + 12);
          actions.goToPage(jumped);
        };
        const onLand = (e) => {
          if (!jumped) return;
          if (e.detail.name !== 'prefetch:cached' && e.detail.name !== 'prefetch:stale') return;
          window.removeEventListener('marp:action', onLand);
          clearTimeout(bail);
          /* Let anything the landing might have caused actually happen before looking. */
          setTimeout(() => resolve({
            landed: e.detail.name, jumped, page: state.page, loading: state.loading,
            rows: state.rows.map((r) => String(r.observation_id))
          }), 400);
        };
        window.addEventListener('marp:action', onStart);
        window.addEventListener('marp:action', onLand);

        /* A held page: it settles at once, which is what schedules the next prefetch. */
        actions.goToPage(state.page + 1);
      }, reject);
    }));

    /* It was allowed to land rather than cancelled (R6) -- the rows answer the same
       question and may be exactly where the reviewer goes next. */
    expect(out.landed).toBe('prefetch:cached');

    /* And the screen is still the page that was asked for. A prefetch takes no sequencing
       token, so nothing it fetched could have been mistaken for the visible page. */
    expect(out.page).toBe(out.jumped);
    expect(out.loading).toBe(false);
    expect(await drawn(page)).toEqual(out.rows);
    await expect(page.locator('#pageInput')).toHaveValue(String(out.jumped));
    expect(errors).toEqual([]);
  });

  test('R1: at production depth, the last page is one request and its neighbour is free',
    async ({ page }) => {
      test.setTimeout(90_000);
      const errors = watchErrors(page);
      await page.goto('./');
      await instrument(page);
      await ready(page);

      const deep = await goDeep(page);
      console.log(`[#99 R1] depth: ${deep.total} rows, ${deep.pageCount} pages `
        + `of ${deep.pageSize}, scale ${deep.scale}`);
      expect(deep.pageCount).toBeGreaterThan(1000);

      /* The jump itself is a genuine fetch -- nothing could have held page 9,000 -- and it
         must cost exactly one request rather than one per page of a set. */
      await fromHere(page);
      const jump = await pageChange(page, deep.pageCount);
      let log = await acts(page);
      expect(requests(log).length).toBe(1);
      await expect(page.locator('.tile').first()).toBeVisible();

      /* And then the page beside it is free, which is the point of a page *set*. */
      await prefetched(page, [deep.pageCount - 1]);
      await fromHere(page);
      const beside = await pageChange(page, deep.pageCount - 1);
      log = await acts(page);
      expect(requests(log)).toEqual([]);
      expect(await spins(page)).toBe(0);
      expect((await drawn(page)).length).toBeGreaterThan(8);

      console.log(`[#99 R1] at depth: jump to the last page ${Math.round(jump)} ms, `
        + `the page beside it ${Math.round(beside)} ms`);
      expect(jump).toBeGreaterThan(100);          // it really did go to the data layer
      expect(beside).toBeLessThan(60);
      expect(errors).toEqual([]);
    });

  test('R8: roaming evicts, and a committed page never loses its rows', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await page.goto('./');
    await instrument(page);
    await ready(page);

    const deep = await goDeep(page);
    expect(deep.pageCount).toBeGreaterThan(1000);

    /* Commit a page a long way in, not page 1: the head is exempt from eviction by band,
       so a pinned page 1 would prove nothing about the pinned exemption. */
    const home = Math.floor(deep.pageCount / 3);
    await pageChange(page, home);
    await ready(page);
    const id = await page.locator('.tile:not(.failed):not(.queued)').first().getAttribute('data-id');
    const tile = page.locator(`.tile[data-id="${id}"]`);
    await tile.click();
    await commitAndWait(page);
    const committed = await drawn(page);

    /* Roam until the budget bites. Each stop fetches a fresh page set, so the 3,000-row
       budget is reached in a handful of stops on a desktop and rather more on a phone,
       where a page is a third the size -- so this is driven by the eviction actually
       happening rather than by a fixed number of stops. */
    const roam = await page.evaluate((away) => new Promise((resolve, reject) => {
      import('./src/store.js').then(({ actions, state, subscribe }) => {
        let evicted = null;
        /* `marp:action` carries the whole log entry, so the payload is `detail.detail`. */
        window.addEventListener('marp:action', (e) => {
          if (e.detail.name === 'cache:evicted') evicted = evicted || e.detail.detail;
        });

        const settle = (n) => new Promise((done) => {
          const off = subscribe((s) => { if (!s.loading && s.page === n) { off(); done(); } });
          actions.goToPage(n);
        });
        const landed = (ms) => new Promise((done) => {
          const t = setTimeout(() => { window.removeEventListener('marp:action', h); done(false); }, ms);
          const h = (e) => {
            if (e.detail.name !== 'prefetch:cached' && e.detail.name !== 'prefetch:failed') return;
            clearTimeout(t); window.removeEventListener('marp:action', h); done(true);
          };
          window.addEventListener('marp:action', h);
        });

        (async () => {
          const spread = Math.max(13, Math.floor((state.pageCount - 40) / 44));
          let stops = 0;
          for (let i = 1; i <= 44 && !evicted; i++) {
            const target = 20 + i * spread;
            if (target >= state.pageCount - 2 || target === away) continue;
            stops += 1;
            await settle(target);
            await landed(10_000);
          }
          resolve({ evicted, stops });
        })().catch(reject);
      }, reject);
    }), home);

    console.log(`[#99 R8] eviction after ${roam.stops} stops: `
      + `${JSON.stringify(roam.evicted)}`);
    expect(roam.evicted, 'roaming should have exceeded the 3,000-row budget').toBeTruthy();
    expect(roam.evicted.pages.length).toBeGreaterThan(0);
    /* Back inside the budget, and no further -- eviction stops the moment it has room. */
    expect(roam.evicted.rows).toBeLessThanOrEqual(3000);
    /* What went is distant and unpinned, never the page the reviewer is standing on. */
    expect(roam.evicted.pages).not.toContain(home);

    /* The committed page is still there, without a request: its page was given up, and
       every row a pinned page needs was kept. */
    await fromHere(page);
    const backHome = await pageChange(page, home);
    const log = await acts(page);
    expect(requests(log)).toEqual([]);
    expect(log.some((a) => a.name === 'cache:pinned')).toBe(true);
    expect(await spins(page)).toBe(0);
    expect(await drawn(page)).toEqual(committed);
    await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();

    console.log(`[#99 R8] back to the committed page after eviction: ${Math.round(backHome)} ms`);
    expect(backHome).toBeLessThan(60);
    expect(errors).toEqual([]);
  });
});

test.describe('the summary says where you are', () => {
  /* Reported 2026-09-09, once paging became instant: the reviewer moves far more than
     before, and the line only said how many rows were on screen. It now says which page
     that is, out of how many, and what the page size is. */

  const summary = (page) => page.evaluate(() => ({
    pageNow: document.querySelector('#pageNow').textContent.trim(),
    pageTotal: document.querySelector('#pageTotal').textContent.trim(),
    shown: document.querySelector('#shown').textContent.trim(),
    perPage: document.querySelector('#perPage').textContent.trim(),
    tiles: document.querySelectorAll('.tile').length
  }));

  test('it names the page, the page count and the page size', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await ready(page);

    const at = await summary(page);
    expect(at.pageNow).toBe('1');
    expect(Number(at.pageTotal)).toBeGreaterThan(1);

    /* The page size is stated, and it is the size -- not the row count, which differs on
       a short page. Both are on screen, so neither has to be inferred from the other. */
    const size = await page.evaluate(() => window.MARP.state.pageSize);
    expect(Number(at.perPage)).toBe(size);

    /* On a phone that clause is hidden rather than absent -- the row scrolls sideways and
       M3 requires the sort control to stay inside the viewport, so the trailing words are
       what the row gives up. "Page 2 of 24" is the part worth the width, and it stays at
       both sizes. This asserts the concession deliberately, so it cannot rot into an
       accident. */
    const wordy = page.locator('.sub .per-page');
    if (info.project.name === 'phone') await expect(wordy).toBeHidden();
    else await expect(wordy).toBeVisible();
    await expect(page.locator('#pageNow')).toBeVisible();

    /* And the row count really is the rows drawn, so the number cannot describe a page
       the reviewer is not looking at. */
    expect(Number(at.shown)).toBe(at.tiles);
    expect(errors).toEqual([]);
  });

  test('the page it names follows the reviewer, including onto a cached page',
    async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      await instrument(page);
      await ready(page);
      await prefetched(page, [2, 3]);

      /* Forward onto a held page: the whole point is that nothing is fetched, so if the
         summary were only refreshed by a query it would sit on page 1 and be wrong. */
      await fromHere(page);
      await pageChange(page, 'next');
      expect(requests(await acts(page)), 'this page change must be a cache hit').toEqual([]);

      let at = await summary(page);
      expect(at.pageNow, 'a cache hit must still move the page number').toBe('2');
      expect(Number(at.shown)).toBe(at.tiles);

      await pageChange(page, 'next');
      at = await summary(page);
      expect(at.pageNow).toBe('3');

      await pageChange(page, 'prev');
      at = await summary(page);
      expect(at.pageNow, 'and going back moves it back').toBe('2');
      expect(Number(at.shown)).toBe(at.tiles);

      /* It agrees with the pager, which is the other place the answer appears. */
      const typed = await page.locator('#pageInput').inputValue();
      expect(typed, 'the summary and the pager must not disagree').toBe(at.pageNow);
      expect(errors).toEqual([]);
    });

  test('a committed page keeps its own count when the reviewer returns', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await instrument(page);
    await ready(page);

    await commitAndWait(page);
    await pageChange(page, 'next');
    await pageChange(page, 'prev');

    /* A pinned page is served by id, so the rows are exactly what was submitted -- and
       the number beside them has to be those rows, not the page size. */
    const at = await summary(page);
    expect(at.pageNow).toBe('1');
    expect(Number(at.shown)).toBe(at.tiles);
    expect(errors).toEqual([]);
  });
});
