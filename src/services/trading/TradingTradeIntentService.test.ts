import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { TradingTradeIntentService } from './TradingTradeIntentService';

describe('TradingTradeIntentService', () => {
    it('captures paper ENTRY events and enqueues worker jobs', async () => {
        const createCalls: Array<Record<string, unknown>> = [];
        const enqueueCalls: unknown[] = [];
        const prisma = {
            tradingAutomationBinding: {
                findMany: async () => [{
                    id: 'binding-1',
                    accountId: 'acct-1',
                    name: 'Paper Auto',
                }],
                update: async () => undefined,
            },
            tradingTradeIntent: {
                create: async (args: { data: Record<string, unknown> }) => {
                    createCalls.push(args.data);
                    return {
                        id: 'intent-1',
                        ...args.data,
                    };
                },
                update: async () => undefined,
            },
        } as unknown as PrismaClient;

        const service = new TradingTradeIntentService(
            prisma,
            {
                enqueue: async (input) => {
                    enqueueCalls.push(input);
                },
            },
            {
                getBrokerContext: async () => {
                    throw new Error('not used');
                },
            },
        );

        const created = await service.captureAutoExecuteEntryIntents({
            indicatorInstanceId: 'inst-1',
            runtimeSignal: {
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                entryTime: new Date('2026-03-12T09:00:00.000Z'),
                entryPrice: 3230,
                stopLoss: 3220,
                takeProfit1: 3240,
                externalKey: 'signal-1',
            },
            persistedEvents: [{
                draftEvent: {
                    signalExternalKey: 'signal-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    price: 3230,
                    label: 'ENTRY',
                },
                savedEvent: {
                    id: 'evt-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    price: new Prisma.Decimal(3230),
                    label: 'ENTRY',
                    metaJson: null,
                },
            }],
        });

        assert.equal(created, 1);
        assert.equal(createCalls.length, 1);
        assert.equal(createCalls[0].signalEventId, 'evt-1');
        assert.equal(createCalls[0].indicatorInstanceId, 'inst-1');
        assert.equal(enqueueCalls.length, 1);
        assert.deepEqual(enqueueCalls[0], { tradeIntentId: 'intent-1' });
    });

    it('returns recent intent history for workspace inspection', async () => {
        const prisma = {
            tradingTradeIntent: {
                findMany: async () => [{
                    id: 'intent-1',
                    accountId: 'acct-1',
                    bindingId: 'binding-1',
                    signalEventId: 'evt-1',
                    mode: 'AUTO_EXECUTE',
                    status: 'EXECUTED',
                    statusReason: 'Paper auto-execution completed through the approved command boundary.',
                    eventType: 'ENTRY',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    volume: new Prisma.Decimal(0.1),
                    entryPrice: new Prisma.Decimal(3230),
                    stopLoss: new Prisma.Decimal(3220),
                    takeProfit: new Prisma.Decimal(3240),
                    payloadJson: null,
                    startedAt: new Date('2026-03-12T09:00:01.000Z'),
                    completedAt: new Date('2026-03-12T09:00:05.000Z'),
                    createdAt: new Date('2026-03-12T09:00:00.000Z'),
                    updatedAt: new Date('2026-03-12T09:00:05.000Z'),
                    binding: {
                        id: 'binding-1',
                        name: 'Paper Auto',
                        indicatorInstance: {
                            id: 'inst-1',
                            name: 'Live Song Trap',
                        },
                    },
                    signalEvent: {
                        candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    },
                    executionCommand: {
                        id: 'cmd-1',
                        status: 'RECONCILED',
                        errorMessage: null,
                    },
                }],
            },
        } as unknown as PrismaClient;

        const service = new TradingTradeIntentService(
            prisma,
            null,
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Paper Account',
                    brokerKind: 'MT5',
                    accountMode: 'PAPER',
                    status: 'ACTIVE',
                    baseCurrency: 'USD',
                    leverage: 500,
                    lastSeenAt: null,
                    lastSuccessfulSyncAt: null,
                    metadataJson: null,
                    credential: null,
                }),
            },
        );

        const items = await service.listIntents({ id: 'user-1', role: 'USER' }, 'acct-1');

        assert.equal(items.length, 1);
        assert.equal(items[0].bindingName, 'Paper Auto');
        assert.equal(items[0].executionCommandStatus, 'RECONCILED');
        assert.equal(items[0].volume, 0.1);
    });

    it('marks intent as FAILED when enqueue throws', async () => {
        const intentUpdates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingAutomationBinding: {
                findMany: async () => [{
                    id: 'binding-1',
                    accountId: 'acct-1',
                    name: 'Paper Auto',
                }],
                update: async () => undefined,
            },
            tradingTradeIntent: {
                create: async (args: { data: Record<string, unknown> }) => ({
                    id: 'intent-1',
                    ...args.data,
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    intentUpdates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const service = new TradingTradeIntentService(
            prisma,
            {
                enqueue: async () => {
                    throw new Error('Redis connection refused');
                },
            },
            {
                getBrokerContext: async () => {
                    throw new Error('not used');
                },
            },
        );

        const created = await service.captureAutoExecuteEntryIntents({
            indicatorInstanceId: 'inst-1',
            runtimeSignal: {
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                entryTime: new Date('2026-03-12T09:00:00.000Z'),
                entryPrice: 3230,
                stopLoss: 3220,
                takeProfit1: 3240,
                externalKey: 'signal-1',
            },
            persistedEvents: [{
                draftEvent: {
                    signalExternalKey: 'signal-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    price: 3230,
                    label: 'ENTRY',
                },
                savedEvent: {
                    id: 'evt-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    price: new Prisma.Decimal(3230),
                    label: 'ENTRY',
                    metaJson: null,
                },
            }],
        });

        assert.equal(created, 1);
        assert.equal(intentUpdates.some((u) => u.status === 'FAILED'), true);
        assert.equal(
            intentUpdates.some((u) => typeof u.statusReason === 'string' && (u.statusReason as string).includes('Redis connection refused')),
            true,
        );
    });

    it('silently skips duplicate intents from Prisma P2002 unique constraint', async () => {
        const prisma = {
            tradingAutomationBinding: {
                findMany: async () => [{
                    id: 'binding-1',
                    accountId: 'acct-1',
                    name: 'Paper Auto',
                }],
                update: async () => undefined,
            },
            tradingTradeIntent: {
                create: async () => {
                    const error = new Error('Unique constraint failed') as Error & { code: string };
                    error.code = 'P2002';
                    throw error;
                },
                update: async () => undefined,
            },
        } as unknown as PrismaClient;

        const service = new TradingTradeIntentService(
            prisma,
            {
                enqueue: async () => {
                    throw new Error('should not run');
                },
            },
            {
                getBrokerContext: async () => {
                    throw new Error('not used');
                },
            },
        );

        const created = await service.captureAutoExecuteEntryIntents({
            indicatorInstanceId: 'inst-1',
            runtimeSignal: {
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                entryTime: new Date('2026-03-12T09:00:00.000Z'),
                entryPrice: 3230,
                stopLoss: 3220,
                takeProfit1: 3240,
                externalKey: 'signal-1',
            },
            persistedEvents: [{
                draftEvent: {
                    signalExternalKey: 'signal-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    price: 3230,
                    label: 'ENTRY',
                },
                savedEvent: {
                    id: 'evt-1',
                    eventType: 'ENTRY',
                    candleTime: new Date('2026-03-12T09:00:00.000Z'),
                    price: new Prisma.Decimal(3230),
                    label: 'ENTRY',
                    metaJson: null,
                },
            }],
        });

        assert.equal(created, 0);
    });
});
