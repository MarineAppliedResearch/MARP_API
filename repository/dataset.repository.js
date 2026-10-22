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

const { QueryTypes } = require('sequelize');

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
     * What one dataset is actually made of: its splits, and its class vocabulary.
     *
     * **Both are recorded and neither was served.** `dataset_observations` has held a row
     * per included observation since #268 and `dataset_classes` the ordered vocabulary,
     * while the Datasets screen drew a split bar hardcoded to 70/20/10 and a class
     * breakdown keyed on the dataset's *name* against five invented ones. A bar that says
     * 70/20/10 whatever the dataset is worse than no bar.
     *
     * **The split lives in `inclusion_type`.** The column predates the build path and its
     * name is about why an observation is in a dataset; the builder writes the split name
     * into it, which is what `recordBuild` records and what `data.yaml` names.
     *
     * Counted rather than derived from `num_observations`: a dataset's membership can
     * lose rows to the observation cascade, and the honest answer to "what is in it" is
     * what is in it now, beside the count recorded when it was built.
     *
     * @async
     * @param {number|string} datasetId - The dataset.
     * @returns {Promise<{splits: Object[], classes: Object[]}>}
     * @throws {Error} Re-throws any database failure.
     */
    async getDatasetComposition(datasetId) {
        /* **Observations counted live, images read from what the build recorded**, and
           the two are deliberately different sources. `dataset_observations` is the
           record of membership and counting it is the truth about what is in the dataset
           now -- its cascade removes a row when an observation is deleted, and seeing
           that happen is worth more than a frozen number. The image count cannot be
           derived from anything here at all: one observation is a span between keyframes
           and becomes many frames, so `dataset_splits.images` is what the build wrote,
           and null there means not known rather than none.

           A `LEFT JOIN` so a split with membership and no recorded count still appears,
           which is every dataset built before `dataset_splits` existed. */
        const splits = await this.db.sequelize.query(
            `SELECT o.inclusion_type AS split,
                    count(*)::int    AS observations,
                    max(s.images)    AS images
               FROM dataset_observations o
               LEFT JOIN dataset_splits s
                      ON s.dataset_id = o.dataset_id
                     AND s.split = o.inclusion_type
              WHERE o.dataset_id = :datasetId
              GROUP BY o.inclusion_type
              ORDER BY o.inclusion_type`,
            { replacements: { datasetId }, type: QueryTypes.SELECT }
        );

        const classes = await this.db.sequelize.query(
            `SELECT c.class_index, c.species_id, s.comname
               FROM dataset_classes c
               LEFT JOIN species s ON s.id = c.species_id
              WHERE c.dataset_id = :datasetId
              ORDER BY c.class_index`,
            { replacements: { datasetId }, type: QueryTypes.SELECT }
        );

        return { splits, classes };
    }


    /**
     * Every dataset build that is still in flight, with how far it has got.
     *
     * **The progress is on the attempt, not on the job and not on the dataset.** A
     * `dataset_build` job carries `spec->>'dataset_id'`; its latest attempt carries
     * `progress_done`, `progress_total`, `progress_unit` and `progress_phase`, written
     * once per video by the runner. So the join the Datasets screen needs is
     * dataset -> job -> latest attempt, and this is it, answered for every building
     * dataset at once rather than once per row.
     *
     * **`queued` is returned as well as `leased`,** without an attempt. `datasets.status`
     * is `building` from the instant a build is queued, so the dataset alone cannot say
     * whether anything has started; the job's state can, and a row that says *Queued*
     * rather than *0 frames* is the difference between waiting and stuck.
     *
     * **And a build that failed, with the reason it failed.** That is not a contradiction
     * of "in flight": the Datasets screen draws a failed build as *Needs attention*, and
     * until this carried `failure_reason` the panel under it could only say that something
     * had gone wrong. Isaac, looking at one: *"which isn't telling me ANYTHING about why
     * it needs attention"*. The real one reads `...train/images/20240727_163021_Fwd_000
     * 29982.jpg: unable to open for write`, which is a thing somebody can act on.
     *
     * **Polling is keyed on the state, not on this answer being empty.** A failed build
     * stays failed, so a screen that polled while this returned anything would poll for
     * ever; what it watches for is a row that is `queued` or `leased`. Answering `[]` is
     * no longer what stops it.
     *
     * `DISTINCT ON (dataset_id)` because a consumer keys by dataset: a retry reuses the
     * same job, so one row per dataset is normally true anyway, and making it always true
     * saves every caller the same reduction.
     *
     * Errors reject rather than resolving to `[]`. A screen that polls this cannot tell a
     * build that finished from a query that failed, and the empty answer is the one that
     * stops the polling.
     *
     * @async
     * @returns {Promise<Array<Object>>} One row per building dataset, newest job first.
     * @throws {Error} Re-throws any database failure.
     */
    async getBuildsInFlight() {
        return this.db.sequelize.query(
            `SELECT DISTINCT ON ((j.spec->>'dataset_id')::int)
                    (j.spec->>'dataset_id')::int AS dataset_id,
                    j.id                         AS job_id,
                    j.state,
                    j.attempts_made,
                    j.max_attempts,
                    -- What claimBuild orders by, so the screen can show the queue in the
                    -- order it will be taken rather than the order the table draws.
                    j.priority,
                    j.created_at                 AS queued_at,
                    a.id                         AS attempt_id,
                    a.progress_done,
                    a.progress_total,
                    a.progress_unit,
                    a.progress_phase,
                    a.leased_at                  AS started_at,
                    a.last_heartbeat_at,
                    a.failure_reason
               FROM gpu_jobs j
               LEFT JOIN LATERAL (
                    SELECT *
                      FROM gpu_job_attempts
                     WHERE job_id = j.id
                     ORDER BY lease_epoch DESC, id DESC
                     LIMIT 1
               ) a ON TRUE
               -- The dataset must still exist. Nothing links gpu_jobs to datasets by a
               -- foreign key -- the association is spec->>'dataset_id' -- so deleting a
               -- dataset leaves its build job behind, and this went on serving it. The
               -- row that produced was for a dataset nobody could open, expand or delete.
               JOIN datasets d ON d.id = (j.spec->>'dataset_id')::int
              WHERE j.kind = 'dataset_build'
                /* cancelled belongs here with failed: the runner cancels by failing the
                   build, the dataset ends up failed either way, and a reader asking why a
                   row needs attention deserves "Cancelled while extracting" rather than
                   silence. A build that succeeded is not here -- its dataset says ready
                   and carries its own counts. */
                AND j.state IN ('queued', 'leased', 'failed', 'cancelled')
                AND j.spec->>'dataset_id' ~ '^[0-9]+$'
              ORDER BY (j.spec->>'dataset_id')::int, j.id DESC`,
            { type: QueryTypes.SELECT }
        );
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
     * Fetch a single dataset_observation record by ID.
     *
     * @async
     * @param {number|string} id - ID of the dataset_observation to fetch.
     * @returns {Promise<Object|null>} The matching DatasetObservation
     * record, or null if not found. A database failure is logged and
     * re-thrown, so the returned promise rejects rather than resolving to
     * a fallback value.
     */
    async getDatasetObservationById(id) {
        try {
            const record = await this.db.dataset_observations.findByPk(id);
            return record || null;
        } catch (err) {
            console.error(`Error in getDatasetObservationById(${id}):`, err);
            throw err;
        }
    }

    /**
     * Update an existing dataset_observation record by ID.
     *
     * @async
     * @param {number|string} id - ID of the dataset_observation to update.
     * @param {Object} newData - DatasetObservation fields to update.
     * @returns {Promise<Object|null>} The updated DatasetObservation
     * record, or null if no row matched `id`. A database failure is
     * logged and re-thrown, so the returned promise rejects rather than
     * resolving to an error value.
     */
    async updateDatasetObservation(id, newData) {
        try {
            const [rowsUpdated, [updatedRecord]] = await this.db.dataset_observations.update(
                newData,
                { where: { id }, returning: true }
            );

            if (rowsUpdated === 0) {
                return null;
            }

            return updatedRecord;
        } catch (err) {
            console.error(`Error in updateDatasetObservation(${id}):`, err);
            throw err;
        }
    }

    /**
     * Delete a dataset_observation record by ID.
     *
     * @async
     * @param {number|string} id - ID of the dataset_observation to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteDatasetObservation(id) {
        try {
            const rowsDeleted = await this.db.dataset_observations.destroy({ where: { id } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteDatasetObservation(${id}):`, err);
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
     * Every version in the chain a model belongs to, oldest first.
     *
     * `ml_models` has no versions array: a version chain is `parent_model_id`
     * and has to be walked, which is why the Models screen could not show one
     * (#104, gap 28). Walked here rather than inline on the list, so a caller
     * that only wants the registry does not pay for a self-join per row.
     *
     * Walks **up** to the root and then back **down**, so asking about any
     * member returns the whole family rather than that member's descendants --
     * a version three along is still one of the model's versions.
     *
     * A model whose chain has no root -- an orphan, or a cycle somebody managed
     * to record -- falls back to itself rather than returning nothing, because
     * an empty answer would read as "no such model".
     *
     * @async
     * @param {number|string} modelId - Any model in the chain.
     * @returns {Promise<Array<Object>>} The chain, oldest first. Empty when there is no such model.
     * @throws {Error} Re-throws any database failure.
     */
    async getModelVersions(modelId) {
        try {
            return await this.db.sequelize.query(
                `WITH RECURSIVE ancestors AS (
                        SELECT id, parent_model_id FROM ml_models WHERE id = :modelId
                         UNION
                        SELECT m.id, m.parent_model_id
                          FROM ml_models m
                          JOIN ancestors a ON a.parent_model_id = m.id
                 ),
                 root AS (
                        SELECT COALESCE(
                                   (SELECT id FROM ancestors WHERE parent_model_id IS NULL LIMIT 1),
                                   :modelId) AS id
                 ),
                 chain AS (
                        SELECT * FROM ml_models WHERE id = (SELECT id FROM root)
                         UNION
                        SELECT m.* FROM ml_models m JOIN chain c ON m.parent_model_id = c.id
                 )
                 SELECT * FROM chain ORDER BY created_at ASC, id ASC`,
                { replacements: { modelId }, type: QueryTypes.SELECT }
            );
        } catch (err) {
            console.error(`Error in getModelVersions(${modelId}):`, err);
            throw err;
        }
    }

    /**
     * The species a model can detect, by common name.
     *
     * `model_species` has held this since the schema was written and nothing
     * served it, so the Inference screen's class picker listed eight invented
     * corals and the summary beside it said "all 8 species" whatever the model
     * was. The real spread is wide -- one model here maps a single species and
     * another maps 499 -- which is exactly why the number cannot be a constant.
     *
     * **Joined to `species` rather than returning the linkage rows**, because a
     * `species_id` is not something a person can choose from. `species_list`
     * rides along because a common name identifies an organism only within its
     * list, and a model spanning two lists can otherwise offer the same label
     * twice with no way to tell them apart.
     *
     * The per-species training figures on the linkage -- `dataset_size`,
     * `precision_mean`, `recall_mean`, `f1_mean` -- come too. They are free from
     * the same row, and they are what makes a class list worth reading: a class
     * the model recalls poorly is one somebody may want to leave out of a run.
     *
     * @async
     * @param {number|string} modelId - The model.
     * @returns {Promise<Array<Object>>} The species, by common name.
     * @throws {Error} Re-throws any database failure.
     */
    async getModelSpecies(modelId) {
        try {
            return await this.db.sequelize.query(
                `SELECT s.id                AS species_id,
                        s.comname,
                        s.species,
                        s.species_list,
                        ms.dataset_size,
                        ms.balance_weight,
                        ms.precision_mean,
                        ms.recall_mean,
                        ms.f1_mean
                   FROM model_species ms
                   JOIN species s ON s.id = ms.species_id
                  WHERE ms.model_id = :modelId
                  ORDER BY s.comname ASC, s.id ASC`,
                { replacements: { modelId }, type: QueryTypes.SELECT }
            );
        } catch (err) {
            console.error(`Error in getModelSpecies(${modelId}):`, err);
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
     * Fetch a single training run record by ID.
     *
     * @async
     * @param {number|string} runID - ID of the training run to fetch.
     * @returns {Promise<Object|null>} The matching TrainingRun record, or
     * null if not found. A database failure is logged and re-thrown, so
     * the returned promise rejects rather than resolving to a fallback
     * value.
     */
    /**
     * Every training run, newest first, optionally for one model.
     *
     * `/v2/training_run` could create a run and fetch one by id, and had no way
     * to find one -- so no screen could show a training history at all (#104,
     * gap 28). This is that read.
     *
     * @async
     * @param {Object} [filters]
     * @param {number|string} [filters.modelId] - Only runs that produced this model.
     * @returns {Promise<Array<Object>>} The runs, newest first.
     * @throws {Error} Re-throws any database failure.
     */
    async getTrainingRuns(filters = {}) {
        try {
            const where = {};

            if (filters.modelId !== undefined && filters.modelId !== null) {
                where.model_id = filters.modelId;
            }

            return await this.db.training_runs.findAll({
                where,
                order: [['created_at', 'DESC'], ['id', 'DESC']],
            });
        } catch (err) {
            console.error('Error in getTrainingRuns():', err);
            throw err;
        }
    }

    async getTrainingRunById(runID) {
        try {
            const run = await this.db.training_runs.findByPk(runID);
            return run || null;
        } catch (err) {
            console.error(`Error in getTrainingRunById(${runID}):`, err);
            throw err;
        }
    }

    /**
     * Delete a training run record by ID.
     *
     * Deleting a training run cascades to delete its epochs,
     * metrics_summary, hyperparameters, and artifacts (see
     * model/training_runs.model.js).
     *
     * @async
     * @param {number|string} runID - ID of the training run to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteTrainingRun(runID) {
        try {
            const rowsDeleted = await this.db.training_runs.destroy({ where: { id: runID } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteTrainingRun(${runID}):`, err);
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
     * Fetch a single epoch record by ID.
     *
     * @async
     * @param {number|string} epochID - ID of the epoch to fetch.
     * @returns {Promise<Object|null>} The matching Epoch record, or null if
     * not found. A database failure is logged and re-thrown, so the
     * returned promise rejects rather than resolving to a fallback value.
     */
    async getEpochById(epochID) {
        try {
            const epoch = await this.db.epochs.findByPk(epochID);
            return epoch || null;
        } catch (err) {
            console.error(`Error in getEpochById(${epochID}):`, err);
            throw err;
        }
    }

    /**
     * Delete an epoch record by ID.
     *
     * @async
     * @param {number|string} epochID - ID of the epoch to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteEpoch(epochID) {
        try {
            const rowsDeleted = await this.db.epochs.destroy({ where: { id: epochID } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteEpoch(${epochID}):`, err);
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
     * Fetch a single metrics_summary record by ID.
     *
     * @async
     * @param {number|string} id - ID of the metrics_summary to fetch.
     * @returns {Promise<Object|null>} The matching MetricsSummary record,
     * or null if not found. A database failure is logged and re-thrown,
     * so the returned promise rejects rather than resolving to a fallback
     * value.
     */
    async getMetricsSummaryById(id) {
        try {
            const summary = await this.db.metrics_summary.findByPk(id);
            return summary || null;
        } catch (err) {
            console.error(`Error in getMetricsSummaryById(${id}):`, err);
            throw err;
        }
    }

    /**
     * Update an existing metrics_summary record by ID.
     *
     * @async
     * @param {number|string} id - ID of the metrics_summary to update.
     * @param {Object} newData - MetricsSummary fields to update.
     * @returns {Promise<Object|null>} The updated MetricsSummary record,
     * or null if no row matched `id`. A database failure is logged and
     * re-thrown, so the returned promise rejects rather than resolving to
     * an error value.
     */
    async updateMetricsSummary(id, newData) {
        try {
            const [rowsUpdated, [updatedSummary]] = await this.db.metrics_summary.update(
                newData,
                { where: { id }, returning: true }
            );

            if (rowsUpdated === 0) {
                return null;
            }

            return updatedSummary;
        } catch (err) {
            console.error(`Error in updateMetricsSummary(${id}):`, err);
            throw err;
        }
    }

    /**
     * Delete a metrics_summary record by ID.
     *
     * Deleting a metrics_summary cascades to delete its metrics_curves
     * (see model/metrics_summary.model.js).
     *
     * @async
     * @param {number|string} id - ID of the metrics_summary to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteMetricsSummary(id) {
        try {
            const rowsDeleted = await this.db.metrics_summary.destroy({ where: { id } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteMetricsSummary(${id}):`, err);
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
     * Fetch a single metrics_curve record by ID.
     *
     * @async
     * @param {number|string} id - ID of the metrics_curve to fetch.
     * @returns {Promise<Object|null>} The matching MetricsCurve record, or
     * null if not found. A database failure is logged and re-thrown, so
     * the returned promise rejects rather than resolving to a fallback
     * value.
     */
    async getMetricsCurveById(id) {
        try {
            const curve = await this.db.metrics_curves.findByPk(id);
            return curve || null;
        } catch (err) {
            console.error(`Error in getMetricsCurveById(${id}):`, err);
            throw err;
        }
    }

    /**
     * Update an existing metrics_curve record by ID.
     *
     * @async
     * @param {number|string} id - ID of the metrics_curve to update.
     * @param {Object} newData - MetricsCurve fields to update.
     * @returns {Promise<Object|null>} The updated MetricsCurve record, or
     * null if no row matched `id`. A database failure is logged and
     * re-thrown, so the returned promise rejects rather than resolving to
     * an error value.
     */
    async updateMetricsCurve(id, newData) {
        try {
            const [rowsUpdated, [updatedCurve]] = await this.db.metrics_curves.update(
                newData,
                { where: { id }, returning: true }
            );

            if (rowsUpdated === 0) {
                return null;
            }

            return updatedCurve;
        } catch (err) {
            console.error(`Error in updateMetricsCurve(${id}):`, err);
            throw err;
        }
    }

    /**
     * Delete a metrics_curve record by ID.
     *
     * @async
     * @param {number|string} id - ID of the metrics_curve to delete.
     * @returns {Promise<number>} The number of rows destroyed (0 or 1). A
     * database failure is logged and re-thrown, so the returned promise
     * rejects rather than resolving to a fallback value.
     */
    async deleteMetricsCurve(id) {
        try {
            const rowsDeleted = await this.db.metrics_curves.destroy({ where: { id } });
            return rowsDeleted;
        } catch (err) {
            console.error(`Error in deleteMetricsCurve(${id}):`, err);
            throw err;
        }
    }


    /**
     * Bulk-insert metrics_curve records.
     *
    * This method differs from `bulkCreateDatasetObservations()` in its
    * success shape: it
     * returns a summary `{ inserted: number }` object rather than the
     * created records themselves, so callers cannot inspect the inserted
     * rows from the return value alone.
     *
     * @async
     * @param {Array<Object>} records - Array of MetricsCurve fields to insert, one object per row.
    * @returns {Promise<Object>} `{ inserted: number }` on success.
    * Rejects on database failure so callers can use centralized API
    * error handling.
     */
    // repositories/metricsCurvesRepository.js
    async bulkCreateMetricsCurves(records) {
        try {
            await this.db.metrics_curves.bulkCreate(records, { validate: true });
            return { inserted: records.length };
        } catch (err) {
            console.error("Error in bulkCreateMetricsCurves:", err);
            throw err;
        }
    }


}

module.exports = new DatasetRepository();
