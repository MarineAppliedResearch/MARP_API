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
  /**
   * The address the run opens on. `./` is the bare address and therefore the default
   * question, which is what every existing scenario wants.
   *
   * It is overridable because the default question is not answerable everywhere:
   * `DEFAULT_FILTERS.species` is a documented placeholder holding the *fixture's* Bat Star
   * key until A10(b) lands, so against any other database the bare address opens on an
   * empty mosaic — and the runner settles the page before the first scene, so no scene is
   * early enough to fix it. A scenario recorded against the API names its own opening
   * question instead.
   */
  url: process.env.MARP_WALKTHROUGH_URL || './',
  async settled({ page }) {
    await expect(page.locator('.tile').first()).toBeVisible();
    await expect(page.locator('.tile.skeleton')).toHaveCount(0);
    await page.waitForTimeout(400);
  },
});
