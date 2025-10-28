-- source_build_star_subset.sql
BEGIN;

DROP TABLE IF EXISTS subset_projects;
DROP TABLE IF EXISTS subset_sessions;
DROP TABLE IF EXISTS subset_observations;
DROP TABLE IF EXISTS subset_keyframes;

-- 1) keyframes that match the filter
CREATE TABLE subset_keyframes AS
SELECT k.*
FROM keyframes k
WHERE k."comname" ILIKE '%star%';

-- 2) observations referenced by those keyframes
CREATE TABLE subset_observations AS
SELECT DISTINCT o.*
FROM observations o
JOIN subset_keyframes k ON k."observation_id" = o."observation_id";

-- 3) sessions referenced by those observations
CREATE TABLE subset_sessions AS
SELECT DISTINCT s.*
FROM sessions s
JOIN subset_observations o ON o."session_id" = s."session_id";

-- 4) projects referenced by those sessions
CREATE TABLE subset_projects AS
SELECT DISTINCT p.*
FROM projects p
JOIN subset_sessions s ON s."project_id" = p."project_id";

COMMIT;

-- (Optional) quick counts
 SELECT (SELECT COUNT(*) FROM subset_projects) AS projects,
        (SELECT COUNT(*) FROM subset_sessions) AS sessions,
        (SELECT COUNT(*) FROM subset_observations) AS observations,
        (SELECT COUNT(*) FROM subset_keyframes) AS keyframes;









        -----------------------------------





-- ===================================================================
-- 0.  SAFETY: advance all sequences above current max IDs
-- ===================================================================
DO $$
DECLARE
  max_proj int;
  max_sess int;
  max_obs  int;
BEGIN
  SELECT COALESCE(MAX("project_id"),0)+1 INTO max_proj FROM projects;
  PERFORM setval('projects_project_id_seq', max_proj, false);

  SELECT COALESCE(MAX("session_id"),0)+1 INTO max_sess FROM sessions;
  PERFORM setval('sessions_session_id_seq', max_sess, false);

  SELECT COALESCE(MAX("observation_id"),0)+1 INTO max_obs FROM observations;
  PERFORM setval('observations_observation_id_seq', max_obs, false);
END $$;

-- ===================================================================
-- 1.  PROJECTS / SESSIONS / OBSERVATIONS / KEYFRAMES MERGE
-- ===================================================================

-- ==============================================================
-- 1. PROJECTS
-- ==============================================================

BEGIN;

DROP TABLE IF EXISTS proj_map;
DROP TABLE IF EXISTS sess_map;
DROP TABLE IF EXISTS obs_map;

CREATE TEMP TABLE proj_map (old_id INT, new_id INT);
CREATE TEMP TABLE sess_map (old_id INT, new_id INT);
CREATE TEMP TABLE obs_map  (old_id INT, new_id INT);

WITH
src AS (SELECT *, ROW_NUMBER() OVER () AS rn FROM subset_projects),
new_ids AS (
  SELECT nextval('projects_project_id_seq') AS new_id, ROW_NUMBER() OVER () AS rn FROM src
),
ins AS (
  INSERT INTO projects ("project_id","name","createdAt","updatedAt")
  SELECT n.new_id, s."name", s."createdAt", s."updatedAt"
  FROM src s JOIN new_ids n USING (rn)
  ON CONFLICT ("name") DO NOTHING
  RETURNING "project_id","name"
)
INSERT INTO proj_map (old_id,new_id)
SELECT s."project_id", COALESCE(p."project_id", pr."project_id")
FROM src s
LEFT JOIN ins p  ON p."name" = s."name"
LEFT JOIN projects pr ON pr."name" = s."name";

COMMIT;

-- ==============================================================
-- 2. SESSIONS
-- ==============================================================

BEGIN;

WITH src AS (
  SELECT "session_id" AS old_id,
         "project_id","user_id","dive","line","lineId",
         "type","createdAt","updatedAt"
  FROM subset_sessions
),
ins AS (
  INSERT INTO sessions (
    "project_id","user_id","dive","line","lineId",
    "type","createdAt","updatedAt"
  )
  SELECT
    p.new_id,
    COALESCE(u."user_id", 1),  -- remap any missing user_id to 1
    s."dive", s."line", s."lineId",
    s."type", s."createdAt", s."updatedAt"
  FROM src s
  LEFT JOIN proj_map p ON p.old_id = s."project_id"
  LEFT JOIN users u ON u."user_id" = s."user_id"
  RETURNING "session_id" AS new_id
)
INSERT INTO sess_map (old_id,new_id)
SELECT s.old_id, i.new_id
FROM src s
JOIN ins i ON TRUE
LIMIT (SELECT COUNT(*) FROM ins);

COMMIT;

-- ==============================================================
-- 3. OBSERVATIONS
-- ==============================================================

BEGIN;

WITH
src AS (
  SELECT "observation_id" AS old_id,
         "project_id","session_id","user_id","tc","frame",
         "taxserial","comname","count","quadrant","etc",
         "note","timelog","video_source","videoLocation",
         "mediaPosition","actualPosition","createdAt","updatedAt",
         "sex","coarsesize","taxReview","downcamera","sizereview",
         "obsID","substrate_bedrock","substrate_megaclast",
         "substrate_boulder","substrate_cobble","substrate_pebble",
         "substrate_granule","substrate_sand","substrate_mud",
         "substrate_coral_reef","substrate_coral_rubble",
         "substrate_shell_hash","substrate_shell_rubble",
         "substrate_algal","PobsID"
  FROM subset_observations
),
new_ids AS (
  SELECT nextval('observations_observation_id_seq') AS new_id,
         ROW_NUMBER() OVER () AS rn
  FROM src
),
ins AS (
  INSERT INTO observations (
    "observation_id","project_id","session_id","user_id","tc","frame",
    "taxserial","comname","count","quadrant","etc",
    "note","timelog","video_source","videoLocation",
    "mediaPosition","actualPosition","createdAt","updatedAt",
    "sex","coarsesize","taxReview","downcamera","sizereview",
    "obsID","substrate_bedrock","substrate_megaclast",
    "substrate_boulder","substrate_cobble","substrate_pebble",
    "substrate_granule","substrate_sand","substrate_mud",
    "substrate_coral_reef","substrate_coral_rubble",
    "substrate_shell_hash","substrate_shell_rubble",
    "substrate_algal","PobsID","confidence"
  )
  SELECT
    n.new_id,
    p.new_id,
    se.new_id,
    COALESCE(u."user_id", 1),
    s."tc", s."frame", s."taxserial", s."comname",
    s."count", s."quadrant", s."etc", s."note", s."timelog",
    s."video_source", s."videoLocation", s."mediaPosition",
    s."actualPosition", s."createdAt", s."updatedAt",
    s."sex", s."coarsesize", s."taxReview", s."downcamera", s."sizereview",
    s."obsID", s."substrate_bedrock", s."substrate_megaclast",
    s."substrate_boulder", s."substrate_cobble", s."substrate_pebble",
    s."substrate_granule", s."substrate_sand", s."substrate_mud",
    s."substrate_coral_reef", s."substrate_coral_rubble",
    s."substrate_shell_hash", s."substrate_shell_rubble",
    s."substrate_algal", s."PobsID",
    NULL AS "confidence"
  FROM src s
  JOIN new_ids n USING (rn)
  LEFT JOIN proj_map p  ON p.old_id  = s."project_id"
  LEFT JOIN sess_map se ON se.old_id = s."session_id"
  LEFT JOIN users u ON u."user_id" = s."user_id"
  RETURNING "observation_id", n.new_id
)
INSERT INTO obs_map (old_id,new_id)
SELECT old_id, new_id FROM ins;

COMMIT;

-- ==============================================================
-- 4. KEYFRAMES
-- ==============================================================

BEGIN;

INSERT INTO keyframes (
  "observation_id","subset","comname","type",
  "framenum","x","y","width","height",
  "createdAt","updatedAt","confidence"
)
SELECT
  o.new_id,
  k."subset",k."comname",k."type",k."framenum",
  k."x",k."y",k."width",k."height",
  k."createdAt",k."updatedAt",
  NULL AS "confidence"
FROM subset_keyframes k
JOIN obs_map o ON k."observation_id" = o.old_id;

COMMIT;

-- ==============================================================
-- 5. VERIFICATION COUNTS (optional)
-- ==============================================================

-- SELECT COUNT(*) AS new_projects     FROM proj_map;
-- SELECT COUNT(*) AS new_sessions     FROM sess_map;
-- SELECT COUNT(*) AS new_observations FROM obs_map;
-- SELECT COUNT(*) FROM keyframes k JOIN obs_map o ON k."observation_id" = o.new_id;
















-- ===================================================================
-- CONTINUATION MERGE: Sessions / Observations / Keyframes
-- Projects already imported.
-- ===================================================================

-- ==============================================================
-- 2. SESSIONS (remap project_id, safe 1:1 pairing)
-- ==============================================================

BEGIN;

WITH src AS (
  SELECT "session_id" AS old_id,
         "project_id","user_id","dive","line","lineId",
         "type","createdAt","updatedAt",
         ROW_NUMBER() OVER () AS rn
  FROM subset_sessions
),
inserted AS (
  INSERT INTO sessions (
    "project_id","user_id","dive","line","lineId",
    "type","createdAt","updatedAt"
  )
  SELECT
    p.new_id,
    COALESCE(u."user_id", 1),
    s."dive", s."line", s."lineId",
    s."type", s."createdAt", s."updatedAt"
  FROM src s
  LEFT JOIN proj_map p ON p.old_id = s."project_id"
  LEFT JOIN users u ON u."user_id" = s."user_id"
  RETURNING "session_id"
),
paired AS (
  SELECT s.old_id, i."session_id" AS new_id,
         ROW_NUMBER() OVER () AS rn
  FROM src s
  JOIN inserted i ON TRUE  -- small dataset, safe pre-rownum pair
)
INSERT INTO sess_map (old_id, new_id)
SELECT old_id, new_id FROM paired;

COMMIT;


-- ==============================================================
-- 3. OBSERVATIONS (1:1 row pairing, avoid explosion)
-- ==============================================================

BEGIN;

WITH
src AS (
  SELECT "observation_id" AS old_id,
         "project_id","session_id","user_id","tc","frame",
         "taxserial","comname","count","quadrant","etc",
         "note","timelog","video_source","videoLocation",
         "mediaPosition","actualPosition","createdAt","updatedAt",
         "sex","coarsesize","taxReview","downcamera","sizereview",
         "obsID","substrate_bedrock","substrate_megaclast",
         "substrate_boulder","substrate_cobble","substrate_pebble",
         "substrate_granule","substrate_sand","substrate_mud",
         "substrate_coral_reef","substrate_coral_rubble",
         "substrate_shell_hash","substrate_shell_rubble",
         "substrate_algal","PobsID",
         ROW_NUMBER() OVER () AS rn
  FROM subset_observations
),
inserted AS (
  INSERT INTO observations (
    "observation_id","project_id","session_id","user_id","tc","frame",
    "taxserial","comname","count","quadrant","etc",
    "note","timelog","video_source","videoLocation",
    "mediaPosition","actualPosition","createdAt","updatedAt",
    "sex","coarsesize","taxReview","downcamera","sizereview",
    "obsID","substrate_bedrock","substrate_megaclast",
    "substrate_boulder","substrate_cobble","substrate_pebble",
    "substrate_granule","substrate_sand","substrate_mud",
    "substrate_coral_reef","substrate_coral_rubble",
    "substrate_shell_hash","substrate_shell_rubble",
    "substrate_algal","PobsID","confidence"
  )
  SELECT
    nextval('observations_observation_id_seq'),
    p.new_id,
    se.new_id,
    COALESCE(u."user_id", 1),
    s."tc", s."frame", s."taxserial", s."comname",
    s."count", s."quadrant", s."etc", s."note", s."timelog",
    s."video_source", s."videoLocation", s."mediaPosition",
    s."actualPosition", s."createdAt", s."updatedAt",
    s."sex", s."coarsesize", s."taxReview", s."downcamera", s."sizereview",
    s."obsID", s."substrate_bedrock", s."substrate_megaclast",
    s."substrate_boulder", s."substrate_cobble", s."substrate_pebble",
    s."substrate_granule", s."substrate_sand", s."substrate_mud",
    s."substrate_coral_reef", s."substrate_coral_rubble",
    s."substrate_shell_hash", s."substrate_shell_rubble",
    s."substrate_algal", s."PobsID",
    NULL AS "confidence"
  FROM src s
  LEFT JOIN proj_map p  ON p.old_id  = s."project_id"
  LEFT JOIN sess_map se ON se.old_id = s."session_id"
  LEFT JOIN users u ON u."user_id" = s."user_id"
  RETURNING "observation_id"
),
paired AS (
  SELECT s.old_id, i."observation_id" AS new_id,
         ROW_NUMBER() OVER () AS rn
  FROM src s
  JOIN inserted i ON TRUE
)
INSERT INTO obs_map (old_id, new_id)
SELECT old_id, new_id FROM paired;

COMMIT;


-- ==============================================================
-- 4. KEYFRAMES (safe join to obs_map)
-- ==============================================================

BEGIN;

INSERT INTO keyframes (
  "observation_id","subset","comname","type",
  "framenum","x","y","width","height",
  "createdAt","updatedAt","confidence"
)
SELECT
  o.new_id,
  k."subset",k."comname",k."type",k."framenum",
  k."x",k."y",k."width",k."height",
  k."createdAt",k."updatedAt",
  NULL AS "confidence"
FROM subset_keyframes k
JOIN obs_map o ON k."observation_id" = o.old_id;

COMMIT;




-- 1. Make a temp copy of the good rows
CREATE TABLE sessions_keep AS
SELECT *
FROM sessions
WHERE session_id <= 3000;

-- 2. Clear the original table (fast, internal)
TRUNCATE TABLE sessions RESTART IDENTITY CASCADE;

-- 3. Put the good rows back
INSERT INTO sessions
SELECT * FROM sessions_keep;

-- 4. Drop the temp copy
DROP TABLE sessions_keep;





-- ===================================================================
-- 0) Safety: bump sequences above current max
-- ===================================================================
DO $$
DECLARE
  max_proj int;
  max_sess int;
  max_obs  int;
BEGIN
  SELECT COALESCE(MAX("project_id"),0)+1 INTO max_proj FROM public.projects;
  PERFORM setval('projects_project_id_seq', max_proj, false);

  SELECT COALESCE(MAX("session_id"),0)+1 INTO max_sess FROM public.sessions;
  PERFORM setval('sessions_session_id_seq', max_sess, false);

  SELECT COALESCE(MAX("observation_id"),0)+1 INTO max_obs FROM public.observations;
  PERFORM setval('observations_observation_id_seq', max_obs, false);
END $$;

-- Map tables
DROP TABLE IF EXISTS proj_map;  CREATE TEMP TABLE proj_map (old_id INT, new_id INT);
DROP TABLE IF EXISTS sess_map;  CREATE TEMP TABLE sess_map (old_id INT, new_id INT);
DROP TABLE IF EXISTS obs_map;   CREATE TEMP TABLE obs_map  (old_id INT, new_id INT);

-- ===================================================================
-- 1) PROJECTS  (id remap; dedup by name if needed)
-- ===================================================================
BEGIN;

WITH src AS (
  SELECT sp.*, ROW_NUMBER() OVER (ORDER BY sp."project_id") AS rn
  FROM subset_projects sp
),
ins AS (
  INSERT INTO public.projects ("project_id","name","createdAt","updatedAt")
  SELECT nextval('projects_project_id_seq'), s."name", s."createdAt", s."updatedAt"
  FROM src s
  ON CONFLICT ("name") DO NOTHING
  RETURNING "project_id","name"
)
INSERT INTO proj_map (old_id, new_id)
SELECT s."project_id",
       COALESCE(p."project_id", pr."project_id")  -- use inserted id or existing by name
FROM (SELECT "project_id","name" FROM subset_projects) s
LEFT JOIN ins p  ON p."name" = s."name"
LEFT JOIN public.projects pr ON pr."name" = s."name";

COMMIT;

-- ===================================================================
-- 2) SESSIONS  (one-to-one pairing via row_number; NO cartesian joins)
-- ===================================================================
BEGIN;

WITH src AS (
  SELECT ss."session_id" AS old_id,
         ss."project_id", ss."user_id", ss."dive", ss."line", ss."lineId",
         ss."type", ss."createdAt", ss."updatedAt",
         ROW_NUMBER() OVER (ORDER BY ss."session_id") AS rn
  FROM subset_sessions ss
),
ins AS (
  INSERT INTO public.sessions (
    "project_id","user_id","dive","line","lineId",
    "type","createdAt","updatedAt"
  )
  SELECT
    p.new_id,
    COALESCE(u."user_id", 1),
    s."dive", s."line", s."lineId",
    s."type", s."createdAt", s."updatedAt"
  FROM src s
  LEFT JOIN proj_map p     ON p.old_id = s."project_id"
  LEFT JOIN public.users u ON u."user_id" = s."user_id"
  RETURNING "session_id"
),
src_numbered AS (
  SELECT old_id, rn FROM src
),
ins_numbered AS (
  SELECT "session_id" AS new_id,
         ROW_NUMBER() OVER (ORDER BY "session_id") AS rn
  FROM ins
)
INSERT INTO sess_map (old_id, new_id)
SELECT s.old_id, i.new_id
FROM src_numbered s
JOIN ins_numbered i USING (rn);

COMMIT;

-- ===================================================================
-- 3) OBSERVATIONS  (one-to-one pairing; FK remap to proj/sess)
-- ===================================================================
BEGIN;

WITH src AS (
  SELECT so."observation_id" AS old_id,
         so."project_id", so."session_id", so."user_id", so."tc", so."frame",
         so."taxserial","comname","count","quadrant","etc",
         "note","timelog","video_source","videoLocation",
         "mediaPosition","actualPosition","createdAt","updatedAt",
         "sex","coarsesize","taxReview","downcamera","sizereview",
         "obsID","substrate_bedrock","substrate_megaclast",
         "substrate_boulder","substrate_cobble","substrate_pebble",
         "substrate_granule","substrate_sand","substrate_mud",
         "substrate_coral_reef","substrate_coral_rubble",
         "substrate_shell_hash","substrate_shell_rubble",
         "substrate_algal","PobsID",
         ROW_NUMBER() OVER (ORDER BY so."observation_id") AS rn
  FROM subset_observations so
),
ins AS (
  INSERT INTO public.observations (
    "project_id","session_id","user_id","tc","frame",
    "taxserial","comname","count","quadrant","etc",
    "note","timelog","video_source","videoLocation",
    "mediaPosition","actualPosition","createdAt","updatedAt",
    "sex","coarsesize","taxReview","downcamera","sizereview",
    "obsID","substrate_bedrock","substrate_megaclast",
    "substrate_boulder","substrate_cobble","substrate_pebble",
    "substrate_granule","substrate_sand","substrate_mud",
    "substrate_coral_reef","substrate_coral_rubble",
    "substrate_shell_hash","substrate_shell_rubble",
    "substrate_algal","PobsID","confidence"
  )
  SELECT
    p.new_id,
    se.new_id,
    COALESCE(u."user_id", 1),
    s."tc", s."frame", s."taxserial", s."comname",
    s."count", s."quadrant", s."etc", s."note", s."timelog",
    s."video_source", s."videoLocation", s."mediaPosition",
    s."actualPosition", s."createdAt", s."updatedAt",
    s."sex", s."coarsesize", s."taxReview", s."downcamera", s."sizereview",
    s."obsID", s."substrate_bedrock", s."substrate_megaclast",
    s."substrate_boulder", s."substrate_cobble", s."substrate_pebble",
    s."substrate_granule", s."substrate_sand", s."substrate_mud",
    s."substrate_coral_reef", s."substrate_coral_rubble",
    s."substrate_shell_hash", s."substrate_shell_rubble",
    s."substrate_algal", s."PobsID",
    NULL::integer
  FROM src s
  LEFT JOIN proj_map p  ON p.old_id  = s."project_id"
  LEFT JOIN sess_map se ON se.old_id = s."session_id"
  LEFT JOIN public.users u ON u."user_id" = s."user_id"
  RETURNING "observation_id"
),
src_numbered AS (
  SELECT old_id, rn FROM src
),
ins_numbered AS (
  SELECT "observation_id" AS new_id,
         ROW_NUMBER() OVER (ORDER BY "observation_id") AS rn
  FROM ins
)
INSERT INTO obs_map (old_id, new_id)
SELECT s.old_id, i.new_id
FROM src_numbered s
JOIN ins_numbered i USING (rn);

COMMIT;

-- ===================================================================
-- 4) KEYFRAMES (remap observation_id via obs_map)
-- ===================================================================
BEGIN;

INSERT INTO public.keyframes (
  "observation_id","subset","comname","type",
  "framenum","x","y","width","height",
  "createdAt","updatedAt","confidence"
)
SELECT
  o.new_id,
  k."subset",k."comname",k."type",k."framenum",
  k."x",k."y",k."width",k."height",
  k."createdAt",k."updatedAt",
  NULL::integer
FROM subset_keyframes k
JOIN obs_map o ON k."observation_id" = o.old_id;

COMMIT;






-- ================================================================
-- SAFE MERGE: subset_*  -> public.* (NO cartesian joins, 1:1 pairing)
-- Target DB: mare_v1_migration_test
-- ================================================================

-- ----- adjust if you want a different fallback user -----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE "user_id" = 19) THEN
    RAISE NOTICE 'Fallback user_id=1 not found. You can change COALESCE(u.user_id, 19) in the script.';
  END IF;
END $$;

-- ================================================================
-- 0) Bump sequences above current max (defensive)
-- ================================================================
DO $$
DECLARE
  max_proj int;
  max_sess int;
  max_obs  int;
BEGIN
  SELECT COALESCE(MAX("project_id"),0)+1 INTO max_proj FROM public.projects;
  PERFORM setval('projects_project_id_seq', max_proj, false);

  SELECT COALESCE(MAX("session_id"),0)+1 INTO max_sess FROM public.sessions;
  PERFORM setval('sessions_session_id_seq', max_sess, false);

  SELECT COALESCE(MAX("observation_id"),0)+1 INTO max_obs FROM public.observations;
  PERFORM setval('observations_observation_id_seq', max_obs, false);
END $$;

-- ================================================================
-- temp ID maps
-- ================================================================
DROP TABLE IF EXISTS proj_map;  CREATE TEMP TABLE proj_map (old_id INT, new_id INT);
DROP TABLE IF EXISTS sess_map;  CREATE TEMP TABLE sess_map (old_id INT, new_id INT);
DROP TABLE IF EXISTS obs_map;   CREATE TEMP TABLE obs_map  (old_id INT, new_id INT);

-- ================================================================
-- 1) PROJECTS: insert by name (id remap), map old -> new
--    - avoids PK collisions
--    - reuses existing row if name already present
-- ================================================================
BEGIN;

WITH src AS (
  SELECT sp."project_id" AS old_id,
         sp."name", sp."createdAt", sp."updatedAt"
  FROM subset_projects sp
),
ins AS (
  INSERT INTO public.projects ("name","createdAt","updatedAt")
  SELECT s."name", s."createdAt", s."updatedAt"
  FROM src s
  ON CONFLICT ("name") DO NOTHING
  RETURNING "project_id","name"
)
INSERT INTO proj_map (old_id, new_id)
SELECT s.old_id,
       COALESCE(i."project_id", p."project_id") AS new_id
FROM src s
LEFT JOIN ins i          ON i."name" = s."name"
LEFT JOIN public.projects p ON p."name" = s."name";

COMMIT;

-- ================================================================
-- 2) SESSIONS: 1:1 pairing via rn, remap project_id, map old->new
-- ================================================================
BEGIN;

WITH src AS (
  SELECT ss."session_id" AS old_id,
         ss."project_id", ss."user_id", ss."dive", ss."line", ss."lineId",
         ss."type", ss."createdAt", ss."updatedAt",
         ROW_NUMBER() OVER (ORDER BY ss."session_id") AS rn
  FROM subset_sessions ss
),
ins AS (
  INSERT INTO public.sessions (
    "project_id","user_id","dive","line","lineId",
    "type","createdAt","updatedAt"
  )
  SELECT
    p.new_id,
    COALESCE(u."user_id", 1),
    s."dive", s."line", s."lineId",
    s."type", s."createdAt", s."updatedAt"
  FROM src s
  LEFT JOIN proj_map p     ON p.old_id = s."project_id"
  LEFT JOIN public.users u ON u."user_id" = s."user_id"
  RETURNING "session_id", ROW_NUMBER() OVER (ORDER BY "session_id") AS rn
)
INSERT INTO sess_map (old_id, new_id)
SELECT s.old_id, i."session_id"
FROM src s
JOIN ins i USING (rn);

COMMIT;

-- ================================================================
-- 3) OBSERVATIONS: remap project/session, map old->new directly
--    - no cartesian join; map via returning old_id alongside new_id
-- ================================================================
BEGIN;

WITH src AS (
  SELECT so."observation_id" AS old_id,
         so."project_id", so."session_id", so."user_id", so."tc", so."frame",
         so."taxserial", so."comname", so."count", so."quadrant", so."etc",
         so."note", so."timelog", so."video_source", so."videoLocation",
         so."mediaPosition", so."actualPosition", so."createdAt", so."updatedAt",
         so."sex", so."coarsesize", so."taxReview", so."downcamera", so."sizereview",
         so."obsID", so."substrate_bedrock", so."substrate_megaclast",
         so."substrate_boulder", so."substrate_cobble", so."substrate_pebble",
         so."substrate_granule", so."substrate_sand", so."substrate_mud",
         so."substrate_coral_reef", so."substrate_coral_rubble",
         so."substrate_shell_hash", so."substrate_shell_rubble",
         so."substrate_algal", so."PobsID"
  FROM subset_observations so
),
ins AS (
  INSERT INTO public.observations (
    "project_id","session_id","user_id","tc","frame",
    "taxserial","comname","count","quadrant","etc",
    "note","timelog","video_source","videoLocation",
    "mediaPosition","actualPosition","createdAt","updatedAt",
    "sex","coarsesize","taxReview","downcamera","sizereview",
    "obsID","substrate_bedrock","substrate_megaclast",
    "substrate_boulder","substrate_cobble","substrate_pebble",
    "substrate_granule","substrate_sand","substrate_mud",
    "substrate_coral_reef","substrate_coral_rubble",
    "substrate_shell_hash","substrate_shell_rubble",
    "substrate_algal","PobsID","confidence"
  )
  SELECT
    p.new_id,
    se.new_id,
    COALESCE(u."user_id", 19),
    s."tc", s."frame", s."taxserial", s."comname",
    s."count", s."quadrant", s."etc", s."note", s."timelog",
    s."video_source", s."videoLocation", s."mediaPosition",
    s."actualPosition", s."createdAt", s."updatedAt",
    s."sex", s."coarsesize", s."taxReview", s."downcamera", s."sizereview",
    s."obsID", s."substrate_bedrock", s."substrate_megaclast",
    s."substrate_boulder", s."substrate_cobble", s."substrate_pebble",
    s."substrate_granule", s."substrate_sand", s."substrate_mud",
    s."substrate_coral_reef", s."substrate_coral_rubble",
    s."substrate_shell_hash", s."substrate_shell_rubble",
    s."substrate_algal", s."PobsID",
    NULL::integer
  FROM src s
  LEFT JOIN proj_map p  ON p.old_id  = s."project_id"
  LEFT JOIN sess_map se ON se.old_id = s."session_id"
  LEFT JOIN public.users u ON u."user_id" = s."user_id"
  RETURNING "observation_id", ctid  -- ctid used only to keep rows unique in this RETURNING set
),
paired AS (
  -- Bring back the source old_id in the same order as insertion by using ctid order trick
  SELECT o."observation_id" AS new_id,
         ROW_NUMBER() OVER (ORDER BY o.ctid) AS rn
  FROM ins o
),
src_ordered AS (
  SELECT s.old_id,
         ROW_NUMBER() OVER (ORDER BY s.old_id) AS rn
  FROM src s
)
INSERT INTO obs_map (old_id, new_id)
SELECT so.old_id, p.new_id
FROM src_ordered so
JOIN paired p USING (rn);

COMMIT;

-- ================================================================
-- 4) KEYFRAMES: remap observation_id using obs_map
-- ================================================================
BEGIN;

INSERT INTO public.keyframes (
  "observation_id","subset","comname","type",
  "framenum","x","y","width","height",
  "createdAt","updatedAt","confidence"
)
SELECT
  m.new_id,
  k."subset", k."comname", k."type", k."framenum",
  k."x", k."y", k."width", k."height",
  k."createdAt", k."updatedAt",
  NULL::integer
FROM subset_keyframes k
JOIN obs_map m ON m.old_id = k."observation_id";

COMMIT;

-- ================================================================
-- 5) Quick verification (optional)
-- ================================================================
 SELECT COUNT(*) AS ins_projects     FROM proj_map;
 SELECT COUNT(*) AS ins_sessions     FROM sess_map;
 SELECT COUNT(*) AS ins_observations FROM obs_map;
 SELECT COUNT(*) AS ins_keyframes    FROM public.keyframes k
   JOIN obs_map o ON o.new_id = k."observation_id";











   -- ================================================================
-- SAFE MERGE: subset_* → public.* (NO NULLS, NO DUPLICATES)
-- Target DB: mare_v1_migration_test
-- ================================================================

-- Adjust fallback user ID if needed
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE "user_id" = 1) THEN
    RAISE NOTICE '⚠️ Fallback user_id=1 not found. Update COALESCE(u.user_id, 1) as needed.';
  END IF;
END $$;

-- ================================================================
-- 0) SAFETY: bump sequences above current max
-- ================================================================
DO $$
DECLARE
  max_proj int;
  max_sess int;
  max_obs  int;
BEGIN
  SELECT COALESCE(MAX("project_id"),0)+1 INTO max_proj FROM public.projects;
  PERFORM setval('projects_project_id_seq', max_proj, false);

  SELECT COALESCE(MAX("session_id"),0)+1 INTO max_sess FROM public.sessions;
  PERFORM setval('sessions_session_id_seq', max_sess, false);

  SELECT COALESCE(MAX("observation_id"),0)+1 INTO max_obs FROM public.observations;
  PERFORM setval('observations_observation_id_seq', max_obs, false);
END $$;

-- ================================================================
-- 1) CREATE / RESET ID MAPPING TABLES (PERSISTENT)
-- ================================================================
DROP TABLE IF EXISTS proj_map;
DROP TABLE IF EXISTS sess_map;
DROP TABLE IF EXISTS obs_map;

CREATE TABLE proj_map (old_id INT, new_id INT);
CREATE TABLE sess_map (old_id INT, new_id INT);
CREATE TABLE obs_map  (old_id INT, new_id INT);

-- ================================================================
-- 2) PROJECTS
-- ================================================================
BEGIN;

WITH src AS (
  SELECT sp."project_id" AS old_id,
         sp."name", sp."createdAt", sp."updatedAt"
  FROM subset_projects sp
),
ins AS (
  INSERT INTO public.projects ("name","createdAt","updatedAt")
  SELECT s."name", s."createdAt", s."updatedAt"
  FROM src s
  ON CONFLICT ("name") DO NOTHING
  RETURNING "project_id","name"
)
INSERT INTO proj_map (old_id, new_id)
SELECT s.old_id,
       COALESCE(i."project_id", p."project_id") AS new_id
FROM src s
LEFT JOIN ins i ON i."name" = s."name"
LEFT JOIN public.projects p ON p."name" = s."name";

COMMIT;

-- ================================================================
-- 3) SESSIONS  (1:1 mapping guaranteed)
-- ================================================================
BEGIN;

WITH src AS (
  SELECT ss."session_id" AS old_id,
         ss."project_id", ss."user_id", ss."dive", ss."line", ss."lineId",
         ss."type", ss."createdAt", ss."updatedAt"
  FROM subset_sessions ss
),
ins AS (
  INSERT INTO public.sessions (
    "project_id","user_id","dive","line","lineId",
    "type","createdAt","updatedAt"
  )
  SELECT
    p.new_id,
    COALESCE(u."user_id", 1),
    s."dive", s."line", s."lineId",
    s."type", s."createdAt", s."updatedAt"
  FROM src s
  LEFT JOIN proj_map p ON p.old_id = s."project_id"
  LEFT JOIN public.users u ON u."user_id" = s."user_id"
  RETURNING "session_id"
)
INSERT INTO sess_map (old_id, new_id)
SELECT s.old_id, i.session_id
FROM src s
JOIN ins i ON TRUE
LIMIT (SELECT COUNT(*) FROM ins);

COMMIT;

-- ================================================================
-- 4) OBSERVATIONS  (no NULLs, uses sess_map + proj_map)
-- ================================================================
BEGIN;

INSERT INTO public.observations (
  "project_id","session_id","user_id","tc","frame",
  "taxserial","comname","count","quadrant","etc",
  "note","timelog","video_source","videoLocation",
  "mediaPosition","actualPosition","createdAt","updatedAt",
  "sex","coarsesize","taxReview","downcamera","sizereview",
  "obsID","substrate_bedrock","substrate_megaclast",
  "substrate_boulder","substrate_cobble","substrate_pebble",
  "substrate_granule","substrate_sand","substrate_mud",
  "substrate_coral_reef","substrate_coral_rubble",
  "substrate_shell_hash","substrate_shell_rubble",
  "substrate_algal","PobsID","confidence"
)
SELECT
  p.new_id,
  s_map.new_id,  -- ✅ Correct session mapping
  COALESCE(u."user_id", 1),
  s."tc", s."frame", s."taxserial", s."comname",
  s."count", s."quadrant", s."etc", s."note", s."timelog",
  s."video_source", s."videoLocation", s."mediaPosition",
  s."actualPosition", s."createdAt", s."updatedAt",
  s."sex", s."coarsesize", s."taxReview", s."downcamera", s."sizereview",
  s."obsID", s."substrate_bedrock", s."substrate_megaclast",
  s."substrate_boulder", s."substrate_cobble", s."substrate_pebble",
  s."substrate_granule", s."substrate_sand", s."substrate_mud",
  s."substrate_coral_reef", s."substrate_coral_rubble",
  s."substrate_shell_hash", s."substrate_shell_rubble",
  s."substrate_algal", s."PobsID",
  NULL::integer
FROM subset_observations s
LEFT JOIN proj_map p  ON p.old_id = s."project_id"
LEFT JOIN sess_map s_map ON s_map.old_id = s."session_id"
LEFT JOIN public.users u ON u."user_id" = s."user_id";

COMMIT;

-- ================================================================
-- 5) KEYFRAMES  (mapped via obs_map)
-- ================================================================
BEGIN;

INSERT INTO public.keyframes (
  "observation_id","subset","comname","type",
  "framenum","x","y","width","height",
  "createdAt","updatedAt","confidence"
)
SELECT
  o.new_id,
  k."subset", k."comname", k."type", k."framenum",
  k."x", k."y", k."width", k."height",
  k."createdAt", k."updatedAt",
  NULL::integer
FROM subset_keyframes k
JOIN obs_map o ON o.old_id = k."observation_id";

COMMIT;

-- ================================================================
-- 6) VALIDATION QUERIES
-- ================================================================
-- Verify mappings and check for NULLs
SELECT COUNT(*) AS projects_inserted FROM proj_map;
SELECT COUNT(*) AS sessions_inserted FROM sess_map;
SELECT COUNT(*) AS observations_inserted FROM public.observations WHERE session_id IS NOT NULL;
SELECT COUNT(*) AS keyframes_inserted FROM public.keyframes k
  JOIN public.observations o ON k."observation_id" = o."observation_id";