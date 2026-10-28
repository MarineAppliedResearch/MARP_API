/**
 * The video picker's card is styled for the markup it actually draws.
 *
 * The picker was rewritten to read the real Jellyfin library and its parts were renamed
 * to `.video-meta` and `.video-scope`, while the stylesheet kept rules for the old names
 * only. Unstyled, the Line and frame boxes fell into the 24px checkbox column on top of
 * the filename and each other: Isaac typed 780 into Line and it went into From frame.
 *
 * Layout itself is not observable here; this pins that every part the card draws has a
 * rule, which is the thing that went missing.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP } from './screen.mjs';

test('every part of the picker card has a rule', () => {
  const script = readFileSync(join(APP, 'screens.js'), 'utf8');
  const css = readFileSync(join(APP, 'screens.css'), 'utf8');
  const start = script.indexOf('class="video-choice');
  const card = script.slice(start, script.indexOf("+ '</article>';", start));
  const classes = [...card.matchAll(/class="([a-z-]+)/g)].map((m) => m[1])
    .filter((name) => !['inp', 'faint'].includes(name));

  assert.ok(classes.includes('video-scope') && classes.includes('video-meta'), `read the card: ${classes}`);

  for (const name of classes) {
    assert.match(css, new RegExp('[.]' + name + '(?![a-z-])[^{]*[{]'), `.${name} is drawn by the picker and styled nowhere`);
  }
});
