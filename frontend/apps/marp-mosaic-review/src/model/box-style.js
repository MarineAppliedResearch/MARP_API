/**
 * How a box looks on the video page (#181): the annotation GUI's, from
 * `AnnotationRectangle.xaml` and `AnnotationRectangle.xaml.cs`.
 *
 * Isaac, 2026-10-06: "preserve the same style of boxes that we have in the gui". So the
 * outline is the species' colour, 3.5 pixels and 5 when selected; the species name sits in
 * a tab of that colour on the box's top left corner, with the keyframe type's marker in
 * front of it; the identifier sits in a dark tab under the box; and the selected box carries
 * four white grips.
 *
 * One thing differs on purpose: the GUI draws its labels at fixed pixel sizes, and here
 * they follow the size of the picture, so a small window does not bury the animals in
 * labels and a large one does not leave them unreadable. At a picture 600 pixels high
 * every size is the GUI's own.
 *
 * Pure: sizes, positions, colours and words. `inspector/draw-boxes.js` paints them.
 */

/* The picture height at which every size here is the GUI's own. */
const GUI_PICTURE_HEIGHT = 600;

/**
 * How much bigger or smaller than the GUI's everything is drawn, for a picture this tall
 * on screen. Held within limits, so a tiny window keeps a readable label and a huge one
 * does not draw a banner.
 */
export function labelScale(pictureHeight) {
  const scale = (Number(pictureHeight) || GUI_PICTURE_HEIGHT) / GUI_PICTURE_HEIGHT;
  return Math.min(1.6, Math.max(0.7, scale));
}

/* The GUI's sizes, in its pixels. */
export const GUI = {
  stroke: 3.5,
  selectedStroke: 5,
  topFont: 14,
  bottomFont: 12,
  // Padding left, top, right, bottom, as the GUI's Border.Padding.
  topPadding: [6, 2, 9, 2],
  bottomPadding: [6, 1, 9, 2],
  marker: 12,
  markerGap: 6,
  radius: 3,
  // The tabs' offsets from the box: Margin="-2,-25,0,0" and Margin="-2,0,0,-22".
  tabLeft: -2,
  topAbove: 25,
  bottomBelow: 22
};

/* The GUI's state colours: Colors.Orange while a box is moved, BlueViolet while resized. */
export const DRAGGING = '#ffa500';
export const RESIZING = '#8a2be2';

/**
 * The marker for a kind of keyframe: shape and colour both, as the GUI's, because at this
 * size two reds are not tellable apart. Triangles point the way the annotation runs.
 *
 * @param {string} type - `start`, `middle`, `end`, or anything else for an in-between box.
 * @returns {{shape: 'right'|'left'|'circle', colour: string, hollow: boolean}}
 */
export function markerFor(type) {
  if (type === 'start') return { shape: 'right', colour: '#ff6b6b', hollow: false };
  if (type === 'middle') return { shape: 'circle', colour: '#6fb1ff', hollow: false };
  if (type === 'end') return { shape: 'left', colour: '#ff6b6b', hollow: false };
  return { shape: 'circle', colour: '#a7ec35', hollow: true };
}

/**
 * The identifier under a box, as the GUI writes it: the observation's number in its
 * session, then its database id, then the subset when it is not the GUI's single "0".
 */
export function identifierText({ obs_id: obsId, observation_id: id, subset }) {
  const sub = subset == null ? '' : String(subset);
  return `${obsId ?? '?'}  ·  ${id}${sub !== '' && sub !== '0' ? ` : ${sub}` : ''}`;
}

/**
 * Where the two tabs go for a box on screen, given how wide their text is.
 *
 * @param {{left: number, top: number, width: number, height: number}} rect - The box.
 * @param {number} scale - From `labelScale`.
 * @param {{top: number, bottom: number}} textWidths - Each tab's text width at its font.
 * @returns {{top: Object, bottom: Object}} Each tab's `left, top, width, height`, and for
 *   the top tab where its marker and text start.
 */
export function tabLayout(rect, scale, textWidths, shift = { top: 0, bottom: 0 }) {
  const [tl, tt, tr, tb] = GUI.topPadding.map((p) => p * scale);
  const [bl, bt, br, bb] = GUI.bottomPadding.map((p) => p * scale);
  const left = rect.left + GUI.tabLeft * scale + shift.top;
  const bottomLeft = rect.left + GUI.tabLeft * scale + shift.bottom;

  // A line of text is about 1.33 of its font size, as WPF lays one out.
  const topLine = GUI.topFont * scale * 1.33;
  const marker = GUI.marker * scale;
  const topHeight = tt + Math.max(topLine, marker) + tb;
  const top = {
    left,
    top: rect.top - GUI.topAbove * scale,
    width: tl + marker + GUI.markerGap * scale + textWidths.top + tr,
    height: topHeight,
    markerLeft: left + tl,
    textLeft: left + tl + marker + GUI.markerGap * scale,
    middle: rect.top - GUI.topAbove * scale + topHeight / 2,
    marker
  };

  const bottomHeight = bt + GUI.bottomFont * scale * 1.33 + bb;
  const bottomEdge = rect.top + rect.height + GUI.bottomBelow * scale;
  const bottom = {
    left: bottomLeft,
    top: bottomEdge - bottomHeight,
    width: bl + textWidths.bottom + br,
    height: bottomHeight,
    textLeft: bottomLeft + bl,
    middle: bottomEdge - bottomHeight / 2
  };
  return { top, bottom };
}

/** The space between two tabs laid side by side, before scaling. */
const TAB_GAP = 4;

/**
 * Where each box's tabs start along its edge, so boxes drawn in one place each show their
 * labels (#352).
 *
 * Every habitat stretch is drawn with the same box -- the habitat crop -- so a moment with
 * Mud, Cobble and Boulder drew three labels at one corner and only the top one could be
 * read. Boxes in the same place (to the pixel) have their tabs laid side by side; a box alone
 * keeps its tabs where they always were.
 *
 * **In the order of their ids, not the order they are drawn in.** Selecting a box draws it on
 * top, and a click on a label selects that box -- so labels placed in drawing order jumped to
 * the end of the row the moment one was clicked.
 *
 * @param {Array<{id: number, rect: Object, widths: {top: number, bottom: number}}>} boxes -
 *   Each box on screen, its observation, and its two tabs' full widths.
 * @param {number} scale - From `labelScale`.
 * @returns {Array<{top: number, bottom: number}>} Each box's shift along its edge, in the
 *   order the boxes were given.
 */
export function sharedTabShifts(boxes, scale) {
  const placed = new Map();
  const shifts = new Array(boxes.length);
  const order = boxes.map((_, index) => index).sort((a, b) => (boxes[a].id ?? a) - (boxes[b].id ?? b) || a - b);
  for (const index of order) {
    const { rect, widths } = boxes[index];
    const key = [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(',');
    const used = placed.get(key) || { top: 0, bottom: 0 };
    placed.set(key, {
      top: used.top + widths.top + TAB_GAP * scale,
      bottom: used.bottom + widths.bottom + TAB_GAP * scale,
    });
    shifts[index] = { top: used.top, bottom: used.bottom };
  }
  return shifts;
}
