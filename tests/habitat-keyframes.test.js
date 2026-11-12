/**
 * An annotated habitat stretch's start and end keyframes, worked out and never written (#287).
 *
 * A20 and A22, settled with Isaac on 2026-11-12: every habitat observation has a first
 * keyframe at its start and a last at its end with the habitat crop as the box, and an
 * annotator's are derived rather than stored. These check the rule itself, that the thumbnail
 * extractor's keyframe read, the retry route, the Mosaic's grid and its video page all see
 * the two, that nothing is written to `keyframes`, and that the video page sends them as not
 * editable. The migration that queues those already failed changes rows a test did not
 * create, so it is checked by running it, not here.
 *
 * @fileoverview Tests for db/habitat-keyframes.js and where the thumbnail path uses it.
 * @module tests/habitat-keyframes
 */

const db = require('../model');
const { formatTimeSpan, deriveTc } = require('../db/timecode');
const { HABITAT_BOX, derivedKeyframes } = require('../db/habitat-keyframes');
const thumbnailRepository = require('../repository/observation-thumbnail.repository');
const extraction = require('../service/thumbnail-extraction.service');
const jellyfinRepository = require('../repository/jellyfin.repository');

const { QueryTypes } = db.Sequelize;
const q = (sql, replacements = {}) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });

const runId = Date.now();
const seeded = { projectId: null, sessionIds: [], ids: [] };

/** An observation in a session of the given type, starting `startS` into its file. */
async function stretch(sessionId, startS, endS, name = 'Mud') {
    const [row] = await q(
        `INSERT INTO observations (project_id, session_id, "obsID", comname, count, tc, etc,
                                   "actualPosition", "mediaPosition", video_source, "createdAt", "updatedAt")
         VALUES (:p, :s, :obs, :name, 1, :tc, :etc, :at, :at, :video, now(), now()) RETURNING observation_id`,
        {
            p: seeded.projectId, s: sessionId, obs: seeded.ids.length + 1, name,
            tc: deriveTc(10 * 3600000 + startS * 1000), etc: deriveTc(10 * 3600000 + endS * 1000),
            at: formatTimeSpan(startS * 1000), video: `jest-habitat-keyframes-${runId}.mp4`,
        }
    );
    seeded.ids.push(row.observation_id);
    return row.observation_id;
}

/** Fail a stretch's picture for having no keyframes, as the extractor did before. */
async function failedForNoKeyframes(id) {
    await q(
        `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, last_error,
                                             requested_at, created_at, updated_at)
         VALUES (:id, 'failed', true, 1, 1, :error, now(), now(), now())
         ON CONFLICT (observation_id) DO UPDATE SET status = 'failed', permanent = true, last_error = :error
         RETURNING observation_id`,
        { id, error: thumbnailRepository.NO_KEYFRAMES_ERROR }
    );
}

const session = async (type) => {
    const [row] = await q(
        `INSERT INTO sessions (project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:p, 'HK1', 'L1', :line, :type, now(), now()) RETURNING session_id`,
        { p: seeded.projectId, line: `LID-HK-${type}-${runId}`, type }
    );
    seeded.sessionIds.push(row.session_id);
    return row.session_id;
};

beforeAll(async () => {
    const [project] = await q(
        'INSERT INTO projects (name, "createdAt", "updatedAt") VALUES (:name, now(), now()) RETURNING project_id',
        { name: `Jest Habitat Keyframes ${runId}` }
    );
    seeded.projectId = project.project_id;
});

afterAll(async () => {
    if (seeded.ids.length) {
        await q('DELETE FROM observation_thumbnails WHERE observation_id IN (:ids) RETURNING 1', { ids: seeded.ids });
        await q('DELETE FROM observations WHERE observation_id IN (:ids) RETURNING 1', { ids: seeded.ids });
    }
    if (seeded.sessionIds.length) await q('DELETE FROM sessions WHERE session_id IN (:ids) RETURNING 1', { ids: seeded.sessionIds });
    await q('DELETE FROM projects WHERE project_id = :p RETURNING 1', { p: seeded.projectId });
});

describe('the two keyframes of an annotated habitat stretch (#287, A20 and A22)', () => {
    test('a start and an end, at 25 a second, with the habitat crop as the box', () => {
        const [start, end] = derivedKeyframes({
            observation_id: 7, comname: 'Sand', mediaPosition: '00:01:40.0000000', tc: '16:03:00', etc: '16:06:00',
        });
        expect(start).toMatchObject({ type: 'start', framenum: 2500, subset: '1', comname: 'Sand', derived: true });
        expect(end).toMatchObject({ type: 'end', framenum: 2500 + 180 * 25 });
        expect(start).toMatchObject(HABITAT_BOX);
        expect(HABITAT_BOX).toEqual({ x: 0.5, y: 0.75, width: 0.5, height: 0.5 });
    });

    test('only a start without a usable end, and nothing without a position', () => {
        expect(derivedKeyframes({ mediaPosition: '00:00:10.0000000', tc: '16:00:00', etc: null }).map((k) => k.type)).toEqual(['start']);
        expect(derivedKeyframes({ mediaPosition: null, tc: '16:00:00', etc: '16:01:00' })).toEqual([]);
    });

    test('the extractor reads them for a habitat stretch, and writes none', async () => {
        const habitat = await stretch(await session('Habitat'), 60, 90);
        const transect = await stretch(await session('transect'), 60, 90);

        const read = await thumbnailRepository.keyframesFor([habitat, transect]);
        expect(read.get(habitat).map((k) => [k.type, k.framenum])).toEqual([['start', 1500], ['end', 2250]]);
        // Another kind of session with no keyframes still has none.
        expect(read.get(transect)).toEqual([]);

        const [written] = await q('SELECT count(*)::int AS n FROM keyframes WHERE observation_id = :id', { id: habitat });
        expect(written.n).toBe(0);
    });

    test('its picture is cut at its middle, not its start, with the habitat crop', () => {
        // 100 s to 280 s: the middle is 190 s, frame 4750 at 25 a second.
        const keyframes = derivedKeyframes({ mediaPosition: '00:01:40.0000000', tc: '16:03:00', etc: '16:06:00' });
        const plan = extraction.planObservation({ mediaPosition: '00:01:40.0000000', session_type: 'Habitat' }, keyframes);
        expect(plan).toMatchObject({ ok: true, frame: 4750 });
        expect(plan.box).toMatchObject(HABITAT_BOX);

        // Anything else is still cut where it was recorded.
        expect(extraction.planObservation({ mediaPosition: '00:01:40.0000000', session_type: 'transect' }, keyframes).frame).toBe(2500);
    });

    test('frames far apart in a video are cut in passes of their own, not one long decode', () => {
        // A video's habitat stretches cover the whole of it: one pass from the first middle to
        // the last decoded minutes of streamed video and timed out.
        const wanted = [10, 20, 300, 900, 905, 2000].map((frame) => ({ plan: { frame } }));
        expect(extraction.passesOf(wanted).map((run) => run.map((e) => e.plan.frame)))
            .toEqual([[10, 20], [300], [900, 905], [2000]]);
    });

    test('a page in front of a reviewer has its pictures cut before the rest of the queue', async () => {
        const habitat = await stretch(await session('Habitat'), 500, 530);
        await q(
            `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, request_priority,
                                                 requested_at, created_at, updated_at)
             VALUES (:id, 'queued', false, 1, 0, 0, now(), now(), now()) RETURNING observation_id`,
            { id: habitat }
        );
        await thumbnailRepository.enqueueMissing([habitat]);
        const [row] = await q('SELECT status, request_priority FROM observation_thumbnails WHERE observation_id = :id', { id: habitat });
        expect(row).toMatchObject({ status: 'queued', request_priority: 1 });
    });

    test('a batch takes the other pictures waiting in the videos it opens, and none from others', async () => {
        const id = await session('Habitat');
        const [a, b] = [await stretch(id, 600, 630), await stretch(id, 700, 730)];
        const elsewhere = await stretch(id, 600, 630);
        // Videos of this test's own: earlier tests leave pictures queued in the shared one.
        const video = `jest-companions-${runId}.mp4`;
        await q('UPDATE observations SET video_source = :v WHERE observation_id IN (:ids) RETURNING 1', { v: video, ids: [a, b] });
        await q('UPDATE observations SET video_source = :v WHERE observation_id = :id RETURNING 1', { v: `jest-elsewhere-${runId}.mp4`, id: elsewhere });
        for (const obs of [b, elsewhere]) {
            await q(
                `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, request_priority,
                                                     requested_at, created_at, updated_at)
                 VALUES (:obs, 'queued', false, 1, 0, 0, now(), now(), now()) RETURNING observation_id`,
                { obs }
            );
        }
        const opened = [{ observation_id: a, video_source: video }];
        const more = await thumbnailRepository.claimCompanions(opened);
        expect(more.map((row) => row.observation_id)).toEqual([b]);
        expect(more[0]).toMatchObject({ artifact_kind: 'thumbnail', session_type: 'Habitat' });
    });

    test('retry takes a habitat stretch failed for having no keyframes', async () => {
        const habitat = await stretch(await session('Habitat'), 10, 40);
        await failedForNoKeyframes(habitat);

        const [row] = await thumbnailRepository.requeue([habitat]);
        expect(row).toMatchObject({ status: 'queued', permanent: false });
    });

    test('the grid counts its two keyframes, for the tile and the Track length sort', async () => {
        const id = await session('Habitat');
        const habitat = await stretch(id, 400, 430);
        for (const sort of [undefined, [{ field: 'keyframe_count', direction: 'desc' }]]) {
            const res = await global.api.post('/api/v2/mosaic/observations/pages').send({
                filters: { session: [id], reviewStatus: ['unreviewed', 'flagged', 'reviewed'] },
                pages: [1], pageSize: 10, ...(sort ? { sort } : {}),
            });
            expect(res.status).toBe(200);
            const row = res.body.pages[0].rows.find((r) => r.observation_id === habitat);
            expect(row.keyframe_count).toBe(2);
        }
    });

    test('a tile says when the stretch ended and what else its line recorded meanwhile', async () => {
        // Rock 0-150 s, Cobble on top 60-90 s, Sand after it 150-200 s: touching, not overlapping.
        const id = await session('Habitat');
        const rock = await stretch(id, 0, 150, 'Rock');
        const cobble = await stretch(id, 60, 90, 'Cobble');
        const sand = await stretch(id, 150, 200, 'Sand');
        const res = await global.api.post('/api/v2/mosaic/observations/pages').send({
            filters: { session: [id], reviewStatus: ['unreviewed', 'flagged', 'reviewed'] }, pages: [1], pageSize: 10,
        });
        expect(res.status).toBe(200);
        const byId = new Map(res.body.pages[0].rows.map((r) => [r.observation_id, r]));
        expect(byId.get(rock)).toMatchObject({ tc: '10:00:00', etc: '10:02:30', habitat_overlaps: ['Cobble'] });
        expect(byId.get(cobble).habitat_overlaps).toEqual(['Rock']);
        expect(byId.get(sand).habitat_overlaps).toBeNull();
    });

    test('a tile says where its picture stands, and the Picture filter keeps only those asked for', async () => {
        const id = await session('Habitat');
        const [missing, weak, other] = [await stretch(id, 0, 10), await stretch(id, 20, 30), await stretch(id, 40, 50)];
        const fail = (obs, error) => q(
            `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, last_error,
                                                 requested_at, created_at, updated_at)
             VALUES (:obs, 'failed', true, 1, 1, :error, now(), now(), now()) RETURNING observation_id`,
            { obs, error }
        );
        await fail(missing, `${thumbnailRepository.NO_VIDEO_ERRORS.noMatch} "x.mp4": nothing found.`);
        await fail(weak, `${thumbnailRepository.NO_VIDEO_ERRORS.weakMatch} "9_1.mp4" scored 85, below the 96 exact-match threshold.`);
        await fail(other, 'ffmpeg exited 1');
        const ready = await stretch(id, 60, 70);
        await q(
            `INSERT INTO observation_thumbnails (observation_id, status, permanent, generation, attempts, filename,
                                                 requested_at, completed_at, created_at, updated_at)
             VALUES (:obs, 'ready', false, 1, 1, :file, now(), now(), now(), now()) RETURNING observation_id`,
            { obs: ready, file: `jest-picture-${runId}.jpg` }
        );
        const waiting = await stretch(id, 80, 90);
        const ask = (picture) => global.api.post('/api/v2/mosaic/observations/pages').send({
            filters: { session: [id], reviewStatus: ['unreviewed', 'flagged', 'reviewed'], ...(picture ? { picture } : {}) },
            pages: [1], pageSize: 10,
        });

        const all = new Map((await ask()).body.pages[0].rows.map((r) => [r.observation_id, r.picture_state]));
        expect([missing, weak, other, ready, waiting].map((obs) => all.get(obs)))
            .toEqual(['no video', 'no video', 'no image', 'available', 'preparing']);

        const available = await ask(['available']);
        expect(available.body.pages[0].rows.map((r) => r.observation_id)).toEqual([ready]);
        expect((await ask(['nonsense'])).status).toBe(400);

        const facets = await global.api.post('/api/v2/mosaic/observations/facets')
            .send({ filters: { session: [id] }, dimensions: ['picture'] });
        expect(Object.fromEntries(facets.body.facets.picture.map((f) => [f.value, f.count])))
            .toEqual({ available: 1, preparing: 1, 'no video': 2, 'no image': 1 });
    });

    describe('on the Mosaic\'s video page', () => {
        beforeEach(() => {
            jest.spyOn(jellyfinRepository, 'resolveVideoSource').mockResolvedValue({ item: { id: `jest-item-${runId}` }, score: 100 });
            jest.spyOn(jellyfinRepository, 'getVideoFrameRate').mockResolvedValue({ averageFrameRate: 25, realFrameRate: 25 });
        });
        afterEach(() => jest.restoreAllMocks());

        test('a habitat stretch is drawn from its start to its end', async () => {
            const habitat = await stretch(await session('Habitat'), 200, 260);
            const res = await global.api.post('/api/v2/mosaic/video/observations').send({ observation_id: habitat, filters: {} });
            expect(res.status).toBe(200);
            expect(res.body.observations.find((o) => o.observation_id === habitat))
                .toMatchObject({ start_s: 200, end_s: 260, open_ended: false });
        });

        test('its two keyframes are the habitat crop, sent as worked out rather than stored', async () => {
            const habitat = await stretch(await session('Habitat'), 300, 330);
            const res = await global.api.post('/api/v2/mosaic/video/keyframes').send({ observation_ids: [habitat], from_s: 305, to_s: 310 });
            expect(res.status).toBe(200);
            expect(res.body.keyframes).toEqual([
                { keyframe_id: null, observation_id: habitat, subset: '1', type: 'start', t: 300, ...HABITAT_BOX, derived: true },
                { keyframe_id: null, observation_id: habitat, subset: '1', type: 'end', t: 330, ...HABITAT_BOX, derived: true },
            ]);
        });
    });
});
