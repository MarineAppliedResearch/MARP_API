const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config()

const taskController = require('./controller/task.controller') 
const observationController = require('./controller/observation.controller') 
const keyframeController = require('./controller/keyframe.controller') 
const userController = require('./controller/user.controller') 
const projectController = require('./controller/project.controller')
const sessionController = require('./controller/session.controller')
const metaInfoController = require('./controller/metaInfo.controller')
const speciesController = require('./controller/species.controller')
const datasetController = require('./controller/dataset.controller')

//---------------------------------------------------------
//  Database initialization (via models/index.js)
//---------------------------------------------------------
const db = require('./model');




(async () => {


  try {
    await db.sequelize.authenticate();
    console.log('Connected to PostgreSQL.');

    if (process.env.NODE_ENV === 'development') {
      // Manually sync only the models we’re actively developing
      
        //await db.metrics_summary.sync({ alter: true });
        //await db.metrics_curves.sync({ alter: true });
        //await db.training_runs.sync({ alter: true });
        //await db.epochs.sync({ alter: true });
        //await db.ml_models.sync({ alter: true });
        //await db.species.sync({ alter: true });
        //await db.model_species.sync({ alter: true });

  // Explicitly skip syncing `observations`
  console.log('Skipping sync for existing core tables (observations, sessions, etc.)');
      console.log('Development schema synced safely (non-destructive).');
    }

    console.log('Models initialized successfully.');

  } catch (err) {
    console.error('Database initialization failed:', err);
  }
})();


const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// API Documentation Library
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const customCss = fs.readFileSync((process.cwd()+"/swagger.css"), 'utf8');

app.use(bodyParser.json());

// let express to use this
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {customCss}));

// GET HERE

app.use("/api", require("./reporting/routes"));

app.use('/api/getObservationsByVideo', (req, res) => {
    observationController.getObservationsByVideo(req.query.videoName).then(data => res.json(data));
});

/**
 * Returns all observations associated with video videoName that have a comname in comnameList
 * @param {string} req.query.videoName - The name of the video
 * @param {string[]} req.query.comnameList - An array of comname strings to filter observations
 */
app.use('/api/getObservationsByVideoAndComnames', (req, res) => {
    observationController.getObservationsByVideoAndComnames(req.query.videoName, req.query.comnameList).then(data => res.json(data));
});



/**
 * Returns all observations that have associated keyframes and a comname in comnameList
 * @param {string[]} comnameList - An array of comname strings to filter observations
 */
app.use('/api/getObservationsWithKeyframesByComnames', (req, res) => {
    // Decode and split the comma-separated list into an array
    const comnameList = req.query.comnameList
        ? req.query.comnameList.split(',').map(decodeURIComponent) // Decode each comname
        : [];

    observationController
        .getObservationsWithKeyframesByComnames(comnameList)
        .then(data => res.json(data))
        .catch(err => {
            console.error('Error in API call:', err);
            res.status(500).json({ error: 'An error occurred while fetching observations.' });
        });
});

/**
 * Retrieves all distinct comnames from observations that have associated keyframes.
 * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
 */
app.use('/api/getDistinctComnamesWithKeyframes', (req, res) => {
    observationController.getDistinctComnamesWithKeyframes().then(data => res.json(data));
});


app.get('/api/dashboardData', (req, res) => {
    observationController.getUserDashboardData(req.query.start, req.query.end).then(data => res.json(data));
});

app.get('/api/getProjectTimeByDateAndUser', (req, res) => {
    observationController.getProjectTimeByDateAndUser(req.query.start, req.query.end).then(data => res.json(data));
});

app.get('/api/tasks', (req, res) => {
    taskController.getTasks().then(data => res.json(data));
});

app.get('/api/observations', (req, res) => {
    observationController.getObservations().then(data => res.json(data));
});

app.get('/api/observation/getLastVideoInfo/:session_id', (req, res) => {
    observationController.getLastVideoInfo(req.params.session_id).then(data => res.json(data));
});

app.get('/api/observation/updateObservationWithCount/:session_id/:observation_id/:count', (req, res) => {
    observationController.updateObservationWithCount(req.params.session_id, req.params.observation_id, req.params.count).then(data => res.json(data));
});

app.get('/api/observation/updateObservationWithSize/:session_id/:observation_id/:size', (req, res) => {
    observationController.updateObservationWithSize(req.params.session_id, req.params.observation_id, req.params.size).then(data => res.json(data));
});

app.get('/api/observations/bySessionID/:session_id', (req, res) => {
    observationController.getObservationsBySessionID(req.params.session_id).then(data => res.json(data));
});




app.get('/api/species', (req, res) => {
    speciesController.getSpecies().then(data => res.json(data));
});

app.get('/api/species/by-comname/:comname', (req, res) => {
  speciesController.getSpeciesByComname(req, res).then(data => res.json(data));
});

app.post('/api/model_species', (req, res) => {
  speciesController.createModelSpecies(req, res)
    .then(data => res.json(data));
});


app.get('/api/users', (req, res) => {
    userController.getUsers().then(data => res.json(data));
});

app.get('/api/user/:name', (req, res) => {
    userController.getUserByName(req.params.name).then(data => res.json(data));
});

app.get('/api/projects', (req, res) => {
    projectController.getProjects().then(data => res.json(data));
});

app.get('/api/projects/user/:userID', (req, res) => {
    projectController.getProjectsByUserID(req.params.userID).then(data => res.json(data));
});

app.get('/api/project/getProjectByName/:projectName', (req, res) => {
    projectController.getProjectByName(req.params.projectName).then(data => res.json(data));
});

app.get('/api/sessions', (req, res) => {
    sessionController.getSessions().then(data => res.json(data));
});

app.get('/api/sessions/user/:userID/project/:projectID', (req, res) => {
    sessionController.getSessionsByUserIdAndProjectId(req.params.userID, req.params.projectID).then(data => res.json(data));
});

app.get('/api/metaInfo/dbName', (req, res) => {
    metaInfoController.getDBName().then(data => res.json(data));
});

app.get('/api/user/getUserNameByID/:userID', (req, res) => {
    userController.getUserNameByID(req.params.userID).then(data => res.json(data));
});

// GET /api/models
app.get('/api/ml_models', (req, res) => {
    datasetController.getMl_models()
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error fetching models:", err);
            res.status(500).json({ error: "Failed to get models" });
        });
});





app.get('/api/dataset', (req, res) => {
    datasetController.getDatasets().then(data => res.json(data));
});


app.get('/api/dataset/:id', (req, res) => {
    datasetController.getDatasetById(req.params.id)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error fetching dataset:", err);
            res.status(500).json({ error: "Failed to get dataset" });
        });
});

// POST HERE
app.post('/api/dataset', (req, res) => {
    console.log(req.body);
    datasetController.createDataset(req.body.dataset)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating dataset:", err);
            res.status(500).json({ error: "Failed to create dataset" });
        });
});


// ==========================================================
// POST /api/model
// ----------------------------------------------------------
// Creates a new ML model record in the database.
// Expects a JSON payload like:
// {
//   "model": {
//     "name": "yolov8_fish_2025",
//     "parent_model_id": 1,
//     "model_type": "YOLOv8",
//     "architecture_version": "custom-2025a",
//     "storage_path": "models/yolov8_fish_2025/weights",
//     "status": "training",
//     "notes": "Fine-tuned from yolov8_base on Fish2025 dataset"
//   }
// }
// ==========================================================
app.post('/api/model', (req, res) => {
    console.log("[API] POST /api/model", req.body);

    datasetController.createModel(req.body.model)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating model:", err);
            res.status(500).json({ error: "Failed to create model" });
        });
});


// POST /api/training_run
app.post('/api/training_run', (req, res) => {
    console.log(req.body);
    datasetController.createTrainingRun(req.body.training_run)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating training run:", err);
            res.status(500).json({ error: "Failed to create training run" });
        });
});


// PUT /api/training_run/:id
app.put('/api/training_run/:id', (req, res) => {
    const id = req.params.id;
    datasetController.updateTrainingRun(id, req.body.training_run)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error updating training run:", err);
            res.status(500).json({ error: "Failed to update training run" });
        });
});


// POST /api/metrics_summary
app.post('/api/metrics_summary', (req, res) => {
    datasetController.createMetricsSummary(req.body.metrics_summary)
        .then(data => res.json(data))
        .catch(err => res.status(500).json({ error: "Failed to create metrics_summary" }));
});

// POST /api/metrics_curve
app.post('/api/metrics_curve', (req, res) => {
    datasetController.createMetricsCurve(req.body.metrics_curve)
        .then(data => res.json(data))
        .catch(err => res.status(500).json({ error: "Failed to create metrics_curve" }));
});


// server.js or routes.js
app.post('/api/metrics_curves/bulk', (req, res) => {
  datasetController.bulkCreateMetricsCurves(req, res)
    .then(data => res.json(data));
});

// POST /api/epoch
app.post('/api/epoch', (req, res) => {
    console.log(req.body);
    datasetController.createEpoch(req.body.epoch)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating epoch:", err);
            res.status(500).json({ error: "Failed to create epoch" });
        });
});


// PUT /api/epoch/:id
app.put('/api/epoch/:id', (req, res) => {
    const id = req.params.id;
    datasetController.updateEpoch(id, req.body.epoch)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error updating epoch:", err);
            res.status(500).json({ error: "Failed to update epoch" });
        });
});



// ==========================================================
// PUT /api/model/:id
// ----------------------------------------------------------
// Updates an existing ML model record.
// Expects a JSON payload like:
// {
//   "model": {
//     "storage_path": "models/yolov8_fish_2025/weights",
//     "status": "trained",
//     "updated_at": "2025-10-08T14:30:00Z"
//   }
// }
// ==========================================================
app.put('/api/model/:id', (req, res) => {
    console.log(`[API] PUT /api/model/${req.params.id}`, req.body);

    datasetController.updateModel(req.params.id, req.body.model)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error updating model:", err);
            res.status(500).json({ error: "Failed to update model" });
        });
});


// POST /api/dataset_observation
app.post('/api/dataset_observation', (req, res) => {
    console.log(req.body);
    datasetController.createDatasetObservation(req.body.dataset_observation)
        .then(data => res.json(data))
        .catch(err => {
            console.error("Error creating dataset_observation:", err);
            res.status(500).json({ error: "Failed to create dataset_observation" });
        });
});


// POST /api/dataset_observations/bulk
app.post('/api/dataset_observations/bulk', (req, res) => {
    console.log(`[INFO] Bulk insert ${req.body.dataset_observations?.length || 0} dataset_observations`);
    datasetController.bulkCreateDatasetObservations(req.body.dataset_observations)
        .then(data => res.json({ inserted: data.length }))
        .catch(err => {
            console.error("Error in bulk dataset_observation insert:", err);
            res.status(500).json({ error: "Failed bulk insert" });
        });
});


app.post('/api/task', (req, res) => {
    console.log(req.body);
    taskController.createTask(req.body.task).then(data => res.json(data));
});

app.post('/api/observation', (req, res) => {
    console.log(req.body);
    observationController.createObservation(req.body.observation).then(data => res.json(data));
});

app.post('/api/keyframe', (req, res) => {
    keyframeController.createKeyframes(req.body).then(data => res.json(data));
});

app.post('/api/user', (req, res) => {
    console.log(req.body);
    userController.createUser(req.body.user).then(data => res.json(data));
});

app.post('/api/user/createUserByName/:userName', (req, res) => {
    console.log(req.body);
    userController.createUserByName(req.params.userName).then(data => res.json(data));
});

app.post('/api/project', (req, res) => {
    console.log(req.body);
    projectController.createProject(req.body.project).then(data => res.json(data));
});

app.post('/api/project/createProjectByName/:projectName', (req, res) => {
    console.log(req.body);
    projectController.createProjectByName(req.params.projectName).then(data => res.json(data));
});

app.post('/api/session', (req, res) => {
    console.log(req.body);
    sessionController.createSession(req.body.session).then(data => res.json(data));
});

app.post('/api/session/createNewSession/:processorName/:projectName/:line/:dive/:lineID/:type', (req, res) => {
    console.log(req.body);
    sessionController.createSessionAndProjectandProcessor(req.params.processorName, req.params.projectName, req.params.line, req.params.dive, req.params.lineID, req.params.type).then(data => res.json(data));
});

//PUT HERE

app.put('/api/task', (req, res) => {
    taskController.updateTask(req.body.task).then(data => res.json(data));
});

app.put('/api/observation', (req, res) => {
    observationController.updateObservation(req.body.observation).then(data => res.json(data));
});

app.put('/api/user', (req, res) => {
    userController.updateUser(req.body.user).then(data => res.json(data));
});

app.put('/api/project', (req, res) => {
    projectController.updateProject(req.body.project).then(data => res.json(data));
});

app.put('/api/session', (req, res) => {
    sessionController.updateSession(req.body.session).then(data => res.json(data));
});

//DELETE HERE

app.delete('/api/task/:id', (req, res) => {
    taskController.deleteTask(req.params.id).then(data => res.json(data));
});

app.delete('/api/observation/:id', (req, res) => {
    observationController.deleteObservation(req.params.id).then(data => res.json(data));
});

app.delete('/api/keyframe/:keyframe_id', (req, res) => {
    keyframeController.deleteKeyframe(req.params.keyframe_id).then(data => res.json(data));
});

app.delete('/api/user/:id', (req, res) => {
    userController.deleteUser(req.params.id).then(data => res.json(data));
});

app.delete('/api/project/:id', (req, res) => {
    projectController.deleteProject(req.params.id).then(data => res.json(data));
});

app.delete('/api/session/:id', (req, res) => {
    sessionController.deleteSession(req.params.id).then(data => res.json(data));
});

// Serve static files from the "html" folder
app.use(express.static('html'));

// Catch-all route to serve index.html if no specific file is requested or if the file is not found
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/html/index.html');  // Serves index.html for all non-API routes
});

app.listen(port, () => {
    console.log(`Server listening on the port  ${port}`);
})
