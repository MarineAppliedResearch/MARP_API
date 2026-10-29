/**
 * Controller layer for what an inference job produced.
 *
 * Request delegation and logging only, as every controller here is.
 *
 * @fileoverview Inference job outcome request delegation.
 * @module controller/inference-outcome
 */

const inferenceOutcomeRepository = require('../repository/inference-outcome.repository');
const logger = require('../logger/api.logger');

/**
 * Handles HTTP request delegation for an inference job's observations.
 *
 * @class InferenceOutcomeController
 */
class InferenceOutcomeController {
    /**
     * What one job wrote, and which species.
     *
     * @async
     * @param {number|string} jobId - GPU job identifier.
     * @returns {Promise<Object|null>} The outcome, or null when there is no such job.
     */
    async getJobOutcome(jobId) {
        logger.info('Controller: getJobOutcome');
        return await inferenceOutcomeRepository.findJobOutcome(jobId);
    }

    /**
     * What every piece of one run wrote, together.
     *
     * @async
     * @param {string} batchId - The run's `batch_id`.
     * @returns {Promise<Object|null>} The outcome, or null when no job carries it.
     */
    async getBatchOutcome(batchId) {
        logger.info('Controller: getBatchOutcome');
        return await inferenceOutcomeRepository.findBatchOutcome(batchId);
    }
}

module.exports = new InferenceOutcomeController();
