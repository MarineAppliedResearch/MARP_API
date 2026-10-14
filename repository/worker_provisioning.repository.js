'use strict';

const crypto = require('crypto');
const db = require('../model');

const WORKER_APP_NAME = 'MARP Inference Workers';
const WORKER_PERMISSIONS = ['workers:enrol', 'jobs:execute', 'jobs:write'];

function hashSecret(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function rawSecret(prefix) {
    return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

class WorkerProvisioningRepository {
    async credentialWorker(tokenId) {
        return db.gpu_workers.findOne({ where: { service_token_id: tokenId } });
    }

    async credentialOwnsAttempt(tokenId, attemptId) {
        const [row] = await db.sequelize.query(
            `SELECT 1
               FROM gpu_job_attempts AS attempt
               JOIN gpu_workers AS worker ON worker.id = attempt.worker_id
              WHERE attempt.id = :attemptId
                AND worker.service_token_id = :tokenId`,
            {
                replacements: { tokenId, attemptId },
                type: db.Sequelize.QueryTypes.SELECT,
            }
        );
        return Boolean(row);
    }

    async createActivationCode({ label, expiresAt, maxUses, createdByUserId }) {
        const code = rawSecret('activate');
        const row = await db.worker_activation_codes.create({
            code_prefix: code.slice(0, 16),
            code_hash: hashSecret(code),
            label: label || null,
            expires_at: expiresAt,
            max_uses: maxUses,
            created_by_user_id: createdByUserId || null,
        });
        return { ...row.get({ plain: true }), code_hash: undefined, activation_code: code };
    }

    async activate({ activationCode, localId, name, platform, architecture, compute_runtime, workerVersion }) {
        return db.sequelize.transaction(async (transaction) => {
            const code = await db.worker_activation_codes.findOne({
                where: { code_hash: hashSecret(activationCode) },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!code || code.revoked_at || code.use_count >= code.max_uses || new Date(code.expires_at) <= new Date()) return null;

            let client = await db.service_clients.findOne({
                where: { name: WORKER_APP_NAME },
                transaction,
            });
            if (!client) {
                client = await db.service_clients.create({
                    name: WORKER_APP_NAME,
                    description: 'Individually revocable credentials for activated inference workers.',
                    status: 'active',
                }, { transaction });
            }

            let worker = await db.gpu_workers.findOne({
                where: { local_id: localId },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (worker && worker.service_token_id) return { conflict: true };
            if (!worker) {
                worker = await db.gpu_workers.create({
                    local_id: localId,
                    name,
                    state: 'offline',
                    slot_count: 1,
                    worker_version: workerVersion || null,
                    platform,
                    architecture,
                    compute_runtime,
                }, { transaction });
            }

            const credential = rawSecret('svc');
            const token = await db.service_tokens.create({
                service_client_id: client.service_client_id,
                token_prefix: credential.slice(0, 12),
                token_hash: hashSecret(credential),
            }, { transaction });
            const permissions = await db.permissions.findAll({
                where: { key: WORKER_PERMISSIONS },
                transaction,
            });
            if (permissions.length !== WORKER_PERMISSIONS.length) {
                throw new Error('Worker permission catalog is incomplete.');
            }
            await db.service_token_permissions.bulkCreate(permissions.map((permission) => ({
                service_token_id: token.service_token_id,
                permission_id: permission.permission_id,
            })), { transaction });

            await worker.update({
                service_token_id: token.service_token_id,
                platform,
                architecture,
                compute_runtime,
                worker_version: workerVersion || worker.worker_version,
            }, { transaction });
            await code.update({
                use_count: code.use_count + 1,
                consumed_at: new Date(),
                consumed_by_worker_id: worker.id,
            }, { transaction });

            return {
                worker_id: String(worker.id),
                credential,
                token_prefix: token.token_prefix,
            };
        });
    }

    async registerRelease(fields) {
        return db.worker_releases.create(fields);
    }

    async listReleases() {
        return db.worker_releases.findAll({
            order: [['approved_at', 'DESC'], ['id', 'DESC']],
        });
    }

    async setDesiredRelease(workerId, releaseId) {
        const worker = await db.gpu_workers.findByPk(workerId);
        const release = await db.worker_releases.findByPk(releaseId);
        if (!worker || !release) return null;
        if (worker.platform && worker.platform !== release.platform) return { incompatible: true };
        if (worker.architecture && worker.architecture !== release.architecture) return { incompatible: true };
        await worker.update({ desired_release_id: release.id, update_state: 'update_requested', update_message: null });
        return this.getWorkerUpdate(worker.id);
    }

    async checkIn({ workerId, tokenId, version, platform, architecture, computeRuntime, updateState, updateMessage }) {
        const worker = await db.gpu_workers.findByPk(workerId);
        if (!worker || Number(worker.service_token_id) !== Number(tokenId)) return null;

        const latest = await db.worker_releases.findOne({
            where: { platform, architecture, compute_runtime: computeRuntime },
            order: [['approved_at', 'DESC'], ['id', 'DESC']],
        });
        const desired = worker.desired_release_id
            ? await db.worker_releases.findByPk(worker.desired_release_id)
            : null;
        let state = updateState;
        if (!state) {
            if (!desired && ['failed', 'rolled_back'].includes(worker.update_state)) state = worker.update_state;
            else if (desired && (desired.version !== version || desired.compute_runtime !== computeRuntime)) state = 'update_requested';
            else if (latest && latest.version !== version) state = 'update_available';
            else state = 'current';
        }
        const terminalUpdate = ['succeeded', 'failed', 'rolled_back'].includes(state);
        await worker.update({
            worker_version: version,
            platform,
            architecture,
            compute_runtime: computeRuntime,
            update_state: state,
            update_message: updateMessage || (state === worker.update_state ? worker.update_message : null),
            update_reported_at: new Date(),
            last_seen_at: new Date(),
            desired_release_id: terminalUpdate ? null : worker.desired_release_id,
        });
        return {
            worker_id: String(worker.id),
            installed_version: version,
            update_state: state,
            latest_release: latest ? latest.get({ plain: true }) : null,
            desired_release: !terminalUpdate && desired ? desired.get({ plain: true }) : null,
        };
    }

    async getWorkerUpdate(workerId) {
        return db.gpu_workers.findByPk(workerId, {
            include: [{ model: db.worker_releases, as: 'desiredRelease' }],
        });
    }
}

module.exports = new WorkerProvisioningRepository();
