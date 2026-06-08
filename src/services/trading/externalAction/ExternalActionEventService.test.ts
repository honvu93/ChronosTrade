import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExternalActionEventService } from './ExternalActionEventService';

describe('ExternalActionEventService', () => {
    it('creates and enqueues actionable ENTRY events for active live-eligible deployments', async () => {
        const createCalls: unknown[] = [];
        const queueCalls: unknown[] = [];
        const store = {
            findActiveDeploymentsByIndicatorInstance: async () => [{
                id: 'dep-1',
                ownerUserId: 'user-1',
                indicatorInstanceId: 'inst-1',
                signalCode: 'songTrap',
                signalVersion: 3,
                sourceBacktestRunId: 'run-1',
                status: 'ACTIVE',
                statusReason: null,
                eligibilityStateSnapshot: 'live-eligible',
                telegramBotLabel: 'ops-bot',
                telegramBotTokenCiphertext: 'cipher',
                telegramChatId: '-1001',
                telegramChatLabel: 'VIP',
                messageTemplateKind: 'DEFAULT_V1',
                createdByUserId: 'user-1',
                enabledByUserId: 'user-1',
                pausedByUserId: null,
                archivedByUserId: null,
                enabledAt: '2026-03-13T10:00:00.000Z',
                pausedAt: null,
                archivedAt: null,
                lastEligibilityCheckAt: '2026-03-13T10:00:00.000Z',
                createdAt: '2026-03-13T09:00:00.000Z',
                updatedAt: '2026-03-13T10:00:00.000Z',
            }],
            createActionableEvent: async (input: { eventId: string }) => {
                createCalls.push(input);
                return {
                    id: input.eventId,
                };
            },
            updateActionableEventStatus: async () => undefined,
            autoPauseActiveDeploymentsByIndicatorInstance: async () => 0,
        };
        const service = new ExternalActionEventService(
            store as never,
            {
                enqueue: async (input) => {
                    queueCalls.push(input);
                },
            },
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

        const created = await service.captureActionableEvents({
            indicatorInstanceId: 'inst-1',
            runtimeSignal: {
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                entryTime: new Date('2026-03-13T10:00:00.000Z'),
                entryPrice: 2000,
                stopLoss: 1990,
                takeProfit1: 2010,
                takeProfit2: 2020,
                externalKey: 'sig-1',
            },
            persistedEvents: [{
                draftEvent: {
                    signalExternalKey: 'sig-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-13T10:00:00.000Z'),
                    price: 2000,
                    label: 'ENTRY',
                    metaJson: null,
                },
                savedEvent: {
                    id: 'evt-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-13T10:00:00.000Z'),
                    price: 2000,
                    label: 'ENTRY',
                    metaJson: null,
                },
            }],
        });

        assert.equal(created, 1);
        assert.equal(createCalls.length, 1);
        assert.equal(queueCalls.length, 1);
        assert.equal((queueCalls[0] as { externalActionEventId: string }).externalActionEventId, (createCalls[0] as { eventId: string }).eventId);
    });

    it('keeps publishing actionable events when the signal is validated but not live-eligible', async () => {
        const createCalls: unknown[] = [];
        const queueCalls: unknown[] = [];
        const autoPauseCalls: unknown[] = [];
        const service = new ExternalActionEventService(
            {
                findActiveDeploymentsByIndicatorInstance: async () => [{
                    id: 'dep-1',
                    ownerUserId: 'user-1',
                    indicatorInstanceId: 'inst-1',
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    sourceBacktestRunId: 'run-1',
                    status: 'ACTIVE',
                    statusReason: null,
                    eligibilityStateSnapshot: 'live-eligible',
                    telegramBotLabel: 'ops-bot',
                    telegramBotTokenCiphertext: 'cipher',
                    telegramChatId: '-1001',
                    telegramChatLabel: 'VIP',
                    messageTemplateKind: 'DEFAULT_V1',
                    createdByUserId: 'user-1',
                    enabledByUserId: 'user-1',
                    pausedByUserId: null,
                    archivedByUserId: null,
                    enabledAt: '2026-03-13T10:00:00.000Z',
                    pausedAt: null,
                    archivedAt: null,
                    lastEligibilityCheckAt: '2026-03-13T10:00:00.000Z',
                    createdAt: '2026-03-13T09:00:00.000Z',
                    updatedAt: '2026-03-13T10:00:00.000Z',
                }],
                createActionableEvent: async (input: { eventId: string; payload: { source: { eligibilityState: string } } }) => {
                    createCalls.push(input);
                    return {
                        id: input.eventId,
                    };
                },
                updateActionableEventStatus: async () => undefined,
                autoPauseActiveDeploymentsByIndicatorInstance: async (...args: unknown[]) => {
                    autoPauseCalls.push(args);
                    return 1;
                },
            } as never,
            {
                enqueue: async (input) => {
                    queueCalls.push(input);
                },
            },
            {
                getEligibilityForSignal: async () => ({
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    signalName: 'Song Trap',
                    backtestRunId: 'run-1',
                    backtestRunName: 'Validation Run',
                    backtestRunStatus: 'COMPLETED',
                    eligibilityState: 'validated',
                    blockingReasons: [{
                        code: 'sample_below_live_threshold',
                        label: 'Too few trades.',
                    }],
                    metrics: null,
                    evaluatedAt: '2026-03-13T10:00:00.000Z',
                }),
            },
        );

        const created = await service.captureActionableEvents({
            indicatorInstanceId: 'inst-1',
            runtimeSignal: {
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                entryTime: new Date('2026-03-13T10:00:00.000Z'),
                entryPrice: 2000,
                stopLoss: 1990,
                takeProfit1: 2010,
                takeProfit2: 2020,
                externalKey: 'sig-1',
            },
            persistedEvents: [{
                draftEvent: {
                    signalExternalKey: 'sig-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-13T10:00:00.000Z'),
                    price: 2000,
                    label: 'ENTRY',
                    metaJson: null,
                },
                savedEvent: {
                    id: 'evt-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-13T10:00:00.000Z'),
                    price: 2000,
                    label: 'ENTRY',
                    metaJson: null,
                },
            }],
        });

        assert.equal(created, 1);
        assert.equal(createCalls.length, 1);
        assert.equal(queueCalls.length, 1);
        assert.equal(autoPauseCalls.length, 0);
        assert.equal((createCalls[0] as { payload: { source: { eligibilityState: string } } }).payload.source.eligibilityState, 'validated');
    });
});
