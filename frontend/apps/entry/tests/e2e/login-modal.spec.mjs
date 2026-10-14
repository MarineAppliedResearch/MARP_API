import { test, expect } from '@playwright/test';

/**
 * A 320px phone with only 300px left above its keyboard is deliberately harsher than the
 * ordinary phone project. It reproduces #192 at the tier that can see clipped controls.
 */
test('#192: a keyboard-shortened phone can reach and submit the whole login form',
  async ({ page }) => {
    let submitted;

    await page.route('**/api/v2/auth/login', async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Test credentials were submitted.' } })
      });
    });

    await page.goto('/');
    await page.locator('[data-menu-toggle]').click();
    await page.locator('.site-header [data-login-open]').click();

    const dialog = page.locator('[data-login-dialog]');
    const visual = page.locator('.login-dialog__visual');
    const username = dialog.locator('input[name="username"]');
    const password = dialog.locator('input[name="password"]');
    const submit = dialog.locator('button[type="submit"]');
    const close = dialog.locator('[data-login-close]');

    await expect(dialog).toBeVisible();
    await expect(visual, 'ordinary phones keep the existing visual panel').toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    await expect(visual, 'decorative art gives way on a genuinely short phone').toBeHidden();
    await username.fill('small-phone-user');
    await password.fill('keyboard-visible-password');
    await password.focus();

    /* Model the visual viewport after the phone keyboard opens. */
    await page.setViewportSize({ width: 320, height: 300 });

    const constrained = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: box.top,
        bottom: box.bottom,
        viewport: document.documentElement.clientHeight,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      };
    });

    expect(constrained.top).toBeGreaterThanOrEqual(0);
    expect(constrained.bottom).toBeLessThanOrEqual(constrained.viewport);
    expect(['auto', 'scroll']).toContain(constrained.overflowY);
    expect(constrained.scrollHeight).toBeGreaterThan(constrained.clientHeight);

    const pageBefore = await page.evaluate(() => window.scrollY);
    await dialog.hover();
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageBefore);

    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await submit.click();
    await expect(dialog.locator('[data-login-status]')).toHaveText('Test credentials were submitted.');
    expect(submitted).toEqual({
      username: 'small-phone-user',
      password: 'keyboard-visible-password'
    });

    await dialog.evaluate((element) => element.scrollTo(0, 0));
    await expect(close).toBeInViewport();
    await close.click();
    await expect(dialog).toBeHidden();
  });
