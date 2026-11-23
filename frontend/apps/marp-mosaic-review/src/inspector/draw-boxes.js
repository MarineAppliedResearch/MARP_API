/**
 * Paints boxes on the video page's overlay in the annotation GUI's style (#181).
 *
 * What a box looks like is decided in `model/box-style.js`; this is only the canvas calls.
 * Text widths are measured once per label and font size and kept, because a busy frame
 * draws hundreds of labels and measuring each one every frame is a cost paid for nothing.
 */
import { GUI, DRAGGING, RESIZING, TAB_ALPHA, markerFor, identifierText, tabLayout } from '../model/box-style.js';
import { gripsOf, GRIP_RADIUS } from '../model/box-edit.js';

const FONT = '"Segoe UI", system-ui, sans-serif';

/* The selected observation's halo, so it stands out while keeping its species' colour. */
const HIGHLIGHT = '#c7ff62';

const widths = new Map();

function textWidth(context, text, font) {
  const key = `${font}|${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    context.font = font;
    width = context.measureText(text).width;
    // A long session can meet a great many labels; this is a cache, not a record.
    if (widths.size > 5000) widths.clear();
    widths.set(key, width);
  }
  return width;
}

/* A rectangle with the GUI's corner radii, in its order: top left, top right, bottom right,
   bottom left. */
function tab(context, { left, top, width, height }, radii, fill) {
  context.beginPath();
  context.roundRect(left, top, width, height, radii);
  context.fillStyle = fill;
  // Let down, so the video reads through a label (Isaac, 2026-11-23); the text stays solid.
  context.save();
  context.globalAlpha = TAB_ALPHA;
  context.fill();
  context.restore();
}

function marker(context, type, x, middle, size) {
  const { shape, colour, hollow } = markerFor(type);
  const top = middle - size / 2;
  context.beginPath();
  if (shape === 'right') {
    context.moveTo(x, top);
    context.lineTo(x + size, middle);
    context.lineTo(x, top + size);
    context.closePath();
  } else if (shape === 'left') {
    context.moveTo(x + size, top);
    context.lineTo(x, middle);
    context.lineTo(x + size, top + size);
    context.closePath();
  } else {
    const r = hollow ? size / 2 - 1 : size / 2;
    context.arc(x + size / 2, middle, r, 0, Math.PI * 2);
  }
  if (hollow) {
    context.lineWidth = 2;
    context.strokeStyle = colour;
    context.stroke();
  } else {
    context.fillStyle = colour;
    context.fill();
  }
}

/**
 * How wide a box's two tabs are on screen, for laying out boxes that share a place (#352).
 *
 * @param {CanvasRenderingContext2D} context
 * @param {Object} entry - `{ box, rect }`.
 * @param {number} scale - The label scale.
 * @returns {{top: number, bottom: number}}
 */
export function tabWidths(context, { box, rect }, scale) {
  const layout = tabLayout(rect, scale, {
    top: textWidth(context, box.comname || 'Unknown', `bold ${GUI.topFont * scale}px ${FONT}`),
    bottom: textWidth(context, identifierText(box), `${GUI.bottomFont * scale}px ${FONT}`)
  });
  return { top: layout.top.width, bottom: layout.bottom.width };
}

/**
 * Where a box's two tabs are on screen, so a click on a label can pick its box (#352): the
 * boxes of one moment's habitat stretches are one rectangle, and only their labels differ.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {Object} entry - `{ box, rect }`.
 * @param {number} scale - From `labelScale`.
 * @param {{top: number, bottom: number}} shift - From `sharedTabShifts`.
 * @returns {Array<{left: number, top: number, width: number, height: number}>}
 */
export function tabRects(context, { box, rect }, scale, shift) {
  const layout = tabLayout(rect, scale, {
    top: textWidth(context, box.comname || 'Unknown', `bold ${GUI.topFont * scale}px ${FONT}`),
    bottom: textWidth(context, identifierText(box), `${GUI.bottomFont * scale}px ${FONT}`)
  }, shift);
  return [layout.top, layout.bottom].map(({ left, top, width, height }) => ({ left, top, width, height }));
}

/**
 * Paint one box.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {Object} entry - `{ box, rect }`: the box and where it is on screen.
 * @param {Object} state - `{ colour, type, selected, pressed, scale, shift }`: its species'
 *   colour, the kind of keyframe on this picture, whether it is selected, the part being
 *   pressed if any, the label scale, and how far along the edge its tabs start (#352).
 */
export function drawBox(context, { box, rect }, { colour, type, selected, pressed, scale, shift, fixed, second }) {
  // Pressed, it is the GUI's state colour: the outline and the tab both.
  const tone = pressed ? (pressed === 'body' ? DRAGGING : RESIZING) : colour;

  // The halo says "this is the one you are working on", so it follows the selection rather
  // than staying on whatever the page was opened from (Isaac, 2026-10-14).
  if (selected) {
    // Outside the outline, so the box keeps the colour every box of its species has.
    const gap = 4 * scale;
    context.save();
    context.shadowColor = HIGHLIGHT;
    context.shadowBlur = 10;
    context.lineWidth = 2 * scale;
    context.strokeStyle = HIGHLIGHT;
    context.strokeRect(rect.left - gap, rect.top - gap, rect.width + gap * 2, rect.height + gap * 2);
    context.restore();
  }

  // Inside the box's bounds, as WPF strokes a Rectangle.
  const line = (selected ? GUI.selectedStroke : GUI.stroke) * scale;
  context.lineWidth = line;
  context.strokeStyle = tone;
  context.strokeRect(rect.left + line / 2, rect.top + line / 2,
    Math.max(0, rect.width - line), Math.max(0, rect.height - line));

  const topFont = `bold ${GUI.topFont * scale}px ${FONT}`;
  const bottomFont = `${GUI.bottomFont * scale}px ${FONT}`;
  const name = box.comname || 'Unknown';
  const identifier = identifierText(box);
  const layout = tabLayout(rect, scale, {
    top: textWidth(context, name, topFont),
    bottom: textWidth(context, identifier, bottomFont)
  }, shift || { top: 0, bottom: 0 });
  const r = GUI.radius * scale;

  // The species tab, square at the corner it sits on.
  tab(context, layout.top, [r, r, r, 0], tone);
  marker(context, type, layout.top.markerLeft, layout.top.middle, layout.top.marker);
  context.font = topFont;
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(name, layout.top.textLeft, layout.top.middle);

  // The identifier tab, under the box, on every box as the GUI shows it.
  tab(context, layout.bottom, [0, r, r, r], '#000000');
  context.font = bottomFont;
  context.fillStyle = '#ffffff';
  context.fillText(identifier, layout.bottom.textLeft, layout.bottom.middle);

  // Picked second, to be cut by the selected one (#360): a dashed outline just outside it.
  if (second) {
    const gap = 6 * scale;
    context.save();
    context.setLineDash([6 * scale, 4 * scale]);
    context.lineWidth = 2 * scale;
    context.strokeStyle = '#ffffff';
    context.strokeRect(rect.left - gap, rect.top - gap, rect.width + gap * 2, rect.height + gap * 2);
    context.restore();
  }

  if (selected && !fixed) {
    for (const grip of gripsOf(rect)) {
      context.beginPath();
      context.arc(grip.x, grip.y, GRIP_RADIUS, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      context.stroke();
    }
  }
}
