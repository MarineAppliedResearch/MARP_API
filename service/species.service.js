const speciesRepository  = require('../repository/species.repository');

class SpeciesService {

    constructor() {}

    async getSpecies() {
        return await speciesRepository.getSpecies();
    }

    async getSpeciesByComname(req, res){
        return await speciesRepository.getSpeciesByComname(req, res);
    }   
    
    async createModelSpecies(req, res){
        try {
            const data = await speciesRepository.createModelSpecies(req.body);
            return data; // response handled by .then() in route
        } catch (err) {
            console.error('Error creating model_species record:', err);
            return { error: 'Failed to create model_species record' };
        }
    }

}

module.exports = new SpeciesService();