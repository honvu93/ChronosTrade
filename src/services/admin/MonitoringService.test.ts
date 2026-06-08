import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MonitoringService } from './MonitoringService';

function createPrismaMock() {
    const candleAggregateCalls: Array<{ symbol: unknown; timeframe: unknown }> = [];
    return {
        $queryRawUnsafe: async () => [{ '?column?': 1 }],
        candle: {
            groupBy: async () => [
                { timeframe: 'H1', _count: { _all: 120 } },
                { timeframe: 'M15', _count: { _all: 360 } },
            ],
            aggregate: async ({ where }: { where: { symbol: unknown; timeframe: unknown } }) => {
                candleAggregateCalls.push({
                    symbol: where.symbol,
                    timeframe: where.timeframe,
                });

                const symbolAliases = typeof where.symbol === 'object' && where.symbol !== null && 'in' in where.symbol
                    ? (where.symbol as { in: string[] }).in
                    : [];
                const timeframeAliases = typeof where.timeframe === 'object' && where.timeframe !== null && 'in' in where.timeframe
                    ? (where.timeframe as { in: string[] }).in
                    : [];

                return {
                    _max: {
                        time: symbolAliases.includes('XAUUSD')
                            ? new Date('2026-03-13T09:55:00.000Z')
                            : timeframeAliases.includes('M15')
                                ? new Date('2026-03-13T09:58:00.000Z')
                                : null,
                    },
                };
            },
            count: async () => 480,
        },
        indicatorInstance: {
            groupBy: async () => [
                { symbol: 'XAUUSD', timeframe: '1h', _count: { _all: 2 } },
                { symbol: 'BTCUSD', timeframe: '15m', _count: { _all: 1 } },
            ],
        },
        backtestRun: {
            findMany: async () => [
                {
                    id: 'run-1',
                    name: 'London breakout v4',
                    errorMessage: 'Missing candle coverage near the run boundary.',
                    symbol: 'XAUUSD',
                    timeframe: 'H1',
                    updatedAt: new Date('2026-03-13T09:40:00.000Z'),
                },
            ],
        },
        tradingTradeIntent: {
            findMany: async () => [
                {
                    id: 'intent-1',
                    status: 'FAILED',
                    statusReason: 'Broker rejected the order because the market was closed.',
                    symbol: 'XAUUSD',
                    createdAt: new Date('2026-03-13T09:30:00.000Z'),
                    updatedAt: new Date('2026-03-13T09:45:00.000Z'),
                    binding: {
                        name: 'London auto',
                    },
                },
            ],
        },
        signal: {
            count: async () => 24,
        },
        backtestTradeResult: {
            count: async () => 12,
        },
        tradingAccount: {
            findMany: async () => [
                {
                    id: 'acct-1',
                    label: 'Primary MT5',
                    lastSuccessfulSyncAt: new Date('2026-03-13T09:58:00.000Z'),
                },
            ],
        },
        tradingSyncRun: {
            findFirst: async (): Promise<{
                accountId: string;
                status: string;
                errorMessage: string | null;
                account: { label: string };
            }> => ({
                accountId: 'acct-1',
                status: 'SUCCEEDED',
                errorMessage: null,
                account: {
                    label: 'Primary MT5',
                },
            }),
        },
        __calls: {
            candleAggregateCalls,
        },
    };
}

describe('MonitoringService', () => {
    it('builds a monitoring snapshot and reuses the cached payload within 60 seconds', async () => {
        const prisma = createPrismaMock();
        let bridgeHealthCalls = 0;
        const service = new MonitoringService(
            prisma as never,
            {
                health: async () => {
                    bridgeHealthCalls += 1;
                    return true;
                },
            } as never,
            () => new Date('2026-03-13T10:00:00.000Z'),
        );

        const first = await service.getSnapshot();
        const second = await service.getSnapshot();

        assert.equal(first.cached, false);
        assert.equal(second.cached, true);
        assert.equal(first.tableCounts.candles, 480);
        assert.equal(first.health[1].key, 'database');
        assert.equal(first.health[2].status, 'healthy');
        assert.equal(first.activeSymbolFreshness[0].symbol, 'XAUUSD');
        assert.equal(first.activeSymbolFreshness[0].status, 'fresh');
        assert.deepEqual((prisma as ReturnType<typeof createPrismaMock>).__calls.candleAggregateCalls[0], {
            symbol: { in: ['XAUUSD', 'XAUUSDc'] },
            timeframe: { in: ['1h', 'H1', 'h1'] },
        });
        assert.equal(first.alerts[0].source, 'trade-intent');
        assert.equal(bridgeHealthCalls, 1);
    });

    it('surfaces failed MT5 sync health when the bridge is unreachable', async () => {
        const service = new MonitoringService(
            createPrismaMock() as never,
            {
                health: async () => false,
            } as never,
            () => new Date('2026-03-13T10:00:00.000Z'),
        );

        const snapshot = await service.getSnapshot();
        const mt5Health = snapshot.health.find((item) => item.key === 'mt5Sync');

        assert.ok(mt5Health);
        assert.equal(mt5Health?.status, 'failed');
    });

    describe('healthProbe', () => {
        it('returns db ok and bridge ok when both are reachable', async () => {
            const service = new MonitoringService(
                createPrismaMock() as never,
                { health: async () => true } as never,
            );

            const result = await service.healthProbe();

            assert.equal(result.db, 'ok');
            assert.equal(result.bridge, 'ok');
        });

        it('returns db failed when the database probe throws', async () => {
            const brokenPrisma = {
                ...createPrismaMock(),
                $queryRawUnsafe: async () => { throw new Error('connection refused'); },
            };

            const service = new MonitoringService(
                brokenPrisma as never,
                { health: async () => true } as never,
            );

            const result = await service.healthProbe();

            assert.equal(result.db, 'failed');
            assert.equal(result.bridge, 'ok');
        });

        it('returns bridge unreachable when the MT5 bridge is down', async () => {
            const service = new MonitoringService(
                createPrismaMock() as never,
                { health: async () => false } as never,
            );

            const result = await service.healthProbe();

            assert.equal(result.db, 'ok');
            assert.equal(result.bridge, 'unreachable');
        });
    });

    it('does not degrade MT5 sync health for failures that belong to inactive accounts', async () => {
        const prisma = createPrismaMock();
        prisma.tradingSyncRun.findFirst = async () => ({
            accountId: 'acct-inactive',
            status: 'FAILED',
            errorMessage: 'Old failure from an inactive account.',
            account: {
                label: 'Inactive MT5',
            },
        });

        const service = new MonitoringService(
            prisma as never,
            {
                health: async () => true,
            } as never,
            () => new Date('2026-03-13T10:00:00.000Z'),
        );

        const snapshot = await service.getSnapshot();
        const mt5Health = snapshot.health.find((item) => item.key === 'mt5Sync');

        assert.ok(mt5Health);
        assert.equal(mt5Health?.status, 'healthy');
    });
});
