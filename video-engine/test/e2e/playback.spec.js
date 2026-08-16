/**
 * Browser-driven E2E suite for the video-engine, using @playwright/test to
 * drive a real Chromium instance against the VideoPlayer test harness
 * (frontend/apps/VideoPlayer/) and a real, live Jellyfin server.
 *
 * Converted from the original hand-rolled test/e2e-smoke-test.js script
 * (one file, manual check()/pass-fail counting) into named, individually
 * reported test() cases -- each phase of the engine's build-out can add
 * its own describe block here without touching the others.
 *
 * Deliberately one shared page for the whole file (test.beforeAll +
 * describe.configure({mode: 'serial'})), NOT Playwright's default
 * per-test page fixture -- the engine load itself (playlist fetch, init +
 * first-segment fetch/demux/decode, a real Jellyfin transcode
 * negotiation) is the single most expensive step here, and every check in
 * this file is cheap to run again once against the one already-loaded
 * engine. A per-test page (Playwright's default) would repeat that full
 * load 6x -- 6 separate real Jellyfin transcode sessions and ~2x the
 * total segment decodes for no added coverage -- confirmed the wrong
 * default for this suite specifically because these checks are a
 * sequential walk through one session's state, exactly like the original
 * script, not 6 independent scenarios.
 *
 * Requires the dev server running (`node ./server.js`) and Chromium's
 * system dependencies installed once via
 * `sudo npx playwright install-deps chromium`. Run via
 * `npm run test:video-engine:e2e`.
 *
 * @fileoverview @playwright/test E2E suite for the video-engine.
 * @author Isaac Travers
 * @module video-engine/test/e2e/playback.spec
 */

const { test, expect } = require('@playwright/test');

/** Real segment fetch time against the live Jellyfin server over a slow connection has been observed taking 30s+ for a single segment. */
const ENGINE_LOAD_TIMEOUT_MS = 90_000;

/**
 * Reads the current window.marpVideo playback state from the page.
 *
 * @param {Object} page - Active Playwright page.
 * @returns {Promise<{currentTime: number, paused: boolean, duration: number, fps: number}>} Current playback state.
 */
function getPlaybackState(page) {
    return page.evaluate(() => ({
        currentTime: window.marpVideo.currentTime,
        paused: window.marpVideo.paused,
        duration: window.marpVideo.duration,
        fps: window.marpVideo.fps,
    }));
}

test.describe('video-engine playback', () => {
    // Serial: later tests build on state left behind by earlier ones
    // (e.g. "reverse playback" starts from wherever "forward playback"
    // left currentTime), exactly like the original script's single
    // top-to-bottom run -- and if an early check fails, the later ones
    // are skipped rather than cascading into confusing unrelated failures.
    test.describe.configure({ mode: 'serial' });

    /** The one page/engine load shared by every test in this file -- see the file doc comment for why. */
    let page;

    /** Console errors seen since the last afterEach check. */
    let consoleErrors;

    test.beforeAll(async ({ browser }) => {
        // Playwright's global per-test timeout (playwright.config.js) also
        // bounds this hook by default -- goto()+click() overhead on top of
        // the full ENGINE_LOAD_TIMEOUT_MS wait below can exceed that global
        // budget under real (slow) network conditions, killing the browser
        // mid-load rather than failing with a clear "engine didn't load"
        // message. Scoped here, not raised globally, so this one
        // known-slow step gets the room it needs without loosening every
        // other test's timeout. Comfortably above ENGINE_LOAD_TIMEOUT_MS
        // (not the same value -- that was the bug in the previous attempt).
        test.setTimeout(ENGINE_LOAD_TIMEOUT_MS + 60_000);

        page = await browser.newPage();
        consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });
        page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

        // Deliberately '', not '/' -- a leading-slash path resolves
        // against baseURL's ORIGIN ONLY, discarding its /apps/VideoPlayer/
        // path segment (standard URL resolution), which sent this to the
        // site's marketing homepage instead of the test harness -- '' is
        // the one relative reference that resolves to baseURL unchanged.
        // Confirmed live: the failure this caused looked exactly like a
        // hang (page.click('#loadButton') never finding that element,
        // since the homepage has no such button) and was first
        // misdiagnosed as needing a longer timeout instead.
        await page.goto('', { waitUntil: 'load' });

        // loadItem() (app.js) now requires an authenticated JellyfinClient
        // before it will do anything -- added by the direct-browser
        // JellyfinClient/MediaSource refactor (#36 phase 4). A fresh
        // Playwright page has no stored session, so this suite must sign
        // in first or every test here fails identically with "sign in to
        // a Jellyfin server first", not a real playback problem.
        const serverUrl = process.env.VIDEO_ENGINE_TEST_JELLYFIN_URL;
        const username = process.env.VIDEO_ENGINE_TEST_JELLYFIN_USERNAME;
        const password = process.env.VIDEO_ENGINE_TEST_JELLYFIN_PASSWORD;
        if (!serverUrl || !username || !password) {
            throw new Error(
                'VIDEO_ENGINE_TEST_JELLYFIN_URL/USERNAME/PASSWORD must be set (see .env) to run this suite.'
            );
        }
        // The login fields live inside the gear menu's "Server / Login"
        // accordion section, hidden until the gear button opens the menu
        // (that section is expanded by default once open, per app.js's
        // openSettingsSectionId initial value).
        await page.click('#playerSettingsButton');
        await page.fill('#jellyfinServerUrlInput', serverUrl);
        await page.fill('#jellyfinUsernameInput', username);
        await page.fill('#jellyfinPasswordInput', password);
        await page.click('#jellyfinLoginButton');
        await page.waitForFunction(
            () => document.getElementById('loginStatus').textContent.startsWith('Signed in'),
            { timeout: 15_000 }
        );

        // Loading requires opening the "Load Item" accordion section too --
        // "Server / Login" is the only one expanded by default.
        await page.click('[data-section="settingsLoadItemBody"]');
        await page.click('#loadButton');
        await page.waitForFunction(
            () => document.getElementById('playPauseButton') && !document.getElementById('playPauseButton').disabled,
            { timeout: ENGINE_LOAD_TIMEOUT_MS }
        );
    });

    test.afterAll(async () => {
        await page.close();
    });

    test.afterEach(() => {
        // Surfaced as a real assertion (not just a printed count) so a
        // console error fails the specific test it happened during,
        // rather than only showing up in one final summary check.
        expect(consoleErrors, `console errors during the test: ${consoleErrors.join('; ')}`).toHaveLength(0);
        consoleErrors.length = 0;
    });

    test('time advances forward while playing at 1x', async () => {
        const before = await getPlaybackState(page);
        await page.click('#playPauseButton');
        await page.waitForTimeout(2000);
        const after = await getPlaybackState(page);
        await page.click('#playPauseButton');

        expect(after.currentTime).toBeGreaterThan(before.currentTime);
    });

    test('time moves backward at playbackRate=-1 -- the whole point of this engine', async () => {
        const before = await getPlaybackState(page);
        // #speedOverrideInput, not #speedInput -- renamed in the Phase 2
        // player-chrome rewrite (frontend/apps/VideoPlayer/index.html).
        await page.fill('#speedOverrideInput', '-1');
        await page.dispatchEvent('#speedOverrideInput', 'change');
        await page.click('#playPauseButton');
        await page.waitForTimeout(2000);
        const after = await getPlaybackState(page);
        await page.click('#playPauseButton');
        await page.evaluate(() => {
            window.marpVideo.playbackRate = 1;
        });

        expect(after.currentTime).toBeLessThan(before.currentTime);
    });

    test('5 forward + 5 back steps return to the exact starting frame (no drift)', async () => {
        const start = await getPlaybackState(page);

        for (let i = 0; i < 5; i++) {
            await page.click('#stepForwardButton');
            await page.waitForTimeout(150);
        }
        for (let i = 0; i < 5; i++) {
            await page.click('#stepBackButton');
            await page.waitForTimeout(150);
        }

        const afterSteps = await getPlaybackState(page);
        expect(Math.abs(afterSteps.currentTime - start.currentTime)).toBeLessThan(0.001);
    });

    test('seek forward to a never-before-decoded segment lands near the target', async () => {
        await page.evaluate(() => {
            window.marpVideo.currentTime = 20.0;
        });
        await page
            .waitForFunction(() => Math.abs(window.marpVideo.currentTime - 20.0) < 0.1, { timeout: 60_000 })
            .catch(() => {});

        const state = await getPlaybackState(page);
        expect(Math.abs(state.currentTime - 20.0)).toBeLessThan(0.1);
    });

    test('seek backward across segment boundaries lands near the target', async () => {
        await page.evaluate(() => {
            window.marpVideo.currentTime = 5.0;
        });
        await page
            .waitForFunction(() => Math.abs(window.marpVideo.currentTime - 5.0) < 0.1, { timeout: 60_000 })
            .catch(() => {});

        const state = await getPlaybackState(page);
        expect(Math.abs(state.currentTime - 5.0)).toBeLessThan(0.1);
    });

    test('overlapping seeks settle on the latest request, never a stale one', async () => {
        await page.evaluate(() => {
            window.marpVideo.currentTime = 30.0; // slow: a cold segment
            window.marpVideo.currentTime = 8.0; // issued immediately after, no await -- must win
        });

        // Generously long timeout: this scenario requires fetching+decoding
        // two never-before-seen segments back to back through the engine's
        // single shared VideoDecoder (deliberately serialized), and segment
        // fetch time against the live server has been observed taking 30s+
        // on its own -- slower than any realistic single commit-on-release seek.
        await page
            .waitForFunction(() => Math.abs(window.marpVideo.currentTime - 8.0) < 0.1, { timeout: 90_000 })
            .catch(() => {});

        const state = await getPlaybackState(page);
        expect(Math.abs(state.currentTime - 8.0)).toBeLessThan(0.1);
    });
});
