# MARE_API
MARE Data Access API

npm run dev

start with process manager: pm2 start server.js

Environmental Variables in Linux must be set to be the
same as the variables in .env, which works for the windows environment.


DB Migrations:

To Migrate and unmigrate:
npx sequelize-cli db:migrate

npx sequelize-cli db:migrate --name 20231016171935-add_60SecondSubstrateData.js

npx sequelize-cli db:migrate --name 20230705191207-add_PobsID_record_to_Observations.js --env production

and we can undo ALL migrations with:

npx sequelize-cli db:migrate:undo:all

if we want to undo a specific migration we can use:

npx sequelize-cli db:migrate:undo --name 20230705191207-add_PobsID_record_to_Observations

Create a new Migration:
 npx sequelize-cli migration:create --name add_PobsID_record_to_Observations

 Step 1: generate a seed file
npx sequelize-cli seed:generate --name seed_country_table

Execute it with: npx sequelize-cli db:seed:all

Like with a migration undo seeds with
npx sequelize-cli db:seed:undo `
Or up untill a specific seed like
npx sequelize-cli db:seed:undo — seed XXXXXX-seed_country_table.js


Here is a view that queries the postgres db for an entire observations_report. it sets up a reusable view

View definition:
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    sessions.session_id AS "Session Number",
    observations."taxReview",
    observations.taxserial,
    observations.comname,
    observations.count,
    observations.coarsesize,
    observations.sex,
    observations.tc,
    observations.etc,
    sessions.dive,
    sessions.line,
    sessions."lineId",
    observations.note,
    observations."updatedAt",
    observations.video_source,
    observations."videoLocation",
    observations."mediaPosition",
    observations."actualPosition"
   FROM observations,
    projects,
    sessions,
    users
  WHERE sessions.user_id = users.user_id AND sessions.session_id = observations.session_id AND sessions.project_id = projects.project_id
  ORDER BY sessions.session_id, observations."obsID";


  Here is the view defined for habitat_report:

  View definition:

CREATE VIEW habitat_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    sessions.session_id AS "Session Number",
    observations.comname AS "Substrate",
    observations.coarsesize AS "PCTcover",
    observations.tc,
    observations.etc,
    sessions.dive,
    sessions.line,
    sessions."lineId",
    observations.note,
    observations."updatedAt",
    observations.video_source,
    observations."videoLocation",
    observations."mediaPosition",
    observations."actualPosition"
   FROM observations,
    projects,
    sessions,
    users
  WHERE sessions.user_id = users.user_id AND sessions.session_id = observations.session_id AND sessions.project_id = projects.project_id AND sessions.type::text = 'Habitat'::text
  ORDER BY sessions.session_id, observations."obsID";


  Substrate60Second_report

 View definition:
 CREATE VIEW Substrate60Second_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    sessions.session_id AS "Session Number",
    observations.tc,
    observations.comname AS "Substrate",
    observations.substrate_bedrock AS "Bedrock",
    observations.substrate_megaclast AS "Megaclast",
    observations.substrate_cobble AS "Cobble",
    observations.substrate_pebble AS "Pebble",
    observations.substrate_granule AS "Granule",
    observations.substrate_sand AS "Sand",
    observations.substrate_mud AS "Mud",
    observations.substrate_coral_reef AS "Coral Reef",
    observations.substrate_coral_rubble AS "Coral Rubble",
    observations.substrate_shell_hash AS "Shell Hash",
    observations.substrate_shell_rubble AS "Shell Rubble",
    observations.substrate_algal AS "Algal",
    sessions.dive,
    sessions.line,
    sessions."lineId",
    observations.note,
    observations."updatedAt",
    observations.video_source,
    observations."videoLocation",
    observations."mediaPosition",
    observations."actualPosition"
   FROM observations,
    projects,
    sessions,
    users
  WHERE sessions.user_id = users.user_id AND sessions.session_id = observations.session_id AND sessions.project_id = projects.project_id AND sessions.type::text = 'Substrate60Second'::text
  ORDER BY sessions.session_id, observations."obsID";


 psql -d mare_development -U mare_user
