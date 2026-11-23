/* What the video page paints for a box's labels (2026-11-23). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { drawBox } from '../../src/inspector/draw-boxes.js';
import { TAB_ALPHA } from '../../src/model/box-style.js';

/* A canvas that records what each fill and each line of text was painted with. */
function recordingCanvas() {
  const state = { globalAlpha: 1, fillStyle: '#000000' };
  const saved = [];
  const fills = [];
  const texts = [];
  return {
    fills,
    texts,
    context: new Proxy(state, {
      get(target, key) {
        if (key === 'save') return () => saved.push({ ...target });
        if (key === 'restore') return () => Object.assign(target, saved.pop());
        if (key === 'fill') return () => fills.push({ fillStyle: target.fillStyle, alpha: target.globalAlpha });
        if (key === 'fillText') return (text) => texts.push({ text, alpha: target.globalAlpha });
        if (key === 'measureText') return (text) => ({ width: text.length * 7 });
        if (key in target) return target[key];
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      }
    })
  };
}

test('a box\'s name tab and identifier tab are see-through, and their text is not', () => {
  const { context, fills, texts } = recordingCanvas();
  const box = { observation_id: 497025, obs_id: 12, comname: 'Rock', subset: '1' };
  drawBox(context, { box, rect: { left: 100, top: 200, width: 300, height: 150 } },
    { colour: '#8b5a2b', type: 'start', selected: false, pressed: null, scale: 1, shift: { top: 0, bottom: 0 } });

  const nameTab = fills.find((f) => f.fillStyle === '#8b5a2b');
  const identifierTab = fills.find((f) => f.fillStyle === '#000000');
  assert.ok(nameTab && identifierTab, 'both tabs were painted');
  assert.equal(nameTab.alpha, TAB_ALPHA);
  assert.equal(identifierTab.alpha, TAB_ALPHA);
  // 0x99 was not see-through enough (Isaac, 2026-11-23).
  assert.ok(TAB_ALPHA <= 0.45 && TAB_ALPHA >= 0.3, 'well see-through, but the colour still shows');
  assert.ok(texts.length >= 2 && texts.every((t) => t.alpha === 1), 'the writing on them stays solid');
});
