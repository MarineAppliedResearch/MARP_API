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

app.use('/api/getObservationsByVideo', (req, res) => {
    observationController.getObservationsByVideo(req.query.videoName).then(data => res.json(data));
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

// POST HERE

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
