const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


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

    async createObservation(observation) {
        let data = {};
        try {
            observation.createdate = new Date().toISOString();
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