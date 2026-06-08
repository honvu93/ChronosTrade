import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExternalActionReplayService } from './ExternalActionReplayService';

describe('ExternalActionReplayService', () => {
    function makeEvent(ownerUserId = 'user-1') {
        return {
            id: 'event-1',
            externalDeploymentId: 'dep-1',
            internalSignalEventId: 'sig-1',
            idempotencyKey: 'dep-1:sig-1',
            contractKind: 'actionable-signal-event',
            contractVersion: 1,
            eventType: 'ENTRY',
            actionability: 'ACTIONABLE',
            actionType: 'OPEN_MARKET',
            signalCode: 'songTrap',
            signalVersion: 3,
            indicatorInstanceId: 'inst-1',
            sourceBacktestRunId: 'run-1',
            symbol: 'XAUUSD',
            timeframe: 'H1',
            side: 'LONG',
            candleTime: '2026-03-13T10:00:00.000Z',
            referencePrice: 2000,
            entryPrice: 2000,
            entryType: 'MARKET',
            stopLoss: 1990,
            takeProfit1: 2010,
            takeProfit2: 2020,
            suggestedVolume: null,
            payload: {
                contractKind: 'actionable-signal-event',
                contractVersion: 1,
                eventId: 'event-1',
                emittedAt: '2026-03-13T10:00:01.000Z',
                actionability: 'ACTIONABLE',
                actionType: 'OPEN_MARKET',
                source: {
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    indicatorInstanceId: 'inst-1',
                    sourceBacktestRunId: 'run-1',
                    externalDeploymentId: 'dep-1',
                    eligibilityState: 'live-eligible',
                },
                market: {
                    symbol: 'XAUUSD',
                    timeframe: 'H1',
                    side: 'LONG',
                    candleTime: '2026-03-13T10:00:00.000Z',
                    referencePrice: 2000,
                },
                execution: {
                    entryPrice: 2000,
                    entryType: 'MARKET',
                    stopLoss: 1990,
                    takeProfit1: 2010,
                    takeProfit2: 2020,
                    suggestedVolume: null,
                },
                trace: {
                    internalSignalEventId: 'sig-1',
                    signalKey: 'songTrap@v3',
                },
            },
            status: 'FAILED',
            statusReason: 'Previous delivery failed.',
            emittedAt: '2026-03-13T10:00:01.000Z',
            expiresAt: null,
            supersedesEventId: null,
            createdAt: '2026-03-13T10:00:01.000Z',
            updatedAt: '2026-03-13T10:00:01.000Z',
            deployment: {
                id: 'dep-1',
                ownerUserId,
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
                createdByUserId: ownerUserId,
                enabledByUserId: ownerUserId,
                pausedByUserId: null,
                archivedByUserId: null,
                enabledAt: '2026-03-13T10:00:00.000Z',
                pausedAt: null,
                archivedAt: null,
                lastEligibilityCheckAt: '2026-03-13T10:00:00.000Z',
                createdAt: '2026-03-13T09:00:00.000Z',
                updatedAt: '2026-03-13T10:00:00.000Z',
            },
        };
    }

    it('restores the previous event status when replay enqueue fails', async () => {
        const statusUpdates: Array<{ status: string; reason: string | null }> = [];
        const replayFailures: string[] = [];
        const service = new ExternalActionReplayService(
            {
                getActionableEventWithDeployment: async () => makeEvent(),
                createReplayJob: async () => ({
                    id: 'replay-1',
                    externalActionEventId: 'event-1',
                    replayKind: 'MANUAL_RETRY',
                    status: 'QUEUED',
                    queuedAt: '2026-03-13T10:00:02.000Z',
                    startedAt: null,
                    finishedAt: null,
                    errorMessage: null,
                    createdByUserId: 'user-1',
                    createdAt: '2026-03-13T10:00:02.000Z',
                }),
                updateActionableEventStatus: async (_eventId: string, status: string, reason: string | null) => {
                    statusUpdates.push({ status, reason });
                },
                markReplayJobFailed: async (_replayJobId: string, errorMessage: string) => {
                    replayFailures.push(errorMessage);
                },
            } as never,
            {
                enqueue: async () => {
                    throw new Error('redis unavailable');
                },
            },
        );

        await assert.rejects(
            () => service.replayEvent('event-1', { id: 'user-1', role: 'USER' }),
            /redis unavailable/,
        );

        assert.deepEqual(statusUpdates, [
            { status: 'READY', reason: 'Queued for manual replay.' },
            { status: 'FAILED', reason: 'Previous delivery failed.' },
        ]);
        assert.equal(replayFailures.length, 1);
    });

    it('blocks replay for another owner without explicit admin scope', async () => {
        const service = new ExternalActionReplayService(
            {
                getActionableEventWithDeployment: async () => makeEvent('user-2'),
            } as never,
            {
                enqueue: async () => undefined,
            },
        );

        await assert.rejects(
            () => service.replayEvent('event-1', { id: 'user-1', role: 'USER' }),
            /only be managed by its owner/i,
        );
    });
});
