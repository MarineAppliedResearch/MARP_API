/**
 * A built dataset's pictures in the Mosaic (#271): the tile that flips through a track's
 * pictures, and the panel that lays them side by side to flag one.
 *
 * Isaac, 2026-11-24: one tile is one track, flipping through the pictures the dataset took
 * from it with the box drawn on each -- **only what is in the dataset**, its own box, not the
 * other animals annotated there. Opening a tile shows the pictures side by side, and a single
 * picture is flagged there.
 *
 * Reads state, writes DOM. The flipping is a timer moving a class between pictures already
 * drawn; it is display, never state.
 */

import { state, MODES } from '../store.js';
import { MarpBackend } from '../backend.js';
import { flaggedFrames } from '../model/dataset-review.js';
import { currentSpeciesName } from '../model/row.js';

const $ = (selector) => document.querySelector(selector);

/** How long each picture of a flipping tile is shown. */
const FLIP_MS = 600;

const escapeText = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/** Where each picture stands: flagged, as the reviewer has it now, else what the record says. */
function standing(row) {
  const flagged = flaggedFrames(row, state.marks.get(row.observation_id) || null);
  return (picture) => (flagged.has(picture.framenum)
    ? { state: 'flagged', reason: flagged.get(picture.framenum) }
    : { state: picture.decision === 'promoted' ? 'promoted' : 'unchecked', reason: null });
}

/* One box, placed in fractions of whatever it is drawn over. `within` is the crop's place in
   the picture, so a box drawn over a crop lands where it is in the crop. */
function boxMarkup(drawn, cls, within = { left: 0, top: 0, width: 1, height: 1 }) {
  const box = drawn && drawn.box;
  if (!box) return '';
  const left = ((box.cx - box.w / 2) - within.left) / within.width * 100;
  const top = ((box.cy - box.h / 2) - within.top) / within.height * 100;
  const width = box.w / within.width * 100;
  const height = box.h / within.height * 100;
  return `<i class="${cls}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></i>`;
}

/** A habitat picture's substrates, which is what the dataset says about it. */
function labelsMarkup(drawn) {
  const labels = (drawn && drawn.labels) || [];
  return labels.length ? `<span class="dlabels">${labels.map(escapeText).join(' · ')}</span>` : '';
}

/** A tile's picture: zoomed in on this track's box, so it can be judged at tile size (R9). */
function cropFrame(row, picture, extra) {
  if (!picture.has_crop) return wholeFrame(row, picture, extra);
  return `<span class="dframe crop${extra}"><img draggable="false" loading="lazy" alt=""
    src="${MarpBackend.pictureUrl(row, picture.framenum, 'crop')}">${boxMarkup(picture.drawn, 'dbox', picture.crop_rect)}${labelsMarkup(picture.drawn)}</span>`;
}

/**
 * The whole picture, large, with **every** box the dataset drew on it (R10): this track's
 * picked out, the rest beside it. An animal of the dataset's species with no box teaches the
 * model it is background, so a missing one has to be visible to be flagged.
 */
function wholeFrame(row, picture, extra = '') {
  const image = picture.has_picture
    ? `<img draggable="false" loading="lazy" alt="" src="${MarpBackend.pictureUrl(row, picture.framenum)}">`
    : '<span class="dmissing">no picture</span>';
  const others = (picture.others || []).map((other) => boxMarkup(other.drawn, 'dbox other')).join('');
  return `<span class="dframe${extra}">${image}${others}${boxMarkup(picture.drawn, 'dbox')}${labelsMarkup(picture.drawn)}</span>`;
}

/**
 * The body of a dataset tile: every picture, stacked, one shown at a time, and a strip
 * saying where each stands.
 *
 * @param {Object} row - A row carrying `pictures`.
 * @returns {string} Markup.
 */
export function flipbook(row) {
  const stand = standing(row);
  const pictures = row.pictures;
  const frames = pictures.map((p, i) => cropFrame(row, p, i === 0 ? ' on' : '')).join('');
  const dots = pictures.map((p) => `<i class="d-${stand(p).state}"></i>`).join('');
  return `<span class="flip" data-flip="${row.observation_id}">${frames}</span><span class="dots">${dots}</span>`;
}

/** Start the tiles flipping. Once: it moves whichever pictures are on screen. */
export function startFlipbooks() {
  setInterval(() => {
    document.querySelectorAll('.flip').forEach((flip) => {
      // A tile the pointer is over holds still, so a picture can be looked at.
      if (flip.matches(':hover')) return;
      const frames = flip.querySelectorAll('.dframe');
      if (frames.length < 2) return;
      const at = [...frames].findIndex((f) => f.classList.contains('on'));
      frames[Math.max(at, 0)].classList.remove('on');
      frames[(at + 1) % frames.length].classList.add('on');
    });
  }, FLIP_MS);
}

/** The panel: one track's pictures side by side, each flagged or not with a click. */
export function renderPictures() {
  const host = $('#picturesPanel');
  if (!host) return;
  const open = state.pictures;
  const row = open && state.rows.find((r) => r.observation_id === open.id);
  host.hidden = !row;
  if (!row) {
    host.innerHTML = '';
    return;
  }

  const stand = standing(row);
  const reasons = MODES.datasetReview.reasons.map((reason) => `<button type="button" data-picture-reason="${escapeText(reason)}"
    class="${reason === open.reason ? 'on' : ''}">${escapeText(reason)}</button>`).join('');
  const figures = row.pictures.map((picture) => {
    const now = stand(picture);
    const word = now.state === 'flagged' ? `Flagged · ${escapeText(now.reason)}`
      : now.state === 'promoted' ? 'Promoted' : 'Not checked';
    return `<figure class="pic p-${now.state}" data-frame="${picture.framenum}">
      ${wholeFrame(row, picture, ' on')}
      <figcaption><span>Frame ${picture.framenum} · ${escapeText(picture.split)}</span><b>${word}</b>
        <button type="button" data-fix="${picture.framenum}" title="Open the video at this frame">Fix</button></figcaption>
    </figure>`;
  }).join('');

  host.innerHTML = `<header>
      <div><b>${escapeText(currentSpeciesName(row))} · ${row.obsID != null ? escapeText(row.obsID) : row.observation_id}</b>
        <span class="muted">${row.pictures.length} pictures in this dataset. This track's box is solid, every other box the dataset has on the picture is dashed: any animal of the dataset's species without a box is a reason to flag it. Click a picture to flag it, again to take the flag off.</span></div>
      <button type="button" data-act="close-pictures" aria-label="Close">Close</button>
    </header>
    <div class="reasons"><span class="muted">Flag with:</span>${reasons}</div>
    <div class="pics">${figures}</div>`;
}
