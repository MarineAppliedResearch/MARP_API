--
-- Migrations the baseline schema already contains.
--
-- Sequelize decides what to run by reading `SequelizeMeta`. Restore the
-- baseline schema without these rows and the ledger is empty, so `db:migrate`
-- tries to re-apply migrations whose work is already in the schema -- adding
-- columns that exist, creating tables that exist -- and fails on the first
-- one. With them, it applies exactly the migrations the baseline predates.
--
-- These are the nine that had run on production when the schema was captured,
-- taken from production's own `SequelizeMeta`. They are not a guess about
-- which ones look old.
--
-- Written as INSERT rather than pg_dump's `COPY ... FROM stdin`, which is a
-- psql construct and cannot be executed through a plain SQL driver.
--
-- Regenerate alongside baseline/schema.sql -- the two describe the same moment
-- and are meaningless apart.
--

INSERT INTO public."SequelizeMeta" (name) VALUES
    ('20230130193608-create_schemas.js'),
    ('20230130193718-create_metaInfo_table.js'),
    ('20230201183600-remove_Capital_tableFrom_metainfo.js'),
    ('20230705191207-add_PobsID_record_to_Observations.js'),
    ('20231016171935-add_60SecondSubstrateData.js'),
    ('20231019182032-rename_peddle_to_pebble.js'),
    ('20241111192533-create-keyframes-table.js'),
    ('20251020190232-create-ml-models-tables.js'),
    ('20251020202725-add_confidence_to_observations_and_keyframes.js');
