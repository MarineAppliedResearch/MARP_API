/**
 * Tests that `observations.version` moves on every write, whatever performs it.
 *
 * R7, R8 and D5 of #103. The trigger exists because Sequelize's optimistic
 * locking cannot do this job: it lives only on instance `save` and instance
 * `destroy`, and static `Model.update` never references the version attribute,
 * while every observation write in this repository is static. A token that some
 * writers do not increment is worse than no token, so the database maintains it.
 *
 * **The tier matters more than usual here.** A unit test on the model would pass
 * while the trigger did nothing -- `version` is deliberately not a model
 * attribute, so there is nothing on the model to observe. Only a real
 * PostgreSQL, written through the path the annotation GUI actually uses, can see
 * this.
 *
 * The fixture observation is committed rather than rolled back, because
 * `repository/observation.repository.js` takes no transaction and the point is
 * to exercise it exactly as the GUI does. It is deleted afterwards.
 *
 * @fileoverview Tests for the observations.version trigger (#103 R7, R8, D5).
 * @author Isaac Travers
 * @module tests/observation-version
 */

const db = require('../model');
const observationRepository = require('../repository/observation.repository');

const { QueryTypes } = db.Sequelize;

describe('observations.version (#103 R7, R8, D5)', () => {

    /**
     * A per-session observation number no real annotation uses, so the
     * repository's `session_id` + `obsID` lookup cannot reach anybody else's
     * row.
     *
     * @constant
     * @type {number}
     */
    const FIXTURE_OBS_ID = 999003;

    /** @type {number} */
    let observationId;

    /** @type {number} */
    let sessionId;

    /**
     * Reads the current version of the fixture observation.
     *
     * @async
     * @returns {Promise<number>} The version.
     */
    async function currentVersion() {
        const [row] = await db.sequelize.query(
            'SELECT version FROM observations WHERE observation_id = :observationId',
            { type: QueryTypes.SELECT, replacements: { observationId } }
        );
        return row.version;
    }

    beforeAll(async () => {
        // Any session will do; the repository locates an observation by
        // session_id plus obsID, so it needs a real one.
        const [session] = await db.sequelize.query(
            'SELECT session_id FROM sessions ORDER BY session_id LIMIT 1',
            { type: QueryTypes.SELECT }
        );
        sessionId = session.session_id;

        // Inserted with SQL: the model declares the primary key without
        // autoIncrement, so Sequelize sends an explicit null. See #62.
        const [observation] = await db.sequelize.query(
            `INSERT INTO observations ("obsID", session_id, comname, "createdAt", "updatedAt")
             VALUES (:obsId, :sessionId, 'Jest Version Subject', NOW(), NOW())
             RETURNING observation_id`,
            {
                type: QueryTypes.SELECT,
                replacements: { obsId: FIXTURE_OBS_ID, sessionId },
            }
        );
        observationId = observation.observation_id;
    });

    afterAll(async () => {
        if (observationId !== undefined) {
            await db.sequelize.query(
                'DELETE FROM observations WHERE observation_id = :observationId',
                { replacements: { observationId } }
            );
        }
    });

    it('starts at 1 on a newly inserted observation', async () => {
        expect(await currentVersion()).toBe(1);
    });

    it('is incremented by a static update through the repository', async () => {
        const before = await currentVersion();

        // The annotation GUI's own write path: a static Model.update, which
        // Sequelize's optimistic locking never touches.
        const result = await observationRepository.updateObservationWithCount(
            sessionId, FIXTURE_OBS_ID, 7
        );
        expect(result).toBe(1);

        expect(await currentVersion()).toBe(before + 1);
    });

    it('overwrites a version supplied by the writer with OLD.version + 1', async () => {
        const before = await currentVersion();

        // The whole value of the token: a client cannot set it forward to fake
        // a conditional write, and cannot set it back to hide one.
        await db.sequelize.query(
            'UPDATE observations SET version = 99, count = 8 WHERE observation_id = :observationId',
            { replacements: { observationId } }
        );

        expect(await currentVersion()).toBe(before + 1);
    });

    it('does not move when an update changes nothing', async () => {
        const before = await currentVersion();

        // The trigger's WHEN clause. An idempotent rewrite is not a change, so
        // it must not inflate the token.
        await db.sequelize.query(
            'UPDATE observations SET count = count WHERE observation_id = :observationId',
            { replacements: { observationId } }
        );

        expect(await currentVersion()).toBe(before);
    });

    it('is not a Sequelize model attribute, so nothing can assign it through the ORM', () => {
        // Deliberate: `version: true` would be a lie on every static write, and
        // a plain attribute would let a client set the token. Asserted so a
        // later "tidy-up" that adds it to the model fails here first.
        expect(Object.keys(db.observations.rawAttributes)).not.toContain('version');
    });
});
