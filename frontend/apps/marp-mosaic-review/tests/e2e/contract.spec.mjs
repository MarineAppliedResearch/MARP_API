/**
 * Runs the browser contract checks as part of the suite.
 *
 * `tests/requirements.js` has always been the tier that names the requirement from
 * #68 each check holds us to, but it only ran when somebody opened `tests.html` in a
 * tab — so a red result could sit there unseen. This drives the same page headlessly
 * and fails the build on it.
 *
 * It reports each failing check by name rather than one opaque count, because the
 * requirement name is the useful part.
 */
import { test, expect } from '@playwright/test';

/* Every check drives the real store against the fixture's simulated latency, so the
   whole page takes far longer than a render test. Its own budget, not the default. */
test.setTimeout(240_000);

test('the requirement checks in tests.html all pass', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('./tests.html');
  await expect(page.locator('.summary')).toBeVisible({ timeout: 60_000 });

  const failures = await page.locator('li.fail').allInnerTexts();
  expect(failures, `contract checks failed:\n${failures.join('\n')}`).toEqual([]);

  const summary = await page.locator('.summary').innerText();
  expect(summary, 'the summary should report no failures').toContain('0');
  expect(errors).toEqual([]);
});
