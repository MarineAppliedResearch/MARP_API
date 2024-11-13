const keyframeService  = require('../service/keyframe.service');
const logger = require('../logger/api.logger');

class KeyframeController {

    async getKeyframes() {
        logger.info('Controller: getKeyframes');
        return await keyframeService.getObservations();
    }

    async createKeyframes(keyframes) {
        logger.info('Controller: createKeyFrames', keyframes);
        return await keyframeService.createKeyframes(keyframes);
    }

    async updateKeyframe(keyframe) {
        logger.info('Controller: updateKeyframe', keyframe);
        return await keyframeService.updateKeyframe(keyframe);
    }

    async deleteKeyframe(keyframeID) {
        logger.info('Controller: deleteKeyframe', keyframeID);
        return await keyframeService.deleteKeyframe(keyframeID);
    }

    
}
module.exports = new KeyframeController();