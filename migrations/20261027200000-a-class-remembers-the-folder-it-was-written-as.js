/**
 * A dataset class remembers the folder name it was written as.
 *
 * **A classify model's class names are folder names, and MARP's folder names are not
 * species names.** Ultralytics keeps no names list for a classification dataset: it reads
 * the subfolder names and that is the entire vocabulary, baked into the published `.pt` as
 * `names = {0: "145_blue-deacon-rockfish", ...}`. MARP cannot write the species name there
 * because `species.comname` is not a filesystem-safe string -- 37 of 1,404 names contain a
 * path separator, and `Fish` and `fish` are two species rows and one directory on Windows.
 *
 * So the model reports handles, and something has to map them back.
 *
 * **Recorded at build time rather than parsed at ingest, and that is the whole point of
 * this column.** The obvious alternative is to split `145_blue-deacon-rockfish` on the
 * first underscore and look up 145. It works today and it is the API re-deriving a string
 * the API itself generated -- a round trip through a lossy format, which breaks quietly
 * the first time a slug convention changes or an id gains a prefix. The build knows the
 * answer at the moment it writes the folder; this is where it says so.
 *
 * `classes.json` inside the archive carries the same mapping and is not made redundant by
 * this: that copy is for whoever unpacks the tar without a database, and this one is for
 * the join at ingest.
 *
 * **Null for a detection dataset**, which has no class folders at all -- its archive
 * carries a `data.yaml` whose `names` list is indexed by `class_index`, and that column
 * has been there all along.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration adding dataset_classes.folder.
 * @module migrations/a-class-remembers-the-folder-it-was-written-as
 */

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                'ALTER TABLE dataset_classes ADD COLUMN IF NOT EXISTS folder VARCHAR(80)',
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN dataset_classes.folder IS
                 'The directory this class was written as inside a classification archive, e.g. 145_blue-deacon-rockfish. It is what a model trained on that archive reports as its class name, because Ultralytics takes a classification vocabulary from the folder names and keeps no other list. Recorded when the dataset is built rather than parsed back out of the handle at ingest. Null on a detection dataset, which has no class folders.'`,
                { transaction }
            );

            /* **Not backfilled, and the absence is the honest answer.** No classification
               dataset existed before the column, so there is no folder any earlier row was
               written as -- and deriving one now would invent a name for an archive that
               does not contain it. */

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;

        await sequelize.query('ALTER TABLE dataset_classes DROP COLUMN IF EXISTS folder');
    },
};
