const keyframeRepository  = require('../repository/keyframe.repository');

class KeyframeService {

    constructor() {}

    async getKeyframes() {
        return await keyframeRepository.getKeyframes();
    }

    async createKeyframes(keyframes) {
        return await keyframeRepository.createKeyframes(keyframes);
    }

    async updateKeyframe(keyframe) {
        return await keyframeRepository.updateKeyframe(keyframe);
    }

    async deleteKeyframe(keyframeID) {
        return await keyframeRepository.deleteKeyframe(keyframeID);
    }

    
}

module.exports = new KeyframeService();