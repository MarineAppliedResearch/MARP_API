/**
 * Controller layer for the MARP machine-learning pipeline API endpoints.
 *
 * Delegates incoming requests to the dataset service for the full ML
 * pipeline surface: ML models, datasets, dataset observations, training
 * runs, epochs, and metrics (summary and curve) records. Controllers in
 * this codebase should contain request delegation and logging only;
 * database access belongs in the repository and broader business logic
 * belongs in the service layer.
 *
 * @fileoverview ML pipeline (models, datasets, training runs, epochs, metrics) request delegation.
 * @author Isaac Travers
 * @module controller/dataset
 */

const datasetService  = require('../service/dataset.service');
const logger = require('../logger/api.logger');

/**
 * Handles ML pipeline HTTP request delegation for models, datasets,
 * dataset observations, training runs, epochs, and metrics.
 *
 * @class DatasetController
 */
class DatasetController {

    /**
     * Fetch every dataset record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All Dataset records. Resolves to an
     * empty array when none exist or the underlying query fails.
     */
    async getDatasets() {
        logger.info('Controller: getDatasets')
        return await datasetService.getDatasets();
    }

    /**
     * Fetch a single dataset record by ID.
     *
     * @async
     * @param {number|string} datasetID - ID of the dataset to fetch.
     * @returns {Promise<Object|null>} The matching Dataset record, or null
     * if not found. Unlike most other read methods on this controller, a
     * database failure here propagates as a rejected promise rather than
     * resolving to null or an empty array; the `/api/dataset/:id` route
     * catches that rejection and responds with HTTP 500.
     */
    async getDatasetById(datasetID) {
        logger.info('Controller: getDatasetById')
        return await datasetService.getDatasetById(datasetID);
    }



    /**
     * Create a new dataset record.
     *
     * @async
     * @param {Object} dataset - Dataset fields to insert (name, location, description, num_samples, num_classes, source, notes, etc.), corresponding to the Dataset schema.
     * @returns {Promise<Object|null>} The created Dataset record, or null if
     * the insert failed. A failed insert resolves rather than rejecting, so
     * the `/api/dataset` POST route's `.catch()` never fires on a DB error
     * and the client receives HTTP 200 with a `null` body instead of a 500.
     */
    async createDataset(dataset){
        logger.info('Controller: createDataset: ' + dataset)
        return await datasetService.createDataset(dataset);
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
        logger.info('Controller: updateDataset: ')
        return await datasetService.updateDataset(datasetID, newData);
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
        logger.info('Controller: deleteDataset: ')
        return await datasetService.deleteDataset(datasetID);
    }

    /**
     * Create a new dataset_observation join record linking a dataset to an
     * observation.
     *
     * @async
     * @param {Object} dataset_observation - DatasetObservation fields to insert (dataset_id, observation_id, inclusion_type, num_keyframes, selected_by, added_at, etc.).
     * @returns {Promise<Object>} The created DatasetObservation record. A
     * failed insert rejects the returned promise rather than resolving to
     * an error value; the `/api/dataset_observation` route catches it and
     * responds with HTTP 500.
     */
    async createDatasetObservation(dataset_observation){
        logger.info('Controller: createdataset_observation: ' + dataset_observation)
        return await datasetService.createDatasetObservation(dataset_observation);
    }

    /**
     * Bulk-insert dataset_observation records.
     *
     * @async
     * @param {Array<Object>} dataset_observation_array - Array of DatasetObservation fields to insert, one object per row.
     * @returns {Promise<Array<Object>>} The created DatasetObservation
     * records. Rejects (rather than resolving to an error value) if the
     * array is missing/empty or if the bulk insert fails; the
     * `/api/dataset_observations/bulk` route catches that rejection and
     * responds with HTTP 500. On success the route re-wraps the resolved
     * array as `{ inserted: data.length }` rather than returning the
     * records themselves.
     */
    async bulkCreateDatasetObservations(dataset_observation_array){
        logger.info('Controller: create dataset_observation_array: ')
        return await datasetService.bulkCreateDatasetObservations(dataset_observation_array);
    }

    /**
     * Fetch a single dataset_observation record by ID.
     *
     * @async
     * @param {number|string} id - ID of the dataset_observation to fetch.
     * @returns {Promise<Object|null>} The matching DatasetObservation
     * record, or null if not found. Rejects on a database failure rather
     * than resolving to a fallback value.
     */
    async getDatasetObservationById(id){
        logger.info('Controller: getDatasetObservationById: ')
        return await datasetService.getDatasetObservationById(id);
    }

    /**
     * Update an existing dataset_observation record by ID.
     *
     * @async
     * @param {number|string} id - ID of the dataset_observation to update.
     * @param {Object} newData - DatasetObservation fields to update.
     * @returns {Promise<Object|null>} The updated DatasetObservation
     * record, or null if no row matched the given ID. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async updateDatasetObservation(id, newData){
        logger.info('Controller: updateDatasetObservation: ')
        return await datasetService.updateDatasetObservation(id, newData);
    }

    /**
     * Delete a dataset_observation record by ID.
     *
     * @async
     * @param {number|string} id - ID of the dataset_observation to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteDatasetObservation(id){
        logger.info('Controller: deleteDatasetObservation: ')
        return await datasetService.deleteDatasetObservation(id);
    }

    /**
     * Fetch every ML model record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All MlModel records. A database
     * failure rejects the returned promise rather than resolving to an
     * empty array; the `/api/ml_models` route catches that rejection and
     * responds with HTTP 500.
     */
    async getMl_models() {
        logger.info('Controller: getMl_models')
        return await datasetService.getMl_models();
    }

    /**
     * Create a new ML model record.
     *
     * @async
     * @param {Object} mlmodel - MlModel fields to insert (name, description, version, framework, architecture, storage_path, etc.). `created_at`/`updated_at` are defaulted server-side if omitted.
     * @returns {Promise<Object>} The created MlModel record. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async createModel(mlmodel){
        logger.info('Controller: createModel: ')
        return await datasetService.createModel(mlmodel);
    }

    /**
     * Update an existing ML model record by ID.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to update.
     * @param {Object} newData - MlModel fields to update; `updated_at` is refreshed server-side regardless of what is supplied.
     * @returns {Promise<Object|null>} The updated MlModel record, or null if
     * no model matched the given ID. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateModel(mlID, newData){
        logger.info('Controller: updateModel: ')
        return await datasetService.updateModel(mlID, newData);
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
        logger.info('Controller: getModelById: ')
        return await datasetService.getModelById(mlID);
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
        logger.info('Controller: deleteModel: ')
        return await datasetService.deleteModel(mlID);
    }


    /**
     * Create a new training run record.
     *
     * @async
     * @param {Object} training_run - TrainingRun fields to insert (model_id, dataset_id, run_name, status, total_epochs, batch_size, learning_rate, optimizer, etc.). `created_at`/`updated_at` are defaulted server-side if omitted.
     * @returns {Promise<Object>} The created TrainingRun record. Rejects on
     * a database failure rather than resolving to an error value.
     */
    async createTrainingRun(training_run){
        logger.info('Controller: createTrainingRun: ')
        return await datasetService.createTrainingRun(training_run);
    }

    /**
     * Update an existing training run record by ID.
     *
     * @async
     * @param {number|string} id - ID of the training run to update.
     * @param {Object} training_run - TrainingRun fields to update; `updated_at` is refreshed server-side regardless of what is supplied.
     * @returns {Promise<Object|null>} The updated TrainingRun record, or
     * null if no run matched the given ID. Rejects on a database failure
     * rather than resolving to an error value.
     */
    async updateTrainingRun(id, training_run){
        logger.info('Controller: updateTrainingRun: ')
        return await datasetService.updateTrainingRun(id, training_run);
    }

    /**
     * Fetch a single training run record by ID.
     *
     * @async
     * @param {number|string} runID - ID of the training run to fetch.
     * @returns {Promise<Object|null>} The matching TrainingRun record, or
     * null if not found. Rejects on a database failure rather than
     * resolving to a fallback value.
     */
    async getTrainingRunById(runID){
        logger.info('Controller: getTrainingRunById: ')
        return await datasetService.getTrainingRunById(runID);
    }

    /**
     * Delete a training run record by ID.
     *
     * @async
     * @param {number|string} runID - ID of the training run to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1).
     * Rejects on a database failure rather than resolving to an error
     * value.
     */
    async deleteTrainingRun(runID){
        logger.info('Controller: deleteTrainingRun: ')
        return await datasetService.deleteTrainingRun(runID);
    }

    /**
     * Create a new epoch record for a training run.
     *
     * @async
     * @param {Object} epoch - Epoch fields to insert (training_run_id, epoch_number, precision, recall, map50, map5095, box_loss, cls_loss, dfl_loss, etc.). `created_at`/`updated_at` are defaulted server-side if omitted.
     * @returns {Promise<Object>} The created Epoch record. Rejects on a
     * database failure rather than resolving to an error value.
     */
    async createEpoch(epoch){
        logger.info('Controller: createEpoch: ')
        return await datasetService.createEpoch(epoch);
    }

    /**
     * Update an existing epoch record by ID.
     *
     * @async
     * @param {number|string} id - ID of the epoch to update.
     * @param {Object} epoch - Epoch fields to update; `updated_at` is refreshed server-side regardless of what is supplied.
     * @returns {Promise<Object|null>} The updated Epoch record, or null if
     * no epoch matched the given ID. Rejects on a database failure rather
     * than resolving to an error value.
     */
    async updateEpoch(id, epoch){
        logger.info('Controller: updateEpoch: ')
        return await datasetService.updateEpoch(id, epoch);
    }


    /**
     * Create a new metrics_summary record for a training run and dataset
     * split.
     *
     * @async
     * @param {Object} metrics_summary - MetricsSummary fields to insert (training_run_id, dataset_split, precision, recall, map50, map5095, f1_score, confusion_matrix_path, result_plot_path, details, etc.). `created_at`/`updated_at` are defaulted server-side if omitted.
     * @returns {Promise<Object>} The created MetricsSummary record. Rejects
     * on a database failure rather than resolving to an error value.
     */
    async createMetricsSummary(metrics_summary){
        logger.info('Controller: createMetricsSummary: ')
        return await datasetService.createMetricsSummary(metrics_summary);
    }

    /**
     * Create a single metrics_curve point tied to a metrics_summary record.
     *
     * @async
     * @param {Object} metrics_curve - MetricsCurve fields to insert (metrics_summary_id, confidence_threshold, precision, recall, f1_score, support, etc.). `created_at`/`updated_at` are defaulted server-side if omitted.
     * @returns {Promise<Object>} The created MetricsCurve record. Rejects on
     * a database failure rather than resolving to an error value.
     */
    async createMetricsCurve(metrics_curve){
        logger.info('Controller: createMetricsCurve: ')
        return await datasetService.createMetricsCurve(metrics_curve);
    }

    /**
     * Bulk-insert metrics_curve records.
     *
     * Unlike every other create/update method on this controller, this
     * method takes the raw Express `req`/`res` objects instead of an
     * already-extracted payload; the service unwraps `req.body` itself.
     *
     * @async
     * @param {Object} req - Express request; `req.body` supplies the array of MetricsCurve fields to insert.
     * @param {Object} res - Accepted for signature consistency with the service; not used by this implementation.
     * @returns {Promise<Object>} An `{ inserted: number }` summary object on
     * success (not the created records themselves), or an
     * `{ error: string }` object if the bulk insert failed. A failed insert
     * resolves rather than rejecting — the `/api/metrics_curves/bulk` route
     * has no `.catch()` at all, so a failure still responds with HTTP 200
     * and an `{ error: ... }` body rather than a 500.
     */
    async bulkCreateMetricsCurves(req, res){
        logger.info('Controller: bulkCreateMetricsCurves: ')
        return await datasetService.bulkCreateMetricsCurves(req, res);
    }









}
module.exports = new DatasetController();
