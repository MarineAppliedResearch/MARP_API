const { connect } = require('../config/db.config');
const logger = require('../logger/api.logger');
const { Sequelize, Model, DataTypes } = require("sequelize");
const { Op } = require("sequelize");
const sessionController = require('../controller/session.controller');
const observationController = require('../controller/observation.controller');
const userController = require('../controller/user.controller');
const {Sessions} = require("../model/sessions.js");
const moment = require('moment'); // For date manipulation


class KeyframeRepository {

    db = {};
    
    

    constructor() {
        this.db = connect();
        // For Development
        /*this.db.sequelize.sync({ force: true }).then(() => {
            console.log("Drop and re-sync db.");
        });*/
    }

    
    async getKeyframes() {
        
        try {
            const keyframes = await this.db.keyframes.findAll({
                order: [
                    ['observation_id', 'ASC'],
                    ['subset', 'ASC'],
                    ['keyframe_id', 'ASC'],
                ]
        });
            //console.log('observations:::', observations);
            return keyframes;
        } catch (err) {
            console.log(err);
            
            return [];
        }
    }

    

    async createKeyframes(newKeyFrames) {
        let data = [];

        
        const transaction = await this.db.sequelize.transaction(); // Start a new transaction
        try {
            // Prepare the list of keyframes data
            const keyframesData = newKeyFrames.map(keyframe => ({
                observation_id: keyframe.observation_id,
                x: keyframe.x,
                y: keyframe.y,
                width: keyframe.width,
                height: keyframe.height,
                subset: keyframe.subset,
                type: keyframe.type,
                framenum: keyframe.framenum
            }));

            // Use bulkCreate to add all keyframes within the transaction
            data = await this.db.keyframes.bulkCreate(keyframesData, { transaction });

            // Commit the transaction if everything went fine
            await transaction.commit();
            console.log('Keyframes saved successfully.');
        } catch (error) {
            // Rollback the transaction in case of any errors
            await transaction.rollback();
            console.error('Error saving keyframes:', error);
        }

        return data;
    }

    async updateKeyframe(keyframe) {
        let data = {};

        /*
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
            */


        return data;
    }

    async deleteKeyframe(keyframeID) {
        let data = {};
        try {
            data = await this.db.keyframes.destroy({
                where: {
                    keyframe_id: keyframeID
                }
            });
        } catch(err) {
            logger.error('Error::' + err);
        }
        return data;
        //return {status: `${data.deletedCount > 0 ? true : false}`};
    }

}

module.exports = new KeyframeRepository();