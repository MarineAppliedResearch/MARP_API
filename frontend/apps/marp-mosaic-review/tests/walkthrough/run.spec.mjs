/**
 * This application's walkthrough run.
 *
 * The runner is shared -- see MARP_API/tools/walkthrough/spec.mjs and ADR-0007. The only
 * application-specific part is knowing when the page has stopped moving, which cannot be
 * guessed from shared code: here it is the grid having tiles and no skeletons left.
 */
import { test, expect } from '@playwright/test';
import { walkthrough } from '../../../../../tools/walkthrough/spec.mjs';
import { scenarios } from './scenarios.mjs';

walkthrough({
  test,
  expect,
  scenarios,
  async settled({ page }) {
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.tile.skeleton')).toHaveCount(0);
    await page.waitForTimeout(400);
  },
});
