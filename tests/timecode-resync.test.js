/**
 * Endpoint tests for correcting a session's timing.
 *
 * Two operations behind one gesture, and which one applies is decided from the data
 * rather than asked of the caller:
 *
 * - a session with no recorded clock gets one, and its pointers stay put
 * - a session that has one gets its frame pointers moved, and its times stay put
 *
 * Getting that decision wrong is expensive in a way a unit test cannot show: an
 * earlier build treated an unsynced session as a pointer problem and shifted every
 * media position in it by 18 hours. So this builds both kinds of session from
 * scratch, exercises both paths and every refusal, and checks the columns that were
 * supposed to stay still actually did.
 *
 * Runs against the app exported by app.js via Supertest, in-process, against the real
 * dev Postgres database (see jest.config.js). Every fixture is removed afterwards.
 *
 * Refs MarineAppliedResearch/VIDEO_PROCESSING_GUI#213.
 *
 * @fileoverview Endpoint tests for timecode sync and frame-pointer corrections.
 * @author Isaac Travers
 * @module tests/timecode-resync
 */

const db = require('../model');
const {
    formatTimeSpan, deriveTc, deriveFrame, absoluteFrame,
} = require('../db/timecode');

/** Distinguishes this run's fixtures in the database. @constant @type {number} */
const runId = Date.now();

/**
 * Builds a disposable session with three observations, each carrying one keyframe.
 *
 * `synced` decides which kind it is: with an offset, the session has a recorded
 * clock; without one, media position and real-world time are written from the same
 * value, which is what an unsynced session looks like.
 *
 * @async
 * @param {Object} options
 * @param {boolean} options.synced - Whether to give the session a real-world offset.
 * @param {string} options.label - Goes in the observation names.
 * @returns {Promise<Object>} `{sessionId, observations}` where each observation
 * carries `{observationId, keyframeId, mediaPosition, actualPosition, tc, frame, framenum}`.
 */
async function buildSession({ synced, label }) {
    // Created straight through the models rather than the endpoints. What is under
    // test is the correction, and going through POST /observation would make the test
    // depend on which fields that endpoint happens to accept -- which is how the
    // first version of this suite ended up asserting against rows that did not hold
    // the values it thought.
    const session = await db.sessions.create({
        dive: `Dive ${label}`,
        line: 'Jest',
        lineId: runId,
        type: 'ROV',
    });

    const sessionId = session.session_id;

    // Media positions at exact frame boundaries, so the arithmetic in the assertions
    // is unambiguous. Milliseconds, to keep the fixture readable.
    const mediaPositions = [60000, 70320, 151000];

    // 20 hours when synced; nothing when not, which is what an unsynced session
    // looks like -- the media time written as the real-world time too.
    const offsetMs = synced ? 72000000 : 0;

    const observations = [];
    const { QueryTypes } = db.Sequelize;

    for (let index = 0; index < mediaPositions.length; index += 1) {
        const mediaMs = mediaPositions[index];
        const actualMs = mediaMs + offsetMs;

        const mediaPosition = formatTimeSpan(mediaMs);
        const actualPosition = formatTimeSpan(actualMs);
        const tc = deriveTc(actualMs);
        const frame = deriveFrame(actualMs);
        const framenum = absoluteFrame(mediaMs);

        // Inserted with SQL rather than Model.create: the models declare
        // observation_id and keyframe_id as primary keys without autoIncrement, so
        // Sequelize sends an explicit null and the insert fails. Letting the database
        // assign them is both correct and closer to what the API does.
        const [observationRows] = await db.sequelize.query(
            'INSERT INTO observations '
            + '(session_id, "obsID", comname, "mediaPosition", "actualPosition", tc, frame, '
            + '"createdAt", "updatedAt") '
            + 'VALUES (:sessionId, :obsID, :comname, :mediaPosition, :actualPosition, :tc, :frame, '
            + 'now(), now()) RETURNING observation_id',
            {
                type: QueryTypes.INSERT,
                logging: false,
                replacements: {
                    sessionId,
                    obsID: index,
                    comname: `Jest ${label} ${index}`,
                    mediaPosition,
                    actualPosition,
                    tc,
                    frame,
                },
            },
        );

        const observationId = observationRows[0].observation_id;

        const [keyframeRows] = await db.sequelize.query(
            'INSERT INTO keyframes '
            + '(observation_id, subset, comname, type, framenum, x, y, width, height, '
            + '"createdAt", "updatedAt") '
            + "VALUES (:observationId, '0', :comname, :type, :framenum, 0.1, 0.1, 0.2, 0.2, "
            + 'now(), now()) RETURNING keyframe_id',
            {
                type: QueryTypes.INSERT,
                logging: false,
                replacements: {
                    observationId,
                    comname: `Jest ${label} ${index}`,
                    type: index === 0 ? 'start' : 'middle',
                    framenum,
                },
            },
        );

        observations.push({
            observationId,
            keyframeId: keyframeRows[0].keyframe_id,
            mediaPosition,
            actualPosition,
            tc,
            frame,
            framenum,
        });
    }

    return { sessionId, observations };
}

/**
 * Reads an observation and its keyframe straight from the database, so an assertion
 * is against what is stored rather than what an endpoint chose to return.
 *
 * @async
 * @param {number} observationId - Observation to read.
 * @returns {Promise<Object>} The observation, with `framenum` from its keyframe.
 */
async function readStored(observationId) {
    const observation = await db.observations.findByPk(observationId, { raw: true });
    const keyframe = await db.keyframes.findOne({
        where: { observation_id: observationId },
        raw: true,
    });

    return Object.assign({}, observation, {
        framenum: keyframe ? Number(keyframe.framenum) : null,
    });
}

/**
 * Removes a fixture session and everything under it.
 *
 * @async
 * @param {Object} fixture - As returned by {@link buildSession}.
 * @returns {Promise<void>}
 */
async function destroySession(fixture) {
    if (!fixture) return;

    for (const observation of fixture.observations) {
        await db.keyframes.destroy({ where: { observation_id: observation.observationId } });
        await db.observations.destroy({ where: { observation_id: observation.observationId } });
    }

    await db.sessions.destroy({ where: { session_id: fixture.sessionId } });
}

describe('Correcting a session that already has a sync', () => {

    /** @type {Object} */
    let fixture;

    beforeAll(async () => {
        fixture = await buildSession({ synced: true, label: `synced-${runId}` });
    }, 30000);

    afterAll(async () => {
        await destroySession(fixture);
    });

    it('reads a clock reading as a frame-pointer correction', async () => {
        // The picture reads 3 frames earlier than the session thinks, which is the
        // signature of a pointer captured before the displayed frame was reported
        // accurately.
        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync/preview`)
            .send({
                atMediaPosition: '00:01:10.3200000',
                pictureClockTime: '20:01:10.2000000',
            });

        expect(res.status).toBe(200);
        expect(res.body.mode).toBe('correct-pointer');
        expect(res.body.frames).toBe(3);
        expect(res.body.timesUnchanged).toBe(true);
        expect(res.body.observationsToCorrect).toBe(3);
        expect(res.body.keyframesToCorrect).toBe(3);
    });

    it('writes nothing when previewing', async () => {
        const before = await readStored(fixture.observations[1].observationId);

        await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync/preview`)
            .send({ frames: 3 });

        const after = await readStored(fixture.observations[1].observationId);

        expect(after.mediaPosition).toBe(before.mediaPosition);
        expect(after.framenum).toBe(before.framenum);
    }, 60000);

    it('moves the pointers and every keyframe, and leaves the times alone', async () => {
        const target = fixture.observations[1];
        const before = await readStored(target.observationId);

        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync`)
            .send({ frames: 3, note: 'jest' });

        expect(res.status).toBe(200);
        expect(res.body.applied).toBe(true);
        expect(res.body.mode).toBe('correct-pointer');

        const after = await readStored(target.observationId);

        // 3 frames at 25 fps is 120 ms.
        expect(after.mediaPosition).toBe('00:01:10.4400000');
        expect(after.framenum).toBe(before.framenum + 3);

        // The part that matters: the recorded science did not move.
        expect(after.actualPosition).toBe(before.actualPosition);
        expect(after.tc).toBe(before.tc);
        expect(after.etc).toBe(before.etc);
        expect(after.frame).toBe(before.frame);
    }, 60000);

    it('is reversed exactly by the opposite shift', async () => {
        const target = fixture.observations[1];

        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync`)
            .send({ frames: -3, note: 'jest undo' });

        expect(res.status).toBe(200);

        const after = await readStored(target.observationId);

        expect(after.mediaPosition).toBe(target.mediaPosition);
        expect(after.framenum).toBe(target.framenum);
    }, 60000);

    /**
     * The refusal that matters most. A synced session whose recorded time is hours
     * from the picture is neither a pointer error nor a missing sync, and guessing
     * either way rewrites a session wrongly.
     */
    it('refuses a reading that is nothing like a pointer error', async () => {
        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync`)
            .send({
                atMediaPosition: '00:01:10.3200000',
                pictureClockTime: '18:08:07.6800000',
            });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/handful of frames/);
    });

    it('refuses a frame count beyond what a pointer can be out by', async () => {
        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync`)
            .send({ frames: 500 });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/beyond what a frame pointer/);
    });

    it('refuses a reading it cannot parse', async () => {
        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync/preview`)
            .send({ atMediaPosition: '00:01:10.3200000', pictureClockTime: 'half past four' });

        expect(res.status).toBe(400);
    });
});

describe('Correcting a session that was never synced', () => {

    /** @type {Object} */
    let fixture;

    beforeAll(async () => {
        fixture = await buildSession({ synced: false, label: `unsynced-${runId}` });
    }, 30000);

    afterAll(async () => {
        await destroySession(fixture);
    });

    /**
     * The case that destroyed a real session. An unsynced session records the media
     * time as its real-world time, so a reading differs from it by however far into
     * the clip you are -- 18 hours, in the real case. Read as a pointer correction
     * that shifts every media position into nonsense; read as a sync being
     * established it is exactly right.
     */
    it('reads a clock reading as establishing the sync, not moving pointers', async () => {
        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync/preview`)
            .send({
                atMediaPosition: '00:01:10.3200000',
                pictureClockTime: '18:08:07.6800000',
            });

        expect(res.status).toBe(200);
        expect(res.body.mode).toBe('establish-sync');
        expect(res.body.pointersUnchanged).toBe(true);
        expect(res.body.timesUnchanged).toBe(false);
        expect(res.body.keyframesToCorrect).toBe(0);

        // Hours, and legitimately so.
        expect(Math.abs(res.body.shiftMs)).toBeGreaterThan(3600000);
    });

    it('writes the times and leaves media positions and keyframes untouched', async () => {
        const target = fixture.observations[1];
        const before = await readStored(target.observationId);

        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync`)
            .send({
                atMediaPosition: '00:01:10.3200000',
                pictureClockTime: '18:08:07.6800000',
                note: 'jest establish',
            });

        expect(res.status).toBe(200);
        expect(res.body.mode).toBe('establish-sync');

        const after = await readStored(target.observationId);

        // The frame the reading was taken on now reads what the picture said.
        expect(after.actualPosition).toBe('18:08:07.6800000');
        expect(after.tc).toBe('18:08:07');

        // And nothing about where it sits in the video changed.
        expect(after.mediaPosition).toBe(before.mediaPosition);
        expect(after.framenum).toBe(before.framenum);
    }, 60000);

    it('then treats the same session as synced', async () => {
        const res = await global.api
            .post(`/api/v2/sessions/${fixture.sessionId}/resync/preview`)
            .send({ frames: 2 });

        expect(res.status).toBe(200);
        expect(res.body.mode).toBe('correct-pointer');
        expect(res.body.timesUnchanged).toBe(true);
    });
});

describe('Timecode correction request handling', () => {

    it('refuses a request that describes no correction at all', async () => {
        const session = await db.sessions.create({
            dive: 'Dive empty', line: 'Jest', lineId: runId, type: 'ROV',
        });
        const sessionId = session.session_id;

        const res = await global.api
            .post(`/api/v2/sessions/${sessionId}/resync/preview`)
            .send({});

        expect(res.status).toBe(400);

        await db.sessions.destroy({ where: { session_id: sessionId } });
    });

    it('refuses an anonymous caller', async () => {
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app)
            .post('/api/v2/sessions/1/resync/preview')
            .send({ frames: 3 });

        expect(res.status).toBe(401);
    });
});
