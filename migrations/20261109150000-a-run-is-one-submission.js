'use strict';

/**
 * A run is one submission (#336).
 *
 * Scientific data is read per run for each dive (Isaac, 2026-11-09). The ML Dashboard
 * submits a dive as one request per video, and each request became a run of its own
 * (`gpu_jobs.batch_id`, or the job itself for a single piece), so Dive 119's three videos
 * were three runs with the same name, model and second. Decided: **a run is the whole
 * submission for a dive**, one entry covering all its videos.
 *
 * `submission_id` records it. New submissions carry it from the start: the dashboard sends
 * one id for every request of a click, per dive and model, and a request that sends none
 * gets its own. Jobs already queued are **grouped**, since nothing recorded which requests
 * were one click: runs share a submission when they have the same kind, name, model,
 * submitter and dive, and each was created within ten seconds of the one before -- which is
 * what a dashboard click produces, one request after another a few milliseconds apart. Not
 * "the same second": Dive01_20261030's three requests went at 10:20:37.913, .963 and
 * 38.013, and a second boundary cut that click in two.
 *
 * Adds a nullable column and fills it, and changes nothing else. `down` drops it: the
 * grouping is derived from columns that stay, so nothing is lost.
 *
 * @fileoverview Migration adding gpu_jobs.submission_id.
 * @module migrations/a-run-is-one-submission
 */

/* One row per run as it was -- a batch, or a job on its own -- with what groups runs into a
   submission. The dive is read through the session the job was given, where it has one. */
const BACKFILL = `
WITH runs AS (
    SELECT coalesce(j.batch_id::text, 'job-' || j.id) AS run,
           min(j.kind) AS kind,
           coalesce(min(j.name), '') AS name,
           coalesce(min(j.spec->'model'->>'ml_model_id'), min(j.spec->'model'->>'name'), '') AS model,
           coalesce(min(j.created_by), -1) AS submitter,
           coalesce(min(s.dive), min(made.dive), '') AS dive,
           min(j.created_at) AS at
      FROM gpu_jobs j
      LEFT JOIN sessions s
             ON s.session_id = CASE WHEN j.spec->'session'->>'session_id' ~ '^[0-9]+$'
                                    THEN (j.spec->'session'->>'session_id')::int END
      -- A job whose request named no session takes its dive from what it made: without it, a
      -- script that queued 257 videos across 16 dives back to back chained into one run.
      LEFT JOIN LATERAL (
            SELECT ms.dive FROM observations o JOIN sessions ms ON ms.session_id = o.session_id
             WHERE o.gpu_job_id = j.id LIMIT 1) made ON true
     GROUP BY 1
),
-- A new click wherever more than ten seconds separate a run from the alike one before it.
starts AS (
    SELECT *,
           CASE WHEN at - lag(at) OVER alike <= interval '10 seconds' THEN 0 ELSE 1 END AS starts
      FROM runs
    WINDOW alike AS (PARTITION BY kind, name, model, submitter, dive ORDER BY at)
),
clicks AS (
    SELECT *, sum(starts) OVER (PARTITION BY kind, name, model, submitter, dive ORDER BY at, run) AS click
      FROM starts
),
submissions AS (
    SELECT kind, name, model, submitter, dive, click, gen_random_uuid() AS submission_id
      FROM (SELECT DISTINCT kind, name, model, submitter, dive, click FROM clicks) grouped
),
assigned AS (
    SELECT c.run, s.submission_id
      FROM clicks c
      JOIN submissions s USING (kind, name, model, submitter, dive, click)
)
UPDATE gpu_jobs j
   SET submission_id = a.submission_id
  FROM assigned a
 WHERE a.run = coalesce(j.batch_id::text, 'job-' || j.id)`;

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.addColumn('gpu_jobs', 'submission_id', {
                type: Sequelize.UUID,
                allowNull: true,
                comment: 'The submission this job came from (#336): every video of one dive submitted together, for one model.',
            }, { transaction });
            await queryInterface.addIndex('gpu_jobs', ['submission_id'], {
                name: 'gpu_jobs_submission_id_idx', transaction,
            });
            await queryInterface.sequelize.query(BACKFILL, { transaction });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.removeIndex('gpu_jobs', 'gpu_jobs_submission_id_idx', { transaction });
            await queryInterface.removeColumn('gpu_jobs', 'submission_id', { transaction });
        });
    },
};
