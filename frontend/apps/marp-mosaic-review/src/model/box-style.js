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
 * The order habitat labels sharing a box are laid out in (#352, Isaac 2026-11-20): the habitat
 * timeline's lanes, top to bottom, so a type is always in the same place relative to the others.
 * Anything not named comes after them.
 */
export const LABEL_ORDER = Object.freeze(['cobble', 'boulder', 'sand', 'mud', 'rock', 'stop', 'pull', 'off transect']);

/** Pixels two boxes' edges may differ by and still be one place (#352). */
const SAME_PLACE = 3;

const rankOf = (name) => {
  const rank = LABEL_ORDER.indexOf(String(name || '').trim().toLowerCase());
  return rank < 0 ? LABEL_ORDER.length : rank;
};

/**
 * Where each box's tabs start along its edge, so boxes drawn in one place each show their
 * labels (#352).
 *
 * Every habitat stretch is drawn with the same box -- the habitat crop -- so a moment with
 * Mud, Cobble and Boulder drew three labels at one corner and only the top one could be
 * read. Boxes in one place have their tabs laid side by side; a box alone keeps its tabs where
 * they always were.
 *
 * - **One place is within a few pixels**, not to the pixel. Two habitat boxes half a pixel
 *   apart rounded to different pixels, were taken for two places, and drew their labels on top
 *   of each other (2026-11-20).
 * - **In a fixed order, packed** (Isaac, 2026-11-20): Cobble, Boulder, Sand, Mud, Rock, Stop,
 *   Pull, Off Transect, then anything else by id; only the ones showing, with no gaps. Never
 *   the order they are drawn in: selecting a box draws it on top, and a click on a label
 *   selects that box, so labels in drawing order jumped the moment one was clicked.
 *
 * @param {Array<{id: number, name: string, rect: Object, widths: {top: number, bottom: number}}>} boxes -
 *   Each box on screen, its observation, its name, and its two tabs' full widths.
 * @param {number} scale - From `labelScale`.
 * @param {?{at: Map<string, number>, end: number}} [slots] - From `labelSlots`: a label with a
 *   slot sits in it, and the rest are packed after the slots.
 * @returns {Array<{top: number, bottom: number}>} Each box's shift along its edge, in the
 *   order the boxes were given.
 */
export function sharedTabShifts(boxes, scale, slots = null) {
  const near = (a, b) => ['left', 'top', 'width', 'height'].every((edge) => Math.abs(a[edge] - b[edge]) <= SAME_PLACE);
  const places = [];
  const placeOf = (rect) => {
    let place = places.find((p) => near(p.rect, rect));
    if (!place) {
      place = { rect, top: 0, bottom: 0, taken: new Set() };
      places.push(place);
    }
    return place;
  };
  const shifts = new Array(boxes.length);
  const order = boxes.map((_, index) => index).sort((a, b) => rankOf(boxes[a].name) - rankOf(boxes[b].name)
    || (boxes[a].id ?? a) - (boxes[b].id ?? b) || a - b);

  // A label with a slot goes in it, whoever else is showing. A second label of one name in
  // one place -- two stretches of Rock overlapping -- is packed after the slots instead.
  const packed = [];
  for (const index of order) {
    const key = nameKey(boxes[index].name);
    const place = placeOf(boxes[index].rect);
    if (slots && slots.at.has(key) && !place.taken.has(key)) {
      place.taken.add(key);
      place.top = place.bottom = slots.end;
      shifts[index] = { top: slots.at.get(key), bottom: slots.at.get(key) };
    } else {
      packed.push(index);
    }
  }
  for (const index of packed) {
    const place = placeOf(boxes[index].rect);
    const { widths } = boxes[index];
    shifts[index] = { top: place.top, bottom: place.bottom };
    place.top += widths.top + TAB_GAP * scale;
    place.bottom += widths.bottom + TAB_GAP * scale;
  }
  return shifts;
}

const nameKey = (name) => String(name || '').trim().toLowerCase();

/**
 * A fixed slot along the habitat box for each habitat label on this video (Isaac, 2026-11-23).
 *
 * Packed, the labels moved: Rock alone sat first, and moved to second the moment Mud showed,
 * and back when Mud went. With a slot each, a label never moves; an empty slot is left empty.
 * Only the habitats this video's stretches use get one, in `LABEL_ORDER`, so a video of Mud and
 * Rock alone has two slots rather than eight. A slot is as wide as its name's tab or the widest
 * identifier tab of any stretch, whichever is wider, so the tabs above and below the box share it.
 *
 * @param {Array<{name: string, widths: {top: number, bottom: number}}>} stretches - Every habitat
 *   stretch on the video, its name and its two tabs' full widths.
 * @param {number} scale - From `labelScale`.
 * @returns {{at: Map<string, number>, end: number}} Each name's shift, by its lower case, and
 *   where the slots end.
 */
export function labelSlots(stretches, scale) {
  const tops = new Map();
  let bottom = 0;
  for (const { name, widths } of stretches || []) {
    const key = nameKey(name);
    tops.set(key, Math.max(tops.get(key) || 0, widths.top));
    bottom = Math.max(bottom, widths.bottom);
  }
  const at = new Map();
  let end = 0;
  for (const key of [...tops.keys()].sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b))) {
    at.set(key, end);
    end += Math.max(tops.get(key), bottom) + TAB_GAP * scale;
  }
  return { at, end };
}
