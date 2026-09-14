/** Pure geometry for full-frame inspection. */

export const clampZoom = (value) => Math.min(8, Math.max(1, Number(value) || 1));

/** Fits an image wholly inside a viewport without changing its aspect ratio. */
export function fittedWidth(viewportWidth, viewportHeight, imageWidth, imageHeight) {
  const availableWidth = Math.max(1, Number(viewportWidth) || 1);
  const availableHeight = Math.max(1, Number(viewportHeight) || 1);
  const width = Math.max(1, Number(imageWidth) || 1);
  const height = Math.max(1, Number(imageHeight) || 1);
  return Math.min(availableWidth, availableHeight * (width / height));
}

/** Keyframe boxes are centre-origin; CSS rectangles are top-left-origin. */
export function overlayRect(box) {
  if (!box) return null;
  const width = Math.max(0, Math.min(1, Number(box.width) || 0));
  const height = Math.max(0, Math.min(1, Number(box.height) || 0));
  const left = Math.max(0, Math.min(1 - width, (Number(box.x) || 0) - width / 2));
  const top = Math.max(0, Math.min(1 - height, (Number(box.y) || 0) - height / 2));
  return { left, top, width, height };
}
