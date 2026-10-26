/**
 * Controller layer for what a training run measured and what it produced.
 *
 * Request delegation and logging only, as every controller here is: the reading belongs
 * to the service and the queries to the repository.
 *
 * @fileoverview Training-run metrics and artifact request delegation.
 * @module controller/training-metrics
 */

const trainingMetricsService = require('../service/training-metrics.service');
const logger = require('../logger/api.logger');

/**
 * Handles HTTP request delegation for a training run's final metrics and files.
 *
 * @class TrainingMetricsController
 */
class TrainingMetricsController {
    /**
     * What one run measured: per-class rows and its confusion matrices.
     *
     * @async
     * @param {number|string} runId - Training run identifier.
     * @returns {Promise<Object>} `{metrics, confusion_matrices}`.
     */
    async getMetricsForRun(runId) {
        logger.info('Controller: getMetricsForRun');
        return await trainingMetricsService.readMetrics(runId);
    }

    /**
     * Every file one run's attempt handed over.
     *
     * @async
     * @param {number|string} runId - Training run identifier.
     * @returns {Promise<Array<Object>>} The files.
     */
    async getArtifactsForRun(runId) {
        logger.info('Controller: getArtifactsForRun');
        return await trainingMetricsService.readArtifacts(runId);
    }

    /**
     * Where one of a run's files is on disk.
     *
     * @async
     * @param {number|string} runId - Training run identifier.
     * @param {string} hash - The sha256 addressing the file.
     * @returns {Promise<Object|null>} `{file, name, content_type}` or null.
     */
    async locateArtifact(runId, hash) {
        logger.info('Controller: locateArtifact');
        return await trainingMetricsService.locateArtifact(runId, hash);
    }
}

module.exports = new TrainingMetricsController();
