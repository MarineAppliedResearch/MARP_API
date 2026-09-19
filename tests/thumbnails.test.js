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
const reviewImageryStorage = require('../service/review-imagery-storage.service');
const { STORAGE_DIR, FULL_FRAME_STORAGE_DIR, MAX_CONCURRENT_STREAMS } = require('../config/thumbnails');

const { QueryTypes } = db.Sequelize;

/** Where the routes actually answer. They are declared without the prefix. */
const STATUS = '/api/v2/observations/thumbnails/status';
const CONTROL = '/api/v2/observations/thumbnails/control';
const RETRY = '/api/v2/observations/thumbnails/retry';
const replacementFor = (id) => `/api/v2/observations/${id}/thumbnail/replacement`;
const bytesFor = (id) => `/api/v2/observations/${id}/thumbnail`;
const REVIEW_IMAGERY = '/api/v2/admin/review-imagery';

/** The path a route is *declared* at. Nothing should answer here. */
const DECLARED_STATUS = '/api/observations/thumbnails/status';

/** The mosaic page route. It must stay a **pure read** (A3, reversed). */
const PAGES = '/api/v2/mosaic/observations/pages';

/** Distinguishes this run's fixtures in a shared database. */
const runId = Date.now();

/**
 * The extractor's run-state row exactly as it was found, put back verbatim in
 * `afterAll`. This suite did not create it, so it may not leave it different
 * (#142) -- and it is the human's own extractor, running or paused as he chose.
 *
 * @type {Object|null}
 */
let runStateBefore = null;
let reviewSettingsBefore = null;

/**
 * Every `queued` row this suite did not create, put back in `afterAll`.
 *
 * The control tests exercise `stop`, and `stop` is `discardQueue()` -- one
 * unscoped `DELETE FROM observation_thumbnails WHERE status = 'queued'`. That is
 * the feature working: a discarded row is simply absent and the next page view
 * re-enqueues it. But the statement cannot tell this suite's rows from anybody
 * else's, so on a database with real work queued it takes those too, and the
 * corpus guard fails the file for a deletion it did not make (#142).
 *
 * Restored verbatim rather than re-enqueued, for the same reason the run-state
 * row is: `requested_at` and `candidate_index` decide what the extractor picks
 * up next, and a row put back with fresh values is a row this suite changed.
 *
 * @type {Array<Object>}
 */
let queuedBefore = [];

/** Everything seeded, so `afterAll` removes exactly it. */
const seeded = {
    projectId: null,
    sessionId: null,
    observationIds: [],
    userIds: [],
    files: [],
    fullFrameFiles: [],
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
    // **The sequence assigns `observation_id`, and this helper must not.** It used
    // to insert an explicit `max + 1`, because the repository did the same and
    // never advanced the sequence -- so a sequence-assigned insert collided, in a
    // *later* test than the one that caused it, with an empty error.
    //
    // #62 reversed that: the repository leaves the column default alone, so the
    // sequence is now the only writer and stays correct. Pinning here would put the
    // sequence back behind the table and reintroduce exactly the failure this
    // comment used to describe -- which is what CI caught when only half of this
    // change had landed.
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
 * Inserts keyframes for an observation in **one statement**, and returns how many.
 *
 * One statement on purpose: `keyframes_enqueue_thumbnail_trigger` is statement-level
 * with a transition table, so a multi-row insert is the shape that would break if
 * somebody "fixed" the trigger to `FOR EACH ROW` or dropped the `DISTINCT`.
 *
 * Raw SQL, through no repository at all, which is also the point -- the trigger has
 * to cover a writer that bypasses every one of them.
 *
 * @param {number} observationId - Whose keyframes.
 * @param {Array<number>} framenums - One keyframe per frame number.
 * @param {string} [subset] - Track label.
 * @returns {Promise<number>} How many rows were written.
 */
async function addKeyframes(observationId, framenums, subset = '1') {
    // `bind` rather than `replacements`: a named replacement holding an array is
    // expanded to `(1,2,3)`, which is a syntax error inside `unnest(...::int[])`.
    // The same trap `observation-thumbnail.repository.js` records against
    // `= ANY(...)`.
    const rows = await db.sequelize.query(
        `INSERT INTO keyframes
             (observation_id, subset, comname, type, framenum, x, y, width, height,
              "createdAt", "updatedAt")
         SELECT $1::int, $2::varchar, $3::varchar, 'middle', f, 0.5, 0.5, 0.1, 0.1,
                NOW(), NOW()
           FROM unnest($4::int[]) AS f
         RETURNING keyframe_id`,
        {
            bind: [observationId, subset, `Jest Thumbnail ${runId}`, framenums],
            type: QueryTypes.SELECT,
        }
    );

    return rows.length;
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
        // Read before anything below can move it. The control tests pause and
        // resume the extractor, which writes `changed_at` and
        // `changed_by_user_id` as well as `run_state`.
        // `changed_at` as text, not as a Date. PostgreSQL keeps microseconds and
        // a JS Date only milliseconds, so reading it as a Date and writing it
        // back truncates the value and leaves the row changed by a fraction of a
        // millisecond -- which the guard's digest sees, and which cost a run to
        // find.
        [runStateBefore = null] = await q(
            `SELECT id, run_state, changed_by_user_id, changed_at::text AS changed_at, note
               FROM thumbnail_extraction_state
              WHERE id = 1`
        );
        [reviewSettingsBefore = null] = await q(
            `SELECT max_bytes, low_watermark_percent, eviction_order,
                    changed_by_user_id, changed_at::text AS changed_at
               FROM review_imagery_settings WHERE id = 1`
        );

        // Before the suite creates anything, so everything in here is somebody
        // else's. Captured as jsonb rather than as columns: a timestamptz read
        // into a JS Date loses the microseconds PostgreSQL keeps, and writing
        // that back leaves the row changed by a fraction of a millisecond --
        // the same trap `changed_at` above is read as text to avoid. jsonb
        // renders it at full precision and converts back on the way in.
        queuedBefore = await q(
            `SELECT to_jsonb(t) AS row FROM observation_thumbnails t WHERE status = 'queued'`
        );

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
        for (const filename of seeded.fullFrameFiles) {
            fs.rmSync(path.join(FULL_FRAME_STORAGE_DIR, filename), { force: true });
        }

        // Put the run-state row back exactly as it was found, every column of
        // it. Writing `running` was not enough: `changed_at` and
        // `changed_by_user_id` move too, and a row left different is a row this
        // suite modified without having created it (#142). Restoring rather
        // than forcing `running` also keeps the stronger property the old line
        // was reaching for -- the extractor is left in the state the human
        // chose, not the state a control test happened to end on.
        if (runStateBefore) {
            await db.sequelize.query(
                `UPDATE thumbnail_extraction_state
                    SET run_state = :run_state,
                        changed_by_user_id = :changed_by_user_id,
                        changed_at = CAST(:changed_at AS timestamptz),
                        note = :note
                  WHERE id = :id`,
                { replacements: runStateBefore }
            );
        }
        if (reviewSettingsBefore) {
            await db.sequelize.query(
                `UPDATE review_imagery_settings
                    SET max_bytes = :max_bytes,
                        low_watermark_percent = :low_watermark_percent,
                        eviction_order = :eviction_order,
                        changed_by_user_id = :changed_by_user_id,
                        changed_at = CAST(:changed_at AS timestamptz)
                  WHERE id = 1`,
                { replacements: reviewSettingsBefore }
            );
        }

        // Put back whatever `stop` took that was not this suite's. Only the rows
        // that are actually gone: a `queued` row still present was never
        // discarded, and re-inserting it would be a duplicate key rather than a
        // restoration. Columns come from the row itself, so a migration that adds
        // one does not quietly stop restoring it.
        for (const { row } of queuedBefore) {
            if (seeded.observationIds.includes(row.observation_id)) { continue; }

            const [still] = await q(
                'SELECT 1 FROM observation_thumbnails WHERE observation_id = :id',
                { id: row.observation_id }
            );
            if (still) { continue; }

            // jsonb_populate_record names the columns from the table itself, so
            // a migration that adds one does not quietly stop restoring it, and
            // PostgreSQL does every type conversion rather than the driver.
            await db.sequelize.query(
                `INSERT INTO observation_thumbnails
                 SELECT * FROM jsonb_populate_record(
                     NULL::observation_thumbnails, CAST(:row AS jsonb))`,
                { replacements: { row: JSON.stringify(row) } }
            );
        }
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

    describe('writing a keyframe enqueues a thumbnail (R27)', () => {

        // The **primary** trigger. The page-serve backstop is below, and the
        // point of having this one is that by the time anybody looks the work is
        // normally already done or in flight.
        //
        // The first attempt at it put the enqueue in the GPU ingest's own
        // repository. That covered the machine path and **silently missed every
        // hand-annotated observation**, which is the kind of gap that looks fine
        // for months.
        //
        // It hangs off the **keyframe** rather than the observation because a
        // thumbnail is a crop of a box, and because of what the annotation GUI
        // actually does, read rather than assumed
        // (`VIDEO_PROCESSING_GUI/MAREGUI_PROOFofCONCEPT/FishWindow.xaml.cs:2772`
        // then `:2857`): it POSTs the observation, waits for the server-assigned
        // `observation_id`, and only then POSTs the keyframes. Enqueueing at
        // observation-creation would hand the extractor a boxless row, which R9
        // records as a **permanent** failure -- and the keyframes arriving a
        // moment later would never recover it.

        it('creates no row for an observation written with no keyframes', async () => {
            // The GUI's first request, and F6's state: it skips the keyframe POST
            // entirely when the annotator drew no box
            // (`FishWindow.xaml.cs:2848`, its own comment cites issue #183), so
            // a boxless observation is routine rather than exotic. **Creation**
            // must not enqueue it -- there is no box, so the extractor would
            // record a permanent failure that no later keyframe could undo. The
            // page backstop may still enqueue it later, which is fine: by then a
            // person is looking, and a permanent failure is the honest answer.
            const created = await global.api.post('/api/v2/observation').send({
                observation: {
                    session_id: seeded.sessionId,
                    comname: `Jest Thumbnail ${runId}`,
                    tc: '10:00:00',
                    count: 1,
                    video_source: `jest-thumbnail-${runId}.mp4`,
                    mediaPosition: '00:12:00.0000000',
                },
            });

            expect(created.status).toBe(200);

            const observationId = Number(created.body.observation_id);

            expect(Number.isInteger(observationId)).toBe(true);
            seeded.observationIds.push(observationId);

            expect(await thumbnailRepository.findByObservationId(observationId)).toBeUndefined();
        });

        it('enqueues when the GUI posts the keyframes, one request later', async () => {
            // The two requests in the order the GUI issues them. This is the test
            // that would have failed on the first implementation.
            const created = await global.api.post('/api/v2/observation').send({
                observation: {
                    session_id: seeded.sessionId,
                    comname: `Jest Thumbnail ${runId}`,
                    tc: '10:00:01',
                    count: 1,
                    video_source: `jest-thumbnail-${runId}.mp4`,
                    mediaPosition: '00:12:01.0000000',
                },
            });

            const observationId = Number(created.body.observation_id);

            seeded.observationIds.push(observationId);

            expect(await thumbnailRepository.findByObservationId(observationId)).toBeUndefined();

            // A bare array, not `{ keyframes: [...] }` -- the shape that route
            // takes and the shape `Functions.GetAnnotationsAsJson` sends.
            const posted = await global.api.post('/api/v2/keyframe').send([
                {
                    observation_id: observationId,
                    subset: '1',
                    comname: `Jest Thumbnail ${runId}`,
                    type: 'start',
                    framenum: 18000,
                    x: 0.5,
                    y: 0.5,
                    width: 0.1,
                    height: 0.1,
                },
            ]);

            expect(posted.status).toBe(200);

            const record = await thumbnailRepository.findByObservationId(observationId);

            expect(record).toBeDefined();
            expect(record.status).toBe('queued');
            expect(record.permanent).toBe(false);
            expect(record.attempts).toBe(0);
            expect(record.requested_at).not.toBeNull();
            expect(record.filename).toBeNull();
        });

        it('enqueues from a plain INSERT that goes through no repository at all', async () => {
            // The reason this is a trigger. Three repositories write keyframes --
            // the ingest with raw SQL, the observation create through a nested
            // `include`, and the keyframe route through `bulkCreate` -- and a
            // fourth writer is a person fixing data by hand. One place covers all
            // four; a second call site is how one of them gets forgotten.
            const [a] = await addObservations(1);

            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();
            expect(await addKeyframes(a, [18000, 18013, 18028])).toBe(3);

            const record = await thumbnailRepository.findByObservationId(a);

            expect(record).toBeDefined();
            expect(record.status).toBe('queued');
        });

        it('writes exactly one row for a track of many keyframes', async () => {
            // `SELECT DISTINCT` over the transition table. Without it the insert
            // conflicts with itself inside one statement, which Postgres refuses
            // outright rather than ignoring -- so this fails loudly if the
            // DISTINCT is ever dropped.
            const [a] = await addObservations(1);

            expect(await addKeyframes(a, [100, 200, 300, 400, 500, 600, 700, 800])).toBe(8);

            const rows = await q(
                'SELECT observation_id FROM observation_thumbnails WHERE observation_id = :a',
                { a }
            );

            expect(rows).toHaveLength(1);
        });

        it('adds nothing when more keyframes arrive later for the same observation', async () => {
            // The GUI does exactly this: `attachToSelectedAnnotation` and
            // `commitKeyframeAtCurrentFrame` post single keyframes onto an
            // observation that already has some.
            const [a] = await addObservations(1);

            await addKeyframes(a, [100, 200]);

            const first = await thumbnailRepository.findByObservationId(a);

            await addKeyframes(a, [300]);
            await addKeyframes(a, [400], '2');

            const after = await q(
                'SELECT observation_id, requested_at FROM observation_thumbnails WHERE observation_id = :a',
                { a }
            );

            expect(after).toHaveLength(1);
            expect(after[0].requested_at.getTime()).toBe(first.requested_at.getTime());
        });

        it('never resets a ready row when a later keyframe arrives', async () => {
            // `ON CONFLICT DO NOTHING`, never `DO UPDATE`. This is the dangerous
            // one: `DO UPDATE` would throw away a picture that exists and re-open
            // a Jellyfin stream every time an annotator nudged a box. Asking for
            // a fresh picture is the retry route's job, on a button a person
            // pressed.
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-settled.jpg`, generation: 3 });
            await addKeyframes(a, [900, 901]);

            const record = await thumbnailRepository.findByObservationId(a);

            expect(record.status).toBe('ready');
            expect(record.filename).toBe(`${a}-settled.jpg`);
            expect(record.generation).toBe(3);
        });

        it('never re-queues a permanent failure when a later keyframe arrives', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, {
                status: 'failed',
                permanent: true,
                lastError: 'The video matched at 61, below the bar.',
            });

            await addKeyframes(a, [1000]);

            const record = await thumbnailRepository.findByObservationId(a);

            expect(record.status).toBe('failed');
            expect(record.permanent).toBe(true);
        });

        it('takes the queue entry with the write when the transaction rolls back', async () => {
            // Inside the transaction rather than after it, so an observation can
            // never exist with nothing intending to picture it -- and a failed
            // write can never leave a queue entry behind.
            const [a] = await addObservations(1);

            await expect(db.sequelize.transaction(async (transaction) => {
                await db.sequelize.query(
                    `INSERT INTO keyframes
                         (observation_id, subset, comname, type, framenum, x, y, width, height,
                          "createdAt", "updatedAt")
                     VALUES (:a, '1', 'Jest rollback', 'start', 2000, 0.5, 0.5, 0.1, 0.1, NOW(), NOW())`,
                    { replacements: { a }, transaction }
                );

                // The row exists inside the transaction, which is what proves the
                // trigger fired rather than the assertion below being vacuous.
                const inside = await db.sequelize.query(
                    'SELECT observation_id FROM observation_thumbnails WHERE observation_id = :a',
                    { replacements: { a }, type: QueryTypes.SELECT, transaction }
                );

                expect(inside).toHaveLength(1);

                throw new Error('deliberate rollback');
            })).rejects.toThrow('deliberate rollback');

            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();
        });
    });

    describe('serving a page is the backstop, not the trigger (A3, R11, R28)', () => {

        // A3 moved twice on 2026-09-10 and this is where it landed. It was
        // answered on 2026-09-09 as *a page fetch enqueues what it is missing*;
        // the human then reversed that -- *"trying to load the page should not be
        // the thing that makes the back end work"* -- and then refined it: *"if a
        // page tries to view something and those thumbnails aren't available, that
        // page should enqueue the observations that are trying to be seen."*
        //
        // So there are two triggers, and each needs its own test. Creation is the
        // primary one and is above; this is the safety net for what creation
        // cannot reach -- the ~440,000 rows that predate the trigger.

        it('enqueues an observation on the page that has no record', async () => {
            // These observations are written straight to `observations` with no
            // keyframes, which is exactly the shape of a legacy row: the creation
            // trigger never fired for it and nothing else will.
            const [a, b] = await addObservations(2);

            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                // Big enough to hold everything this suite seeds into the
                // session. At 45 a row created late falls onto page 2 and the
                // lookup below finds nothing, which reads as the endpoint being
                // wrong rather than as the question being too narrow.
                pageSize: 400,
                pages: [1],
            });

            expect(res.status).toBe(200);

            // Asked of the table as well as the response: the response could
            // report `queued` from the coalesce while nothing was written, which
            // is precisely the dishonesty the two halves of A3 exist to prevent.
            const rows = await q(
                `SELECT observation_id, status FROM observation_thumbnails
                  WHERE observation_id IN (:a, :b) ORDER BY observation_id`,
                { a, b }
            );

            expect(rows.map((row) => row.observation_id)).toEqual([a, b].sort((x, y) => x - y));
            expect(rows.every((row) => row.status === 'queued')).toBe(true);
        });

        it('reports queued for an observation that had no record', async () => {
            const [a] = await addObservations(1);

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                pageSize: 400,
                pages: [1],
            });

            expect(res.status).toBe(200);

            const row = res.body.pages[0].rows.find((r) => r.observation_id === a);

            // Honest, because the fetch enqueued it. That is the half of A3 that
            // makes the other half true.
            expect(row.thumbnail_status).toBe('queued');
        });

        it('finds the row already there after creation, and leaves it alone', async () => {
            // The two triggers must not fight. The creation trigger has already
            // enqueued this observation, so the page serve has to be a no-op on
            // it -- not a second row, and not a reset of the first.
            const [a] = await addObservations(1);

            await addKeyframes(a, [4000, 4010]);

            const created = await thumbnailRepository.findByObservationId(a);

            expect(created.status).toBe('queued');

            await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                pageSize: 400,
                pages: [1],
            });

            const after = await q(
                'SELECT observation_id, requested_at FROM observation_thumbnails WHERE observation_id = :a',
                { a }
            );

            expect(after).toHaveLength(1);
            expect(after[0].requested_at.getTime()).toBe(created.requested_at.getTime());
        });

        it('never resets a ready row, however many times the page is served', async () => {
            // The expensive mistake this guards: a page serve that reset a `ready`
            // row to `queued` would re-open a Jellyfin stream for every tile on
            // every navigation, for a picture that already exists.
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-backstop.jpg`, generation: 2 });

            for (let i = 0; i < 3; i += 1) {
                await global.api.post(PAGES).send({
                    filters: { session: [seeded.sessionId] },
                    pageSize: 400,
                    pages: [1],
                });
            }

            const record = await thumbnailRepository.findByObservationId(a);

            expect(record.status).toBe('ready');
            expect(record.filename).toBe(`${a}-backstop.jpg`);
            expect(record.generation).toBe(2);
        });

        it('reports the real status once one exists', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-real.jpg` });

            const res = await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                // Big enough to hold everything this suite seeds into the
                // session. At 45 a row created late falls onto page 2 and the
                // lookup below finds nothing, which reads as the endpoint being
                // wrong rather than as the question being too narrow.
                pageSize: 400,
                pages: [1],
            });

            const row = res.body.pages[0].rows.find((r) => r.observation_id === a);

            expect(row.thumbnail_status).toBe('ready');
        });

        it('never re-enqueues a permanent failure, however many times the page is served', async () => {
            // This is the whole reason permanence is recorded. Without it a page
            // of hopeless legacy rows asks the media server again on every page
            // view, on a button the page invites the reviewer to press.
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
            await q(
                `UPDATE observation_thumbnails
                    SET attempts = 3, framenum = 18000
                  WHERE observation_id = :a`,
                { a }
            );

            await reader.post(RETRY).send({ observationIds: [a] });

            const row = await thumbnailRepository.findByObservationId(a);

            expect(row.status).toBe('queued');
            expect(row.attempts).toBe(3);
            expect(row.candidate_index).toBe(1);
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

    describe('the reviewer replacement route (#134 R2-R4)', () => {

        it('queues a ready row at reviewer priority and advances its candidate', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-old.jpg` });
            await q(
                'UPDATE observation_thumbnails SET framenum = 18000 WHERE observation_id = :a',
                { a }
            );

            const res = await reader.post(replacementFor(a));
            const row = await thumbnailRepository.findByObservationId(a);

            expect(res.status).toBe(200);
            expect(res.body.thumbnail).toEqual({
                observation_id: a, status: 'queued', permanent: false, reason: null,
            });
            expect(row.request_priority).toBe(1);
            expect(row.candidate_index).toBe(1);
            expect(row.attempts).toBe(0);
        });

        it('does not skip another candidate when clicked again while queued', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-old.jpg` });
            await q(
                'UPDATE observation_thumbnails SET framenum = 18000 WHERE observation_id = :a',
                { a }
            );

            await reader.post(replacementFor(a));
            await reader.post(replacementFor(a));

            expect((await thumbnailRepository.findByObservationId(a)).candidate_index).toBe(1);
        });

        it('does not release or duplicate a replacement already being extracted', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'ready', filename: `${a}-old.jpg` });
            await thumbnailRepository.requestReplacement(a);
            await q(
                'UPDATE observation_thumbnails SET claimed_at = NOW() WHERE observation_id = :a',
                { a }
            );

            const before = await thumbnailRepository.findByObservationId(a);

            await thumbnailRepository.requestReplacement(a);

            const after = await thumbnailRepository.findByObservationId(a);
            expect(after.claimed_at.getTime()).toBe(before.claimed_at.getTime());
            expect(after.requested_at.getTime()).toBe(before.requested_at.getTime());
        });

        it('refuses a structural permanent failure unchanged', async () => {
            const [a] = await addObservations(1);

            await setThumbnail(a, {
                status: 'failed', permanent: true, lastError: 'No keyframes.',
            });

            const res = await reader.post(replacementFor(a));

            expect(res.body.thumbnail.status).toBe('failed');
            expect(res.body.thumbnail.permanent).toBe(true);
            expect(res.body.thumbnail.reason).toMatch(/No keyframes/);
        });

        it('reports an id that is not an observation', async () => {
            const res = await reader.post(replacementFor(-1));

            expect(res.body.thumbnail).toEqual({
                observation_id: -1, status: 'failed', permanent: true, reason: 'not-found',
            });
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

        it('claims a reviewer request ahead of older ordinary work (#134 R4)', async () => {
            await thumbnailRepository.claimBatch(100000);

            const [ordinary, reviewer] = await addObservations(2);

            await setThumbnail(ordinary, { status: 'queued' });
            await setThumbnail(reviewer, { status: 'ready', filename: `${reviewer}-old.jpg` });
            await q(
                `UPDATE observation_thumbnails
                    SET requested_at = NOW() - make_interval(secs => 300), claimed_at = NULL
                  WHERE observation_id = :ordinary`,
                { ordinary }
            );
            await thumbnailRepository.requestReplacement(reviewer);

            const [claimed] = await thumbnailRepository.claimBatch(1);

            expect(claimed.observation_id).toBe(reviewer);
            expect(claimed.request_priority).toBe(1);
        });

        it('keeps reviewer requests first-in, first-out (#134 R4)', async () => {
            await thumbnailRepository.claimBatch(100000);

            const [first, second] = await addObservations(2);

            await setThumbnail(first, { status: 'ready', filename: `${first}-old.jpg` });
            await setThumbnail(second, { status: 'ready', filename: `${second}-old.jpg` });
            await thumbnailRepository.requestReplacement(first);
            await thumbnailRepository.requestReplacement(second);
            await q(
                `UPDATE observation_thumbnails
                    SET requested_at = CASE observation_id
                        WHEN :first THEN NOW() - make_interval(secs => 2)
                        ELSE NOW() - make_interval(secs => 1) END,
                        claimed_at = NULL
                  WHERE observation_id IN (:first, :second)`,
                { first, second }
            );

            const [claimed] = await thumbnailRepository.claimBatch(1);

            expect(claimed.observation_id).toBe(first);
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
            //
            // Through real keyframe writes rather than a repository call, because
            // since A3's reversal that is the only thing that enqueues.
            const ids = await addObservations(5);

            for (const id of ids) {
                await addKeyframes(id, [3000, 3010]);
            }

            const rows = await q(
                `SELECT observation_id, status FROM observation_thumbnails
                  WHERE observation_id IN (:ids) ORDER BY observation_id`,
                { ids }
            );

            expect(rows.map((row) => row.observation_id)).toEqual(ids);
            expect(rows.every((row) => row.status === 'queued')).toBe(true);

            // A second write for the same observations adds nothing and refuses
            // nothing.
            for (const id of ids) {
                await addKeyframes(id, [3020]);
            }

            const again = await q(
                'SELECT observation_id FROM observation_thumbnails WHERE observation_id IN (:ids)',
                { ids }
            );

            expect(again).toHaveLength(ids.length);
        });
    });

    describe('full-frame review imagery (#176)', () => {
        const fullFrameFor = (id) => `/api/v2/observations/${id}/full-frame`;

        it('queues the exact frame currently backing the thumbnail', async () => {
            const [id] = await addObservations(1);
            await addKeyframes(id, [100, 125], 'track-a');
            await setThumbnail(id, { status: 'ready', filename: `${id}-thumb.jpg` });
            await q(`UPDATE observation_thumbnails SET framenum = 125, subset = 'track-a'
                      WHERE observation_id = :id`, { id });

            const res = await reader.post(fullFrameFor(id));
            const row = await thumbnailRepository.findByObservationId(id);

            expect(res.status).toBe(200);
            expect(res.body.fullFrame).toMatchObject({ status: 'queued', framenum: 125 });
            expect(row.full_frame_subset).toBe('track-a');
            await q('UPDATE observation_thumbnails SET full_frame_status = NULL WHERE observation_id = :id', { id });
        });

        it('serves a ready native frame and reuses its stable URL', async () => {
            const [id] = await addObservations(1);
            await addKeyframes(id, [200]);
            await setThumbnail(id, { status: 'ready', filename: `${id}-thumb.jpg` });
            await q('UPDATE observation_thumbnails SET framenum = 200, subset = \'1\' WHERE observation_id = :id', { id });
            await thumbnailRepository.requestFullFrame(id);
            const filename = `${id}-full.jpg`;
            const sharp = require('sharp');
            const bytes = await sharp({ create: { width: 8, height: 6, channels: 3,
                background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
            fs.mkdirSync(FULL_FRAME_STORAGE_DIR, { recursive: true });
            fs.writeFileSync(path.join(FULL_FRAME_STORAGE_DIR, filename), bytes);
            seeded.fullFrameFiles.push(filename);
            await thumbnailRepository.recordFullFrameReady(id, {
                filename, contentType: 'image/jpeg', byteSize: bytes.length,
                width: 8, height: 6, box: { x: .4, y: .5, width: .1, height: .2 }
            });

            const reused = await reader.post(fullFrameFor(id));
            const served = await reader.get(fullFrameFor(id));

            expect(reused.body.fullFrame).toMatchObject({ status: 'ready', available: true,
                framenum: 200, width: 8, height: 6 });
            expect(served.status).toBe(200);
            expect(served.headers['content-type']).toMatch(/image\/jpeg/);
            expect(served.headers['cache-control']).toMatch(/must-revalidate/);
            expect(served.headers['cache-control']).not.toMatch(/immutable/);
            expect(served.headers.etag).toBe(`"observation-full-frame-${id}-2"`);

            const unchanged = await reader.get(fullFrameFor(id))
                .set('If-None-Match', served.headers.etag);
            expect(unchanged.status).toBe(304);
        });

        it('requires observation read permission for requests and private bytes', async () => {
            const [id] = await addObservations(1);
            const nobody = await agentWith('full-frame-no-read', []);

            expect((await nobody.post(fullFrameFor(id))).status).toBe(403);
            expect((await nobody.get(fullFrameFor(id))).status).toBe(403);
        });

        it('clears ready availability when the recorded file is missing', async () => {
            const [id] = await addObservations(1);
            await setThumbnail(id, { status: 'ready', filename: `${id}-thumb.jpg` });
            await q('UPDATE observation_thumbnails SET framenum = 275, subset = \'1\' WHERE observation_id = :id', { id });
            await thumbnailRepository.requestFullFrame(id);
            await thumbnailRepository.recordFullFrameReady(id, {
                filename: `${id}-missing.jpg`, contentType: 'image/jpeg', byteSize: 100,
                width: 1920, height: 1080, box: null
            });

            expect((await reader.get(fullFrameFor(id))).status).toBe(404);
            const row = await thumbnailRepository.findByObservationId(id);
            expect(row).toMatchObject({ full_frame_status: null, full_frame_filename: null });
            expect(row.full_frame_evicted_at).not.toBeNull();
        });

        it('claims a full-frame request at reviewer priority', async () => {
            const [id] = await addObservations(1);
            await addKeyframes(id, [300]);
            await setThumbnail(id, { status: 'ready', filename: `${id}-thumb.jpg` });
            await q('UPDATE observation_thumbnails SET framenum = 300, subset = \'1\' WHERE observation_id = :id', { id });
            await thumbnailRepository.requestFullFrame(id);
            await q("UPDATE observation_thumbnails SET full_frame_requested_at = '1970-01-01' WHERE observation_id = :id", { id });

            const claims = await thumbnailRepository.claimBatch(1);

            expect(claims[0]).toMatchObject({ observation_id: id, artifact_kind: 'full_frame' });
            await thumbnailRepository.releaseClaims([id]);
            await q('UPDATE observation_thumbnails SET full_frame_status = NULL WHERE observation_id = :id', { id });
        });

        it('shares one FIFO reviewer class with replacement thumbnails', async () => {
            const [background, fullFrame, replacement] = await addObservations(3);
            await setThumbnail(background, { status: 'queued' });
            await setThumbnail(fullFrame, { status: 'ready', filename: `${fullFrame}-thumb.jpg` });
            await setThumbnail(replacement, { status: 'ready', filename: `${replacement}-thumb.jpg` });
            await q(`UPDATE observation_thumbnails SET framenum = 300, subset = '1'
                      WHERE observation_id IN (:ids)`, { ids: [fullFrame, replacement] });
            await thumbnailRepository.requestFullFrame(fullFrame);
            await thumbnailRepository.requestReplacement(replacement);
            await q("UPDATE observation_thumbnails SET request_priority = 0, requested_at = '1960-01-01' WHERE observation_id = :id",
                { id: background });
            await q("UPDATE observation_thumbnails SET full_frame_requested_at = '1970-01-01' WHERE observation_id = :id",
                { id: fullFrame });
            await q("UPDATE observation_thumbnails SET requested_at = '1971-01-01' WHERE observation_id = :id",
                { id: replacement });

            const claims = await thumbnailRepository.claimBatch(3);
            try {
                expect(claims.map(({ observation_id, artifact_kind }) =>
                    [observation_id, artifact_kind])).toEqual([
                    [fullFrame, 'full_frame'], [replacement, 'thumbnail'],
                    [background, 'thumbnail']
                ]);
            } finally {
                await thumbnailRepository.releaseClaims([background, fullFrame, replacement]);
                await q(`UPDATE observation_thumbnails
                            SET status = 'failed', full_frame_status = NULL
                          WHERE observation_id IN (:ids)`, {
                    ids: [background, fullFrame, replacement]
                });
            }
        });

        it('does not release or reorder an in-progress duplicate request', async () => {
            const [id] = await addObservations(1);
            await setThumbnail(id, { status: 'ready', filename: `${id}-thumb.jpg` });
            await q('UPDATE observation_thumbnails SET framenum = 350, subset = \'1\' WHERE observation_id = :id', { id });
            await thumbnailRepository.requestFullFrame(id);
            const [claimed] = await thumbnailRepository.claimBatch(1);
            const before = await thumbnailRepository.findByObservationId(id);

            expect(claimed).toMatchObject({ observation_id: id, artifact_kind: 'full_frame' });
            await thumbnailRepository.requestFullFrame(id);
            const after = await thumbnailRepository.findByObservationId(id);
            expect(after.full_frame_claimed_at.getTime()).toBe(before.full_frame_claimed_at.getTime());
            expect(after.full_frame_requested_at.getTime()).toBe(before.full_frame_requested_at.getTime());
            await thumbnailRepository.releaseClaims([id]);
            await q('UPDATE observation_thumbnails SET full_frame_status = NULL WHERE observation_id = :id', { id });
        });

        it('invalidates a cached full frame when replacement selects another frame', async () => {
            const [id] = await addObservations(1);
            await setThumbnail(id, { status: 'ready', filename: `${id}-thumb.jpg` });
            await q('UPDATE observation_thumbnails SET framenum = 400, subset = \'1\' WHERE observation_id = :id', { id });
            await thumbnailRepository.requestFullFrame(id);
            await thumbnailRepository.recordFullFrameReady(id, {
                filename: `${id}-full.jpg`, contentType: 'image/jpeg', byteSize: 2048,
                width: 1920, height: 1080, box: { x: .5, y: .5, width: .1, height: .1 }
            });

            await thumbnailRepository.recordReady(id, {
                filename: `${id}-replacement.jpg`, contentType: 'image/jpeg', byteSize: 1024,
                width: 320, height: 320, sourceWidth: 1920, sourceHeight: 1080,
                framenum: 425, subset: '1'
            });

            const row = await thumbnailRepository.findByObservationId(id);
            expect(row).toMatchObject({
                status: 'ready', framenum: 425, full_frame_status: null,
                full_frame_filename: null, full_frame_framenum: null,
                full_frame_byte_size: null
            });
            expect(row.full_frame_evicted_at).not.toBeNull();
        });
    });

    describe('review-imagery administration (#176)', () => {
        it('shows persisted policy, split usage, and resolved locations only to admins', async () => {
            const refused = await reader.get(REVIEW_IMAGERY);
            const res = await global.api.get(REVIEW_IMAGERY);

            expect(refused.status).toBe(403);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                maxBytes: expect.any(Number),
                lowWatermarkPercent: expect.any(Number),
                evictionOrder: expect.any(String),
                thumbnailBytes: expect.any(Number),
                fullFrameBytes: expect.any(Number),
                totalBytes: expect.any(Number),
                storageLocations: {
                    thumbnails: expect.any(String), fullFrames: expect.any(String)
                }
            });
        });

        it('persists validated changes and rejects an invalid write without changing them', async () => {
            const maxBytes = 30 * 1024 * 1024 * 1024;
            const changed = await global.api.put(REVIEW_IMAGERY).send({
                maxBytes, lowWatermarkPercent: 88, evictionOrder: 'oldest_first'
            });
            expect(changed.status).toBe(200);
            expect(changed.body).toMatchObject({ maxBytes, lowWatermarkPercent: 88,
                evictionOrder: 'oldest_first' });

            const refused = await global.api.put(REVIEW_IMAGERY).send({
                maxBytes: 0, lowWatermarkPercent: 88, evictionOrder: 'oldest_first'
            });
            const after = await global.api.get(REVIEW_IMAGERY);
            expect(refused.status).toBe(400);
            expect(after.body).toMatchObject({ maxBytes, lowWatermarkPercent: 88,
                evictionOrder: 'oldest_first' });
        });

        it('evicts file bytes and clears availability as one managed operation', async () => {
            const [id] = await addObservations(1);
            const filename = `${id}-evict.jpg`;
            await setThumbnail(id, { status: 'ready', filename });
            await writeStoredFile(filename);

            const changed = await reviewImageryStorage.evictArtifact({
                kind: 'thumbnail', observation_id: id, filename, byte_size: 100
            });
            const row = await thumbnailRepository.findByObservationId(id);

            expect(changed).toBe(true);
            expect(fs.existsSync(path.join(STORAGE_DIR, filename))).toBe(false);
            expect(row).toMatchObject({ status: 'failed', permanent: false, filename: null });
            expect(row.thumbnail_evicted_at).not.toBeNull();
        });

        it('clears every sharing row before deleting content-addressed bytes', async () => {
            const before = await reviewImageryStorage.status();
            const [first, second] = await addObservations(2);
            const filename = `${first}-shared.jpg`;
            await setThumbnail(first, { status: 'ready', filename });
            await setThumbnail(second, { status: 'ready', filename });
            await q(`UPDATE observation_thumbnails SET byte_size = 100
                      WHERE observation_id IN (:ids)`, { ids: [first, second] });
            await writeStoredFile(filename);

            const stored = await reviewImageryStorage.status();
            expect(stored.thumbnailBytes - before.thumbnailBytes).toBe(100);

            await reviewImageryStorage.evictArtifact({
                kind: 'thumbnail', observation_id: first, filename, byte_size: 100
            });
            expect(fs.existsSync(path.join(STORAGE_DIR, filename))).toBe(false);
            expect((await thumbnailRepository.findByObservationId(first)).status).toBe('failed');
            expect((await thumbnailRepository.findByObservationId(second)).status).toBe('failed');
            expect((await reviewImageryStorage.status()).thumbnailBytes).toBe(before.thumbnailBytes);
        });
    });

    describe('what the extractor refuses without opening a stream', () => {

        it('uses the exact stored frame and treats a missing box as optional (#176)', () => {
            const claim = { full_frame_framenum: 450, full_frame_subset: '1' };
            const plan = extraction.fullFramePlan(claim, []);

            expect(plan).toMatchObject({ ok: true, frame: 450, subset: '1', box: null });
        });

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

        it('advances one durable candidate at a time and reports exhaustion (#134 R7, R8)', () => {
            const keyframes = [
                { framenum: 18000, subset: '1', x: 0.50, y: 0.80, width: 0.12, height: 0.10 },
                { framenum: 18010, subset: '1', x: 0.60, y: 0.90, width: 0.12, height: 0.10 },
            ];
            const first = extraction.planObservation(
                { mediaPosition: '00:12:00.2000000', candidate_index: 0 }, keyframes
            );
            const second = extraction.planObservation(
                { mediaPosition: '00:12:00.2000000', candidate_index: 1 }, keyframes
            );
            const exhausted = extraction.planObservation(
                { mediaPosition: '00:12:00.2000000', candidate_index: 4 }, keyframes
            );

            expect(first.frame).toBe(18005);
            expect(first.hasNext).toBe(true);
            expect(second.frame).toBe(18000);
            expect(exhausted.ok).toBe(false);
            expect(exhausted.permanent).toBe(true);
            expect(exhausted.error).toMatch(/Every usable thumbnail frame/);
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

            // The discarded row is **simply absent** again, which is what makes
            // the next page view re-enqueue it -- so nothing is lost and no
            // fourth state was needed.
            expect(await thumbnailRepository.findByObservationId(queued)).toBeUndefined();

            expect((await thumbnailRepository.findByObservationId(ready)).status).toBe('ready');
            expect((await thumbnailRepository.findByObservationId(failed)).status).toBe('failed');

            await global.api.post(CONTROL).send({ action: 'resume' });
        });

        it('re-enqueues on the next page view what stop discarded', async () => {
            // A discarded row is simply absent again, and the page backstop is
            // what makes that safe -- so nothing is lost and no fourth state was
            // needed for "was queued and then abandoned".
            const [a] = await addObservations(1);

            await setThumbnail(a, { status: 'queued' });
            await global.api.post(CONTROL).send({ action: 'stop' });

            expect(await thumbnailRepository.findByObservationId(a)).toBeUndefined();

            await global.api.post(PAGES).send({
                filters: { session: [seeded.sessionId] },
                pageSize: 400,
                pages: [1],
            });

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
