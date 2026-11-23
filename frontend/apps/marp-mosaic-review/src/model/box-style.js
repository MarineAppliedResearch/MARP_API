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
    // In a column, as wide as the column, so the labels read as even columns (2026-11-23).
    width: Math.max(tl + marker + GUI.markerGap * scale + textWidths.top + tr, shift.width || 0),
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
    width: Math.max(bl + textWidths.bottom + br, shift.width || 0),
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
 * @param {?{columnOf: Map<number, number>, width: number, step: number}} [slots] - From
 *   `labelColumns`: a stretch with a column sits in it, and the rest are packed after.
 * @returns {Array<{top: number, bottom: number, width?: number}>} Each box's shift along its
 *   edge, and for one in a column how wide its tabs are drawn, in the order the boxes were given.
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

  // A stretch with a column sits in it, whoever else is showing; anything else in that place
  // is packed after the columns in use.
  const packed = [];
  for (const index of order) {
    const column = slots ? slots.columnOf.get(boxes[index].id) : undefined;
    const place = placeOf(boxes[index].rect);
    if (column !== undefined && !place.taken.has(column)) {
      place.taken.add(column);
      const at = column * slots.step;
      place.top = place.bottom = Math.max(place.top, at + slots.step);
      shifts[index] = { top: at, bottom: at, width: slots.width };
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

/**
 * A column along the habitat box for each habitat stretch, kept for its whole life (Isaac,
 * 2026-11-23).
 *
 * Packed, labels moved: Rock alone sat first, and moved to second the moment Mud showed, and
 * back when Mud went. A slot per habitat kept them still but started Rock five columns in on a
 * video with six habitats. So each stretch, in the order they start, takes the leftmost column
 * no stretch overlapping it holds: Rock alone is at the box's left edge, Mud starting under it
 * goes beside it, and Rock never moves while it lasts. Worked out from the stretches' times
 * alone, so a seek lands on the same layout as playing up to it.
 *
 * Columns are even: as wide as the widest tab of any stretch, above or below, and each tab is
 * drawn that wide, so the labels read as a row of columns with each identifier under its name.
 *
 * @param {Array<{id: number, start: number, end: number, widths: {top: number, bottom: number}}>} stretches -
 *   Every habitat stretch on the video: its observation, its start and end in seconds (an
 *   unfinished one ends at Infinity), and its two tabs' full widths.
 * @param {number} scale - From `labelScale`.
 * @returns {{columnOf: Map<number, number>, width: number, step: number}} Each stretch's column,
 *   how wide a column is, and how far apart two are.
 */
export function labelColumns(stretches, scale) {
  let width = 0;
  for (const { widths } of stretches || []) width = Math.max(width, widths.top, widths.bottom);
  const placed = [];
  const columnOf = new Map();
  const order = [...(stretches || [])].sort((a, b) => a.start - b.start || a.id - b.id);
  for (const stretch of order) {
    // Touching is not overlapping: Mud starting the moment Rock ends takes Rock's column.
    const busy = new Set(placed.filter((p) => p.start < stretch.end && stretch.start < p.end).map((p) => p.column));
    let column = 0;
    while (busy.has(column)) column += 1;
    columnOf.set(stretch.id, column);
    placed.push({ start: stretch.start, end: stretch.end, column });
  }
  return { columnOf, width, step: width + TAB_GAP * scale };
}
