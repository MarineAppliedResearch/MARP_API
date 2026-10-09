/** Pure geometry for full-frame inspection. */

export const clampZoom = (value) => Math.min(8, Math.max(1, Number(value) || 1));

export function fullFrameActionState(row) {
  const ready = row.full_frame_status === 'ready';
  const busy = row.full_frame_status === 'queued';
  const failed = row.full_frame_status === 'failed';
  const permanent = failed && Boolean(row.full_frame_permanent);
  return {
    action: ready ? 'open-full-frame' : 'request-full-frame',
    label: ready ? 'View full frame' : busy ? 'Preparing full frame…'
      : permanent ? 'Full frame unavailable' : failed ? 'Try full frame again'
        : 'Request full frame',
    disabled: busy || permanent || row.thumbnail_status !== 'ready'
  };
}

/** Fits an image wholly inside a viewport without changing its aspect ratio. */
export function fittedWidth(viewportWidth, viewportHeight, imageWidth, imageHeight) {
  const availableWidth = Math.max(1, Number(viewportWidth) || 1);
  const availableHeight = Math.max(1, Number(viewportHeight) || 1);
  const width = Math.max(1, Number(imageWidth) || 1);
  const height = Math.max(1, Number(imageHeight) || 1);
  return Math.min(availableWidth, availableHeight * (width / height));
}

export function pinchZoom(startZoom, startDistance, currentDistance) {
  const baseline = Number(startDistance);
  if (!(baseline > 0)) return clampZoom(startZoom);
  return clampZoom(Number(startZoom) * (Number(currentDistance) / baseline));
}

export function anchoredScroll(scroll, imageRect, focalPoint, pointer) {
  return {
    left: Math.max(0, Number(scroll.left)
      + Number(imageRect.left) + Number(focalPoint.x) * Number(imageRect.width)
      - Number(pointer.x)),
    top: Math.max(0, Number(scroll.top)
      + Number(imageRect.top) + Number(focalPoint.y) * Number(imageRect.height)
      - Number(pointer.y))
  };
}

export function zoomForBox(box, viewportWidth, viewportHeight, imageWidth, imageHeight) {
  const rectangle = overlayRect(box);
  if (!rectangle || rectangle.width === 0 || rectangle.height === 0) return 1;
  const width = fittedWidth(viewportWidth, viewportHeight, imageWidth, imageHeight);
  const height = width * (Number(imageHeight) / Number(imageWidth));
  const horizontal = Number(viewportWidth) / (width * rectangle.width);
  const vertical = Number(viewportHeight) / (height * rectangle.height);
  return clampZoom(Math.min(horizontal, vertical) * 0.8);
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
