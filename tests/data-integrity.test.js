/**
 * Tests for the data-migration integrity guard.
 *
 * The guard exists so a data migration cannot quietly delete or dereference
 * rows -- 212,000 `metrics_curves` rows point at `species.id`, and the species
 * import updates 854 of them. A guard nobody has watched fail is not known to
 * work, so these tests make it fail on purpose.
 *
 * Everything runs inside a transaction that is always rolled back, so the guard
 * can be handed genuinely destructive work without the development database
 * paying for it.
 *
 * @fileoverview Tests for db/data-integrity.js.
 * @author Isaac Travers
 * @module tests/data-integrity
 */

const db = require('../model');
const { discoverReferences, guardDataIntegrity } = require('../db/data-integrity');

describe('Data migration integrity guard', () => {

  /**
   * A list name no real entry uses, so these fixtures cannot be confused with
   * an annotation list.
   *
   * @constant
   * @type {string}
   */
  const FIXTURE_LIST = 'jest-integrity-list';

  /**
   * Creates a species with one picture inside the given transaction.
   *
   * @param {Object} transaction - Transaction to create within.
   * @returns {Promise<{speciesId: number, pictureId: number}>} The new ids.
   */
  async function createFixture(transaction) {
    const species = await db.species.create({
      species_list: FIXTURE_LIST,
      taxserial: 912345678,
      comname: 'Jest Integrity Subject',
      // Retired, so it never appears in an annotation list even briefly.
      is_active: false,
    }, { transaction });

    const picture = await db.species_pictures.create({
      species_id: species.id,
      filename: 'jest-integrity-1.png',
      content_type: 'image/png',
      byte_size: 1,
      is_default: true,
    }, { transaction });

    return { speciesId: species.id, pictureId: picture.id };
  }

  /**
   * The guard is only useful if it knows about relationships the caller did not
   * mention. Naming `species` alone has to surface the foreign keys pointing at
   * it, since deleting a species is what orphans them.
   */
  it('discovers foreign keys into a table without being told', async () => {
    const references = await discoverReferences(db.sequelize, ['species']);

    const keys = references.map((r) => `${r.table}.${r.column}`);

    expect(keys).toContain('species_pictures.species_id');
    expect(keys).toContain('observations.species_id');
    expect(keys).toContain('metrics_curves.species_id');
    expect(keys).toContain('metrics_summary.species_id');
    expect(keys).toContain('model_species.species_id');

    for (const reference of references) {
      expect(reference.referencedTable).toBeTruthy();
      expect(reference.referencedColumn).toBeTruthy();
    }
  });

  /**
   * Work that only adds rows is normal and must not be blocked.
   */
  it('allows work that only inserts', async () => {
    const transaction = await db.sequelize.transaction();

    try {
      await expect(guardDataIntegrity({
        sequelize: db.sequelize,
        transaction,
        tables: ['species'],
        label: 'jest-insert',
        work: async () => { await createFixture(transaction); },
      })).resolves.toBeUndefined();
    } finally {
      await transaction.rollback();
    }
  });

  /**
   * A migration that deletes rows it should not have must be caught. This is
   * the case that would have orphaned the ML metrics.
   */
  it('rejects work that deletes rows', async () => {
    const transaction = await db.sequelize.transaction();

    try {
      const { speciesId } = await createFixture(transaction);

      // Remove the picture first so the delete is not blocked by the foreign
      // key -- the point is to prove the guard notices, not that Postgres does.
      await db.species_pictures.destroy({ where: { species_id: speciesId }, transaction });

      await expect(guardDataIntegrity({
        sequelize: db.sequelize,
        transaction,
        tables: ['species'],
        label: 'jest-delete',
        work: async () => {
          await db.species.destroy({ where: { id: speciesId }, transaction });
        },
      })).rejects.toThrow(/species: 1 row\(s\) deleted/);
    } finally {
      await transaction.rollback();
    }
  });

  /**
   * A cascade nulling a foreign key loses information while leaving every row
   * count untouched, so it needs its own check.
   */
  it('rejects work that dereferences rows without deleting them', async () => {
    const transaction = await db.sequelize.transaction();

    try {
      const { pictureId } = await createFixture(transaction);

      // uploaded_by is a nullable foreign key with ON DELETE SET NULL, so it is
      // the honest way to reproduce a cascade quietly dropping a reference.
      // species_id cannot be used: it is NOT NULL, and the failed UPDATE would
      // abort the transaction rather than demonstrate anything.
      const anyUser = await db.users.findOne({ transaction });
      expect(anyUser).toBeTruthy();

      await db.species_pictures.update(
        { uploaded_by: anyUser.user_id },
        { where: { id: pictureId }, transaction }
      );

      await expect(guardDataIntegrity({
        sequelize: db.sequelize,
        transaction,
        tables: ['species_pictures'],
        label: 'jest-deref',
        work: async () => {
          // Exactly what an ON DELETE SET NULL does behind your back: the row
          // count is untouched and the reference is gone.
          await db.species_pictures.update(
            { uploaded_by: null },
            { where: { id: pictureId }, transaction }
          );
        },
      })).rejects.toThrow(/species_pictures\.uploaded_by: 1 reference\(s\) became null/);
    } finally {
      await transaction.rollback();
    }
  });

  /**
   * A migration that legitimately removes rows can say so, and then must not be
   * blocked -- otherwise the guard would make cleanup migrations impossible.
   */
  it('allows a declared shrink', async () => {
    const transaction = await db.sequelize.transaction();

    try {
      const { speciesId } = await createFixture(transaction);
      await db.species_pictures.destroy({ where: { species_id: speciesId }, transaction });

      await expect(guardDataIntegrity({
        sequelize: db.sequelize,
        transaction,
        tables: ['species'],
        mayShrink: ['species'],
        label: 'jest-declared-shrink',
        work: async () => {
          await db.species.destroy({ where: { id: speciesId }, transaction });
        },
      })).resolves.toBeUndefined();
    } finally {
      await transaction.rollback();
    }
  });

  /**
   * Nothing the guard did may survive: every test above rolls back, so the
   * fixture must be gone.
   */
  afterAll(async () => {
    const leftover = await db.species.count({ where: { species_list: FIXTURE_LIST } });
    expect(leftover).toBe(0);
  });
});
