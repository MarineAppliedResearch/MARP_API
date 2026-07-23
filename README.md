# MARP API

Marine Analysis and Reporting Platform (MARP) backend and static frontend workspace.

MARP connects ecological data, expert interpretation, video workflows, machine-learning support, processing pipelines, and reporting into one platform.

## What This Repository Contains

- Express API for MARP data, sessions, observations, users, projects, species, keyframes, tasks, and ML dataset workflows.
- Static frontend applications served by the same Node server.
- OpenAPI generation and Swagger UI for API consumers.
- Developer documentation generated with JSDoc.
- Sequelize models, migrations, and seeders for PostgreSQL.

## MARP Frontend Context

The frontend is organized as static apps with shared shell assets:

- frontend/apps/entry: Public-facing MARP landing and entry experience.
- frontend/apps/dashboard: Dashboard prototypes and reporting views.
- frontend/shared: Shared header/footer partials and shared CSS/JS.

The entry experience communicates the current MARP product narrative:

- One shared platform hub with Shared API + Data Model.
- Workflow stages: Collect, Review, Process, Assist, Deliver.
- Capability pillars: ecological data, video/imagery, expert review, processing, machine learning, reporting.
- Prototype login UI exists for interaction design and accessibility, but it does not perform production authentication yet.

## Runtime Route Map

Frontend routes:

- / -> serves frontend/apps/entry/index.html
- /apps/:appName -> serves frontend/apps/:appName/index.html when present
- /apps/* -> static assets under frontend/apps
- /shared/* -> shared assets and partials
- /assets/* -> compatibility alias to frontend/shared/assets

Frontend compatibility redirects:

- /dashboard1.html -> /apps/dashboard/
- /userActivity.html -> /apps/dashboard/user-activity.html
- /userHours.html -> /apps/dashboard/user-hours.html

Documentation routes:

- /api-docs -> Swagger UI
- /api/openapi.json and /openapi.json -> generated OpenAPI JSON
- /developer-docs -> generated internal developer docs

API base path:

- /api/*

## Frontend Applications Included

Entry app:

- Public MARP landing page with platform overview, workflow narrative, capability map, and product/application concepts.
- Responsive navigation, section reveal effects, and accessible modal login interactions.

Dashboard app:

- Dashboard overview page with KPI cards, charts, map view, filters, and recent-transect table (demo-oriented UI scaffolding).
- User activity report at /apps/dashboard/user-activity.html using /api/dashboardData.
- User hours report at /apps/dashboard/user-hours.html using /api/getProjectTimeByDateAndUser.

Shared shell:

- Shared header/footer loaded via data-include and frontend/shared/assets/js/partials.js.

## Architecture Overview

1. HTTP server: server.js initializes Express, middleware, static serving, API routes, and docs routes.
2. Controllers: request handling and endpoint orchestration.
3. Services and repositories: business and data-access layers.
4. Models: Sequelize model registry and associations.
5. PostgreSQL: primary persistence layer.
6. Frontend static apps: served directly by Express.

## Quick Start

Prerequisites:

- Node.js and npm
- PostgreSQL
- Environment variables configured (typically via .env)

Install:

1. npm install

Run in development:

1. npm run dev

Run in production mode:

1. npm start

Optional process manager:

1. pm2 start server.js

Default port behavior:

- Uses PORT if set.
- Falls back to 3000 when PORT is not set.

## Database Migrations and Seeds

Run all migrations:

1. npx sequelize-cli db:migrate

Run a specific migration:

1. npx sequelize-cli db:migrate --name 20241111192533-create-keyframes-table.js

Undo all migrations:

1. npx sequelize-cli db:migrate:undo:all

Undo one migration:

1. npx sequelize-cli db:migrate:undo --name 20241111192533-create-keyframes-table.js

Create a migration:

1. npx sequelize-cli migration:create --name create-keyframes-table

Generate a seed file:

1. npx sequelize-cli seed:generate --name seed_observation_pobsid

Run all seeds:

1. npx sequelize-cli db:seed:all

Run one seed:

1. npx sequelize-cli db:seed --seed 20231106192725-seed_observation_pobsid

Undo recent seed:

1. npx sequelize-cli db:seed:undo

## Documentation Build Commands

Build OpenAPI only:

1. npm run docs:api:build

Build developer docs only:

1. npm run docs:dev:build

Build both:

1. npm run docs:build

## Notes and Current Constraints

- Frontend entry login is prototype-only and intentionally not connected to authentication services.
- Dashboard pages mix production-like endpoints and demo visualization scaffolding.
- Legacy HTML pages under html are compatibility-era artifacts; active served frontend is under frontend/apps.

## Primary Directories

- controller: HTTP-level API handlers
- service: business/domain orchestration
- repository: data access
- model: Sequelize models and DB wiring
- migrations: schema evolution
- seeders: baseline/sample data
- reporting: report-specific API routes
- frontend: static MARP web applications and shared assets
- docs: generated OpenAPI and developer documentation

## Suggested Next Improvements

1. Add environment variable documentation with required keys and example values.
2. Promote dashboard prototype pages to a formally versioned frontend package with tests.
3. Move report SQL view definitions into versioned migration scripts and dedicated docs.

## Errata (Working SQL Notes)

This section is intentionally retained for ad hoc SQL notes, query drafts, and table references.

### Related Tables

- observations
- sessions
- projects
- users
- keyframes

### Report/View Tables

- observations_report: observations, sessions, projects, users
- habitat_report: observations, sessions, projects, users
- MarineDebris_report: observations, sessions, projects, users
- Substrate60Second_report: observations, sessions, projects, users

### View: observations_report

```sql
SELECT
	projects.name AS "Project Name",
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
FROM observations, projects, sessions, users
WHERE sessions.user_id = users.user_id
	AND sessions.session_id = observations.session_id
	AND sessions.project_id = projects.project_id
ORDER BY sessions.session_id, observations."obsID";
```

### View: habitat_report

```sql
DROP VIEW habitat_report;

CREATE VIEW habitat_report AS
SELECT
	projects.name AS "Project Name",
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
FROM observations, projects, sessions, users
WHERE sessions.user_id = users.user_id
	AND sessions.session_id = observations.session_id
	AND sessions.project_id = projects.project_id
	AND sessions.type::text = 'Habitat'::text
ORDER BY sessions.session_id, observations."obsID";
```

### View: MarineDebris_report

```sql
DROP VIEW MarineDebris_report;

CREATE VIEW MarineDebris_report AS
SELECT
	projects.name AS "Project Name",
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
FROM observations, projects, sessions, users
WHERE sessions.user_id = users.user_id
	AND sessions.session_id = observations.session_id
	AND sessions.project_id = projects.project_id
	AND sessions.type::text = 'MarineDebris'::text
ORDER BY sessions.session_id, observations."obsID";
```

### View: Substrate60Second_report

```sql
DROP VIEW Substrate60Second_report;

CREATE VIEW Substrate60Second_report AS
SELECT
	projects.name AS "Project Name",
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
FROM observations, projects, sessions, users
WHERE sessions.user_id = users.user_id
	AND sessions.session_id = observations.session_id
	AND sessions.project_id = projects.project_id
	AND sessions.type::text = 'Substrate60Second'::text
ORDER BY sessions.session_id, observations."obsID";
```

### View Maintenance: observations_report (drop/create)

```sql
DROP VIEW public.observations_report;

CREATE OR REPLACE VIEW public.observations_report AS
SELECT
	projects.name AS "Project Name",
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
FROM observations, projects, sessions, users
WHERE sessions.user_id = users.user_id
	AND sessions.session_id = observations.session_id
	AND sessions.project_id = projects.project_id
ORDER BY sessions.session_id, observations."obsID";
```

### Query: Rebuild PobsID per project order

```sql
WITH ranked_observations AS (
	SELECT
		observations.observation_id,
		sessions.project_id,
		ROW_NUMBER() OVER (
			PARTITION BY sessions.project_id
			ORDER BY sessions.project_id, sessions.session_id, observations.observation_id
		) AS row_num
	FROM observations
	JOIN sessions ON observations.session_id = sessions.session_id
	JOIN projects ON sessions.project_id = projects.project_id
)
UPDATE observations
SET "PobsID" = ranked_observations.row_num
FROM ranked_observations
WHERE observations.observation_id = ranked_observations.observation_id;
```

### Query: Training-data species frame summary

```sql
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
```

Sample result snapshot:

```text
comname                   | observation_count | video_count | total_frames | avg_frames_per_observation
--------------------------+-------------------+-------------+--------------+-----------------------------
White-plumed anemone      | 343               | 3           | 191831       | 73.7527873894655902
California sea cucumber   | 449               | 6           | 30283        | 56.3929236499068901
Fish-eating anemone       | 285               | 5           | 29953        | 88.8813056379821958
Red sea urchin            | 137               | 3           | 15493        | 60.7568627450980392
Red sea star              | 105               | 4           | 6985         | 63.5000000000000000
Bat star                  | 84                | 2           | 5484         | 60.9333333333333333
Short red gorgonian       | 55                | 2           | 3478         | 59.9655172413793103
Leather star              | 31                | 3           | 3211         | 78.3170731707317073
Cookie star               | 51                | 5           | 2852         | 55.9215686274509804
UI Henricia               | 32                | 5           | 2481         | 72.9705882352941176
Sand-rose anemone         | 11                | 2           | 1147         | 81.9285714285714286
Fish eating star          | 14                | 2           | 1067         | 76.2142857142857143
Red gorgonian             | 4                 | 1           | 501          | 125.2500000000000000
Bat Star                  | 4                 | 1           | 244          | 61.0000000000000000
Short spined sea star     | 1                 | 1           | 154          | 154.0000000000000000
UI sea star               | 2                 | 1           | 104          | 52.0000000000000000
Thorny sea star           | 1                 | 1           | 35           | 35.0000000000000000
```

### Scratch Notes

- psql connection pattern used previously: psql -d mare_development -U mare_user
- PobsID reset sequence used previously:

```sql
ALTER TABLE observations DROP COLUMN "PobsID";
ALTER TABLE observations ADD COLUMN "PobsID" integer;
```
