/**
 * Browser-driven smoke test for the video-engine, using Playwright to
 * drive a real Chromium instance against the VideoPlayer test harness
 * (frontend/apps/VideoPlayer/) instead of relying on manual testing.
 *
 * Requires the dev server running (`node ./server.js`) and Chromium's
 * system dependencies installed once via
 * `sudo npx playwright install-deps chromium`.
 *
 * Exercises exactly the behaviors this engine exists to prove out:
 * forward playback, reverse playback (negative playbackRate), frame-
 * accurate stepping with no drift, arbitrary seeks (including into never-
 * before-decoded segments), and that overlapping seek requests always
 * settle on the most recently requested target rather than racing.
 *
 * @fileoverview Playwright smoke test for the video-engine, run via `npm run test:video-engine`.
 * @author Isaac Travers
 * @module video-engine/test/e2e-smoke-test
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.VIDEO_ENGINE_TEST_URL || 'http://localhost:3000/apps/VideoPlayer/';
// Generous: real segment fetch time against the live Jellyfin server over a
// slow connection has been observed taking 30s+ for a single segment.
const ENGINE_LOAD_TIMEOUT_MS = 90000;

/**
 * Reads the current mareVideo playback state from the page.
 *
 * @param {Object} page - Active Playwright page.
 * @returns {Promise<Object>} `{currentTime, paused, duration, fps}`.
 */
function getPlaybackState(page) {
    return page.evaluate(() => ({
        currentTime: window.mareVideo.currentTime,
        paused: window.mareVideo.paused,
        duration: window.mareVideo.duration,
        fps: window.mareVideo.fps,
    }));
}

/**
 * Runs the full smoke-test suite against a live browser page.
 *
 * @async
 * @returns {Promise<boolean>} True if every check passed.
 */
async function runSmokeTest() {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    let allPassed = true;
    const check = (label, condition) => {
        console.log(condition ? `PASS: ${label}` : `FAIL: ${label}`);
        if (!condition) {
            allPassed = false;
        }
    };

    console.log(`Loading ${BASE_URL} ...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.click('#loadButton');
    await page.waitForFunction(
        () => document.getElementById('playPauseButton') && !document.getElementById('playPauseButton').disabled,
        { timeout: ENGINE_LOAD_TIMEOUT_MS }
    );
    console.log('Engine loaded.\n');

    console.log('=== Forward playback ===');
    let before = await getPlaybackState(page);
    await page.click('#playPauseButton');
    await page.waitForTimeout(2000);
    let after = await getPlaybackState(page);
    check('time advances forward while playing at 1x', after.currentTime > before.currentTime);
    await page.click('#playPauseButton');
    await page.waitForTimeout(300);

    console.log('\n=== Reverse playback ===');
    before = await getPlaybackState(page);
    await page.fill('#speedInput', '-1');
    await page.dispatchEvent('#speedInput', 'change');
    await page.click('#playPauseButton');
    await page.waitForTimeout(2000);
    after = await getPlaybackState(page);
    check('time moves backward at playbackRate=-1 -- the whole point of this engine', after.currentTime < before.currentTime);
    await page.click('#playPauseButton');
    await page.evaluate(() => {
        window.mareVideo.playbackRate = 1;
    });
    await page.waitForTimeout(500);

    console.log('\n=== Frame-accurate stepping (no drift) ===');
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
    const drift = Math.abs(afterSteps.currentTime - start.currentTime);
    check(`5 forward + 5 back steps return to the exact starting frame (drift=${drift.toFixed(6)}s)`, drift < 0.001);

    console.log('\n=== Seek into a never-before-decoded segment ===');
    await page.evaluate(() => {
        window.mareVideo.currentTime = 20.0;
    });
    await page.waitForFunction(() => Math.abs(window.mareVideo.currentTime - 20.0) < 0.1, { timeout: 60000 }).catch(() => {});
    let state = await getPlaybackState(page);
    check(`seek forward to a cold segment lands near the target (got ${state.currentTime})`, Math.abs(state.currentTime - 20.0) < 0.1);

    console.log('\n=== Seek backward across segment boundaries ===');
    await page.evaluate(() => {
        window.mareVideo.currentTime = 5.0;
    });
    await page.waitForFunction(() => Math.abs(window.mareVideo.currentTime - 5.0) < 0.1, { timeout: 60000 }).catch(() => {});
    state = await getPlaybackState(page);
    check(`seek backward lands near the target (got ${state.currentTime})`, Math.abs(state.currentTime - 5.0) < 0.1);

    console.log('\n=== Overlapping seeks settle on the latest request, never a stale one ===');
    await page.evaluate(() => {
        window.mareVideo.currentTime = 30.0; // slow: a cold segment
        window.mareVideo.currentTime = 8.0; // issued immediately after, no await -- must win
    });
    // Generously long timeout: this scenario requires fetching+decoding
    // two never-before-seen segments back to back through the engine's
    // single shared VideoDecoder (deliberately serialized), and segment
    // fetch time against the live server has been observed taking 30s+
    // on its own -- slower than any realistic single commit-on-release seek.
    await page.waitForFunction(() => Math.abs(window.mareVideo.currentTime - 8.0) < 0.1, { timeout: 90000 }).catch(() => {});
    state = await getPlaybackState(page);
    check(`final position matches the LAST requested seek, not the superseded one (got ${state.currentTime})`, Math.abs(state.currentTime - 8.0) < 0.1);

    console.log('\n=== Summary ===');
    console.log(`Console errors during run: ${consoleErrors.length}`);
    consoleErrors.forEach((e) => console.log('  ', e));
    check('no console errors during the run', consoleErrors.length === 0);

    await browser.close();
    return allPassed;
}

runSmokeTest()
    .then((passed) => {
        console.log(passed ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
        process.exit(passed ? 0 : 1);
    })
    .catch((err) => {
        console.error('Smoke test crashed:', err);
        process.exit(1);
    });
