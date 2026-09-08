/**
 * Render-layer tests.
 *
 * These exist because the unit and contract tiers structurally cannot see the DOM.
 * Three defects so far lived here and every store-level check passed while they were
 * live: a stale identifier crashed rendering, a committed page drew no badge, and a
 * layout feedback loop kept re-querying the grid. Each is covered below.
 */
import { test, expect } from '@playwright/test';

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
    const noImage = page.locator('.tile.failed').first();
    if (await noImage.count() === 0) test.skip(true, 'no unavailable thumbnail on this page');
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

    const tile = await tileCarrying(page, 'training_disposition', 'excluded');
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
    const tile = await tileCarrying(page, 'training_disposition', 'promoted');
    await expect(tile.locator('.rtag')).toContainText('PROMOTED');
    await expect(tile).not.toHaveClass(/has-promoted/);
  });

  test('R1: a scientific review is drawn while reviewing training data', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
    await ready(page);

    const tile = await tileCarrying(page, 'review_status', 'reviewed');
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
    const tile = await tileCarrying(page, 'training_disposition', 'excluded');
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
          && r.training_disposition === 'undecided');
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
      const tile = await tileCarrying(page, 'training_disposition', 'excluded');

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
    const tile = await tileCarrying(page, 'training_disposition', 'excluded');

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

  test('it offers both status dimensions, and only Delete does', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    /* One dimension in the review modes... */
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveCount(0);
    await expect(page.locator('#statusFilters [data-statuskey="trainingDisposition"]')).toHaveCount(0);

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    /* ...both in Delete, each under its own heading. */
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

      /* No observation in the fixture carries a date on its `tc`, which is the production
         case this exists for: the clock was never synced. The filter therefore excludes
         everything, and the ONLY thing standing between the reviewer and an empty mosaic
         they cannot explain is this line. It was drawn by the rail and counted by the data
         layer, and nothing carried the number between them, so it never appeared. */
      await setSpan(page, 'date', 'from', '2019-01-01');

      await expect(note).toBeVisible();
      const said = await note.innerText();
      expect(said).toMatch(/\d+/);
      expect(Number(said.replace(/\D/g, ''))).toBeGreaterThan(0);
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
    /* The tiles come back, so the banner has nothing left to say. */
    await expect(page.locator('.pagestate--banner')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('#commit')).toBeEnabled();
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
       and the progress bar were drawn below the fold and could not be reached at all.
       A rail that hides controls silently is worse than one that scrolls. */
    const rail = await page.locator('.rail').boundingBox();
    for (const sel of ['#statusFilters [data-status="unreviewed"]',
                       '#statusFilters [data-status="reviewed"]', '.prog']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, `${sel} is drawn`).not.toBeNull();
      expect(box.y + box.height, `${sel} is inside the rail`)
        .toBeLessThanOrEqual(rail.y + rail.height + 1);
    }
    await expect(page.locator('#statusFilters [data-status="reviewed"]')).toBeVisible();
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
