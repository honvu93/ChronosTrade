import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FailureClassificationService } from './FailureClassificationService';

// ---------------------------------------------------------------------------
// Minimal Prisma mock
// ---------------------------------------------------------------------------

type CandleGroupRow = { symbol: string; timeframe: string; _max: { time: Date | null } };
type IndicatorRow = { id: string; name: string; status: string; signalCode: string; updatedAt: Date; errorMessage: string | null };
type BacktestRow  = { id: string; name: string; symbol: string; timeframe: string; createdAt: Date };

function buildPrismaMock(opts: {
    candleGroups?: CandleGroupRow[];
    signalInstances?: IndicatorRow[];
    tradingInstances?: IndicatorRow[];
    backtestRuns?: BacktestRow[];
}) {
    const { candleGroups = [], signalInstances = [], tradingInstances = [], backtestRuns = [] } = opts;

    return {
        candle: {
            groupBy: async () => candleGroups,
        },
        indicatorInstance: {
            findMany: async (args: { where: { sourceBacktestRunId?: unknown } }) => {
                const isLive =
                    args.where.sourceBacktestRunId === null ||
                    (typeof args.where.sourceBacktestRunId === 'object' && args.where.sourceBacktestRunId === null);
                // When querying live instances: sourceBacktestRunId: null
                // When querying backtest-linked: sourceBacktestRunId: { not: null }
                if (args.where.sourceBacktestRunId === null) return tradingInstances;
                return signalInstances;
            },
        },
        backtestRun: {
            findMany: async () => backtestRuns,
        },
    } as unknown as import('@prisma/client').PrismaClient;
}

const HOUR = 60 * 60 * 1000;
const now  = Date.now();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FailureClassificationService.classify', () => {
    it('returns all-ok snapshot when no data problems', async () => {
        const prisma = buildPrismaMock({
            candleGroups: [
                { symbol: 'XAUUSD', timeframe: 'H1', _max: { time: new Date(now - 1 * HOUR) } },
            ],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.totalCritical, 0);
        assert.equal(result.totalWarning, 0);
        assert.equal(result.domains.ingestion.severity, 'ok');
        assert.equal(result.domains.signal.severity, 'ok');
        assert.equal(result.domains.alert.severity, 'ok');
        assert.equal(result.domains.trading.severity, 'ok');
    });

    it('flags ingestion warning when candle is between 4h and 24h old', async () => {
        const prisma = buildPrismaMock({
            candleGroups: [
                { symbol: 'XAUUSD', timeframe: 'H1', _max: { time: new Date(now - 6 * HOUR) } },
            ],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.ingestion.severity, 'warning');
        assert.equal(result.domains.ingestion.items.length, 1);
        assert.equal(result.domains.ingestion.items[0].severity, 'warning');
        assert.ok(result.domains.ingestion.items[0].title.includes('XAUUSD'));
    });

    it('flags ingestion critical when candle is older than 24h', async () => {
        const prisma = buildPrismaMock({
            candleGroups: [
                { symbol: 'BTCUSD', timeframe: 'M1', _max: { time: new Date(now - 25 * HOUR) } },
            ],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.ingestion.severity, 'critical');
        assert.equal(result.totalCritical, 1);
    });

    it('separates critical and warning across multiple symbols', async () => {
        const prisma = buildPrismaMock({
            candleGroups: [
                { symbol: 'XAUUSD', timeframe: 'H1', _max: { time: new Date(now - 25 * HOUR) } }, // critical
                { symbol: 'BTCUSD', timeframe: 'H4', _max: { time: new Date(now - 5 * HOUR)  } }, // warning
                { symbol: 'XAGUSD', timeframe: 'M5', _max: { time: new Date(now - 1 * HOUR)  } }, // ok
            ],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.ingestion.severity, 'critical');
        assert.equal(result.domains.ingestion.items.length, 2);
        assert.equal(result.totalCritical, 1);
        assert.equal(result.totalWarning, 1);
    });

    it('flags signal critical for FAILED indicator instance', async () => {
        const prisma = buildPrismaMock({
            signalInstances: [{
                id: 'inst-1', name: 'SongTrap H1', status: 'FAILED',
                signalCode: 'songTrap', updatedAt: new Date(), errorMessage: 'Unhandled error',
            }],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.signal.severity, 'critical');
        assert.equal(result.domains.signal.items[0].severity, 'critical');
        assert.ok(result.domains.signal.items[0].detail.includes('Unhandled error'));
    });

    it('flags signal warning for PAUSED indicator instance', async () => {
        const prisma = buildPrismaMock({
            signalInstances: [{
                id: 'inst-2', name: 'TrendX M15', status: 'PAUSED',
                signalCode: 'trendX', updatedAt: new Date(), errorMessage: null,
            }],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.signal.severity, 'warning');
        assert.equal(result.domains.signal.items[0].severity, 'warning');
    });

    it('flags alert warning for failed backtest run', async () => {
        const prisma = buildPrismaMock({
            backtestRuns: [{
                id: 'run-1', name: 'SongTrap XAUUSD H1',
                symbol: 'XAUUSD', timeframe: 'H1', createdAt: new Date(),
            }],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.alert.severity, 'warning');
        assert.equal(result.domains.alert.items[0].severity, 'warning');
        assert.ok(result.domains.alert.items[0].title.includes('SongTrap XAUUSD H1'));
    });

    it('flags trading critical for FAILED live indicator', async () => {
        const prisma = buildPrismaMock({
            tradingInstances: [{
                id: 'live-1', name: 'Live TrendX', status: 'FAILED',
                signalCode: 'trendX', updatedAt: new Date(), errorMessage: 'Bridge timeout',
            }],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.trading.severity, 'critical');
        assert.ok(result.domains.trading.items[0].detail.includes('Bridge timeout'));
    });

    it('domains are independent — trading failure does not affect signal domain', async () => {
        const prisma = buildPrismaMock({
            tradingInstances: [{
                id: 'live-2', name: 'Live SongTrap', status: 'FAILED',
                signalCode: 'songTrap', updatedAt: new Date(), errorMessage: null,
            }],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.trading.severity, 'critical');
        assert.equal(result.domains.signal.severity,  'ok');
        assert.equal(result.domains.alert.severity,   'ok');
        assert.equal(result.domains.ingestion.severity, 'ok');
    });

    it('totalCritical and totalWarning aggregate across all domains', async () => {
        const prisma = buildPrismaMock({
            candleGroups: [
                { symbol: 'XAUUSD', timeframe: 'H1', _max: { time: new Date(now - 25 * HOUR) } }, // critical
            ],
            signalInstances: [{
                id: 'inst-3', name: 'Inst', status: 'PAUSED',
                signalCode: 'songTrap', updatedAt: new Date(), errorMessage: null,
            }],
            backtestRuns: [{
                id: 'run-2', name: 'Run', symbol: 'XAUUSD', timeframe: 'H1', createdAt: new Date(),
            }],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.totalCritical, 1); // ingestion
        assert.equal(result.totalWarning, 2);  // signal + alert
    });

    it('domain checker error does not crash the full classify', async () => {
        // Candle groupBy throws — but other domains still succeed
        const prisma = {
            candle: {
                groupBy: async () => { throw new Error('DB connection lost'); },
            },
            indicatorInstance: { findMany: async () => [] },
            backtestRun: { findMany: async () => [] },
        } as unknown as import('@prisma/client').PrismaClient;

        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        // Ingestion falls back to ok (caught), others remain ok
        assert.equal(result.domains.ingestion.severity, 'ok');
        assert.equal(result.domains.signal.severity, 'ok');
    });

    it('skips candle group with null max time', async () => {
        const prisma = buildPrismaMock({
            candleGroups: [
                { symbol: 'XAUUSD', timeframe: 'H1', _max: { time: null } },
            ],
        });
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();

        assert.equal(result.domains.ingestion.severity, 'ok');
        assert.equal(result.domains.ingestion.items.length, 0);
    });

    it('evaluatedAt is a valid ISO string', async () => {
        const prisma = buildPrismaMock({});
        const svc = new FailureClassificationService(prisma);
        const result = await svc.classify();
        assert.ok(!isNaN(new Date(result.evaluatedAt).getTime()));
    });
});
