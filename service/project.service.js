const projectRepository  = require('../repository/project.repository');

class ProjectService {

    constructor() {}

    async getProjects() {
        return await projectRepository.getProjects();
    }

    async getProjectsByUserID(userID) {
        return await projectRepository.getProjectsByUserID(userID);
    }

    async createProject(project) {
        return await projectRepository.createProject(project);
    }

    async updateProject(project) {
        return await projectRepository.updateProject(project);
    }

    async deleteProject(projectId) {
        return await projectRepository.deleteProject(projectId);
    }

}

module.exports = new ProjectService();