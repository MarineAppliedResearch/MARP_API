/**
 * Endpoint tests for a video's clock (#76).
 *
 * Setting a video's clock rewrites the time columns of every observation in that video,
 * so what matters is checked against what is stored: the moment each one was seen, the
 * clock time moved to it, the position in the video left alone, a value something else
 * wrote left as found -- and the observations of every other video untouched.
 *
 * The clock belongs to the file, not the session, so the fixture puts one video in two
 * sessions and a second video beside it.
 *
 * Runs against the app exported by app.js via Supertest, in-process, against the real dev
 * Postgres database (see jest.config.js). Every fixture is removed afterwards.
 *
 * Refs MarineAppliedResearch/MARP_API#76.
 *
 * @fileoverview Endpoint tests for reading and setting a video's clock.
 * @author Isaac Travers
 * @module tests/video-clock
 */

const db = require('../model');
const { formatTimeSpan, deriveTc, deriveFrame } = require('../db/timecode');
const { startFromName } = require('../service/video-clock.service');

/** Distinguishes this run's fixtures in the database. @constant @type {number} */
const runId = Date.now();

/** The video under test: its name states 2021-06-14 16:40:41 UTC. */
const VIDEO = `20210614_164041_Jest${runId}.mp4`;

/** A second video, which nothing here should touch. */
const OTHER = `20210614_170000_Jest${runId}.mp4`;

const { QueryTypes } = db.Sequelize;

/**
 * Inserts an observation the way inference writes one today: no clock, so the position
 * in the video is written as the clock time too.
 *
 * @async
 * @param {Object} fields
 * @returns {Promise<number>} The observation id.
 */
async function insertObservation({ sessionId, videoSource, mediaMs, tc }) {
    const position = formatTimeSpan(mediaMs);
    const [rows] = await db.sequelize.query(
        'INSERT INTO observations '
        + '(session_id, "obsID", comname, video_source, "mediaPosition", "actualPosition", tc, frame, etc, '
        + '"createdAt", "updatedAt") '
        + 'VALUES (:sessionId, 0, :comname, :videoSource, :position, :position, :tc, :frame, :etc, now(), now()) '
        + 'RETURNING observation_id',
        {
            type: QueryTypes.INSERT,
            logging: false,
            replacements: {
                sessionId,
                comname: `Jest clock ${runId}`,
                videoSource,
                position,
                tc: tc === undefined ? deriveTc(mediaMs) : tc,
                frame: deriveFrame(mediaMs),
                etc: deriveTc(mediaMs + 2000),
            },
        },
    );
    return rows[0].observation_id;
}

/** What is stored for one observation. */
const stored = (id) => db.observations.findByPk(id, { raw: true });

describe('A video\'s clock', () => {
    const sessionIds = [];
    const ids = {};

    beforeAll(async () => {
        for (const dive of ['A', 'B']) {
            const session = await db.sessions.create({ dive: `Dive clock ${dive} ${runId}`, line: 'Jest', lineId: runId, type: 'ROV' });
            sessionIds.push(session.session_id);
        }
        // The same video in two sessions, a minute and then two hours in.
        ids.first = await insertObservation({ sessionId: sessionIds[0], videoSource: VIDEO, mediaMs: 60400 });
        ids.second = await insertObservation({ sessionId: sessionIds[1], videoSource: VIDEO, mediaMs: 7200000 });
        // A tc somebody typed, which the arithmetic does not reproduce.
        ids.handTc = await insertObservation({ sessionId: sessionIds[0], videoSource: VIDEO, mediaMs: 90000, tc: '09:09:09' });
        ids.other = await insertObservation({ sessionId: sessionIds[0], videoSource: OTHER, mediaMs: 60400 });
    }, 30000);

    afterAll(async () => {
        await db.observations.destroy({ where: { session_id: sessionIds } });
        await db.sessions.destroy({ where: { session_id: sessionIds } });
        await db.videos.destroy({ where: { video_source: [VIDEO, OTHER] } });
    });

    it('reads the start a file name states, as UTC', () => {
        expect(startFromName('20210614_164041_Fwd.mp4').toISOString()).toBe('2021-06-14T16:40:41.000Z');
        expect(startFromName('Dive07/cam2_20190102_235959.mov').toISOString()).toBe('2019-01-02T23:59:59.000Z');
    });

    it('finds no start in a name that states none, or states an impossible one', () => {
        expect(startFromName('Dive 07 forward.mp4')).toBeNull();
        expect(startFromName('20211314_164041.mp4')).toBeNull(); // month 13
        expect(startFromName('20210614_254041.mp4')).toBeNull(); // 25 o'clock
        expect(startFromName('120210614_1640411.mp4')).toBeNull(); // run into other digits
    });

    it('reports no clock for a video nobody has set, and suggests its name\'s time', async () => {
        const res = await global.api.get('/api/v2/videos/clock').query({ video_source: VIDEO });

        expect(res.status).toBe(200);
        expect(res.body.recorded_start).toBeNull();
        expect(res.body.start_source).toBeNull();
        expect(res.body.suggested_start).toBe('2021-06-14T16:40:41.000Z');
        // A suggestion is never applied on its own.
        expect((await stored(ids.first)).observed_at).toBeNull();
    });

    it('times every observation in the video, in every session', async () => {
        const res = await global.api.put('/api/v2/videos/clock')
            .send({ video_source: VIDEO, start: '2021-06-14T16:40:41Z', source: 'file-name' });

        expect(res.status).toBe(200);
        expect(res.body.recorded_start).toBe('2021-06-14T16:40:41.000Z');
        expect(res.body.start_source).toBe('file-name');
        expect(res.body.observations).toBe(3);

        const first = await stored(ids.first);
        expect(new Date(first.observed_at).toISOString()).toBe('2021-06-14T16:41:41.400Z');
        expect(first.actualPosition).toBe('16:41:41.4000000');
        expect(first.tc).toBe('16:41:41');
        expect(first.frame).toBe(String(deriveFrame(60400 + (16 * 3600 + 40 * 60 + 41) * 1000)));
        expect(first.etc).toBe('16:41:43');
        // The position in the video is what the clock is measured from; it never moves.
        expect(first.mediaPosition).toBe(formatTimeSpan(60400));

        const second = await stored(ids.second);
        expect(new Date(second.observed_at).toISOString()).toBe('2021-06-14T18:40:41.000Z');
        expect(second.tc).toBe('18:40:41');
    });

    it('leaves a value something else wrote as it found it', async () => {
        const hand = await stored(ids.handTc);
        expect(hand.tc).toBe('09:09:09');
        expect(hand.actualPosition).toBe('16:42:11.0000000');
        expect(new Date(hand.observed_at).toISOString()).toBe('2021-06-14T16:42:11.000Z');
    });

    it('leaves every other video alone', async () => {
        const other = await stored(ids.other);
        expect(other.observed_at).toBeNull();
        expect(other.actualPosition).toBe(formatTimeSpan(60400));
        expect(other.tc).toBe(deriveTc(60400));
    });

    it('takes a reading off a frame, and corrects an earlier setting', async () => {
        // The picture two hours in reads 18:40:46 -- five seconds later than the name said.
        const res = await global.api.put('/api/v2/videos/clock').send({
            video_source: VIDEO, clock: '2021-06-14T18:40:46Z', at_media_position: '02:00:00.000', source: 'synced',
        });

        expect(res.status).toBe(200);
        expect(res.body.recorded_start).toBe('2021-06-14T16:40:46.000Z');
        expect(res.body.start_source).toBe('synced');

        const first = await stored(ids.first);
        expect(new Date(first.observed_at).toISOString()).toBe('2021-06-14T16:41:46.400Z');
        expect(first.tc).toBe('16:41:46');
        expect(first.etc).toBe('16:41:48');
    });

    it('counts past midnight the way the annotation GUI does', async () => {
        await global.api.put('/api/v2/videos/clock')
            .send({ video_source: VIDEO, start: '2021-06-14T23:00:00Z', source: 'entered' })
            .expect(200);

        const second = await stored(ids.second);
        expect(new Date(second.observed_at).toISOString()).toBe('2021-06-15T01:00:00.000Z');
        expect(second.actualPosition).toBe('1.01:00:00.0000000');
        expect(second.tc).toBe('1.01:00:00');
    });

    it('gives an observation the annotation GUI creates the moment it was seen, by its video clock', async () => {
        // The clock is 23:00:00 on the 14th, from the test above.
        const res = await global.api.post('/api/v2/observation').send({ observation: {
            session_id: sessionIds[0], comname: `Jest clock ${runId}`, video_source: VIDEO,
            mediaPosition: '00:10:00.5000000', actualPosition: '23:10:00.5000000', tc: '23:10:00',
        } });
        expect(res.status).toBe(200);
        expect(new Date((await stored(res.body.observation_id)).observed_at).toISOString()).toBe('2021-06-14T23:10:00.500Z');

        // In a video with no clock there is no moment to give it.
        const unclocked = await global.api.post('/api/v2/observation').send({ observation: {
            session_id: sessionIds[0], comname: `Jest clock ${runId}`, video_source: OTHER, mediaPosition: '00:10:00.5000000',
        } });
        expect(unclocked.status).toBe(200);
        expect((await stored(unclocked.body.observation_id)).observed_at).toBeNull();
    });

    it('refuses a request it cannot act on, and writes nothing', async () => {
        const before = await stored(ids.first);

        await global.api.put('/api/v2/videos/clock').send({ start: '2021-06-14T16:40:41Z', source: 'entered' }).expect(400);
        await global.api.put('/api/v2/videos/clock').send({ video_source: VIDEO, start: '2021-06-14T16:40:41Z', source: 'guessed' }).expect(400);
        await global.api.put('/api/v2/videos/clock').send({ video_source: VIDEO, start: 'yesterday', source: 'entered' }).expect(400);
        await global.api.put('/api/v2/videos/clock').send({ video_source: VIDEO, clock: '2021-06-14T16:40:41Z', source: 'synced' }).expect(400);

        expect(await stored(ids.first)).toEqual(before);
    });
});
