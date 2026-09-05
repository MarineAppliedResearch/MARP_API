/**
 * Platform-level walkthroughs — the MARP site itself, not one application.
 *
 * These run against a real running API on localhost:3000 with a real database, unlike the
 * mosaic reviewer's walkthroughs, which drive a fixture. That makes them slower and it
 * makes them depend on the machine being set up, which is why they are recorded on
 * request and are not part of any tier.
 *
 * Credentials come from the environment, never from this file:
 *
 *   MARP_DEMO_USERNAME
 *   MARP_DEMO_PASSWORD
 *
 * `marp harness check` fails on a credential in a tracked file, and it is right to.
 */

const USERNAME = process.env.MARP_DEMO_USERNAME || '';
const PASSWORD = process.env.MARP_DEMO_PASSWORD || '';

/** Scroll so a section sits properly in frame, and let the motion finish. */
async function scrollTo(page, selector, settle = 1100) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(settle);
}

export const scenarios = {
  /* ------------------------------------------------------- platform tour */
  platform: {
    title: 'MARP — the platform, and signing in',
    scenes: [
      {
        caption: 'Marp',
        say: "This is Marp — the Marine Analysis and Reporting Platform. Everything an "
           + "ecological survey produces ends up here, and this is the front door.",
        async act({ page }) {
          await scrollTo(page, '#home', 600);
        }
      },
      {
        caption: 'One workflow, end to end',
        say: "Marp is one workflow for ecological data. Field collection, expert review, "
           + "processing, machine learning, and reporting — all of it against the same "
           + "records rather than a chain of separate tools handing files to each other.",
        async act({ page }) {
          await scrollTo(page, '#platform');
        }
      },
      {
        caption: 'From field data to trusted outputs',
        say: "The path runs from raw survey data through to outputs somebody is willing to "
           + "put their name on. Each step is recorded, so a number in a final report can be "
           + "traced back to the observation it came from.",
        async act({ page }) {
          await scrollTo(page, '#how-it-works');
        }
      },
      {
        caption: 'Biologists lead. MARP amplifies.',
        say: "This is the part that matters most. Machine learning takes the repetitive work "
           + "— finding candidates, tracking them, counting them — but the biological "
           + "judgement stays with the biologist. Marp speeds the work up. It does not "
           + "decide what anything is.",
        async act({ page }) {
          await scrollTo(page, '#why-marp');
        }
      },
      {
        caption: 'The applications',
        say: "The tools built on top of it live here — the review applications, the "
           + "dashboards, and the video work.",
        async act({ page }) {
          await scrollTo(page, '#applications');
        }
      },
      {
        caption: 'Signing in',
        say: "Almost everything past this point needs an account, because every review and "
           + "every correction belongs to the person who made it. So let's sign in.",
        async act({ page, expect }) {
          await page.locator('[data-login-open]').first().click();
          await expect(page.locator('[data-login-dialog]')).toBeVisible();
          await page.waitForTimeout(2600);
        }
      },
      {
        caption: 'Into the dashboard',
        say: "And that takes us to the dashboard, which is where a session actually starts.",
        async act({ page, expect }) {
          if (!USERNAME || !PASSWORD) {
            throw new Error(
              'MARP_DEMO_USERNAME and MARP_DEMO_PASSWORD are not set. The walkthrough will '
              + 'not fake a login: a video of a sign-in that did not happen is exactly the '
              + 'kind of convincing film this tooling exists to prevent.');
          }

          await page.locator('[data-login-form] input[name="username"]').fill(USERNAME);
          await page.waitForTimeout(500);
          await page.locator('[data-login-form] input[name="password"]').fill(PASSWORD);
          await page.waitForTimeout(700);
          await page.locator('[data-login-form] button[type="submit"]').click();

          /* Assert we actually arrived. The scene claims a dashboard; it has to prove one. */
          await page.waitForURL(/\/apps\/dashboard/, { timeout: 20000 });
          await expect(page).toHaveURL(/\/apps\/dashboard/);
          await page.waitForTimeout(2200);
        }
      },
      {
        caption: 'Marp',
        say: "Surveys this year, sites covered, area surveyed, effort over time, habitat "
           + "mix, and how the protected areas compare with the reference sites. That is "
           + "Marp from the outside in — one platform, one set of records, and every piece "
           + "of work attached to the person who did it.",
        async act({ page }) {
          /* Show the dashboard rather than talk over a static header: the charts are the
             point of the closing line. */
          await page.mouse.wheel(0, 420);
          await page.waitForTimeout(1500);
          await page.mouse.wheel(0, 480);
          await page.waitForTimeout(1200);
        }
      }
    ]
  },
};

export const scenarioIds = Object.keys(scenarios);
