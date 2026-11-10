/**
 * A video's clock: when its recording started, and the moment each observation in it was seen (#76).
 *
 * Settled with Isaac on 2026-11-09 (MARP_API#76):
 *
 * - **The clock belongs to the video file.** A session spans several files and a file can
 *   sit in several sessions, so a session-wide sync is wrong for all but one of its files.
 * - **A clock is set only when somebody sets it**: when a run is queued, by reading the
 *   clock burnt into a frame, or by typing it. The time in the file name
 *   (`20210614_164041_Fwd.mp4` -> 2021-06-14 16:40:41 UTC) is *offered* as the suggestion,
 *   never applied on its own. A video with no clock keeps video-position times, and says so.
 * - **Setting it corrects every observation in that video**, in every session: `observed_at`
 *   becomes start + position, and the clock time (`actualPosition`, and `tc`, `frame`,
 *   `etc` where they still follow from it) becomes the time of day of that moment. Positions
 *   in the video are never touched. A value something else wrote -- one the derivation does
 *   not reproduce -- is left exactly as found, the rule the session resync already keeps.
 *
 * File-name times are taken as UTC (Isaac: "usually set at UTC").
 *
 * @fileoverview Reading, suggesting and setting a video's clock.
 * @author Isaac Travers
 * @module service/video-clock
 */

'use strict';

const db = require('../model');
const logger = require('../logger/api.logger');
const { guardDataIntegrity } = require('../db/data-integrity');
const { parseTimeSpan, formatTimeSpan, deriveTc, deriveFrame, shiftTruncated, classifyRow } = require('../db/timecode');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const jellyfinRepository = require('../repository/jellyfin.repository');
const { MEDIA_CLIENT_IDENTITY } = require('../config/gpu-orchestration');

const { QueryTypes } = db.Sequelize;

/** How a start was learned. */
const START_SOURCES = ['file-name', 'entered', 'synced'];

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYYMMDD_HHMMSS` anywhere in a file name, not run into other digits. */
const NAME_TIME = /(?:^|[^0-9])((?:19|20)\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?![0-9])/;

const invalid = (message) => new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message);

/**
 * The recording start a file name states, as UTC, or null when it states none.
 *
 * A name whose digits are not a real moment -- month 13, 25 o'clock -- states none, rather
 * than one `Date` quietly rolls over into the next month.
 *
 * @param {string} name - A file name such as `20210614_164041_Fwd.mp4`.
 * @returns {Date|null}
 */
function startFromName(name) {
    const match = NAME_TIME.exec(String(name || ''));
    if (!match) return null;
    const [, y, mo, d, h, mi, s] = match.map(Number);
    const at = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    const real = at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d
        && at.getUTCHours() === h && at.getUTCMinutes() === mi && at.getUTCSeconds() === s;
    return real ? at : null;
}

/** Milliseconds into its UTC day. */
const msOfDay = (date) => ((date.getTime() % DAY_MS) + DAY_MS) % DAY_MS;

/**
 * The clock-derived columns for one observation at `mediaMs` into a video started at `start`.
 *
 * `actualPosition` keeps the record's shape -- a time of day, which counts past 24 hours as
 * `1.hh:mm:ss` when a video runs over midnight, as the annotation GUI writes it -- and
 * `observed_at` carries the date.
 *
 * @param {Date} start - The video's recorded start.
 * @param {number} mediaMs - Position in the video.
 * @returns {{actualMs: number, observedAt: Date}}
 */
function clockAt(start, mediaMs) {
    return { actualMs: msOfDay(start) + mediaMs, observedAt: new Date(start.getTime() + mediaMs) };
}

class VideoClockService {
    /**
     * Name the video: the file name observations record, from a Jellyfin item when that is
     * what the caller has. The same derivation a run uses, so they cannot disagree.
     *
     * @async
     * @param {{videoSource?: string, jellyfinItemId?: string}} video
     * @returns {Promise<{videoSource: string, jellyfinItemId: (string|null)}>}
     */
    async resolve({ videoSource, jellyfinItemId } = {}) {
        const source = typeof videoSource === 'string' ? videoSource.trim() : '';
        const item = typeof jellyfinItemId === 'string' ? jellyfinItemId.trim() : '';
        if (!source && !item) throw invalid('Name the video: video_source or jellyfin_item_id.');
        if (source) return { videoSource: source, jellyfinItemId: item || null };

        const found = await jellyfinRepository.getItem(item, MEDIA_CLIENT_IDENTITY);
        if (!found) throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, `Jellyfin has no item ${item}.`);
        const name = String(found.path || '').replace(/\\/g, '/').split('/').pop() || found.name || '';
        if (!name) throw invalid(`Jellyfin item ${item} has neither a path nor a name.`);
        return { videoSource: name, jellyfinItemId: item };
    }

    /**
     * What is known about a video's clock, and what its name suggests.
     *
     * @async
     * @param {string} videoSource
     * @returns {Promise<Object>} `{ video_source, recorded_start, start_source, start_set_by,
     *   start_set_at, suggested_start }`, the clock fields null when none is set.
     */
    async describe(videoSource) {
        const video = await db.videos.findOne({ where: { video_source: videoSource } });
        const suggested = startFromName(videoSource);
        return {
            video_source: videoSource,
            recorded_start: video && video.recorded_start ? video.recorded_start.toISOString() : null,
            start_source: video ? video.start_source : null,
            start_set_by: video ? video.start_set_by : null,
            start_set_at: video && video.start_set_at ? video.start_set_at.toISOString() : null,
            suggested_start: suggested ? suggested.toISOString() : null,
        };
    }

    /**
     * The start a video's clock is set to, or null. What a run's results are timed by.
     *
     * @async
     * @param {string} videoSource
     * @param {Object} [transaction]
     * @returns {Promise<Date|null>}
     */
    async startOf(videoSource, transaction) {
        if (!videoSource) return null;
        const video = await db.videos.findOne({ where: { video_source: videoSource }, transaction });
        return video && video.recorded_start ? new Date(video.recorded_start) : null;
    }

    /**
     * Set a video's clock and correct every observation in it.
     *
     * `start` is when the recording started. A reading off the picture is given instead as
     * `clock` -- the date and time the burnt-in clock shows -- and `atMediaPosition`, the
     * position of that frame, and the start is worked out from the two.
     *
     * @async
     * @param {Object} request
     * @param {string} [request.videoSource] - The file, as observations name it.
     * @param {string} [request.jellyfinItemId] - Or the Jellyfin item.
     * @param {string} [request.start] - ISO date and time the recording started, UTC.
     * @param {string} [request.clock] - ISO date and time read off a frame, UTC.
     * @param {string} [request.atMediaPosition] - That frame's position, `hh:mm:ss.fff`.
     * @param {string} request.source - `file-name`, `entered` or `synced`.
     * @param {number|null} [request.userId] - Who set it.
     * @returns {Promise<Object>} The clock as now set, and what changed.
     */
    async setClock(request = {}) {
        const { videoSource, jellyfinItemId } = await this.resolve(request);
        if (!START_SOURCES.includes(request.source)) {
            throw invalid(`source must be one of ${START_SOURCES.join(', ')}.`);
        }

        let start;
        if (request.start !== undefined && request.start !== null) {
            start = new Date(request.start);
            if (Number.isNaN(start.getTime())) throw invalid('start must be an ISO date and time.');
        } else {
            const clock = new Date(request.clock);
            const at = parseTimeSpan(request.atMediaPosition);
            if (Number.isNaN(clock.getTime()) || at === null) {
                throw invalid('Give start, or clock with at_media_position.');
            }
            start = new Date(clock.getTime() - at);
        }

        const transaction = await db.sequelize.transaction();
        try {
            const counts = await guardDataIntegrity({
                sequelize: db.sequelize,
                transaction,
                tables: ['observations', 'videos'],
                label: 'video clock',
                work: async () => {
                    const [video] = await db.videos.findOrCreate({
                        where: { video_source: videoSource },
                        defaults: { video_source: videoSource },
                        transaction,
                    });
                    await video.update({
                        jellyfin_item_id: jellyfinItemId || video.jellyfin_item_id,
                        recorded_start: start,
                        start_source: request.source,
                        start_set_by: request.userId ?? null,
                        start_set_at: new Date(),
                        updated_at: new Date(),
                    }, { transaction });
                    return this.applyClock(videoSource, start, transaction);
                },
            });
            await transaction.commit();
            logger.info(`video clock: ${videoSource} starts ${start.toISOString()} (${request.source}) -- `
                + `${counts.observations} observation(s) timed, ${counts.unreadable} left alone`);
            return { ...(await this.describe(videoSource)), ...counts };
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Time every observation in one video by its clock.
     *
     * @async
     * @param {string} videoSource
     * @param {Date} start
     * @param {Object} transaction
     * @returns {Promise<{observations: number, unreadable: number, tcLeftAlone: number,
     *   frameLeftAlone: number}>}
     */
    async applyClock(videoSource, start, transaction) {
        const rows = await db.sequelize.query(
            `SELECT observation_id, "mediaPosition", "actualPosition", tc, frame, etc
               FROM observations WHERE video_source = :videoSource
              ORDER BY observation_id FOR UPDATE`,
            { replacements: { videoSource }, type: QueryTypes.SELECT, transaction }
        );
        const counts = { observations: 0, unreadable: 0, tcLeftAlone: 0, frameLeftAlone: 0 };
        // Column by column, for one UPDATE: the busiest video holds about 2,800 observations.
        const set = { id: [], observedAt: [], actual: [], tc: [], frame: [], etc: [] };

        for (const row of rows) {
            const verdict = classifyRow(row);
            if (verdict.mediaMs === null || verdict.actualMs === null) {
                counts.unreadable += 1;
                continue;
            }
            const { actualMs, observedAt } = clockAt(start, verdict.mediaMs);
            const shiftMs = actualMs - verdict.actualMs;
            if (!verdict.tcDerivable) counts.tcLeftAlone += 1;
            if (!verdict.frameDerivable) counts.frameLeftAlone += 1;

            set.id.push(row.observation_id);
            set.observedAt.push(observedAt.toISOString());
            set.actual.push(formatTimeSpan(actualMs));
            set.tc.push(verdict.tcDerivable ? deriveTc(actualMs) : row.tc);
            set.frame.push(verdict.frameDerivable ? deriveFrame(actualMs) : (row.frame === null ? null : String(row.frame)));
            set.etc.push(shiftTruncated(row.etc, shiftMs));
            counts.observations += 1;
        }

        if (set.id.length) {
            await db.sequelize.query(
                `UPDATE observations o
                    SET observed_at = v.observed_at, "actualPosition" = v.actual, tc = v.tc, frame = v.frame, etc = v.etc
                   FROM unnest($1::int[], $2::timestamptz[], $3::text[], $4::text[], $5::text[], $6::text[])
                        AS v(id, observed_at, actual, tc, frame, etc)
                  WHERE o.observation_id = v.id`,
                { bind: [set.id, set.observedAt, set.actual, set.tc, set.frame, set.etc], transaction }
            );
        }
        return counts;
    }
}

module.exports = new VideoClockService();
module.exports.startFromName = startFromName;
module.exports.clockAt = clockAt;
module.exports.START_SOURCES = START_SOURCES;
