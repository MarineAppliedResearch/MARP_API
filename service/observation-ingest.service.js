/**
 * Turning a finished GPU job's result file into observations.
 *
 * This is the one place in MARP where machine output becomes annotation, and the
 * whole point of it is that afterwards there is nothing machine-shaped left: an
 * ingested row is an `observations` row with `keyframes`, in the shape the
 * annotation GUI writes, so the mosaic reviewer and every existing report read it
 * without a translation step. What marks it as machine work is provenance --
 * `ml_model_id`, `gpu_job_id` and `confidence` -- not a different shape.
 *
 * **Four rules, and each of them is a decision that was made rather than a
 * detail.**
 *
 * 1. *The worker sends a name and MARP resolves the species.* The class index
 *    never leaves the worker: it loads the model, so it holds the model's own
 *    index-to-name mapping and writes the name. It sends no `taxserial` and no
 *    `species_id` because it knows nothing about MARP. Where a name matches more
 *    than one species row, the model's own trained-species list settles it --
 *    `model_species` is a record of what a model was trained with, and is read
 *    here in that sense and no other. **An unresolvable or ambiguous name fails
 *    the whole ingest**, because a skipped observation is a silently lost animal
 *    and a guessed species is a corrupted record.
 * 2. *The session's `type` is checked against the model, not trusted.* An inverts
 *    model writing into a `Fish` session is wrong in a way nothing downstream
 *    would ever complain about, so it is refused here.
 * 3. *The timecode columns are derived from `observation_frame`, not copied.* The
 *    worker's `mediaPosition` text is a millisecond short wherever the float
 *    arithmetic truncates -- three of six observations in job 1256's real result
 *    file -- and carries three fractional digits where the column holds .NET
 *    `TimeSpan` text with seven. Copied in, `deriveFrame` would then disagree
 *    with the worker's own `frame`, `classifyRow` would report the derived
 *    columns as unreproducible, and a timecode resync would skip exactly the rows
 *    a machine produced. Derived at 25 fps everything agrees -- and R8's check
 *    against the worker's own `tc` and `frame` is the only available signal that
 *    the video was not 25 fps.
 * 4. *Nothing is repaired on the way through.* `Fragile pink urchin`'s taxserial
 *    really is 100 where its neighbours are six digits, and a keyframe box wider
 *    than 1.0 is what the reduction produced. Both are written as they stand.
 *
 * @fileoverview Parsing a GPU job's observation artifact into the annotation record.
 * @author Isaac Travers
 * @module service/observation-ingest
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ingestRepository = require('../repository/observation-ingest.repository');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');
const { ARTIFACT_DIRECTORY, INGESTIBLE_JOB_KINDS } = require('../config/gpu-orchestration');
const { speciesListForSessionType } = require('../db/species-lists');
const {
    ASSUMED_FPS,
    formatTimeSpan,
    deriveTc,
    deriveFrame,
} = require('../db/timecode');

/**
 * The artifact role that holds reduced observations.
 *
 * @constant
 * @type {string}
 */
const OBSERVATIONS_ROLE = 'observations';

/**
 * Refuse an ingest because the data does not make sense.
 *
 * 409 rather than 400: the request was well formed and it is the recorded data
 * that cannot be reconciled, which is also what makes it worth retrying after
 * somebody fixes the species list or the session.
 *
 * @param {string} message - What could not be reconciled, and against what.
 * @returns {void}
 * @throws {ApiError} Always.
 */
function unreconcilable(message) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, message);
}

/**
 * Refuse an ingest because the request itself is wrong.
 *
 * @param {string} message - What is wrong with it.
 * @returns {void}
 * @throws {ApiError} Always.
 */
function invalid(message) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message);
}


/**
 * Application behaviour for turning a job's result into observations.
 *
 * @class ObservationIngestService
 */
class ObservationIngestService {

    /**
     * Ingest one job's observations.
     *
     * Idempotent: a job whose observations are already present is reported as
     * such and nothing is written. **Re-running inference over the same range is
     * a different job and therefore a different set of observations** -- it does
     * not replace or merge the earlier model's results, because comparing two
     * models depends on both surviving.
     *
     * @async
     * @param {Object} job - The `gpu_jobs` row, as the repository returns it.
     * @returns {Promise<Object>} What was written, and what it resolved to.
     * @throws {ApiError} 400 when the job cannot be ingested at all, 409 when its
     * result cannot be reconciled with the species catalogue or the session.
     */
    async ingestJob(job) {
        if (!job) {
            throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, 'There is no such GPU job.');
        }

        if (!INGESTIBLE_JOB_KINDS.includes(job.kind)) {
            invalid(
                `A ${job.kind} job produces no observations. Only ${INGESTIBLE_JOB_KINDS.join(' and ')} jobs do.`
            );
        }

        if (job.state !== 'succeeded') {
            invalid(
                `Job ${job.id} is ${job.state}. Observations are ingested from a job that succeeded, `
                + 'because anything else has no published result to read.'
            );
        }

        const spec = job.spec || {};
        const session = this.validateSpecSession(spec.session);

        if (!session) {
            invalid(
                `Job ${job.id} names no session in its spec, so its observations have nowhere to go. `
                + 'Add spec.session -- either {session_id} or {project_id, dive, line, type} -- and run the job again.'
            );
        }

        const mlModelId = this.validateSpecModel(spec.model);

        // The check outside the write transaction is the cheap one; the write
        // takes it again under the advisory lock, where it actually holds.
        const already = await ingestRepository.countObservationsForJob(job.id);

        if (already > 0) {
            return {
                job_id: job.id,
                ingested: false,
                already_ingested: already,
                observations: 0,
                keyframes: 0,
            };
        }

        const rows = this.readObservationArtifact(job);

        const model = await ingestRepository.getModel(mlModelId);

        if (!model) {
            unreconcilable(
                `Job ${job.id} names model ${mlModelId}, which is not in the model registry.`
            );
        }

        const sessionRow = await this.resolveSession(session, job);

        await this.checkSessionTypeAgainstModel(sessionRow, model);

        const built = [];
        const speciesByName = new Map();

        for (let index = 0; index < rows.length; index += 1) {
            built.push(
                await this.buildObservation(rows[index], index, {
                    job,
                    model,
                    sessionRow,
                    speciesByName,
                })
            );
        }

        const written = await ingestRepository.writeJobObservations({
            jobId: job.id,
            sessionId: sessionRow.session_id,
            projectId: sessionRow.project_id,
            sessionType: sessionRow.type,
            observations: built,
        });

        return {
            job_id: job.id,
            ingested: written.already_ingested === 0,
            already_ingested: written.already_ingested,
            session_id: sessionRow.session_id,
            session_created: Boolean(sessionRow.created),
            ml_model_id: model.id,
            observations: written.observations,
            keyframes: written.keyframes,
            observation_ids: written.observation_ids,
        };
    }

    /**
     * Read and parse the job's observation artifact.
     *
     * **A zero-byte file is a valid outcome**, not an error: the job ran and
     * detected nothing. One of the real result files on disk is exactly that --
     * the sha256 of nothing -- and treating it as a failure would make "found no
     * animals" indistinguishable from "broke".
     *
     * @param {Object} job - The job row, for its id in messages.
     * @returns {Array<Object>} One parsed observation per line, in file order.
     * @throws {ApiError} 409 when the artifact is missing or a line is not a
     * reduced observation.
     */
    readObservationArtifact(job) {
        const artifact = job.artifacts
            ? job.artifacts.find((row) => row.artifact_type === OBSERVATIONS_ROLE)
            : null;

        if (!artifact) {
            unreconcilable(
                `Job ${job.id} succeeded but has no ${OBSERVATIONS_ROLE} artifact, so there is nothing to read.`
            );
        }

        const file = path.join(ARTIFACT_DIRECTORY, artifact.hash);

        if (!fs.existsSync(file)) {
            unreconcilable(
                `Job ${job.id}'s ${OBSERVATIONS_ROLE} artifact ${artifact.hash} is recorded but its bytes are not on disk.`
            );
        }

        const text = fs.readFileSync(file, 'utf8');
        const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');

        return lines.map((line, index) => {
            let row;

            try {
                row = JSON.parse(line);
            } catch (error) {
                unreconcilable(
                    `Job ${job.id}'s result file is not readable: line ${index + 1} is not JSON.`
                );
            }

            // Per-frame detection dumps share this role, and a run from a
            // superseded engine produced files of `{frame, detections}` lines.
            // Refused rather than skipped: a file in the wrong shape means
            // nobody knows what was actually ingested.
            if (!row || typeof row !== 'object' || typeof row.comname !== 'string') {
                unreconcilable(
                    `Job ${job.id}'s result file line ${index + 1} is not a reduced observation: `
                    + 'it carries no comname. A per-frame detection dump cannot be ingested as observations.'
                );
            }

            return row;
        });
    }

    /**
     * Validate `spec.session`, which says where a job's observations go.
     *
     * **Exactly one form.** `{session_id}` names a session that exists;
     * `{project_id, dive, line, type}` carries enough for one to be found or
     * created. Both together is refused rather than one silently winning, the
     * same way `spec.video` refuses an item id and a url together.
     *
     * The submitter owns this. Project, dive and line are human decisions and are
     * not recoverable from a video and a frame range, so the coordinator does not
     * invent scientific groupings.
     *
     * @param {*} session - `spec.session` as submitted, or absent.
     * @returns {Object|null} The validated form, or null when there is none.
     * @throws {ApiError} 400 when it is present and malformed.
     */
    validateSpecSession(session) {
        if (session === undefined || session === null) {
            return null;
        }

        if (typeof session !== 'object' || Array.isArray(session)) {
            invalid('spec.session must be an object.');
        }

        const hasId = session.session_id !== undefined && session.session_id !== null;
        const named = ['project_id', 'dive', 'line', 'type']
            .filter((field) => session[field] !== undefined && session[field] !== null);

        if (hasId && named.length > 0) {
            invalid(
                'spec.session must carry either session_id or all of project_id, dive, line and type, '
                + `not both. It carried session_id and ${named.join(', ')}.`
            );
        }

        if (hasId) {
            if (!Number.isInteger(Number(session.session_id)) || Number(session.session_id) < 1) {
                invalid('spec.session.session_id must be a positive integer.');
            }

            return { session_id: Number(session.session_id) };
        }

        if (named.length === 0) {
            invalid(
                'spec.session must carry either session_id or all of project_id, dive, line and type.'
            );
        }

        if (named.length < 4) {
            const missing = ['project_id', 'dive', 'line', 'type'].filter((field) => !named.includes(field));

            invalid(
                'spec.session must carry all of project_id, dive, line and type when it does not name a '
                + `session_id, because a session cannot be created without them. Missing: ${missing.join(', ')}.`
            );
        }

        if (!Number.isInteger(Number(session.project_id)) || Number(session.project_id) < 1) {
            invalid('spec.session.project_id must be a positive integer.');
        }

        for (const field of ['dive', 'line', 'type']) {
            if (typeof session[field] !== 'string' || session[field].trim() === '') {
                invalid(`spec.session.${field} must be a non-empty string.`);
            }
        }

        return {
            project_id: Number(session.project_id),
            dive: session.dive.trim(),
            line: session.line.trim(),
            type: session.type.trim(),
        };
    }

    /**
     * Validate that the spec names a registered model.
     *
     * `spec.model.sha256` identifies the *weights* and is what the worker
     * verifies; it cannot identify a registry row, because `ml_models` has no
     * hash column. So the submitter names the registry row, which is also what
     * locking the model at submission means in `MARP_API#104`.
     *
     * @param {*} model - `spec.model` as submitted.
     * @returns {number} The registered model identifier.
     * @throws {ApiError} 400 when it is missing or not an integer.
     */
    validateSpecModel(model) {
        const value = model && typeof model === 'object' ? model.ml_model_id : undefined;

        if (value === undefined || value === null) {
            invalid(
                'spec.model.ml_model_id is required to ingest observations: every row records which '
                + 'model produced it, and the model\'s trained-species list is what settles a common '
                + 'name that more than one species carries.'
            );
        }

        if (!Number.isInteger(Number(value)) || Number(value) < 1) {
            invalid('spec.model.ml_model_id must be a positive integer.');
        }

        return Number(value);
    }

    /**
     * Resolve `spec.session` to a real session row.
     *
     * @async
     * @param {Object} session - The validated `spec.session`.
     * @param {Object} job - The job, for `created_by` and for messages.
     * @returns {Promise<Object>} The session row, with `created` set.
     * @throws {ApiError} 409 when a named session does not exist.
     */
    async resolveSession(session, job) {
        if (session.session_id) {
            const row = await ingestRepository.getSession(session.session_id);

            if (!row) {
                unreconcilable(
                    `Job ${job.id} names session ${session.session_id}, which does not exist.`
                );
            }

            return { ...row, created: false };
        }

        const { session: row, created } = await ingestRepository.findOrCreateSession({
            projectId: session.project_id,
            dive: session.dive,
            line: session.line,
            type: session.type,
            userId: job.created_by === undefined ? null : job.created_by,
        });

        return { ...row, created };
    }

    /**
     * Check that the session's type is one this model's species belong to.
     *
     * `sessions.type` is what the annotation GUI routes on, and an inverts
     * model's output belongs in an `Invert` session. Nothing downstream would
     * complain about a mismatch, which is exactly why it is checked here.
     *
     * A model with no `model_species` rows is not refused: the join table is
     * seeded per model and an unseeded model is unhelpful rather than wrong. Name
     * resolution then falls back to the whole catalogue and still requires a
     * single match.
     *
     * @async
     * @param {Object} sessionRow - The resolved session.
     * @param {Object} model - The registered model.
     * @returns {Promise<void>} Resolves when the two are consistent.
     * @throws {ApiError} 409 when they are not.
     */
    async checkSessionTypeAgainstModel(sessionRow, model) {
        const lists = await ingestRepository.listModelSpeciesLists(model.id);

        if (lists.length === 0) {
            return;
        }

        const sessionList = speciesListForSessionType(sessionRow.type);

        if (!sessionList) {
            unreconcilable(
                `Session ${sessionRow.session_id} has type "${sessionRow.type}", which does not say which `
                + 'species list its observations are recorded against, so it cannot be checked against '
                + `model ${model.id}.`
            );
        }

        if (!lists.includes(sessionList)) {
            unreconcilable(
                `Model ${model.id} (${model.name}) was trained on ${lists.join(', ')}, but session `
                + `${sessionRow.session_id} has type "${sessionRow.type}", which reads against `
                + `${sessionList}. An inverts model's output belongs in an inverts session.`
            );
        }
    }

    /**
     * Resolve one class name to a species row, and cache it for the run.
     *
     * The model's trained-species list first, because that is a recorded fact
     * about the model. The whole catalogue only as a fallback, for a model whose
     * join table has not been seeded. Either way **exactly one match**: two rows
     * means the name is ambiguous, and choosing between them is not this code's
     * decision to make.
     *
     * @async
     * @param {string} comname - Common name as the worker reported it.
     * @param {Object} model - The registered model.
     * @param {Map<string, Object>} cache - Per-run resolution cache.
     * @returns {Promise<Object>} The species row.
     * @throws {ApiError} 409 when the name resolves to none or to more than one.
     */
    async resolveSpecies(comname, model, cache) {
        if (cache.has(comname)) {
            return cache.get(comname);
        }

        const trained = await ingestRepository.findTrainedSpeciesByName(model.id, comname);

        if (trained.length > 1) {
            unreconcilable(
                `"${comname}" matches ${trained.length} of the species model ${model.id} was trained with `
                + `(${trained.map((row) => `${row.id}/${row.species_list}`).join(', ')}), so which species `
                + 'it means is not recorded anywhere. Nothing was ingested.'
            );
        }

        if (trained.length === 1) {
            cache.set(comname, trained[0]);
            return trained[0];
        }

        const all = await ingestRepository.findSpeciesByName(comname);

        if (all.length === 0) {
            unreconcilable(
                `"${comname}" is not a species MARP knows, and model ${model.id} was not trained with a `
                + 'species of that name either. Nothing was ingested; add the species or correct the '
                + 'model\'s class names.'
            );
        }

        if (all.length > 1) {
            unreconcilable(
                `"${comname}" matches ${all.length} species rows `
                + `(${all.map((row) => `${row.id}/${row.species_list}`).join(', ')}) and model ${model.id} `
                + 'was not trained with any of them, so nothing settles which is meant. Nothing was '
                + `ingested; seed model_species for model ${model.id}.`
            );
        }

        cache.set(comname, all[0]);

        return all[0];
    }

    /**
     * Build one observation row and its keyframes from one result line.
     *
     * @async
     * @param {Object} row - One parsed line of the worker's result file.
     * @param {number} index - Its position in the file, for messages.
     * @param {Object} context - `{job, model, sessionRow, speciesByName}`.
     * @returns {Promise<Object>} `{row, keyframes}` ready to write.
     * @throws {ApiError} 409 when the line cannot be reconciled.
     */
    async buildObservation(row, index, { job, model, sessionRow, speciesByName }) {
        const where = `line ${index + 1} of job ${job.id}'s result file`;

        if (!Number.isInteger(row.observation_frame)) {
            unreconcilable(
                `${where} has no integer observation_frame, so there is no frame to record the observation at.`
            );
        }

        const species = await this.resolveSpecies(row.comname, model, speciesByName);
        const timecodes = this.deriveTimecodes(row, where);
        const confidence = this.readConfidence(row, where);

        return {
            row: {
                user_id: job.created_by === undefined ? null : job.created_by,
                tc: timecodes.tc,
                frame: timecodes.frame,
                taxserial: species.taxserial,
                species_id: species.id,
                comname: species.comname,
                count: Number.isInteger(row.count) ? row.count : 1,
                video_source: typeof row.video_source === 'string' ? row.video_source : null,
                // Null deliberately. In the legacy pipeline this was the
                // operator's own local path to the file, which on a distributed
                // worker does not exist; the resolved stream URL is per-lease and
                // will carry an expiring token. `video_source` and
                // `jellyfin_item_id` carry the identity instead.
                videoLocation: null,
                mediaPosition: timecodes.mediaPosition,
                actualPosition: timecodes.actualPosition,
                confidence,
                ml_model_id: model.id,
                jellyfin_item_id: typeof row.jellyfin_item_id === 'string' ? row.jellyfin_item_id : null,
            },
            keyframes: this.buildKeyframes(row, species, where),
        };
    }

    /**
     * Derive the four timecode columns from the worker's `observation_frame`.
     *
     * Derived rather than copied, and then checked against what the worker itself
     * reported. See rule 3 in this module's header for why copying is wrong, and
     * R8 for why the check is the only signal that the 25 fps assumption broke.
     *
     * @param {Object} row - One parsed result line.
     * @param {string} where - Where it came from, for messages.
     * @returns {Object} `{tc, frame, mediaPosition, actualPosition}`.
     * @throws {ApiError} 409 when the derivation disagrees with the worker.
     */
    deriveTimecodes(row, where) {
        const milliseconds = (row.observation_frame * 1000) / ASSUMED_FPS;
        const position = formatTimeSpan(milliseconds);
        const tc = deriveTc(milliseconds);
        const frame = deriveFrame(milliseconds);

        if (typeof row.tc === 'string' && row.tc !== tc) {
            unreconcilable(
                `${where} reports tc "${row.tc}" at frame ${row.observation_frame}, but ${ASSUMED_FPS} fps `
                + `puts that frame at "${tc}". MARP assumes ${ASSUMED_FPS} fps in every timecode column, `
                + 'so a disagreement means the video is not 25 fps and its observations cannot be stored '
                + 'correctly. Nothing was ingested.'
            );
        }

        if (row.frame !== undefined && row.frame !== null && String(row.frame) !== frame) {
            unreconcilable(
                `${where} reports frame "${row.frame}" at absolute frame ${row.observation_frame}, but `
                + `${ASSUMED_FPS} fps makes the sub-second index "${frame}". Nothing was ingested.`
            );
        }

        return {
            tc,
            frame,
            // Both, and equal. The annotation GUI distinguishes them when a
            // recording's media clock and its real clock have been synced apart;
            // nothing has shifted a machine-written row, so they start equal.
            mediaPosition: position,
            actualPosition: position,
        };
    }

    /**
     * Read the detection score at the observation frame.
     *
     * **Part of the observation contract**: the key is present on every row the
     * worker writes, and its value may be null -- ByteTrack predicts through
     * gaps, so a track can exist on a frame with no detection behind it. A
     * *missing* key is a contract violation and is refused, because the
     * alternative is a column that quietly fills with nulls nobody chose.
     *
     * @param {Object} row - One parsed result line.
     * @param {string} where - Where it came from, for messages.
     * @returns {number|null} The score, or null.
     * @throws {ApiError} 409 when the key is absent or out of range.
     */
    readConfidence(row, where) {
        if (!Object.prototype.hasOwnProperty.call(row, 'confidence')) {
            unreconcilable(
                `${where} carries no confidence key. The detection score at the observation frame is part `
                + 'of the observation contract: it may be null where the tracker predicted through a gap, '
                + 'but it is always present. Nothing was ingested.'
            );
        }

        if (row.confidence === null) {
            return null;
        }

        if (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence)
            || row.confidence < 0 || row.confidence > 1) {
            unreconcilable(
                `${where} reports confidence ${JSON.stringify(row.confidence)}, which is not a score `
                + 'between zero and one. Nothing was ingested.'
            );
        }

        return row.confidence;
    }

    /**
     * Build one observation's keyframe rows.
     *
     * `comname` is taken from the resolved species rather than from the keyframe,
     * so that an observation and its keyframes cannot disagree about what was
     * seen -- which is the same invariant `observation.repository.js#updateObservation`
     * maintains when a species correction propagates. Geometry is passed through
     * untouched.
     *
     * @param {Object} row - One parsed result line.
     * @param {Object} species - The resolved species row.
     * @param {string} where - Where the line came from, for messages.
     * @returns {Array<Object>} Keyframe rows.
     * @throws {ApiError} 409 when a keyframe is not usable.
     */
    buildKeyframes(row, species, where) {
        const keyframes = Array.isArray(row.keyframes) ? row.keyframes : [];

        return keyframes.map((keyframe, index) => {
            const at = `keyframe ${index + 1} of ${where}`;

            if (!keyframe || typeof keyframe !== 'object') {
                unreconcilable(`${at} is not an object.`);
            }

            if (!Number.isInteger(keyframe.framenum)) {
                unreconcilable(`${at} has no integer framenum.`);
            }

            if (typeof keyframe.type !== 'string' || keyframe.type.trim() === '') {
                unreconcilable(`${at} has no type; it should be start, middle or end.`);
            }

            for (const field of ['x', 'y', 'width', 'height']) {
                if (typeof keyframe[field] !== 'number' || !Number.isFinite(keyframe[field])) {
                    unreconcilable(`${at} has no numeric ${field}.`);
                }
            }

            return {
                // The subset the worker sent, defaulted to the "1" every
                // reduction in the live script writes.
                subset: keyframe.subset === undefined || keyframe.subset === null
                    ? '1'
                    : String(keyframe.subset),
                comname: species.comname,
                type: keyframe.type,
                framenum: keyframe.framenum,
                x: keyframe.x,
                y: keyframe.y,
                width: keyframe.width,
                height: keyframe.height,
                confidence: typeof keyframe.confidence === 'number' ? keyframe.confidence : null,
            };
        });
    }
}

module.exports = new ObservationIngestService();
