import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { TradingExecutionService } from './TradingExecutionService';
import type { TradingExecutionLogger, TradingExecutionLogRecord } from './tradingExecutionLogger';

function createCommandRow(overrides: Record<string, unknown> = {}) {
    const now = new Date('2026-03-12T09:00:00.000Z');
    return {
        id: 'cmd-1',
        accountId: 'acct-1',
        tradeIntentId: 'intent-1',
        requestedByUserId: 'user-1',
        commandType: 'OPEN_MARKET',
        status: 'PENDING',
        idempotencyKey: 'trade-intent:intent-1',
        symbol: 'XAUUSD',
        side: 'LONG',
        volume: new Prisma.Decimal(0.1),
        price: null,
        stopLoss: null,
        takeProfit: null,
        brokerPositionId: null,
        brokerOrderId: null,
        brokerReference: null,
        payloadJson: {
            orderType: null,
            comment: 'AUTO_EXECUTE',
        },
        riskCheckJson: null,
        requestedAt: now,
        dispatchedAt: null,
        completedAt: null,
        reconciledAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        events: [],
        ...overrides,
    };
}

function createPrismaMock(
    {
        existingCommand = null,
    }: {
        existingCommand?: Record<string, unknown> | null;
    } = {},
) {
    let commandRow: any = existingCommand ? createCommandRow(existingCommand) : null;
    const events: Array<Record<string, unknown>> = existingCommand?.events
        ? [...(existingCommand.events as Array<Record<string, unknown>>)]
        : [];

    const prisma = {
        tradingExecutionCommand: {
            findUnique: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
                if (!commandRow) {
                    return null;
                }

                if (args.select?.status) {
                    return { status: commandRow.status };
                }

                if (args.where.id === commandRow.id || args.where.idempotencyKey === commandRow.idempotencyKey) {
                    return {
                        ...commandRow,
                        events: [...events],
                    };
                }

                return null;
            },
            create: async (args: { data: Record<string, unknown> }) => {
                commandRow = createCommandRow({
                    ...args.data,
                    id: 'cmd-1',
                    events: [],
                });
                return {
                    ...commandRow,
                    events: [...events],
                };
            },
            update: async (args: { data: Record<string, unknown> }) => {
                commandRow = {
                    ...commandRow,
                    ...args.data,
                };
                return {
                    ...commandRow,
                    events: [...events],
                };
            },
            findUniqueOrThrow: async () => ({
                ...commandRow,
                events: [...events],
            }),
        },
        tradingExecutionEvent: {
            create: async (args: { data: Record<string, unknown> }) => {
                const event = {
                    id: `evt-${events.length + 1}`,
                    commandId: args.data.commandId,
                    eventType: args.data.eventType,
                    occurredAt: new Date(`2026-03-12T09:00:0${events.length}.000Z`),
                    statusBefore: args.data.statusBefore ?? null,
                    statusAfter: args.data.statusAfter ?? null,
                    message: args.data.message ?? null,
                    payloadJson: args.data.payloadJson ?? null,
                    createdAt: new Date(`2026-03-12T09:00:0${events.length}.000Z`),
                };
                events.push(event);
                return event as any;
            },
        },
    } as unknown as PrismaClient;

    return {
        prisma,
        getCommand: () => ({
            ...commandRow,
            events: [...events],
        }),
    };
}

function createAccountContext() {
    return {
        id: 'acct-1',
        ownerUserId: 'user-1',
        label: 'Paper MT5',
        brokerKind: 'MT5' as const,
        accountMode: 'PAPER' as const,
        status: 'ACTIVE',
        baseCurrency: 'USD',
        leverage: 500,
        lastSeenAt: null,
        lastSuccessfulSyncAt: '2026-03-12T08:59:00.000Z',
        metadataJson: null,
        credential: {
            mt5Login: '1',
            mt5Password: 'pw',
            mt5Server: 'demo',
        },
    };
}

function createLoggerStub() {
    const entries: Array<{ level: 'info' | 'warn' | 'error'; record: TradingExecutionLogRecord }> = [];
    const logger: TradingExecutionLogger = {
        log(level, record) {
            entries.push({ level, record });
        },
    };
    return {
        logger,
        entries,
    };
}

describe('TradingExecutionService', () => {
    it('enqueues deferred reconciliation jobs when skipReconciliation is enabled', async () => {
        const enqueueCalls: unknown[] = [];
        const { prisma } = createPrismaMock();
        const accountScopeCalls: unknown[] = [];
        const summaryCalls: unknown[] = [];
        const { logger, entries } = createLoggerStub();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async (actor, accountId, scope) => {
                    accountScopeCalls.push({ actor, accountId, scope });
                    return createAccountContext();
                },
            },
            {
                getSummary: async (
                    actor: { id: string; role: 'ADMIN' | 'USER' },
                    accountId: string,
                    scope: { ownerUserId?: string | null },
                ) => {
                    summaryCalls.push({ actor, accountId, scope });
                    return {
                        syncHealth: {
                            canTrade: true,
                            message: 'healthy',
                        },
                    };
                },
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                openMarket: async () => ({
                    accepted: true,
                    brokerReference: 'deal-1',
                    brokerPositionId: '9001',
                    brokerOrderId: '9000',
                    message: 'Market order submitted.',
                    payload: { retcode: 1 },
                }),
            } as any,
            {
                enqueue: async (payload) => {
                    enqueueCalls.push(payload);
                },
            },
            logger,
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'OPEN_MARKET',
                symbol: 'XAUUSD',
                side: 'LONG',
                volume: 0.1,
                tradeIntentId: 'intent-1',
                idempotencyKey: 'trade-intent:intent-1',
                comment: 'AUTO_EXECUTE',
            },
            { skipReconciliation: true },
            { ownerUserId: 'user-2' },
        );

        assert.deepEqual(accountScopeCalls[0], {
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            scope: { ownerUserId: 'user-2' },
        });
        assert.deepEqual(summaryCalls[0], {
            actor: { id: 'user-1', role: 'USER' },
            accountId: 'acct-1',
            scope: { ownerUserId: 'user-2' },
        });
        assert.equal(enqueueCalls.length, 1);
        assert.deepEqual(enqueueCalls[0], {
            accountId: 'acct-1',
            requestedByUserId: 'user-1',
            sourceCommandId: 'cmd-1',
        });
        assert.equal(command.status, 'COMPLETED');
        assert.equal(command.events.some((event) => event.eventType === 'RECONCILE_DEFERRED'), true);
        assert.equal(entries.some((entry) => entry.record.event === 'command_submission_requested' && entry.level === 'info'), true);
        assert.equal(entries.some((entry) => entry.record.event === 'command_bridge_dispatched' && entry.level === 'info'), true);
        assert.equal(entries.some((entry) => entry.record.event === 'command_broker_completed' && entry.level === 'info'), true);
        assert.equal(entries.some((entry) => entry.record.event === 'command_reconciliation_deferred' && entry.level === 'info'), true);
    });

    it('redispatches an existing bridge-unreachable command when retryFailedCommand is enabled', async () => {
        let dispatchCount = 0;
        const { prisma, getCommand } = createPrismaMock({
            existingCommand: {
                status: 'FAILED',
                errorCode: 'BRIDGE_UNREACHABLE',
                errorMessage: 'Bridge down',
                dispatchedAt: new Date('2026-03-12T09:00:01.000Z'),
                completedAt: new Date('2026-03-12T09:00:02.000Z'),
            },
        });
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: true,
                        message: 'healthy',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                openMarket: async () => {
                    dispatchCount += 1;
                    return {
                        accepted: true,
                        brokerReference: 'deal-2',
                        brokerPositionId: '9002',
                        brokerOrderId: '9001',
                        message: 'Market order submitted.',
                        payload: { retcode: 1 },
                    };
                },
            } as any,
            {
                enqueue: async () => undefined,
            },
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'OPEN_MARKET',
                symbol: 'XAUUSD',
                side: 'LONG',
                volume: 0.1,
                tradeIntentId: 'intent-1',
                idempotencyKey: 'trade-intent:intent-1',
                comment: 'AUTO_EXECUTE',
            },
            {
                skipReconciliation: true,
                retryFailedCommand: true,
            },
            { ownerUserId: 'user-2' },
        );

        assert.equal(dispatchCount, 1);
        assert.equal(command.status, 'COMPLETED');
        assert.equal(command.errorCode, null);
        assert.equal(getCommand().events.some((event: { eventType: string }) => event.eventType === 'RETRY_REQUESTED'), true);
    });

    it('logs precondition-blocked command attempts with the rejection reason', async () => {
        const { prisma } = createPrismaMock();
        const { logger, entries } = createLoggerStub();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: false,
                        message: 'Mirror data is stale.',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                openMarket: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                enqueue: async () => undefined,
            },
            logger,
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'OPEN_MARKET',
                symbol: 'XAUUSD',
                side: 'LONG',
                volume: 0.1,
            },
        );

        assert.equal(command.status, 'REJECTED');
        assert.equal(command.errorCode, 'PRECONDITION_BLOCKED');
        assert.equal(entries.some((entry) => (
            entry.level === 'warn'
            && entry.record.event === 'command_precondition_blocked'
            && entry.record.errorMessage === 'Mirror data is stale.'
        )), true);
    });

    it('uses the readiness reasonCode when the execution terminal is blocked before dispatch', async () => {
        const { prisma } = createPrismaMock();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: false,
                        message: 'The MT5 execution terminal has AutoTrading disabled for external requests.',
                        reasonCode: 'TERMINAL_AUTOTRADING_DISABLED',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                openMarket: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                enqueue: async () => undefined,
            },
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'OPEN_MARKET',
                symbol: 'BTCUSD',
                side: 'LONG',
                volume: 0.1,
            },
        );

        assert.equal(command.status, 'REJECTED');
        assert.equal(command.errorCode, 'TERMINAL_AUTOTRADING_DISABLED');
        assert.equal(
            command.events.some((event) => (
                event.eventType === 'PRECONDITION_BLOCKED'
                && event.message === 'The MT5 execution terminal has AutoTrading disabled for external requests.'
            )),
            true,
        );
    });

    it('preserves bridge failure classification when MT5 rejects the filling mode', async () => {
        const { prisma } = createPrismaMock();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: true,
                        message: 'healthy',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                openMarket: async () => ({
                    accepted: false,
                    brokerReference: null,
                    brokerPositionId: null,
                    brokerOrderId: null,
                    message: 'Unsupported filling mode for BTCUSD (retcode 10030).',
                    payload: {
                        failure: {
                            code: 'INVALID_FILL_MODE',
                            category: 'preflight',
                            retcode: 10030,
                            comment: 'Unsupported filling mode',
                            message: 'Unsupported filling mode for BTCUSD (retcode 10030).',
                        },
                    },
                    failure: {
                        code: 'INVALID_FILL_MODE',
                        category: 'preflight',
                        retcode: 10030,
                        comment: 'Unsupported filling mode',
                        message: 'Unsupported filling mode for BTCUSD (retcode 10030).',
                    },
                }),
            } as any,
            {
                enqueue: async () => undefined,
            },
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'OPEN_MARKET',
                symbol: 'BTCUSD',
                side: 'LONG',
                volume: 0.1,
            },
            { skipReconciliation: true },
        );

        assert.equal(command.status, 'REJECTED');
        assert.equal(command.errorCode, 'INVALID_FILL_MODE');
        assert.equal(command.errorMessage, 'Unsupported filling mode for BTCUSD (retcode 10030).');
        assert.equal(
            command.events.some((event) => (
                event.eventType === 'BROKER_REJECTED'
                && (event.payloadJson as { failure?: { code?: string } } | null)?.failure?.code === 'INVALID_FILL_MODE'
            )),
            true,
        );
    });

    it('fails transport-layer bridge rejections as FAILED so they remain retryable', async () => {
        const { prisma } = createPrismaMock();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: true,
                        message: 'healthy',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                openMarket: async () => ({
                    accepted: false,
                    brokerReference: null,
                    brokerPositionId: null,
                    brokerOrderId: null,
                    message: 'MT5 bridge transport failed during order preflight or dispatch.',
                    payload: {
                        failure: {
                            code: 'BRIDGE_TRANSPORT_FAILURE',
                            category: 'transport',
                            retcode: null,
                            comment: null,
                            message: 'MT5 bridge transport failed during order preflight or dispatch.',
                        },
                    },
                    failure: {
                        code: 'BRIDGE_TRANSPORT_FAILURE',
                        category: 'transport',
                        retcode: null,
                        comment: null,
                        message: 'MT5 bridge transport failed during order preflight or dispatch.',
                    },
                }),
            } as any,
            {
                enqueue: async () => undefined,
            },
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'OPEN_MARKET',
                symbol: 'BTCUSD',
                side: 'LONG',
                volume: 0.1,
            },
            { skipReconciliation: true },
        );

        assert.equal(command.status, 'FAILED');
        assert.equal(command.errorCode, 'BRIDGE_TRANSPORT_FAILURE');
        assert.equal(
            command.events.some((event) => (
                event.eventType === 'DISPATCH_FAILED'
                && (event.payloadJson as { failure?: { category?: string } } | null)?.failure?.category === 'transport'
            )),
            true,
        );
    });

    it('rejects contradictory pending-order side and orderType combinations', async () => {
        const { prisma } = createPrismaMock();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: true,
                        message: 'healthy',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                placePending: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                enqueue: async () => undefined,
            },
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'PLACE_PENDING',
                symbol: 'BTCUSD',
                side: 'LONG',
                volume: 0.1,
                price: 90000,
                orderType: 'SELL_LIMIT',
            },
        );

        assert.equal(command.status, 'REJECTED');
        assert.equal(command.errorCode, 'VALIDATION_REJECTED');
        assert.equal(command.errorMessage, 'Place pending side must match orderType SELL_LIMIT.');
    });

    it('derives the stored pending-order side from orderType when the caller omits it', async () => {
        const { prisma } = createPrismaMock();
        const service = new TradingExecutionService(
            prisma,
            {
                getBrokerContext: async () => createAccountContext(),
            },
            {
                getSummary: async () => ({
                    syncHealth: {
                        canTrade: true,
                        message: 'healthy',
                    },
                }),
                forceSync: async () => {
                    throw new Error('should not run');
                },
            } as any,
            {
                placePending: async () => ({
                    accepted: true,
                    brokerReference: 'order-1',
                    brokerPositionId: null,
                    brokerOrderId: 'order-1',
                    message: 'Pending order submitted.',
                    payload: { retcode: 10008 },
                }),
            } as any,
            {
                enqueue: async () => undefined,
            },
        );

        const command = await service.createCommand(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                commandType: 'PLACE_PENDING',
                symbol: 'BTCUSD',
                volume: 0.1,
                price: 90000,
                orderType: 'BUY_LIMIT',
            },
            { skipReconciliation: true },
        );

        assert.equal(command.status, 'COMPLETED');
        assert.equal(command.side, 'LONG');
    });
});
