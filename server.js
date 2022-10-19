const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs')
require('dotenv').config()

const taskController = require('./controller/task.controller') 
const observationController = require('./controller/observation.controller') 
const userController = require('./controller/user.controller') 

const app = express();
const port = process.env.PORT || 3000;

// API Documentation Library
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const customCss = fs.readFileSync((process.cwd()+"/swagger.css"), 'utf8');

app.use(bodyParser.json());

// let express to use this
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {customCss}));

app.get('/api/tasks', (req, res) => {
    taskController.getTasks().then(data => res.json(data));
});

app.get('/api/observations', (req, res) => {
    observationController.getObservations().then(data => res.json(data));
});

app.get('/api/users', (req, res) => {
    userController.getUsers().then(data => res.json(data));
});

app.post('/api/task', (req, res) => {
    console.log(req.body);
    taskController.createTask(req.body.task).then(data => res.json(data));
});

app.post('/api/observation', (req, res) => {
    console.log(req.body);
    observationController.createObservation(req.body.observation).then(data => res.json(data));
});

app.post('/api/user', (req, res) => {
    console.log(req.body);
    userController.createUser(req.body.user).then(data => res.json(data));
});

app.put('/api/task', (req, res) => {
    taskController.updateTask(req.body.task).then(data => res.json(data));
});

app.put('/api/observation', (req, res) => {
    observationController.updateObservation(req.body.observation).then(data => res.json(data));
});

app.put('/api/user', (req, res) => {
    userController.updateUsers(req.body.user).then(data => res.json(data));
});

app.delete('/api/task/:id', (req, res) => {
    taskController.deleteTask(req.params.id).then(data => res.json(data));
});

app.delete('/api/observation/:id', (req, res) => {
    observationController.deleteObservation(req.params.id).then(data => res.json(data));
});

app.delete('/api/user/:id', (req, res) => {
    userController.deleteUser(req.params.id).then(data => res.json(data));
});

app.get('/', (req, res) => {
    res.send(`<h1>Welcome To the MARE API </h1>`)
});



app.listen(port, () => {
    console.log(`Server listening on the port  ${port}`);
})
