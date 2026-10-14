/** Pure geometry for moving the flagged-observation details popup. */

/** Move a panel's original top-left by the pointer's travelled distance. */
export function draggedPosition(origin, pointerStart, pointerNow) {
  return {
    x: origin.x + pointerNow.x - pointerStart.x,
    y: origin.y + pointerNow.y - pointerStart.y
  };
}

/** Keep the complete panel inside its current work area whenever it fits there. */
export function clampPickerPosition(position, size, bounds) {
  const maxX = Math.max(bounds.left, bounds.right - size.width);
  const maxY = Math.max(bounds.top, bounds.bottom - size.height);
  return {
    x: Math.min(Math.max(position.x, bounds.left), maxX),
    y: Math.min(Math.max(position.y, bounds.top), maxY)
  };
}

/** Exact equality is appropriate: these coordinates are CSS pixels from one event. */
export const samePickerPosition = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
