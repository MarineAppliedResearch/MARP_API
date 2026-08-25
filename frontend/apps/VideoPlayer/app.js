/**
 * Mounts the player library on the test-harness page.
 *
 * Everything this file used to do -- build the controls, wire 41 listeners,
 * own the load paths -- now lives in the library (video-engine/src/ui/), so
 * a consumer gets the same player from one call. What is left here is only
 * what a library must not ship: the dev server's credentials, the dev item
 * id, and the page globals the Playwright suite and the probes drive.
 *
 * @fileoverview Test-harness page glue: mounts MarpVideoEngine's player.
 * @author Isaac Travers
 */

"use strict";

/** Dev Jellyfin instance (port 8097 -- never the production server on 8096), prefilled into the player's login form for convenience. */
const DEV_JELLYFIN = {
    serverUrl: "http://47.208.203.78:8097",
    username: "admin",
    password: "MarpDevJellyfinRemote2026!",
};

/** Item used for manual testing, prefilled into the player's item-id field. */
const DEV_ITEM_ID = "fb6a3c0fbd5e073d40e0840b9a54b79c";

const player = MarpVideoEngine.createMarpVideoPlayer(document.getElementById("playerMount"), {
    prefill: DEV_JELLYFIN,
    defaultItemId: DEV_ITEM_ID,
    // The e2e suite and the probes wait on window.marpVideo, which is also
    // the integration contract the C# host depends on.
    exposeGlobals: true,
});

window.marpPlayer = player;

/**
 * Loads an item, exposed as a page global because the Playwright suite
 * calls it directly to force a specific quality tier (Direct Play vs a
 * transcode ladder rung) rather than clicking through the menu.
 *
 * @param {string} itemId - Jellyfin item id.
 * @param {Object} [qualityOption] - Tier to load; the first tier when omitted.
 * @returns {Promise<Object|null>} The loaded engine, or null on failure.
 */
window.loadItem = (itemId, qualityOption) => player.loadItem(itemId, qualityOption);
