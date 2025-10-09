const speciesRepository  = require('../repository/species.repository');

class SpeciesService {

    constructor() {}

    async getSpecies() {
        return await speciesRepository.getSpecies();
    }

}

module.exports = new SpeciesService();