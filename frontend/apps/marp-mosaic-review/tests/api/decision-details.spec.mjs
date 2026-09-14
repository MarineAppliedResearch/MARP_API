/** #172: reasons and notes use the existing commit workflow and survive a reload. */
import { test, expect } from '@playwright/test';
import { claimLoneRow, commitOne, restore } from './corpus.mjs';
import { expectRealBacking, ready } from './support.mjs';

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
