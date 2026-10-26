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
     * The `metrics_summary` rows a run holds for one split and family, by class name.
     *
     * Curves hang off `metrics_summary_id`, which is NOT NULL, so a curve can only be
     * stored for a class that has a row -- which is the "only evaluated classes" rule
     * holding by construction rather than by a second check.
     *
     * @async
     * @param {Object} params
     * @param {number} params.trainingRunId - The run.
     * @param {string} params.split - The split.
     * @param {string} params.family - The metric family.
     * @param {Object} params.transaction - Transaction to read in.
     * @returns {Promise<Map<string, Object>>} Class name to `{id, species_id}`.
     */
    async findClassRows({ trainingRunId, split, family, transaction }) {
        const rows = await this.db.sequelize.query(
            `SELECT id, class_name, species_id FROM metrics_summary
              WHERE training_run_id = :trainingRunId
                AND dataset_split = :split
                AND metric_family = :family
                AND class_name IS NOT NULL`,
            {
                replacements: { trainingRunId, split, family },
                type: QueryTypes.SELECT,
                transaction,
            }
        );

        return new Map(rows.map((row) => [row.class_name, row]));
    }

    /**
     * Replace the per-threshold curves belonging to a run's split and family.
     *
     * **Inserted in batches rather than row by row, because this is the one place here
     * that is not a handful of rows.** A thousand confidence points per class is twenty
     * thousand rows for a twenty-species model, and a round trip each would turn an
     * ingest into minutes of waiting.
     *
     * @async
     * @param {Object} params
     * @param {Array<number>} params.summaryIds - The `metrics_summary` rows being replaced.
     * @param {Array<Object>} params.rows - `{metrics_summary_id, species_id,
     *   confidence_threshold, precision, recall, f1_score}`.
     * @param {Object} params.transaction - Transaction to write in.
     * @returns {Promise<number>} How many rows were written.
     */
    async replaceCurves({ summaryIds, rows, transaction }) {
        if (summaryIds.length > 0) {
            await this.db.sequelize.query(
                'DELETE FROM metrics_curves WHERE metrics_summary_id IN (:summaryIds)',
                { replacements: { summaryIds }, transaction }
            );
        }

        const now = new Date();
        const BATCH = 500;

        for (let start = 0; start < rows.length; start += BATCH) {
            const batch = rows.slice(start, start + BATCH);

            const values = batch.map((_, index) => `(:s${index}, :sp${index}, :c${index}, `
                + `:p${index}, :r${index}, :f${index}, :now, :now)`).join(', ');

            const replacements = { now };

            batch.forEach((row, index) => {
                replacements[`s${index}`] = row.metrics_summary_id;
                replacements[`sp${index}`] = row.species_id;
                replacements[`c${index}`] = row.confidence_threshold;
                replacements[`p${index}`] = row.precision;
                replacements[`r${index}`] = row.recall;
                replacements[`f${index}`] = row.f1_score;
            });

            /* `support` is left out of the insert entirely rather than written as null
               per point: it is a per-class count and repeating it down a per-threshold
               column would state something nobody measured. */
            await this.db.sequelize.query(
                `INSERT INTO metrics_curves
                     (metrics_summary_id, species_id, confidence_threshold,
                      "precision", recall, f1_score, created_at, updated_at)
                 VALUES ${values}`,
                { replacements, transaction }
            );
        }

        return rows.length;
    }

    /**
     * A run's curves for one split, as a series per class.
     *
     * Returned already grouped, because the alternative is a reader receiving twenty
     * thousand flat rows and doing the grouping itself on every draw.
     *
     * @async
     * @param {number} trainingRunId - The run.
     * @returns {Promise<Array<Object>>} Flat points, ordered by class then threshold.
     */
    async findCurves(trainingRunId) {
        return this.db.sequelize.query(
            `SELECT m.metric_family, m.dataset_split, m.class_name, c.species_id,
                    c.confidence_threshold, c."precision", c.recall, c.f1_score
               FROM metrics_curves c
               JOIN metrics_summary m ON m.id = c.metrics_summary_id
              WHERE m.training_run_id = :trainingRunId
              ORDER BY m.dataset_split, m.metric_family, m.class_name, c.confidence_threshold`,
            { replacements: { trainingRunId }, type: QueryTypes.SELECT }
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
