/**
 * Inference sessions belong to the "MARP Inference" processor, and both
 * session lists say which model wrote a session's observations.
 *
 * The migration's `up` is run again over sessions this suite builds, one per
 * case the backfill has to tell apart. Running it again is safe: the account is
 * created only if missing, and every machine-made session already in the
 * database was moved the first time, so only this suite's rows can match.
 *
 * Requirement ids are from `.marp/task-inference-processor-account.md`.
 *
 * @fileoverview Tests for the inference processor account and session `models`.
 * @author Isaac Travers
 * @module tests/inference-processor
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');
const migration = require('../migrations/20261006120000-create-inference-processor');
const fillVideoLocation = require('../migrations/20261006130000-fill-inference-video-location');
const { INFERENCE_PROCESSOR_NAME, inferenceProcessorId } = require('../db/inference-processor');

describe('The inference processor', () => {

  /** Unique per run, so a half-cleaned earlier run cannot collide. @constant @type {number} */
  const runId = Date.now();

  /** @constant @type {string} */
  const projectName = `jest-inference-processor-project-${runId}`;

  /** @constant @type {string} */
  const modelName = `jest-inference-processor-model-${runId}`;

  /** @constant @type {string} */
  const humanName = `jest-inference-processor-human-${runId}`;

  /** Everything this suite creates, removed in afterAll. */
  const seeded = { sessions: {}, observations: [] };

  /**
   * Writes one observation through the API, then marks it as the model's
   * when `byModel` is set -- the API has no field for that, the ingest writes it.
   *
   * @param {number} sessionId - Session to write into.
   * @param {boolean} byModel - Whether to record the seeded model on it.
   * @returns {Promise<number>} The new observation_id.
   */
  async function addObservation(sessionId, byModel) {
    const res = await global.api.post('/api/v2/observation').send({
      observation: {
        session_id: sessionId,
        project_id: seeded.projectId,
        comname: 'Jest Inference Processor Urchin',
        video_source: 'jest-inference-processor.mp4',
      },
    });
    seeded.observations.push(res.body.observation_id);

    if (byModel) {
      await db.sequelize.query(
        'UPDATE observations SET ml_model_id = :modelId WHERE observation_id = :id',
        { replacements: { modelId: seeded.modelId, id: res.body.observation_id } }
      );
    }

    return res.body.observation_id;
  }

  /**
   * videoLocation, video_source and version of the given observations, by id.
   *
   * @param {Array<number>} ids - observation_ids to read.
   * @returns {Promise<Map<number, Object>>}
   */
  async function videoColumns(ids) {
    const rows = await db.sequelize.query(
      'SELECT observation_id, "videoLocation", video_source, version FROM observations WHERE observation_id IN (:ids)',
      { replacements: { ids }, type: QueryTypes.SELECT }
    );
    return new Map(rows.map((row) => [row.observation_id, row]));
  }

  /**
   * Creates one session through the API and records its id.
   *
   * @param {string} label - Key to store the session_id under.
   * @param {number|null} userId - Its processor, or null for none.
   * @returns {Promise<void>}
   */
  async function addSession(label, userId) {
    const res = await global.api.post('/api/v2/session').send({
      session: {
        project_id: seeded.projectId,
        user_id: userId,
        dive: `Dive ${label}`,
        line: '1',
        lineId: `jest-${label}-${runId}`,
        type: 'Invert',
      },
    });
    seeded.sessions[label] = res.body.session_id;
  }

  /**
   * One session per case the backfill has to tell apart, then the migration.
   */
  beforeAll(async () => {
    const projectRes = await global.api.post(`/api/v2/project/createProjectByName/${projectName}`);
    seeded.projectId = projectRes.body.project_id;

    const humanRes = await global.api.post(`/api/v2/processors/by-name/${humanName}`);
    seeded.humanId = humanRes.body.user_id;

    const [model] = await db.sequelize.query(
      `INSERT INTO ml_models (name, model_type, architecture_version, status, notes, created_at, updated_at)
       VALUES (:name, 'YOLOv8', 'mixed', 'trained', 'Seeded by tests/inference-processor.test.js', NOW(), NOW())
       RETURNING id`,
      { replacements: { name: modelName }, type: QueryTypes.INSERT }
    );
    seeded.modelId = model[0].id;

    // No processor, every observation the model's: moves.
    await addSession('machine', null);
    await addObservation(seeded.sessions.machine, true);
    await addObservation(seeded.sessions.machine, true);

    // No processor, one observation entered by hand: stays.
    await addSession('mixed', null);
    seeded.modelRow = await addObservation(seeded.sessions.mixed, true);
    seeded.handRow = await addObservation(seeded.sessions.mixed, false);

    // No processor and no observations: nothing says who made it, so stays.
    await addSession('empty', null);

    // A person's session the model also wrote into: keeps its person.
    await addSession('human', seeded.humanId);
    await addObservation(seeded.sessions.human, true);

    await migration.up(db.sequelize.getQueryInterface());

    // Versions as they stand, so the fill below can be shown not to move them.
    seeded.before = await videoColumns(seeded.observations);
    await fillVideoLocation.up(db.sequelize.getQueryInterface());
  }, 30000);

  /** Children first, so no foreign key is left dangling. */
  afterAll(async () => {
    for (const id of seeded.observations) {
      await global.api.delete(`/api/v2/observation/${id}`);
    }
    for (const id of Object.values(seeded.sessions)) {
      await global.api.delete(`/api/v2/session/${id}`);
    }
    if (seeded.projectId) await global.api.delete(`/api/v2/project/${seeded.projectId}`);
    if (seeded.humanId) await global.api.delete(`/api/v2/processors/${seeded.humanId}`);
    if (seeded.modelId) {
      await db.sequelize.query('DELETE FROM ml_models WHERE id = :id', { replacements: { id: seeded.modelId } });
    }
  });

  /**
   * The processor of each seeded session, by label.
   *
   * @returns {Promise<Object<string, number|null>>}
   */
  async function processors() {
    const rows = await db.sequelize.query(
      'SELECT session_id, user_id FROM sessions WHERE session_id IN (:ids)',
      { replacements: { ids: Object.values(seeded.sessions) }, type: QueryTypes.SELECT }
    );
    const byId = new Map(rows.map((row) => [row.session_id, row.user_id]));
    const result = {};
    for (const [label, id] of Object.entries(seeded.sessions)) result[label] = byId.get(id);
    return result;
  }

  it('R1: exists as exactly one account, which nobody can log in as', async () => {
    const rows = await db.sequelize.query(
      'SELECT user_id, username FROM users WHERE name = :name',
      { replacements: { name: INFERENCE_PROCESSOR_NAME }, type: QueryTypes.SELECT }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBeNull();
  });

  it('R2: takes the session whose every observation a model wrote', async () => {
    const owners = await processors();

    expect(owners.machine).toBe(await inferenceProcessorId(db.sequelize));
  });

  it('R2: leaves a session with a hand-entered observation, an empty one, and a person\'s', async () => {
    const owners = await processors();

    expect(owners.mixed).toBeNull();
    expect(owners.empty).toBeNull();
    expect(owners.human).toBe(seeded.humanId);
  });

  it('R4: the By Dive list names the model on each session it wrote in', async () => {
    const res = await global.api.get(`/api/v2/sessions/project/${seeded.projectId}`);
    const models = new Map(res.body.map((session) => [session.session_id, session.models]));

    expect(res.status).toBe(200);
    expect(models.get(seeded.sessions.machine)).toEqual([modelName]);
    expect(models.get(seeded.sessions.mixed)).toEqual([modelName]);
    expect(models.get(seeded.sessions.human)).toEqual([modelName]);
    expect(models.get(seeded.sessions.empty)).toEqual([]);
  });

  it('R4, R6: the inference processor\'s own list holds the session, with its model', async () => {
    const inferenceId = await inferenceProcessorId(db.sequelize);
    const res = await global.api.get(`/api/v2/sessions/user/${inferenceId}/project/${seeded.projectId}`);

    expect(res.status).toBe(200);
    expect(res.body.map((session) => session.session_id)).toEqual([seeded.sessions.machine]);
    expect(res.body[0].models).toEqual([modelName]);
  });

  it('R8: fills videoLocation from video_source on a row a model wrote', async () => {
    const after = await videoColumns([seeded.modelRow]);

    expect(seeded.before.get(seeded.modelRow).videoLocation).toBeNull();
    expect(after.get(seeded.modelRow).videoLocation).toBe('jest-inference-processor.mp4');
  });

  it('R8: leaves a row a person wrote alone', async () => {
    const after = await videoColumns([seeded.handRow]);

    expect(after.get(seeded.handRow).videoLocation).toBe(seeded.before.get(seeded.handRow).videoLocation);
  });

  it('R8: moves no version, so reviews stay attached to what they were made against', async () => {
    const after = await videoColumns(seeded.observations);

    for (const id of seeded.observations) {
      expect(after.get(id).version).toBe(seeded.before.get(id).version);
    }
  });

  it('R8: leaves the version trigger switched on', async () => {
    const [row] = await db.sequelize.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'observations_bump_version_trigger'`,
      { type: QueryTypes.SELECT }
    );

    expect(row.tgenabled).toBe('O');
  });

  it('R6: the project shows up under the inference processor', async () => {
    const inferenceId = await inferenceProcessorId(db.sequelize);
    const res = await global.api.get(`/api/v2/projects/user/${inferenceId}`);

    expect(res.status).toBe(200);
    expect(res.body.map((project) => project.project_id)).toContain(seeded.projectId);
  });
});
