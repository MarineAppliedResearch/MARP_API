const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');


class SessionRepository {

    db = {};

    constructor() {
        this.db = connect();
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    async getSessions() {
        
        try {
            const sessions = await this.db.sessions.findAll({ include: ["user"] });
            console.log('sessions:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async getSessionsByUserIdAndProjectId(userID, projectID) {
        
        try {

            // First we need to get a list of 

            // Join Project to session, and session to user
            const sessions = await this.db.sessions.findAll({
                include: [{
                    model: this.db.users, as: "user",
                    required: true
                 },{
                    model: this.db.projects, as: "project",
                    required: true
                 }]
              });
            console.log('projects:::', sessions);
            return sessions;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async createSession(session) {
        let data = {};
        try {
            session.createdate = new Date().toISOString();
            data = await this.db.sessions.create(session);
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    async updateSession(session) {
        let data = {};
        try {
            session.updateddate = new Date().toISOString();
            data = await this.db.sessions.update({...session}, {
                where: {
                    id: session.id
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
    }

    async deleteSession(sessionId) {
        let data = {};
        try {
            data = await this.db.sessions.destroy({
                where: {
                    id: sessionId
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        return {status: `${data.deletedCount > 0 ? true : false}`};
    }

}

module.exports = new SessionRepository();