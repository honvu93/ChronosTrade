import { PrismaClient } from '@prisma/client';

import { SignalLiveEligibilityService } from '../SignalLiveEligibilityService';
import { encryptSecret } from './secretCrypto';
import {
    assertExternalActionOwnerAccess,
    ExternalActionAccessScope,
    ExternalActionActor,
    ExternalActionError,
    ExternalActionStore,
    ExternalDeploymentRecord,
    resolveExternalActionOwnerUserId,
    SignalEligibilityLookup,
} from './types';

export interface CreateExternalDeploymentRequest {
    indicatorInstanceId: string;
    telegramBotToken: string;
    telegramBotLabel?: string | null;
    telegramChatId: string;
    telegramChatLabel?: string | null;
    actorUserId?: string | null;
    messageTemplateKind?: string | null;
}

export class ExternalActionDeploymentService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly store: ExternalActionStore,
        private readonly env: NodeJS.ProcessEnv = process.env,
        private readonly eligibilityLookup: SignalEligibilityLookup = new SignalLiveEligibilityService(prisma),
    ) {}

    async createDeployment(input: CreateExternalDeploymentRequest): Promise<ExternalDeploymentRecord> {
        const actorUserId = this.normalizeOptional(input.actorUserId);
        if (!actorUserId) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                'actorUserId is required.',
            );
        }

        return this.createDeploymentForActor(input, {
            id: actorUserId,
            role: 'USER',
        });
    }

    async createDeploymentForActor(
        input: CreateExternalDeploymentRequest,
        actor: ExternalActionActor,
        scope: ExternalActionAccessScope = {},
    ): Promise<ExternalDeploymentRecord> {
        const indicatorInstanceId = this.requireNonEmpty(input.indicatorInstanceId, 'indicatorInstanceId');
        const telegramBotToken = this.requireNonEmpty(input.telegramBotToken, 'telegramBotToken');
        const telegramChatId = this.requireNonEmpty(input.telegramChatId, 'telegramChatId');
        const ownerUserId = resolveExternalActionOwnerUserId(
            actor,
            this.normalizeOptional(scope.ownerUserId),
            true,
        );

        await this.ensureOwnerUser(ownerUserId);

        const instance = await this.prisma.indicatorInstance.findUnique({
            where: { id: indicatorInstanceId },
            select: {
                id: true,
                signalCode: true,
                signalVersion: true,
                sourceBacktestRunId: true,
            },
        });

        if (!instance) {
            throw new ExternalActionError(
                'INDICATOR_INSTANCE_NOT_FOUND',
                404,
                `Indicator instance ${indicatorInstanceId} was not found.`,
            );
        }

        const eligibility = await this.eligibilityLookup.getEligibilityForSignal(
            instance.signalCode,
            instance.signalVersion,
        );

        return this.store.createDeployment({
            ownerUserId: ownerUserId!,
            indicatorInstanceId: instance.id,
            signalCode: instance.signalCode,
            signalVersion: instance.signalVersion,
            sourceBacktestRunId: instance.sourceBacktestRunId ?? null,
            telegramBotLabel: this.normalizeOptional(input.telegramBotLabel),
            telegramBotTokenCiphertext: encryptSecret(telegramBotToken, this.env),
            telegramChatId,
            telegramChatLabel: this.normalizeOptional(input.telegramChatLabel),
            messageTemplateKind: this.normalizeOptional(input.messageTemplateKind) ?? 'DEFAULT_V1',
            createdByUserId: actor.id,
            eligibilityStateSnapshot: eligibility?.eligibilityState ?? null,
        });
    }

    async listDeploymentsForActor(
        actor: ExternalActionActor,
        filters: {
        indicatorInstanceId?: string | null;
        status?: ExternalDeploymentRecord['status'] | null;
        limit?: number;
    } = {},
        scope: ExternalActionAccessScope = {},
    ) {
        return this.store.listDeployments({
            ownerUserId: resolveExternalActionOwnerUserId(
                actor,
                this.normalizeOptional(scope.ownerUserId),
                true,
            ),
            ...filters,
        });
    }

    async listDeployments(filters: {
        indicatorInstanceId?: string | null;
        status?: ExternalDeploymentRecord['status'] | null;
        limit?: number;
        ownerUserId?: string | null;
    } = {}) {
        const ownerUserId = this.normalizeOptional(filters.ownerUserId);
        if (!ownerUserId) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                'ownerUserId is required.',
            );
        }

        return this.store.listDeployments({
            ...filters,
            ownerUserId,
        });
    }

    async enableDeploymentForActor(
        id: string,
        actor: ExternalActionActor,
        scope: ExternalActionAccessScope = {},
    ) {
        const deployment = await this.store.getDeployment(id);
        if (!deployment) {
            throw new ExternalActionError(
                'EXTERNAL_DEPLOYMENT_NOT_FOUND',
                404,
                `External deployment ${id} was not found.`,
            );
        }
        assertExternalActionOwnerAccess(actor, deployment.ownerUserId, scope);

        const eligibility = await this.eligibilityLookup.getEligibilityForSignal(
            deployment.signalCode,
            deployment.signalVersion,
        );

        const enabled = await this.store.enableDeployment(
            id,
            actor.id,
            eligibility?.eligibilityState ?? 'unknown',
        );
        if (!enabled) {
            throw new ExternalActionError(
                'EXTERNAL_DEPLOYMENT_NOT_FOUND',
                404,
                `External deployment ${id} was not found.`,
            );
        }

        return enabled;
    }

    async enableDeployment(id: string, actorUserId?: string | null) {
        const normalizedActorUserId = this.normalizeOptional(actorUserId);
        if (!normalizedActorUserId) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                'actorUserId is required.',
            );
        }

        return this.enableDeploymentForActor(id, {
            id: normalizedActorUserId,
            role: 'USER',
        });
    }

    async pauseDeploymentForActor(
        id: string,
        actor: ExternalActionActor,
        reason?: string | null,
        scope: ExternalActionAccessScope = {},
    ) {
        const deployment = await this.store.getDeployment(id);
        if (!deployment) {
            throw new ExternalActionError(
                'EXTERNAL_DEPLOYMENT_NOT_FOUND',
                404,
                `External deployment ${id} was not found.`,
            );
        }
        assertExternalActionOwnerAccess(actor, deployment.ownerUserId, scope);

        const paused = await this.store.pauseDeployment(
            id,
            actor.id,
            this.normalizeOptional(reason) ?? 'Paused by operator.',
        );
        if (!paused) {
            throw new ExternalActionError(
                'EXTERNAL_DEPLOYMENT_NOT_FOUND',
                404,
                `External deployment ${id} was not found.`,
            );
        }

        return paused;
    }

    async pauseDeployment(id: string, actorUserId?: string | null, reason?: string | null) {
        const normalizedActorUserId = this.normalizeOptional(actorUserId);
        if (!normalizedActorUserId) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                'actorUserId is required.',
            );
        }

        return this.pauseDeploymentForActor(id, {
            id: normalizedActorUserId,
            role: 'USER',
        }, reason);
    }

    async archiveDeploymentForActor(
        id: string,
        actor: ExternalActionActor,
        reason?: string | null,
        scope: ExternalActionAccessScope = {},
    ) {
        const deployment = await this.store.getDeployment(id);
        if (!deployment) {
            throw new ExternalActionError(
                'EXTERNAL_DEPLOYMENT_NOT_FOUND',
                404,
                `External deployment ${id} was not found.`,
            );
        }
        assertExternalActionOwnerAccess(actor, deployment.ownerUserId, scope);

        const archived = await this.store.archiveDeployment(
            id,
            actor.id,
            this.normalizeOptional(reason) ?? 'Archived by operator.',
        );
        if (!archived) {
            throw new ExternalActionError(
                'EXTERNAL_DEPLOYMENT_NOT_FOUND',
                404,
                `External deployment ${id} was not found.`,
            );
        }

        return archived;
    }

    async archiveDeployment(id: string, actorUserId?: string | null, reason?: string | null) {
        const normalizedActorUserId = this.normalizeOptional(actorUserId);
        if (!normalizedActorUserId) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                'actorUserId is required.',
            );
        }

        return this.archiveDeploymentForActor(id, {
            id: normalizedActorUserId,
            role: 'USER',
        }, reason);
    }

    private requireNonEmpty(value: string | null | undefined, fieldName: string) {
        const normalized = this.normalizeOptional(value);
        if (!normalized) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                `${fieldName} is required.`,
            );
        }

        return normalized;
    }

    private normalizeOptional(value: string | null | undefined) {
        if (typeof value !== 'string') {
            return null;
        }

        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }

    private async ensureOwnerUser(ownerUserId: string | null) {
        if (!ownerUserId) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                400,
                'ownerUserId is required.',
            );
        }

        const user = await this.prisma.user.findUnique({
            where: { id: ownerUserId },
            select: { id: true },
        });
        if (!user) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_INPUT_INVALID',
                404,
                `User ${ownerUserId} was not found.`,
            );
        }
    }
}
