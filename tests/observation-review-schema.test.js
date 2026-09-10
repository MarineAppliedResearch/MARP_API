/**
 * Asserts every schema object #103 adds, and that it added nothing else.
 *
 * The acceptance criteria for the phase say these are verified by querying
 * `information_schema` and `pg_constraint` rather than by reading the
 * migration, which is the difference between checking the database and
 * checking your own intentions. A migration that ran on a fresh database and a
 * migration that ran on a database older than the baseline can disagree, and
 * only the catalogue knows which happened here.
 *
 * The additive half is the half that matters. Phase 3 rests on `taxReview` and
 * `sizereview` being vestigial in both directions, and on nothing existing
 * being rewritten, renamed, dropped or repurposed. If that stops being true the
 * risk of the whole migration changes, so it is asserted rather than assumed.
 *
 * Read-only throughout: nothing here writes.
 *
 * @fileoverview Schema assertions for the review, version and provenance objects (#103).
 * @author Isaac Travers
 * @module tests/observation-review-schema
 */

const db = require('../model');

const { QueryTypes } = db.Sequelize;

/**
 * Runs a read-only query and returns its rows.
 *
 * @async
 * @param {string} sql - Statement to run.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} The rows.
 */
async function rows(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Looks up one column's definition.
 *
 * @async
 * @param {string} table - Table name.
 * @param {string} column - Column name.
 * @returns {Promise<Object|undefined>} The column, or undefined if absent.
 */
async function column(table, column) {
    const [found] = await rows(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = :table AND column_name = :column`,
        { table, column }
    );
    return found;
}

/**
 * Returns one constraint's definition as PostgreSQL renders it.
 *
 * @async
 * @param {string} name - Constraint name.
 * @returns {Promise<string|undefined>} The definition, or undefined if absent.
 */
async function constraintDef(name) {
    const [found] = await rows(
        `SELECT pg_get_constraintdef(oid) AS def, convalidated
           FROM pg_constraint WHERE conname = :name`,
        { name }
    );
    return found;
}

describe('#103 schema objects', () => {

    describe('observations.version and its trigger', () => {

        it('is a NOT NULL integer defaulting to 1', async () => {
            const version = await column('observations', 'version');
            expect(version).toBeDefined();
            expect(version.data_type).toBe('integer');
            expect(version.is_nullable).toBe('NO');
            expect(version.column_default).toBe('1');
        });

        it('is maintained by a BEFORE UPDATE row trigger', async () => {
            const [trigger] = await rows(
                `SELECT pg_get_triggerdef(t.oid) AS def
                   FROM pg_trigger t
                  WHERE t.tgrelid = 'observations'::regclass
                    AND NOT t.tgisinternal
                    AND t.tgname = 'observations_bump_version_trigger'`
            );
            expect(trigger).toBeDefined();
            expect(trigger.def).toMatch(/BEFORE UPDATE ON public\.observations/);
            expect(trigger.def).toMatch(/FOR EACH ROW/);
            expect(trigger.def).toMatch(/EXECUTE FUNCTION observations_bump_version\(\)/);
        });

        it('is not indexed, deliberately', async () => {
            const indexes = await rows(
                `SELECT indexdef FROM pg_indexes
                  WHERE tablename = 'observations' AND indexdef LIKE '%version%'`
            );
            expect(indexes).toEqual([]);
        });
    });

    describe('observations.ml_model_id', () => {

        it('is a nullable integer', async () => {
            const mlModelId = await column('observations', 'ml_model_id');
            expect(mlModelId).toBeDefined();
            expect(mlModelId.data_type).toBe('integer');
            expect(mlModelId.is_nullable).toBe('YES');
            expect(mlModelId.column_default).toBeNull();
        });

        it('references ml_models and keeps the observation if the model goes', async () => {
            const constraint = await constraintDef('observations_ml_model_id_fkey');
            expect(constraint).toBeDefined();
            expect(constraint.def).toMatch(/REFERENCES ml_models\(id\)/);
            expect(constraint.def).toMatch(/ON DELETE SET NULL/);
            expect(constraint.def).toMatch(/ON UPDATE CASCADE/);
        });

        it('carries a comment saying what null means, for a consumer reading the database', async () => {
            const [comment] = await rows(
                `SELECT col_description('observations'::regclass, ordinal_position) AS comment
                   FROM information_schema.columns
                  WHERE table_name = 'observations' AND column_name = 'ml_model_id'`
            );
            expect(comment.comment).toMatch(/no model recorded/);
        });

        it('has no index, since the Model filter and a real distribution are Phase 4', async () => {
            const indexes = await rows(
                `SELECT indexdef FROM pg_indexes
                  WHERE tablename = 'observations' AND indexdef LIKE '%ml_model_id%'`
            );
            expect(indexes).toEqual([]);
        });
    });

    describe('observation_reviews', () => {

        it('has every column the decision record needs', async () => {
            const present = (await rows(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_name = 'observation_reviews' ORDER BY column_name`
            )).map((r) => r.column_name);

            expect(present).toEqual([
                'corrected_species_id',
                'created_at',
                'decided_at',
                'decision',
                'observation_id',
                'observation_version',
                'previous_species_id',
                'purpose',
                'reason',
                'representative_keyframe_id',
                'review_id',
                'reviewed_keyframe_count',
                'reviewed_keyframe_max_updated_at',
                'reviewer_id',
                'updated_at',
            ]);
        });

        it('admits a corrected scientific decision, and nothing outside the vocabulary', async () => {
            const check = await constraintDef('observation_reviews_purpose_decision_check');

            // #111 A2: a correction is a *scientific* review decision. Training
            // deliberately gains nothing, which is what makes the derivation's
            // purpose-blind boundary load-bearing rather than a convenience.
            expect(check.def).toContain("'corrected'");

            // Positional rather than a regex over the whole definition: the
            // corrected value must fall inside the scientific branch, which
            // comes first, and there must be none after the training branch
            // begins.
            const scientificAt = check.def.indexOf("'scientific'");
            const trainingAt = check.def.indexOf("'training'");
            const correctedAt = check.def.indexOf("'corrected'");

            expect(scientificAt).toBeGreaterThanOrEqual(0);
            expect(correctedAt).toBeGreaterThan(scientificAt);
            expect(correctedAt).toBeLessThan(trainingAt);
            expect(check.def.indexOf("'corrected'", trainingAt)).toBe(-1);
        });

        it('ties the corrected species to the corrected decision, in both directions', async () => {
            const check = await constraintDef('observation_reviews_corrected_species_check');

            expect(check).toBeDefined();
            // Both halves. The second is the one easy to leave out and the one
            // that matters: without it an ordinary decision could carry a
            // corrected species and every reader would have to guess what that
            // meant.
            expect(check.def).toMatch(/corrected_species_id IS NOT NULL/);
            expect(check.def).toMatch(/corrected_species_id IS NULL/);
        });

        it('restricts both species so an audit row cannot be silently emptied', async () => {
            const previous = await constraintDef('observation_reviews_previous_species_id_fkey');
            const corrected = await constraintDef('observation_reviews_corrected_species_id_fkey');

            // RESTRICT rather than the SET NULL observations.species_id uses:
            // that column holds a live value, these hold historical ones.
            expect(previous.def).toContain('REFERENCES species(id)');
            expect(previous.def).toContain('ON DELETE RESTRICT');
            expect(corrected.def).toContain('REFERENCES species(id)');
            expect(corrected.def).toContain('ON DELETE RESTRICT');
        });

        it('assigns review_id from its own sequence rather than the observations pattern', async () => {
            const reviewId = await column('observation_reviews', 'review_id');
            expect(reviewId.data_type).toBe('bigint');
            expect(reviewId.column_default).toMatch(/nextval\('observation_reviews_review_id_seq'/);
        });

        it('cascades from the observation and restricts the reviewer', async () => {
            const observation = await constraintDef('observation_reviews_observation_id_fkey');
            expect(observation.def).toMatch(/REFERENCES observations\(observation_id\)/);
            expect(observation.def).toMatch(/ON DELETE CASCADE/);

            // A review belongs to its reviewer, so the actor must not vanish.
            const reviewer = await constraintDef('observation_reviews_reviewer_id_fkey');
            expect(reviewer.def).toMatch(/REFERENCES users\(user_id\)/);
            expect(reviewer.def).toMatch(/ON DELETE RESTRICT/);

            // Losing the image must not lose the decision.
            const keyframe = await constraintDef('observation_reviews_representative_keyframe_id_fkey');
            expect(keyframe.def).toMatch(/REFERENCES keyframes\(keyframe_id\)/);
            expect(keyframe.def).toMatch(/ON DELETE SET NULL/);
        });

        it('constrains the decision vocabulary per purpose, with no undecided', async () => {
            const check = await constraintDef('observation_reviews_purpose_decision_check');
            expect(check).toBeDefined();
            for (const value of ['scientific', 'training', 'reviewed', 'flagged', 'withdrawn', 'promoted', 'excluded']) {
                expect(check.def).toContain(value);
            }
            expect(check.def).not.toContain('undecided');
        });

        it('indexes the history for one observation and the work of one reviewer', async () => {
            const indexes = (await rows(
                `SELECT indexname FROM pg_indexes
                  WHERE tablename = 'observation_reviews' ORDER BY indexname`
            )).map((r) => r.indexname);

            expect(indexes).toEqual([
                'observation_reviews_observation_purpose_decided_idx',
                'observation_reviews_pkey',
                'observation_reviews_reviewer_decided_idx',
            ]);
        });

        it('ships empty: having no review row is being unreviewed, and nothing is backfilled', async () => {
            const [count] = await rows('SELECT COUNT(*)::int AS n FROM observation_reviews');
            expect(count.n).toBe(0);
        });
    });

    describe('observation_review_current', () => {

        it('is keyed on the observation and the purpose', async () => {
            const pkey = await constraintDef('observation_review_current_pkey');
            expect(pkey.def).toBe('PRIMARY KEY (observation_id, purpose)');
        });

        it('cascades from the observation and from the log row it projects', async () => {
            const observation = await constraintDef('observation_review_current_observation_id_fkey');
            expect(observation.def).toMatch(/ON DELETE CASCADE/);

            const review = await constraintDef('observation_review_current_review_id_fkey');
            expect(review.def).toMatch(/REFERENCES observation_reviews\(review_id\)/);
            expect(review.def).toMatch(/ON DELETE CASCADE/);
        });

        it('refuses withdrawn and corrected, because neither is a live decision', async () => {
            const check = await constraintDef('observation_review_current_purpose_decision_check');
            expect(check).toBeDefined();
            expect(check.def).not.toContain('withdrawn');

            // #111 D1: a correction is the vocabulary's second non-projectable
            // state, and this CHECK enforces it **without having been changed at
            // all** -- any value it does not name cannot be inserted. So a
            // derivation that stopped excluding corrections fails loudly on the
            // next rebuild rather than quietly painting a corrected tile.
            expect(check.def).not.toContain('corrected');
        });

        it('no longer carries first_decided_at, which went with first-valid-wins', async () => {
            const present = (await rows(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_name = 'observation_review_current' ORDER BY column_name`
            )).map((r) => r.column_name);

            // Its purpose was to be preserved across a claiming reviewer's
            // revision. There is no claiming reviewer, it was NOT NULL, and
            // keeping it would force every writer to invent a value.
            expect(present).not.toContain('first_decided_at');
            expect(present).toEqual([
                'decided_at',
                'decision',
                'observation_id',
                'observation_version',
                'purpose',
                'reason',
                'review_id',
                'reviewer_id',
            ]);
        });

        it('indexes the status filter with the observation_id tie-break last', async () => {
            const [index] = await rows(
                `SELECT indexdef FROM pg_indexes
                  WHERE indexname = 'observation_review_current_purpose_decision_idx'`
            );
            expect(index).toBeDefined();
            expect(index.indexdef).toMatch(/\(purpose, decision, observation_id\)/);
        });

        it('ships empty', async () => {
            const [count] = await rows('SELECT COUNT(*)::int AS n FROM observation_review_current');
            expect(count.n).toBe(0);
        });
    });

    describe('dataset_observations', () => {

        it('has a validated foreign key to observations that cascades', async () => {
            const constraint = await constraintDef('dataset_observations_observation_id_fkey');
            expect(constraint).toBeDefined();
            expect(constraint.def).toMatch(/REFERENCES observations\(observation_id\)/);
            expect(constraint.def).toMatch(/ON DELETE CASCADE/);
            // NOT VALID left behind would mean the constraint is not enforced
            // for existing rows, which is the failure this two-step can have.
            expect(constraint.convalidated).toBe(true);
        });

        it('gained no index, because the one it needed already existed', async () => {
            const indexes = (await rows(
                `SELECT indexname FROM pg_indexes
                  WHERE tablename = 'dataset_observations' ORDER BY indexname`
            )).map((r) => r.indexname);

            expect(indexes).toEqual([
                'dataset_observations_dataset_id_idx',
                'dataset_observations_observation_id_idx',
                'dataset_observations_pkey',
                'dataset_observations_unique_dataset_observation',
            ]);
        });
    });

    describe('the three missing foreign-key indexes', () => {

        it.each([
            ['keyframes_observation_id_idx', 'keyframes', 'observation_id'],
            ['observations_session_id_idx', 'observations', 'session_id'],
            ['observations_project_id_idx', 'observations', 'project_id'],
        ])('%s exists and is valid', async (name, table, columnName) => {
            const [index] = await rows(
                `SELECT c.relname, i.indisvalid, pg_get_indexdef(i.indexrelid) AS def
                   FROM pg_class c
                   JOIN pg_index i ON i.indexrelid = c.oid
                  WHERE c.relname = :name`,
                { name }
            );

            expect(index).toBeDefined();
            expect(index.def).toContain(`ON public.${table}`);
            expect(index.def).toContain(`(${columnName})`);
            // An invalid index is maintained on every write and used by
            // nothing, and IF NOT EXISTS would skip it forever.
            expect(index.indisvalid).toBe(true);
        });
    });

    describe('the phase is additive', () => {

        it('leaves taxReview and sizereview exactly as they were', async () => {
            const taxReview = await column('observations', 'taxReview');
            expect(taxReview.data_type).toBe('character varying');
            expect(taxReview.is_nullable).toBe('YES');

            const sizereview = await column('observations', 'sizereview');
            expect(sizereview.data_type).toBe('integer');
            expect(sizereview.is_nullable).toBe('YES');
        });

        it('adds nothing that reads or constrains the former review flags', async () => {
            // The claim the whole phase rests on: they are vestigial in both
            // directions. A constraint, index or trigger naming either one
            // would mean the review record is no longer purely additive.
            const referencing = await rows(
                `SELECT conname FROM pg_constraint
                  WHERE conrelid = 'observations'::regclass
                    AND (pg_get_constraintdef(oid) ILIKE '%taxReview%'
                      OR pg_get_constraintdef(oid) ILIKE '%sizereview%')
                 UNION ALL
                 SELECT indexname FROM pg_indexes
                  WHERE tablename = 'observations'
                    AND (indexdef ILIKE '%taxReview%' OR indexdef ILIKE '%sizereview%')`
            );
            expect(referencing).toEqual([]);
        });

        it('leaves the columns that must never change in place', async () => {
            // comname is the only record of what the annotator chose, and the
            // TimeSpan columns are a format an existing query has to keep
            // parsing.
            for (const name of ['comname', 'taxserial', 'tc', 'etc', 'mediaPosition', 'actualPosition', 'frame']) {
                const found = await column('observations', name);
                expect(found).toBeDefined();
            }
        });

        it('adds no soft-delete marker and no review columns to observations', async () => {
            const present = (await rows(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_name = 'observations'
                    AND column_name IN ('review_status', 'training_disposition',
                                        'deleted_at', 'is_deleted', 'observed_at')`
            )).map((r) => r.column_name);
            expect(present).toEqual([]);
        });

        it('creates no deletion provenance table', async () => {
            // Withdrawn deliberately: a permanent delete leaves no trace, and
            // #68 no longer asks for one.
            const tables = await rows(
                `SELECT table_name FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name LIKE '%deletion%'`
            );
            expect(tables).toEqual([]);
        });
    });
});
