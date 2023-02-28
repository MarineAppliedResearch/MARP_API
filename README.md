# MARE_API
MARE Data Access API

npm run dev

start with process manager: pm2 start server.js

Environmental Variables in Linux must be set to be the
same as the variables in .env, which works for the windows environment.


DB Migrations:

To Migrate and unmigrate:
npx sequelize-cli db:migrate

and we can undo ALL migrations with:

npx sequelize-cli db:migrate:undo:all

if we want to undo a specific migration we can use:

npx sequelize-cli db:migrate:undo --name 20180704124934-create-branch.js

Create a new Migration:
 npx sequelize-cli migration:create --name remove_Capital_tableFrom_metainfo

 Step 1: generate a seed file
npx sequelize-cli seed:generate --name seed_country_table

Execute it with: npx sequelize-cli db:seed:all

Like with a migration undo seeds with
npx sequelize-cli db:seed:undo `
Or up untill a specific seed like
npx sequelize-cli db:seed:undo — seed XXXXXX-seed_country_table.js


Here is a view that queries the postgres db for an entire observations_report. it sets up a reusable view

CREATE VIEW observations_report AS SELECT observations."observation_id", observations."obsID", sessions."session_id" as "Session Number", observations."taxserial", observations."comname", observations."count", observations."tc", observations."etc", projects."name" as "Project Name", sessions."dive", sessions."line", sessions."type" as "Session Type", users."name" as "User Name", observations."updatedAt" from observations, projects, sessions, users WHERE sessions."user_id" = users."user_id" AND sessions."session_id" = observations."session_id" AND sessions."project_id" = projects."project_id" ORDER BY sessions."session_id", observations."obsID";


CREATE VIEW observations_report AS SELECT projects."name" as "Project Name", users."name" as "Processor Name", sessions."type" as "Session Type", observations."observation_id", observations."obsID", sessions."session_id" as "Session Number", observations."taxserial", observations."comname", observations."count", observations."coarsesize", observations."sex", observations."tc", observations."etc",  sessions."dive", sessions."line", sessions."lineId",  observations."updatedAt" from observations, projects, sessions, users WHERE sessions."user_id" = users."user_id" AND sessions."session_id" = observations."session_id" AND sessions."project_id" = projects."project_id" ORDER BY sessions."session_id", observations."obsID";
