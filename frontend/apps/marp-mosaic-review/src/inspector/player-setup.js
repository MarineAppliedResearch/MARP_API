/**
 * How the inspector builds its player (#181), in one place so a layout or memory
 * check can build it exactly the same way.
 */
import { cacheBudgets } from '../model/video-boxes.js';

const GIB = 1024 ** 3;

/* A phone: a touch screen whose short side is phone-sized. */
export function isPhone(win = window) {
  const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  const screen = win.screen || {};
  return coarse && Math.min(screen.width || 0, screen.height || 0) < 820;
}

/**
 * The player, filling its container, with caches sized to the device.
 *
 * The player's own defaults are desktop-sized -- a 3 GiB raw cache and, at load, a 3 GiB
 * decoded-frame cache -- and a phone browser was killed by them on first use.
 */
export function createInspectorPlayer(container, win = window) {
  const budgets = cacheBudgets({ phone: isPhone(win), deviceMemoryGB: win.navigator && win.navigator.deviceMemory });
  const player = win.MarpVideoEngine.createMarpVideoPlayer(container, {
    // Fill the page's stage rather than a 16:9 box at its top: on a phone held upright
    // that box was a quarter of the screen, with the controls drawn over the picture.
    aspectRatio: null,
    maxWidth: null,
    rawCacheGiB: budgets.rawGiB,
    decodedCacheGiB: budgets.decodedGiB
  });
  return { player, budgets };
}

/* Apply the decoded-frame budget to a freshly loaded engine: the player sizes the raw
   cache at load but leaves the decoded one at the engine's default until someone presses
   Apply in its Advanced settings. */
export function applyBudgets(engine, budgets) {
  if (engine && typeof engine.setDecodedCacheBudgetBytes === 'function') {
    engine.setDecodedCacheBudgetBytes(Math.floor(budgets.decodedGiB * GIB));
  }
  if (engine && typeof engine.setRawSegmentCacheBudgetBytes === 'function') {
    engine.setRawSegmentCacheBudgetBytes(Math.floor(budgets.rawGiB * GIB));
  }
}
