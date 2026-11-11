/**
 * A habitat run's stretches become a habitat session's observations (#287).
 *
 * Settled with Isaac on 2026-11-10: the API writes them, as the ordinary endpoints write an
 * annotator's habitat stretch -- substrate, `tc` and `etc`, positions, video, confidence --
 * with a start and an end keyframe on the model's crop so the Mosaic can make a picture, and
 * on the video's clock where it is set (#76).
 *
 * The ingest is called directly with a job row and its artifact, as the publish path calls it.
 * Everything is seeded here and removed afterwards, as `tests/setup/corpus-guard.js` requires.
 *
 * @fileoverview Tests for ingesting a habitat run.
 * @module tests/habitat-ingest
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('../model');
const { ARTIFACT_DIRECTORY, HABITAT_ENGINE } = require('../config/gpu-orchestration');
const ingestService = require('../service/observation-ingest.service');
const habitatRules = require('../db/habitat-rules');

const runId = Date.now();
const { QueryTypes } = db.Sequelize;
const q = (sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });

const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];
const CLOCKED = `20240730_171520_JestHabitat${runId}.mp4`;
const UNCLOCKED = `JestHabitatNoClock${runId}.mp4`;

const seeded = { projectId: null, sessionIds: [], modelId: null, jobIds: [], files: [] };

/** One stretch, as the worker writes it. */
const stretch = (substrate, startMs, endMs, video, extra = {}) => ({
    substrate, start_ms: startMs, end_ms: endMs,
    start_frame: Math.round(startMs * 25 / 1000), end_frame: Math.round(endMs * 25 / 1000) - 1,
    confidence: 0.83, video_source: video, jellyfin_item_id: null, ...extra,
});

/** A finished habitat job, its stretches stored as its artifact, as the ingest reads it. */
async function habitatJob(sessionId, stretches) {
    const text = stretches.map((s) => JSON.stringify(s)).join('\n') + '\n';
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIRECTORY, hash), text);
    seeded.files.push(path.join(ARTIFACT_DIRECTORY, hash));

    const spec = {
        engine: HABITAT_ENGINE,
        model: { name: 'jest-habitat', ml_model_id: seeded.modelId },
        session: { session_id: sessionId },
        reduction: { name: 'habitat_stretches', version: '1' },
    };
    const [job] = await q(
        "INSERT INTO gpu_jobs (kind, spec, state) VALUES ('inference', CAST(:spec AS jsonb), 'succeeded') RETURNING id, kind, spec, state",
        { spec: JSON.stringify(spec) }
    );
    seeded.jobIds.push(job.id);
    await q(
        `INSERT INTO artifacts (job_id, artifact_type, path, hash, created_at, updated_at)
         VALUES (:job, 'habitat_stretches', :hash, :hash, now(), now()) RETURNING id`,
        { job: job.id, hash }
    );
    return { ...job, artifacts: [{ artifact_type: 'habitat_stretches', hash }] };
}

const stored = (jobId) => q(
    `SELECT o.observation_id, o.comname, s.species_list, o.tc, o.etc, o."mediaPosition", o."actualPosition",
            o.observed_at, o.confidence, o.video_source, o.ml_model_id, o.gpu_job_id
       FROM observations o JOIN species s ON s.id = o.species_id
      WHERE o.gpu_job_id = :jobId ORDER BY o."mediaPosition", o.comname`,
    { jobId }
);
const keyframesOf = (observationId) => q(
    'SELECT type, framenum, x, y, width, height FROM keyframes WHERE observation_id = :observationId ORDER BY framenum',
    { observationId }
);

beforeAll(async () => {
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, now(), now()) RETURNING project_id',
        { name: `Jest Habitat Ingest ${runId}` }
    );
    seeded.projectId = project.project_id;
    for (const line of ['A', 'B']) {
        const [session] = await q(
            `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:p, :dive, :line, :line, 'Habitat', now(), now()) RETURNING session_id`,
            { p: seeded.projectId, dive: `JEST-HABITAT-${runId}`, line: `${line}-${runId}` }
        );
        seeded.sessionIds.push(session.session_id);
    }

    const rules = habitatRules.rulesForModel({
        substrates: SUBSTRATES,
        cut_offs: { Rock: 0.45, Mud: 0.5, Sand: 0.4, Cobble: 0.35, Boulder: 0.3 },
        crop: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1.0 },
        input_size: 518,
    }, SUBSTRATES);
    const [model] = await q(
        `INSERT INTO ml_models (name, model_type, status, decision_rules, created_at, updated_at)
         VALUES (:name, 'habitat', 'active', CAST(:rules AS jsonb), now(), now()) RETURNING id`,
        { name: `jest-habitat-ingest-${runId}`, rules: JSON.stringify(rules) }
    );
    seeded.modelId = model.id;
    await q(
        `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
         SELECT :m, id, now(), now() FROM species WHERE species_list = 'Habitat' AND comname IN (:names) RETURNING model_id`,
        { m: model.id, names: SUBSTRATES }
    );

    // The clocked video started recording at 17:15:20 UTC on 30 July 2024.
    await q(
        `INSERT INTO videos (video_source, recorded_start, start_source, created_at, updated_at)
         VALUES (:v, '2024-07-30T17:15:20Z', 'entered', now(), now()) RETURNING id`,
        { v: CLOCKED }
    );
});

afterAll(async () => {
    const ids = seeded.jobIds.length ? seeded.jobIds : [0];
    await q('DELETE FROM keyframes WHERE observation_id IN (SELECT observation_id FROM observations WHERE gpu_job_id IN (:ids)) RETURNING 1', { ids });
    await q('DELETE FROM observations WHERE gpu_job_id IN (:ids) RETURNING 1', { ids });
    await q('DELETE FROM artifacts WHERE job_id IN (:ids) RETURNING 1', { ids });
    await q('DELETE FROM gpu_jobs WHERE id IN (:ids) RETURNING 1', { ids });
    await q('DELETE FROM videos WHERE video_source = :v RETURNING 1', { v: CLOCKED });
    await q('DELETE FROM model_species WHERE model_id = :m RETURNING 1', { m: seeded.modelId });
    await q('DELETE FROM ml_models WHERE id = :m RETURNING 1', { m: seeded.modelId });
    await q('DELETE FROM sessions WHERE session_id IN (:ids) RETURNING 1', { ids: seeded.sessionIds });
    await q('DELETE FROM projects WHERE project_id = :p RETURNING 1', { p: seeded.projectId });
    for (const file of seeded.files) fs.rmSync(file, { force: true });
});

describe('ingesting a habitat run (#287)', () => {
    test('writes each stretch as a habitat observation on the video\'s clock, with an end time', async () => {
        const job = await habitatJob(seeded.sessionIds[0], [
            stretch('Sand', 60000, 95500, CLOCKED),
            stretch('Boulder', 70000, 74000, CLOCKED),
        ]);

        const result = await ingestService.ingestJob(job);
        expect(result.observations).toBe(2);
        expect(result.keyframes).toBe(4);

        const [sand, boulder] = await stored(job.id);
        expect(sand).toMatchObject({
            comname: 'Sand', species_list: 'Habitat', video_source: CLOCKED, ml_model_id: seeded.modelId,
            // A minute in, the recording having started at 17:15:20: seen at 17:16:20 for 35.5 s.
            mediaPosition: '00:01:00.0000000', actualPosition: '17:16:20.0000000', tc: '17:16:20', etc: '17:16:55',
        });
        expect(Number(sand.confidence)).toBeCloseTo(0.83);
        expect(new Date(sand.observed_at).toISOString()).toBe('2024-07-30T17:16:20.000Z');
        expect(boulder).toMatchObject({ comname: 'Boulder', tc: '17:16:30', etc: '17:16:34' });
    });

    test('gives each a start and an end keyframe on the model\'s crop', async () => {
        const job = await habitatJob(seeded.sessionIds[0], [stretch('Rock', 10000, 20000, CLOCKED)]);
        await ingestService.ingestJob(job);

        const [rock] = await stored(job.id);
        const keyframes = await keyframesOf(rock.observation_id);
        expect(keyframes.map((k) => [k.type, Number(k.framenum)])).toEqual([['start', 250], ['end', 499]]);
        for (const k of keyframes) {
            expect([Number(k.x), Number(k.y), Number(k.width), Number(k.height)]).toEqual([0.5, 0.75, 0.5, 0.5]);
        }
    });

    test('keeps position times, and no moment, where the video has no clock', async () => {
        const job = await habitatJob(seeded.sessionIds[1], [stretch('Mud', 125000, 140000, UNCLOCKED)]);
        await ingestService.ingestJob(job);

        const [mud] = await stored(job.id);
        expect(mud).toMatchObject({ comname: 'Mud', tc: '00:02:05', etc: '00:02:20', actualPosition: '00:02:05.0000000' });
        expect(mud.observed_at).toBeNull();
    });

    test('refuses a file that is not stretches, and writes nothing', async () => {
        const job = await habitatJob(seeded.sessionIds[1], [{ comname: 'Sand', observation_frame: 12 }]);
        await expect(ingestService.ingestJob(job)).rejects.toThrow(/not a stretch/);
        expect(await stored(job.id)).toEqual([]);
    });
});
