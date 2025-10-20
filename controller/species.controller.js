const speciesService  = require('../service/species.service');
const logger = require('../logger/api.logger');

class SpeciesController {

    async getSpecies() {
        logger.info('Controller: getSpecies')
        return await speciesService.getSpecies();
    }

    async getSpeciesByComname(req, res){
        logger.info('Controller: getSpeciesByComname')
        return await speciesService.getSpeciesByComname(req, res);
    }

    async createModelSpecies(req, res){
        logger.info('Controller: createModelSpecies')
        return await speciesService.createModelSpecies(req, res);
    }


    

   
}
module.exports = new SpeciesController();