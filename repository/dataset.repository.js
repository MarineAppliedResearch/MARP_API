/**
 * Repository module for the MARP machine-learning pipeline database
 * operations.
 *
 * This file contains Sequelize queries covering the full ML pipeline
 * surface: ML models, datasets, dataset observations (the join table
 * linking datasets to observations), training runs, epochs, and metrics
 * (summary and curve) records.
 *
 * Repository functions should contain database-access logic only. Request
 * handling belongs in controllers, while broader application behavior
 * belongs in services.
 *
 * NOTE: error handling is inconsistent across the methods in this file.
 * Some methods swallow database errors and resolve to a fallback value
 * instead of throwing (`getDatasets()` -> `[]`, `createDataset()` -> `null`,
 * `bulkCreateMetricsCurves()` -> `{ error: string }`), while most others
 * (`getDatasetById()`, `createDatasetObservation()`,
 * `bulkCreateDatasetObservations()`, `getMl_models()`, `createModel()`,
 * `updateModel()`, `createTrainingRun()`, `updateTrainingRun()`,
 * `createEpoch()`, `updateEpoch()`, `createMetricsSummary()`,
 * `createMetricsCurve()`) re-throw and let the caller's promise reject.
 * The four `update*`/`getDatasetById` "not found" cases additionally
 * resolve to `null` (not an error) when the target row does not exist.
 * Callers (and the server.js routes built on this repository) must
 * account for all three shapes: thrown rejection, `null`/`[]` fallback,
 * and `{ error: string }` object.
 *
 * @fileoverview ML pipeline (models, datasets, training runs, epochs, metrics) database queries and persistence operations.
 * @author Isaac Travers
 * @module repository/dataset
 */

const db = require('../model');
const logger = require('../logger/api.logger');


/**
 * Repository for ML pipeline database operations covering models,
 * datasets, dataset observations, training runs, epochs, and metrics.
 *
 * @class DatasetRepository
 */
class DatasetRepository {

    db = {};

    constructor() {
        this.db = db;
        // For Development

        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/

    }


    /**
     * Fetch every dataset record.
     *
     * Database errors are logged and converted to an empty array. As a
     * result, callers cannot distinguish between a successful query that
     * matched zero datasets and a database failure.
     *
     * @async
     * @returns {Promise<Array<Object>>} All Dataset records. Returns an
     * empty array when none exist or when the database query fails.
     */
    async getDatasets() {

        try {
            const datasets = await this.db.datasets.findAll();
            console.log('datasets:::', datasets);
            return datasets;
        } catch (err) {
            console.log(err);
            return [];
        }
    }


    /**
     * Fetch a single dataset record by its ID.
     *
     * Unlike `getDatasets()`, a database error here is logged and
     * re-thrown rather than swallowed, so callers must catch/handle a
     * rejected promise. A "not found" result, by contrast, resolves to
     * `null` rather than throwing.
     *
     * @async
     * @param {number|string} datasetId - ID of the dataset to fetch.
     * @returns {Promise<Object|null>} The matching Dataset record, or null
     * if not found. Rejects if the underlying query fails.
     */
    // ------------------------------------------------------------
    // getDatasetById
    // ------------------------------------------------------------
    // Retrieves a single dataset record from the database by its ID.
    // Parameters:
    //   datasetId (int) – ID of the dataset to fetch
    // Returns:
    //   Object – dataset record if found, or null if not found.
    // ------------------------------------------------------------
    async getDatasetById(datasetId) {
        try {
            const dataset = await this.db.datasets.findByPk(datasetId);

            if (!dataset) {
                console.warn(`[WARN] Dataset not found (id=${datasetId})`);
                return null;
            }

            console.log(`[INFO] Retrieved dataset: ${dataset.name} (id=${datasetId})`);
            return dataset;
        } catch (err) {
            console.error(`Error in getDatasetById(${datasetId}):`, err);
            throw err;
        }
    }


        /**
         * Creates a new dataset record in the database.
         * Mirrors the same structure and style as getDatasets().
         *
         * Parameters:
         *   datasetData (object) - dataset info, e.g.:
         *     {
         *       name: "FishTraining2025",
         *       location: "datasets/FishTraining2025",
         *       description: "Dataset built from 12 species",
         *       num_samples: 2000,
         *       num_classes: 12,
         *       source: "manual",
         *       notes: ""
         *     }
         *
         * Returns:
         *   (object) The created dataset record, or null on error.
         *
         * @async
         * @param {Object} datasetData - Dataset fields to insert (name, location, description, num_samples, num_classes, source, notes).
         * @returns {Promise<Object|null>} The created Dataset record, or
         * null if the insert failed. Unlike most other create* methods in
         * this file, a failure here is logged and swallowed to `null`
         * rather than re-thrown, so callers must check for a null return
         * instead of relying on a rejected promise.
         */
    async createDataset(datasetData) {
        try {
            const newDataset = await this.db.datasets.create(datasetData);
            console.log('Created dataset:', newDataset.toJSON());
            return newDataset;
        } catch (err) {
            console.error('Error in createDataset():', err);
            return null;
        }
    }


    /**
     * Update an existing dataset record by ID.
     *
     * @async
     * @param {number|string} datasetId - ID of the dataset to update.
     * @param {Object} newData - Dataset fields to update.
     * @returns {Promise<Object|null>} The updated Dataset record, or null if
     * no row matched `datasetId` (logged as a warning rather than treated
     * as an error). A database failure is logged and re-thrown, so the
     * returned promise rejects rather than resolving to an error value.
     */
    async updateDataset(datasetId, newData) {
        try {
            const [rowsUpdated, [updatedDataset]] = await this.db.datasets.update(
                newData,
                { where: { id: datasetId }, returning: true }
            );

            if (rowsUpdated === 0) {
                console.warn(`[WARN] No dataset found with id=${datasetId}`);
                return null;
            }

            return updatedDataset;
        } catch (err) {
            console.error(`Error in updateDataset(${datasetId}):`, err);
            throw err;
        }
    }

    /**
     * Delete a dataset record by ID.
     *
     * @async
     * @param {number|string} datasetId - ID of the dataset to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteDataset(datasetId) {
        try {
            const rowsDeleted = await this.db.datasets.destroy({ where: { id: datasetId } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteDataset(${datasetId}):`, err);
            throw err;
        }
    }

    /**
     * Inserts a new record into the dataset_observations table.
     *
     * Parameters:
     *   datasetObservationData (object):
     *     {
     *       dataset_id: 1,
     *       observation_id: 12345,
     *       inclusion_type: "train",      // "train", "val", or "test"
     *       num_keyframes: 42,
     *       selected_by: "manual",        // "manual" or "auto"
     *       added_at: "2025-10-08T00:00:00Z"
     *     }
     *
     * Returns:
     *   (object) The created dataset_observation record.
     *
     * @async
     * @param {Object} datasetObservationData - DatasetObservation fields to insert (dataset_id, observation_id, inclusion_type, num_keyframes, selected_by, added_at).
     * @returns {Promise<Object>} The created DatasetObservation record.
     * A database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to an error value.
     */
    async createDatasetObservation(datasetObservationData) {

        try {
            console.log("[controller] Creating dataset_observation:", datasetObservationData);
            const record = await this.db.dataset_observations.create(datasetObservationData);
            return record;
        } catch (err) {
            console.error("Error in createDatasetObservation():", err);
            throw err;
        }
    }


    /**
     * Performs a bulk insert into dataset_observations.
     *
     * Parameters:
     *   datasetObservationArray (Array<Object>) -
     *     e.g. [
     *       { dataset_id: 1, observation_id: 123, inclusion_type: "train", num_keyframes: 12, selected_by: "manual", added_at: "2025-10-08T00:00:00Z" },
     *       { dataset_id: 1, observation_id: 124, inclusion_type: "val",   num_keyframes: 7,  selected_by: "manual", added_at: "2025-10-08T00:00:00Z" },
     *       ...
     *     ]
     *
     * Returns:
     *   Array of created records (or throws on error).
     *
     * @async
     * @param {Array<Object>} datasetObservationArray - Array of DatasetObservation fields to insert, one object per row.
     * @returns {Promise<Array<Object>>} The created DatasetObservation
     * records. Rejects (rather than resolving to an error value) if the
     * array is missing/empty or if the bulk insert fails. Note: the
     * `ignoreDuplicates: true` bulkCreate option is passed as a safeguard
     * against repeated `observation_id` values, but this only suppresses
     * duplicate-key errors on dialects that support it (e.g. MySQL) — on
     * Postgres it does not translate to an `ON CONFLICT DO NOTHING` clause
     * in all Sequelize versions, so duplicate rows may still raise a
     * unique-constraint error here depending on the configured dialect.
     */
    async bulkCreateDatasetObservations(datasetObservationArray) {

        try {
            if (!Array.isArray(datasetObservationArray) || datasetObservationArray.length === 0) {
                throw new Error("No dataset observations provided");
            }

            const records = await this.db.dataset_observations.bulkCreate(datasetObservationArray, {
                validate: true,
                ignoreDuplicates: true // optional safeguard if observation_id may repeat
            });

            console.log(`[controller] Bulk inserted ${records.length} dataset_observations`);
            return records;
        } catch (err) {
            console.error("Error in bulkCreateDatasetObservations():", err);
            throw err;
        }
    }



    /**
     * Fetch every ML model record.
     *
     * @async
     * @returns {Promise<Array<Object>>} All MlModel records. A database
     * failure is logged and re-thrown, so the returned promise rejects
     * rather than resolving to an empty array (unlike `getDatasets()`,
     * which swallows errors to `[]`).
     */
    // ------------------------------------------------------------
    // getModels
    // ------------------------------------------------------------
    // Fetches all models from the database.
    // ------------------------------------------------------------
    async getMl_models() {
        try {
            const models = await this.db.ml_models.findAll();
            console.log(`[INFO] Retrieved ${models.length} models`);
            return models;
        } catch (err) {
            console.error("Error in getModels():", err);
            throw err;
        }
    }



    /**
     * Insert a new ML model record.
     *
     * Defaults `created_at`/`updated_at` to the current time when not
     * supplied on the input object.
     *
     * @async
     * @param {Object} mlmodel - MlModel fields to insert (name, description, version, framework, architecture, storage_path, etc.).
     * @returns {Promise<Object>} The created MlModel record. A database
     * failure is logged and re-thrown, so the returned promise rejects
     * rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // createModel
    // ------------------------------------------------------------
    // Inserts a new ML model record into the database.
    // ------------------------------------------------------------
    async createModel(mlmodel) {
        try {
            const now = new Date();
            mlmodel.created_at = mlmodel.created_at || now;
            mlmodel.updated_at = mlmodel.updated_at || now;

            const model = await this.db.ml_models.create(mlmodel);
            console.log(`[DB] Created ML model: ${model.name}`);
            return model;
        } catch (err) {
            console.error("Error in createModel():", err);
            throw err;
        }
    }



    /**
     * Update an existing ML model record by ID.
     *
     * Always refreshes `updated_at` to the current time, overwriting
     * anything the caller may have supplied for that field.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to update.
     * @param {Object} newData - MlModel fields to update.
     * @returns {Promise<Object|null>} The updated MlModel record, or null
     * if no row matched `mlID` (logged as a warning rather than treated as
     * an error). A database failure is logged and re-thrown, so the
     * returned promise rejects rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // updateModel
    // ------------------------------------------------------------
    // Updates an existing ML model record by ID.
    // Automatically refreshes the 'updated_at' timestamp.
    // ------------------------------------------------------------
    async updateModel(mlID, newData) {
        try {
            newData.updated_at = new Date();

            const [rowsUpdated, [updatedModel]] = await this.db.ml_models.update(
                newData,
                {
                    where: { id: mlID },
                    returning: true
                }
            );

            if (rowsUpdated === 0) {
                console.warn(`[WARN] No ML model found with id=${mlID}`);
                return null;
            }

            console.log(`[DB] Updated ML model id=${mlID}`);
            return updatedModel;
        } catch (err) {
            console.error("Error in updateModel():", err);
            throw err;
        }
    }


    /**
     * Fetch a single ML model record by ID.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to fetch.
     * @returns {Promise<Object|null>} The matching MlModel record, or null
     * if not found. A database failure is logged and re-thrown, so the
     * returned promise rejects rather than resolving to a fallback value.
     */
    async getModelById(mlID) {
        try {
            const model = await this.db.ml_models.findByPk(mlID);
            return model || null;
        } catch (err) {
            console.error(`Error in getModelById(${mlID}):`, err);
            throw err;
        }
    }

    /**
     * Delete an ML model record by ID.
     *
     * @async
     * @param {number|string} mlID - ID of the ML model to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteModel(mlID) {
        try {
            const rowsDeleted = await this.db.ml_models.destroy({ where: { id: mlID } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteModel(${mlID}):`, err);
            throw err;
        }
    }

    /**
     * Insert a new training run record.
     *
     * Defaults `created_at`/`updated_at` to the current time when not
     * supplied on the input object.
     *
     * @async
     * @param {Object} runData - TrainingRun fields to insert (model_id, dataset_id, run_name, description, status, start_time, end_time, total_epochs, batch_size, learning_rate, optimizer, etc.).
     * @returns {Promise<Object>} The created TrainingRun record. A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // createTrainingRun
    // ------------------------------------------------------------
    // Inserts a new training run record into the database.
    // Parameters:
    //   runData (object) – contains all fields defined in the
    //   'training_runs' schema, including model_id, dataset_id,
    //   total_epochs, batch_size, learning_rate, optimizer, etc.
    // ------------------------------------------------------------
    async createTrainingRun(runData) {
        try {
            const now = new Date();
            runData.created_at = runData.created_at || now;
            runData.updated_at = runData.updated_at || now;

            const run = await this.db.training_runs.create(runData);
            console.log(`[DB] Created training_run id=${run.id}`);
            return run;
        } catch (err) {
            console.error("Error in createTrainingRun():", err);
            throw err;
        }
    }


    /**
     * Update an existing training run record by ID.
     *
     * Always refreshes `updated_at` to the current time, overwriting
     * anything the caller may have supplied for that field.
     *
     * @async
     * @param {number|string} runID - ID of the training run to update.
     * @param {Object} newData - TrainingRun fields to update.
     * @returns {Promise<Object|null>} The updated TrainingRun record, or
     * null if no row matched `runID` (logged as a warning rather than
     * treated as an error). A database failure is logged and re-thrown, so
     * the returned promise rejects rather than resolving to an error
     * value.
     */
    // ------------------------------------------------------------
    // updateTrainingRun
    // ------------------------------------------------------------
    // Updates an existing training run record by ID.
    // Parameters:
    //   runID (int) – the unique identifier of the training run.
    //   newData (object) – key/value pairs of fields to update.
    // ------------------------------------------------------------
    async updateTrainingRun(runID, newData) {
        try {
            newData.updated_at = new Date();

            const [rowsUpdated, [updatedRun]] = await this.db.training_runs.update(
                newData,
                { where: { id: runID }, returning: true }
            );

            if (rowsUpdated === 0) {
                console.warn(`[WARN] No training_run found with id=${runID}`);
                return null;
            }

            console.log(`[DB] Updated training_run id=${runID}`);
            return updatedRun;
        } catch (err) {
            console.error("Error in updateTrainingRun():", err);
            throw err;
        }
    }



    /**
     * Insert a new epoch record for a training run.
     *
     * Defaults `created_at`/`updated_at` to the current time when not
     * supplied on the input object.
     *
     * @async
     * @param {Object} epochData - Epoch fields to insert (training_run_id, epoch_number, start_time, end_time, duration_seconds, precision, recall, map50, map5095, box_loss, cls_loss, dfl_loss, etc.).
     * @returns {Promise<Object>} The created Epoch record. A database
     * failure is logged and re-thrown, so the returned promise rejects
     * rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // createEpoch
    // ------------------------------------------------------------
    // Inserts a new epoch record into the database.
    // Parameters:
    //   epochData (object) – contains all fields for one epoch,
    //   including training_run_id, epoch_number, loss metrics, etc.
    // ------------------------------------------------------------
    async createEpoch(epochData) {
        try {
            const now = new Date();
            epochData.created_at = epochData.created_at || now;
            epochData.updated_at = epochData.updated_at || now;

            const epoch = await this.db.epochs.create(epochData);
            console.log(`[DB] Created epoch id=${epoch.id} (run_id=${epoch.training_run_id}, epoch=${epoch.epoch_number})`);
            return epoch;
        } catch (err) {
            console.error("Error in createEpoch():", err);
            throw err;
        }
    }



    /**
     * Update an existing epoch record by ID.
     *
     * Always refreshes `updated_at` to the current time, overwriting
     * anything the caller may have supplied for that field.
     *
     * @async
     * @param {number|string} epochID - ID of the epoch to update.
     * @param {Object} newData - Epoch fields to update.
     * @returns {Promise<Object|null>} The updated Epoch record, or null if
     * no row matched `epochID` (logged as a warning rather than treated as
     * an error). A database failure is logged and re-thrown, so the
     * returned promise rejects rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // updateEpoch
    // ------------------------------------------------------------
    // Updates an existing epoch record by ID.
    // Parameters:
    //   epochID (int) – unique identifier for the epoch to update.
    //   newData (object) – key/value pairs of fields to update.
    // ------------------------------------------------------------
    async updateEpoch(epochID, newData) {
        try {
            newData.updated_at = new Date();

            const [rowsUpdated, [updatedEpoch]] = await this.db.epochs.update(
                newData,
                { where: { id: epochID }, returning: true }
            );

            if (rowsUpdated === 0) {
                console.warn(`[WARN] No epoch found with id=${epochID}`);
                return null;
            }

            console.log(`[DB] Updated epoch id=${epochID}`);
            return updatedEpoch;
        } catch (err) {
            console.error("Error in updateEpoch():", err);
            throw err;
        }
    }



    /**
     * Insert a new metrics_summary record for a training run and dataset
     * split.
     *
     * Defaults `created_at`/`updated_at` to the current time when not
     * supplied on the input object.
     *
     * @async
     * @param {Object} summaryData - MetricsSummary fields to insert (training_run_id, dataset_split, precision, recall, map50, map5095, f1_score, confusion_matrix_path, result_plot_path, details, timestamp, etc.).
     * @returns {Promise<Object>} The created MetricsSummary record. A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // createMetricsSummary
    // ------------------------------------------------------------
    // Inserts a new metrics summary for a training run and dataset split.
    // ------------------------------------------------------------
    async createMetricsSummary(summaryData) {
        try {
            const now = new Date();
            summaryData.created_at = summaryData.created_at || now;
            summaryData.updated_at = summaryData.updated_at || now;

            const summary = await this.db.metrics_summary.create(summaryData);
            console.log(`[DB] Created metrics_summary id=${summary.id} split=${summary.dataset_split}`);
            return summary;
        } catch (err) {
            console.error("Error in createMetricsSummary():", err);
            throw err;
        }
    }


    /**
     * Insert a single precision/recall/F1 curve point tied to a
     * metrics_summary record.
     *
     * Defaults `created_at`/`updated_at` to the current time when not
     * supplied on the input object.
     *
     * @async
     * @param {Object} curveData - MetricsCurve fields to insert (metrics_summary_id, confidence_threshold, precision, recall, f1_score, support, etc.).
     * @returns {Promise<Object>} The created MetricsCurve record. A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to an error value.
     */
    // ------------------------------------------------------------
    // createMetricsCurve
    // ------------------------------------------------------------
    // Inserts a single precision/recall/F1 curve point for a summary.
    // ------------------------------------------------------------
    async   createMetricsCurve(curveData) {
        try {
            const now = new Date();
            curveData.created_at = curveData.created_at || now;
            curveData.updated_at = curveData.updated_at || now;

            const curve = await this.db.metrics_curves.create(curveData);
            return curve;
        } catch (err) {
            console.error("Error in createMetricsCurve():", err);
            throw err;
        }
    }


    /**
     * Bulk-insert metrics_curve records.
     *
     * Unlike every other create/bulk method in this file (all of which
     * re-throw on a database failure), this method swallows the error and
     * resolves to an `{ error: string }` object instead. It also differs
     * from `bulkCreateDatasetObservations()` in its success shape: it
     * returns a summary `{ inserted: number }` object rather than the
     * created records themselves, so callers cannot inspect the inserted
     * rows from the return value alone.
     *
     * @async
     * @param {Array<Object>} records - Array of MetricsCurve fields to insert, one object per row.
     * @returns {Promise<Object>} `{ inserted: number }` on success, or
     * `{ error: string }` if the bulk insert failed. A failed insert
     * resolves rather than rejecting, so callers must check for an
     * `error` property; the `/api/metrics_curves/bulk` route in server.js
     * has no `.catch()` handler, so this is the only way a caller of that
     * route can detect a failure — the HTTP status is still 200.
     */
    // repositories/metricsCurvesRepository.js
    async bulkCreateMetricsCurves(records) {
        try {
            await this.db.metrics_curves.bulkCreate(records, { validate: true });
            return { inserted: records.length };
        } catch (err) {
            console.error("Error in bulkCreateMetricsCurves:", err);
            return { error: err.message };
        }
    }


}

module.exports = new DatasetRepository();
