import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExternalActionDeploymentService } from './ExternalActionDeploymentService';

describe('ExternalActionDeploymentService', () => {
    const env = {
        ENCRYPTION_KEY: '12345678901234567890123456789012',
    } as NodeJS.ProcessEnv;

    it('creates draft external deployments from indicator instances without exposing plain Telegram tokens', async () => {
        const createCalls: unknown[] = [];
        const service = new ExternalActionDeploymentService(
            {
                user: {
                    findUnique: async () => ({ id: 'user-1' }),
                },
                indicatorInstance: {
                    findUnique: async () => ({
                        id: 'inst-1',
                        signalCode: 'songTrap',
                        signalVersion: 3,
                        sourceBacktestRunId: 'run-1',
                    }),
                },
            } as never,
            {
                createDeployment: async (input: {
                    telegramBotTokenCiphertext: string;
                    [key: string]: unknown;
                }) => {
                    createCalls.push(input);
                    return {
                        id: 'dep-1',
                        ...input,
                        status: 'DRAFT',
                        statusReason: null,
                        telegramBotTokenCiphertext: input.telegramBotTokenCiphertext,
                        enabledByUserId: null,
                        enabledAt: null,
                        pausedAt: null,
                        archivedAt: null,
                        lastEligibilityCheckAt: null,
                        createdAt: '2026-03-13T10:00:00.000Z',
                        updatedAt: '2026-03-13T10:00:00.000Z',
                    };
                },
            } as never,
            env,
            {
                getEligibilityForSignal: async () => ({
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    signalName: 'Song Trap',
                    backtestRunId: 'run-1',
                    backtestRunName: 'Validation Run',
                    backtestRunStatus: 'COMPLETED',
                    eligibilityState: 'live-eligible',
                    blockingReasons: [],
                    metrics: null,
                    evaluatedAt: '2026-03-13T10:00:00.000Z',
                }),
            },
        );

        const deployment = await service.createDeployment({
            indicatorInstanceId: 'inst-1',
            telegramBotToken: 'telegram-token',
            telegramChatId: '-1001',
            telegramBotLabel: 'ops-bot',
            telegramChatLabel: 'VIP',
            actorUserId: 'user-1',
        });

        assert.equal(deployment.id, 'dep-1');
        assert.equal(createCalls.length, 1);
        assert.notEqual((createCalls[0] as { telegramBotTokenCiphertext: string }).telegramBotTokenCiphertext, 'telegram-token');
        assert.equal((createCalls[0] as { ownerUserId: string }).ownerUserId, 'user-1');
    });

    it('allows enablement when the signal is validated but not live-eligible', async () => {
        const enableCalls: unknown[] = [];
        const service = new ExternalActionDeploymentService(
            {
                user: {
                    findUnique: async () => ({ id: 'user-1' }),
                },
            } as never,
            {
                getDeployment: async () => ({
                    id: 'dep-1',
                    ownerUserId: 'user-1',
                    indicatorInstanceId: 'inst-1',
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    sourceBacktestRunId: 'run-1',
                    status: 'DRAFT',
                    statusReason: null,
                    eligibilityStateSnapshot: 'validated',
                    telegramBotLabel: 'ops-bot',
                    telegramBotTokenCiphertext: 'cipher',
                    telegramChatId: '-1001',
                    telegramChatLabel: 'VIP',
                    messageTemplateKind: 'DEFAULT_V1',
                    createdByUserId: 'user-1',
                    enabledByUserId: null,
                    pausedByUserId: null,
                    archivedByUserId: null,
                    enabledAt: null,
                    pausedAt: null,
                    archivedAt: null,
                    lastEligibilityCheckAt: null,
                    createdAt: '2026-03-13T10:00:00.000Z',
                    updatedAt: '2026-03-13T10:00:00.000Z',
                }),
                enableDeployment: async (...args: unknown[]) => {
                    enableCalls.push(args);
                    return {
                        id: 'dep-1',
                        ownerUserId: 'user-1',
                        indicatorInstanceId: 'inst-1',
                        signalCode: 'songTrap',
                        signalVersion: 3,
                        sourceBacktestRunId: 'run-1',
                        status: 'ACTIVE',
                        statusReason: null,
                        eligibilityStateSnapshot: 'validated',
                        telegramBotLabel: 'ops-bot',
                        telegramBotTokenCiphertext: 'cipher',
                        telegramChatId: '-1001',
                        telegramChatLabel: 'VIP',
                        messageTemplateKind: 'DEFAULT_V1',
                        createdByUserId: 'user-1',
                        enabledByUserId: 'user-1',
                        pausedByUserId: null,
                        archivedByUserId: null,
                        enabledAt: '2026-03-13T11:00:00.000Z',
                        pausedAt: null,
                        archivedAt: null,
                        lastEligibilityCheckAt: '2026-03-13T11:00:00.000Z',
                        createdAt: '2026-03-13T10:00:00.000Z',
                        updatedAt: '2026-03-13T11:00:00.000Z',
                    };
                },
            } as never,
            env,
            {
                getEligibilityForSignal: async () => ({
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    signalName: 'Song Trap',
                    backtestRunId: 'run-1',
                    backtestRunName: 'Validation Run',
                    backtestRunStatus: 'COMPLETED',
                    eligibilityState: 'validated',
                    blockingReasons: [],
                    metrics: null,
                    evaluatedAt: '2026-03-13T10:00:00.000Z',
                }),
            },
        );

        const deployment = await service.enableDeployment('dep-1', 'user-1');

        assert.equal(deployment.status, 'ACTIVE');
        assert.equal(enableCalls.length, 1);
        assert.deepEqual(enableCalls[0], ['dep-1', 'user-1', 'validated']);
    });

    it('blocks users from enabling another owner deployment', async () => {
        const service = new ExternalActionDeploymentService(
            {
                user: {
                    findUnique: async () => ({ id: 'user-1' }),
                },
            } as never,
            {
                getDeployment: async () => ({
                    id: 'dep-1',
                    ownerUserId: 'user-2',
                    indicatorInstanceId: 'inst-1',
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    sourceBacktestRunId: 'run-1',
                    status: 'DRAFT',
                    statusReason: null,
                    eligibilityStateSnapshot: 'live-eligible',
                    telegramBotLabel: 'ops-bot',
                    telegramBotTokenCiphertext: 'cipher',
                    telegramChatId: '-1001',
                    telegramChatLabel: 'VIP',
                    messageTemplateKind: 'DEFAULT_V1',
                    createdByUserId: 'user-2',
                    enabledByUserId: null,
                    pausedByUserId: null,
                    archivedByUserId: null,
                    enabledAt: null,
                    pausedAt: null,
                    archivedAt: null,
                    lastEligibilityCheckAt: null,
                    createdAt: '2026-03-13T10:00:00.000Z',
                    updatedAt: '2026-03-13T10:00:00.000Z',
                }),
            } as never,
            env,
            {
                getEligibilityForSignal: async () => ({
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    signalName: 'Song Trap',
                    backtestRunId: 'run-1',
                    backtestRunName: 'Validation Run',
                    backtestRunStatus: 'COMPLETED',
                    eligibilityState: 'live-eligible',
                    blockingReasons: [],
                    metrics: null,
                    evaluatedAt: '2026-03-13T10:00:00.000Z',
                }),
            },
        );

        await assert.rejects(
            () => service.enableDeploymentForActor('dep-1', { id: 'user-1', role: 'USER' }),
            /only be managed by its owner/i,
        );
    });
});
