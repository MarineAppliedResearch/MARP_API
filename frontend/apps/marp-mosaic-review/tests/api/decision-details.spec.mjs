/** #172: reasons and notes use the existing commit workflow and survive a reload. */
import { test, expect } from '@playwright/test';
import { claimLoneRow, commitOne, restore } from './corpus.mjs';
import { seedPage } from './seed.mjs';
import { expectRealBacking, isPhone, ready } from './support.mjs';

const decisions = {
  scientific: { exception: 'flagged', acceptance: 'reviewed', reason: 'Duplicate' },
  training: { exception: 'excluded', acceptance: 'promoted', reason: 'Occluded' }
};

const addressFor = (mode, lone) => (mode === 'scientific'
  ? `./?species=${lone.species}&line=${lone.line}&reviewStatus=unreviewed,flagged,reviewed`
  : `./?mode=training&species=${lone.species}&line=${lone.line}`
    + '&trainingDisposition=undecided,promoted,excluded');

for (const mode of ['scientific', 'training']) {
  for (const kind of ['exception', 'acceptance']) {
    test(`#172 ${mode} ${kind}: staged details commit and reload`, async ({ page, request }) => {
      const claim = await claimLoneRow(request, mode);
      const expected = decisions[mode][kind];
      const reasonValue = decisions[mode].reason;
      const note = `${mode} ${kind} note`;

      try {
        await commitOne(request, mode, claim.row, { withdraw: true });
        await page.goto(addressFor(mode, claim.lone));
        await expectRealBacking(page);
        await ready(page);

        const tile = page.locator(`.tile[data-id="${claim.row.observation_id}"]`);
        await tile.click(kind === 'acceptance' ? { button: 'right' } : undefined);
        await tile.locator('[data-badge]').click();
        await expect(page.locator('#decisionNote')).toBeVisible();
        if (kind === 'exception') {
          const reason = page.locator(`[data-reason="${reasonValue}"]`);
          await reason.click();
          /* Choosing a structured reason redraws the panel. Wait for that redraw before
             filling the note, or the text can land in the textarea being replaced. */
          await expect(reason).toHaveClass(/on/);
        } else {
          await expect(page.locator('[data-reason]')).toHaveCount(0);
        }
        await page.locator('#decisionNote').fill(note);
        await page.keyboard.press('Escape');

        const commit = mode === 'scientific' && kind === 'exception' ? '#commit' : '#commitMarked';
        await page.locator(commit).click();
        await expect(page.locator(commit)).toContainText('Saved');

        await page.reload();
        await expectRealBacking(page);
        await ready(page);
        const reloaded = page.locator(`.tile[data-id="${claim.row.observation_id}"]`);
        await expect(reloaded.locator('.note-indicator')).toHaveCount(1);
        const author = reloaded.locator('.badge .reviewer-attribution');
        await expect(author).toHaveText(/^[A-Z]{2}$/);
        await expect(author).toHaveCSS('border-radius', '50%');
        await reloaded.locator('[data-badge]').click();
        await expect(page.locator('#decisionNote')).toHaveValue(note);
        if (kind === 'exception') {
          await expect(page.locator(`[data-reason="${reasonValue}"]`)).toHaveClass(/on/);
        }
      } finally {
        await restore(request, mode, claim);
      }
    });
  }
}

test('#172 confidence chip stays in the caption, clear of review attribution',
  async ({ page, request }) => {
    const pictured = await seedPage({ count: 1, thumbnail: 'ready', confidence: 0.57 });
    const unknown = await seedPage({ count: 1, thumbnail: 'ready', confidence: null });

    try {
      await page.goto(pictured.address);
      await expectRealBacking(page);
      await ready(page);
      const row = await page.evaluate(() => window.MARP.state.rows[0]);
      await commitOne(request, 'training', row, { kind: 'except', reason: 'Occluded' });
      await page.reload();
      await ready(page);

      const tile = page.locator(`.tile[data-id="${pictured.ids[0]}"]`);
      await expect(tile.locator('.confidence-chip')).toHaveText('57');
      const positions = await tile.evaluate((element) => {
        const chip = element.querySelector('.confidence-chip').getBoundingClientRect();
        const caption = element.querySelector('.cap').getBoundingClientRect();
        const tag = element.querySelector('.rtag').getBoundingClientRect();
        return {
          chipTop: chip.top, chipBottom: chip.bottom,
          captionTop: caption.top, captionBottom: caption.bottom,
          overlapsTag: chip.left < tag.right && chip.right > tag.left
            && chip.top < tag.bottom && chip.bottom > tag.top
        };
      });
      expect(positions.chipTop).toBeGreaterThanOrEqual(positions.captionTop - 1);
      expect(positions.chipBottom).toBeLessThanOrEqual(positions.captionBottom + 1);
      expect(positions.overlapsTag).toBe(false);

      await page.goto(unknown.address);
      await ready(page);
      await expect(page.locator(`.tile[data-id="${unknown.ids[0]}"] .confidence-chip`))
        .toHaveCount(0);
    } finally {
      await pictured.remove();
      await unknown.remove();
    }
  });

test('#172 mobile details keep the note reachable and the document scrollable',
  async ({ page, request }, info) => {
    test.skip(!isPhone(info), 'about the phone keyboard layout');
    const claim = await claimLoneRow(request, 'scientific');

    try {
      await commitOne(request, 'scientific', claim.row, { withdraw: true });
      await page.goto(addressFor('scientific', claim.lone));
      await expectRealBacking(page);
      await ready(page);

      const tile = page.locator(`.tile[data-id="${claim.row.observation_id}"]`);
      await tile.click();
      await tile.locator('[data-badge]').click();
      const note = page.locator('#decisionNote');
      await note.focus();
      await page.setViewportSize({ width: 412, height: 420 });
      await expect(note).toBeFocused();

      await note.pressSequentially('p');
      await expect(note).toBeFocused();
      await page.evaluate(() => {
        window.__noteElement = document.querySelector('#decisionNote');
      });
      await note.pressSequentially('hone note', { delay: 15 });

      const geometry = await page.evaluate(() => {
        const viewport = window.visualViewport;
        const panel = document.querySelector('.pick');
        const editor = document.querySelector('#decisionNote');
        const p = panel.getBoundingClientRect();
        const n = editor.getBoundingClientRect();
        return {
          viewportTop: viewport ? viewport.offsetTop : 0,
          viewportBottom: viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
          panelTop: p.top,
          panelBottom: p.bottom,
          noteTop: n.top,
          noteBottom: n.bottom,
          panelOverflow: getComputedStyle(panel).overflowY,
          fieldOverscroll: getComputedStyle(document.querySelector('#field')).overscrollBehaviorY,
          rootOverscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
          rootOverflow: getComputedStyle(document.documentElement).overflowY,
          bodyPosition: getComputedStyle(document.body).position,
          bodyOverflow: getComputedStyle(document.body).overflowY,
          sameNote: editor === window.__noteElement
        };
      });

      expect(geometry.panelTop).toBeGreaterThanOrEqual(geometry.viewportTop);
      expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportBottom + 1);
      expect(geometry.noteTop).toBeGreaterThanOrEqual(geometry.viewportTop);
      expect(geometry.noteBottom).toBeLessThanOrEqual(geometry.viewportBottom + 1);
      expect(geometry.panelOverflow).toBe('auto');
      expect(geometry.fieldOverscroll).toBe('auto');
      expect(geometry.rootOverscroll).toBe('auto');
      expect(geometry.rootOverflow).toBe('auto');
      expect(geometry.bodyPosition).toBe('static');
      expect(['visible', 'auto']).toContain(geometry.bodyOverflow);
      expect(geometry.sameNote).toBe(true);
    } finally {
      await restore(request, 'scientific', claim);
    }
  });

test('#172 translucent overlays leave the observation visible', async ({ page, request }) => {
  const claim = await claimLoneRow(request, 'training');

  try {
    await commitOne(request, 'training', claim.row, { kind: 'except', reason: 'Occluded' });
    await page.goto(`./?species=${claim.lone.species}&line=${claim.lone.line}`
      + '&reviewStatus=unreviewed,flagged,reviewed&trainingDisposition=excluded');
    await expectRealBacking(page);
    await ready(page);

    const tile = page.locator(`.tile[data-id="${claim.row.observation_id}"]`);
    const alpha = (locator) => locator.evaluate((element) => {
      const color = getComputedStyle(element).backgroundColor;
      const match = color.match(/^rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)$/);
      if (match) return match[1] === undefined ? 1 : Number(match[1]);
      const modern = color.match(/\/\s*([\d.]+)\s*\)$/);
      return modern ? Number(modern[1]) : 1;
    });

    expect(await alpha(tile.locator('.rtag'))).toBeLessThan(0.4);
    expect(await alpha(tile.locator('.cap'))).toBe(0);

    /* Since #206 the corner carries the reason *and* the count, stacked, so an excluded
       row has a frame chip like any other. This used to say the opposite, and picked an
       ordinary training candidate to avoid the row it was standing on. */
    await page.goto('./?mode=training');
    await ready(page);
    await expect(page.locator('.frames').first()).toBeVisible();
    expect(await alpha(page.locator('.frames').first())).toBeLessThan(0.4);
  } finally {
    await restore(request, 'training', claim);
  }
});

/**
 * #206: the track length is on the tile in every mode, beside the reason.
 *
 * It used to be training mode only, and there it was the reason chip *or* the count,
 * never both -- with the count demoted to the reason chip's `title`, which is a tooltip
 * nobody hovers and a phone cannot show at all. So a reviewer in scientific mode had to
 * switch modes to find out whether a detection had lasted one frame or ninety.
 *
 * The browser tier because the requirement is about what a tile draws and where. A
 * store-level check cannot see a chip that is missing, and neither can it see one drawn
 * underneath another.
 */
for (const mode of ['scientific', 'training']) {
  test(`#206 R1, R5 ${mode}: the track length is on the tile, and reads 0f with no keyframes`,
    async ({ page }) => {
      /* No `tie`, so the seeder plants no keyframes at all -- which is R5's case and the
         one a client that coalesced badly would render as `undefinedf`. */
      const seeded = await seedPage({ count: 2, thumbnail: 'ready' });

      try {
        await page.goto(mode === 'scientific'
          ? seeded.address
          : `${seeded.address}&mode=training`);
        await expectRealBacking(page);
        await ready(page);

        const tile = page.locator(`.tile[data-id="${seeded.ids[0]}"]`);
        const frames = tile.locator('.frames');

        await expect(frames).toBeVisible();
        await expect(frames).toHaveText('0f');
      } finally {
        await seeded.remove();
      }
    });
}

test('#206 R2, R3, R4: a reason and the track length are both shown, and neither covers the other',
  async ({ page }) => {
    /* `tie` is what makes the seeder plant keyframes, so this page has a real count to
       show rather than 0f -- the check is about two chips sharing a corner, and a count
       of zero would still prove that, but a real one is what a reviewer sees. */
    const seeded = await seedPage({ count: 2, thumbnail: 'ready', tie: true });

    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);

      const tile = page.locator(`.tile[data-id="${seeded.ids[1]}"]`);

      await tile.click();
      await tile.locator('[data-badge]').click();
      await page.locator('.pick .chip', { hasText: 'Duplicate' }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.pick')).toHaveCount(0);

      const reason = tile.locator('.reason-chip');
      const frames = tile.locator('.frames');

      /* Both, which is the whole requirement. This is the assertion that was false: the
         corner returned one chip or the other. */
      await expect(reason).toBeVisible();
      await expect(reason).toHaveText('Duplicate');
      await expect(frames).toBeVisible();
      await expect(frames).toHaveText(/^\d+f$/);

      /* And neither drawn over the other. Two chips can both be "visible" to Playwright
         while occupying the same pixels, which is exactly what two rules sharing
         `top: 4px; right: 4px` produced -- so the geometry is asserted rather than the
         visibility alone. Runs at desktop and phone width, because the api-phone project
         runs this file too. */
      const boxes = await tile.evaluate((element) => {
        const rectangle = (selector) => {
          const found = element.querySelector(selector);
          return found ? found.getBoundingClientRect() : null;
        };
        const a = rectangle('.reason-chip');
        const b = rectangle('.frames');
        return {
          overlaps: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
          reasonBottom: a.bottom,
          framesTop: b.top,
          framesRight: b.right,
          tileRight: element.getBoundingClientRect().right
        };
      });

      expect(boxes.overlaps).toBe(false);
      /* Stacked downwards, the count under the reason: the corner is a column. */
      expect(boxes.framesTop).toBeGreaterThanOrEqual(boxes.reasonBottom - 0.5);
      /* And still inside the tile, rather than pushed off its right edge. */
      expect(boxes.framesRight).toBeLessThanOrEqual(boxes.tileRight + 0.5);
    } finally {
      await seeded.remove();
    }
  });

test('#206 R4: the corner does not swallow a click meant for the tile',
  async ({ page }) => {
    /**
     * The regression this change could cause, and the reason it is worth its own check.
     *
     * The two chips used to be positioned individually; they are inside a positioned
     * container now, and a container laid over the tile is exactly the kind of thing that
     * starts eating clicks. The tile is a `<button>` and the chips are spans inside it, so
     * a click on one bubbles -- but that is a property of the markup, and the markup is
     * what moved.
     *
     * It matters beyond tidiness: `.reason-chip[data-changed]` is a real control that
     * reopens the species chooser, and the frame chip sits over the same corner a reviewer
     * aims at thousands of times a sitting.
     */
    const seeded = await seedPage({ count: 2, thumbnail: 'ready' });

    try {
      await page.goto(seeded.address);
      await expectRealBacking(page);
      await ready(page);

      const tile = page.locator(`.tile[data-id="${seeded.ids[0]}"]`);
      const frames = tile.locator('.frames');

      await expect(frames).toBeVisible();
      await expect(tile).not.toHaveClass(/marked/);

      /* Aimed at the chip, not at the tile. */
      await frames.click();

      await expect(tile).toHaveClass(/marked/);
    } finally {
      await seeded.remove();
    }
  });
