const projectService  = require('../service/project.service');
const logger = require('../logger/api.logger');

class ProjectController {

    async getProjects() {
        logger.info('Controller: getProjects')
        return await projectService.getProjects();
    }

    async getProjectsByUserID(userID) {
        logger.info('Controller: getProjectsByUserID')
        return await projectService.getProjectsByUserID(userID);
    }

    

    async createProject(project) {
        logger.info('Controller: createProject', project);
        return await projectService.createProject(project);
    }

    async updateProject(project) {
        logger.info('Controller: updateProject', project);
        return await projectService.updateProject(project);
    }

    async deleteProject(projectId) {
        logger.info('Controller: deleteProject', projectId);
        return await projectService.deleteProject(projectId);
    }
}
module.exports = new ProjectController();