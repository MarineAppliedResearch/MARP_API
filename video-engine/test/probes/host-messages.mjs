/**
 * What does player.html actually post to a WebView2 host?
 *
 * A host drives this player through messages, not function calls:
 * MareMediaElement raises MediaOpened from `status|loadedmetadata`, sizes
 * itself from `metadata|`, and moves its clock from `frame|`. If those never
 * arrive the host shows nothing -- no video, and none of its own UI, since
 * that waits on MediaOpened.
 *
 * Nothing else can catch this: the engine is fine, the page is fine, and the
 * messages are simply never sent. So this fakes chrome.webview and records
 * what the page posts.
 *
 * Usage: node video-engine/test/probes/host-messages.mjs
 * Requires the dev server running (node ./server.js).
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname });

const BASE = process.env.VIDEO_ENGINE_TEST_URL || 'http://localhost:3000/apps/VideoPlayer/';
const ITEM = process.env.JELLYFIN_ITEM || 'fb6a3c0fbd5e073d40e0840b9a54b79c';

const browser = await chromium.launch();
const page = await browser.newPage();

// Stand in for the host before any page script runs.
await page.addInitScript(() => {
    window.__hostMessages = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (message) => window.__hostMessages.push(String(message)) };
});

const helper = await browser.newPage();
await helper.goto(BASE, { waitUntil: 'load' });
const session = await helper.evaluate(
    async ({ server, user, pass }) => {
        const client = new MarpVideoEngine.JellyfinClient();
        await client.login(server, user, pass);
        return { serverUrl: client.serverUrl, token: client.accessToken, userId: client.userId };
    },
    {
        server: process.env.VIDEO_ENGINE_TEST_JELLYFIN_URL,
        user: process.env.VIDEO_ENGINE_TEST_JELLYFIN_USERNAME,
        pass: process.env.VIDEO_ENGINE_TEST_JELLYFIN_PASSWORD,
    },
);
await helper.close();

const query =
    `server=${encodeURIComponent(session.serverUrl)}&token=${encodeURIComponent(session.token)}` +
    `&user=${encodeURIComponent(session.userId)}&item=${ITEM}&mode=directPlay`;

await page.goto(`${BASE}player.html?${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.marpVideo && window.marpVideo.duration > 0, { timeout: 90_000 });
await page.evaluate(() => window.marpVideo.play());
await page.waitForTimeout(3000);
await page.evaluate(() => window.marpVideo.pause());

const messages = await page.evaluate(() => window.__hostMessages);
await browser.close();

const kinds = messages.map((m) => m.split('|')[0]);
const loadedMetadata = messages.find((m) => m.startsWith('status|loadedmetadata'));
const metadata = messages.find((m) => m.startsWith('metadata|'));
const frames = kinds.filter((k) => k === 'frame').length;

console.log(`messages posted: ${messages.length}`);
console.log(`  status|loadedmetadata : ${loadedMetadata || 'MISSING -- host would never raise MediaOpened'}`);
console.log(`  metadata|             : ${metadata || 'MISSING -- host would not know the video size'}`);
console.log(`  frame| count          : ${frames}${frames ? '' : '  MISSING -- host clock would never move'}`);

process.exit(loadedMetadata && metadata && frames > 0 ? 0 : 1);
