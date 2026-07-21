const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');
const { Sequelize, Model, DataTypes } = require("sequelize");
const sessionController = require('../controller/session.controller');
const observationController = require('../controller/observation.controller');
const userController = require('../controller/user.controller');
const {Sessions} = require("../model/old/sessions.js");
const moment = require('moment'); // For date manipulation
const { Op, fn, col } = require('sequelize');



class ObservationRepository {

    db = {};

    // Track the first and last observation of a specific session for a day
    firstLastSessionObsPerDay = {};

    // don't track per day, but we'll use this to record the first and/or last observation of a session_id
    firstLastSessionObs = {};
    
    

    constructor() {
        this.db = connect();
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    
    async getObservations() {
        
        try {
            const observations = await this.db.observations.findAll({
                order: [
                    ['obsID', 'ASC'],
                ]
        });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            
            return [];
        }
    }

        // This function returns videoLocation, mediaPosition, and actualPosition 
    // of the record with the max obsID in the given session.
    async getLastVideoInfo(session_id){

        let maxObservation_id = {};
        let maxObservation = {};

        try {
            maxObservation_id = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true
            });
            //console.log('observations:::', maxObservation_id);
            maxObservation_id = maxObservation_id[0].max;

            try {
                const maxObservation = await this.db.observations.findAll({
                    where: {
                        session_id: session_id,
                        observation_id: maxObservation_id
                    }
                });
                //console.log('observations:::', maxObservation);
                return maxObservation;
            } catch (err) {
                console.log(err);
                return [];
            }

        } catch (err) {
            console.log(err);
            return [];
        }
    }



    // Returns the observation with the largerst observation_id
    // that is associated with a specific video name
    async getMaxObservationFromVideo(video_source){

        let maxObservation_id = {};
        let maxObservation = {};

        try {
            maxObservation_id = await this.db.observations.findAll({
                where: {
                    video_source: video_source
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true
            });
            //console.log('observations:::', maxObservation_id);
            maxObservation_id = maxObservation_id[0].max;

            try {
                const maxObservation = await this.db.observations.findAll({
                    where: {
                        video_source: video_source,
                        observation_id: maxObservation_id
                    }
                });
                //console.log('observations:::', maxObservation);
                return maxObservation;
            } catch (err) {
                console.log(err);
                return [];
            }

        } catch (err) {
            console.log(err);
            return [];
        }
    }


    // Updates a given observation with the given count
    async updateObservationWithCount(session_id, obsID, count){
        try {
            const result = await this.db.observations.update(
              { count: count },
              { where: { obsID: obsID, session_id: session_id} }
            )
            //handleResult(result)
            return 1;
          } catch (err) {
            console.log(err);
            return 0;
          }
    }

    // Updates a given observation with the given count
    async updateObservationWithSize(session_id, obsID, size){
        try {
            const result = await this.db.observations.update(
              { coarsesize: size },
              { where: { obsID: obsID, session_id: session_id} }
            )
            //handleResult(result)
            return 1;
          } catch (err) {
            console.log(err);
            return 0;
          }
    }

    

    async getObservationsBySessionID(session_id) {
        try {
            // Fetch observations along with their associated keyframes
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                },
                include: [
                    {
                        model: this.db.keyframes,  // Include keyframes related to each observation
                        as: 'keyframes',           // Alias used during association
                        required: false            // Include observations even if there are no keyframes
                    }
                ]
            });
    
            // console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }
    
    /*
    async getObservationsBySessionID(session_id) {
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                }
            });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }
    */



    /**
     * Returns the max PobsID by project
     * @param {*} project_id 
     */
    async getMaxPobsIDInProject(project_id){

        // Get all the sessions involved with this project
        const sessions = await sessionController.getSessionsByProjectID(project_id);

        // Create an array of session_ids
        let session_ids = [];

        // Loop through sessions, adding all session_id to session_ids array
        for(let i in sessions){
            session_ids.push(sessions[i].session_id)
        }



        // Now we have a list of session, we can get our observations in all these sessions
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_ids
                },
                attributes: [Sequelize.fn('max', Sequelize.col('PobsID'))],
            });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }

    }

    async getMaxObservationIDInSession(session_id) {
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
            });
            //console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async createObservation(observation) {
        let data = {};
        let max_obs = {};
        let max_observation_id = -1;
        // let maxOBSID = observation.obsID; // don't rely on the frontend for observation id
        let maxOBSID = -1;                   // instead make sure to generate in database
        let max_PobsID = -1;

        // First we get the max observation_id for all sessions
        try {
            max_obs = await this.db.observations.findAll({
                
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true,
            }).then(function(observation_id){
                //check if observation_id[0].max is null, if it is skip setting
                if(observation_id[0].max != null){
                    max_observation_id = observation_id[0].max;
                }
                
             });
            //console.log('observations:::', max_obs);
            
        } catch (err) {
            console.log(err);
        }


        // if maxOBSID is -1 it means an obs id wasn't passed in via the gui, so find the max and create.
        if(maxOBSID == -1){
              // Now lets do the same thing, and get the max obsID for the session
            try {
                max_obs = await this.db.observations.findAll({
                    where: {
                        session_id: observation.session_id
                    },
                    attributes: [Sequelize.fn('max', Sequelize.col('obsID'))],
                    raw: true,
                }).then(function(obsID){
                    if(obsID[0].max != null){
                        maxOBSID = obsID[0].max;
                        maxOBSID = (parseInt(maxOBSID) + 1).toString();
                        //console.log("maxObsID: " + maxOBSID)
                    }
                    
                });
                //console.log('observations:::', max_obs);
                
            } catch (err) {
                console.log(err);
            }   
        }

        // Get the project ID of this observation via the session id
        let project_id = await sessionController.getProjectIDFromSessionID(observation.session_id);

        // Get the type of this observation via the session id
        let type = await sessionController.getTypeFromSessionID(observation.session_id);

        let maxPobsID = await this.getMaxPobsID(project_id, type);

        try {
             //first we need to get the max observation in the db.
            observation.createdate = new Date().toISOString();
            observation.observation_id = (parseInt(max_observation_id) + 1).toString();
            observation.obsID = (parseInt(maxOBSID)).toString();
            observation.PobsID = parseInt(maxPobsID + 1);

            console.log("Models in DB:", Object.keys(this.db));
            console.log("Associations on observations:", Object.keys(this.db.observations.associations));

            console.log("Observation payload:", Object.keys(observation));
            console.log("Keyframes length:", observation.keyframes?.length);

            try {
                data = await this.db.observations.create(observation, {
                    include: [{ model: this.db.keyframes, as: 'keyframes' }]
                });
                } catch (err) {
                console.error("Observation create failed:", err);
                throw err;
                }
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }


    /*
     * Updates an observation with new data, also updates
     * keyframes if comname has changed.
     */
    async updateObservation(observation) {
        observation.observation_id = parseInt(observation.observation_id);

        let data = {};
        const t = await this.db.sequelize.transaction(); // transaction for safety

        try {
            // Get the existing observation
            const existingObservation = await this.db.observations.findOne({
                where: { observation_id: observation.observation_id },
                raw: true
            });

            if (!existingObservation) {
                throw new Error(`Observation with ID ${observation.observation_id} not found`);
            }

            // Check if comname changed
            const comnameChanged =
                observation.comname &&
                observation.comname !== existingObservation.comname;

            // Update the observation
            observation.updateddate = new Date().toISOString();
            data = await this.db.observations.update(
                { ...observation },
                {
                    where: { observation_id: observation.observation_id },
                    transaction: t
                }
            );

            // If comname changed, propagate to all associated keyframes
            if (comnameChanged) {
                await this.db.keyframes.update(
                    { comname: observation.comname },
                    {
                        where: { observation_id: observation.observation_id },
                        transaction: t
                    }
                );
            }

            await t.commit();

            // Optional: log for debugging
            if (comnameChanged) {
                logger.info(
                    `Observation ${observation.observation_id}: comname updated to "${observation.comname}" and propagated to keyframes.`
                );
            }

        } catch (err) {
            await t.rollback();
            logger.error('Error::' + err);
            throw err;
        }

        return data;
    }
    /* // old, doesn't update keyframes as well
    async updateObservation(observation) {
        observation.observation_id = parseInt(observation.observation_id);
        let data = {};
        try {
            observation.updateddate = new Date().toISOString();
            data = await this.db.observations.update({...observation}, {
                where: {
                    observation_id: observation.observation_id
                },
                raw: true
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }*/

    async deleteObservation(observationId) {
        let data = {};
        try {
            data = await this.db.observations.destroy({
                where: {
                    observation_id: observationId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

    /*
    async getMaxPobsID(project_id, type){
         // Get a list of session_id's that share this project_id and type
        let sessionID_list = await sessionController.getSessionIDsWithProjectAndType(project_id, type);
        let observation_list = await this.getObservationsAssociatedWithSessionList(sessionID_list);

        // loop through the observation list finding the max PobsID
        let maxID = -1;

        for(let i = 0; i < observation_list.length; i++){
            var currentObs = observation_list[i];
            var PobsID = currentObs.PobsID;

            if(PobsID != null && PobsID > maxID){
                maxID = PobsID;
            }
        }

        return maxID;
    }*/

    async getMaxPobsID(project_id, type) {
        // Get a list of session_id's that share this project_id and type
        let sessionID_list = await sessionController.getSessionIDsWithProjectAndType(project_id, type);
    
        // Extract session_id values from sessionID_list
        let session_id_list = sessionID_list.map(session => session.session_id);
    
        // Query the max PobsID directly from the database for the session_id list
        try {
            const result = await this.db.observations.findOne({
                where: {
                    session_id: {
                        [Op.in]: session_id_list
                    }
                },
                attributes: [[Sequelize.fn('max', Sequelize.col('PobsID')), 'maxPobsID']],
                raw: true
            });
    
            // If no PobsID is found, return -1
            return result.maxPobsID ? parseInt(result.maxPobsID) : -1;
        } catch (err) {
            console.log(err);
            return -1;
        }
    }  

    async getObservationsAssociatedWithSessionList(session_list){
        // We have a list of session
        // we need to query all observations associated with these sessions.

        var session_id_list = [];

        for(let i = 0; i < session_list.length; i++){
            session_id_list.push(session_list[i].session_id);
        }

        

        try {
            const associatedObs = await this.db.observations.findAll({
                where: {
                    session_id: {
                        [Op.in] : session_id_list 
                    }
                }
            });
            //console.log('associatedObs:::', associatedObs);

            return associatedObs;
            
        } catch (err) {
            console.log(err);
        } 
    }


    /**
     * Returns all observations associated with video videoName
     * @param {*} videoName 
     */
    async getObservationsByVideo(videoName){

        try {
            // Fetch observations along with their associated keyframes
            const observations = await this.db.observations.findAll({
                where: {
                    video_source: videoName
                },
                order: [['mediaPosition', 'ASC']], // Sort by createdAt to get them in order
                include: [
                    {
                        model: this.db.keyframes,  // Include keyframes related to each observation
                        as: 'keyframes',           // Alias used during association
                        required: true            // Include observations even if there are no keyframes
                    }
                ]
            });
    
            // console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
        
    }



    /**
     * Returns a summary of videos for a given project:
     *  - video_source
     *  - distinct species count (unique comname)
     *  - session count
     *  - representative dive and line
     */
    async getVideoSummariesByProject(project_id) {
        try {
            const results = await this.db.observations.findAll({
                attributes: [
                    'video_source',
		    'videoLocation',
                    [fn('COUNT', fn('DISTINCT', col('observations.comname'))), 'distinct_species_count'],
                    [fn('COUNT', fn('DISTINCT', col('observations.session_id'))), 'session_count'],
                    [fn('MIN', col('session.dive')), 'dive'],
                    [fn('MIN', col('session.line')), 'line'],
                    [fn('MIN', col('session.type')), 'session_type'] // 👈 add session type
                ],
                include: [
                    {
                        model: this.db.sessions,
                        as: 'session',
                        attributes: [], // don’t duplicate session data in results
                        where: { project_id: project_id },
                        required: true // ensures it acts like an INNER JOIN
                    }
                ],
                group: ['observations.video_source', 'observations.videoLocation'],
                order: [
                    [fn('MIN', col('session.dive')), 'ASC'],
                    [fn('MIN', col('session.line')), 'ASC']
                ],
                raw: true
            });

            return results;
        } catch (err) {
            logger.error('Error in getVideoSummariesByProject::' + err);
            return [];
        }
    }




    /**
     * Returns all observations associated with a given video name, and project name
     * @param {*} videoSource 
     * @param {*} projectName 
     * @returns 
     */
    async getObservationsByVideoAndProject(videoSource, projectName){

        try {
            const project = await this.db.projects.findOne({ where: { name: projectName } });
            //if (!project) return res.status(404).send({ error: 'Project not found' });

            const observations = await this.db.observations.findAll({
                include: [
                    {
                        model: this.db.sessions,
                        as: 'session',
                        required: true,
                        where: { project_id: project.project_id }
                    },
                    {
                        model: this.db.keyframes,  // Include keyframes related to each observation
                        as: 'keyframes',           // Alias used during association
                        required: false            // Include observations even if there are no keyframes
                    }
                ],
                where: { video_source: videoSource },
                order: [['mediaPosition', 'ASC']]
            });

            return observations;
        } catch (err) {
            logger.error('Error in getVideoSummariesByProject::' + err);
            return [];
        }
    };


    /**
     * Returns all observations associated with video videoName that have a comname in comnameList
     * @param {string} videoName - The name of the video
     * @param {string[]} comnameList - An array of comname strings to filter observations
     */
    async getObservationsByVideoAndComnames(videoName, comnameList) {
        try {
            // Fetch observations along with their associated keyframes
            const observations = await this.db.observations.findAll({
                where: {
                    video_source: videoName,
                    comname: {
                        [Op.in]: comnameList  // Filter observations where comname is in comnameList
                    }
                },
                order: [['mediaPosition', 'ASC']], // Sort by mediaPosition
                include: [
                    {
                        model: this.db.keyframes,  // Include keyframes related to each observation
                        as: 'keyframes',           // Alias used during association
                        required: true             // Only include observations that have keyframes
                    }
                ]
            });
    
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    /**
     * Returns all observations that have associated keyframes and a comname in comnameList
     * @param {string[]} comnameList - An array of comname strings to filter observations
     */
    async getObservationsWithKeyframesByComnames(comnameList) {
        try {

            // Fetch observations along with their associated keyframes
            const observations = await this.db.observations.findAll({
                where: {
                    comname: {
                        [Op.in]: comnameList  // Filter observations where comname is in comnameList
                    }//,
                    //note: 'R' // Only include observations with note = "R"
                },
                order: [['mediaPosition', 'ASC']], // Sort by mediaPosition
                include: [
                    {
                        model: this.db.keyframes,  // Include associated keyframes
                        as: 'keyframes',           // Alias used in your associations
                        required: true             // Only include observations that have keyframes
                    }
                ]
            });

            return observations;
        } catch (err) {
            console.error('Error in getObservationsWithKeyframesByComnames:', err);
            return [];
        }
    }



    
     /**
     * Retrieves all distinct comnames from observations that have associated keyframes.
     * @returns {Promise<string[]>} - A promise that resolves to an array of distinct comnames.
     */
    async getDistinctComnamesWithKeyframes() {
        try {
            const comnamesData = await this.db.observations.findAll({
                attributes: [
                    [Sequelize.fn('DISTINCT', Sequelize.col('observations.comname')), 'comname']
                ],
                where: 
                Sequelize.literal(`
                    EXISTS (
                        SELECT 1 
                        FROM keyframes 
                        WHERE keyframes.observation_id = observations.observation_id
                    )
                `),
                raw: true // Return raw data without metadata
            });

            // Extract comname values from the result
            const comnames = comnamesData.map(item => item.comname);

            return comnames;
        } catch (err) {
            console.error('Error fetching distinct comnames:', err);
            throw err;
        }
    }


    


    /* Returns data for a user dashboard that gives us counts
     * on how much activity a user has participated in
     */
    async getUserDashboardData(startDate, endDate) {
        // Combine all the data by user and date into a single object
        let dashboardData = {};
    
        try {
            // Get Sessions for each user, grouped by user and date
            //const sessionData = await sessionController.getSessionsGroupedByUserAndDate(startDate, endDate);
    
            // Fetch the number of observations each user made, grouped by user and date
            const observationData = await this.getObservationsGroupedByUserAndDate(startDate, endDate);
    
            // Process observation data using for...of loop
            for (const item of observationData) {
                // Await the user name retrieval
                let userName = await userController.getUserNameByID(item.user_id);
    
                if (!dashboardData[userName]) {
                    dashboardData[userName] = {};
                }
                if (!dashboardData[userName][item.date]) {
                    dashboardData[userName][item.date] = { sessions: 0, observations: 0, projects: 0 };
                }
    
                dashboardData[userName][item.date].observations = parseInt(item.observationCount);
            }
    
            return dashboardData;
        } catch (error) {
            console.log('Error fetching dashboard data:', error);
        }
    }

    
    async getObservationsGroupedByUserAndDate(startDate, endDate){
        try{
            // Fetch the number of observations each user made, grouped by user and date
            const observationData = await this.db.observations.findAll({
                include: [{
                    model: this.db.sessions,
                    as: 'session',
                    attributes: ['user_id'],
                    required: true
                }],
                attributes: [
                    [Sequelize.col('session.user_id'), 'user_id'],
                    [Sequelize.fn('DATE', Sequelize.col('observations.createdAt')), 'date'],
                    [Sequelize.fn('COUNT', Sequelize.col('observation_id')), 'observationCount']
                ],
                where: {
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]
                    }
                },
                group: ['session.user_id', 'date'],
                raw: true
            });

            return observationData;
        }catch(err){
            console.log('Error getting observations grouped by user and date: ' + err);
        }
    
    }

    async isFirstObservationForSessionOnDay(observations, observation, obsIndex) {
    
        let returnVal = false;
        const session_id = observation.session_id;
        const date = observation.createdAt;
        const day = moment(date).format('YYYY-MM-DD');

        

        // Track the time spent per project and user
        if (!this.firstLastSessionObsPerDay[session_id]){
            this.firstLastSessionObsPerDay[session_id] = {};
        } 

        if (!this.firstLastSessionObsPerDay[session_id][day]){
            this.firstLastSessionObsPerDay[session_id][day] = {};
        } 

        // If this is the first value in the list, it's automatically the first observation
        if (obsIndex === 0) {
            this.firstLastSessionObsPerDay[session_id][day]["first"] = observation;
            return true;
        }

        let firstObservationForSessionAndDay = {};

        // Check if we've already found a first observation for this session/day
        if (!this.firstLastSessionObsPerDay[session_id][day]["first"]){

            // we have not previously found a first observation for this session/day, go ahead and query it
             // Define the start and end of the day for the query
            const startDate = moment(day).startOf('day').toDate();   // Start of the day (00:00:00)
            const endDate = moment(day).endOf('day').toDate();       // End of the day (23:59:59)
        
            // Fetch the first observation for the given session and date
            firstObservationForSessionAndDay = await this.db.observations.findOne({
                attributes: [
                    'obsID',
                    'observation_id',
                    'createdAt',
                    [Sequelize.fn('DATE', Sequelize.col('createdAt')), 'date']
                ],
                where: {
                    session_id: session_id,  // Filter by session ID
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]  // Filter by the date range for that day
                    }
                },
                order: [
                    ['createdAt', 'ASC']  // Ensure the earliest observation is fetched
                ],
                raw: true
            });

            this.firstLastSessionObsPerDay[session_id][day]["first"] = firstObservationForSessionAndDay;

        }else{

            // we HAVE previously found a first observation for this session day.
            firstObservationForSessionAndDay = this.firstLastSessionObsPerDay[session_id][day]["first"];
        }
    
        
        // Check if the current observation matches the first one
        if (firstObservationForSessionAndDay && firstObservationForSessionAndDay.observation_id === observation.observation_id) {
            returnVal = true;  // Current observation is the first one
        }
    
        return returnVal;
    }


    async isLastObservationForSessionOnDay(observations, observation, obsIndex) {
    
        let returnVal = false;
        const session_id = observation.session_id;
        const date = observation.createdAt;
        const day = moment(date).format('YYYY-MM-DD');

        

        // Track the time spent per project and user
        if (!this.firstLastSessionObsPerDay[session_id]) this.firstLastSessionObsPerDay[session_id] = {};
        if (!this.firstLastSessionObsPerDay[session_id][day]) this.firstLastSessionObsPerDay[session_id][day] = {};

        // If this is the first value in the list, it's automatically the first observation
        if (obsIndex == observations.length - 1) {
            this.firstLastSessionObsPerDay[session_id][day]["last"] = observation;
            return true;
        }

        let lastObservationForSessionAndDay = {};

        // Check if we've already found a first observation for this session/day
        if (!this.firstLastSessionObsPerDay[session_id][day]["last"]){

            // we have not previously found a first observation for this session/day, go ahead and query it
             // Define the start and end of the day for the query
            const startDate = moment(day).startOf('day').toDate();   // Start of the day (00:00:00)
            const endDate = moment(day).endOf('day').toDate();       // End of the day (23:59:59)
        
            // Fetch the first observation for the given session and date
            lastObservationForSessionAndDay = await this.db.observations.findOne({
                attributes: [
                    'obsID',
                    'observation_id',
                    'createdAt',
                    [Sequelize.fn('DATE', Sequelize.col('createdAt')), 'date']
                ],
                where: {
                    session_id: session_id,  // Filter by session ID
                    createdAt: {
                        [Sequelize.Op.between]: [startDate, endDate]  // Filter by the date range for that day
                    }
                },
                order: [
                    ['createdAt', 'DESC']  // Ensure the last observation is fetched
                ],
                raw: true
            });

            this.firstLastSessionObsPerDay[session_id][day]["last"] = lastObservationForSessionAndDay;

        }else{

            // we HAVE previously found a last observation for this session day.
            lastObservationForSessionAndDay = this.firstLastSessionObsPerDay[session_id][day]["last"];
        }
    
        
        // Check if the current observation matches the last one
        if (lastObservationForSessionAndDay && lastObservationForSessionAndDay.observation_id === observation.observation_id) {
            returnVal = true;  // Current observation is the last one
        }
    
        return returnVal;
    }


    //
    /**
     * Finds the next observation in the observations list that has the same session_id and occurs on the same day as the given observation.
     * The observations list is sorted by timestamp, but multiple session_ids may be dispersed throughout the list.
     * Once a different day is encountered, the search stops.
     *
     * @param {Array} observations - List of observations, sorted by date.
     * @param {Object} observation - The observation to compare against.
     * @param {Number} obsIndex - The index of the current observation in the list.
     * @returns {Object|null} - The next observation on the same day with the same session_id, or null if none is found.
     */
    async getNextObservation(observations, observation, obsIndex) {
        // Extract session_id and day of the current observation
        const session_id = observation.session_id;
        const observationDay = moment(observation.dataValues.date).format('YYYY-MM-DD'); // Format the observation date to 'YYYY-MM-DD'

        // Start the loop from the next observation
        for (let i = obsIndex + 1; i < observations.length; i++) {
            const nextObservation = observations[i]; // Get the next observation to compare
            const nextDay = moment(nextObservation.dataValues.date).format('YYYY-MM-DD'); // Format the next observation date to 'YYYY-MM-DD'

            // If the day changes, stop searching as the list is sorted and future observations cannot match
            if (nextDay !== observationDay) {
                return null; // No further observations on the same day, so we return null
            }

            // If the session_id matches, return the current nextObservation
            if (nextObservation.session_id === session_id) {
                return nextObservation; // Found the next observation with matching session_id and day
            }

            // If the day is the same but session_id doesn't match, continue searching
        }

        // If no matching observation is found by the end of the loop, return null
        return null;
    }


    /**
     * Returns a list of projects, with a sublist of dates, and a subsublist of users, which each
     * users time on that date for that project recorded.
     */
    async getProjectTimeByDateAndUser(startDate, endDate){

        // First get a list of observations grouped by session_id, that were created between startDate and endDate
        const observations = await this.db.observations.findAll({
            // join session, user and project, so we'll have observations[0].session.user, or observations[0].session.project.name, etc
            include: [
                {
                    model: this.db.sessions,
                    as: 'session',
                    include: [
                        {
                            model: this.db.users,
                            as: 'user',
                            attributes: ['user_id', 'name'] // Include user data
                        },
                        {
                            model: this.db.projects,
                            as: 'project',
                            attributes: ['project_id', 'name'] // Include project data
                        }
                    ],
                    group: ['session.project_id', 'date']
                }
            ],
            attributes: [
                [Sequelize.col('session.user_id'), 'user_id'],
                [Sequelize.col('session.user.name'), 'user_name'],
                [Sequelize.col('observations.obsID'), 'obsID'],
                [Sequelize.col('observations.observation_id'), 'observation_id'],
                [Sequelize.col('observations.createdAt'), 'createdAt'],
                [Sequelize.col('session.session_id'), 'session_id'],
                [Sequelize.col('session.project.name'), 'project_name'],
                [Sequelize.fn('DATE', Sequelize.col('observations.createdAt')), 'date']
            ],
            where: {
                createdAt: {
                    [Sequelize.Op.between]: [startDate, endDate]
                }
            },
            order: [['createdAt', 'ASC']]
        });

        // store minutes_recorded[project_name][date][user_name]
        const minutes_recorded = {};

        let obsIndex = 0;

        // loop through all observations
        for (const observation of observations) {
            const user_id = observation.user_id;
            const user_name = observation.session.user.name;
            const obsID = observation.obsID;
            const session_id = observation.session_id;
            const project_name = observation.session.project.name;
            const date = observation.dataValues.date;
            const createdAt = observation.createdAt;
            const day = moment(date).format('YYYY-MM-DD');

            // Track the time spent per project and user
            if (!minutes_recorded[project_name]) minutes_recorded[project_name] = {};
            if (!minutes_recorded[project_name][day]) minutes_recorded[project_name][day] = {};
            if (!minutes_recorded[project_name][day][user_name]) minutes_recorded[project_name][day][user_name] = 0;

            // now we decide how much time to allocate for this observation, this follows 3 rules.
            // 1. If this is the first observation, for this session, on this day, we start the clock 5 minutes before this observation.
            //    other wise we start the clock at this observation time exactly.
            // 2. If this is the last observation, for this session, on this day, we end the clock 5 minutes after this observation.
            //    other wise we continue to #3
            // 3. This is not the last observation, for this session, on this day, so we get the next observation after this one.
            //    If the next observation is more than 5 minutes after the current observation time, we end the clock 5 minutes
            //       after this observation.
            //    Else, the next observation is less than 5 minutes after the current observation time, we end the clock AT
            //       the next observation time.

            let startTime;
            let endTime;

            // we then sum all these times up for each project/day/user
            let isFirstObservation = await this.isFirstObservationForSessionOnDay(observations, observation, obsIndex);

            if(isFirstObservation){

                // this is the first observation of the day, set the start time to 5 minutes before this observation
                startTime = moment(createdAt).subtract(5, 'minutes');
            }else{

                // this is not the first observation of the day, set the start time to the observation time.
                startTime = moment(createdAt);
            }


            // we then sum all these times up for each project/day/user
            let isLastObservation = await this.isLastObservationForSessionOnDay(observations, observation, obsIndex);

            // Now check if we are the last observation for this session on this day
            if(isLastObservation){

                // this is the last observation of the day, set the end time to 5 minutes after this observation
                endTime = moment(createdAt).add(5, 'minutes');
            }else{
                // this is not the last observation of the day, we'll get the next observation for this session/day, and set the end time to
                // it's start time.
                
                // Get the next observation
                let nextObservation = await this.getNextObservation(observations, observation, obsIndex);
                
                // check if nextObservation is null, and set end to 5 minutes after this observation
                let nextCreatedAt;
                if(nextObservation == null){
                    nextCreatedAt = moment(createdAt).add(5, 'minutes');
                }else{
                    nextCreatedAt = nextObservation.createdAt;
                }
                

                // if nextCreatedAt is larger than 5 minutes after createdAt, then we'll use endtime of 5 minutes after createdAt
                const currTime = moment(createdAt);
                const nextTime = moment(nextCreatedAt);
                
                const gap_minutes = nextTime.diff(currTime, 'minutes');

                if(gap_minutes >= 5){
                    endTime = moment(createdAt).add(5, 'minutes');
                }else{
                    // else if nextCreatedAt is less than 5 minutes, we'll set end time to that.
                    endTime = moment(nextCreatedAt);
                }

                const timeSpent = endTime.diff(startTime, 'seconds');

                minutes_recorded[project_name][day][user_name] = minutes_recorded[project_name][day][user_name] + (timeSpent/60);

                

                // get the time of this observation

                // set end time to the time of this observation
            }

            // increase obsIndex
            obsIndex = obsIndex + 1;
        }

        // Return the queried values
        return minutes_recorded;

    }


    

    // Utility function to get the previous observation in the same session
    async getPreviousObservation(sessionId, obsID) {
        // Fetch observations for the specified session, ordered by createdAt
        const observations = await this.db.observations.findAll({
            where: { session_id: sessionId },
            order: [['createdAt', 'ASC']] // Sort by createdAt to get them in order
        });

        // Find the index of the current observation by obsID
        const currentIndex = observations.findIndex(obs => obs.obsID === obsID);

        // If the current observation is found and it's not the first observation
        if (currentIndex > 0) {
            return observations[currentIndex - 1]; // Return the previous observation
        }

        return null; // Return null if there's no previous observation
    }

    // Group time data by month
    async groupByMonth(data) {
        const groupedData = {};
        Object.keys(data).forEach(userId => {
            Object.keys(data[userId]).forEach(projectId => {
                const totalMinutes = data[userId][projectId];
                const month = moment().format('YYYY-MM'); // For example, group by current month

                if (!groupedData[month]) groupedData[month] = {};
                if (!groupedData[month][userId]) groupedData[month][userId] = {};
                if (!groupedData[month][userId][projectId]) groupedData[month][userId][projectId] = 0;

                groupedData[month][userId][projectId] += totalMinutes;
            });
        });
        return groupedData;
    }

    // Function to get the first observation for a specific session ID
    async getFirstObservationBySessionId(sessionId) {

        let firstObservation = null;

        // Track the time spent per project and user
        if (!firstLastSessionObs[sessionId]) firstLastSessionObs[sessionId] = {};

        if (!firstLastSessionObs[sessionId]["first"]){

            firstLastSessionObs[sessionId]["first"] = {};

            firstObservation = await this.db.observations.findOne({
                where: {
                    session_id: sessionId
                },
                order: [['createdAt', 'ASC']] // Order by createdAt ascending to get the first observation
            });

            firstLastSessionObs[sessionId]["first"] = firstObservation;

        }else{
            firstObservation = firstLastSessionObs[sessionId]["first"];
        }

        return firstObservation;
    }

    // Function to get the first observation for a specific session ID
    async getLastObservationBySessionId(sessionId) {

        let lastObservation = null;

        // Track the time spent per project and user
        if (!firstLastSessionObs[sessionId]) firstLastSessionObs[sessionId] = {};

        if (!firstLastSessionObs[sessionId]["last"]){

            firstLastSessionObs[sessionId]["last"] = {};

            lastObservation = await this.db.observations.findOne({
                where: {
                    session_id: sessionId
                },
                order: [['createdAt', 'DESC']] // Order by createdAt ascending to get the first observation
            });

            firstLastSessionObs[sessionId]["last"] = lastObservation;

        }else{
            lastObservation = firstLastSessionObs[sessionId]["last"];
        }

        return lastObservation;
    }

    // Main function to calculate time spent per user per project
    async getTimeSpentPerUserPerProject() {

        // Fetch observations along with session and user data
        const observations = await this.db.observations.findAll({
            include: [
                {
                    model: this.db.sessions,
                    as: 'session',
                    include: [
                        {
                            model: this.db.users,
                            as: 'user',
                            attributes: ['user_id', 'name'] // Include user data
                        },
                        {
                            model: this.db.projects,
                            as: 'project',
                            attributes: ['project_id', 'name'] // Include project data
                        }
                    ]
                }
            ],
            order: [['createdAt', 'ASC']] // Sort by timestamp
        });

        const userProjectTime = {}; // Store user time per project

        // Iterate over observations and calculate time
        for (const observation of observations) { // Change to for...of
            const { createdAt, session } = observation;
            const userName = session.user.name;
            const projectName = session.project.name;
            const userId = session.user_id;
            const projectId = session.project_id;
            const sessionID = session.session_id;
            const obsID = observation.obsID;

            // If this is the first observation of the session, add 5 minutes before
            const firstObservation = await this.getFirstObservationBySessionId(sessionID);
            let startTime;

            if (firstObservation && obsID == firstObservation.obsID) {
                // This is the first observation; subtract 5 minutes for the start time
                startTime = moment(createdAt).subtract(5, 'minutes');
            } else {
                // For subsequent observations, set startTime to the createdAt time
                startTime = moment(createdAt);
            }

           // If this is the first observation of the session, add 5 minutes before
           const lastObservation = await this.getLastObservationBySessionId(sessionID);
           let endTime;

           if (lastObservation && obsID == lastObservation.obsID) {
               // This is the first observation; subtract 5 minutes for the start time
               endTime = moment(createdAt).add(5, 'minutes');
           } else {
               // For subsequent observations, set startTime to the createdAt time
               endTime = moment(createdAt);
           }

            // Track the time spent per project and user
            if (!userProjectTime[userName]) userProjectTime[userName] = {};
            if (!userProjectTime[userName][projectName]) userProjectTime[userName][projectName] = 0;

            // Check if there's a gap more than 5 minutes between observations
            const previousObservation = await this.getPreviousObservation(sessionID, obsID); // Make this async if it needs to be
        
            if (previousObservation) {
                const prevEndTime = moment(previousObservation.createdAt).add(5, 'minutes');
                const gap = startTime.diff(prevEndTime, 'minutes');

                console.log("gap: " + gap.toString());
                
                if (gap > 5) {
                    // Only add 5 minutes for the gap
                    userProjectTime[userName][projectName] += 5;
                } else if (gap > 0) {
                    // Include the entire gap
                    userProjectTime[userName][projectName] += gap;
                }
            }

            // Add the time spent for this observation (5 minutes before, 5 minutes after)
            userProjectTime[userName][projectName] += endTime.diff(startTime, 'minutes');
        }

        // Group the results by month
        const results = await this.groupByMonth(userProjectTime); // Make sure this is also awaited

        return results;
    }

}

module.exports = new ObservationRepository();
