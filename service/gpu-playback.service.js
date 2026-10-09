/**
 * Best-effort Jellyfin playback reporting for GPU attempts.
 *
 * A Jellyfin session represents one worker slot, because independently leased
 * pieces can run concurrently and move between machines. Nothing here changes
 * the worker contract: the coordinator already knows the Jellyfin item, range,
 * worker and accepted frame progress.
 *
 * No playback state is stored in MARP. The existing attempt, job and worker
 * rows reproduce the stable Jellyfin device identity after a process restart,
 * and Jellyfin's live session supplies the current position before stop. This
 * keeps playback reporting out of the scientific database.
 *
 * @fileoverview Reports GPU attempt playback to Jellyfin without controlling jobs.
 * @author Isaac Travers
 * @module service/gpu-playback
 */

'use strict';

const gpuRepository = require('../repository/gpu.repository');
const jellyfinRepository = require('../repository/jellyfin.repository');
const logger = require('../logger/api.logger');

/** Jellyfin uses 100-nanosecond ticks. MARP video time is fixed at 25 fps. */
const TICKS_PER_FRAME = 10_000_000 / 25;

/**
 * Coordinator-side playback lifecycle for GPU attempts.
 */
class GpuPlaybackService {
    /**
     * Build the stable Jellyfin identity for one physical worker slot.
     *
     * The key stays stable if an operator renames the worker. The display name
     * keeps the human-readable enrolled name Jellyfin should show.
     *
     * @param {Object} context - Attempt playback context from PostgreSQL.
     * @returns {Object} Jellyfin client identity.
     */
    clientIdentity(context) {
        return {
            key: `gpu-worker-${context.worker_id}-slot-${context.slot_index}`,
            name: 'MARP GPU worker',
            deviceName: `${context.worker_name} - slot ${context.slot_index}`,
            version: context.worker_version || '1.0.0',
        };
    }

    /**
     * Read the Jellyfin item id from a stored job spec.
     *
     * @param {Object} context - Attempt playback context.
     * @returns {string|null} Item id, or null for URL-backed work.
     */
    itemId(context) {
        const video = context && context.spec && context.spec.video;
        const itemId = video && video.jellyfin_item_id;

        return typeof itemId === 'string' && itemId.trim() !== '' ? itemId.trim() : null;
    }

    /**
     * Translate accepted frame progress into Jellyfin ticks.
     *
     * @param {Object} context - Attempt playback context.
     * @returns {number|null} Absolute media position in ticks.
     */
    positionTicks(context) {
        const range = context && context.spec && context.spec.range;

        if (!range || !Number.isInteger(Number(range.start_frame))) {
            return null;
        }

        const startFrame = Number(range.start_frame);
        const endFrame = Number.isInteger(Number(range.end_frame))
            ? Number(range.end_frame)
            : startFrame;
        const rangeLength = Math.max(endFrame - startFrame, 0);
        const hasFrameProgress = context.progress_unit === 'frames'
            && Number.isInteger(Number(context.progress_done));
        const done = hasFrameProgress
            ? Math.min(Math.max(Number(context.progress_done), 0), rangeLength)
            : 0;

        return Math.trunc((startFrame + done) * TICKS_PER_FRAME);
    }

    /**
     * Record a Jellyfin reporting failure without changing the worker response.
     *
     * @param {number} attemptId - Attempt being reported.
     * @param {string} operation - started, progress, session lookup, or stopped.
     * @param {Error} error - Upstream failure.
     * @returns {Promise<void>}
     */
    async recordFailure(attemptId, operation, error) {
        const reason = error && error.message ? error.message : String(error);

        logger.error(
            `Error::Jellyfin GPU playback ${operation} failed for attempt ${attemptId}: ${reason}`
        );

        try {
            await gpuRepository.appendCoordinatorNote(attemptId, {
                note: 'Jellyfin GPU playback reporting failed',
                operation,
                reason,
            });
        } catch (noteError) {
            logger.error(
                `Error::could not record Jellyfin playback failure for attempt ${attemptId}: ${noteError.message}`
            );
        }
    }

    /**
     * Run one playback operation without allowing it to affect orchestration.
     *
     * @param {number} attemptId - Attempt being reported.
     * @param {string} operation - Name recorded on failure.
     * @param {Function} callback - Async Jellyfin operation.
     * @returns {Promise<void>}
     */
    async bestEffort(attemptId, operation, callback) {
        try {
            await callback();
        } catch (error) {
            await this.recordFailure(attemptId, operation, error);
        }
    }

    /**
     * Report playback started for a newly resolved Jellyfin attempt.
     *
     * @param {number} attemptId - Newly leased attempt.
     * @returns {Promise<void>}
     */
    async start(attemptId) {
        const context = await gpuRepository.getAttemptPlaybackContext(attemptId);
        const itemId = this.itemId(context);

        if (!context || !itemId) {
            return;
        }

        const identity = this.clientIdentity(context);

        await this.bestEffort(attemptId, 'started', async () => {
            await jellyfinRepository.reportPlaybackStarted(
                itemId,
                {
                    positionTicks: this.positionTicks(context) || 0,
                    playMethod: 'DirectStream',
                },
                identity
            );
        });
    }

    /**
     * Report accepted progress, or close playback for a control instruction.
     *
     * @param {number} attemptId - Attempt that heartbeated.
     * @param {string} action - Coordinator response action.
     * @returns {Promise<void>}
     */
    async heartbeat(attemptId, action) {
        if (action !== 'continue') {
            await this.stop(attemptId);
            return;
        }

        const context = await gpuRepository.getAttemptPlaybackContext(attemptId);
        const itemId = this.itemId(context);

        if (!context || !itemId || context.progress_unit !== 'frames' || context.progress_done === null) {
            return;
        }

        const identity = this.clientIdentity(context);

        await this.bestEffort(attemptId, 'progress', async () => {
            await jellyfinRepository.reportPlaybackProgress(
                itemId,
                {
                    positionTicks: this.positionTicks(context),
                    playMethod: 'DirectStream',
                },
                identity
            );
        });
    }

    /**
     * Close playback if this worker slot still shows this attempt's item.
     *
     * Reading the live session first makes a repeated terminal report a no-op.
     * It also recovers the position and media ids after an API restart.
     *
     * @param {number} attemptId - Attempt that stopped.
     * @returns {Promise<void>}
     */
    async stop(attemptId) {
        const context = await gpuRepository.getAttemptPlaybackContext(attemptId);
        const itemId = this.itemId(context);

        if (!context || !itemId) {
            return;
        }

        const identity = this.clientIdentity(context);

        await this.bestEffort(attemptId, 'stopped', async () => {
            const session = await jellyfinRepository.getPlaybackSession(identity);

            if (!session || session.itemId !== itemId) {
                return;
            }

            await jellyfinRepository.reportPlaybackStopped(
                itemId,
                {
                    mediaSourceId: session.mediaSourceId,
                    playSessionId: session.playSessionId,
                    positionTicks: session.positionTicks ?? this.positionTicks(context) ?? 0,
                    playMethod: 'DirectStream',
                },
                identity
            );
        });
    }

    /**
     * Close every session whose lease was reclaimed by one sweep.
     *
     * @param {Array<Object>} expired - Entries returned by expireStaleLeases.
     * @returns {Promise<void>}
     */
    async stopExpired(expired) {
        for (const entry of expired) {
            await this.stop(entry.attempt_id);
        }
    }
}

module.exports = new GpuPlaybackService();
