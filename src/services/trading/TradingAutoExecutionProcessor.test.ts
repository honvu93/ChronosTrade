import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { TradingAutoExecutionProcessor } from './TradingAutoExecutionProcessor';

describe('TradingAutoExecutionProcessor', () => {
    it('submits paper intents through the approved command boundary', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const commandCalls: unknown[] = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    accountId: 'acct-1',
                    bindingId: 'binding-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    stopLoss: new Prisma.Decimal(3220),
                    takeProfit: new Prisma.Decimal(3240),
                    binding: {
                        id: 'binding-1',
                        name: 'Paper Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: {
                            fixedVolume: 0.15,
                        },
                        account: {
                            ownerUserId: 'user-1',
                            accountMode: 'PAPER',
                        },
                    },
                    executionCommand: null,
                    createdAt: new Date(),
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async (actor, accountId, input, options) => {
                    commandCalls.push({ actor, accountId, input, options });
                    return {
                        id: 'cmd-1',
                        accountId: 'acct-1',
                        commandType: 'OPEN_MARKET',
                        status: 'RECONCILED',
                        idempotencyKey: 'trade-intent:intent-1',
                        symbol: 'XAUUSD',
                        side: 'LONG',
                        volume: 0.15,
                        price: null,
                        stopLoss: 3220,
                        takeProfit: 3240,
                        brokerPositionId: '9001',
                        brokerOrderId: '9000',
                        brokerReference: 'deal-1',
                        requestedAt: '2026-03-12T09:00:00.000Z',
                        dispatchedAt: '2026-03-12T09:00:01.000Z',
                        completedAt: '2026-03-12T09:00:02.000Z',
                        reconciledAt: '2026-03-12T09:00:03.000Z',
                        errorCode: null,
                        errorMessage: null,
                        events: [],
                    };
                },
            },
        );

        await processor.process('intent-1');

        assert.equal(commandCalls.length, 1);
        assert.deepEqual(commandCalls[0], {
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            input: {
                commandType: 'OPEN_MARKET',
                symbol: 'XAUUSD',
                side: 'LONG',
                volume: 0.15,
                stopLoss: 3220,
                takeProfit: 3240,
                comment: 'AUTO_EXECUTE Paper Auto evt-1',
                idempotencyKey: 'trade-intent:intent-1',
                tradeIntentId: 'intent-1',
            },
            options: {
                skipReconciliation: true,
                retryFailedCommand: true,
            },
        });
        assert.equal(updates.some((update) => update.status === 'EXECUTED'), true);
    });

    it('fails closed for live accounts', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    accountId: 'acct-1',
                    bindingId: 'binding-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    stopLoss: new Prisma.Decimal(3220),
                    takeProfit: new Prisma.Decimal(3240),
                    binding: {
                        id: 'binding-1',
                        name: 'Live Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: null,
                        account: {
                            ownerUserId: 'user-1',
                            accountMode: 'LIVE',
                        },
                    },
                    executionCommand: null,
                    createdAt: new Date(),
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async () => {
                    throw new Error('should not run');
                },
            },
        );

        await processor.process('intent-1');

        assert.equal(updates.some((update) => update.status === 'REJECTED'), true);
        assert.equal(
            updates.some((update) => update.statusReason === 'Auto-execution is available only for paper/demo MT5 accounts.'),
            true,
        );
    });

    it('rejects intents when the binding kill switch is active', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    accountId: 'acct-1',
                    bindingId: 'binding-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    stopLoss: new Prisma.Decimal(3220),
                    takeProfit: new Prisma.Decimal(3240),
                    binding: {
                        id: 'binding-1',
                        name: 'Killed Binding',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: true,
                        riskConfigJson: null,
                        account: {
                            ownerUserId: 'user-1',
                            accountMode: 'PAPER',
                        },
                    },
                    executionCommand: null,
                    createdAt: new Date(),
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async () => {
                    throw new Error('should not run');
                },
            },
        );

        await processor.process('intent-1');

        assert.equal(updates.some((update) => update.status === 'REJECTED'), true);
        assert.equal(
            updates.some((update) => update.statusReason === 'The binding kill switch is active, so the worker failed closed.'),
            true,
        );
    });

    it('falls back to lotSize then default 0.01 when fixedVolume and volume are absent', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const commandCalls: unknown[] = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    accountId: 'acct-1',
                    bindingId: 'binding-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    stopLoss: new Prisma.Decimal(3220),
                    takeProfit: new Prisma.Decimal(3240),
                    binding: {
                        id: 'binding-1',
                        name: 'LotSize Binding',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: { lotSize: 0.05 },
                        account: {
                            ownerUserId: 'user-1',
                            accountMode: 'PAPER',
                        },
                    },
                    executionCommand: null,
                    createdAt: new Date(),
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async (_actor, _accountId, input) => {
                    commandCalls.push(input);
                    return {
                        id: 'cmd-1',
                        accountId: 'acct-1',
                        commandType: 'OPEN_MARKET',
                        status: 'RECONCILED',
                        idempotencyKey: 'trade-intent:intent-1',
                        symbol: 'XAUUSD',
                        side: 'LONG',
                        volume: 0.05,
                        price: null,
                        stopLoss: 3220,
                        takeProfit: 3240,
                        brokerPositionId: '9001',
                        brokerOrderId: '9000',
                        brokerReference: 'deal-1',
                        requestedAt: '2026-03-12T09:00:00.000Z',
                        dispatchedAt: '2026-03-12T09:00:01.000Z',
                        completedAt: '2026-03-12T09:00:02.000Z',
                        reconciledAt: '2026-03-12T09:00:03.000Z',
                        errorCode: null,
                        errorMessage: null,
                        events: [],
                    };
                },
            },
        );

        await processor.process('intent-1');

        assert.equal(commandCalls.length, 1);
        assert.equal((commandCalls[0] as { volume: number }).volume, 0.05);
    });

    it('uses default 0.01 when riskConfigJson has zero or negative values', async () => {
        const commandCalls: unknown[] = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    accountId: 'acct-1',
                    bindingId: 'binding-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    stopLoss: new Prisma.Decimal(3220),
                    takeProfit: new Prisma.Decimal(3240),
                    binding: {
                        id: 'binding-1',
                        name: 'Bad Volume Binding',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: { fixedVolume: -1, volume: 0, lotSize: -0.5 },
                        account: {
                            ownerUserId: 'user-1',
                            accountMode: 'PAPER',
                        },
                    },
                    executionCommand: null,
                    createdAt: new Date(),
                }),
                update: async () => undefined,
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async (_actor, _accountId, input) => {
                    commandCalls.push(input);
                    return {
                        id: 'cmd-1',
                        accountId: 'acct-1',
                        commandType: 'OPEN_MARKET',
                        status: 'RECONCILED',
                        idempotencyKey: 'trade-intent:intent-1',
                        symbol: 'XAUUSD',
                        side: 'LONG',
                        volume: 0.01,
                        price: null,
                        stopLoss: 3220,
                        takeProfit: 3240,
                        brokerPositionId: null,
                        brokerOrderId: null,
                        brokerReference: null,
                        requestedAt: '2026-03-12T09:00:00.000Z',
                        dispatchedAt: null,
                        completedAt: null,
                        reconciledAt: null,
                        errorCode: null,
                        errorMessage: null,
                        events: [],
                    };
                },
            },
        );

        await processor.process('intent-1');

        assert.equal(commandCalls.length, 1);
        assert.equal((commandCalls[0] as { volume: number }).volume, 0.01);
    });

    it('rejects expired intents beyond TTL', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'expired-1',
                    createdAt: new Date(Date.now() - 60000),
                    binding: {
                        account: { accountMode: 'PAPER' },
                    },
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            { createCommand: async () => { throw new Error('should not run'); } },
        );
        await processor.process('expired-1');

        assert.equal(updates.some((u) => u.status === 'REJECTED' && (u.statusReason as string).includes('expired')), true);
    });

    it('does not double-execute when only one worker claim succeeds', async () => {
        let claimCount = 0;
        let commandCalls = 0;
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: claimCount++ === 0 ? 1 : 0 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    binding: {
                        name: 'Paper Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: null,
                        account: { ownerUserId: 'user-1', accountMode: 'PAPER' },
                    },
                    executionCommand: null,
                }),
                update: async () => undefined,
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(prisma, {
            createCommand: async () => {
                commandCalls += 1;
                return { status: 'COMPLETED', errorCode: null, errorMessage: null } as any;
            },
        });

        await Promise.all([
            processor.process('intent-1'),
            processor.process('intent-1'),
        ]);

        assert.equal(commandCalls, 1);
    });

    it('rejects intents when price deviation exceeds threshold', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'deviated-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    symbol: 'XAUUSD',
                    commandType: 'OPEN_MARKET',
                    side: 'LONG',
                    entryPrice: new Prisma.Decimal(2300),
                    binding: {
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        account: {
                            ownerUserId: 'user-1',
                            accountMode: 'PAPER',
                        },
                    },
                    executionCommand: null,
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            { createCommand: async () => { throw new Error('should not run'); } },
            {
                getBrokerContext: async () => ({
                    credential: {
                        mt5Login: '1',
                        mt5Password: 'pw',
                        mt5Server: 'demo',
                    },
                }),
            } as any,
            {
                fetchQuote: async () => ({
                    symbol: 'XAUUSD',
                    bid: 2399,
                    ask: 2400,
                    last: 2400,
                    brokerTime: '2026-03-12T09:00:02.000Z',
                    rawBrokerJson: null,
                }),
                fetchPositions: async () => [],
                fetchSummary: async () => ({ balance: 10000, equity: 10000, realizedPnlDay: 0 }) as any,
            },
        );
        await processor.process('deviated-1');

        assert.equal(updates.some((u) => u.status === 'REJECTED' && (u.statusReason as string).includes('Price deviation too high')), true);
    });

    it('fails open when quote lookup is unavailable', async () => {
        let commandCalls = 0;
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    entryPrice: new Prisma.Decimal(2300),
                    binding: {
                        name: 'Paper Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: null,
                        account: { ownerUserId: 'user-1', accountMode: 'PAPER' },
                    },
                    executionCommand: null,
                }),
                update: async () => undefined,
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(
            prisma,
            {
                createCommand: async () => {
                    commandCalls += 1;
                    return { status: 'COMPLETED', errorCode: null, errorMessage: null } as any;
                },
            },
            {
                getBrokerContext: async () => ({
                    credential: {
                        mt5Login: '1',
                        mt5Password: 'pw',
                        mt5Server: 'demo',
                    },
                }),
            } as any,
            {
                fetchQuote: async () => {
                    throw new Error('bridge unavailable');
                },
                fetchPositions: async () => [],
                fetchSummary: async () => ({ balance: 10000, equity: 10000, realizedPnlDay: 0 }) as any,
            },
        );

        await processor.process('intent-1');
        assert.equal(commandCalls, 1);
    });

    it('rethrows retryable bridge failures before the final BullMQ attempt', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    binding: {
                        name: 'Paper Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: null,
                        account: { ownerUserId: 'user-1', accountMode: 'PAPER' },
                    },
                    executionCommand: null,
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(prisma, {
            createCommand: async () => ({
                status: 'FAILED',
                errorCode: 'BRIDGE_UNREACHABLE',
                errorMessage: 'Bridge down',
            }) as any,
        });

        await assert.rejects(
            () => processor.process('intent-1', { attemptNumber: 1, maxAttempts: 3 }),
            /Bridge down/,
        );

        assert.equal(
            updates.some((update) => typeof update.statusReason === 'string' && (update.statusReason as string).includes('Retry 1/3 scheduled')),
            true,
        );
    });

    it('records the final retryable failure on the last BullMQ attempt', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    binding: {
                        name: 'Paper Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: null,
                        account: { ownerUserId: 'user-1', accountMode: 'PAPER' },
                    },
                    executionCommand: null,
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(prisma, {
            createCommand: async () => ({
                status: 'FAILED',
                errorCode: 'BRIDGE_UNREACHABLE',
                errorMessage: 'Bridge down',
            }) as any,
        });

        await processor.process('intent-1', { attemptNumber: 3, maxAttempts: 3 });

        assert.equal(
            updates.some((update) => update.status === 'FAILED' && typeof update.statusReason === 'string' && (update.statusReason as string).includes('failed after 3 of 3 attempts')),
            true,
        );
    });

    it('passes retry flags to the execution service', async () => {
        let skipFlagReceived = false;
        let retryFlagReceived = false;
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    binding: {
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        account: { ownerUserId: 'user-1', accountMode: 'PAPER' },
                    },
                    executionCommand: null,
                }),
                update: async () => undefined,
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(prisma, {
            createCommand: async (_a, _b, _c, options) => {
                skipFlagReceived = options?.skipReconciliation === true;
                retryFlagReceived = options?.retryFailedCommand === true;
                return { status: 'COMPLETED' } as any;
            },
        });

        await processor.process('intent-1');
        assert.equal(skipFlagReceived, true);
        assert.equal(retryFlagReceived, true);
    });

    it('retries BRIDGE_TRANSPORT_FAILURE the same way as BRIDGE_UNREACHABLE', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const prisma = {
            tradingTradeIntent: {
                updateMany: async () => ({ count: 1 }),
                findUnique: async () => ({
                    id: 'intent-1',
                    createdAt: new Date(),
                    accountId: 'acct-1',
                    signalEventId: 'evt-1',
                    commandType: 'OPEN_MARKET',
                    symbol: 'XAUUSD',
                    side: 'LONG',
                    binding: {
                        name: 'Paper Auto',
                        mode: 'AUTO_EXECUTE',
                        status: 'ACTIVE',
                        killSwitchActive: false,
                        riskConfigJson: null,
                        account: { ownerUserId: 'user-1', accountMode: 'PAPER' },
                    },
                    executionCommand: null,
                }),
                update: async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return undefined;
                },
            },
        } as unknown as PrismaClient;

        const processor = new TradingAutoExecutionProcessor(prisma, {
            createCommand: async () => ({
                status: 'FAILED',
                errorCode: 'BRIDGE_TRANSPORT_FAILURE',
                errorMessage: 'Transport-layer failure during dispatch.',
            }) as any,
        });

        await assert.rejects(
            () => processor.process('intent-1', { attemptNumber: 1, maxAttempts: 3 }),
            /Transport-layer failure/,
        );

        assert.equal(
            updates.some((u) => u.status === 'FAILED' && typeof u.statusReason === 'string' && (u.statusReason as string).includes('Retry 1/3')),
            true,
        );
    });

    describe('checkGuardrails', () => {
        function makeGuardrailIntent(guardrailsJson: Record<string, unknown> | null) {
            return {
                id: 'intent-g1',
                accountId: 'acct-g1',
                signalEventId: 'evt-g1',
                commandType: 'OPEN_MARKET',
                symbol: 'XAUUSD',
                side: 'LONG',
                entryPrice: null,
                stopLoss: null,
                takeProfit: null,
                createdAt: new Date(),
                binding: {
                    id: 'binding-g1',
                    name: 'Guardrail Test',
                    mode: 'AUTO_EXECUTE',
                    status: 'ACTIVE',
                    killSwitchActive: false,
                    riskConfigJson: null,
                    guardrailsJson,
                    account: {
                        ownerUserId: 'user-g1',
                        accountMode: 'PAPER',
                    },
                },
                executionCommand: null,
            };
        }

        const noopCommand = async () => ({ status: 'RECONCILED', errorCode: null, errorMessage: null }) as any;

        it('passes through when guardrailsJson is null — no bridge calls', async () => {
            let bridgeCalls = 0;
            const updates: Array<Record<string, unknown>> = [];
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent(null),
                    update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); },
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                { createCommand: noopCommand },
                { getBrokerContext: async () => ({ credential: null }) } as any,
                {
                    fetchPositions: async () => { bridgeCalls++; return []; },
                    fetchSummary: async () => { bridgeCalls++; return {} as any; },
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');

            assert.equal(bridgeCalls, 0, 'bridge should not be called when no guardrails are configured');
            assert.equal(updates.some((u) => u.status === 'REJECTED'), false, 'intent should not be rejected');
        });

        it('blocks when open position count reaches maxOpenPositions', async () => {
            const updates: Array<Record<string, unknown>> = [];
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent({ maxOpenPositions: 1 }),
                    update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); },
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                { createCommand: async () => { throw new Error('should not reach execution'); } },
                { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
                {
                    fetchPositions: async () => [{ brokerPositionId: 'pos-1' }] as any,
                    fetchSummary: async () => ({ balance: 10000, equity: 10000, realizedPnlDay: 0 }) as any,
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');

            const rejected = updates.find((u) => u.status === 'REJECTED');
            assert.ok(rejected, 'intent should be REJECTED');
            assert.ok((rejected!.statusReason as string).includes('maxOpenPositions'), 'reason should mention maxOpenPositions');
        });

        it('passes when open positions are below maxOpenPositions', async () => {
            let commandCalled = false;
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent({ maxOpenPositions: 3 }),
                    update: async () => undefined,
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                {
                    createCommand: async () => {
                        commandCalled = true;
                        return { status: 'RECONCILED', errorCode: null, errorMessage: null } as any;
                    },
                },
                { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
                {
                    fetchPositions: async () => [{ brokerPositionId: 'pos-1' }, { brokerPositionId: 'pos-2' }] as any,
                    fetchSummary: async () => ({ balance: 10000, equity: 10000, realizedPnlDay: 0 }) as any,
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');
            assert.equal(commandCalled, true, 'execution should proceed when under maxOpenPositions limit');
        });

        it('blocks when daily loss exceeds maxDailyLossPct', async () => {
            const updates: Array<Record<string, unknown>> = [];
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent({ maxDailyLossPct: 3 }),
                    update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); },
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                { createCommand: async () => { throw new Error('should not reach execution'); } },
                { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
                {
                    fetchPositions: async () => [] as any,
                    // balance=10000, realizedPnlDay=-350 → 3.5% loss > 3% threshold
                    fetchSummary: async () => ({ balance: 10000, equity: 9650, realizedPnlDay: -350 }) as any,
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');

            const rejected = updates.find((u) => u.status === 'REJECTED');
            assert.ok(rejected, 'intent should be REJECTED');
            assert.ok((rejected!.statusReason as string).includes('maxDailyLossPct'), 'reason should mention maxDailyLossPct');
        });

        it('auto-activates kill switch and rejects when drawdown exceeds killSwitchDrawdownPct', async () => {
            const intentUpdates: Array<Record<string, unknown>> = [];
            const bindingUpdates: Array<Record<string, unknown>> = [];
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent({ killSwitchDrawdownPct: 10 }),
                    update: async (args: { data: Record<string, unknown> }) => { intentUpdates.push(args.data); },
                },
                tradingAutomationBinding: {
                    update: async (args: { data: Record<string, unknown> }) => { bindingUpdates.push(args.data); },
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                { createCommand: async () => { throw new Error('should not reach execution'); } },
                { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
                {
                    fetchPositions: async () => [] as any,
                    // balance=10000, equity=8900 → 11% drawdown > 10% threshold
                    fetchSummary: async () => ({ balance: 10000, equity: 8900, realizedPnlDay: -1100 }) as any,
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');

            assert.ok(intentUpdates.some((u) => u.status === 'REJECTED'), 'intent should be REJECTED');
            assert.ok(bindingUpdates.some((u) => u.killSwitchActive === true), 'kill switch should be auto-activated on the binding');
            assert.ok(
                intentUpdates.some((u) => typeof u.statusReason === 'string' && (u.statusReason as string).includes('Kill switch auto-activated')),
                'rejection reason should explain kill switch auto-activation',
            );
        });

        it('falls back to local mirror when bridge is unreachable and blocks via mirror data', async () => {
            const updates: Array<Record<string, unknown>> = [];
            const freshCapturedAt = new Date(Date.now() - 30_000); // 30s ago — within 60s freshness
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent({ maxOpenPositions: 1 }),
                    update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); },
                },
                tradingPosition: {
                    count: async () => 2, // 2 open positions >= maxOpenPositions 1 → blocked
                },
                tradingAccountSnapshot: {
                    findFirst: async () => ({
                        balance: new Prisma.Decimal(10000),
                        equity: new Prisma.Decimal(10000),
                        realizedPnlDay: new Prisma.Decimal(0),
                        capturedAt: freshCapturedAt,
                    }),
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                { createCommand: async () => { throw new Error('should not reach execution'); } },
                { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
                {
                    fetchPositions: async () => { throw new Error('bridge unreachable'); },
                    fetchSummary: async () => { throw new Error('bridge unreachable'); },
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');

            const rejected = updates.find((u) => u.status === 'REJECTED');
            assert.ok(rejected, 'intent should be REJECTED based on local mirror data');
            assert.ok((rejected!.statusReason as string).includes('maxOpenPositions'), 'reason should reflect mirror-based guardrail check');
        });

        it('rejects with safety reason when bridge is unreachable and mirror is stale (>60s)', async () => {
            const updates: Array<Record<string, unknown>> = [];
            const staleCapturedAt = new Date(Date.now() - 90_000); // 90s ago — beyond 60s staleness threshold
            const prisma = {
                tradingTradeIntent: {
                    updateMany: async () => ({ count: 1 }),
                    findUnique: async () => makeGuardrailIntent({ maxOpenPositions: 1 }),
                    update: async (args: { data: Record<string, unknown> }) => { updates.push(args.data); },
                },
                tradingPosition: {
                    count: async () => 0, // under the limit — would pass if mirror were trusted
                },
                tradingAccountSnapshot: {
                    findFirst: async () => ({
                        balance: new Prisma.Decimal(10000),
                        equity: new Prisma.Decimal(10000),
                        realizedPnlDay: new Prisma.Decimal(0),
                        capturedAt: staleCapturedAt,
                    }),
                },
            } as unknown as PrismaClient;

            const processor = new TradingAutoExecutionProcessor(
                prisma,
                { createCommand: async () => { throw new Error('should not reach execution'); } },
                { getBrokerContext: async () => ({ credential: { mt5Login: '1', mt5Password: 'pw', mt5Server: 'demo' } }) } as any,
                {
                    fetchPositions: async () => { throw new Error('bridge unreachable'); },
                    fetchSummary: async () => { throw new Error('bridge unreachable'); },
                    fetchQuote: async () => ({} as any),
                },
            );

            await processor.process('intent-g1');

            const rejected = updates.find((u) => u.status === 'REJECTED');
            assert.ok(rejected, 'intent should be REJECTED when mirror is stale');
            assert.ok(
                (rejected!.statusReason as string).includes('stale') || (rejected!.statusReason as string).includes('safety'),
                'reason should indicate the stale mirror safety rejection',
            );
        });
    });
});
