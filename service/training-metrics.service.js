/**
 * Taking what YOLO measured about a finished run into MARP.
 *
 * **Half of this already worked and that shaped the design.** Every file an attempt
 * hands over already becomes an `artifacts` row with its sha256, size and content type,
 * through the content-addressed upload the model weights use -- `recordJobArtifacts`
 * runs for every attempt whatever the job kind, and the role it files them under is
 * validated as a non-empty string with no allow-list. So the plots needed no new
 * transport, no new event kind and no new route. What was missing was a role convention,
 * a way to read them back, and the numbers.
 *
 * This service is the numbers: one JSON artifact, published at `on_train_end` after the
 * final validation, carrying the class vocabulary once, the confusion matrix, and a
 * metrics block per family. `db/final-metrics.js` reads it; this writes what it read.
 *
 * **It never fails the attempt.** The observation ingest withdraws a success that did
 * not reach the database (#225) because observations *are* the deliverable of an
 * inference job. A training job's deliverable is the weights, which are already stored
 * and verified by hash by the time this runs. Costing somebody hours of GPU time because
 * a plot's JSON was malformed would be the wrong trade, so a failure here is recorded
 * and reported and the run stays succeeded.
 *
 * @fileoverview Ingesting a training run's end-of-run report.
 * @module service/training-metrics.service
 */

'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../model');
const logger = require('../logger/api.logger');
const { ARTIFACT_DIRECTORY } = require('../config/gpu-orchestration');
const {
    FINAL_METRICS_ROLE,
    METRICS_CURVES_ROLE,
    finalMetrics,
    metricCurves,
    isKnownFamily,
    confusionForReading,
} = require('../db/final-metrics');
const ingestRepository = require('../repository/observation-ingest.repository');
const trainingMetricsRepository = require('../repository/training-metrics.repository');

class TrainingMetricsService {
    /**
     * @param {Object} [repository] - Metrics repository.
     * @param {Object} [database] - Model registry.
     */
    constructor(repository = trainingMetricsRepository, database = db) {
        this.repository = repository;
        this.db = database;
    }

    /**
     * Read an attempt's `final_metrics` artifact into the run's record.
     *
     * **Absence is the normal case and is not an error.** A stopped run produces none of
     * this -- the trainer unwinds out of its training loop by exception, so the final
     * evaluation and the end-of-run callback never execute -- and every run that
     * finished before this feature existed has none either, permanently, because the job
     * workspace is deleted once MARP holds the result (#65). There is no backfill
     * anywhere, so a run without a report is simply a run without one.
     *
     * @async
     * @param {Object} job - The job row, with `artifacts` filtered to this attempt.
     * @returns {Promise<Object>} `{stored}` with what was written, or `{skipped}`, or
     *   `{failed}` with the reason. Never throws.
     */
    async ingestFinalMetrics(job) {
        try {
            if (!job || job.kind !== 'training') {
                return { skipped: 'not a training job' };
            }

            const artifact = (job.artifacts || []).find(
                (row) => row.artifact_type === FINAL_METRICS_ROLE
            );

            if (!artifact) {
                return { skipped: `this attempt handed over no ${FINAL_METRICS_ROLE} artifact` };
            }

            const report = this.readReport(job, artifact);

            if (report === null) {
                return { failed: `job ${job.id}'s ${FINAL_METRICS_ROLE} artifact is not readable JSON` };
            }

            const parsed = finalMetrics(report);

            /* The split names a NOT NULL column. A report that does not say which split
               it evaluated cannot be stored against one, and defaulting it would make a
               guess indistinguishable from something the worker said. */
            if (!parsed || !parsed.split) {
                return { failed: `job ${job.id}'s report does not say which split it evaluated` };
            }

            const run = await this.repository.findTrainingRunByJob(job.id);

            if (!run) {
                return { skipped: `job ${job.id} has no training run to record metrics against` };
            }

            const rows = await this.resolveClasses(parsed.rows, run);

            /* A second artifact, deliberately: the curves are about a megabyte and a
               consumer wanting only the headline numbers should not parse one to skip
               it. Absent is normal -- an older worker sends none. */
            const curvesArtifact = (job.artifacts || []).find(
                (row) => row.artifact_type === METRICS_CURVES_ROLE
            );

            const curvesReport = curvesArtifact ? this.readReport(job, curvesArtifact) : null;

            return await this.store({
                run,
                parsed,
                rows,
                curves: curvesReport === null ? null : metricCurves(curvesReport),
            });
        } catch (error) {
            const reason = error && error.message ? error.message : String(error);

            logger.error(
                `Error::final metrics ingest failed for job ${job && job.id}: ${reason}`
            );

            return { failed: reason };
        }
    }

    /**
     * What a run measured, in the shape a screen draws.
     *
     * **An empty answer is the honest one and is never a 404.** The run exists whether
     * or not it reported anything, a run still training has reported nothing yet, and a
     * run that was stopped never will. A reader draws its empty state; it does not treat
     * "nothing yet" as an error.
     *
     * **Nulls stay null.** Most of these columns are nullable and a class the validator
     * never evaluated has no row at all. Coalescing either to zero would turn "not
     * measured" into "measured as nothing", which on a quality metric reads as a model
     * that detects nothing -- a lie about the training rather than a gap in it.
     *
     * @async
     * @param {number|string} trainingRunId - The run.
     * @returns {Promise<Object>} `{metrics, confusion_matrices}`.
     */
    async readMetrics(trainingRunId) {
        const [metrics, stored] = await Promise.all([
            this.repository.findMetrics(trainingRunId),
            this.repository.findConfusionMatrices(trainingRunId),
        ]);

        return {
            metrics,
            /* Transposed here, once, on the way out. The stored array is in its
               producer's orientation and this is the only place that changes. */
            confusion_matrices: stored
                .map((row) => {
                    const read = confusionForReading({ ...row, classes: row.class_names || [] });

                    return read === null ? null : { dataset_split: row.dataset_split, ...read };
                })
                .filter((row) => row !== null),
        };
    }

    /**
     * Every file a run's attempt handed over, as a list a gallery can render.
     *
     * **An open set, deliberately.** `name` is the real filename stem the worker filed
     * the artifact under, and there is no allow-list of recognised ones: a plot type a
     * later Ultralytics adds appears under its own name rather than being dropped for
     * being unfamiliar, which is the one thing a closed set cannot do.
     *
     * `content_type` is carried so a reader knows what it is looking at -- the run
     * directory holds a CSV among the images, and a gallery that assumes everything is
     * an image draws a broken icon for it.
     *
     * @async
     * @param {number|string} trainingRunId - The run.
     * @returns {Promise<Array<Object>>} `{name, url, bytes, content_type}` per file.
     */
    async readArtifacts(trainingRunId) {
        const rows = await this.repository.findArtifacts(trainingRunId);

        return rows.map((row) => ({
            name: row.artifact_type,
            url: `/api/v2/training_run/${trainingRunId}/artifacts/${row.hash}`,
            sha256: row.hash,
            /* From the recorded byte count rather than from `size_mb`, which is a
               rounded double and would report a 1,023-byte file as 0 MB. */
            bytes: row.size_mb === null ? null : Math.round(row.size_mb * 1024 * 1024),
            content_type: row.metadata ? row.metadata.content_type || null : null,
            created_at: row.created_at,
        }));
    }

    /**
     * One of a run's files, located on disk.
     *
     * @async
     * @param {number|string} trainingRunId - The run.
     * @param {string} hash - The sha256 addressing it.
     * @returns {Promise<Object|null>} `{file, content_type, name}` or null.
     */
    async locateArtifact(trainingRunId, hash) {
        /* Lower-cased before the lookup, because a sha256 is stored lower-case and a
           reader copying one out of a JSON response should not get a 404 for its case. */
        const row = await this.repository.findArtifact(trainingRunId, String(hash).toLowerCase());

        if (!row) return null;

        const file = path.join(ARTIFACT_DIRECTORY, row.hash);

        if (!fs.existsSync(file)) return null;

        return {
            file,
            name: row.artifact_type,
            content_type: row.metadata ? row.metadata.content_type || null : null,
        };
    }

    /**
     * Take the end-of-run report from an attempt that has just published a result.
     *
     * **Only this attempt's artifacts**, for the same reason the observation ingest
     * filters them: a job finished by several volunteers in sequence accumulates one set
     * per attempt, and the newest report is the one that describes the model that was
     * actually produced.
     *
     * @async
     * @param {Object} published - What `publishResult` returned.
     * @returns {Promise<Object>} The same answer `ingestFinalMetrics` gives.
     */
    async ingestForPublishedAttempt(published) {
        if (!published || !published.job_id) {
            return { skipped: 'nothing was published' };
        }

        try {
            /* Required here rather than at the top of the file: `gpu.repository` is the
               busiest module in this repository and a top-level cycle through it would
               be a trap for whoever next reorders imports there. */
            const gpuRepository = require('../repository/gpu.repository');

            const detail = await gpuRepository.getJobDetail(published.job_id);

            if (!detail || detail.job.kind !== 'training') {
                return { skipped: 'not a training job' };
            }

            const mine = (detail.artifacts || []).filter(
                (artifact) => artifact.metadata
                    && Number(artifact.metadata.attempt_id) === Number(published.attempt_id)
            );

            return await this.ingestFinalMetrics({ ...detail.job, artifacts: mine });
        } catch (error) {
            const reason = error && error.message ? error.message : String(error);

            logger.error(
                `Error::final metrics lookup failed for job ${published.job_id}: ${reason}`
            );

            return { failed: reason };
        }
    }

    /**
     * Read and parse the report's bytes.
     *
     * @param {Object} job - The job, for the message.
     * @param {Object} artifact - The artifact row.
     * @returns {?Object} The parsed report, or null when it could not be read.
     */
    readReport(job, artifact) {
        const file = path.join(ARTIFACT_DIRECTORY, artifact.hash);

        if (!fs.existsSync(file)) {
            logger.error(
                `Error::job ${job.id}'s ${FINAL_METRICS_ROLE} artifact ${artifact.hash} `
                + 'is recorded but its bytes are not on disk'
            );

            return null;
        }

        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            return null;
        }
    }

    /**
     * Attach a species to each per-class row, where MARP can tell which one.
     *
     * **A class that does not resolve keeps its row.** The observation ingest refuses an
     * unresolvable name, and rightly: an observation with no species is not an
     * observation. A metrics row is different -- the class is a fact about the model
     * whatever MARP can match it to, the model is actively predicting it, and dropping
     * it would hide exactly the class somebody needs to see. So `class_name` is kept and
     * `species_id` stays null, which is why both columns exist.
     *
     * The lookup narrows to the model's trained species before the whole catalogue, for
     * the reason recorded in the repository's own notes: common names are not unique
     * across species lists -- `Red sea urchin` is on two -- so the unnarrowed lookup can
     * match twice with no grounds to choose. Two matches resolve to null here rather
     * than picking one.
     *
     * @async
     * **A classification run names its classes with MARP's own folder handles**, so
     * the dataset's recorded mapping is consulted before any name matching. That is
     * exact where name matching is a search, and it is the reason
     * `dataset_classes.folder` exists.
     *
     * @param {Array<Object>} rows - Rows from `db/final-metrics.js`.
     * @param {Object} run - The training run, for its model and its dataset.
     * @returns {Promise<Array<Object>>} The same rows, each with `species_id`.
     */
    async resolveClasses(rows, run) {
        const cache = new Map();

        /* Loaded once per report rather than per class: a hundred-class model would
           otherwise be a hundred round trips for one small table. */
        const folders = await this.repository.classFoldersFor(run.dataset_id);

        const resolved = [];
        const unresolved = [];

        for (const row of rows) {
            if (row.class_name === null) {
                resolved.push({ ...row, species_id: null });
                continue;
            }

            if (!cache.has(row.class_name)) {
                cache.set(row.class_name, await this.speciesFor(row.class_name, run, folders));
            }

            const speciesId = cache.get(row.class_name);

            if (speciesId === null && !unresolved.includes(row.class_name)) {
                unresolved.push(row.class_name);
            }

            resolved.push({ ...row, species_id: speciesId });
        }

        /* **Said out loud, once, with the names.** A class MARP cannot place is
           stored with its reported name and a null species, which is honest and
           invisible -- the row looks like every other row to anyone not already
           suspicious. Reported here so a mismatch between a model's vocabulary and
           MARP's catalogue is something somebody learns rather than discovers. */
        if (unresolved.length) {
            logger.info(
                `training run ${run.id}: ${unresolved.length} class name(s) could not be `
                + `resolved to a species and are stored unresolved: ${unresolved.join(', ')}`
            );
        }

        return resolved;
    }

    /**
     * The one species a class name means, or null when MARP cannot tell.
     *
     * @async
     * **Three readings, most exact first.**
     *
     * 1. **The dataset's own record of what that folder was.** A classification
     *    archive's folders are handles MARP generated, and the build wrote down what
     *    each one meant. Nothing to match and nothing to parse.
     * 2. **The species id on the front of the handle.** For a model whose dataset row
     *    is gone, or one trained elsewhere from a MARP archive. Validated against
     *    `species` rather than trusted: an id that names nothing is not a resolution,
     *    and splitting on the *first* underscore only, because a slug contains them.
     * 3. **The name, as detection class names have always resolved** -- narrowed to
     *    the model's trained species first, because common names are not unique
     *    across lists.
     *
     * Null when none of the three answers, and the caller reports it.
     *
     * @async
     * @param {string} className - The class as the model named it.
     * @param {Object} run - The training run, for its model id.
     * @param {Map<string, number>} folders - The dataset's folder mapping.
     * @returns {Promise<?number>} A species id, or null.
     */
    async speciesFor(className, run, folders) {
        if (folders && folders.has(className)) return folders.get(className);

        /* The leading integer, and only when it really is one followed by a
           separator -- a species genuinely called "2024 survey marker" must not be
           read as species 2024. */
        const prefixed = /^(\d+)_/.exec(className);

        if (prefixed) {
            const exists = await ingestRepository.findSpeciesById(Number(prefixed[1]));

            if (exists) return exists.id;
        }

        const trained = await ingestRepository.findTrainedSpeciesByName(run.model_id, className);

        if (trained.length === 1) return trained[0].id;

        // More than one even within the model's own species is not resolvable, and
        // guessing would attach a measurement to the wrong species permanently.
        if (trained.length > 1) return null;

        const all = await ingestRepository.findSpeciesByName(className);

        return all.length === 1 ? all[0].id : null;
    }

    /**
     * Translate a confusion matrix's axis labels into species names.
     *
     * **For a classification run the matrix is the only per-class output there is.** A
     * classify report carries one overall row -- top-1, top-5, fitness -- and no per-class
     * metrics at all, so the per-class resolution that `resolveClasses` does for detection
     * reaches nothing here. Run 209's matrix arrived labelled
     * `126_vermilion-rockfish … 26_kelp-greenling`: dataset folder handles, because
     * Ultralytics takes a classify vocabulary from the subfolder names and keeps no other
     * list. Untranslated, the only per-class thing MARP can show about a classification
     * model is unreadable.
     *
     * **Positional, and the length never changes.** These labels index the matrix axes, so
     * a dropped or reordered entry silently relabels every cell after it -- which is how a
     * count gets read as the wrong species. A label that will not resolve keeps the handle
     * it arrived with rather than becoming null or being removed.
     *
     * **The handle is kept beside the name, not thrown away.** It is the only way back to
     * the directory in the archive the model was trained from, and it is what the `.pt`
     * itself contains -- the same reason an observation keeps the `comname` the model
     * reported beside the `species_id` somebody may later correct.
     *
     * @async
     * @param {Array<string>} classes - The labels as reported, in axis order.
     * @param {Object} run - The training run, for its model and its dataset.
     * @returns {Promise<{names: Array<string>, handles: Array<string>, translated: number}>}
     */
    async resolveMatrixLabels(classes, run) {
        const handles = classes.map((name) => String(name));

        if (handles.length === 0) return { names: [], handles: [], translated: 0 };

        const folders = await this.repository.classFoldersFor(run.dataset_id);
        const cache = new Map();
        const names = [];
        let translated = 0;

        for (const handle of handles) {
            if (!cache.has(handle)) {
                const speciesId = await this.speciesFor(handle, run, folders);
                const species = speciesId === null || speciesId === undefined
                    ? null
                    : await ingestRepository.findSpeciesById(Number(speciesId));

                cache.set(handle, species && species.comname ? species.comname : null);
            }

            const resolved = cache.get(handle);

            // The handle itself when nothing resolved it: unreadable is better than wrong,
            // and an empty axis label would be worse than either.
            names.push(resolved === null ? handle : resolved);

            if (resolved !== null && resolved !== handle) translated += 1;
        }

        return { names, handles, translated };
    }

    /**
     * Write the rows and the matrix, in one transaction.
     *
     * @async
     * @param {Object} params
     * @param {Object} params.run - The training run.
     * @param {Object} params.parsed - What `finalMetrics` read.
     * @param {Array<Object>} params.rows - Rows with species resolved.
     * @returns {Promise<Object>} `{stored}`.
     */
    async store({ run, parsed, rows, curves }) {
        const transaction = await this.db.sequelize.transaction();

        try {
            const written = await this.repository.replaceMetrics({
                trainingRunId: run.id,
                split: parsed.split,
                rows,
                transaction,
            });

            /* A report with no matrix stores no matrix, and no existing one is deleted
               on its behalf: a run that reported numbers but not a matrix has not
               retracted a matrix it reported earlier. Nothing is ever derived to fill
               the gap -- a matrix built from per-class precision and recall is
               arithmetic dressed as a measurement. */
            if (parsed.confusion) {
                /* Translated here rather than when it is read, because the resolution
                   needs the dataset the run trained on -- and a dataset can be deleted
                   while its matrix stays. Resolved once, at the moment the answer is
                   knowable, is the same decision `resolveClasses` makes above. */
                const labels = await this.resolveMatrixLabels(parsed.confusion.classes, run);

                await this.repository.storeConfusionMatrix({
                    trainingRunId: run.id,
                    split: parsed.split,
                    confusion: { ...parsed.confusion, classes: labels.names },
                    handles: labels.translated > 0 ? labels.handles : null,
                    transaction,
                });
            }

            const curvePoints = await this.storeCurves({ run, parsed, curves, transaction });

            /* **Reported, not refused.** An unrecognised family is almost always a typo
               -- `mask` where the two sides agreed `seg` -- and it otherwise lands
               silently as a table nobody is looking for. Named here and in the log it is
               visible the first time, while a family MARP has genuinely not met yet
               (Ultralytics has `pose` and `obb`) still arrives intact. */
            const unknownFamilies = [...new Set(
                rows.map((row) => row.metric_family).filter((family) => !isKnownFamily(family))
            )];

            /* **A report that scored nothing is legitimate and still worth saying.**
               The producer omits its metrics block only when there was genuinely nothing
               to score, so this is not a refusal -- but a run that measured no class at
               all is unusual enough that it should not pass in silence, and a confusion
               matrix landing beside no metrics is exactly the shape a swallowed crash
               used to produce on the emitting side. */
            if (rows.length === 0) {
                logger.info(
                    `training run ${run.id} reported no per-class or aggregate metrics `
                    + `for split ${parsed.split}. Stored as empty, which is what a run `
                    + 'that scored nothing looks like.'
                );
            }

            if (unknownFamilies.length > 0) {
                logger.info(
                    `training run ${run.id} reported metric families MARP does not `
                    + `recognise: ${unknownFamilies.join(', ')}. Stored, but nothing is `
                    + 'built to read them -- check this is not a spelling difference.'
                );
            }

            await transaction.commit();

            return {
                stored: {
                    training_run_id: run.id,
                    split: parsed.split,
                    metrics_rows: written,
                    curve_points: curvePoints,
                    confusion_matrix: Boolean(parsed.confusion),
                    unresolved_classes: rows.filter(
                        (row) => row.class_name !== null && row.species_id === null
                    ).length,
                    unknown_families: unknownFamilies,
                },
            };
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Store the per-threshold curves, where the run sent any.
     *
     * **A curve is only stored for a class that already has a metrics row.**
     * `metrics_curves.metrics_summary_id` is NOT NULL and points at that row, so this is
     * structural rather than a rule being enforced twice: a class the validator never
     * evaluated has no row, and therefore can have no curve either.
     *
     * A curves artifact naming a split or family the report did not is ignored rather
     * than stored against the nearest one. Two artifacts from one attempt that disagree
     * about what they measured are a transport fault, and attaching curves to the wrong
     * family would be a chart confidently drawn from another measurement.
     *
     * @async
     * @param {Object} params
     * @param {Object} params.run - The training run.
     * @param {Object} params.parsed - What `finalMetrics` read.
     * @param {?Object} params.curves - What `metricCurves` read, or null.
     * @param {Object} params.transaction - Transaction to write in.
     * @returns {Promise<number>} How many points were written.
     */
    async storeCurves({ run, parsed, curves, transaction }) {
        if (!curves || curves.split !== parsed.split) return 0;

        const classRows = await this.repository.findClassRows({
            trainingRunId: run.id,
            split: curves.split,
            family: curves.family,
            transaction,
        });

        const rows = [];
        const summaryIds = [];

        for (const series of curves.byClass) {
            const classRow = classRows.get(series.class_name);

            if (!classRow) continue;

            summaryIds.push(classRow.id);

            for (const point of series.points) {
                rows.push({
                    metrics_summary_id: classRow.id,
                    species_id: classRow.species_id,
                    ...point,
                });
            }
        }

        return await this.repository.replaceCurves({ summaryIds, rows, transaction });
    }

    /**
     * A run's per-threshold curves, grouped into one series per class.
     *
     * **Its own read rather than part of `/metrics`.** This is a thousand points per
     * class and a screen showing headline numbers should not fetch a megabyte to ignore
     * it.
     *
     * @async
     * @param {number|string} trainingRunId - The run.
     * @returns {Promise<Array<Object>>} One entry per split, family and class.
     */
    async readCurves(trainingRunId) {
        const points = await this.repository.findCurves(trainingRunId);

        const series = new Map();

        for (const point of points) {
            const key = `${point.dataset_split}\u0000${point.metric_family}\u0000${point.class_name}`;

            if (!series.has(key)) {
                series.set(key, {
                    dataset_split: point.dataset_split,
                    metric_family: point.metric_family,
                    class_name: point.class_name,
                    species_id: point.species_id,
                    confidence: [],
                    precision: [],
                    recall: [],
                    f1_score: [],
                });
            }

            const entry = series.get(key);

            /* Parallel arrays rather than a thousand four-key objects per class: the
               same numbers at a fraction of the JSON, and every plotting library takes
               them in this shape anyway. */
            entry.confidence.push(point.confidence_threshold);
            entry.precision.push(point.precision);
            entry.recall.push(point.recall);
            entry.f1_score.push(point.f1_score);
        }

        return [...series.values()];
    }
}

module.exports = new TrainingMetricsService();
module.exports.TrainingMetricsService = TrainingMetricsService;
