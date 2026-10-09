/**
 * Playwright for the platform-level walkthroughs.
 *
 * Only the walkthrough project lives here. The API's own suite is Jest against a real
 * database, and each frontend application carries its own Playwright config -- see
 * frontend/apps/marp-mosaic-review. This config exists so the *site* can be filmed:
 * the entry page, signing in, and the dashboard, which no single application owns.
 *
 * It does not start the server. These walkthroughs run against a real MARP with a real
 * database and a real account, so `npm run dev` has to be up already -- and if it is not,
 * failing to connect is the honest outcome rather than booting something half-configured.
 */
export default {
  testDir: './tests/walkthrough',
  outputDir: './test-results',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  projects: [
    {
      name: 'walkthrough',
      use: {
        baseURL: process.env.MARP_BASE_URL || 'http://localhost:3000',
        viewport: { width: 1600, height: 900 },
        video: { mode: 'on', size: { width: 1600, height: 900 } },
        actionTimeout: 20_000,
      },
    },
  ],
};
