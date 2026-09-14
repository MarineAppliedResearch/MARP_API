'use strict';

const repository = require('../repository/worker_provisioning.repository');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');

const STATES = new Set(['current', 'update_available', 'update_requested', 'updating', 'succeeded', 'failed', 'rolled_back']);
const SHA256 = /^[0-9a-f]{64}$/i;

function requiredString(value, name, max = 255) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, `${name} is required and must be at most ${max} characters.`);
    }
    return value.trim();
}

class WorkerProvisioningService {
    async authorizeWorker(workerId, principal) {
        if (principal && principal.type === 'user') return;
        if (!principal || principal.type !== 'service' || !principal.tokenId) {
            throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'A worker service credential is required.');
        }
        const bound = await repository.credentialWorker(principal.tokenId);
        if (!bound || Number(bound.id) !== Number(workerId)) {
            throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'This credential belongs to a different worker.');
        }
    }

    async authorizeEnrol(localId, principal) {
        if (principal && principal.type === 'user') return;
        if (!principal || principal.type !== 'service' || !principal.tokenId) {
            throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'A worker service credential is required.');
        }
        const bound = await repository.credentialWorker(principal.tokenId);
        if (!bound || bound.local_id !== localId) {
            throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'This credential belongs to a different worker identity.');
        }
    }

    async authorizeAttempt(attemptId, principal) {
        if (principal && principal.type === 'user') return;
        if (!principal || principal.type !== 'service' || !principal.tokenId) {
            throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'A worker service credential is required.');
        }
        const ownsAttempt = await repository.credentialOwnsAttempt(principal.tokenId, Number(attemptId));
        if (!ownsAttempt) {
            throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'This attempt belongs to a different worker.');
        }
    }

    createActivationCode(body, userId) {
        const ttlMinutes = Number(body.ttl_minutes || 60);
        const maxUses = Number(body.max_uses || 1);
        if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 10080) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'ttl_minutes must be between 1 and 10080.');
        }
        if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'max_uses must be between 1 and 10000.');
        }
        return repository.createActivationCode({
            label: body.label,
            expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
            maxUses,
            createdByUserId: userId,
        });
    }

    async activate(body) {
        const result = await repository.activate({
            activationCode: requiredString(body.activation_code, 'activation_code', 128),
            localId: requiredString(body.local_id, 'local_id', 128),
            name: requiredString(body.name, 'name'),
            platform: requiredString(body.platform, 'platform', 32),
            architecture: requiredString(body.architecture, 'architecture', 32),
            compute_runtime: requiredString(body.compute_runtime, 'compute_runtime', 32),
            workerVersion: body.worker_version ? requiredString(body.worker_version, 'worker_version', 64) : null,
        });
        if (!result) throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, 'Activation code is invalid, expired, or already used.');
        if (result.conflict) throw new ApiError(409, ERROR_CODES.CONFLICT, 'This worker identity is already activated.');
        return result;
    }

    registerRelease(body, userId) {
        const size = Number(body.size_bytes);
        if (!Number.isSafeInteger(size) || size < 1) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'size_bytes must be a positive integer.');
        const sha256 = requiredString(body.sha256, 'sha256', 64).toLowerCase();
        if (!SHA256.test(sha256)) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'sha256 must be 64 hexadecimal characters.');
        let url;
        try { url = new URL(requiredString(body.download_url, 'download_url', 4096)); } catch { throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'download_url must be an absolute HTTPS URL.'); }
        if (url.protocol !== 'https:') throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'download_url must use HTTPS.');
        if (url.hostname !== 'github.com' || !url.pathname.startsWith('/MarineAppliedResearch/marp-inference-worker/releases/download/')) {
            throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'download_url must name an immutable marp-inference-worker GitHub Release asset.');
        }
        return repository.registerRelease({
            version: requiredString(body.version, 'version', 64),
            platform: requiredString(body.platform, 'platform', 32),
            architecture: requiredString(body.architecture, 'architecture', 32),
            compute_runtime: requiredString(body.compute_runtime, 'compute_runtime', 32),
            download_url: url.toString(),
            size_bytes: size,
            sha256,
            approved_at: new Date(),
            approved_by_user_id: userId || null,
        });
    }

    listReleases() {
        return repository.listReleases();
    }

    async setDesiredRelease(workerId, body) {
        const parsedWorkerId = Number(workerId);
        if (!Number.isInteger(parsedWorkerId)) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'worker id must be an integer.');
        const releaseId = Number(body.release_id);
        if (!Number.isInteger(releaseId)) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'release_id must be an integer.');
        const result = await repository.setDesiredRelease(parsedWorkerId, releaseId);
        if (!result) throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, 'Worker or release was not found.');
        if (result.incompatible) throw new ApiError(409, ERROR_CODES.CONFLICT, 'Release platform or architecture does not match the worker.');
        return result;
    }

    async getWorkerUpdate(workerId) {
        const parsedWorkerId = Number(workerId);
        if (!Number.isInteger(parsedWorkerId)) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'worker id must be an integer.');
        const result = await repository.getWorkerUpdate(parsedWorkerId);
        if (!result) throw new ApiError(404, ERROR_CODES.RESOURCE_NOT_FOUND, 'Worker was not found.');
        return result;
    }

    async checkIn(workerId, tokenId, body) {
        if (!tokenId) throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'A worker service credential is required.');
        if (body.update_state && !STATES.has(body.update_state)) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'update_state is invalid.');
        const result = await repository.checkIn({
            workerId: Number(workerId),
            tokenId,
            version: requiredString(body.installed_version, 'installed_version', 64),
            platform: requiredString(body.platform, 'platform', 32),
            architecture: requiredString(body.architecture, 'architecture', 32),
            computeRuntime: requiredString(body.compute_runtime, 'compute_runtime', 32),
            updateState: body.update_state,
            updateMessage: body.update_message ? String(body.update_message).slice(0, 2000) : null,
        });
        if (!result) throw new ApiError(403, ERROR_CODES.FORBIDDEN, 'This credential does not belong to that worker.');
        return result;
    }
}

module.exports = new WorkerProvisioningService();
