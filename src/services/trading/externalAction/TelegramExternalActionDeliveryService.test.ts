import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { TelegramExternalActionDeliveryService } from './TelegramExternalActionDeliveryService';
import { encryptSecret } from './secretCrypto';

describe('TelegramExternalActionDeliveryService', () => {
    const env = {
        ENCRYPTION_KEY: '12345678901234567890123456789012',
        TELEGRAM_API_BASE_URL: 'https://telegram.example.test',
    } as NodeJS.ProcessEnv;

    function makeEvent() {
        return {
            id: 'event-1',
            externalDeploymentId: 'dep-1',
            internalSignalEventId: 'evt-1',
            idempotencyKey: 'dep-1:evt-1',
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
                    internalSignalEventId: 'evt-1',
                    signalKey: 'songTrap@v3',
                },
            },
            status: 'READY',
            statusReason: null,
            emittedAt: '2026-03-13T10:00:01.000Z',
            expiresAt: null,
            supersedesEventId: null,
            createdAt: '2026-03-13T10:00:01.000Z',
            updatedAt: '2026-03-13T10:00:01.000Z',
            deployment: {
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
                telegramBotTokenCiphertext: encryptSecret('telegram-token', env),
                telegramChatId: '-1001',
                telegramChatLabel: 'VIP',
                messageTemplateKind: 'DEFAULT_V1',
                createdByUserId: 'user-1',
                enabledByUserId: 'user-1',
                pausedByUserId: null,
                archivedByUserId: null,
                enabledAt: '2026-03-13T09:59:00.000Z',
                pausedAt: null,
                archivedAt: null,
                lastEligibilityCheckAt: '2026-03-13T10:00:00.000Z',
                createdAt: '2026-03-13T09:58:00.000Z',
                updatedAt: '2026-03-13T10:00:00.000Z',
            },
        } as const;
    }

    it('sends Telegram messages and returns provider metadata', async () => {
        const fetchCalls: unknown[] = [];
        const service = new TelegramExternalActionDeliveryService(
            env,
            async (url, init) => {
                fetchCalls.push({ url, init });
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({}),
                    text: async () => JSON.stringify({
                        ok: true,
                        result: {
                            message_id: 42,
                            chat: {
                                id: -1001,
                            },
                        },
                    }),
                };
            },
        );

        const result = await service.deliver(makeEvent() as never);

        assert.equal(fetchCalls.length, 1);
        assert.equal((fetchCalls[0] as { url: string }).url, 'https://telegram.example.test/bottelegram-token/sendMessage');
        assert.equal(
            JSON.parse((fetchCalls[0] as { init: { body: string } }).init.body).text,
            [
                '🚨 Signal Alert',
                '🧠 songTrap@v3',
                '🟢 XAUUSD H1 LONG',
                '',
                '💰 Entry: 2000',
                '🛑 Stop Loss: 1990',
                '🎯 TP1: 2010',
                '🎯 TP2: 2020',
                '',
                '🕒 Emitted: 2026-03-13T10:00:01.000Z',
                '🧷 Deployment: dep-1',
                '⚠️ Signal only. Not guaranteed execution.',
            ].join('\n'),
        );
        assert.equal(result.providerMessageId, '42');
        assert.equal(result.providerChatId, '-1001');
        assert.equal(typeof result.requestFingerprint, 'string');
    });

    it('renders a short structured Telegram message with icons', () => {
        const service = new TelegramExternalActionDeliveryService(env);

        assert.equal(
            service.renderMessage(makeEvent() as never),
            [
                '🚨 Signal Alert',
                '🧠 songTrap@v3',
                '🟢 XAUUSD H1 LONG',
                '',
                '💰 Entry: 2000',
                '🛑 Stop Loss: 1990',
                '🎯 TP1: 2010',
                '🎯 TP2: 2020',
                '',
                '🕒 Emitted: 2026-03-13T10:00:01.000Z',
                '🧷 Deployment: dep-1',
                '⚠️ Signal only. Not guaranteed execution.',
            ].join('\n'),
        );
    });

    it('throws when Telegram rejects the delivery', async () => {
        const service = new TelegramExternalActionDeliveryService(
            env,
            async () => ({
                ok: false,
                status: 400,
                json: async () => ({}),
                text: async () => JSON.stringify({
                    ok: false,
                    description: 'chat not found',
                }),
            }),
        );

        await assert.rejects(
            () => service.deliver(makeEvent() as never),
            /chat not found/,
        );
    });
});
