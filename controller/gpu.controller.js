/**
 * Controller layer for the GPU orchestration API.
 *
 * Delegates incoming requests to the GPU service and logs each call. Request
 * delegation and logging only: validation and shaping are in the service, and
 * every atomic state decision is in the repository.
 *
 * @fileoverview GPU orchestration request delegation.
 * @author Isaac Travers
 * @module controller/gpu
 */

'use strict';

const gpuService = require('../service/gpu.service');
const logger = require('../logger/api.logger');

/**
 * Handles GPU orchestration HTTP request delegation.
 *
 * @class GpuController
 */
class GpuController {

    /**
     * Enrol a GPU machine into the pool.
     *
     * @async
     * @param {Object} body - Enrolment request body.
     * @returns {Promise<Object>} `{worker_id, heartbeat_seconds, ...}`.
     */
    async enrolWorker(body) {
        logger.info('Controller: enrolWorker');
        return gpuService.enrolWorker(body);
    }

    /**
     * Poll for work on behalf of a worker.
     *
     * @async
     * @param {Object} body - Poll request body.
     * @param {Function} [isAbandoned] - Answers true once the polling worker's
     * connection has gone, so a wait nobody is listening to takes no lease.
     * @returns {Promise<Object|null>} The lease, or null when there is no work.
     */
    async pollForWork(body, isAbandoned) {
        logger.info('Controller: pollForWork');
        return gpuService.pollForWork(body, isAbandoned);
    }

    /**
     * Record a heartbeat and return the control action.
     *
     * @async
     * @param {number|string} attemptId - Attempt identifier from the path.
     * @param {Object} body - Heartbeat request body.
     * @returns {Promise<Object>} `{action, lease_expires_at, ...}`.
     */
    async heartbeat(attemptId, body) {
        logger.info('Controller: heartbeat');
        return gpuService.heartbeat(attemptId, body);
    }

    /**
     * Append a batch of attempt events.
     *
     * @async
     * @param {number|string} attemptId - Attempt identifier from the path.
     * @param {Object} body - Events request body.
     * @returns {Promise<Object>} `{accepted, next_seq, ...}`.
     */
    async recordEvents(attemptId, body) {
        logger.info('Controller: recordEvents');
        return gpuService.recordEvents(attemptId, body);
    }

    /**
     * Record an attempt's terminal result.
     *
     * @async
     * @param {number|string} attemptId - Attempt identifier from the path.
     * @param {Object} body - Result request body.
     * @returns {Promise<Object>} The idempotent ack.
     */
    async recordResult(attemptId, body) {
        logger.info('Controller: recordResult');
        return gpuService.recordResult(attemptId, body);
    }

    /**
     * Answer whether MARP already holds an artifact's bytes.
     *
     * @async
     * @param {Object} body - `{sha256, bytes}`.
     * @returns {Promise<Object>} `{already_have, upload_url}`.
     */
    async checkArtifact(body) {
        logger.info('Controller: checkArtifact');
        return gpuService.checkArtifact(body);
    }

    /**
     * Record that an artifact's bytes have arrived.
     *
     * @async
     * @param {Object} params - `{sha256, bytes, contentType, attemptId}`.
     * @returns {Promise<Object>} The staged artifact.
     */
    async stageArtifact(params) {
        logger.info('Controller: stageArtifact');
        return gpuService.stageArtifact(params);
    }

    /**
     * Fetch the compute pool.
     *
     * @async
     * @returns {Promise<Array<Object>>} One entry per worker.
     */
    async listPool() {
        logger.info('Controller: listPool');
        return gpuService.listPool();
    }

    /**
     * List GPU jobs.
     *
     * @async
     * @param {Object} query - Query-string filters.
     * @returns {Promise<Object>} `{jobs, total, limit, offset}`.
     */
    async listJobs(query) {
        logger.info('Controller: listJobs');
        return gpuService.listJobs(query);
    }

    /**
     * Fetch one job with its attempts and artifacts.
     *
     * @async
     * @param {number|string} jobId - Job identifier from the path.
     * @returns {Promise<Object>} `{job, attempts, artifacts}`.
     */
    async getJob(jobId) {
        logger.info('Controller: getJob');
        return gpuService.getJob(jobId);
    }

    /**
     * Submit one job, or a batch covering a video in pieces.
     *
     * @async
     * @param {Object} body - Submission request body.
     * @param {Object} [principal] - Authenticated caller, for `created_by`.
     * @returns {Promise<Object>} `{batch_id, jobs}`.
     */
    async submitJobs(body, principal) {
        logger.info('Controller: submitJobs');
        return gpuService.submitJobs(body, principal);
    }

    /**
     * Cancel a job.
     *
     * @async
     * @param {number|string} jobId - Job identifier from the path.
     * @returns {Promise<Object>} `{job, changed}`.
     */
    async cancelJob(jobId) {
        logger.info('Controller: cancelJob');
        return gpuService.cancelJob(jobId);
    }
}

module.exports = new GpuController();
