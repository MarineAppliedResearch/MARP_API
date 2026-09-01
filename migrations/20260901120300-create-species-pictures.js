/**
 * Creates `species_pictures`, so a species picture can be served by the API
 * instead of living only inside the annotation GUI.
 *
 * A separate table rather than a column on `species`, for two reasons. Seven
 * entries already have two pictures, and the GUI's current scheme picks whichever
 * file the directory listing returns first -- an arbitrary winner with nothing
 * recording the choice. `is_default` makes it explicit, and a partial unique
 * index keeps it to one per species.
 *
 * The bytes live on disk under `storage/species-pictures/`, not in the database.
 * `filename` is relative to that directory, so nothing here depends on where the
 * API is deployed.
 *
 * Refs #52.
 *
 * @fileoverview Migration creating the species_pictures table.
 * @author Isaac Travers
 * @module migrations/create-species-pictures
 */

'use strict';

/** @type {Object} */
module.exports = {
    /**
     * Creates the table, its foreign key, and the indexes that serve a picture
     * grid and enforce one default per species.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the table and indexes exist.
     * @throws {Error} Re-throws after rolling back if creation fails.
     */
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.createTable(
                'species_pictures',
                {
                    id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        primaryKey: true,
                        autoIncrement: true,
                    },
                    species_id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        references: { model: 'species', key: 'id' },
                        // A picture is meaningless without its species, and
                        // nothing else references a picture row.
                        onDelete: 'CASCADE',
                        onUpdate: 'CASCADE',
                        comment: 'The species this picture depicts.',
                    },
                    filename: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                        comment: 'Path relative to storage/species-pictures/, e.g. "412-1.png".',
                    },
                    original_name: {
                        type: Sequelize.STRING(255),
                        allowNull: true,
                        comment: 'Filename as supplied. For the imported set this keeps the GUI\'s "Common Name_taxserial_FI20200619.png" form, which is the only record of how the picture was matched to its species.',
                    },
                    content_type: {
                        type: Sequelize.STRING(64),
                        allowNull: false,
                        comment: 'MIME type, used directly as the Content-Type when serving.',
                    },
                    byte_size: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Size of the file in bytes.',
                    },
                    is_default: {
                        type: Sequelize.BOOLEAN,
                        allowNull: false,
                        defaultValue: false,
                        comment: 'The picture to show when only one is wanted. At most one per species.',
                    },
                    uploaded_by: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        references: { model: 'users', key: 'user_id' },
                        // Keep the picture if the uploader is removed; who
                        // added it is provenance, not a dependency.
                        onDelete: 'SET NULL',
                        onUpdate: 'CASCADE',
                        comment: 'User who uploaded this picture. Null for the imported set, which predates any upload page.',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                    },
                },
                { transaction }
            );

            // Every "show me this species' pictures" query.
            await queryInterface.addIndex('species_pictures', ['species_id'], {
                name: 'species_pictures_species_id_idx',
                transaction,
            });

            // One file per species per name, so re-running an import updates
            // rather than piling up duplicates.
            await queryInterface.addIndex('species_pictures', ['species_id', 'filename'], {
                name: 'species_pictures_species_filename_unique',
                unique: true,
                transaction,
            });

            // At most one default per species. A partial index rather than a
            // constraint, because "only when true" is the whole point.
            await queryInterface.sequelize.query(
                `CREATE UNIQUE INDEX species_pictures_one_default_idx
                   ON species_pictures (species_id)
                   WHERE is_default`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the table. Its indexes go with it.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the table is gone.
     */
    async down(queryInterface) {
        await queryInterface.dropTable('species_pictures');
    },
};
