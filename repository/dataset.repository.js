const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class DatasetRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
        
    }

    
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