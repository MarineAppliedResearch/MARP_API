const metaInfoService  = require('../service/metaInfo.service');
const logger = require('../logger/api.logger');

class MetaInfoController {

    async getDBName() {
        logger.info('Controller: getDBName');
        return await metaInfoService.getDBName();
    }
}
module.exports = new MetaInfoController();