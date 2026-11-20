/**
 * Registering a habitat model trained outside MARP (#287).
 *
 * Isaac, 2026-11-20: bring the feasibility experiment's model into MARP so habitat lines can
 * be run now. `registerHabitatModel` registers its weights and rules as a MARP-trained habitat
 * model is registered, and `scripts/import-habitat-model.js` reads the experiment's results
 * file into the rules a habitat trainer would have published.
 *
 * Each registration runs in a transaction that is rolled back; the weights it copied into the
 * model store are removed afterwards.
 *
 * @fileoverview Tests for registerHabitatModel and the import script's reading of results.
 * @module tests/habitat-model-import
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../model');
const { storageRoot } = require('../service/model-artifact.service');
const { registerHabitatModel } = require('../repository/trained-model.repository');
const { publishedFrom, SUBSTRATES } = require('../scripts/import-habitat-model');
const substrates = require('./fixtures/habitat-substrates');

const { QueryTypes } = db.Sequelize;
const runId = Date.now();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-habitat-import-'));
const written = [];
let seeded;

/** A results file as the experiment wrote it, for seed 2 of the habitat crop. */
const RESULTS = {
    settings: { arch: 'dinov2_vitb', crop: 'habitat', size: 518 },
    thresholds: { Rock: 0.15, Mud: 0.1, Sand: 0.9, Cobble: 0.85, Boulder: 0.39999999999999997 },
    finetuned_test: { Rock: { f1: 0.93 }, Mud: { f1: 0.648 }, Sand: { f1: 0.85 }, Cobble: { f1: 0.7 }, Boulder: { f1: 0.56 } },
};

/** Register `bytes` as weights inside a transaction that is rolled back, and read back what it made. */
async function register(bytes, published = publishedFrom(RESULTS)) {
    const weightsPath = path.join(dir, `weights-${written.length}.pt`);
    fs.writeFileSync(weightsPath, bytes);
    const transaction = await db.sequelize.transaction();
    const q = (sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction, logging: false });
    try {
        const first = await registerHabitatModel({ db, weightsPath, published, name: `jest-habitat-import-${runId}`, notes: 'test', transaction });
        const again = await registerHabitatModel({ db, weightsPath, published, name: `jest-habitat-import-${runId}`, notes: 'test', transaction });
        const [model] = await q('SELECT * FROM ml_models WHERE id = :id', { id: first.id });
        written.push(path.resolve(storageRoot(), path.dirname(path.dirname(model.storage_path))));
        const species = await q(
            `SELECT s.comname, s.species_list FROM model_species ms JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :id ORDER BY s.comname`,
            { id: first.id }
        );
        return { first, again, model, species };
    } finally {
        await transaction.rollback();
    }
}

beforeAll(async () => {
    seeded = await substrates.ensureSubstrates();
});

afterAll(async () => {
    for (const file of written) fs.rmSync(file, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    await substrates.removeSubstrates(seeded);
});

describe('reading the experiment\'s results file', () => {
    test('gives the five substrates in the experiment\'s order, its cut-offs, the habitat crop and its size', () => {
        expect(publishedFrom(RESULTS)).toEqual({
            substrates: ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'],
            cut_offs: { Rock: 0.15, Mud: 0.1, Sand: 0.9, Cobble: 0.85, Boulder: 0.4 },
            crop: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1.0 },
            input_size: 518,
        });
    });

    test('refuses a model on another crop, or of other substrates', () => {
        expect(() => publishedFrom({ ...RESULTS, settings: { ...RESULTS.settings, crop: 'full' } })).toThrow(/not the habitat crop/);
        expect(() => publishedFrom({ ...RESULTS, thresholds: { Rock: 0.5, Mud: 0.5 } })).toThrow(/cut-offs are for/);
    });
});

describe('registering it (#287)', () => {
    test('as a habitat model with the settled rules, its weights stored and checksummed, once', async () => {
        const { first, again, model, species } = await register(Buffer.from(`weights ${runId}`));
        expect(first.existing).toBe(false);
        expect(again).toEqual({ id: first.id, name: first.name, existing: true });

        expect(model).toMatchObject({ model_type: 'habitat', status: 'active', engine: 'timm', file_format: 'pt' });
        expect(model.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(fs.readFileSync(path.resolve(storageRoot(), model.storage_path), 'utf8')).toBe(`weights ${runId}`);

        // The settled rules beside what the experiment tuned; Mud's raise is applied at run time.
        expect(model.decision_rules).toMatchObject({
            substrates: SUBSTRATES,
            tuned_cut_offs: { Rock: 0.15, Mud: 0.1, Sand: 0.9, Cobble: 0.85, Boulder: 0.4 },
            crop: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1.0 },
            input_size: 518,
            raise: { Mud: 0.2 },
        });
        expect(species.map((s) => [s.comname, s.species_list])).toEqual(
            ['Boulder', 'Cobble', 'Mud', 'Rock', 'Sand'].map((name) => [name, 'Habitat'])
        );
    });

    test('refuses a substrate that is not on the Habitat list', async () => {
        await expect(register(Buffer.from(`other ${runId}`), { ...publishedFrom(RESULTS), substrates: ['Rock', 'Lava'] }))
            .rejects.toThrow(/not on the Habitat list: Lava/);
    });
});
