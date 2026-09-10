import { test, expect } from '@playwright/test';
import { walkthrough } from '../../../../../tools/walkthrough/spec.mjs';
import { scenarios } from './scenarios.mjs';

/**
 * `test` and `expect` are passed in rather than imported by the shared runner.
 * Playwright only registers a test when it is the *same* module instance the
 * runner loaded, and each application installs its own -- the shared directory
 * sits above them all and would resolve a different one, or none.
 */
walkthrough({
  test,
  expect,
  scenarios,

  /**
   * When has this app stopped moving?
   *
   * The router imports a tab module and then appends its element, so "loaded"
   * is not enough -- the content slot is in the document one tick before
   * anything is in it. `settled` is the only genuinely app-specific part of the
   * shared recorder, and it cannot be guessed from shared code.
   */
  async settled({ page }) {
    await page.waitForSelector('#content > *', { state: 'attached' });
    /* Any bar mid-transition, and the pulse on a live dot, settle within a
       frame or two; a recording that catches one halfway looks like a defect. */
    await page.waitForTimeout(220);
  },
});
