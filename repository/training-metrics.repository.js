/**
 * Storage for what a training run measured when it finished.
 *
 * **A separate file from `gpu.repository.js` on purpose.** Several agents work in this
 * repository at once and that file is the busiest in it; everything here is additive and
 * touches no query already in use, so keeping it apart means this work cannot conflict
 * with somebody else's in a file neither of us owns.
 *
 * Two tables: `metrics_summary`, which has existed since the legacy desktop script and
 * has never held a row, and `training_run_confusion_matrices`, which is new because an
 * N-by-N measurement has no shape in the first.
 *
 * @fileoverview Reading and writing a training run's final metrics.
 * @module repository/training-metrics.repository
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

/**
 * The columns a metrics row carries, in the order the insert names them.
 *
 * @constant
 * @type {string[]}
 */
const METRIC_COLUMNS = [
    'precision', 'recall', 'map50', 'map5095', 'f1_score', 'fitness',
];

class TrainingMetricsRepository {
    /**
     * @param {Object} [database] - Model registry; the shared one by default.
     */
    constructor(database = db) {
        this.db = database;
    }

    /**
     * The training run a job produced, if it has one.
     *
     * `training_runs.job_id` has existed since `20261020120000`, which is what makes an
     * artifact recorded against a job reachable from its run without a second column.
     *
     * @async
     * @param {number} jobId - The GPU job.
     * @param {Object} [transaction] - Transaction to read in.
     * @returns {Promise<Object|null>} `{id, model_id}` or null.
     */
    async findTrainingRunByJob(jobId, transaction) {
        const [row] = await this.db.sequelize.query(
            'SELECT id, model_id FROM training_runs WHERE job_id = :jobId ORDER BY id LIMIT 1',
            { replacements: { jobId }, type: QueryTypes.SELECT, transaction }
        );

        return row || null;
    }

    /**
     * Replace a run's metrics rows for one split with the ones just reported.
     *
     * **Replaced rather than appended, because a re-reported result is the same
     * measurement arriving twice.** The artifact hand-off is idempotent on its hash and
     * this has to be idempotent for the same reason: an attempt that reports a result,
     * fails to be acknowledged and reports again would otherwise double every class.
     *
     * Deleting only this run's own rows for this split, which are rows this ingest
     * wrote. Nothing else in MARP writes `metrics_summary` at all.
     *
     * @async
     * @param {Object} params
     * @param {number} params.trainingRunId - The run.
     * @param {string} params.split - Which split these measure.
     * @param {Array<Object>} params.rows - Rows from `db/final-metrics.js`, each already
     *   carrying `metric_family`, `class_name` and the metric columns, plus a resolved
     *   `species_id` or null.
     * @param {Object} params.transaction - Transaction to write in.
     * @returns {Promise<number>} How many rows were written.
     */
    async replaceMetrics({ trainingRunId, split, rows, transaction }) {
        await this.db.sequelize.query(
            `DELETE FROM metrics_summary
              WHERE training_run_id = :trainingRunId AND dataset_split = :split`,
            { replacements: { trainingRunId, split }, transaction }
        );

        const now = new Date();

        for (const row of rows) {
            await this.db.sequelize.query(
                `INSERT INTO metrics_summary
                     (training_run_id, species_id, dataset_split, metric_family, class_name,
                      "precision", recall, map50, map5095, f1_score, fitness,
                      "timestamp", created_at, updated_at)
                 VALUES
                     (:trainingRunId, :speciesId, :split, :family, :className,
                      :precision, :recall, :map50, :map5095, :f1Score, :fitness,
                      :now, :now, :now)`,
                {
                    replacements: {
                        trainingRunId,
                        split,
                        speciesId: row.species_id === undefined ? null : row.species_id,
                        family: row.metric_family,
                        className: row.class_name,
                        /* Every metric column is written explicitly, including the ones
                           that are null. A column left out of the insert would take the
                           table's default, and "not measured" has to stay null rather
                           than becoming a number nobody measured. */
                        ...Object.fromEntries(METRIC_COLUMNS.map((column) => [
                            column === 'f1_score' ? 'f1Score' : column,
                            row[column] === undefined ? null : row[column],
                        ])),
                        now,
                    },
                    transaction,
                }
            );
        }

        return rows.length;
    }

    /**
     * Store a run's confusion matrix for one split, replacing any already there.
     *
     * Stored in the orientation its producer named, never rotated on the way in. See
     * `db/final-metrics.js` for why that matters.
     *
     * @async
     * @param {Object} params
     * @param {number} params.trainingRunId - The run.
     * @param {string} params.split - Which split it measures.
     * @param {Object} params.confusion - `{orientation, background_index, matrix}`.
     * @param {string[]} params.classes - The class vocabulary in index order.
     * @param {Object} params.transaction - Transaction to write in.
     * @returns {Promise<void>} Nothing.
     */
    async storeConfusionMatrix({ trainingRunId, split, confusion, classes, transaction }) {
        const now = new Date();

        await this.db.sequelize.query(
            `INSERT INTO training_run_confusion_matrices
                 (training_run_id, dataset_split, orientation, class_names,
                  background_index, matrix, created_at, updated_at)
             VALUES
                 (:trainingRunId, :split, :orientation, :classNames,
                  :backgroundIndex, :matrix, :now, :now)
             ON CONFLICT (training_run_id, dataset_split) DO UPDATE SET
                 orientation      = EXCLUDED.orientation,
                 class_names      = EXCLUDED.class_names,
                 background_index = EXCLUDED.background_index,
                 matrix           = EXCLUDED.matrix,
                 updated_at       = EXCLUDED.updated_at`,
            {
                replacements: {
                    trainingRunId,
                    split,
                    orientation: confusion.orientation,
                    classNames: JSON.stringify(classes),
                    backgroundIndex: confusion.background_index,
                    matrix: JSON.stringify(confusion.matrix),
                    now,
                },
                transaction,
            }
        );
    }

    /**
     * Every metrics row a run holds, with the species name where one resolved.
     *
     * Ordered so a reader gets the all-classes row first within each family and the
     * per-class rows alphabetically after it -- the aggregate is a different quantity
     * from the classes and reads wrongly buried among them.
     *
     * @async
     * @param {number} trainingRunId - The run.
     * @returns {Promise<Array<Object>>} The rows, nulls intact.
     */
    async findMetrics(trainingRunId) {
        return this.db.sequelize.query(
            `SELECT m.id, m.metric_family, m.class_name, m.species_id, s.comname AS species_name,
                    m.dataset_split, m."precision", m.recall, m.map50, m.map5095,
                    m.f1_score, m.fitness
               FROM metrics_summary m
               LEFT JOIN species s ON s.id = m.species_id
              WHERE m.training_run_id = :trainingRunId
              ORDER BY m.dataset_split, m.metric_family,
                       (m.class_name IS NOT NULL), m.class_name, m.id`,
            { replacements: { trainingRunId }, type: QueryTypes.SELECT }
        );
    }

    /**
     * Every confusion matrix a run holds, as stored.
     *
     * @async
     * @param {number} trainingRunId - The run.
     * @returns {Promise<Array<Object>>} The rows, in the producer's orientation.
     */
    async findConfusionMatrices(trainingRunId) {
        return this.db.sequelize.query(
            `SELECT dataset_split, orientation, class_names, background_index, matrix
               FROM training_run_confusion_matrices
              WHERE training_run_id = :trainingRunId
              ORDER BY dataset_split`,
            { replacements: { trainingRunId }, type: QueryTypes.SELECT }
        );
    }

    /**
     * Every file a run's job handed over.
     *
     * **Reached through the job rather than through `artifacts.training_run_id`**, which
     * the hand-off leaves null: `recordJobArtifacts` knows the job and not the run. The
     * join exists, so this needs no backfill and no second write.
     *
     * @async
     * @param {number} trainingRunId - The run.
     * @returns {Promise<Array<Object>>} Artifact rows.
     */
    async findArtifacts(trainingRunId) {
        return this.db.sequelize.query(
            `SELECT a.id, a.artifact_type, a.hash, a.size_mb, a.metadata, a.created_at
               FROM artifacts a
               JOIN training_runs r ON r.job_id = a.job_id
              WHERE r.id = :trainingRunId
              ORDER BY a.artifact_type, a.id`,
            { replacements: { trainingRunId }, type: QueryTypes.SELECT }
        );
    }

    /**
     * One of a run's artifacts, by the hash that addresses it.
     *
     * Scoped to the run rather than looked up by hash alone, so a caller cannot read any
     * artifact in MARP by guessing a digest off an unrelated record.
     *
     * @async
     * @param {number} trainingRunId - The run.
     * @param {string} hash - The sha256.
     * @returns {Promise<Object|null>} The artifact row, or null.
     */
    async findArtifact(trainingRunId, hash) {
        const [row] = await this.db.sequelize.query(
            `SELECT a.id, a.artifact_type, a.hash, a.size_mb, a.metadata
               FROM artifacts a
               JOIN training_runs r ON r.job_id = a.job_id
              WHERE r.id = :trainingRunId AND a.hash = :hash
              LIMIT 1`,
            { replacements: { trainingRunId, hash }, type: QueryTypes.SELECT }
        );

        return row || null;
    }
}

module.exports = new TrainingMetricsRepository();
module.exports.TrainingMetricsRepository = TrainingMetricsRepository;
