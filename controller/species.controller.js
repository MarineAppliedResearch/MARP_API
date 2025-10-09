const speciesService  = require('../service/species.service');
const logger = require('../logger/api.logger');

class SpeciesController {

    async getSpecies() {
        logger.info('Controller: getSpecies')
        return await speciesService.getSpecies();
    }

   
}
module.exports = new SpeciesController();