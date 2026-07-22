# MARE_API
MARE Data Access API

## Frontend app structure (static-first)

Frontend application pages are now organized for multi-app static serving:

- `frontend/apps/<appName>/` contains one frontend application.
- `frontend/apps/<appName>/index.html` is the app entry page.
- `frontend/shared/partials/` contains reusable HTML fragments (header/footer).
- `frontend/shared/assets/` contains shared CSS and JavaScript.

Runtime routes:

- `/` serves `frontend/apps/entry/index.html`.
- `/apps/<appName>/` serves a static frontend app.
- `/shared/*` serves reusable shared assets and partials.

Guidelines:

- Use relative API calls (`/api/...`) from frontend pages.
- Use `data-include` + `shared/assets/js/partials.js` for shared header/footer.
- Keep API and static frontend concerns separate.

npm run dev

start with process manager: pm2 start server.js

Environmental Variables in Linux must be set to be the
same as the variables in .env, which works for the windows environment.


DB Migrations:

To Migrate and unmigrate:
npx sequelize-cli db:migrate

npx sequelize-cli db:migrate --name 20241111192533-create-keyframes-table.js

npx sequelize-cli db:migrate --name 20231019182032-rename_peddle_to_pebble.js --env production

and we can undo ALL migrations with:

npx sequelize-cli db:migrate:undo:all

if we want to undo a specific migration we can use:

npx sequelize-cli db:migrate:undo --name 20241111192533-create-keyframes-table.js

Create a new Migration:
 npx sequelize-cli migration:create --name create-keyframes-table

 Step 1: generate a seed file
npx sequelize-cli seed:generate --name seed_observation_pobsid

Execute it with: npx sequelize-cli db:seed:all
npx sequelize-cli db:seed --seed 20231106192725-seed_observation_pobsid

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

DROP VIEW habitat_report;
CREATE VIEW habitat_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
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



MarineDebris_report
DROP VIEW MarineDebris_report
CREATE VIEW MarineDebris_report AS
SELECT projects.name AS "Project Name",
  users.name AS "Processor Name",
  sessions.type AS "Session Type",
  observations.observation_id,
  observations."obsID",
  observations."PobsID",
  sessions.session_id AS "Session Number",
  observations.tc,
  observations.etc,
  observations.frame,
  observations.comname, 
  observations.taxserial,
  observations.count,
  observations."taxReview",
  observations.note
FROM observations,
    projects,
    sessions,
    users
  WHERE sessions.user_id = users.user_id AND sessions.session_id = observations.session_id AND sessions.project_id = projects.project_id AND sessions.type::text = 'MarineDebris'::text
  ORDER BY sessions.session_id, observations."obsID";





  Substrate60Second_report

 View definition:

 DROP VIEW Substrate60Second_report;
 CREATE VIEW Substrate60Second_report AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
    sessions.session_id AS "Session Number",
    observations.tc,
    observations.comname AS "Substrate",
    observations.substrate_bedrock AS "Bedrock",
    observations.substrate_megaclast AS "Megaclast",
    observations.substrate_cobble AS "Cobble",
    observations.substrate_boulder AS "Boulder",
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


DROP VIEW public.observations_report;
CREATE OR REPLACE VIEW public.observations_report
 AS
 SELECT projects.name AS "Project Name",
    users.name AS "Processor Name",
    sessions.type AS "Session Type",
    observations.observation_id,
    observations."obsID",
    observations."PobsID",
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








 psql -d mare_development -U mare_user






 generate per project observations id's from scratch:

 alter table observations drop column "PobsID"; 
 alter table observations ADD column "PobsID" integer;

 WITH ranked_observations AS (
  SELECT
    "PobsID",
    projects.project_id,
    observation_id,
    sessions.session_id,
    ROW_NUMBER() OVER (PARTITION BY sessions.project_id ORDER BY sessions.project_id, sessions.session_id, observations.observation_id) AS row_num
  FROM
    observations
    JOIN sessions ON observations.session_id = sessions.session_id
    JOIN projects ON sessions.project_id = projects.project_id
)
UPDATE observations
SET "PobsID" = row_num
FROM ranked_observations
WHERE observations.observation_id = ranked_observations.observation_id;



// The following will generate the keyframes, and observations in training data per species report:

SELECT 
    o."comname",
    COUNT(DISTINCT o."observation_id") AS observation_count,
    COUNT(DISTINCT o."video_source") AS video_count,
    SUM(k_end."framenum" - k_start."framenum") AS total_frames,
    AVG(k_end."framenum" - k_start."framenum") AS avg_frames_per_observation
FROM public."observations" AS o
JOIN public."keyframes" AS k_start 
    ON k_start."observation_id" = o."observation_id"
    AND k_start."type" = 'start'
JOIN public."keyframes" AS k_end 
    ON k_end."observation_id" = o."observation_id"
    AND k_end."type" = 'end'
WHERE o."note" = 'R'
GROUP BY o."comname"
ORDER BY total_frames DESC;


         comname         | observation_count | video_count | total_frames | avg_frames_per_observation
-------------------------+-------------------+-------------+--------------+----------------------------
 White-plumed anemone    |               343 |           3 |       191831 |        73.7527873894655902
 California sea cucumber |               449 |           6 |        30283 |        56.3929236499068901
 Fish-eating anemone     |               285 |           5 |        29953 |        88.8813056379821958
 Red sea urchin          |               137 |           3 |        15493 |        60.7568627450980392
 Red sea star            |               105 |           4 |         6985 |        63.5000000000000000
 Bat star                |                84 |           2 |         5484 |        60.9333333333333333
 Short red gorgonian     |                55 |           2 |         3478 |        59.9655172413793103
 Leather star            |                31 |           3 |         3211 |        78.3170731707317073
 Cookie star             |                51 |           5 |         2852 |        55.9215686274509804
 UI Henricia             |                32 |           5 |         2481 |        72.9705882352941176
 Sand-rose anemone       |                11 |           2 |         1147 |        81.9285714285714286
 Fish eating star        |                14 |           2 |         1067 |        76.2142857142857143
 Red gorgonian           |                 4 |           1 |          501 |       125.2500000000000000
 Bat Star                |                 4 |           1 |          244 |        61.0000000000000000
 Short spined sea star   |                 1 |           1 |          154 |       154.0000000000000000
 UI sea star             |                 2 |           1 |          104 |        52.0000000000000000
 Thorny sea star         |                 1 |           1 |           35 |        35.0000000000000000
