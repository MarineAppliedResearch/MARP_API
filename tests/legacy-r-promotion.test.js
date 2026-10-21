/**
 * Tests for the migration that carries the legacy `R` note into the review schema.
 *
 * `migrations/20261021140000-an-r-in-the-note-meant-promoted.js` rewrites a decade of
 * approvals that exist nowhere but in an annotator's note, in the production database,
 * where `AGENTS.md` says the data is a scientific record. It was verified by hand on
 * five seeded cases which were then deleted, so nothing guarded it.
 *
 * **The case is the whole meaning and it is the thing most worth pinning.** `R` is a
 * qualified person approving an observation for training; `r` is somebody *not*
 * qualified having pre-checked it, which is not an approval. The first draft of the
 * migration matched `upper(btrim(note)) = 'R'` and would have promoted every pre-check
 * as though a reviewer had approved it — hundreds of observations entering training
 * datasets on an authority nobody gave them, with nothing afterwards able to tell which
 * were which. That is a defect no later test could find, because both kinds would look
 * identical once written.
 *
 * ## It runs against a database this file builds and drops
 *
 * `up()` is not scoped to rows a test seeded: it promotes **every** observation in the
 * database whose note is the mark, and `down()` deletes **every** review carrying the
 * migration's own reason. Pointed at a development corpus where the migration has
 * already run, `down()` would quietly withdraw the real migration's work; pointed at one
 * where it has not, `up()` would write hundreds of real decisions. Neither is something
 * a test may do, and no amount of seeding scopes it — so this builds its own database
 * from the baseline and the migrations, exactly as `marp db up` and CI do, runs there,
 * and drops it. About five seconds.
 *
 * `tests/corpus-guard.test.js` is the precedent for the mechanics; the reason here is
 * different and stronger — that suite protects the corpus from a guard it is testing,
 * this one protects it from the migration under test.
 *
 * The migration's `up` and `down` are called directly rather than driven through
 * `sequelize-cli`, because the CLI would refuse to run it a second time: the ledger
 * already records it from the build above, and *running it twice* is one of the
 * properties being asserted.
 *
 * Refs MarineAppliedResearch/MARP_API#268, #103.
 *
 * @fileoverview Tests for the legacy "R" promotion migration, on its own database.
 * @author Isaac Travers
 * @module tests/legacy-r-promotion
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const { Client } = require('pg');
const { Sequelize } = require('sequelize');

/** Repository root, for the schema scripts. */
const ROOT = path.join(__dirname, '..');

/** The scratch database. The pid keeps two runs on one machine apart. */
const SCRATCH_DB = `marp_legacy_r_${process.pid}`;

/** The migration under test. */
const migration = require('../migrations/20261021140000-an-r-in-the-note-meant-promoted');

/** The reason the migration writes, which is how `down` finds its own rows. */
const REASON = 'Legacy note "R" meant approved for training';

/** A decision a person made, which no rollback may withdraw. */
const HUMAN_REASON = 'Decided in the mosaic by a person';

/** Connection to the scratch database, for seeding and for reading back. */
let client;

/** Sequelize bound to the scratch database, so the migration gets a real queryInterface. */
let sequelize;

/** The ids this file seeded, by the case each one stands for. */
const seeded = {};

/**
 * Connection settings for the local server, from the five `DB_*` variables the API
 * reads. Only the database name differs.
 *
 * @param {string} database - Which database to open.
 * @returns {Object} `pg` client options.
 */
function connection(database) {
    return {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        database,
    };
}

/**
 * Runs one statement against the maintenance database.
 *
 * CREATE DATABASE and DROP DATABASE cannot run inside a transaction, and the
 * application's own connection is bound to the corpus, so this opens its own.
 *
 * @async
 * @param {string} sql - The statement.
 * @returns {Promise<void>} When it has run.
 */
async function onServer(sql) {
    const server = new Client(connection('postgres'));

    await server.connect();

    try {
        await server.query(sql);
    } finally {
        await server.end();
    }
}

/**
 * Runs a query against the scratch database.
 *
 * @async
 * @param {string} sql - The statement.
 * @param {Array} [values] - Positional parameters.
 * @returns {Promise<Array<Object>>} The rows.
 */
async function q(sql, values = []) {
    const { rows } = await client.query(sql, values);

    return rows;
}

/**
 * Builds the schema in the scratch database, the way `marp db up` and CI build theirs.
 *
 * The baseline first, because `observations`, `projects`, `sessions` and `metaInfos`
 * predate the migration history and every migration that touches them assumes they are
 * there.
 *
 * @param {string} script - The node script to run.
 * @param {string[]} args - Its arguments.
 * @returns {void}
 */
function build(script, args) {
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        // DB_NAME set here wins: dotenv does not overwrite a variable already in the
        // environment, so the child builds the scratch database and nothing else.
        env: { ...process.env, DB_NAME: SCRATCH_DB },
    });

    if (result.status !== 0) {
        throw new Error(`${path.basename(script)} failed:\n${result.stdout || ''}${result.stderr || ''}`);
    }
}

/**
 * Inserts one observation and remembers its id.
 *
 * SQL rather than the model, because `observation_id` is assigned by the repository as
 * `max(id) + 1` and Sequelize would send an explicit null (#62).
 *
 * @async
 * @param {string} name - The case this observation stands for.
 * @param {Object} row - `{note, userId}`.
 * @returns {Promise<number>} The new observation id.
 */
async function addObservation(name, { note, userId }) {
    const [row] = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", comname, note, user_id, version, tc,
              "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'Jest Legacy R', $4, $5, 1, '10:00:00', NOW(), NOW())
         RETURNING observation_id`,
        [seeded.sessionId, seeded.projectId, Object.keys(seeded).length, note, userId]
    );

    seeded[name] = row.observation_id;

    return row.observation_id;
}

/**
 * Records a training decision the way the commit route does: the log, then the
 * projection built from it.
 *
 * @async
 * @param {number} observationId - Which observation.
 * @param {string} decision - `promoted` or `excluded`.
 * @param {string} reason - Whose decision this is, in words.
 * @returns {Promise<void>} When both rows exist.
 */
async function decide(observationId, decision, reason) {
    const [review] = await q(
        `INSERT INTO observation_reviews
             (observation_id, purpose, decision, reason, reviewer_id,
              observation_version, decided_at, created_at, updated_at)
         VALUES ($1, 'training', $2, $3, $4, 1, NOW(), NOW(), NOW())
         RETURNING review_id`,
        [observationId, decision, reason, seeded.userId]
    );

    await q(
        `INSERT INTO observation_review_current
             (review_id, observation_id, purpose, decision, reason,
              reviewer_id, decided_at, observation_version)
         SELECT review_id, observation_id, purpose, decision, reason,
                reviewer_id, decided_at, observation_version
           FROM observation_reviews WHERE review_id = $1`,
        [review.review_id]
    );
}

/**
 * The current training decision on one observation, or null.
 *
 * @async
 * @param {number} observationId - Which observation.
 * @returns {Promise<?Object>} The projection row.
 */
async function trainingDecision(observationId) {
    const [row] = await q(
        `SELECT decision, reason, reviewer_id, observation_version
           FROM observation_review_current
          WHERE observation_id = $1 AND purpose = 'training'`,
        [observationId]
    );

    return row || null;
}

beforeAll(async () => {
    await onServer(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
    await onServer(`CREATE DATABASE "${SCRATCH_DB}"`);

    build(path.join(ROOT, 'scripts', 'init-database.js'), []);
    // The CLI's entry point has no extension; `node` runs it by path all the same.
    build(path.join(ROOT, 'node_modules', 'sequelize-cli', 'lib', 'sequelize'), ['db:migrate']);

    client = new Client(connection(SCRATCH_DB));
    await client.connect();

    sequelize = new Sequelize(SCRATCH_DB, process.env.DB_USER, process.env.DB_PASSWORD, {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        dialect: 'postgres',
        logging: false,
    });

    const [user] = await q(
        `INSERT INTO users (name, username, status, "createdAt", "updatedAt")
         VALUES ('Jest Legacy Annotator', 'jest-legacy-annotator', 'active', NOW(), NOW())
         RETURNING user_id`
    );

    seeded.userId = user.user_id;

    const [project] = await q(
        `INSERT INTO projects (name, "createdAt", "updatedAt")
         VALUES ('Jest Legacy R Project', NOW(), NOW()) RETURNING project_id`
    );

    seeded.projectId = project.project_id;

    const [session] = await q(
        `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES ($1, $2, 'JLR001', 'L1', 'LID-JLR-1', 'transect', NOW(), NOW())
         RETURNING session_id`,
        [seeded.projectId, seeded.userId]
    );

    seeded.sessionId = session.session_id;

    /* One observation per case the migration distinguishes. The two that must not be
       promoted are the point of the file. */
    await addObservation('mark', { note: 'R', userId: seeded.userId });
    await addObservation('markSpaced', { note: '  R  ', userId: seeded.userId });
    await addObservation('precheck', { note: 'r', userId: seeded.userId });
    await addObservation('precheckSpaced', { note: '  r  ', userId: seeded.userId });
    await addObservation('markNoAnnotator', { note: 'R', userId: null });
    await addObservation('alreadyExcluded', { note: 'R', userId: seeded.userId });
    await addObservation('alreadyPromoted', { note: 'R', userId: seeded.userId });
    await addObservation('wordStartingWithR', { note: 'Rock', userId: seeded.userId });
    await addObservation('noNote', { note: null, userId: seeded.userId });

    /* Decisions a person made today, which outrank a letter typed years ago -- and which
       a rollback must not withdraw. */
    await decide(seeded.alreadyExcluded, 'excluded', HUMAN_REASON);
    await decide(seeded.alreadyPromoted, 'promoted', HUMAN_REASON);
}, 180000);

afterAll(async () => {
    if (client) await client.end();
    if (sequelize) await sequelize.close();

    await onServer(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
}, 60000);

describe('the legacy "R" note becomes a training promotion (#268)', () => {

    /** What the migration printed, so the counts it reports can be read back. */
    let said;

    beforeAll(async () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        try {
            await migration.up(sequelize.getQueryInterface());
            said = log.mock.calls.map((call) => call.join(' '));
        } finally {
            log.mockRestore();
        }
    }, 60000);

    test('promotes the observation whose note is the mark', async () => {
        const decision = await trainingDecision(seeded.mark);

        expect(decision).not.toBeNull();
        expect(decision.decision).toBe('promoted');
        expect(decision.reason).toBe(REASON);
    });

    test('forgives space around the mark', async () => {
        const decision = await trainingDecision(seeded.markSpaced);

        expect(decision).not.toBeNull();
        expect(decision.decision).toBe('promoted');
    });

    test('a lowercase r is not an approval and is left undecided', async () => {
        /* **The assertion this file exists for.** `r` is somebody not qualified having
           pre-checked it. Promoted, it is indistinguishable afterwards from a decision a
           reviewer made, and it enters training datasets on an authority nobody gave it.
           The first draft of the migration matched case-insensitively. */
        expect(await trainingDecision(seeded.precheck)).toBeNull();
        expect(await trainingDecision(seeded.precheckSpaced)).toBeNull();
    });

    test('a note that merely begins with R is not the mark', async () => {
        // `btrim(note) = 'R'` and not a prefix match: "Rock" is a word, not a decision.
        expect(await trainingDecision(seeded.wordStartingWithR)).toBeNull();
        expect(await trainingDecision(seeded.noNote)).toBeNull();
    });

    test('an observation with no annotator is skipped rather than attributed', async () => {
        /* `observation_reviews.reviewer_id` is NOT NULL and somebody has to own a
           decision. An approval nobody can be said to have made is a thing to look at,
           not to assign to whoever is convenient. */
        expect(await trainingDecision(seeded.markNoAnnotator)).toBeNull();
    });

    test('the annotator who wrote the note is the reviewer of record', async () => {
        const decision = await trainingDecision(seeded.mark);

        expect(decision.reviewer_id).toBe(seeded.userId);
        expect(decision.observation_version).toBe(1);
    });

    test('a decision somebody already made outranks the letter', async () => {
        /* Both directions. The excluded one is the one that matters: a person looked at
           the picture today and said no, and a letter typed years ago must not overturn
           it. It is also what makes the migration safe to run twice. */
        const excluded = await trainingDecision(seeded.alreadyExcluded);
        const promoted = await trainingDecision(seeded.alreadyPromoted);

        expect(excluded.decision).toBe('excluded');
        expect(excluded.reason).toBe(HUMAN_REASON);
        expect(promoted.reason).toBe(HUMAN_REASON);
    });

    test('the notes are left exactly as they were', async () => {
        /* The note is the original record and the only evidence the migration was ever
           right. Clearing it would make this irreversible in substance even though
           `down` removes the rows. */
        const notes = await q(
            'SELECT observation_id, note FROM observations WHERE observation_id = ANY($1) ORDER BY observation_id',
            [[seeded.mark, seeded.markSpaced, seeded.precheck, seeded.precheckSpaced]]
        );

        expect(notes.map((row) => row.note)).toEqual(['R', '  R  ', 'r', '  r  ']);
    });

    test('writes nothing against the scientific dimension', async () => {
        /* `R` meant approved for *training*. Whether those observations were also
           scientifically reviewed is a different question the note does not answer. */
        const [{ n }] = await q(
            `SELECT count(*)::int AS n FROM observation_reviews WHERE purpose = 'scientific'`
        );

        expect(n).toBe(0);
    });

    test('promotes exactly the two it should, and says so', async () => {
        const [{ n }] = await q(
            'SELECT count(*)::int AS n FROM observation_reviews WHERE reason = $1',
            [REASON]
        );

        expect(n).toBe(2);

        // Five carry the mark; two had no decision and an annotator.
        expect(said.join('\n')).toContain('5 observations carry the mark');
        expect(said.join('\n')).toContain('2 promoted');
    });

    test('counts the lowercase pre-checks aloud rather than passing over them', async () => {
        /* Reported because the number is the point: those observations are undecided,
           and somebody qualified may want to look at them. Silence would make them
           indistinguishable from observations nobody ever marked. */
        expect(said.join('\n')).toMatch(/2 carry a lowercase "r"/);
    });

    test('counts the one it could not attribute', async () => {
        expect(said.join('\n')).toMatch(/1 have no annotator and are skipped/);
    });

    test('running it a second time changes nothing', async () => {
        /* Not a theoretical property: a migration that is not idempotent cannot be
           re-run after a partial deployment, and this one is guarded only by "insert
           where undecided". */
        const before = await q(
            'SELECT review_id FROM observation_reviews ORDER BY review_id'
        );

        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        try {
            await migration.up(sequelize.getQueryInterface());
        } finally {
            log.mockRestore();
        }

        const after = await q('SELECT review_id FROM observation_reviews ORDER BY review_id');

        expect(after).toEqual(before);
    }, 60000);
});

describe('rolling the legacy "R" promotion back (#268)', () => {

    beforeAll(async () => {
        await migration.down(sequelize.getQueryInterface());
    }, 60000);

    test('removes every decision it wrote, from the log and the projection', async () => {
        const [{ n: log }] = await q(
            'SELECT count(*)::int AS n FROM observation_reviews WHERE reason = $1',
            [REASON]
        );

        expect(log).toBe(0);
        expect(await trainingDecision(seeded.mark)).toBeNull();
        expect(await trainingDecision(seeded.markSpaced)).toBeNull();
    });

    test('leaves a decision somebody made themselves, on an observation that still carries the mark', async () => {
        /* `down` finds its rows by its own reason rather than by the note. Identified by
           the note, a rollback would withdraw the exclusion a person recorded on
           `alreadyExcluded` -- which still says `R` -- and the record of that decision
           would be gone with it. */
        const excluded = await trainingDecision(seeded.alreadyExcluded);
        const promoted = await trainingDecision(seeded.alreadyPromoted);

        expect(excluded).not.toBeNull();
        expect(excluded.decision).toBe('excluded');
        expect(promoted).not.toBeNull();
        expect(promoted.reason).toBe(HUMAN_REASON);
    });

    test('leaves the observations themselves untouched', async () => {
        const [{ n }] = await q('SELECT count(*)::int AS n FROM observations');

        expect(n).toBe(9);
    });
});
