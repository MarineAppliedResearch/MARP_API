/**
 * The platform walkthrough run.
 *
 * The runner is shared -- tools/walkthrough/spec.mjs, ADR-0007. This is the second
 * consumer of it, and the first outside the mosaic reviewer.
 *
 * `settled` here is much simpler than the mosaic reviewer's: the entry page is a static
 * document, so there is no grid to wait for. It is still not nothing -- the page animates
 * on load, and a scene that scrolls before that finishes records a jump.
 */
import { test, expect } from '@playwright/test';
import { walkthrough } from '../../tools/walkthrough/spec.mjs';
import { scenarios } from './scenarios.mjs';

walkthrough({
  test,
  expect,
  scenarios,
  url: '/',
  async settled({ page }) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
  },
});
