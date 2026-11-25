/**
 * Reviewing a built dataset's pictures (#271).
 *
 * Settled with Isaac on 2026-11-24: a picture -- one frame of one track -- is promoted or
 * flagged, and a flag carries a reason from the reviewer-facing list saying what is wrong.
 * There is no third state: fixing the box does not clear a flag, a reviewer promotes it
 * again. `withdrawn` is the Mosaic's take-back, back to undecided.
 *
 * @fileoverview Checking and recording decisions about a dataset's pictures.
 * @module service/dataset-review
 */

'use strict';

const path = require('path');

const pictureRepository = require('../repository/dataset-picture.repository');
const gpuService = require('./gpu.service');
const { members, read } = require('./dataset-preview.service');
const { MODES } = require('../repository/mosaic-commit.repository');
const { DATASET_DIRECTORY } = require('../config/gpu-orchestration');

/** What a picture can be. */
const DECISIONS = ['promoted', 'flagged', 'withdrawn'];

/**
 * Why a picture can be flagged: the two this review is for first, added by Isaac on
 * 2026-11-24, then the Training Data Review list. The Mosaic's list is the same, in
 * `MODES.datasetReview.reasons`.
 */
const REASONS = ['Box off the animal', 'An animal has no box', ...MODES.training.reasons];

/** A request the caller can fix: a 400, not a failure. */
class PictureReviewError extends Error {}

/**
 * The decisions in a request, checked.
 *
 * @param {*} body - `{decisions: [{observation_id, framenum, decision, reason, note}]}`.
 * @returns {Array<Object>} The decisions, normalised.
 * @throws {PictureReviewError} Naming what is wrong.
 */
function checkDecisions(body) {
    const decisions = body && body.decisions;

    if (!Array.isArray(decisions) || !decisions.length) {
        throw new PictureReviewError('decisions must be a non-empty array');
    }

    return decisions.map((d, i) => {
        const at = `decisions[${i}]`;

        if (!d || !Number.isInteger(d.observation_id) || !Number.isInteger(d.framenum)) {
            throw new PictureReviewError(`${at} needs an integer observation_id and framenum`);
        }

        if (!DECISIONS.includes(d.decision)) {
            throw new PictureReviewError(`${at}.decision must be one of ${DECISIONS.join(', ')}`);
        }

        // A flag says what is wrong; nothing else carries a reason.
        if (d.decision === 'flagged' && !REASONS.includes(d.reason)) {
            throw new PictureReviewError(`${at}: a flag needs a reason, one of ${REASONS.join(', ')}`);
        }

        return {
            observation_id: d.observation_id,
            framenum: d.framenum,
            decision: d.decision,
            reason: d.decision === 'flagged' ? d.reason : null,
            note: typeof d.note === 'string' && d.note.trim() ? d.note.trim().slice(0, 2000) : null,
        };
    });
}

/**
 * Record a reviewer's decisions about a dataset's pictures.
 *
 * @async
 * @param {number} datasetId - The dataset being reviewed.
 * @param {*} body - The request body.
 * @param {number} reviewerId - Who decided.
 * @returns {Promise<{recorded: number}>}
 * @throws {PictureReviewError} When the request cannot be served.
 */
async function review(datasetId, body, reviewerId) {
    const decisions = checkDecisions(body);

    return { recorded: await pictureRepository.recordDecisions(decisions, reviewerId, datasetId) };
}

/**
 * The file holding a track's crop of one of a dataset's pictures, or null when there is none.
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @param {number} observationId - The observation.
 * @param {number} framenum - The frame.
 * @returns {Promise<?string>} An absolute path inside the dataset directory.
 */
async function pictureFile(datasetId, observationId, framenum) {
    const relative = await pictureRepository.pictureFile(datasetId, observationId, framenum, 'crop');

    if (!relative) return null;

    const absolute = path.resolve(DATASET_DIRECTORY, relative);

    // The row names it, but a path read from anywhere stays inside the directory.
    return absolute.startsWith(path.resolve(DATASET_DIRECTORY) + path.sep) ? absolute : null;
}

/**
 * Each archive's pictures by name, walked once: a walk is one read per member, about 140 ms
 * over a 2.4 GB archive, and a dataset never changes, so its index never does. Keyed by the
 * archive's hash. A few archives are held; the oldest is let go.
 */
const indexes = new Map();
const KEEP_INDEXES = 8;

function indexOf(archive) {
    if (!indexes.has(archive.sha256)) {
        indexes.set(archive.sha256, new Map(members(archive.absolutePath).map((m) => [m.name, m])));
        if (indexes.size > KEEP_INDEXES) indexes.delete(indexes.keys().next().value);
    }

    return indexes.get(archive.sha256);
}

/**
 * One of a dataset's pictures, whole, read straight out of its archive (#271). The archive
 * is the only full-size copy: keeping a second one of every picture would double what every
 * dataset costs on disk (Isaac, 2026-11-24).
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @param {number} observationId - An observation in the picture.
 * @param {number} framenum - The frame.
 * @returns {Promise<?{buffer: Buffer, contentType: string, sha256: string}>} Null when there is none.
 */
async function wholePicture(datasetId, observationId, framenum) {
    const name = await pictureRepository.pictureFile(datasetId, observationId, framenum, 'picture');

    if (!name) return null;

    const archive = await gpuService.datasetArchive(datasetId);
    const member = indexOf(archive).get(name);

    if (!member) return null;

    return {
        buffer: read(archive.absolutePath, member),
        contentType: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg',
        sha256: archive.sha256,
    };
}

module.exports = {
    DECISIONS,
    wholePicture,
    PictureReviewError,
    REASONS,
    checkDecisions,
    pictureFile,
    review,
};
