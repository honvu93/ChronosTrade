import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { TradingWorkspaceService } from './TradingWorkspaceService';

function createPrismaMock() {
    const calls: Array<Record<string, unknown>> = [];

    return {
        calls,
        prisma: {
            tradingDeal: {
                findMany: async (args: Record<string, unknown>) => {
                    calls.push(args);
                    return [];
                },
            },
        } as unknown as PrismaClient,
    };
}

function createSummaryPrismaMock() {
    return {
        prisma: {
            tradingAccountSnapshot: {
                findFirst: async () => ({
                    balance: 10000,
                    equity: 10000,
                    margin: 0,
                    freeMargin: 10000,
                    marginLevel: null,
                    unrealizedPnl: 0,
                    realizedPnlDay: 0,
                }),
            },
            tradingSyncRun: {
                findFirst: async () => null,
            },
            tradingPosition: {
                count: async () => 0,
            },
            tradingOrder: {
                count: async () => 0,
            },
            tradingDeal: {
                count: async () => 0,
            },
        } as unknown as PrismaClient,
    };
}

describe('TradingWorkspaceService.listDeals', () => {
    it('forwards explicit owner scope into broker access checks', async () => {
        const { prisma } = createPrismaMock();
        const calls: unknown[] = [];
        const service = new TradingWorkspaceService(
            prisma,
            {
                getBrokerContext: async (actor, accountId, scope) => {
                    calls.push({ actor, accountId, scope });
                    return {
                        id: 'acct-1',
                        ownerUserId: 'user-2',
                        label: 'Scoped MT5',
                        brokerKind: 'MT5',
                        accountMode: 'PAPER',
                        status: 'ACTIVE',
                        baseCurrency: 'USD',
                        leverage: 500,
                        lastSeenAt: null,
                        lastSuccessfulSyncAt: null,
                        metadataJson: null,
                        credential: null,
                    };
                },
            },
        );

        await service.listDeals(
            { id: 'admin-1', role: 'ADMIN' },
            'acct-1',
            {},
            { ownerUserId: 'user-2' },
        );

        assert.deepEqual(calls[0], {
            actor: { id: 'admin-1', role: 'ADMIN' },
            accountId: 'acct-1',
            scope: { ownerUserId: 'user-2' },
        });
    });

    it('keeps the default bounded snapshot when no range is supplied', async () => {
        const { prisma, calls } = createPrismaMock();
        const service = new TradingWorkspaceService(
            prisma,
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Primary MT5',
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

        await service.listDeals({ id: 'user-1', role: 'USER' }, 'acct-1');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].take, 50);
        assert.deepEqual(calls[0].orderBy, { executedAt: 'desc' });
    });

    it('applies a bounded limit to ranged history queries when the caller does not supply one', async () => {
        const { prisma, calls } = createPrismaMock();
        const service = new TradingWorkspaceService(
            prisma,
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Primary MT5',
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

        const from = new Date('2026-03-01T00:00:00.000Z');
        const to = new Date('2026-03-05T23:59:59.999Z');
        await service.listDeals({ id: 'user-1', role: 'USER' }, 'acct-1', { from, to });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].take, 500);
        assert.deepEqual(calls[0].where, {
            accountId: 'acct-1',
            executedAt: {
                gte: from,
                lte: to,
            },
        });
    });

    it('honors an explicit caller limit for ranged history queries', async () => {
        const { prisma, calls } = createPrismaMock();
        const service = new TradingWorkspaceService(
            prisma,
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Primary MT5',
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

        await service.listDeals(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                limit: 25,
                from: new Date('2026-03-01T00:00:00.000Z'),
            },
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].take, 25);
    });

    it('propagates accountMode LIVE through broker context for backward compatibility', async () => {
        const { prisma, calls } = createPrismaMock();
        const service = new TradingWorkspaceService(
            prisma,
            {
                getBrokerContext: async () => ({
                    id: 'acct-2',
                    ownerUserId: 'user-1',
                    label: 'Live MT5',
                    brokerKind: 'MT5',
                    accountMode: 'LIVE',
                    status: 'ACTIVE',
                    baseCurrency: 'USD',
                    leverage: 100,
                    lastSeenAt: null,
                    lastSuccessfulSyncAt: null,
                    metadataJson: null,
                    credential: null,
                }),
            },
        );

        await service.listDeals({ id: 'user-1', role: 'USER' }, 'acct-2');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].take, 50);
        assert.deepEqual(calls[0].where, { accountId: 'acct-2' });
    });
});

describe('TradingWorkspaceService.getSummary', () => {
    it('surfaces execution-blocked readiness as a failed sync health state with a reason code', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/bridge/health')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ success: true }),
                } as Response;
            }

            if (url.endsWith('/bridge/account/readiness')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        data: {
                            ready: false,
                            message: 'The MT5 execution terminal is blocking external trading requests.',
                            failureCode: 'TERMINAL_AUTOTRADING_DISABLED',
                            blockers: [
                                {
                                    code: 'TERMINAL_AUTOTRADING_DISABLED',
                                    message: 'The MT5 execution terminal is blocking external trading requests.',
                                },
                            ],
                            terminal: {
                                tradeAllowed: false,
                                tradeApiDisabled: false,
                            },
                            account: {
                                tradeAllowed: true,
                            },
                        },
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch url: ${url}`);
        }) as typeof fetch;

        try {
            const { prisma } = createSummaryPrismaMock();
            const service = new TradingWorkspaceService(
                prisma,
                {
                    getBrokerContext: async () => ({
                        id: 'acct-1',
                        ownerUserId: 'user-1',
                        label: 'Primary MT5',
                        brokerKind: 'MT5',
                        accountMode: 'PAPER',
                        status: 'ACTIVE',
                        baseCurrency: 'USD',
                        leverage: 500,
                        lastSeenAt: null,
                        lastSuccessfulSyncAt: '2026-03-12T08:59:00.000Z',
                        metadataJson: null,
                        credential: {
                            mt5Login: '20002',
                            mt5Password: 'secret',
                            mt5Server: 'Demo-Server',
                        },
                    }),
                },
                undefined,
                {
                    ENCRYPTION_KEY: '12345678901234567890123456789012',
                } as NodeJS.ProcessEnv,
            );

            const summary = await service.getSummary({ id: 'user-1', role: 'USER' }, 'acct-1');

            assert.equal(summary.syncHealth.state, 'failed');
            assert.equal(summary.syncHealth.canTrade, false);
            assert.equal(summary.syncHealth.reasonCode, 'TERMINAL_AUTOTRADING_DISABLED');
            assert.equal(summary.syncHealth.message, 'The MT5 execution terminal is blocking external trading requests.');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('surfaces execution-readiness endpoint failures as disconnected bridge issues', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/bridge/health')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ success: true }),
                } as Response;
            }

            if (url.endsWith('/bridge/account/readiness')) {
                return {
                    ok: false,
                    status: 502,
                    json: async () => ({
                        ok: false,
                        error: {
                            code: 'MT5_BRIDGE_FAILED',
                            message: 'MT5 initialize failed: (-6, "Terminal: Authorization failed")',
                        },
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch url: ${url}`);
        }) as typeof fetch;

        try {
            const { prisma } = createSummaryPrismaMock();
            const service = new TradingWorkspaceService(
                prisma,
                {
                    getBrokerContext: async () => ({
                        id: 'acct-1',
                        ownerUserId: 'user-1',
                        label: 'Primary MT5',
                        brokerKind: 'MT5',
                        accountMode: 'PAPER',
                        status: 'ACTIVE',
                        baseCurrency: 'USD',
                        leverage: 500,
                        lastSeenAt: null,
                        lastSuccessfulSyncAt: '2026-03-12T08:59:00.000Z',
                        metadataJson: null,
                        credential: {
                            mt5Login: '20002',
                            mt5Password: 'secret',
                            mt5Server: 'Demo-Server',
                        },
                    }),
                },
                undefined,
                {
                    ENCRYPTION_KEY: '12345678901234567890123456789012',
                } as NodeJS.ProcessEnv,
            );

            const summary = await service.getSummary({ id: 'user-1', role: 'USER' }, 'acct-1');

            assert.equal(summary.syncHealth.state, 'disconnected');
            assert.equal(summary.syncHealth.canTrade, false);
            assert.equal(summary.syncHealth.reasonCode, 'MT5_BRIDGE_FAILED');
            assert.equal(summary.syncHealth.message, 'MT5 initialize failed: (-6, "Terminal: Authorization failed")');
        } finally {
            global.fetch = originalFetch;
        }
    });
});
