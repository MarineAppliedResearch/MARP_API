/**
 * Service layer for ML pipeline operations covering models, datasets,
 * dataset observations, training runs, epochs, and metrics.
 *
 * Coordinates between the dataset controller and the dataset repository.
 * This layer currently passes most calls through directly; additional
 * business logic (validation, coordination across repositories, etc.)
 * should be added here rather than in the controller or repository.
 *
 * @fileoverview ML pipeline (models, datasets, training runs, epochs, metrics) service operations.
 * @author Isaac Travers
 * @module service/dataset
 */

const datasetRepository  = require('../repository/dataset.repository');

/**
 * Coordinates ML pipeline operations (models, datasets, training runs,
 * epochs, metrics) between the controller and repository layers.
 *
 * @class DatasetService
 */
class DatasetService {

    constructor() {}


    /**
     * Fetch every dataset record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All Dataset records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
     async getDatasets() {
            return await datasetRepository.getDatasets();
        }

    /**
     * Fetch a single dataset record by ID.
     *
     * @async
     * @param {number|string} datasetID - ID of the dataset to fetch.
     * @returns {Promise<Object|null>} The matching Dataset record, or null
     * if not found. A database failure rejects the returned promise rather
     * than resolving to null.
     */
    async getDatasetById(datasetID) {
            return await datasetRepository.getDatasetById(datasetID);
    }

    /**
     * Create a new dataset record.
     *
     * @async
     * @param {Object} dataset - Dataset fields to insert, corresponding to the Dataset schema.
     * @returns {Promise<Object|null>} The created Dataset record, or null
     * if the insert failed. A failed insert resolves rather than
     * rejecting, so callers must check for a null return.
     */
    async createDataset(dataset){
        return await datasetRepository.createDataset(dataset);
    }

    /**
     * Update an existing dataset record by ID.
     *
     * @async
     * @param {number|string} datasetID - ID of the dataset to update.
     * @param {Object} newData - Dataset fields to update.
     * @returns {Promise<Object|null>} The updated Dataset record, or null if
     * no dataset matched the given ID. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateDataset(datasetID, newData){
        return await datasetRepository.updateDataset(datasetID, newData);
    }

    /**
     * Delete a dataset record by ID.
     *
     * @async
     * @param {number|string} datasetID - ID of the dataset to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteDataset(datasetID){
        return await datasetRepository.deleteDataset(datasetID);
    }

    /**
     * Create a new dataset_observation join record linking a dataset to an
     * observation.
     *
     * @async
     * @param {Object} dataset_observation - DatasetObservation fields to insert.
     * @returns {Promise<Object>} The created DatasetObservation record.
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async createDatasetObservation(dataset_observation){
        return await datasetRepository.createDatasetObservation(dataset_observation);
    }

    /**
     * Bulk-insert dataset_observation records.
     *
     * @async
     * @param {Array<Object>} dataset_observation - Array of DatasetObservation fields to insert, one object per row.
     * @returns {Promise<Array<Object>>} The created DatasetObservation
     * records. Rejects if the array is missing/empty or if the bulk insert
     * fails, rather than resolving to an error value.
     */
    async bulkCreateDatasetObservations(dataset_observation){
        return await datasetRepository.bulkCreateDatasetObservations(dataset_observation);
    }

    /**
     * Fetch every ML model record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All MlModel records. A database
     * failure rejects the returned promise rather than resolving to an
     * empty array.
     */
    async getMl_models() {
        return await datasetRepository.getMl_models();
    }

    /**
     * Create a new ML model record.
     *
     * @async
     * @param {Object} mlmodel - MlModel fields to insert.
     * @returns {Promise<Object>} The created MlModel record. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async createModel(mlmodel){
        return await datasetRepository.createModel(mlmodel);
    }

    /**
     * Update an existing ML model record by ID.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to update.
     * @param {Object} newData - MlModel fields to update.
     * @returns {Promise<Object|null>} The updated MlModel record, or null
     * if no model matched the given ID. Rejects on a database failure
     * rather than resolving to an error value.
     */
    async updateModel(mlID, newData){
        return await datasetRepository.updateModel(mlID, newData);
    }

    /**
     * Fetch a single ML model record by ID.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to fetch.
     * @returns {Promise<Object|null>} The matching MlModel record, or null
     * if not found. Rejects on a database failure rather than resolving to
     * a fallback value.
     */
    async getModelById(mlID){
        return await datasetRepository.getModelById(mlID);
    }

    /**
     * Delete an ML model record by ID.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteModel(mlID){
        return await datasetRepository.deleteModel(mlID);
    }

    /**
     * Create a new training run record.
     *
     * @async
     * @param {Object} training_run - TrainingRun fields to insert.
     * @returns {Promise<Object>} The created TrainingRun record. Rejects on
     * a database failure rather than resolving to an error value.
     */
    async createTrainingRun(training_run){
        return await datasetRepository.createTrainingRun(training_run);
    }

    /**
     * Update an existing training run record by ID.
     *
     * @async
     * @param {number|string} id - ID of the training run to update.
     * @param {Object} training_run - TrainingRun fields to update.
     * @returns {Promise<Object|null>} The updated TrainingRun record, or
     * null if no run matched the given ID. Rejects on a database failure
     * rather than resolving to an error value.
     */
    async updateTrainingRun(id, training_run){
        return await datasetRepository.updateTrainingRun(id, training_run);
    }

    /**
     * Create a new epoch record for a training run.
     *
     * @async
     * @param {Object} epoch - Epoch fields to insert.
     * @returns {Promise<Object>} The created Epoch record. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async createEpoch(epoch){
        return await datasetRepository.createEpoch(epoch);
    }

    /**
     * Update an existing epoch record by ID.
     *
     * @async
     * @param {number|string} id - ID of the epoch to update.
     * @param {Object} epoch - Epoch fields to update.
     * @returns {Promise<Object|null>} The updated Epoch record, or null if
     * no epoch matched the given ID. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateEpoch(id, epoch){
        return await datasetRepository.updateEpoch(id, epoch);
    }

    /**
     * Create a new metrics_summary record for a training run and dataset
     * split.
     *
     * @async
     * @param {Object} metrics_summary - MetricsSummary fields to insert.
     * @returns {Promise<Object>} The created MetricsSummary record. Rejects
     * on a database failure rather than resolving to an error value.
     */
    async createMetricsSummary(metrics_summary){
        return await datasetRepository.createMetricsSummary(metrics_summary);
    }

    /**
     * Create a single metrics_curve point tied to a metrics_summary record.
     *
     * @async
     * @param {Object} metrics_curve - MetricsCurve fields to insert.
     * @returns {Promise<Object>} The created MetricsCurve record. Rejects on
     * a database failure rather than resolving to an error value.
     */
    async createMetricsCurve(metrics_curve){
        return await datasetRepository.createMetricsCurve(metrics_curve);
    }

    /**
     * Bulk-insert metrics_curve records.
     *
     * Unlike every other method on this service, this method takes the raw
     * Express `req`/`res` objects rather than an already-extracted payload,
     * and unwraps `req.body` itself before delegating to the repository.
     *
     * @async
     * @param {Object} req - Express request; `req.body` supplies the array of MetricsCurve fields to insert.
     * @param {Object} res - Accepted for signature consistency with the controller; not used by this implementation.
     * @returns {Promise<Object>} An `{ inserted: number }` summary object on
     * success (not the created records themselves), or an
     * `{ error: string }` object if the bulk insert failed. A failed
     * insert resolves rather than rejecting, so callers must check for an
     * `error` property.
     */
    async bulkCreateMetricsCurves(req, res){
        return await datasetRepository.bulkCreateMetricsCurves(req.body);
    }

}

module.exports = new DatasetService();
