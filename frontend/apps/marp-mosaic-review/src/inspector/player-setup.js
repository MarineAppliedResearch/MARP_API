/**
 * How the inspector builds its player (#181), in one place so a layout or memory
 * check can build it exactly the same way.
 */
import { cacheBudgets } from '../model/video-boxes.js';

const GIB = 1024 ** 3;

/* A desktop: a mouse or trackpad, and no touch screen as the main pointer. Phones and
   tablets are both "not a desktop", and both are held small. */
export function isDesktop(win = window) {
  if (typeof win.matchMedia !== 'function') return true;
  return win.matchMedia('(pointer: fine)').matches && !win.matchMedia('(pointer: coarse)').matches;
}

/**
 * The player, filling its container, with caches sized to the device.
 *
 * On a desktop the player's own settings stand. Elsewhere its defaults -- a 3 GiB raw
 * cache and, at load, a 3 GiB decoded-frame cache -- killed a phone browser on first use.
 */
export function createInspectorPlayer(container, win = window) {
  const budgets = cacheBudgets({ desktop: isDesktop(win) });
  const player = win.MarpVideoEngine.createMarpVideoPlayer(container, {
    // Fill the page's stage rather than a 16:9 box at its top: on a phone held upright
    // that box was a quarter of the screen, with the controls drawn over the picture.
    aspectRatio: null,
    maxWidth: null,
    ...(budgets ? { rawCacheGiB: budgets.rawGiB, decodedCacheGiB: budgets.decodedGiB } : {})
  });
  return { player, budgets };
}

/* Apply the decoded-frame budget to a freshly loaded engine: the player sizes the raw
   cache at load but leaves the decoded one at the engine's default until someone presses
   Apply in its Advanced settings. */
export function applyBudgets(engine, budgets, player = null) {
  if (!budgets) return;
  if (engine && typeof engine.setDecodedCacheBudgetBytes === 'function') {
    engine.setDecodedCacheBudgetBytes(Math.floor(budgets.decodedGiB * GIB));
  }
  if (engine && typeof engine.setRawSegmentCacheBudgetBytes === 'function') {
    engine.setRawSegmentCacheBudgetBytes(Math.floor(budgets.rawGiB * GIB));
  }
  // Show what is in force in the player's Advanced settings: they still read the 5 GiB
  // default, and pressing Apply there would have put back the size that crashed a phone.
  if (player && typeof player.syncCacheSettingsFromEngine === 'function') {
    player.syncCacheSettingsFromEngine();
  }
}
