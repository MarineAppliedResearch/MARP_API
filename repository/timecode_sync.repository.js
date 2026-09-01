/**
 * Repository for correcting a session's timing after the fact.
 *
 * ## Two operations, one gesture
 *
 * The operator does the same thing either way: sit on a frame, read the clock burnt
 * into the picture, type it. What that *means* depends on what the session already
 * holds, and the difference is not something anyone should have to reason about:
 *
 * **The session was never synced.** Every observation records the same value for
 * media position and real-world time, so there is no recorded clock at all. Typing
 * the burnt-in time *establishes* the sync: the recorded times shift so that this
 * frame reads what the picture says. Pointers are untouched. The shift is whatever
 * it takes -- often hours -- and that is legitimate.
 *
 * **The session was synced, and its frame pointer is out.** The recorded times are
 * right; `mediaPosition` and `keyframes.framenum` point a few frames earlier than
 * the frame that was actually observed, so a bounding box misses its animal. Typing
 * the burnt-in time moves the pointers. Times are untouched, and the shift is a
 * handful of frames.
 *
 * Which one applies is decided from the data, not asked of the caller.
 *
 * ## Why the pointer is out at all
 *
 * Until marp-video-player 0.3.1 (taken by the GUI in 0.3.2), the media time the host
 * recorded could sit a few frames behind the picture: after a pause the picture
 * advanced past the last per-frame message. So `mediaPosition` and `framenum` were
 * captured a few frames early.
 *
 * The times still came out right, because the error cancels: sync is anchored as
 * `(syncMedia = P_s - k, syncActual = clock at P_s)`, so an observation at picture
 * `P_o` stores `actualPosition = clock(P_s) + ((P_o - k) - (P_s - k)) = clock(P_o)`.
 * Confirmed by stepping forward 3 frames from a stored media position: the box landed
 * exactly on the animal, and the clock there matched the row's `tc`.
 *
 * ## What a correction refuses to do
 *
 * A pointer correction beyond one second is refused. The largest real value measured
 * against the burnt-in clock is 4 frames, so a second is already several times any
 * plausible answer -- and a large number means the two times being compared do not
 * describe the same thing. Establishing a sync has no such limit, because any offset
 * is possible.
 *
 * A synced session whose recorded time is more than a second from the picture is
 * neither case: refused with an explanation, because it needs a decision rather than
 * arithmetic.
 *
 * Nothing records that a correction happened. Undoing one is applying the opposite
 * shift, so {@link TimecodeSyncRepository#apply} returns and logs what that is.
 *
 * Refs MarineAppliedResearch/VIDEO_PROCESSING_GUI#213.
 *
 * @fileoverview Establishing and correcting a session's timing.
 * @author Isaac Travers
 * @module repository/timecode_sync
 */

const db = require('../model');
const logger = require('../logger/api.logger');
const { guardDataIntegrity } = require('../db/data-integrity');
const {
    ASSUMED_FPS,
    parseTimeSpan,
    formatTimeSpan,
    deriveTc,
    deriveFrame,
    absoluteFrame,
    shiftTruncated,
    classifyRow,
} = require('../db/timecode');

/**
 * Milliseconds in one frame at the assumed rate.
 *
 * @constant
 * @type {number}
 */
const MS_PER_FRAME = 1000 / ASSUMED_FPS;

/**
 * The most frames a pointer correction may move things.
 *
 * One second. The lag being corrected is a frame-reporting artefact worth a handful
 * of frames -- 3 and 4 in the two sessions measured against the burnt-in clock -- so
 * this is several times any plausible answer. It does not apply to establishing a
 * sync, where any offset is legitimate.
 *
 * @constant
 * @type {number}
 */
const MAX_POINTER_FRAMES = ASSUMED_FPS;

/**
 * How far apart media position and real-world time may be before a session counts
 * as synced, in milliseconds.
 *
 * A frame, so a session recorded with no sync at all -- where the two are written
 * from the same value -- is still recognised if one row rounds differently.
 *
 * @constant
 * @type {number}
 */
const UNSYNCED_TOLERANCE_MS = MS_PER_FRAME;

/** The session has no recorded clock; a reading establishes one. @constant @type {string} */
const MODE_ESTABLISH = 'establish-sync';

/** The session has a clock; a reading corrects the frame pointer. @constant @type {string} */
const MODE_POINTER = 'correct-pointer';

/**
 * Repository for session timing corrections.
 *
 * @class TimecodeSyncRepository
 */
class TimecodeSyncRepository {

    db = {};

    constructor() {
        this.db = db;
    }

    /**
     * Reads the observations a correction would touch, with their keyframes.
     *
     * @async
     * @param {number} sessionId - Session to read.
     * @param {string|null} videoSource - Restrict to one clip, or null for all.
     * @param {number} fromMediaMs - Only observations at or after this media position.
     * @param {Object} [transaction] - Transaction to read inside.
     * @returns {Promise<Array<Object>>} Matching observations, each with `keyframes`.
     */
    async readScope(sessionId, videoSource, fromMediaMs, transaction) {
        const rows = await this.db.observations.findAll({
            where: Object.assign(
                { session_id: sessionId },
                videoSource ? { video_source: videoSource } : {},
            ),
            include: [{ model: this.db.keyframes, as: 'keyframes' }],
            order: [['mediaPosition', 'ASC']],
            transaction,
        });

        return rows.filter((row) => {
            const media = parseTimeSpan(row.mediaPosition);

            return media !== null && media >= fromMediaMs;
        });
    }

    /**
     * Whether a session carries no sync at all: every observation records the same
     * value for media position and real-world time.
     *
     * @param {Array<Object>} rows - Observations in scope.
     * @returns {boolean} True when no observation carries an offset.
     */
    looksUnsynced(rows) {
        let compared = 0;

        for (const row of rows) {
            const mediaMs = parseTimeSpan(row.mediaPosition);
            const actualMs = parseTimeSpan(row.actualPosition);

            if (mediaMs === null || actualMs === null) continue;

            compared += 1;

            if (Math.abs(actualMs - mediaMs) > UNSYNCED_TOLERANCE_MS) {
                return false;
            }
        }

        // Nothing readable is not the same as unsynced, and guessing either way
        // would be worse than refusing.
        return compared > 0;
    }

    /**
     * What the session's own data says the real-world time is at a media position.
     *
     * Taken from the nearest observation and carried across by the offset it holds,
     * which is what the GUI's clock does. Works anywhere in the clip rather than
     * only on an observation.
     *
     * @param {Array<Object>} rows - Observations in scope.
     * @param {number} atMs - Media position in milliseconds.
     * @returns {number|null} Milliseconds, or null when nothing is readable.
     */
    dataTimeAt(rows, atMs) {
        let nearest = null;
        let nearestGap = Infinity;

        for (const row of rows) {
            const mediaMs = parseTimeSpan(row.mediaPosition);
            const actualMs = parseTimeSpan(row.actualPosition);

            if (mediaMs === null || actualMs === null) continue;

            const gap = Math.abs(mediaMs - atMs);

            if (gap < nearestGap) {
                nearest = { mediaMs, actualMs };
                nearestGap = gap;
            }
        }

        if (nearest === null) {
            return null;
        }

        return nearest.actualMs + (atMs - nearest.mediaMs);
    }

    /**
     * Plans a pointer correction: media positions and keyframe frames move.
     *
     * Every observation in scope and every keyframe on it moves by the same whole
     * number of frames, so whatever the relationship between an observation's frame
     * and its keyframes' frames was, it survives.
     *
     * @param {Array<Object>} rows - Observations in scope.
     * @param {number} shiftMs - Milliseconds to add to mediaPosition.
     * @returns {{plan: Array<Object>, counts: Object}} What would change, plus tallies.
     */
    planPointerShift(rows, shiftMs) {
        const frameShift = Math.round(shiftMs / MS_PER_FRAME);

        const plan = [];
        const counts = { unreadable: 0, observations: 0, keyframes: 0 };

        for (const row of rows) {
            const mediaMs = parseTimeSpan(row.mediaPosition);

            if (mediaMs === null) {
                counts.unreadable += 1;
                continue;
            }

            const keyframes = row.keyframes || [];

            plan.push({
                row,
                obsID: row.obsID,
                comname: row.comname,
                tc: row.tc,
                mediaBefore: row.mediaPosition,
                mediaAfter: formatTimeSpan(mediaMs + shiftMs),
                frameBefore: absoluteFrame(mediaMs),
                frameAfter: absoluteFrame(mediaMs + shiftMs),
                keyframes: keyframes.map((keyframe) => ({
                    keyframe,
                    before: Number(keyframe.framenum),
                    after: Number(keyframe.framenum) + frameShift,
                })),
            });

            counts.observations += 1;
            counts.keyframes += keyframes.length;
        }

        return { plan, counts };
    }

    /**
     * Plans a sync being established: recorded times move, pointers do not.
     *
     * `tc` and `frame` are re-derived from the shifted `actualPosition`, but only
     * where the stored value already equals what that derivation produces. Where it
     * does not, something else wrote it -- the DaVinci Resolve era left `frame`
     * values like `'06'`, zero-padded, that no formula here produces -- and those are
     * left exactly as found.
     *
     * @param {Array<Object>} rows - Observations in scope.
     * @param {number} shiftMs - Milliseconds to add to actualPosition.
     * @returns {{plan: Array<Object>, counts: Object}} What would change, plus tallies.
     */
    planTimeShift(rows, shiftMs) {
        const plan = [];
        const counts = {
            unreadable: 0,
            observations: 0,
            tcRewritten: 0,
            tcLeftAlone: 0,
            frameRewritten: 0,
            frameLeftAlone: 0,
            etcShifted: 0,
        };

        for (const row of rows) {
            const verdict = classifyRow(row);

            if (verdict.actualMs === null) {
                counts.unreadable += 1;
                continue;
            }

            const shifted = verdict.actualMs + shiftMs;

            plan.push({
                row,
                obsID: row.obsID,
                comname: row.comname,
                mediaPosition: row.mediaPosition,
                actualBefore: row.actualPosition,
                actualAfter: formatTimeSpan(shifted),
                tcBefore: row.tc,
                tcAfter: verdict.tcDerivable ? deriveTc(shifted) : row.tc,
                tcRewritten: verdict.tcDerivable,
                frameBefore: row.frame,
                frameAfter: verdict.frameDerivable ? deriveFrame(shifted) : row.frame,
                frameRewritten: verdict.frameDerivable,
                etcBefore: row.etc,
                etcAfter: shiftTruncated(row.etc, shiftMs),
            });

            counts.observations += 1;
            if (verdict.tcDerivable) counts.tcRewritten += 1; else counts.tcLeftAlone += 1;
            if (verdict.frameDerivable) counts.frameRewritten += 1; else counts.frameLeftAlone += 1;
            if (row.etc !== null && row.etc !== '') counts.etcShifted += 1;
        }

        return { plan, counts };
    }

    /**
     * A few entries spread across a plan, so the effect can be seen rather than
     * inferred, without sending hundreds.
     *
     * @param {Array<Object>} plan - The planned changes.
     * @param {Function} shape - Maps one change to what a caller should see.
     * @returns {Array<Object>} The sample.
     */
    sampleOf(plan, shape) {
        const indices = plan.length <= 6
            ? plan.map((unused, index) => index)
            : [...new Set([0, 1, Math.floor(plan.length / 2), plan.length - 2, plan.length - 1])];

        return indices.map((index) => shape(plan[index]));
    }

    /**
     * Previews what a reading would do. Writes nothing.
     *
     * @async
     * @param {Object} request
     * @param {number} request.sessionId - Session to act on.
     * @param {string} [request.videoSource] - Restrict to one clip.
     * @param {string} [request.fromMediaPosition] - Act from this media position onward.
     * @param {string} [request.atMediaPosition] - The frame a clock reading was taken at.
     * @param {string} [request.pictureClockTime] - What the clock burnt into that frame read.
     * @param {number} [request.frames] - A pointer shift measured visually instead: how
     * many frames the annotation boxes are away from their animals. Skips the clock
     * comparison entirely, because once a session has a sync the clocks agree at every
     * frame and cannot reveal a pointer error.
     * @returns {Promise<Object>} The mode, the shift, tallies and a sample.
     * @throws {Error} When the scope is empty, the values are unreadable, or the
     * reading cannot be interpreted as either operation.
     */
    async preview(request) {
        const {
            sessionId, videoSource = null, fromMediaPosition = null,
            atMediaPosition, pictureClockTime, frames: framesGiven,
        } = request;

        const fromMediaMs = fromMediaPosition ? (parseTimeSpan(fromMediaPosition) || 0) : 0;
        const rows = await this.readScope(sessionId, videoSource, fromMediaMs);

        if (rows.length === 0) {
            throw new Error(`Session ${sessionId} has no observations matching that scope.`);
        }

        // A frame count given directly is always a pointer shift, measured by looking
        // at where the boxes sit rather than by comparing clocks. It has to be its own
        // path: a session with a sync has clocks that agree at every frame, so no
        // reading can reveal that its pointers are out.
        if (Number.isFinite(framesGiven)) {
            return this.previewPointerShift(rows, {
                sessionId,
                videoSource,
                fromMediaPosition,
                frames: Math.round(framesGiven),
                reading: null,
            });
        }

        const atMs = parseTimeSpan(atMediaPosition);
        const clockMs = parseTimeSpan(pictureClockTime);

        if (atMs === null) {
            throw new Error(`Cannot read "${atMediaPosition}" as a media position.`);
        }

        if (clockMs === null) {
            throw new Error(`Cannot read "${pictureClockTime}" as a time.`);
        }

        const dataMs = this.dataTimeAt(rows, atMs);

        if (dataMs === null) {
            throw new Error(
                `Session ${sessionId} has no observation with both a readable media position `
                + 'and a readable time, so there is nothing to compare a reading against.',
            );
        }

        // Positive means the data thinks it is later than the picture does.
        const differenceMs = dataMs - clockMs;

        const mode = this.looksUnsynced(rows) ? MODE_ESTABLISH : MODE_POINTER;

        const common = {
            sessionId,
            videoSource,
            fromMediaPosition,
            mode,
            reading: {
                mediaPosition: atMediaPosition,
                dataSays: formatTimeSpan(dataMs),
                pictureSays: pictureClockTime,
                differenceMs,
            },
            observationsInScope: rows.length,
        };

        if (mode === MODE_ESTABLISH) {
            // No clock recorded, so the reading becomes one. The times move by
            // whatever it takes -- hours, usually -- and the pointers stay put.
            const shiftMs = -differenceMs;
            const { plan, counts } = this.planTimeShift(rows, shiftMs);

            return Object.assign(common, {
                shiftMs,
                frames: Number((shiftMs / MS_PER_FRAME).toFixed(2)),
                observationsToCorrect: counts.observations,
                keyframesToCorrect: 0,
                counts,
                pointersUnchanged: true,
                timesUnchanged: false,
                partial: counts.unreadable > 0,
                undoWith: { shiftMs: -shiftMs },
                sample: this.sampleOf(plan, (change) => ({
                    obsID: change.obsID,
                    comname: change.comname,
                    mediaPosition: change.mediaPosition,
                    actualBefore: change.actualBefore,
                    actualAfter: change.actualAfter,
                    tcBefore: change.tcBefore,
                    tcAfter: change.tcAfter,
                    tcRewritten: change.tcRewritten,
                })),
            });
        }

        // A synced session. The times are right, so a reading measures how far the
        // frame pointer is out -- which is a handful of frames, or it is not a
        // pointer problem at all.
        const frames = Math.round(differenceMs / MS_PER_FRAME);

        if (Math.abs(frames) > MAX_POINTER_FRAMES) {
            // Refused here rather than in previewPointerShift, because a clock
            // comparison this far out means something quite different from a bad
            // frame count, and the message has to say so.

            throw new Error(
                `This session records ${formatTimeSpan(dataMs)} for that frame while the picture `
                + `reads ${pictureClockTime} -- `
                + `${(Math.abs(differenceMs) / 1000).toFixed(1)} s apart, or ${frames} frames. `
                + 'A frame-pointer correction is a handful of frames, so this is not one. Either '
                + 'the reading is from a different frame than the one on screen, or this session '
                + 'is synced to the wrong time altogether, which needs a decision rather than '
                + 'arithmetic: re-establishing its sync would rewrite every recorded time in it.',
            );
        }

        return this.previewPointerShift(rows, {
            sessionId,
            videoSource,
            fromMediaPosition,
            frames,
            reading: common.reading,
        });
    }

    /**
     * The pointer half of a preview, shared by both ways of arriving at a frame count:
     * a clock reading on a synced session, or a count measured by looking at the boxes.
     *
     * @param {Array<Object>} rows - Observations in scope.
     * @param {Object} context
     * @param {number} context.sessionId - Session being previewed.
     * @param {string|null} context.videoSource - Clip scope.
     * @param {string|null} context.fromMediaPosition - Media scope.
     * @param {number} context.frames - Whole frames to move the pointers by.
     * @param {Object|null} context.reading - The clock comparison, when there was one.
     * @returns {Object} The preview.
     * @throws {Error} When the count is beyond what a pointer error can be.
     */
    previewPointerShift(rows, context) {
        const { sessionId, videoSource, fromMediaPosition, frames, reading } = context;

        if (Math.abs(frames) > MAX_POINTER_FRAMES) {
            throw new Error(
                `${frames} frames is beyond what a frame pointer can be out by. The largest `
                + `measured is 4, and anything over ${MAX_POINTER_FRAMES} means the number does `
                + 'not describe a pointer error.',
            );
        }

        const shiftMs = Math.round(frames * MS_PER_FRAME);
        const { plan, counts } = this.planPointerShift(rows, shiftMs);

        return {
            sessionId,
            videoSource,
            fromMediaPosition,
            mode: MODE_POINTER,
            reading,
            observationsInScope: rows.length,
            shiftMs,
            frames,
            observationsToCorrect: counts.observations,
            keyframesToCorrect: counts.keyframes,
            counts,
            pointersUnchanged: false,
            timesUnchanged: true,
            partial: counts.unreadable > 0,
            undoWith: { frames: -frames },
            sample: this.sampleOf(plan, (change) => ({
                obsID: change.obsID,
                comname: change.comname,
                tc: change.tc,
                mediaBefore: change.mediaBefore,
                mediaAfter: change.mediaAfter,
                frameBefore: change.frameBefore,
                frameAfter: change.frameAfter,
                keyframesBefore: change.keyframes.map((k) => k.before).join(', '),
                keyframesAfter: change.keyframes.map((k) => k.after).join(', '),
            })),
        };
    }

    /**
     * Applies what {@link TimecodeSyncRepository#preview} described.
     *
     * @async
     * @param {Object} request - As preview, plus:
     * @param {boolean} [request.allowPartial] - Proceed when some rows must be skipped.
     * @param {string} [request.note] - Why. Logged, since nothing else records it.
     * @returns {Promise<Object>} The preview that was applied, with `applied: true`.
     * @throws {Error} When refused, or the write fails.
     */
    async apply(request) {
        const preview = await this.preview(request);

        if (preview.shiftMs === 0) {
            throw new Error(
                'The time this session records for that frame already matches the clock in the '
                + 'picture, so there is nothing to do.',
            );
        }

        if (preview.partial && !request.allowPartial) {
            throw new Error(
                `${preview.counts.unreadable} observation(s) in this session cannot be read, so `
                + 'they would be left alone. Set allowPartial to proceed with the rest.',
            );
        }

        const fromMediaMs = request.fromMediaPosition
            ? (parseTimeSpan(request.fromMediaPosition) || 0)
            : 0;

        const transaction = await this.db.sequelize.transaction();

        try {
            const written = await guardDataIntegrity({
                sequelize: this.db.sequelize,
                transaction,
                tables: ['observations', 'keyframes'],
                label: preview.mode,
                work: async () => {
                    // Re-read inside the transaction, so what is written reflects the
                    // database now rather than during the preview.
                    const rows = await this.readScope(
                        request.sessionId,
                        request.videoSource || null,
                        fromMediaMs,
                        transaction,
                    );

                    if (preview.mode === MODE_ESTABLISH) {
                        const { plan } = this.planTimeShift(rows, preview.shiftMs);

                        for (const change of plan) {
                            await change.row.update({
                                actualPosition: change.actualAfter,
                                tc: change.tcAfter,
                                frame: change.frameAfter,
                                etc: change.etcAfter,
                            }, { transaction });
                        }

                        return plan.length;
                    }

                    const { plan } = this.planPointerShift(rows, preview.shiftMs);

                    for (const change of plan) {
                        await change.row.update({
                            mediaPosition: change.mediaAfter,
                        }, { transaction });

                        for (const entry of change.keyframes) {
                            await entry.keyframe.update({
                                framenum: entry.after,
                            }, { transaction });
                        }
                    }

                    return plan.length;
                },
            });

            await transaction.commit();

            const undo = preview.mode === MODE_ESTABLISH
                ? `shiftMs ${preview.undoWith.shiftMs}`
                : `frames ${preview.undoWith.frames}`;

            logger.info(
                `${preview.mode}: session ${request.sessionId}`
                + `${request.videoSource ? ` clip ${request.videoSource}` : ''}`
                + ` -- ${written} observations`
                + (preview.mode === MODE_POINTER
                    ? ` and ${preview.keyframesToCorrect} keyframes, times unchanged`
                    : ', pointers unchanged')
                + `. Shift ${preview.shiftMs} ms. Undo with ${undo}.`
                + `${request.note ? ` Reason: ${request.note}` : ''}`,
            );

            return Object.assign({}, preview, {
                applied: true,
                observationsCorrected: written,
            });
        } catch (error) {
            await transaction.rollback();
            logger.error('Error::' + error);
            throw error;
        }
    }
}

module.exports = new TimecodeSyncRepository();
module.exports.MODE_ESTABLISH = MODE_ESTABLISH;
module.exports.MODE_POINTER = MODE_POINTER;
