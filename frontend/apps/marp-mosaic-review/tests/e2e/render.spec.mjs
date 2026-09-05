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
        await expect(page.locator('#selSpeciesBtn')).toBeVisible();
      }
      await page.locator('#selSpeciesBtn').click();

      const menu = page.locator('.menu');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);          // the rail used to clip it off-screen

      await menu.locator('.msearch').fill('rock');
      await expect(menu.locator('[data-v]')).toHaveCount(2);   // Rockfish, Rock Crab
    });
});

test.describe('the modes do not wear each other\'s answers', () => {
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
    await expect(page.locator('#commit')).toContainText('0 tiles');
  });

  test('it offers both status dimensions, and only Delete does', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await openRail(page);
    /* One dimension in the review modes... */
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveCount(0);
    await expect(page.locator('#statusFilters [data-key="trainingDisposition"]')).toHaveCount(0);

    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    /* ...both in Delete, each under its own heading. */
    await expect(page.locator('#statusLbl')).toHaveText('Review status');
    await expect(page.locator('#statusFilters .lbl.sub')).toHaveText('Training disposition');
    await expect(page.locator('#statusFilters [data-key="reviewStatus"]')).toHaveCount(3);
    await expect(page.locator('#statusFilters [data-key="trainingDisposition"]')).toHaveCount(3);
  });

  test('a training filter actually narrows the results in Delete Mode', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('.seg button', { hasText: 'Delete' }).click();
    await ready(page);
    await openRail(page);
    const before = await page.locator('#total').innerText();

    /* Untick Undecided: what is left is only what a model was already taught with. */
    await page.locator('#statusFilters [data-key="trainingDisposition"][data-status="undecided"]').click();
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
    const colour = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
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
    const rgb = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
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
