/** #167: border weight distinguishes every pending decision from one on the record. */
import { test, expect } from '@playwright/test';
import { claimLoneRow, commitOne, restore, decisionNow } from './corpus.mjs';
import { expectRealBacking, ready } from './support.mjs';

const decisions = {
  scientific: { exception: 'flagged', acceptance: 'reviewed' },
  training: { exception: 'excluded', acceptance: 'promoted' }
};

const addressFor = (mode, lone) => (mode === 'scientific'
  ? `./?species=${lone.species}&line=${lone.line}`
    + '&reviewStatus=unreviewed,flagged,reviewed'
  : `./?mode=training&species=${lone.species}&line=${lone.line}`
    + '&trainingDisposition=undecided,promoted,excluded');

const tileFor = (page, row) => page.locator(`.tile[data-id="${row.observation_id}"]`);
const imageFilter = (tile) => tile.locator('img').evaluate((img) => getComputedStyle(img).filter);
const outlineWidth = (tile) => tile.evaluate((el) => getComputedStyle(el).outlineWidth);

for (const viewport of ['desktop', 'phone']) {
  test.describe(`#167 ${viewport}`, () => {
    test.use(viewport === 'phone' ? {
      viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true
    } : { viewport: { width: 1600, height: 900 } });

    for (const mode of ['scientific', 'training']) {
      for (const kind of ['exception', 'acceptance']) {
        test(`${mode}: a pending ${kind} becomes a lighter recorded decision`, async ({ page, request }) => {
          const claim = await claimLoneRow(request, mode);
          const { lone, row } = claim;
          const expected = decisions[mode][kind];

          try {
            await commitOne(request, mode, row, { withdraw: true });
            await page.goto(addressFor(mode, lone));
            await expectRealBacking(page);
            await ready(page);

            const tile = tileFor(page, row);
            await expect(tile).toBeVisible();
            await expect(page.locator('.tile')).toHaveCount(1);
            expect(await imageFilter(tile)).toBe('none');

            await tile.click(kind === 'acceptance' ? { button: 'right' } : undefined);
            await expect(tile).toHaveClass(/marked/);
            await expect(tile).not.toHaveClass(/recorded/);
            await expect(tile.locator('.badge')).toContainText(expected.toUpperCase());
            await expect(tile.locator('.badge')).toHaveCount(1);
            expect(await outlineWidth(tile)).toBe('3px');
            expect(await imageFilter(tile)).toBe('none');

            await page.locator('#commitMarked').click();
            await expect(page.locator('#commitMarked')).toContainText('Saved');
            await expect(tile).toHaveClass(/recorded/);
            expect(await outlineWidth(tile)).toBe('1px');
            expect(await imageFilter(tile)).toBe('none');
            expect(await decisionNow(request, mode, lone)).toBe(expected);

            await page.reload();
            await expectRealBacking(page);
            await ready(page);
            const reloaded = tileFor(page, row);
            await expect(reloaded).toHaveClass(/recorded/);
            await expect(reloaded.locator('.badge')).toHaveCount(1);
            expect(await outlineWidth(reloaded)).toBe('1px');
            expect(await imageFilter(reloaded)).toBe('none');

            /* Withdrawing a recorded decision is pending work too. Canceling that gesture
               returns to the record, so the light outline comes straight back. */
            await reloaded.click();
            await expect(reloaded.locator('.badge')).toContainText('TAKING BACK');
            await expect(reloaded).not.toHaveClass(/recorded/);
            expect(await outlineWidth(reloaded)).toBe('3px');
            expect(await imageFilter(reloaded)).toBe('none');

            await reloaded.click();
            await expect(reloaded).toHaveClass(/recorded/);
            await expect(reloaded.locator('.badge')).toContainText(expected.toUpperCase());
            expect(await outlineWidth(reloaded)).toBe('1px');
            await expect(page.locator('#commitMarked')).toBeDisabled();
          } finally {
            await restore(request, mode, claim);
          }
        });
      }
    }
  });
}
