/**
 * Paints boxes on the video page's overlay in the annotation GUI's style (#181).
 *
 * What a box looks like is decided in `model/box-style.js`; this is only the canvas calls.
 * Text widths are measured once per label and font size and kept, because a busy frame
 * draws hundreds of labels and measuring each one every frame is a cost paid for nothing.
 */
import { GUI, DRAGGING, RESIZING, markerFor, identifierText, tabLayout } from '../model/box-style.js';
import { gripsOf, GRIP_RADIUS } from '../model/box-edit.js';

const FONT = '"Segoe UI", system-ui, sans-serif';

/* The opened observation's halo, so it stands out while keeping its species' colour. */
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
  context.fill();
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
 * Paint one box.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {Object} entry - `{ box, rect, opened }`: the box, where it is on screen, and
 *   whether it is the observation the reviewer opened.
 * @param {Object} state - `{ colour, type, selected, pressed, scale }`: its species'
 *   colour, the kind of keyframe on this picture, whether it is selected, the part being
 *   pressed if any, and the label scale.
 */
export function drawBox(context, { box, rect, opened }, { colour, type, selected, pressed, scale }) {
  // Pressed, it is the GUI's state colour: the outline and the tab both.
  const tone = pressed ? (pressed === 'body' ? DRAGGING : RESIZING) : colour;

  if (opened) {
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
  });
  const r = GUI.radius * scale;

  // The species tab, square at the corner it sits on.
  tab(context, layout.top, [r, r, r, 0], tone);
  marker(context, type, layout.top.markerLeft, layout.top.middle, layout.top.marker);
  context.font = topFont;
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(name, layout.top.textLeft, layout.top.middle);

  // The identifier tab, under the box, on every box as the GUI shows it.
  tab(context, layout.bottom, [0, r, r, r], 'rgba(0, 0, 0, 0.8)');
  context.font = bottomFont;
  context.fillStyle = '#ffffff';
  context.fillText(identifier, layout.bottom.textLeft, layout.bottom.middle);

  if (selected) {
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
