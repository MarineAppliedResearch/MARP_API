const metaInfoRepository  = require('../repository/metaInfo.repository');

class MetaInfoService {

    constructor() {}

    async getDBName() {
        return await metaInfoRepository.getDBName();
    }
}

module.exports = new MetaInfoService();