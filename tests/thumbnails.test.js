/**
 * Tests for the observation thumbnail record, its routes and its control
 * surface (#118).
 *
 * Phase 6 of #68. Three tiers, and which one a requirement lands in is the
 * decision that matters:
 *
 * - **`http+db`** — Supertest through the real Express app against the real
 *   development PostgreSQL, through `tests/setup/authenticated-agent.js` where a
 *   full-permission caller is wanted and through a purpose-built narrow agent
 *   where the question is *who may call*. Rows are seeded **committed**, because
 *   an HTTP request cannot see an uncommitted one.
 * - **`db`** — straight against `observation_thumbnails`, for the constraints and
 *   the queue mechanics. The check constraints, the cascade and the claim lease
 *   are only true of a real PostgreSQL, and no unit test can see any of them.
 * - **`unit`** — the parts of the extractor that decide something without
 *   touching Jellyfin: the frame-rate refusal and the per-observation plan. Both
 *   are conditions that **cannot fire on the footage MARP holds** — it is 25.000
 *   fps and every observation has keyframes — so a test is the only evidence they
 *   work at all.
 *
 * **Extraction itself is not exercised here and that is deliberate.** Opening a
 * real Jellyfin stream belongs in the `media` group, which CI excludes by name;
 * `scripts/thumbnail-spike.js` is the manual tool that does it and produces
 * pictures a human looks at. What is asserted here is everything either side of
 * the decode.
 *
 * The geometry — the part most likely to be silently wrong — is
 * `tests/thumbnail-geometry.test.js`, which needs no database at all.
 *
 * Every question is scoped to this run's own seeded rows. The database is shared
 * and holds rows this suite did not create, so an unscoped assertion about a
 * count would pass or fail on what somebody else left behind -- which is why the
 * queue-priority test leases every other claimable row before asserting what the
 * next claim sees.
 *
 * Refs #118.
 *
 * @fileoverview Record, route and control-surface tests for observation thumbnails.
 * @author Isaac Travers
 * @module tests/thumbnails
 */

const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../app');
const db = require('../model');

const thumbnailRepository = require('../repository/observation-thumbnail.repository');
const extraction = require('../service/thumbnail-extraction.service');
const { STORAGE_DIR, MAX_CONCURRENT_STREAMS } = require('../config/thumbnails');

const { QueryTypes } = db.Sequelize;

/** Where the routes actually answer. They are declared without the prefix. */
const STATUS = '/api/v2/observations/thumbnails/status';
const CONTROL = '/api/v2/observations/thumbnails/control';
const RETRY = '/api/v2/observations/thumbnails/retry';
const bytesFor = (id) => `/api/v2/observations/${id}/thumbnail`;

/** The path a route is *declared* at. Nothing should answer here. */
const DECLARED_STATUS = '/api/observations/thumbnails/status';

/** The mosaic page route. It must stay a **pure read** (A3, reversed). */
const PAGES = '/api/v2/mosaic/observations/pages';

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/** Everything seeded, so `afterAll` removes exactly it. */
const seeded = {
    projectId: null,
    sessionId: null,
    observationIds: [],
    userIds: [],
    files: [],
};

/**
 * Runs one statement and returns its rows.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Named replacements.
 * @returns {Promise<Array<Object>>} The rows.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Inserts observations and records them for cleanup.
 *
 * SQL rather than `db.observations.create`, because the model declares the key
 * without `autoIncrement` and Sequelize sends an explicit null (#62).
 *
 * @param {number} count - How many.
 * @param {Object} [options] - `{ videoSource, mediaPosition }`.
 * @returns {Promise<Array<number>>} The new ids, ascending.
 */
async function addObservations(count, options = {}) {
    const rows = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, tc,
              video_source, "mediaPosition", "createdAt", "updatedAt")
         SELECT :sessionId, :projectId, 970000 + g, 0.5, :comname, '10:00:00',
                :videoSource, :mediaPosition, NOW(), NOW()
           FROM generate_series(1, :count) AS g
         RETURNING observation_id`,
        {
            sessionId: seeded.sessionId,
            projectId: seeded.projectId,
            comname: `Jest Thumbnail ${runId}`,
            videoSource: options.videoSource || `jest-thumbnail-${runId}.mp4`,
            mediaPosition: options.mediaPosition || '00:12:00.0000000',
            count,
        }
    );

    const ids = rows.map((row) => row.observation_id).sort((a, b) => a - b);

    seeded.observationIds.push(...ids);

    return ids;
}

/**
 * Writes a thumbnail row in a chosen state, and optionally a real file.
 *
 * @param {number} observationId - Which observation.
 * @param {Object} state - `{ status, permanent, filename, generation, lastError }`.
 * @returns {Promise<Object>} The row.
 */
async function setThumbnail(observationId, state) {
    const [row] = await q(
        `INSERT INTO observation_thumbnails
             (observation_id, status, permanent, filename, content_type, generation,
              attempts, last_error, requested_at, completed_at, created_at, updated_at)
         VALUES (:observationId, :status, :permanent, :filename, 'image/jpeg', :generation,
                 0, :lastError, NOW(), NOW(), NOW(), NOW())
         ON CONFLICT (observation_id) DO UPDATE
            SET status = EXCLUDED.status,
                permanent = EXCLUDED.permanent,
                filename = EXCLUDED.filename,
                generation = EXCLUDED.generation,
                last_error = EXCLUDED.last_error,
                attempts = 0,
                claimed_at = NULL,
                updated_at = NOW()
         RETURNING observation_id, status, permanent, filename, generation`,
        {
            observationId,
            status: state.status,
            permanent: state.permanent === undefined ? false : state.permanent,
            filename: state.filename === undefined ? null : state.filename,
            generation: state.generation === undefined ? 1 : state.generation,
            lastError: state.lastError === undefined ? null : state.lastError,
        }
    );

    return row;
}

/**
 * Writes a real JPEG under the storage directory, and records it for cleanup.
 *
 * A genuine 2x2 JPEG rather than a text file: the serving route sends the file
 * and a test that asserted only "a response came back" would pass for an empty
 * placeholder.
 *
 * @param {string} filename - Relative to the storage directory.
 * @returns {Promise<void>}
 */
async function writeStoredFile(filename) {
    const sharp = require('sharp');

    const buffer = await sharp({
        create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 90, b: 60 } },
    }).jpeg().toBuffer();

    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STORAGE_DIR, filename), buffer);

    seeded.files.push(filename);
}

/**
 * Creates an active user holding exactly the named permissions, and logs it in.
 *
 * The global fixture agent holds every permission, which is right for testing
 * what a route does and useless for testing who may call it -- and R26's whole
 * point is that reading the status and changing the run state are different
 * permissions.
 *
 * @param {string} label - Distinguishes the fixture.
 * @param {Array<string>} permissionKeys - Permissions to grant. May be empty.
 * @returns {Promise<Object>} A logged-in Supertest agent.
 */
async function agentWith(label, permissionKeys) {
    const username = `jest-thumb-${label}-${runId}`;
    const password = `pw-${label}-${runId}`;

    const user = await db.users.create({ name: username, username, status: 'active' });

    seeded.userIds.push(user.user_id);

    await db.auth_identities.create({
        user_id: user.user_id,
        provider: 'local',
        provider_subject: null,
        password_hash: await argon2.hash(password),
    });

    for (const key of permissionKeys) {
        const permission = await db.permissions.findOne({ where: { key } });

        await db.user_permissions.create({
            user_id: user.user_id,
            permission_id: permission.permission_id,
            granted_by_user_id: null,
        });
    }

    const agent = request.agent(app);
    const login = await agent.post('/api/v2/auth/login').send({ username, password });

    if (login.status !== 200) {
        throw new Error(`Fixture login failed for ${username}: ${JSON.stringify(login.body)}`);
    }

    agent.userId = user.user_id;

    return agent;
}

describe('observation thumbnails (#118)', () => {

    /** A reader holding `observations:read` and nothing else. @type {Object} */
    let reader;

    beforeAll(async () => {
        const [project] = await q(
            `INSERT INTO projects (name, "createdAt", "updatedAt")
             VALUES (:name, NOW(), NOW()) RETURNING project_id`,
            { name: `Jest Thumbnail Project ${runId}` }
        );

        seeded.projectId = project.project_id;

        // user_id is left NULL rather than hard-coded to 1. The column is
        // nullable and nothing here reads it, while `sessions.user_id` has a
        // foreign key to `users` -- so naming a row this suite did not create
        // makes it depend on whichever user the bootstrap migration happened to
        // make first. That is the borrowed-row defect that passes locally and
        // fails on an empty database.
        const [session] = await q(
            `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
             VALUES (:projectId, NULL, :dive, 'L1', 'LID1', 'JestThumb', NOW(), NOW())
             RETURNING session_id`,
            { projectId: seeded.projectId, dive: `JEST-THUMB-${runId}` }
        );

        seeded.sessionId = session.session_id;

        reader = await agentWith('reader', ['observations:read']);
    });

    afterAll(async () => {
        // The thumbnail rows go with the observations by cascade, which is
        // itself asserted below.
        if (seeded.observationIds.length) {
            await db.sequelize.query(
                'DELETE FROM observations WHERE observation_id IN (:ids)',
                { replacements: { ids: seeded.observationIds } }
            );
        }

        if (seeded.sessionId) {
            await db.sequelize.query(
                'DELETE FROM sessions WHERE session_id = :id',
                { replacements: { id: seeded.sessionId } }
            );
        }

        if (seeded.projectId) {
            await db.sequelize.query(
                'DELETE FROM projects WHERE project_id = :id',
                { replacements: { id: seeded.projectId } }
            );
        }

        for (const userId of seeded.userIds) {
            await db.sequelize.query(
                'DELETE FROM user_permissions WHERE user_id = :id',
                { replacements: { id: userId } }
            );
            await db.sequelize.query(
                'DELETE FROM auth_identities WHERE user_id = :id',
                { replacements: { id: userId } }
            );
            await db.sequelize.query(
                'DELETE FROM users WHERE user_id = :id',
                { replacements: { id: userId } }
            );
        }

        for (const filename of seeded.files) {
            fs.rmSync(path.join(STORAGE_DIR, filename), { force: true });
        }

        // Leave the service running, whatever a control test did to it. A paused
        // extractor outliving this suite would silently stop the workspace's own
        // thumbnails arriving.
        await thumbnailRepository.writeRunState('running', null, null);
    });

    describe('the record (R1, R2, R3, R4)', () => {

        it('is a table of its own, and writing it does not touch the observation', async () => {
            // R1: the two findings that decide this. `observations."updatedAt"`
            // is a mosaic sort field, so a thumbnail write onto that row would
            // reorder the mosaic under a reviewer; `observations.version` is the
            // commit routes' concurrency token, so a write near it would make
            // every commit conflict because a picture arrived.
            const [a] = await addObservations(1);

            const [before] = await q(
                'SELECT version, "updatedAt" FROM observations WHERE observation_id = :a',
                { a }
            );

            await setThumbnail(a, { status: 'ready', filename: `${a}-x.jpg` });

            const [after] = await q(
                'SELECT version, "updatedAt" FROM observations WHERE observation_id = :a',
                { a }
            );

            expect(after.version).toBe(before.version);
            expect(new Date(after.updatedAt).getTime()).toBe(new Date(before.updatedAt).getTime());
        });

        it('holds at most one row per observation', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });

            await expect(q(
                `INSERT INTO observation_thumbnails (observation_id, status, created_at, updated_at)
                 VALUES (:a, 'queued', NOW(), NOW())`,
                { a }
            )).rejects.toThrow();
        });

        it('refuses a status outside queued, ready and failed', async () => {
            // R3: the vocabulary is spelled out in the migration's own CHECK
            // rather than read from a config module, so a change in one without
            // the other is a database error rather than silence.
            const [a] = await addObservations(1);

            await expect(q(
                `INSERT INTO observation_thumbnails (observation_id, status, created_at, updated_at)
                 VALUES (:a, 'preparing', NOW(), NOW())`,
                { a }
            )).rejects.toThrow(/observation_thumbnails_status_check/);
        });

        it('refuses to call a queued row permanent', async () => {
            // A queued row that claims it can never be made would never drain and
            // never be retried: a tile stuck at PREPARING with nothing saying why.
            const [a] = await addObservations(1);

            await expect(q(
                `INSERT INTO observation_thumbnails (observation_id, status, permanent, created_at, updated_at)
                 VALUES (:a, 'queued', true, NOW(), NOW())`,
                { a }
            )).rejects.toThrow(/observation_thumbnails_permanent_check/);
        });

        it('goes with the observation when it is deleted', async () => {
            // R2. Delete Mode is a real permanent delete, so the row must go
            // rather than orphan the way subset_observations was found to.
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-cascade.jpg` });

            await db.sequelize.query(
                'DELETE FROM observations WHERE observation_id = :a',
                { replacements: { a } }
            );

            const rows = await q(
                'SELECT observation_id FROM observation_thumbnails WHERE observation_id = :a',
                { a }
            );

            expect(rows).toEqual([]);
        });

        it('pre-creates nothing: an observation with no record has none', async () => {
            // R4. The absence of a row is a state in its own right -- nothing has
            // ever been asked for -- and no row is created for the ~440,000
            // existing observations.
            const [a] = await addObservations(1);

            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();
        });
    });

    describe('serving a page enqueues nothing (A3, reversed; R11)', () => {

        // A3 was answered the other way on 2026-09-09 -- a page fetch enqueued
        // what it was missing and absence reported `queued` -- and the human
        // reversed it on 2026-09-10: *"one of our key criteria is that the user
        // never has to wait. So trying to load the page should not be the thing
        // that makes the back end work. When the observation is created, it
        // should get enqueued."*
        //
        // These were rewritten rather than deleted, and the first one is the
        // point: it is what stops the side effect being reinstated by accident.

        it('creates no thumbnail record, however many times a page is served', async () => {
            const [a, b] = await addObservations(2);

            for (let i = 0; i < 3; i += 1) {
                const res = await global.api.post(PAGES).send({
                    filters: { session: [seeded.sessionId] },
                    pageSize: 45,
                    pages: [1],
                });

                expect(res.status).toBe(200);
            }

            // Asked of the table, not of the response: the response could report
            // anything, and the question here is whether a read wrote.
            const rows = await q(
                `SELECT observation_id FROM observation_thumbnails
                  WHERE observation_id IN (:a, :b)`,
                { a, b }
            );

            expect(rows).toEqual([]);
        });

        it('reports failed for an observation that has no record', async () => {
            // `failed` rather than `queued`, because nothing is coming: the row
            // predates enqueue-on-create and only #121's sweeper or the
            // reviewer's *Ask again* will ever make it a picture. `queued` would
            // be a promise the API does not keep.
            const [a] = await addObservations(1);

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                pageSize: 45,
                pages: [1],
            });

            expect(res.status).toBe(200);

            const row = res.body.pages[0].rows.find((r) => r.observation_id === a);

            expect(row.thumbnail_status).toBe('failed');
        });

        it('reports the real status once one exists', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-real.jpg` });

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                pageSize: 45,
                pages: [1],
            });

            const row = res.body.pages[0].rows.find((r) => r.observation_id === a);

            expect(row.thumbnail_status).toBe('ready');
        });

        it('leaves a permanent failure exactly as it found it', async () => {
            // Permanence is still what protects the media server, but the button
            // it protects it from is now *Ask again* rather than paging. A page
            // serve must not touch the row at all.
            const [a] = await addObservations(1);

            await setThumbnail(a, {
                status: 'failed',
                permanent: true,
                lastError: 'The observation has no keyframes.',
            });

            const before = await thumbnailRepository.findByObservationId(a);

            for (let i = 0; i < 3; i += 1) {
                await global.api.post(PAGES).send({
                    filters: { session: [seeded.sessionId] },
                    pageSize: 45,
                    pages: [1],
                });
            }

            const record = await thumbnailRepository.findByObservationId(a);

            expect(record.status).toBe('failed');
            expect(record.permanent).toBe(true);
            expect(record.attempts).toBe(before.attempts);
        });
    });

    describe('serving the bytes (R13)', () => {

        it('answers 404 when nothing has ever asked for a picture', async () => {
            const [a] = await addObservations(1);

            const res = await reader.get(bytesFor(a));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
            expect(res.body.error.message).toMatch(/no thumbnail record/);
        });

        it('answers 404, with the state, while the picture is still queued', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });

            const res = await reader.get(bytesFor(a));

            expect(res.status).toBe(404);
            expect(res.body.error.message).toMatch(/queued/);
        });

        it('answers 404 with an explanation when the row outlived the file', async () => {
            // R10 and the species-picture precedent: `storage/` is git-ignored
            // and has no seed to be re-imported from, so a redeployment starts
            // empty. That is a recoverable state, not a lost one, and it must not
            // be a stack trace from sendFile.
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-missing.jpg` });

            const res = await reader.get(bytesFor(a));

            expect(res.status).toBe(404);
            expect(res.body.error.message).toMatch(/file is missing from storage/);
            expect(res.body.error.message).toMatch(/re-extracted/);
        });

        it('serves the picture with an ETag and a revalidating Cache-Control', async () => {
            const [a] = await addObservations(1);
            const filename = `${a}-served.jpg`;

            await writeStoredFile(filename);
            await setThumbnail(a, { status: 'ready', filename });

            const res = await reader.get(bytesFor(a));

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/image\/jpeg/);

            // A real JPEG came back, not an empty body: SOI marker.
            expect(res.body.length).toBeGreaterThan(2);
            expect(res.body[0]).toBe(0xFF);
            expect(res.body[1]).toBe(0xD8);

            // **Not `immutable`.** Species pictures may be, because a stored
            // picture never changes and a replacement is a new record; a
            // thumbnail lives at a stable per-observation URL, so `immutable`
            // would pin a stale picture in every reviewer's browser for a year.
            expect(res.headers['cache-control']).not.toMatch(/immutable/);
            expect(res.headers['cache-control']).toMatch(/must-revalidate/);
            expect(res.headers.etag).toBe(`"observation-thumbnail-${a}-1"`);
        });

        it('answers 304 to a client holding the current ETag', async () => {
            const [a] = await addObservations(1);
            const filename = `${a}-etag.jpg`;

            await writeStoredFile(filename);
            await setThumbnail(a, { status: 'ready', filename });

            const res = await reader
                .get(bytesFor(a))
                .set('If-None-Match', `"observation-thumbnail-${a}-1"`);

            expect(res.status).toBe(304);
        });

        it('changes the ETag when the thumbnail is re-extracted', async () => {
            // The requirement that makes the whole caching scheme work: the URL
            // is stable, so without a changing ETag a replacement picture would
            // be invisible behind the cached copy.
            const [a] = await addObservations(1);
            const filename = `${a}-generation.jpg`;

            await writeStoredFile(filename);
            await setThumbnail(a, { status: 'ready', filename });

            const first = await reader.get(bytesFor(a));

            await thumbnailRepository.recordReady(a, {
                filename,
                contentType: 'image/jpeg',
                byteSize: 100,
                width: 320,
                height: 320,
                sourceWidth: 1920,
                sourceHeight: 1080,
                framenum: 18007,
                subset: '1',
            });

            const second = await reader.get(bytesFor(a));

            expect(second.status).toBe(200);
            expect(second.headers.etag).not.toBe(first.headers.etag);

            // And the stale ETag no longer satisfies a conditional request.
            const conditional = await reader
                .get(bytesFor(a))
                .set('If-None-Match', first.headers.etag);

            expect(conditional.status).toBe(200);
        });

        it('records where the picture came from, so it can be made again (R8, R10)', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });

            await thumbnailRepository.recordReady(a, {
                filename: `${a}.jpg`,
                contentType: 'image/jpeg',
                byteSize: 12345,
                width: 320,
                height: 320,
                sourceWidth: 1920,
                sourceHeight: 1080,
                framenum: 18007,
                subset: '1',
            });

            const row = await thumbnailRepository.findByObservationId(a);

            expect(row.framenum).toBe(18007);
            expect(row.subset).toBe('1');
            expect(row.source_width).toBe(1920);
            expect(row.source_height).toBe(1080);
            expect(row.last_error).toBeNull();
            expect(row.claimed_at).toBeNull();
        });

        it('is served at the V2 path only', async () => {
            const [a] = await addObservations(1);

            const res = await reader.get(`/api/observations/${a}/thumbnail`);

            expect(res.status).toBe(404);
        });
    });

    describe('the retry route (R14)', () => {

        it('takes a page of ids in one request and answers per observation', async () => {
            const [a, b, c] = await addObservations(3);

            await setThumbnail(a, { status: 'failed', lastError: 'ffmpeg exited 1' });
            await setThumbnail(b, { status: 'failed', permanent: true, lastError: 'No keyframes.' });
            await setThumbnail(c, { status: 'ready', filename: `${c}-kept.jpg` });

            const res = await reader.post(RETRY).send({ observationIds: [a, b, c] });

            expect(res.status).toBe(200);

            const byId = new Map(res.body.thumbnails.map((entry) => [entry.observation_id, entry]));

            // Accepted work is `queued`. **Never a terminal `ready` invented
            // synchronously**, which is only the fixture's shortcut: the picture
            // does not exist yet.
            expect(byId.get(a).status).toBe('queued');
            expect(byId.get(a).permanent).toBe(false);

            // A permanent failure is refused rather than re-queued.
            expect(byId.get(b).status).toBe('failed');
            expect(byId.get(b).permanent).toBe(true);
            expect(byId.get(b).reason).toMatch(/No keyframes/);

            // A picture that already arrived is left alone.
            expect(byId.get(c).status).toBe('ready');
        });

        it('answers for every id it was given, found by observation_id and not by position', async () => {
            const [a, b] = await addObservations(2);

            await setThumbnail(a, { status: 'failed', lastError: 'transient' });

            const res = await reader.post(RETRY).send({ observationIds: [b, a] });

            expect(res.body.thumbnails.map((entry) => entry.observation_id)).toEqual([b, a]);
            expect(res.body.thumbnails).toHaveLength(2);
        });

        it('enqueues an observation that never had a record', async () => {
            const [a] = await addObservations(1);

            const res = await reader.post(RETRY).send({ observationIds: [a] });

            expect(res.body.thumbnails[0].status).toBe('queued');
            expect((await thumbnailRepository.findByObservationId(a)).status).toBe('queued');
        });

        it('reports an id that is not an observation rather than dropping it', async () => {
            const res = await reader.post(RETRY).send({ observationIds: [-1] });

            expect(res.body.thumbnails).toEqual([
                { observation_id: -1, status: 'failed', permanent: true, reason: 'not-found' },
            ]);
        });

        it('clears the failure state of the row it re-queues', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'failed', lastError: 'ffmpeg exited 1' });

            await reader.post(RETRY).send({ observationIds: [a] });

            const row = await thumbnailRepository.findByObservationId(a);

            expect(row.status).toBe('queued');
            expect(row.attempts).toBe(0);
            expect(row.completed_at).toBeNull();
        });

        it.each([
            ['no body', {}],
            ['an empty array', { observationIds: [] }],
            ['a non-integer id', { observationIds: ['12'] }],
        ])('refuses %s with 400', async (label, body) => {
            const res = await reader.post(RETRY).send(body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('the queue (R18, R19)', () => {

        it('claims queued rows and records the lease and the attempt', async () => {
            const ids = await addObservations(3);

            for (const id of ids) {
                await setThumbnail(id, { status: 'queued' });
            }

            const claimed = await thumbnailRepository.claimBatch(1000);
            const claimedIds = claimed.map((row) => row.observation_id);

            for (const id of ids) {
                expect(claimedIds).toContain(id);
            }

            // The claim carries what extraction needs, so a batch is one query
            // rather than one per tile.
            const mine = claimed.find((row) => row.observation_id === ids[0]);

            expect(mine.video_source).toBe(`jest-thumbnail-${runId}.mp4`);
            expect(mine.mediaPosition).toBe('00:12:00.0000000');

            const row = await thumbnailRepository.findByObservationId(ids[0]);

            expect(row.attempts).toBe(1);
            expect(row.claimed_at).not.toBeNull();
            // Still `queued`: a claim is a lease, not an outcome.
            expect(row.status).toBe('queued');
        });

        it('serves the oldest request first (R19)', async () => {
            // Deterministic on a shared database: every other claimable row is
            // leased first, so the only rows the next claim can see are these
            // three. A claim is only a lease -- it lapses -- so nothing else is
            // disturbed.
            await thumbnailRepository.claimBatch(100000);

            const [first, second, third] = await addObservations(3);

            for (const id of [first, second, third]) {
                await setThumbnail(id, { status: 'queued' });
            }

            await q(
                `UPDATE observation_thumbnails
                    SET requested_at = NOW() - make_interval(secs => 300), claimed_at = NULL
                  WHERE observation_id = :first`,
                { first }
            );
            await q(
                `UPDATE observation_thumbnails
                    SET requested_at = NOW() - make_interval(secs => 200), claimed_at = NULL
                  WHERE observation_id = :second`,
                { second }
            );
            await q(
                `UPDATE observation_thumbnails
                    SET requested_at = NOW() - make_interval(secs => 100), claimed_at = NULL
                  WHERE observation_id = :third`,
                { third }
            );

            const claimed = await thumbnailRepository.claimBatch(2);

            expect(claimed.map((row) => row.observation_id).sort((a, b) => a - b))
                .toEqual([first, second].sort((a, b) => a - b));

            // The newest is still waiting rather than refused: backpressure is
            // dropping priority, never rejecting.
            const waiting = await thumbnailRepository.findByObservationId(third);

            expect(waiting.status).toBe('queued');
            expect(waiting.claimed_at).toBeNull();
        });

        it('does not claim a row another extraction is holding', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });
            await q(
                'UPDATE observation_thumbnails SET claimed_at = NOW() WHERE observation_id = :a',
                { a }
            );

            const claimed = await thumbnailRepository.claimBatch(500);

            expect(claimed.map((row) => row.observation_id)).not.toContain(a);
        });

        it('reclaims a row whose extraction died, once the lease expired', async () => {
            // R18. Without this a process that died mid-decode strands its tiles
            // at PREPARING for ever, and nothing anywhere says so.
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });
            await q(
                `UPDATE observation_thumbnails
                    SET claimed_at = NOW() - make_interval(secs => 3600)
                  WHERE observation_id = :a`,
                { a }
            );

            const claimed = await thumbnailRepository.claimBatch(500);

            expect(claimed.map((row) => row.observation_id)).toContain(a);
        });

        it('releases a claim without deciding an outcome', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });
            await q(
                'UPDATE observation_thumbnails SET claimed_at = NOW() WHERE observation_id = :a',
                { a }
            );

            expect(await thumbnailRepository.releaseClaims([a])).toBe(1);

            const row = await thumbnailRepository.findByObservationId(a);

            expect(row.status).toBe('queued');
            expect(row.claimed_at).toBeNull();
        });

        it('never rejects an enqueue, however long the queue is (R19)', async () => {
            // Backpressure is by dropping priority, never by rejecting: a long
            // queue makes a reviewer wait behind a PREPARING tile, which the
            // client already draws, rather than producing a state it has no
            // rendering for.
            const ids = await addObservations(5);

            expect(await thumbnailRepository.enqueueMissing(ids)).toBe(5);

            // A second enqueue of the same page adds nothing and refuses nothing.
            expect(await thumbnailRepository.enqueueMissing(ids)).toBe(0);
        });
    });

    describe('what the extractor refuses without opening a stream', () => {

        it('refuses a frame rate that disagrees with the derived frame (R21)', () => {
            // The footage MARP holds is 25.000 exactly, so this cannot fire on
            // real data -- which is exactly why it has a test. On any other rate
            // the seek lands elsewhere and produces a confident picture of the
            // wrong thing.
            expect(extraction.frameRateRefusal(25)).toBeNull();
            expect(extraction.frameRateRefusal(25.001)).toBeNull();

            for (const rate of [29.97, 30, 50, 24, 0, null, undefined, Number.NaN]) {
                const refusal = extraction.frameRateRefusal(rate);

                expect(typeof refusal).toBe('string');
                // Both rates in the message, so the miss is diagnosable.
                expect(refusal).toMatch(/25 fps/);
            }

            expect(extraction.frameRateRefusal(29.97)).toMatch(/29\.97/);
            expect(extraction.frameRateRefusal(null)).toMatch(/unreadable/);
        });

        it('fails an observation with no keyframes permanently (R9, F6)', () => {
            const plan = extraction.planObservation(
                { observation_id: 1, mediaPosition: '00:12:00.0000000' },
                []
            );

            expect(plan.ok).toBe(false);
            expect(plan.permanent).toBe(true);
            expect(plan.error).toMatch(/no keyframes/);
        });

        it('fails an unparseable mediaPosition permanently', () => {
            const plan = extraction.planObservation(
                { observation_id: 1, mediaPosition: 'not a timespan' },
                [{ framenum: 100, subset: '1', x: 0.5, y: 0.5, width: 0.1, height: 0.1 }]
            );

            expect(plan.ok).toBe(false);
            expect(plan.permanent).toBe(true);
            expect(plan.error).toMatch(/does not parse/);
        });

        it('plans the interpolated frame at the observation\'s own moment (A4)', () => {
            // 00:12:00 at 25 fps is frame 18000, which is inside the span below
            // and is not one of its keyframes -- the only case real data produces.
            const plan = extraction.planObservation(
                { observation_id: 1, mediaPosition: '00:12:00.2800000' },
                [
                    { framenum: 18000, subset: '1', x: 0.50, y: 0.80, width: 0.12, height: 0.10 },
                    { framenum: 18013, subset: '1', x: 0.53, y: 0.83, width: 0.15, height: 0.13 },
                ]
            );

            expect(plan.ok).toBe(true);
            expect(plan.source).toBe('interpolated');
            expect(plan.frame).toBe(18007);
            expect(plan.box.x).toBeGreaterThan(0.50);
            expect(plan.box.x).toBeLessThan(0.53);
        });

        it('groups a batch by video, so one video is one stream (R17)', () => {
            const groups = extraction.groupByVideo([
                { observation_id: 1, video_source: 'a.mp4' },
                { observation_id: 2, video_source: 'a.mp4' },
                { observation_id: 3, video_source: 'b.mp4' },
            ]);

            expect(groups.size).toBe(2);
            expect(groups.get('a.mp4').map((c) => c.observation_id)).toEqual([1, 2]);
        });

        it('never lets a Jellyfin access token through into a message', () => {
            // `buildDirectStreamUrl` embeds the token as `api_key`, ffmpeg echoes
            // the URL it was given into its own stderr, and `last_error` is read
            // by operators and surfaced to reviewers.
            const noisy = 'Opening http://media.example/Videos/abc/stream?static=true&api_key=SECRETTOKEN failed';

            expect(extraction.elideToken(noisy)).not.toContain('SECRETTOKEN');
            expect(extraction.elideToken(noisy)).toContain('api_key=<elided>');
        });
    });

    describe('the control surface (R23, R24, R25, R26)', () => {

        it('reports the run state, the counts and the configured limit', async () => {
            const res = await reader.get(STATUS);

            expect(res.status).toBe(200);
            expect(['running', 'paused']).toContain(res.body.runState);
            expect(res.body.concurrencyLimit).toBe(MAX_CONCURRENT_STREAMS);
            expect(typeof res.body.counts.queued).toBe('number');
            expect(typeof res.body.counts.ready).toBe('number');
            expect(typeof res.body.counts.failed).toBe('number');
            expect(typeof res.body.counts.permanent).toBe('number');
            expect(typeof res.body.inFlight).toBe('number');
            expect(typeof res.body.extractorAvailable).toBe('boolean');
        });

        it('is readable with observations:read alone (R26)', async () => {
            const res = await reader.get(STATUS);

            expect(res.status).toBe(200);
        });

        it('refuses a run-state change to a caller who is not an admin (R26)', async () => {
            // The split is the point: pausing extraction affects everyone using
            // the mosaic and throttles a media server shared with people watching
            // video, which is not a reviewer's decision.
            const res = await reader.post(CONTROL).send({ action: 'pause' });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');

            // And nothing changed.
            expect((await thumbnailRepository.readRunState()).run_state).toBe('running');
        });

        it('pauses, and the pause is persisted rather than held in memory (R25)', async () => {
            const res = await global.api.post(CONTROL).send({ action: 'pause', note: 'Jest' });

            expect(res.status).toBe(200);
            expect(res.body.runState).toBe('paused');

            // Read straight from the database, not from the service: an
            // in-memory pause silently expires at the worst moment.
            const [row] = await q('SELECT run_state, note FROM thumbnail_extraction_state WHERE id = 1');

            expect(row.run_state).toBe('paused');
            expect(row.note).toBe('Jest');

            await global.api.post(CONTROL).send({ action: 'resume' });
        });

        it('starts no new extraction while paused (R24)', async () => {
            const ids = await addObservations(2);

            for (const id of ids) {
                await setThumbnail(id, { status: 'queued' });
            }

            await global.api.post(CONTROL).send({ action: 'pause' });

            const summary = await extraction.drainOnce();

            expect(summary.skipped).toBe('paused');
            expect(summary.claimed).toBe(0);

            // The rows are untouched: pausing is not failing.
            const row = await thumbnailRepository.findByObservationId(ids[0]);

            expect(row.status).toBe('queued');
            expect(row.attempts).toBe(0);

            await global.api.post(CONTROL).send({ action: 'resume' });
        });

        it('stop discards the queue and leaves outcomes alone (R24)', async () => {
            const [queued, ready, failed] = await addObservations(3);

            await setThumbnail(queued, { status: 'queued' });
            await setThumbnail(ready, { status: 'ready', filename: `${ready}-stop.jpg` });
            await setThumbnail(failed, { status: 'failed', lastError: 'transient' });

            const res = await global.api.post(CONTROL).send({ action: 'stop' });

            expect(res.status).toBe(200);
            expect(res.body.runState).toBe('paused');
            expect(res.body.discarded).toBeGreaterThanOrEqual(1);

            // The discarded row is **simply absent** again, which reports
            // `failed` and is re-enqueued by the reviewer's *Ask again* -- so
            // nothing is lost and no fourth state was needed.
            expect(await thumbnailRepository.findByObservationId(queued)).toBeUndefined();

            expect((await thumbnailRepository.findByObservationId(ready)).status).toBe('ready');
            expect((await thumbnailRepository.findByObservationId(failed)).status).toBe('failed');

            await global.api.post(CONTROL).send({ action: 'resume' });
        });

        it('leaves what stop discarded absent until somebody asks again', async () => {
            // This asserted a page view re-enqueueing until A3 was reversed. A
            // page view is a pure read now, so the retry route is what recovers a
            // discarded row -- and in between the tile says NO IMAGE rather than
            // staying PREPARING for ever, which is the visible cost of stop.
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });
            await global.api.post(CONTROL).send({ action: 'stop' });

            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();

            const served = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                pageSize: 45,
                pages: [1],
            });

            expect(served.body.pages[0].rows.find((r) => r.observation_id === a).thumbnail_status)
                .toBe('failed');
            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();

            const asked = await global.api.post(RETRY).send({ observationIds: [a] });

            expect(asked.status).toBe(200);
            expect((await thumbnailRepository.findByObservationId(a)).status).toBe('queued');

            await global.api.post(CONTROL).send({ action: 'resume' });
        });

        it('resumes', async () => {
            await global.api.post(CONTROL).send({ action: 'pause' });

            const res = await global.api.post(CONTROL).send({ action: 'resume' });

            expect(res.body.runState).toBe('running');
        });

        it('refuses an action outside the vocabulary', async () => {
            const res = await global.api.post(CONTROL).send({ action: 'obliterate' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('records who changed the run state', async () => {
            await global.api.post(CONTROL).send({ action: 'pause', note: 'who' });

            const [row] = await q('SELECT changed_by_user_id FROM thumbnail_extraction_state WHERE id = 1');

            expect(row.changed_by_user_id).not.toBeNull();

            await global.api.post(CONTROL).send({ action: 'resume' });
        });

        it('answers nothing at the declared, unversioned path', async () => {
            const res = await reader.get(DECLARED_STATUS);

            expect(res.status).toBe(404);
        });
    });

    describe('no new permission keys were seeded (R15)', () => {

        it('adds nothing to the catalogue', async () => {
            const rows = await q(
                "SELECT key FROM permissions WHERE key ILIKE '%thumb%' OR key ILIKE '%imagery%'"
            );

            expect(rows).toEqual([]);
        });
    });
});
