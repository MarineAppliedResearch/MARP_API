-- ===================================================================
-- MARP Subset Merge Script (Full Remap, All CTE Scope Fixed)
-- Safely imports "R" observations & related data from subset_* tables.
-- ===================================================================

BEGIN;

-- Drop old temp mapping tables (if any)
DROP TABLE IF EXISTS proj_map;
DROP TABLE IF EXISTS sess_map;
DROP TABLE IF EXISTS obs_map;

CREATE TEMP TABLE proj_map (old_id INT, new_id INT);
CREATE TEMP TABLE sess_map (old_id INT, new_id INT);
CREATE TEMP TABLE obs_map  (old_id INT, new_id INT);

-- ==============================================================
-- 1. PROJECTS (regenerate IDs)
-- ==============================================================
WITH
src AS (
  SELECT *, ROW_NUMBER() OVER () AS rn
  FROM subset_projects
),
new_ids AS (
  SELECT nextval(pg_get_serial_sequence('projects','project_id')) AS new_id,
         ROW_NUMBER() OVER () AS rn
  FROM src
),
ins AS (
  INSERT INTO projects ("project_id","name","createdAt","updatedAt")
  SELECT n.new_id, s."name", s."createdAt", s."updatedAt"
  FROM src s
  JOIN new_ids n USING (rn)
  RETURNING "project_id"
)
INSERT INTO proj_map (old_id,new_id)
SELECT s."project_id", n.new_id
FROM src s
JOIN new_ids n USING (rn);

-- ==============================================================
-- 2. SESSIONS (regenerate IDs, remap project_id)
-- ==============================================================
WITH
src AS (
  SELECT *, ROW_NUMBER() OVER () AS rn
  FROM subset_sessions
),
new_ids AS (
  SELECT nextval(pg_get_serial_sequence('sessions','session_id')) AS new_id,
         ROW_NUMBER() OVER () AS rn
  FROM src
),
ins AS (
  INSERT INTO sessions (
    "session_id","project_id","user_id","dive","line","lineId",
    "type","createdAt","updatedAt"
  )
  SELECT
    n.new_id,
    p.new_id,  -- remapped project
    s."user_id", s."dive", s."line", s."lineId",
    s."type", s."createdAt", s."updatedAt"
  FROM src s
  JOIN new_ids n USING (rn)
  LEFT JOIN proj_map p ON p.old_id = s."project_id"
  RETURNING "session_id"
)
INSERT INTO sess_map (old_id,new_id)
SELECT s."session_id", n.new_id
FROM src s
JOIN new_ids n USING (rn);

-- ==============================================================
-- 3. OBSERVATIONS (regenerate IDs, remap session/project)
-- ==============================================================
WITH
src AS (
  SELECT *, ROW_NUMBER() OVER () AS rn
  FROM subset_observations
  WHERE note = 'R'
),
new_ids AS (
  SELECT nextval(pg_get_serial_sequence('observations','observation_id')) AS new_id,
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
    p.new_id,        -- remapped project
    se.new_id,       -- remapped session
    s."user_id", s."tc", s."frame", s."taxserial", s."comname",
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
  RETURNING "observation_id"
)
INSERT INTO obs_map (old_id,new_id)
SELECT s."observation_id", n.new_id
FROM src s
JOIN new_ids n USING (rn);

-- ==============================================================
-- 4. KEYFRAMES (remap observation_id)
-- ==============================================================
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
-- 5. Verification Queries (optional)
-- ==============================================================
-- SELECT COUNT(*) AS new_projects FROM proj_map;
-- SELECT COUNT(*) AS new_sessions FROM sess_map;
-- SELECT COUNT(*) AS new_observations FROM obs_map;
-- SELECT COUNT(*) FROM keyframes k JOIN observations o ON k."observation_id"=o."observation_id" WHERE o.note='R';
