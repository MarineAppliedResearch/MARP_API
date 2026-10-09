'use strict';

const service = require('../service/worker_provisioning.service');

class WorkerProvisioningController {
    authorizeWorker(workerId, principal) { return service.authorizeWorker(workerId, principal); }
    authorizeEnrol(localId, principal) { return service.authorizeEnrol(localId, principal); }
    authorizeAttempt(attemptId, principal) { return service.authorizeAttempt(attemptId, principal); }
    createActivationCode(body, userId) { return service.createActivationCode(body, userId); }
    activate(body) { return service.activate(body); }
    registerRelease(body, userId) { return service.registerRelease(body, userId); }
    listReleases() { return service.listReleases(); }
    setDesiredRelease(workerId, body) { return service.setDesiredRelease(workerId, body); }
    getWorkerUpdate(workerId) { return service.getWorkerUpdate(workerId); }
    checkIn(workerId, tokenId, body) { return service.checkIn(workerId, tokenId, body); }
}

module.exports = new WorkerProvisioningController();
