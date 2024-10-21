const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');
const { Sequelize, Model, DataTypes } = require("sequelize");
const { Op } = require("sequelize");
const sessionController = require('../controller/session.controller');
const observationController = require('../controller/observation.controller');


class ObservationRepository {

    db = {};

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
            data = await this.db.observations.create(observation);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

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
    }

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

}

module.exports = new ObservationRepository();