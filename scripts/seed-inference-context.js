/**
 * Seeds the rows an inference run needs before it can ingest anything.
 *
 * A GPU job spec names a session and a registered model by id, and the ingest
 * refuses a run whose session, model or species it cannot resolve. Those rows are
 * not in the baseline -- they are development context -- so a `marp db destroy`
 * takes them and the next person rediscovers them by reading error messages. That
 * happened once and cost an afternoon; this script is the answer.
 *
 * Idempotent: it pins explicit ids and re-runs to the same state, so it is safe to
 * run after every rebuild.
 *
 * Only ever pointed at a local disposable database. It writes nothing that is not
 * listed here.
 *
 * Usage:
 *   node scripts/seed-inference-context.js            # what it would do
 *   node scripts/seed-inference-context.js --apply
 *
 * @fileoverview Development seed for the inference pipeline's context rows.
 * @author Isaac Travers
 * @module scripts/seed-inference-context
 */

'use strict';

require('dotenv').config();

const db = require('../model');

const { QueryTypes } = db.Sequelize;

/**
 * The project the CAMPA 2024 survey is recorded under.
 *
 * The id is pinned rather than generated because a job spec, a fixture and this
 * script all have to name the same row.
 *
 * @constant
 * @type {Object}
 */
const PROJECT = { project_id: 43, name: 'CAMPA2024' };

/**
 * The project the CAMPA 2026 survey is recorded under.
 *
 * Seeded here rather than by `scripts/process-dive.js`, which is what actually
 * needs it. A project is pipeline context of exactly the same kind as the model
 * and the `model_species` rows: survey data the baseline does not carry, that a
 * `marp db destroy` takes with it. A project created only by the per-dive script
 * would be lost on a rebuild and re-running this seeder -- which the runbook says
 * to do after every rebuild -- would not bring it back. So this script owns it,
 * `process-dive.js` resolves it by name, and a missing project is an error there
 * telling you to run this.
 *
 * No sessions are pinned for it: CAMPA2026 sessions are created a dive at a time
 * by `process-dive.js`, whose ids are therefore not fixed and must not be quoted
 * as though they were facts about MARP.
 *
 * @constant
 * @type {Object}
 */
const PROJECT_2026 = { project_id: 44, name: 'CAMPA2026' };

/**
 * Every project this seeds, in id order.
 *
 * @constant
 * @type {Array<Object>}
 */
const PROJECTS = [PROJECT, PROJECT_2026];

/**
 * The session the pipeline's observations land in.
 *
 * `type` is `Invert`, which is what routes the ingest to the `Inverts` species
 * list -- see `db/species-lists.js`. A `Fish` session here would make the model's
 * own output unreconcilable, by design.
 *
 * @constant
 * @type {Object}
 */
const SESSION = {
    session_id: 142,
    project_id: PROJECT.project_id,
    dive: 'Dive 8',
    line: '1000',
    lineId: '1000',
    type: 'Invert',
};

/**
 * The registered model the worker runs.
 *
 * `storage_path` is the weights the worker loads. It is a path on the machine that
 * holds them, not a value anything here dereferences.
 *
 * @constant
 * @type {Object}
 */
const MODEL = {
    id: 91,
    name: 'CAMPA_GR1_TEST6-mixed',
    model_type: 'detection',
    architecture_version: 'yolo',
    storage_path: 'models/CAMPA_GR1_TEST6/mixed/weights/best.pt',
    status: 'active',
    notes: 'Development seed. Third training phase (mixed) of CAMPA_GR1_TEST6.',
};

/**
 * The seven classes the model was trained with, as it names them.
 *
 * Taken from the model's own `mixed-classnames.yaml`, in its class order.
 *
 * These become `model_species` rows, which record what the model was trained with
 * and nothing more. They matter to a run only because the ingest is handed a class
 * *name* rather than a species key: it resolves the name against `species.comname`
 * and requires exactly one match, narrowing to the model's trained species before
 * falling back to the whole catalogue. `Red sea urchin` is on both `Inverts` and
 * `GULF_Inverts`, so an unseeded model leaves that fallback with two matches and
 * the run is refused. Seeding them is not cosmetic.
 *
 * @constant
 * @type {Array<string>}
 */
const CLASS_NAMES = [
    'California sea cucumber',
    'Fish-eating anemone',
    'Fragile pink urchin',
    'Red gorgonian',
    'Red sea urchin',
    'Short red gorgonian',
    'White-plumed anemone',
];

/**
 * The species list those class names are read against.
 *
 * The model is an inverts model, so an ambiguous common name resolves to the
 * `Inverts` row. Stated here rather than inferred from whichever row sorts first.
 *
 * @constant
 * @type {string}
 */
const SPECIES_LIST = 'Inverts';

/**
 * Run a statement, or skip it in dry-run.
 *
 * @async
 * @param {boolean} apply - Whether to actually write.
 * @param {string} sql - The statement.
 * @param {Object} replacements - Named replacements.
 * @returns {Promise<Array>} Rows, or an empty array in dry-run.
 */
async function write(apply, sql, replacements) {
    if (!apply) {
        return [];
    }

    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });
}

/**
 * Resolve the model's class names to species ids on one list.
 *
 * Fails loudly on a name that matches none or more than one: a partial seed is
 * worse than no seed, because the ingest then fails later and further away.
 *
 * @async
 * @returns {Promise<Array<Object>>} One row per class name, in class order.
 * @throws {Error} When a name does not resolve to exactly one species.
 */
async function resolveClasses() {
    // Bind parameters throughout rather than named replacements: Sequelize expands
    // an array replacement to a value list, which `= ANY()` cannot take, and it
    // refuses to mix the two styles in one query.
    const rows = await db.sequelize.query(
        `SELECT id, comname, taxserial FROM species
          WHERE species_list = $1 AND comname = ANY($2)`,
        {
            bind: [SPECIES_LIST, CLASS_NAMES],
            type: QueryTypes.SELECT,
            logging: false,
        }
    );

    const byName = new Map();

    for (const row of rows) {
        if (byName.has(row.comname)) {
            throw new Error(
                `"${row.comname}" matches more than one species on ${SPECIES_LIST}, so nothing here `
                + 'can say which the model means.'
            );
        }

        byName.set(row.comname, row);
    }

    return CLASS_NAMES.map((comname) => {
        const row = byName.get(comname);

        if (!row) {
            throw new Error(
                `"${comname}" is not on the ${SPECIES_LIST} species list. The catalogue comes from the `
                + 'baseline, so an empty result here means the database was never built rather than '
                + 'that the name is wrong.'
            );
        }

        return row;
    });
}

/**
 * Seed the four kinds of row, in dependency order.
 *
 * @async
 * @param {boolean} apply - Whether to write.
 * @returns {Promise<void>} Resolves when done.
 */
async function seed(apply) {
    const classes = await resolveClasses();

    for (const project of PROJECTS) {
        console.log(`project  ${project.project_id}  ${project.name}`);
        await write(
            apply,
            `INSERT INTO projects (project_id, name, "createdAt", "updatedAt")
             VALUES (:project_id, :name, NOW(), NOW())
             ON CONFLICT (project_id) DO UPDATE SET name = EXCLUDED.name, "updatedAt" = NOW()
             RETURNING project_id`,
            project
        );
    }

    console.log(`session  ${SESSION.session_id}  ${SESSION.dive} / line ${SESSION.line} / ${SESSION.type}`);
    await write(
        apply,
        `INSERT INTO sessions (session_id, project_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:session_id, :project_id, :dive, :line, :lineId, :type, NOW(), NOW())
         ON CONFLICT (session_id) DO UPDATE
            SET project_id = EXCLUDED.project_id, dive = EXCLUDED.dive, line = EXCLUDED.line,
                "lineId" = EXCLUDED."lineId", type = EXCLUDED.type, "updatedAt" = NOW()
         RETURNING session_id`,
        SESSION
    );

    console.log(`model    ${MODEL.id}  ${MODEL.name}`);
    await write(
        apply,
        `INSERT INTO ml_models (id, name, model_type, architecture_version, storage_path, status, notes,
                                created_at, updated_at)
         VALUES (:id, :name, :model_type, :architecture_version, :storage_path, :status, :notes,
                 NOW(), NOW())
         ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, model_type = EXCLUDED.model_type,
                architecture_version = EXCLUDED.architecture_version,
                storage_path = EXCLUDED.storage_path, status = EXCLUDED.status,
                notes = EXCLUDED.notes, updated_at = NOW()
         RETURNING id`,
        MODEL
    );

    for (const row of classes) {
        console.log(`  species ${String(row.id).padStart(4)}  taxserial ${row.taxserial}  ${row.comname}`);
        await write(
            apply,
            `INSERT INTO model_species (model_id, species_id, created_at, updated_at)
             SELECT :model_id, :species_id, NOW(), NOW()
              WHERE NOT EXISTS (
                    SELECT 1 FROM model_species
                     WHERE model_id = :model_id AND species_id = :species_id)
             RETURNING id`,
            { model_id: MODEL.id, species_id: row.id }
        );
    }

    // Pinned ids leave every sequence behind the rows that now exist, so the next
    // ordinary insert would collide. Advance each past its own table.
    for (const [table, column] of [
        ['projects', 'project_id'],
        ['sessions', 'session_id'],
        ['ml_models', 'id'],
        ['model_species', 'id'],
    ]) {
        await write(
            apply,
            `SELECT setval(pg_get_serial_sequence('${table}', '${column}'),
                           GREATEST((SELECT COALESCE(MAX(${column}), 0) FROM ${table}), 1))`,
            {}
        );
    }
}

/**
 * Entry point.
 *
 * @async
 * @returns {Promise<void>} Resolves when the process may exit.
 */
async function main() {
    const apply = process.argv.includes('--apply');

    console.log(apply ? 'Seeding inference context:' : 'Dry run -- pass --apply to write:');

    try {
        await seed(apply);
        console.log(apply ? 'Done.' : 'Nothing written.');
    } finally {
        await db.sequelize.close();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
