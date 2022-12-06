const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');
const { Sequelize, Model, DataTypes } = require("sequelize");


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
            const observations = await this.db.observations.findAll();
            console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }


    async getObservationsBySessionID(session_id) {
        try {
            const observations = await this.db.observations.findAll({
                where: {
                    session_id: session_id
                }
            });
            console.log('observations:::', observations);
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
            console.log('observations:::', observations);
            return observations;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async createObservation(observation) {
        let data = {};
        let max_obs = {};
        let maxOBSID = -1;

        try {
            max_obs = await this.db.observations.findAll({
                where: {
                    session_id: observation.session_id
                },
                attributes: [Sequelize.fn('max', Sequelize.col('observation_id'))],
                raw: true,
            }).then(function(observation_id){
                maxOBSID = observation_id[0].max;
             });
            console.log('observations:::', max_obs);
            
        } catch (err) {
            console.log(err);
        }


        try {
             //first we need to get the max observation in the db.

            observation.createdate = new Date().toISOString();
            observation.observation_id = maxOBSID + 1;
            data = await this.db.observations.create(observation);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    async updateObservation(observation) {
        let data = {};
        try {
            observation.updateddate = new Date().toISOString();
            data = await this.db.observations.update({...observation}, {
                where: {
                    observation_id: observation.observation_id
                }
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

}

module.exports = new ObservationRepository();